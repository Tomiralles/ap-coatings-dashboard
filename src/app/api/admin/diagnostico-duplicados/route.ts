import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Diagnóstico de emails duplicados en la tabla `emails`.
 *
 * GET /api/admin/diagnostico-duplicados
 *
 * Un mismo email real puede existir dos veces:
 *   - Fila escrita por Apps Script/Sheets (gmail_message_id sintético "legacy-...")
 *   - Fila escrita por el agente (gmail_message_id real de Gmail)
 *
 * Agrupa por (remitente_email + asunto) y muestra los grupos con >1 fila.
 */
export async function GET() {
  try {
    const grupos = await sql`
      SELECT
        remitente_email,
        asunto,
        COUNT(*) AS n,
        array_agg(
          (CASE WHEN gmail_message_id LIKE 'legacy-%' THEN 'legacy' ELSE 'agente' END)
          || ':' || to_char(recibido_en, 'YYYY-MM-DD')
          ORDER BY recibido_en
        ) AS filas
      FROM emails
      GROUP BY remitente_email, asunto
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC
      LIMIT 50
    `;

    // Resumen global
    const resumen = await sql`
      SELECT
        COUNT(*) FILTER (WHERE gmail_message_id LIKE 'legacy-%') AS filas_legacy,
        COUNT(*) FILTER (WHERE gmail_message_id NOT LIKE 'legacy-%') AS filas_agente,
        COUNT(*) AS total
      FROM emails
    `;

    // Cuántos duplicados reales (mismo remitente+asunto con una legacy Y una agente)
    const dupMixtos = await sql`
      SELECT COUNT(*) AS grupos_mixtos
      FROM (
        SELECT remitente_email, asunto
        FROM emails
        GROUP BY remitente_email, asunto
        HAVING COUNT(*) FILTER (WHERE gmail_message_id LIKE 'legacy-%') > 0
           AND COUNT(*) FILTER (WHERE gmail_message_id NOT LIKE 'legacy-%') > 0
      ) t
    `;

    return NextResponse.json({
      ok: true,
      resumen: resumen[0],
      grupos_mixtos_legacy_y_agente: dupMixtos[0],
      grupos_duplicados: grupos,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
