import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { sendWhatsAppNotification, sendWhatsAppFreeform } from "@/lib/whatsapp";
import { enviarRespuestaAutomatica } from "@/lib/auto-respond-enviar";
import { CUENTAS_VIGILADAS } from "@/lib/cuentas-vigiladas";

/**
 * Aprueba y ENVÍA una respuesta de la cola.
 *
 * POST /api/respuestas/aprobar
 *   body: { id, tipo, destinatario, asunto?, threadId?, borradorFinal, contextoJson? }
 *
 * - Email   → se envía vía Gmail API impersonando tomiralles@apcoatings.net
 *             (DWD). Antes usaba Apps Script (fuera de servicio).
 * - WhatsApp→ vía API de WhatsApp (sin cambios).
 * Tras enviar, marca la fila como 'aprobado' en Postgres.
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
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

    // 1. Enviar según el tipo
    if (tipo === "email") {
      // Nombre del destinatario desde el contexto, si lo hay
      let destinatarioNombre = "";
      try {
        const ctx = JSON.parse(contextoJson ?? "{}");
        destinatarioNombre = (ctx.quien ?? "").split("<")[0].replace(/"/g, "").trim();
      } catch { /* sin nombre */ }

      const envio = await enviarRespuestaAutomatica({
        cuentaOrigen: CUENTAS_VIGILADAS[0], // tomiralles@apcoatings.net
        destinatarioEmail: destinatario,
        destinatarioNombre,
        asunto: asunto ?? "Respuesta AP Coatings",
        cuerpoTexto: borradorFinal,
        inReplyToMessageId: null,
        threadId: threadId || null,
        plantillaId: "cola_aprobada_manual",
      });
      sendResult = { ok: envio.ok, error: envio.error };
    } else if (tipo === "whatsapp") {
      const freeRes = await sendWhatsAppFreeform(destinatario, borradorFinal);
      if (freeRes.ok) {
        sendResult = freeRes;
      } else {
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
      if (sendResult.error === "TOKEN_INVALID") {
        return NextResponse.json(
          { error: "Token WhatsApp inválido o caducado. Renueva WHATSAPP_ACCESS_TOKEN en Vercel." },
          { status: 401 }
        );
      }
      return NextResponse.json(
        { error: "Error al enviar mensaje", details: sendResult.error },
        { status: 500 }
      );
    }

    // 2. Marcar como aprobado en Postgres (el envío ya se hizo)
    await sql`
      UPDATE cola_respuestas
      SET estado = 'aprobado',
          borrador = ${borradorFinal},
          enviado_en = NOW()
      WHERE id = ${id}
    `.catch((err) => {
      console.error("[aprobar] No se pudo marcar aprobado id:", id, String(err));
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[aprobar] ERROR interno id:", id, String(err));
    return NextResponse.json({ error: "Error interno", details: String(err) }, { status: 500 });
  }
}
