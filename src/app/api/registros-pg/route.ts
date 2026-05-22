import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

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
}

export async function GET() {
  try {
    // Recuperamos todos los emails reconstruyendo el formato del Sheet.
    // Ordenados por fila_sheet_idx para mantener el orden original.
    const rows = (await sql`
      SELECT
        (datos_extraidos->>'fila_sheet_idx')::int AS fila_sheet_idx,
        recibido_en,
        remitente_nombre,
        remitente_email,
        asunto,
        adjuntos_info,
        cuerpo,
        datos_extraidos->>'estado_legacy' AS estado_legacy,
        datos_extraidos->>'tipo_legacy'   AS tipo_legacy,
        datos_extraidos->>'prioridad'     AS prioridad,
        datos_extraidos->>'autoDropdown'  AS auto_dropdown,
        datos_extraidos->>'respuestaAuto' AS respuesta_auto,
        datos_extraidos->>'telefono'      AS telefono,
        tipo::text AS tipo_enum
      FROM emails
      ORDER BY fila_sheet_idx NULLS LAST, recibido_en
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

      return {
        fecha: r.recibido_en ? new Date(r.recibido_en).toString() : "",
        quien,
        asunto: r.asunto || "",
        enlace,
        cuerpo: r.cuerpo || "",
        estado: r.estado_legacy || "",  // Texto original del Sheet
        tipo: r.tipo_legacy || "",      // Texto original del Sheet
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
