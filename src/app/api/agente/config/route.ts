import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Configuración del agente (toggle de auto-respuesta + parámetros).
 *
 * GET  /api/agente/config
 *   → devuelve el estado actual desde la tabla `config` (clave 'agent_auto_reply')
 *
 * POST /api/agente/config
 *   body: { enabled?: boolean, min_confianza?: number }
 *   → actualiza el valor. No requiere CRON_SECRET porque es el usuario
 *     logueado el que mueve el toggle desde el dashboard. (Si en el futuro
 *     hay login/sesiones, añadir comprobación aquí.)
 *
 * Diseño deliberado: por defecto está APAGADO. Hay que activarlo
 * explícitamente desde el dashboard para que el agente envíe nada.
 */

interface AgentConfig {
  enabled: boolean;
  min_confianza: number;
}

const DEFAULT_CONFIG: AgentConfig = {
  enabled: false,
  min_confianza: 0.9,
};

async function leerConfig(): Promise<AgentConfig> {
  const rows = await sql`
    SELECT valor FROM config WHERE clave = 'agent_auto_reply' LIMIT 1
  `;
  if (rows.length === 0) {
    return DEFAULT_CONFIG;
  }
  const v = rows[0].valor as Partial<AgentConfig> | undefined;
  return {
    enabled: typeof v?.enabled === "boolean" ? v.enabled : DEFAULT_CONFIG.enabled,
    min_confianza:
      typeof v?.min_confianza === "number"
        ? v.min_confianza
        : DEFAULT_CONFIG.min_confianza,
  };
}

export async function GET() {
  try {
    const config = await leerConfig();

    // Stats útiles para mostrar en el dashboard junto al toggle
    const stats = await sql`
      SELECT
        COUNT(*) FILTER (WHERE enviado_ok AND created_at >= CURRENT_DATE) AS enviadas_hoy,
        COUNT(*) FILTER (WHERE enviado_ok AND created_at >= NOW() - INTERVAL '7 days') AS enviadas_semana,
        COUNT(*) FILTER (WHERE enviado_ok) AS enviadas_total,
        COUNT(*) FILTER (WHERE NOT enviado_ok) AS fallidas_total,
        MAX(created_at) FILTER (WHERE enviado_ok) AS ultima_enviada
      FROM respuestas_auto_enviadas
    `;

    return NextResponse.json({
      ok: true,
      config,
      stats: stats[0] ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  let body: Partial<AgentConfig>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Body inválido (no JSON)" },
      { status: 400 }
    );
  }

  const actual = await leerConfig();
  const nuevo: AgentConfig = {
    enabled:
      typeof body.enabled === "boolean" ? body.enabled : actual.enabled,
    min_confianza:
      typeof body.min_confianza === "number" &&
      body.min_confianza >= 0 &&
      body.min_confianza <= 1
        ? body.min_confianza
        : actual.min_confianza,
  };

  try {
    await sql`
      INSERT INTO config (clave, valor, descripcion, actualizado_por, actualizado_en)
      VALUES (
        'agent_auto_reply',
        ${JSON.stringify(nuevo)}::jsonb,
        'Toggle ON/OFF + parametros para auto-respuesta del agente.',
        'dashboard',
        NOW()
      )
      ON CONFLICT (clave) DO UPDATE SET
        valor = EXCLUDED.valor,
        actualizado_por = EXCLUDED.actualizado_por,
        actualizado_en = EXCLUDED.actualizado_en
    `;

    // Registrar el evento para auditoría
    await sql`
      INSERT INTO eventos (tipo, nivel, mensaje, detalles, ejecutado_por)
      VALUES (
        'agent_config_cambiado',
        'info',
        ${`Toggle auto-respuesta: ${nuevo.enabled ? "ENCENDIDO" : "APAGADO"}`},
        ${JSON.stringify({ anterior: actual, nuevo })}::jsonb,
        'usuario_dashboard'
      )
    `.catch(() => null);

    return NextResponse.json({ ok: true, config: nuevo });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
