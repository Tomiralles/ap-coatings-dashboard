import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

/**
 * Crea una respuesta en la cola (Postgres).
 *
 * POST /api/respuestas/crear
 *   body: { tipo, rowOrigen, destinatario, asunto, threadId, borrador,
 *           contextoJson, auto }
 *
 * Si auto === true → estado 'auto-aprobado' (se procesó sin intervención).
 * Si no → estado 'pendiente' (espera aprobación manual).
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { tipo, rowOrigen, destinatario, asunto, threadId, borrador, contextoJson, auto } = body;

    if (!tipo || !destinatario || !borrador) {
      return NextResponse.json(
        { error: "Faltan parámetros: tipo, destinatario, borrador" },
        { status: 400 }
      );
    }

    const estado = auto === true ? "auto-aprobado" : "pendiente";

    const result = await sql`
      INSERT INTO cola_respuestas (
        id, tipo, row_origen, destinatario, asunto, thread_id,
        borrador, estado, contexto_json, auto_enviado
      )
      VALUES (
        gen_random_uuid()::text,
        ${tipo},
        ${rowOrigen ?? ""},
        ${destinatario},
        ${asunto ?? ""},
        ${threadId ?? ""},
        ${borrador},
        ${estado},
        ${contextoJson ?? ""},
        ${auto === true}
      )
      RETURNING id
    `;

    return NextResponse.json({ ok: true, id: result[0].id, estado });
  } catch (err) {
    return NextResponse.json({ error: "Error interno", details: String(err) }, { status: 500 });
  }
}
