import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;

  if (!scriptUrl) {
    return NextResponse.json(
      { error: "GOOGLE_APPS_SCRIPT_URL no configurada" },
      { status: 500 }
    );
  }

  try {
    const body = await request.json();
    const { fila, columna, valor } = body;

    if (!fila || !columna || valor === undefined) {
      return NextResponse.json(
        { error: "Faltan parametros: fila, columna, valor" },
        { status: 400 }
      );
    }

    const res = await fetch(scriptUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fila, columna, valor }),
      redirect: "follow",
    });

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { ok: false, raw: text };
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: "Error interno", details: String(err) },
      { status: 500 }
    );
  }
}
