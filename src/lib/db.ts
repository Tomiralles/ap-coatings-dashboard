/**
 * Cliente de PostgreSQL para conectar con Neon.
 *
 * Usa @neondatabase/serverless, optimizado para Vercel serverless functions
 * (conexiones HTTP, sin necesidad de pool persistente).
 *
 * Las variables de entorno DATABASE_URL y DATABASE_URL_UNPOOLED son
 * inyectadas automáticamente por la integración Neon-Vercel.
 *
 * - DATABASE_URL          → conexión con pool (queries normales)
 * - DATABASE_URL_UNPOOLED → conexión directa (migraciones, transacciones largas)
 */

import { neon, neonConfig } from "@neondatabase/serverless";

// Configurar el driver para usar fetch nativo (compatible con Edge runtime)
neonConfig.fetchConnectionCache = true;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL no está definida. Verifica la integración Neon-Vercel."
  );
}

/**
 * Cliente principal de Postgres con pool.
 * Úsalo para queries normales (SELECT, INSERT, UPDATE).
 *
 * Ejemplo:
 *   const rows = await sql`SELECT * FROM clientes WHERE es_vip = true`;
 */
export const sql = neon(process.env.DATABASE_URL);

/**
 * Cliente directo sin pool, para operaciones largas.
 * Úsalo solo para migraciones o transacciones complejas.
 */
export const sqlDirect = neon(
  process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
);

/**
 * Verifica que la conexión a la BD funciona.
 * Retorna info básica: versión de Postgres y nombre de la BD.
 */
export async function testConnection() {
  const result = await sql`
    SELECT
      current_database() as database,
      version() as postgres_version,
      current_timestamp as server_time
  `;
  return result[0];
}

/**
 * Cuenta el número de filas de las tablas principales.
 * Útil para verificar el estado de la migración.
 */
export async function countAllTables() {
  const result = await sql`
    SELECT
      (SELECT COUNT(*) FROM clientes) as clientes,
      (SELECT COUNT(*) FROM emails) as emails,
      (SELECT COUNT(*) FROM pedidos) as pedidos,
      (SELECT COUNT(*) FROM respuestas) as respuestas,
      (SELECT COUNT(*) FROM eventos) as eventos,
      (SELECT COUNT(*) FROM config) as config,
      (SELECT COUNT(*) FROM documentos_drive) as documentos_drive
  `;
  return result[0];
}
