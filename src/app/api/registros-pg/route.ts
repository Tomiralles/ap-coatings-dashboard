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
      ORDER BY recibido_en DESC NULLS LAST
    `) as unknown as FilaPostgres[];

    const registros = rows.map((r) => {
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

    return NextResponse.json({
      registros,
      fuente: "postgres",
      total: registros.length,
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
