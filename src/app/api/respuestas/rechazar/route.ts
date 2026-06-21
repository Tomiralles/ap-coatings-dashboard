import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

/**
 * Rechaza (borra) una respuesta de la cola.
 *
 * POST /api/respuestas/rechazar  body: { id }
 *
 * Marca la respuesta como 'rechazado'. Al dejar de estar en
 * ('pendiente','auto-aprobado'), desaparece de la lista que ve el
 * dashboard. Esto SÍ funciona ahora (Postgres), antes fallaba porque
 * escribía en Apps Script (fuera de servicio).
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const id = body?.id;

    if (!id) {
      return NextResponse.json({ error: "Falta parámetro: id" }, { status: 400 });
    }

    const result = await sql`
      UPDATE cola_respuestas
      SET estado = 'rechazado'
      WHERE id = ${id}
      RETURNING id
    `;

    if (result.length === 0) {
      return NextResponse.json(
        { error: "No se encontró la respuesta con ese id", id },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true, id });
  } catch (err) {
    return NextResponse.json({ error: "Error interno", details: String(err) }, { status: 500 });
  }
}
