import { NextResponse } from "next/server";
import { getGmailClient, getServiceAccountProjectId } from "@/lib/google-auth";
import { sql } from "@/lib/db";
import { CUENTAS_VIGILADAS } from "@/lib/cuentas-vigiladas";

/**
 * Endpoint admin para activar las suscripciones Watch en las 4 cuentas Gmail.
 *
 * POST /api/gmail/watch-setup
 *
 * Para cada cuenta del dominio Workspace:
 *   1. Llama a gmail.users.watch() pidiendo que las notificaciones se
 *      publiquen en el topic `gmail-notifications` de Pub/Sub.
 *   2. Solo notifica cambios en la etiqueta INBOX (no enviados, no spam).
 *   3. Guarda el historyId inicial en Postgres para poder consultar
 *      cambios desde ese punto.
 *
 * IMPORTANTE: las watches expiran cada 7 días. Hay que renovarlas
 * con un cron diario (lo haremos en un endpoint aparte).
 *
 * Este endpoint es idempotente: si una watch ya existe, llama de nuevo
 * y la sustituye (Gmail solo permite una watch por usuario).
 */

// Lista centralizada (ver src/lib/cuentas-vigiladas.ts).
// Antes era una copia manual de 4 alias; ahora solo tomiralles@.
const CUENTAS_A_VIGILAR = CUENTAS_VIGILADAS;

const TOPIC_NAME = "gmail-notifications";

interface WatchResultado {
  cuenta: string;
  ok: boolean;
  history_id?: string;
  expiration?: string; // ISO string
  error?: string;
}

export async function POST() {
  const projectId = getServiceAccountProjectId();
  const topicFullName = `projects/${projectId}/topics/${TOPIC_NAME}`;

  const resultados: WatchResultado[] = [];

  for (const cuenta of CUENTAS_A_VIGILAR) {
    try {
      const gmail = await getGmailClient(cuenta);

      const watchResp = await gmail.users.watch({
        userId: "me",
        requestBody: {
          topicName: topicFullName,
          labelIds: ["INBOX"], // solo emails entrantes
          labelFilterBehavior: "INCLUDE",
        },
      });

      const historyId = watchResp.data.historyId
        ? String(watchResp.data.historyId)
        : undefined;
      const expirationMs = watchResp.data.expiration
        ? Number(watchResp.data.expiration)
        : undefined;
      const expirationIso = expirationMs
        ? new Date(expirationMs).toISOString()
        : undefined;

      // Guardar/actualizar el estado de la watch en config para poder
      // consultarlo después y saber cuándo renovar
      await sql`
        INSERT INTO config (clave, valor, descripcion, actualizado_por, actualizado_en)
        VALUES (
          ${`gmail_watch:${cuenta}`},
          ${JSON.stringify({
            history_id: historyId,
            expiration: expirationIso,
            topic: topicFullName,
            activated_at: new Date().toISOString(),
          })}::jsonb,
          ${`Suscripción Watch de Gmail para ${cuenta}`},
          'sistema',
          NOW()
        )
        ON CONFLICT (clave) DO UPDATE
          SET valor = EXCLUDED.valor,
              actualizado_por = EXCLUDED.actualizado_por,
              actualizado_en = EXCLUDED.actualizado_en
      `;

      await sql`
        INSERT INTO eventos (tipo, nivel, mensaje, detalles, ejecutado_por)
        VALUES (
          'gmail_watch_activated',
          'info',
          ${`Gmail Watch activada para ${cuenta}`},
          ${JSON.stringify({
            cuenta,
            history_id: historyId,
            expiration: expirationIso,
            topic: topicFullName,
          })}::jsonb,
          'admin'
        )
      `;

      resultados.push({
        cuenta,
        ok: true,
        history_id: historyId,
        expiration: expirationIso,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[watch-setup] Error en ${cuenta}:`, msg);

      await sql`
        INSERT INTO eventos (tipo, nivel, mensaje, detalles, ejecutado_por)
        VALUES (
          'gmail_watch_error',
          'error',
          ${`Error activando Gmail Watch para ${cuenta}`},
          ${JSON.stringify({ cuenta, error: msg })}::jsonb,
          'admin'
        )
      `.catch(() => null);

      resultados.push({ cuenta, ok: false, error: msg });
    }
  }

  const todasOk = resultados.every((r) => r.ok);

  return NextResponse.json({
    ok: todasOk,
    topic: topicFullName,
    cuentas: resultados,
    mensaje: todasOk
      ? "Todas las watches activadas. Próxima renovación necesaria en 7 días."
      : "Hay cuentas con error - revisa Domain-Wide Delegation y permisos del topic.",
  });
}

/**
 * GET /api/gmail/watch-setup
 * Devuelve el estado actual de las watches (sin activar nada nuevo).
 */
export async function GET() {
  const result = await sql`
    SELECT clave, valor, actualizado_en
    FROM config
    WHERE clave LIKE 'gmail_watch:%'
    ORDER BY clave
  `;

  const cuentas = result.map((row) => ({
    cuenta: String(row.clave).replace("gmail_watch:", ""),
    valor: row.valor,
    actualizado_en: row.actualizado_en,
  }));

  return NextResponse.json({
    ok: true,
    cuentas_vigiladas_esperadas: CUENTAS_A_VIGILAR,
    cuentas_con_watch_registrada: cuentas,
  });
}
