import { sql } from "@/lib/db";

const WA_API_VERSION = process.env.WHATSAPP_API_VERSION ?? "v21.0";

// ─────────────────────────────────────────────
//  Tipos
// ─────────────────────────────────────────────

export interface ClienteWhatsApp {
  id: number;
  slug: string;
  nombre: string;
  phone_number_id: string;
  access_token: string;
  template_name: string;
  template_language: string;
  activo: boolean;
}

// ─────────────────────────────────────────────
//  Obtener credenciales de un cliente
// ─────────────────────────────────────────────

export async function getClienteWA(slug: string): Promise<ClienteWhatsApp | null> {
  const rows = await sql`
    SELECT * FROM clientes_whatsapp
    WHERE slug = ${slug} AND activo = true
    LIMIT 1
  `;
  return (rows[0] as ClienteWhatsApp) ?? null;
}

// ─────────────────────────────────────────────
//  Envío de mensajes
// ─────────────────────────────────────────────

/**
 * Envía notificación con plantilla aprobada.
 * Funciona siempre, incluso fuera de la ventana de 24h.
 *
 * @param clienteSlug  identificador del cliente, ej: "taller-garcia"
 * @param to           teléfono del destinatario con prefijo, ej: "34612345678"
 * @param clientName   nombre del cliente final (para personalizar la plantilla)
 * @param orderName    nombre del pedido/cita
 */
export async function sendWhatsAppNotification(
  clienteSlug: string,
  to: string,
  clientName: string,
  orderName: string
) {
  const creds = await getClienteWA(clienteSlug);
  if (!creds) return { ok: false, error: `Cliente '${clienteSlug}' no encontrado o inactivo` };

  const payload = {
    messaging_product: "whatsapp",
    to: cleanPhone(to),
    type: "template",
    template: {
      name: creds.template_name,
      language: { code: creds.template_language },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: clientName || "compañero" },
            { type: "text", text: orderName || "" },
          ],
        },
      ],
    },
  };

  return sendRequest(creds.phone_number_id, creds.access_token, payload);
}

/**
 * Envía mensaje de texto libre.
 * Solo funciona dentro de la ventana de 24h tras el último mensaje del usuario.
 *
 * @param clienteSlug  identificador del cliente, ej: "taller-garcia"
 * @param to           teléfono del destinatario
 * @param text         texto del mensaje
 */
export async function sendWhatsAppFreeform(
  clienteSlug: string,
  to: string,
  text: string
) {
  const creds = await getClienteWA(clienteSlug);
  if (!creds) return { ok: false, error: `Cliente '${clienteSlug}' no encontrado o inactivo` };

  const payload = {
    messaging_product: "whatsapp",
    to: cleanPhone(to),
    type: "text",
    text: { body: text },
  };

  return sendRequest(creds.phone_number_id, creds.access_token, payload);
}

// ─────────────────────────────────────────────
//  Compatibilidad con el código existente (1 solo cliente vía env vars)
//  Úsalo solo mientras migras — en producción usa las funciones de arriba.
// ─────────────────────────────────────────────

export async function sendWhatsAppNotificationLegacy(to: string, clientName: string, orderName: string) {
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const templateName = process.env.WHATSAPP_TEMPLATE_NAME;

  if (!phoneId || !token || !templateName) {
    return { ok: false, error: "Credentials missing (legacy)" };
  }

  const payload = {
    messaging_product: "whatsapp",
    to: cleanPhone(to),
    type: "template",
    template: {
      name: templateName,
      language: { code: "es" },
      components: [
        {
          type: "body",
          parameters: [{ type: "text", text: clientName || "compañero" }],
        },
      ],
    },
  };

  return sendRequest(phoneId, token, payload);
}

// ─────────────────────────────────────────────
//  Internos
// ─────────────────────────────────────────────

function cleanPhone(to: string) {
  return to.replace(/\D/g, "");
}

async function sendRequest(phoneId: string, token: string, payload: object) {
  const url = `https://graph.facebook.com/${WA_API_VERSION}/${phoneId}/messages`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok) {
      const errorCode = data?.error?.code;
      const errorMsg = data?.error?.message ?? "Unknown error";
      if (errorCode === 190) {
        console.error("[whatsapp] TOKEN_INVALID:", errorMsg);
        return { ok: false, error: "TOKEN_INVALID", details: errorMsg };
      }
      console.error("[whatsapp] API Error:", errorCode, errorMsg);
      return { ok: false, error: errorMsg };
    }

    return { ok: true, data };
  } catch (error) {
    console.error("[whatsapp] Request Error:", error);
    return { ok: false, error: String(error) };
  }
}
