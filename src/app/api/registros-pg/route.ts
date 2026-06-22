import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

/**
 * Forzar que este endpoint sea SIEMPRE dinámico (nunca cacheado).
 * Sin esto, Next.js/Vercel puede servir una versión estática/cacheada
 * con datos viejos (orden incorrecto, sin el campo id), lo que rompía
 * el orden por fecha y el "marcar como hecho" en modo Postgres.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Endpoint compatible con /api/sheets, pero leyendo desde PostgreSQL.
 *
 * Devuelve los emails almacenados en Postgres en el mismo formato que
 * espera el dashboard, para que pueda alternar entre ambas fuentes
 * sin romper la UI durante la migración.
 *
 * Formato de salida:
 *   {
 *     registros: [
 *       { fecha, quien, asunto, enlace, cuerpo, estado, tipo,
 *         prioridad, autoDropdown, respuestaAuto, telefono }
 *     ],
 *     fuente: "postgres",
 *     total: N
 *   }
 */

interface AdjuntoInfo {
  drive_url?: string;
  nombre?: string;
  tipo?: string;
}

interface DatosExtraidos {
  prioridad?: string;
  autoDropdown?: string;
  respuestaAuto?: string;
  telefono?: string;
  estado_legacy?: string;
  tipo_legacy?: string;
  fila_sheet_idx?: number;
}

interface FilaPostgres {
  id: string;
  gmail_message_id: string | null;
  fila_sheet_idx: number | null;
  recibido_en: Date;
  remitente_nombre: string | null;
  remitente_email: string | null;
  asunto: string | null;
  adjuntos_info: AdjuntoInfo[] | null;
  cuerpo: string | null;
  estado_legacy: string | null;
  tipo_legacy: string | null;
  prioridad: string | null;
  auto_dropdown: string | null;
  respuesta_auto: string | null;
  telefono: string | null;
  tipo_enum: string | null;
  estado_funcional: string | null;
  estado_override: string | null;
  fuente: string | null;
}

/**
 * Para emails escritos por el AGENTE (no por Apps Script), los campos de
 * texto estado_legacy/tipo_legacy están vacíos. Derivamos los textos que
 * el dashboard espera a partir del tipo enum del agente.
 *
 * Criterio de negocio (confirmado por Toni):
 *   - Todo lo que requiere acción suya = "Pendiente (...)" → aparece en
 *     el filtro Pendiente.
 *   - Las facturas son pendientes hasta darlas de alta en el ERP.
 *   - Solo logística y "otro" van directos a archivado.
 */
function derivarEstadoTipo(tipoEnum: string | null): {
  estado: string;
  tipo: string;
} {
  switch ((tipoEnum ?? "").toLowerCase()) {
    case "pedido_cliente":
      return { estado: "Pendiente (Pedido)", tipo: "Pedido" };
    case "factura_proveedor":
      return { estado: "Pendiente (Factura)", tipo: "Factura" };
    case "consulta_cliente":
      return { estado: "Pendiente (Consulta)", tipo: "Consulta" };
    case "muestra_cliente":
      // Las muestras se gestionan como consultas (van a esa pestaña)
      return { estado: "Pendiente (Muestra)", tipo: "Consulta" };
    case "logistica":
      return { estado: "Archivado", tipo: "Logística" };
    default:
      return { estado: "Archivado", tipo: "Otro" };
  }
}

interface RegistroDashboard {
  id: string;
  fecha: string;
  quien: string;
  asunto: string;
  enlace: string;
  cuerpo: string;
  estado: string;
  tipo: string;
  prioridad: string;
  autoDropdown: string;
  respuestaAuto: string;
  telefono: string;
}

// Estados que indican que un pedido ya está gestionado (fuera de pendientes).
const ESTADOS_CERRADOS = new Set([
  "enviado", "contabilizada", "respondida", "pagada", "completado",
  "procesado", "revisada", "archivado",
]);

// Número de pedido de SQL Pyme: "26-219" (año-correlativo).
const PATRON_NUM_PEDIDO = /\b(\d{2}-\d{3,5})\b/;
// Prefijos de reenvío/respuesta a quitar del asunto mostrado.
const PREFIJO_REENVIO = /^\s*((rv|re|fwd|fw)\s*:\s*)+/i;

/**
 * Colapsa los pedidos repetidos en un único registro por número de pedido.
 *
 * SQL Pyme autoenvía cada pedido y además se reenvía (RV:, RV: RV:) o se
 * manda en días distintos, generando varios correos con el mismo número
 * (p.ej. "26-219"). Dejamos uno por número: el más reciente (los registros
 * llegan ordenados por fecha DESC), con el asunto sin prefijos de reenvío y
 * heredando el estado "cerrado" si cualquiera de las copias ya fue gestionada.
 * Los registros que no son pedidos pasan tal cual.
 */
