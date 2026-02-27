export async function sendWhatsAppNotification(to: string, clientName: string, orderName: string) {
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const templateName = process.env.WHATSAPP_TEMPLATE_NAME;

  if (!phoneId || !token || !templateName) {
    console.error("WhatsApp credentials not configured");
    return { ok: false, error: "Credentials missing" };
  }

  // Clean phone number (must be in E.164 format without '+')
  const cleanPhone = to.replace(/\D/g, "");
  
  // For Spain (34), if it doesn't have it, we might need to add it, 
  // but better to assume the user has the right number in the Sheet.
  
  const url = `https://graph.facebook.com/v19.0/${phoneId}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to: cleanPhone,
    type: "template",
    template: {
      name: templateName,
      language: {
        code: "es", // Assuming Spanish as it's for AP Coatings
      },
      components: [
        {
          type: "body",
          parameters: [
            {
              type: "text",
              text: clientName || "compañero",
            }
          ],
        },
      ],
    },
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok) {
      console.error("WhatsApp API Error:", data);
      return { ok: false, error: data.error?.message || "Error unknown" };
    }

    return { ok: true, data };
  } catch (error) {
    console.error("WhatsApp Request Error:", error);
    return { ok: false, error: String(error) };
  }
}
