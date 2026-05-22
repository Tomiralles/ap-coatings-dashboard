import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

/**
 * Estadísticas de los datos en Postgres.
 *
 * GET /api/db-stats
 *
 * Devuelve un resumen útil tras la migración:
 *   - Conteos por tabla
 *   - Top clientes por número de emails
 *   - Distribución por tipo de email
 *   - Distribución por dominio
 *   - Últimos pedidos detectados
 */
export async function GET() {
  try {
    const [
      totales,
      topClientes,
      porTipo,
      porDominio,
      ultimosPedidos,
      industriastak,
    ] = await Promise.all([
      sql`
        SELECT
          (SELECT COUNT(*) FROM clientes)::int AS clientes,
          (SELECT COUNT(*) FROM clientes WHERE es_vip = true)::int AS vips,
          (SELECT COUNT(*) FROM emails)::int AS emails,
          (SELECT COUNT(*) FROM pedidos)::int AS pedidos
      `,
      sql`
        SELECT
          c.email,
          COALESCE(c.empresa, '-') AS empresa,
          c.es_vip,
          COUNT(e.id)::int AS num_emails
        FROM clientes c
        LEFT JOIN emails e ON e.cliente_id = c.id
        GROUP BY c.id, c.email, c.empresa, c.es_vip
        ORDER BY num_emails DESC, c.email
        LIMIT 10
      `,
      sql`
        SELECT tipo::text, COUNT(*)::int AS total
        FROM emails
        GROUP BY tipo
        ORDER BY total DESC
      `,
      sql`
        SELECT
          SPLIT_PART(remitente_email, '@', 2) AS dominio,
          COUNT(*)::int AS total
        FROM emails
        GROUP BY dominio
        ORDER BY total DESC
        LIMIT 10
      `,
      sql`
        SELECT
          p.numero_externo,
          p.fecha_pedido,
          c.email AS cliente_email,
          c.empresa AS cliente_empresa
        FROM pedidos p
        LEFT JOIN clientes c ON c.id = p.cliente_id
        ORDER BY p.fecha_pedido DESC NULLS LAST
        LIMIT 10
      `,
      sql`
        SELECT email, nombre, empresa
        FROM clientes
        WHERE es_industriastak = true
      `,
    ]);

    return NextResponse.json({
      ok: true,
      totales: totales[0],
      top_clientes: topClientes,
      por_tipo: porTipo,
      por_dominio: porDominio,
      ultimos_pedidos: ultimosPedidos,
      industriastak,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
