import { NextResponse } from "next/server";
import { testConnection, countAllTables } from "@/lib/db";

/**
 * Endpoint de verificación de la conexión a Neon Postgres.
 *
 * GET /api/db-test
 *
 * Devuelve:
 *   - Estado de la conexión
 *   - Versión de Postgres
 *   - Conteo de filas en cada tabla
 *
 * Si la conexión falla, devuelve 500 con el error.
 */
export async function GET() {
  try {
    const connInfo = await testConnection();
    const counts = await countAllTables();

    return NextResponse.json({
      ok: true,
      conexion: {
        database: connInfo.database,
        postgres_version: connInfo.postgres_version,
        server_time: connInfo.server_time,
      },
      tablas: counts,
      mensaje: "Conexión a Neon Postgres OK",
    });
  } catch (err) {
    console.error("Error conectando a Postgres:", err);
    return NextResponse.json(
      {
        ok: false,
        error: "Error conectando a Postgres",
        detalles: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
