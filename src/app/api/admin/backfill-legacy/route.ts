import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { escribirEnLegacy } from "@/lib/escribir-legacy";

/**
 * Endpoint admin para hacer "backfill" de las tablas legacy (clientes,
 * emails, pedidos) a partir de las clasificaciones que el agente ya tiene
 * guardadas en `clasificaciones_agente`.
 *
 * ¿Por qué existe?
 * Cuando Apps Script murió (~30 mayo) y antes de Fase 4A, el agente
 * estuvo clasificando emails en `clasificaciones_agente` pero NO escribía
 * en las tablas legacy. Resultado: el dashboard se quedó parado.
 *
 * Este endpoint procesa todas las clasificaciones que aún no tienen su
 * entrada correspondiente en `emails` y las escribe. Idempotente — se
 * puede ejecutar varias veces sin duplicar.
 *
 * GET  → dry-run (muestra cuántas filas harían backfill, sin escribir)
 * POST → ejecuta el backfill real (requiere CRON_SECRET)
 */

export const maxDuration = 60;

interface FilaPendiente {
  id: number;
  gmail_message_id: string;
  gmail_thread_id: string | null;
  asunto: string | null;
  remitente: string | null;
  fecha_recibido: string;
  cuerpo_preview: string | null;
  tiene_adjuntos: boolean;
  nombres_adjuntos: string[] | null;
  clasificacion: Record<string, unknown>;
}

function verificarCronSecret(req: NextRequest): boolean {
  if (process.env.SKIP_CRON_AUTH === "true") return true;
  const auth = req.headers.get("authorization");
  if (!auth) return false;
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  return (
    process.env.CRON_SECRET !== undefined &&
    process.env.CRON_SECRET.length > 0 &&
    auth === expected
  );
}

async function leerPendientes(limit: number): Promise<FilaPendiente[]> {
  return (await sql`
    SELECT
      c.id,
      c.gmail_message_id,
      c.gmail_thread_id,
      c.asunto,
      c.remitente,
      c.fecha_recibido,
      c.cuerpo_preview,
      c.tiene_adjuntos,
      c.nombres_adjuntos,
      c.clasificacion
    FROM clasificaciones_agente c
    WHERE NOT EXISTS (
      SELECT 1 FROM emails e WHERE e.gmail_message_id = c.gmail_message_id
    )
    ORDER BY c.created_at ASC
    LIMIT ${limit}
  `) as unknown as FilaPendiente[];
}

async function ejecutarBackfill(modo: "dry-run" | "ejecutar", limit: number) {
  const t0 = Date.now();
  const pendientes = await leerPendientes(limit);

  if (modo === "dry-run") {
    return {
      modo,
      pendientes: pendientes.length,
      muestra: pendientes.slice(0, 5).map((p) => ({
        gmail_message_id: p.gmail_message_id,
        asunto: p.asunto,
        fecha: p.fecha_recibido,
        tipo_agente:
          (p.clasificacion?.tipo as string | undefined) ?? "(sin tipo)",
      })),
      duracion_ms: Date.now() - t0,
    };
  }

  let ok = 0;
  let falla = 0;
  const errores: Array<{ gmail_message_id: string; error: string }> = [];

  for (const p of pendientes) {
    try {
      await escribirEnLegacy({
        gmail_message_id: p.gmail_message_id,
        gmail_thread_id: p.gmail_thread_id,
        asunto: p.asunto ?? "",
        remitente: p.remitente ?? "",
        cuerpo: p.cuerpo_preview ?? "", // solo tenemos preview en BD
        fecha_recibido:
          typeof p.fecha_recibido === "string"
            ? p.fecha_recibido
            : new Date(p.fecha_recibido).toISOString(),
        nombres_adjuntos: p.nombres_adjuntos ?? [],
        clasificacion: p.clasificacion ?? {},
      });
      ok++;
    } catch (err) {
      falla++;
      errores.push({
        gmail_message_id: p.gmail_message_id,
        error: err instanceof Error ? err.message : String(err),
      });
      // Cortamos si hay demasiados errores para no quemar minutos
      if (errores.length >= 10) break;
    }
  }

  return {
    modo,
    pendientes_total: pendientes.length,
    procesados_ok: ok,
    procesados_falla: falla,
    errores: errores.slice(0, 10),
    duracion_ms: Date.now() - t0,
  };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "500", 10), 1000);

  try {
    const r = await ejecutarBackfill("dry-run", limit);
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  if (!verificarCronSecret(req)) {
    return NextResponse.json(
      {
        ok: false,
        error: "Unauthorized. Falta header 'Authorization: Bearer <CRON_SECRET>'.",
      },
      { status: 401 }
    );
  }

  const { searchParams } = new URL(req.url);
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "500", 10), 1000);

  try {
    const r = await ejecutarBackfill("ejecutar", limit);
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
