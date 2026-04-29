import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
  if (!scriptUrl) {
    return NextResponse.json({ error: "GOOGLE_APPS_SCRIPT_URL no configurada" }, { status: 500 });
  }

  let id: string | undefined;

  try {
    const body = await request.json();
    id = body?.id;

    if (!id) {
      return NextResponse.json({ error: "Falta parámetro: id" }, { status: 400 });
    }

    const res = await fetch(scriptUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "actualizarCola", id, estado: "rechazado" }),
      redirect: "follow",
    });

    const text = await res.text();
    let data: { ok?: boolean; error?: string };

    try {
      data = JSON.parse(text);
    } catch {
      data = { ok: false, error: `Respuesta no-JSON de Apps Script: ${text.substring(0, 200)}` };
    }

    if (!data?.ok) {
      console.error("[rechazar] ERROR Apps Script:", JSON.stringify(data), "id:", id);
      return NextResponse.json(
        { error: "Apps Script no confirmó el rechazo", details: data },
        { status: 500 }
      );
    }

    console.log("[rechazar] OK id:", id);
    return NextResponse.json({ ok: true });

  } catch (err) {
    console.error("[rechazar] ERROR interno id:", id, String(err));
    return NextResponse.json({ error: "Error interno", details: String(err) }, { status: 500 });
  }
}
