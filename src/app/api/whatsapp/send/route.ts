import { NextResponse } from "next/server";
import { sendWhatsAppNotification, sendWhatsAppFreeform } from "@/lib/whatsapp";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { to, mensaje, modo, clientName, orderName } = body as {
      to: string;
      mensaje?: string;
      modo: "template" | "freeform";
      clientName?: string;
      orderName?: string;
    };

    if (!to || !modo) {
      return NextResponse.json({ error: "Faltan parámetros: to, modo" }, { status: 400 });
    }

    let result;
    if (modo === "template") {
      result = await sendWhatsAppNotification(to, clientName ?? "", orderName ?? "");
    } else {
      if (!mensaje) {
        return NextResponse.json({ error: "Falta parámetro: mensaje (requerido para modo freeform)" }, { status: 400 });
      }
      result = await sendWhatsAppFreeform(to, mensaje);
    }

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: "Error interno", details: String(err) }, { status: 500 });
  }
}
