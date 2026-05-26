import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

/**
 * Endpoint que sirve las clasificaciones del agente al dashboard.
 *
 * GET /api/agente/clasificaciones?limit=100&cuenta=...&tipo=...
 *
 * Devuelve:
 * {
 *   ok: true,
 *   filas: [ {hora, cuenta_destino, asunto, ...}, ... ],
 *   stats: {
 *     total, hoy, semana,
 *     vip, sql_pyme, escalados,
 *     coste_total_usd, coste_hoy_usd,
 *     latencia_media_ms, modelo_actual
 *   }
 * }
 *
 * No requiere autenticación porque solo lee (datos no sensibles para el dashboard).
 * Si hace falta, añadir verificación de session/cookie del usuario logueado.
 */

interface FilaClasificacion {
  id: number;
  created_at: string;
  cuenta_destino: string;
  asunto: string | null;
  remitente: string | null;
  fecha_recibido: string | null;
  tipo: string | null;
  prioridad: string | null;
  confianza: number | null;
  accion_sugerida: string | null;
  es_industriastak: boolean;
  es_autoenvio_sql_pyme: boolean;
  cuerpo_preview: string | null;
  modelo: string;
  coste_usd: number | null;
  latencia_ms: number | null;
  clasificacion: Record<string, unknown>;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "100", 10), 500);

  try {
    // Filas (ordenadas por más reciente)
    const filas = (await sql`
      SELECT
        id,
        created_at,
        cuenta_destino,
        asunto,
        remitente,
        fecha_recibido,
        tipo,
        prioridad,
        confianza,
        accion_sugerida,
        es_industriastak,
        es_autoenvio_sql_pyme,
        cuerpo_preview,
        modelo,
        coste_usd,
        latencia_ms,
        clasificacion
      FROM clasificaciones_agente
      ORDER BY created_at DESC
      LIMIT ${limit}
    `) as unknown as FilaClasificacion[];

    // Estadísticas agregadas
    const statsRows = await sql`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE) AS hoy,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') AS semana,
        COUNT(*) FILTER (WHERE es_industriastak) AS vip,
        COUNT(*) FILTER (WHERE es_autoenvio_sql_pyme) AS sql_pyme,
        COUNT(*) FILTER (WHERE accion_sugerida = 'escalar_a_humano') AS escalados,
        COUNT(*) FILTER (WHERE prioridad = 'alta') AS prio_alta,
        COALESCE(ROUND(SUM(coste_usd)::numeric, 4), 0) AS coste_total_usd,
        COALESCE(ROUND(SUM(coste_usd) FILTER (WHERE created_at >= CURRENT_DATE)::numeric, 4), 0) AS coste_hoy_usd,
        COALESCE(ROUND(AVG(latencia_ms)::numeric, 0), 0) AS latencia_media_ms,
        (SELECT modelo FROM clasificaciones_agente ORDER BY created_at DESC LIMIT 1) AS modelo_actual,
        MAX(created_at) AS ultima_clasificacion
      FROM clasificaciones_agente
    `;

    return NextResponse.json({
      ok: true,
      filas,
      stats: statsRows[0] ?? null,
    });
  } catch (err) {
    console.error("[agente/clasificaciones] error:", err);
    return NextResponse.json(
      {
        ok: false,
        error: "Error consultando clasificaciones",
        detalles: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
