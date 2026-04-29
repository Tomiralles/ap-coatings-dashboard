const WA_API_VERSION = process.env.WHATSAPP_API_VERSION ?? "v21.0";

function getCredentials() {
  return {
    phoneId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    token: process.env.WHATSAPP_ACCESS_TOKEN,
    templateName: process.env.WHATSAPP_TEMPLATE_NAME,
  };
}

function cleanPhone(to: string) {
  return to.replace(/\D/g, "");
}

/** Envía una notificación usando el template aprobado (funciona siempre, fuera de ventana 24h) */
export async function sendWhatsAppNotification(to: string, clientName: string, orderName: string) {
  const { phoneId, token, templateName } = getCredentials();

  if (!phoneId || !token || !templateName) {
    console.error("[whatsapp] Credentials not configured");
    return { ok: false, error: "Credentials missing" };
  }

  const url = `https://graph.facebook.com/${WA_API_VERSION}/${phoneId}/messages`;

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

  return sendRequest(url, token, payload);
}

/** Envía un mensaje de texto libre (solo dentro de la ventana de atención de 24h) */
export async function sendWhatsAppFreeform(to: string, text: string) {
  const { phoneId, token } = getCredentials();

  if (!phoneId || !token) {
    console.error("[whatsapp] Credentials not configured");
    return { ok: false, error: "Credentials missing" };
  }

  const url = `https://graph.facebook.com/${WA_API_VERSION}/${phoneId}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to: cleanPhone(to),
    type: "text",
    text: { body: text },
  };

  return sendRequest(url, token, payload);
}

async function sendRequest(url: string, token: string, payload: object) {
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

      // Código 190 = token inválido/caducado (OAuth error)
      if (errorCode === 190) {
        console.error("[whatsapp] TOKEN_INVALID:", errorMsg);
        return { ok: false, error: "TOKEN_INVALID", details: errorMsg };
      }

      console.error("[whatsapp] API Error code:", errorCode, "msg:", errorMsg);
      return { ok: false, error: errorMsg };
    }

    return { ok: true, data };
  } catch (error) {
    console.error("[whatsapp] Request Error:", error);
    return { ok: false, error: String(error) };
  }
}
