import { NextResponse } from "next/server";
import { sendWhatsAppNotification, sendWhatsAppFreeform } from "@/lib/whatsapp";

export async function POST(request: Request) {
  const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
  if (!scriptUrl) {
    return NextResponse.json({ error: "GOOGLE_APPS_SCRIPT_URL no configurada" }, { status: 500 });
  }

  let id: string | undefined;

  try {
    const body = await request.json();
    const { tipo, destinatario, asunto, threadId, borradorFinal, contextoJson } = body as {
      id: string;
      tipo: "email" | "whatsapp";
      destinatario: string;
      asunto?: string;
      threadId?: string;
      borradorFinal: string;
      contextoJson?: string;
    };
    id = body?.id;

    if (!id || !tipo || !destinatario || !borradorFinal) {
      return NextResponse.json({ error: "Faltan parámetros requeridos" }, { status: 400 });
    }

    let sendResult: { ok: boolean; error?: string } = { ok: false };

    // 1. Enviar el mensaje según el tipo
    if (tipo === "email") {
      const emailRes = await fetch(scriptUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accion: "enviarEmail",
          para: destinatario,
          asunto: asunto ?? "Respuesta AP Coatings",
          cuerpo: borradorFinal,
          threadId: threadId ?? "",
        }),
        redirect: "follow",
      });
      const text = await emailRes.text();
      try { sendResult = JSON.parse(text); } catch { sendResult = { ok: emailRes.ok }; }
    } else if (tipo === "whatsapp") {
      // Intentar mensaje libre primero; si falla, usar template
      const freeRes = await sendWhatsAppFreeform(destinatario, borradorFinal);
      if (freeRes.ok) {
        sendResult = freeRes;
      } else {
        // Fallback: template (pedido listo)
        let quien = destinatario;
        try {
          const ctx = JSON.parse(contextoJson ?? "{}");
          quien = ctx.quien?.split("<")[0].replace(/"/g, "").trim() || destinatario;
        } catch { /* usar destinatario */ }
        sendResult = await sendWhatsAppNotification(destinatario, quien, asunto ?? "");
      }
    }

    if (!sendResult.ok) {
      console.error("[aprobar] ERROR envío tipo:", tipo, "id:", id, sendResult.error);
      // Token WhatsApp inválido o caducado → 401 explícito
      if (sendResult.error === "TOKEN_INVALID") {
        return NextResponse.json(
          { error: "Token WhatsApp inválido o caducado. Renueva WHATSAPP_ACCESS_TOKEN en Vercel.", details: (sendResult as { ok: boolean; error: string; details?: string }).details },
          { status: 401 }
        );
      }
      return NextResponse.json(
        { error: "Error al enviar mensaje", details: sendResult.error },
        { status: 500 }
      );
    }

    // 2. Actualizar estado en Cola_Respuestas — verificar respuesta
    const updateRes = await fetch(scriptUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accion: "actualizarCola",
        id,
        estado: "aprobado",
        borradorFinal,
      }),
      redirect: "follow",
    });

    const updateText = await updateRes.text();
    let updateData: { ok?: boolean; error?: string };
    try {
      updateData = JSON.parse(updateText);
    } catch {
      updateData = { ok: false, error: `Respuesta no-JSON de Apps Script: ${updateText.substring(0, 200)}` };
    }

    if (!updateData?.ok) {
      // El mensaje ya fue enviado, pero no se pudo marcar en Sheets — loguear pero no fallar
      console.error("[aprobar] actualizarCola falló id:", id, JSON.stringify(updateData));
    } else {
      console.log("[aprobar] OK id:", id, "tipo:", tipo);
    }

    return NextResponse.json({ ok: true });

  } catch (err) {
    console.error("[aprobar] ERROR interno id:", id, String(err));
    return NextResponse.json({ error: "Error interno", details: String(err) }, { status: 500 });
  }
}
