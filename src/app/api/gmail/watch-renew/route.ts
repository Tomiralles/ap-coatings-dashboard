import { NextRequest, NextResponse } from "next/server";
import { getGmailClient, getServiceAccountProjectId } from "@/lib/google-auth";
import { sql } from "@/lib/db";

/**
 * Endpoint para renovar las Gmail Watches automáticamente.
 *
 * Llamado por Vercel Cron cada día a las 03:00 (configurado en vercel.json).
 *
 * Gmail Watch expira cada 7 días. Si llamamos a users.watch() de nuevo,
 * Gmail reemplaza la watch anterior por una nueva con 7 días de validez.
 *
 * GET /api/gmail/watch-renew
 *
 * Vercel Cron envía automáticamente un header `Authorization: Bearer <CRON_SECRET>`
 * si la variable CRON_SECRET está configurada. Si no, cualquiera puede llamar
 * el endpoint (es idempotente y no peligroso, pero mejor protegerlo).
 */

const CUENTAS_A_RENOVAR = [
  "abadpinturas@abadpinturas.com",
  "ventas@apcoatings.net",
  "logistica@apcoatings.net",
  "administracion@apcoatings.net",
];

const TOPIC_NAME = "gmail-notifications";

interface RenewResultado {
  cuenta: string;
  ok: boolean;
  history_id?: string;
  expiration?: string;
  error?: string;
}

/**
 * Verifica que la petición es del cron de Vercel.
 * Si CRON_SECRET no está definida, permite cualquier llamada (más relajado).
 */
function verifyCronAuth(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // sin secret = libre acceso

  const authHeader = req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) return false;

  return authHeader.substring(7) === secret;
}

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const projectId = getServiceAccountProjectId();
  const topicFullName = `projects/${projectId}/topics/${TOPIC_NAME}`;

  const resultados: RenewResultado[] = [];

  for (const cuenta of CUENTAS_A_RENOVAR) {
    try {
      const gmail = await getGmailClient(cuenta);

      const watchResp = await gmail.users.watch({
        userId: "me",
        requestBody: {
          topicName: topicFullName,
          labelIds: ["INBOX"],
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

      // Actualizar config
      await sql`
        INSERT INTO config (clave, valor, descripcion, actualizado_por, actualizado_en)
        VALUES (
          ${`gmail_watch:${cuenta}`},
          ${JSON.stringify({
            history_id: historyId,
            expiration: expirationIso,
            topic: topicFullName,
            renewed_at: new Date().toISOString(),
          })}::jsonb,
          ${`Gmail Watch (renovada) para ${cuenta}`},
          'cron',
          NOW()
        )
        ON CONFLICT (clave) DO UPDATE
          SET valor = EXCLUDED.valor,
              actualizado_por = EXCLUDED.actualizado_por,
              actualizado_en = EXCLUDED.actualizado_en
      `;

      resultados.push({
        cuenta,
        ok: true,
        history_id: historyId,
        expiration: expirationIso,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      resultados.push({ cuenta, ok: false, error: msg });
    }
  }

  // Loggear cada ejecución
  const okCount = resultados.filter((r) => r.ok).length;
  const errCount = resultados.length - okCount;

  await sql`
    INSERT INTO eventos (tipo, nivel, mensaje, detalles, ejecutado_por)
    VALUES (
      'gmail_watch_renewed',
      ${errCount > 0 ? "warning" : "info"},
      ${`Cron renovó watches: ${okCount} OK, ${errCount} error`},
      ${JSON.stringify({ resultados, topic: topicFullName })}::jsonb,
      'cron'
    )
  `.catch(() => null);

  return NextResponse.json({
    ok: errCount === 0,
    renovadas: okCount,
    fallidas: errCount,
    resultados,
    siguiente_renovacion: "Mañana a las 03:00 UTC",
  });
}
