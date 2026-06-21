import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

/**
 * Importación one-time de la Cola_Respuestas de Sheets → Postgres.
 *
 * GET /api/admin/importar-cola
 *
 * Lee las respuestas que aún están en el Sheet (vía Apps Script o Sheets API)
 * y las inserta en cola_respuestas. Idempotente: usa el id original del
 * Sheet como PK, ON CONFLICT DO NOTHING.
 *
 * Tras esto, las 19 (o las que haya) pendientes aparecen en Postgres y
 * se pueden aprobar/rechazar de verdad.
 */

export const dynamic = "force-dynamic";

const SPREADSHEET_ID = "1AwQRGxXeIWIN5ODjvDbbjNGCB-UQ8UdEPZUpuoHKzvE";
const SHEET_NAME = "Cola_Respuestas";

interface FilaSheet {
  id: string;
  fechaCreacion: string;
  tipo: string;
  rowOrigen: string;
  destinatario: string;
  asunto: string;
  threadId: string;
  borrador: string;
  estado: string;
  enviadoEn: string;
  contextoJson: string;
  autoEnviado: boolean;
}

async function leerDesdeSheets(): Promise<FilaSheet[]> {
  // Intentar Apps Script primero
  const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
  let rows: string[][] | null = null;

  if (scriptUrl) {
    try {
      const res = await fetch(
        `${scriptUrl}?accion=leerHoja&hoja=${encodeURIComponent(SHEET_NAME)}`,
        { method: "GET", redirect: "follow", cache: "no-store" }
      );
      const data = await res.json();
      if (data.ok && data.values) rows = data.values;
    } catch { /* fallback abajo */ }
  }

  // Fallback: Sheets API
  if (!rows) {
    const apiKey = process.env.GOOGLE_SHEETS_API_KEY;
    if (!apiKey) throw new Error("Ni Apps Script ni Sheets API disponibles");
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(SHEET_NAME)}?key=${apiKey}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Sheets API HTTP ${res.status}`);
    const data = await res.json();
    rows = data.values ?? [];
  }

  if (!rows || rows.length < 2) return [];

  return rows.slice(1).map((row, idx) => ({
    id: row[0] || `sheet-${idx}`,
    fechaCreacion: row[1] ?? "",
    tipo: row[2] ?? "email",
    rowOrigen: row[3] ?? "",
    destinatario: row[4] ?? "",
    asunto: row[5] ?? "",
    threadId: row[6] ?? "",
    borrador: row[7] ?? "",
    estado: row[8] ?? "pendiente",
    enviadoEn: row[9] ?? "",
    contextoJson: row[10] ?? "",
    autoEnviado: (row[11] ?? "false").toLowerCase() === "true",
  }));
}

export async function GET() {
  try {
    const filas = await leerDesdeSheets();
    let insertadas = 0;
    let saltadas = 0;

    for (const f of filas) {
      if (!f.destinatario || !f.borrador) {
        saltadas++;
        continue;
      }
      const res = await sql`
        INSERT INTO cola_respuestas (
          id, tipo, row_origen, destinatario, asunto, thread_id,
          borrador, estado, contexto_json, auto_enviado
        )
        VALUES (
          ${f.id},
          ${f.tipo === "whatsapp" ? "whatsapp" : "email"},
          ${f.rowOrigen},
          ${f.destinatario},
          ${f.asunto},
          ${f.threadId},
          ${f.borrador},
          ${f.estado || "pendiente"},
          ${f.contextoJson},
          ${f.autoEnviado}
        )
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      `;
      if (res.length > 0) insertadas++;
      else saltadas++;
    }

    return NextResponse.json({
      ok: true,
      total_leidas_sheet: filas.length,
      insertadas,
      saltadas_o_duplicadas: saltadas,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err) },
      { status: 500 }
    );
  }
}