function agruparPedidosPorNumero(
  registros: RegistroDashboard[]
): RegistroDashboard[] {
  const indicePorNumero = new Map<string, number>();
  const salida: RegistroDashboard[] = [];

  for (const reg of registros) {
    const esPedido = /pedido/i.test(reg.tipo) || /pedido/i.test(reg.asunto);
    const m = esPedido ? reg.asunto.match(PATRON_NUM_PEDIDO) : null;
    const numero = m ? m[1] : null;

    if (!numero) {
      salida.push(reg);
      continue;
    }

    const idx = indicePorNumero.get(numero);
    if (idx === undefined) {
      indicePorNumero.set(numero, salida.length);
      salida.push({ ...reg, asunto: reg.asunto.replace(PREFIJO_REENVIO, "") });
    } else {
      // Copia adicional del mismo pedido: si está gestionada y el
      // representante no, heredamos su estado (el pedido ya se cerró).
      const repr = salida[idx];
      const estaCerrada = ESTADOS_CERRADOS.has((reg.estado || "").toLowerCase());
      const reprCerrado = ESTADOS_CERRADOS.has((repr.estado || "").toLowerCase());
      if (estaCerrada && !reprCerrado) repr.estado = reg.estado;
    }
  }

  return salida;
}

export async function GET() {
  try {
    // Recuperamos todos los emails reconstruyendo el formato del Sheet.
    // Ordenados por fila_sheet_idx para mantener el orden original.
    const rows = (await sql`
      SELECT
        id::text AS id,
        gmail_message_id,
        (datos_extraidos->>'fila_sheet_idx')::int AS fila_sheet_idx,
        recibido_en,
        remitente_nombre,
        remitente_email,
        asunto,
        adjuntos_info,
        cuerpo,
        datos_extraidos->>'estado_legacy'    AS estado_legacy,
        datos_extraidos->>'tipo_legacy'      AS tipo_legacy,
        datos_extraidos->>'prioridad'        AS prioridad,
        datos_extraidos->>'autoDropdown'     AS auto_dropdown,
        datos_extraidos->>'respuestaAuto'    AS respuesta_auto,
        datos_extraidos->>'telefono'         AS telefono,
        datos_extraidos->>'estado_funcional' AS estado_funcional,
        datos_extraidos->>'estado_override'  AS estado_override,
        datos_extraidos->>'fuente'           AS fuente,
        tipo::text AS tipo_enum
      FROM emails
      WHERE NOT (
        -- Excluir la fila "legacy" (de Apps Script/Sheets) cuando ya existe
        -- su gemela escrita por el agente (mismo remitente + asunto + día).
        -- Así desaparecen los duplicados del periodo en que ambos sistemas
        -- funcionaban a la vez, sin borrar nada de la BD.
        gmail_message_id LIKE 'legacy-%'
        AND EXISTS (
          SELECT 1 FROM emails e2
          WHERE e2.gmail_message_id NOT LIKE 'legacy-%'
            AND e2.remitente_email = emails.remitente_email
            AND e2.asunto IS NOT DISTINCT FROM emails.asunto
            AND date(e2.recibido_en) = date(emails.recibido_en)
        )
      )
      ORDER BY recibido_en DESC NULLS LAST
    `) as unknown as FilaPostgres[];

    const registros: RegistroDashboard[] = rows.map((r) => {
      // Reconstruir el campo "quien" con el formato original
      let quien = r.remitente_nombre || "";
      if (r.remitente_email && !r.remitente_email.includes("desconocido.local")) {
        if (quien && quien !== r.remitente_email) {
          // Si tenemos nombre Y email distintos, formato '"Nombre" <email>'
          quien = `"${quien}" <${r.remitente_email}>`;
        } else if (!quien) {
          quien = r.remitente_email;
        }
      }

      // Enlace = primer adjunto (formato Sheet)
      let enlace = "";
      if (Array.isArray(r.adjuntos_info) && r.adjuntos_info.length > 0) {
        enlace = r.adjuntos_info[0].drive_url || "";
      }

      // Estado/tipo: prioridad de fuentes:
      //   1. estado_override → lo que Toni marcó manualmente (gana siempre)
      //   2. estado_legacy   → texto original de Apps Script
      //   3. derivado        → del tipo enum del agente
      let estado = r.estado_override || r.estado_legacy || "";
      let tipo = r.tipo_legacy || "";
      if (!estado || !tipo) {
        const derivado = derivarEstadoTipo(r.tipo_enum);
        if (!estado) estado = derivado.estado;
        if (!tipo) tipo = derivado.tipo;
      }

      return {
        id: r.id,
        fecha: r.recibido_en ? new Date(r.recibido_en).toString() : "",
        quien,
        asunto: r.asunto || "",
        enlace,
        cuerpo: r.cuerpo || "",
        estado,
        tipo,
        prioridad: r.prioridad || "",
        autoDropdown: r.auto_dropdown || "false",
        respuestaAuto: r.respuesta_auto || "",
        telefono: r.telefono || "",
      };
    });

    // Colapsar pedidos repetidos (original + reenvíos / mismo nº en días
    // distintos) en un único registro por número de pedido.
    const registrosAgrupados = agruparPedidosPorNumero(registros);

    return NextResponse.json({
      registros: registrosAgrupados,
      fuente: "postgres",
      total: registrosAgrupados.length,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "Error leyendo Postgres",
        details: err instanceof Error ? err.message : String(err),
        fuente: "postgres",
      },
      { status: 500 }
    );
  }
}
