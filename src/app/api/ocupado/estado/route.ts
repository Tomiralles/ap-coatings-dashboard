import { NextResponse } from "next/server";

const SPREADSHEET_ID = "1AwQRGxXeIWIN5ODjvDbbjNGCB-UQ8UdEPZUpuoHKzvE";
const CONFIG_SHEET = "Config";

export async function GET() {
  // Try Apps Script first (more reliable)
  const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
  if (scriptUrl) {
    try {
      const res = await fetch(scriptUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accion: "leerOcupado",
        }),
        redirect: "follow",
      });
      const data = await res.json();
      if (data.ok && data.ocupado !== undefined) {
        return NextResponse.json({
          ocupado: data.ocupado === true || data.ocupado === "true",
          actualizado: data.actualizado ?? new Date().toISOString(),
        });
      }
    } catch (err) {
      console.warn("Apps Script leerOcupado falló, intentando fallback:", err);
    }
  }

  // Fallback: Sheets API
  const apiKey = process.env.GOOGLE_SHEETS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Ni GOOGLE_APPS_SCRIPT_URL ni GOOGLE_SHEETS_API_KEY configuradas" },
      { status: 500 }
    );
  }

  try {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(CONFIG_SHEET)}?key=${apiKey}`;
    const res = await fetch(url, { next: { revalidate: 0 } });

    if (!res.ok) {
      const errBody = await res.text();
      if (res.status === 400 || res.status === 404) {
        // Config sheet doesn't exist yet, return default
        return NextResponse.json({
          ocupado: false,
          actualizado: new Date().toISOString(),
        });
      }
      return NextResponse.json(
        { error: "Error al leer Config", details: errBody },
        { status: res.status }
      );
    }

    const data = await res.json();
    const rows: string[][] = data.values ?? [];

    if (rows.length < 2) {
      // Sheet exists but is empty, return default
      return NextResponse.json({
        ocupado: false,
        actualizado: new Date().toISOString(),
      });
    }

    const ocupado = (rows[1][1] ?? "false").toLowerCase() === "true";
    const actualizado = rows[1][2] ?? new Date().toISOString();

    return NextResponse.json({ ocupado, actualizado });
  } catch (err) {
    return NextResponse.json(
      { error: "Error interno", details: String(err) },
      { status: 500 }
    );
  }
}

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
    const { ocupado } = body as { ocupado: boolean };

    if (typeof ocupado !== "boolean") {
      return NextResponse.json(
        { error: "Parámetro 'ocupado' debe ser boolean" },
        { status: 400 }
      );
    }

    const res = await fetch(scriptUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accion: "actualizarOcupado",
        valor: ocupado,
      }),
      redirect: "follow",
    });

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { ok: res.ok, raw: text };
    }

    if (!data.ok) {
      console.error("Apps Script actualizarOcupado error:", data);
      return NextResponse.json(
        { error: "Error al actualizar estado", details: JSON.stringify(data) },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      ocupado,
      actualizado: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Error en POST /api/ocupado/estado:", err);
    return NextResponse.json(
      { error: "Error interno", details: String(err) },
      { status: 500 }
    );
  }
}
