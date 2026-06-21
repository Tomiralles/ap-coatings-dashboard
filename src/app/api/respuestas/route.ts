import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

/**
 * Cola de respuestas pendientes de aprobación — ahora en PostgreSQL (Neon).
 *
 * Antes vivía en Google Sheets (Cola_Respuestas) vía Apps Script. Como
 * Apps Script está fuera de servicio, se migró a Postgres: así leer,
 * crear, aprobar y rechazar funcionan sin depender de Sheets.
 *
 * GET /api/respuestas → devuelve las respuestas pendientes y auto-aprobadas.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

export interface RespuestaPendiente {
  id: string;
  fechaCreacion: string;
  tipo: "email" | "whatsapp";
  rowOrigen: string;
  destinatario: string;
  asunto: string;
  threadId: string;
  borrador: string;
  estado: "pendiente" | "aprobado" | "rechazado" | "auto-aprobado";
  enviadoEn: string;
  contextoJson: string;
  autoEnviado?: boolean;
}

interface FilaCola {
  id: string;
  fecha_creacion: Date | null;
  tipo: string;
  row_origen: string | null;
  destinatario: string;
  asunto: string | null;
  thread_id: string | null;
  borrador: string;
  estado: string;
  enviado_en: Date | null;
  contexto_json: string | null;
  auto_enviado: boolean | null;
}

export async function GET() {
  try {
    const rows = (await sql`
      SELECT
        id, fecha_creacion, tipo, row_origen, destinatario, asunto,
        thread_id, borrador, estado, enviado_en, contexto_json, auto_enviado
      FROM cola_respuestas
      WHERE estado IN ('pendiente', 'auto-aprobado')
      ORDER BY created_at DESC
    `) as unknown as FilaCola[];

    const respuestas: RespuestaPendiente[] = rows.map((r) => ({
      id: r.id,
      fechaCreacion: r.fecha_creacion ? new Date(r.fecha_creacion).toISOString() : "",
      tipo: (r.tipo === "whatsapp" ? "whatsapp" : "email") as "email" | "whatsapp",
      rowOrigen: r.row_origen ?? "",
      destinatario: r.destinatario ?? "",
      asunto: r.asunto ?? "",
      threadId: r.thread_id ?? "",
      borrador: r.borrador ?? "",
      estado: (r.estado ?? "pendiente") as RespuestaPendiente["estado"],
      enviadoEn: r.enviado_en ? new Date(r.enviado_en).toISOString() : "",
      contextoJson: r.contexto_json ?? "",
      autoEnviado: r.auto_enviado ?? false,
    }));

    return NextResponse.json({ respuestas });
  } catch (err) {
    return NextResponse.json(
      { error: "Error leyendo cola_respuestas", details: String(err) },
      { status: 500 }
    );
  }
}
