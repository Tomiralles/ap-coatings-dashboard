import { NextRequest, NextResponse } from "next/server";
import { OAuth2Client } from "google-auth-library";
import { sql } from "@/lib/db";

/**
 * Endpoint Webhook para notificaciones push de Gmail vía Cloud Pub/Sub.
 *
 * Flujo:
 *   1. Gmail detecta un nuevo email en una de las cuentas vigiladas
 *   2. Publica un mensaje en el topic `gmail-notifications` de Pub/Sub
 *   3. Pub/Sub envía ese mensaje (push) a este endpoint
 *   4. Verificamos el token OIDC para asegurar que viene de Pub/Sub
 *   5. Registramos el evento en Postgres
 *   6. (Próximamente) Leemos el email con Gmail API y lo clasificamos
 *
 * Estructura del push de Pub/Sub:
 * {
 *   message: {
 *     data: base64({ emailAddress: "...", historyId: "..." }),
 *     messageId: "...",
 *     publishTime: "..."
 *   },
 *   subscription: "projects/.../subscriptions/..."
 * }
 *
 * IMPORTANTE: devolvemos 200 SIEMPRE que el push esté bien formado.
 * Si devolvemos 4xx/5xx, Pub/Sub reintenta con backoff exponencial.
 */

interface PubSubMessage {
  message: {
    data: string;
    messageId: string;
    publishTime: string;
    attributes?: Record<string, string>;
  };
  subscription: string;
}

interface GmailNotification {
  emailAddress: string;
  historyId: string;
}

const authClient = new OAuth2Client();

/**
 * Verifica que la petición viene firmada por Pub/Sub (OIDC).
 * Pub/Sub firma cada push con un JWT en el header Authorization.
 *
 * El campo `audience` del token debe coincidir con la URL del webhook
 * (configurada al crear la suscripción).
 */
async function verifyPubSubToken(req: NextRequest): Promise<{
  valid: boolean;
  email?: string;
  error?: string;
}> {
  // En desarrollo local podemos saltarnos la verificación
  if (process.env.SKIP_PUBSUB_AUTH === "true") {
    return { valid: true, email: "dev-mode" };
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { valid: false, error: "Falta header Authorization Bearer" };
  }

  const token = authHeader.substring(7);

  try {
    const ticket = await authClient.verifyIdToken({
      idToken: token,
      // No fijamos audience aquí porque puede variar; lo verificamos abajo
    });
    const payload = ticket.getPayload();
    if (!payload) return { valid: false, error: "Token sin payload" };
    if (payload.iss !== "https://accounts.google.com" &&
        payload.iss !== "accounts.google.com") {
      return { valid: false, error: "Issuer inválido: " + payload.iss };
    }
    return { valid: true, email: payload.email };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function POST(req: NextRequest) {
  // 1. Verificar token OIDC de Pub/Sub
  const authResult = await verifyPubSubToken(req);
  if (!authResult.valid) {
    console.error("[gmail/webhook] Token inválido:", authResult.error);
    // Devolvemos 401 para que la suscripción se reintente con un token fresco
    // Si fuera un atacante, igual le decimos no.
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  // 2. Parsear el body
  let body: PubSubMessage;
  try {
    body = await req.json();
  } catch {
    console.error("[gmail/webhook] Body inválido (no JSON)");
    // 200 para que Pub/Sub no reintente algo que nunca va a poder parsear
    return NextResponse.json({ ok: false, error: "Invalid body" });
  }

  if (!body.message?.data) {
    console.error("[gmail/webhook] Falta message.data");
    return NextResponse.json({ ok: false, error: "Missing message.data" });
  }

  // 3. Decodificar el mensaje (viene en base64)
  let notification: GmailNotification;
  try {
    const decoded = Buffer.from(body.message.data, "base64").toString("utf-8");
    notification = JSON.parse(decoded);
  } catch (err) {
    console.error("[gmail/webhook] No se puede decodificar message.data:", err);
    return NextResponse.json({ ok: false, error: "Invalid message data" });
  }

  if (!notification.emailAddress || !notification.historyId) {
    console.error("[gmail/webhook] Falta emailAddress o historyId");
    return NextResponse.json({ ok: false, error: "Missing fields" });
  }

  // 4. Registrar el evento en Postgres
  // (En una iteración posterior, aquí leeremos el email y lo procesaremos)
  try {
    await sql`
      INSERT INTO eventos (tipo, nivel, mensaje, detalles, ejecutado_por)
      VALUES (
        'gmail_notification',
        'info',
        ${`Notificación Gmail recibida para ${notification.emailAddress}`},
        ${JSON.stringify({
          emailAddress: notification.emailAddress,
          historyId: notification.historyId,
          messageId: body.message.messageId,
          publishTime: body.message.publishTime,
          subscription: body.subscription,
        })}::jsonb,
        'pubsub'
      )
    `;
  } catch (err) {
    console.error("[gmail/webhook] Error guardando evento en Postgres:", err);
    // Devolvemos 500 para que Pub/Sub reintente más tarde
    return NextResponse.json(
      { ok: false, error: "Database error" },
      { status: 500 }
    );
  }

  console.log(
    `[gmail/webhook] OK: ${notification.emailAddress} historyId=${notification.historyId}`
  );

  // 5. ACK al Pub/Sub
  return NextResponse.json({
    ok: true,
    emailAddress: notification.emailAddress,
    historyId: notification.historyId,
  });
}

/**
 * GET /api/gmail/webhook — endpoint informativo (para verificar que está vivo)
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    mensaje: "Endpoint webhook de Gmail Push activo. Solo acepta POST de Pub/Sub.",
  });
}
