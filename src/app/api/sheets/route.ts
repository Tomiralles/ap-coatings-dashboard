import { NextResponse } from "next/server";

const SPREADSHEET_ID = "1AwQRGxXeIWIN5ODjvDbbjNGCB-UQ8UdEPZUpuoHKzvE";
const SHEET_NAME = "Hoja 1";

export async function GET() {
  const apiKey = process.env.GOOGLE_SHEETS_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "GOOGLE_SHEETS_API_KEY no configurada" },
      { status: 500 }
    );
  }

  try {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(SHEET_NAME)}?key=${apiKey}`;
    const res = await fetch(url, { next: { revalidate: 60 } });

    if (!res.ok) {
      const errBody = await res.text();
      return NextResponse.json(
        { error: "Error al leer Google Sheets", details: errBody },
        { status: res.status }
      );
    }

    const data = await res.json();
    const rows: string[][] = data.values ?? [];

    if (rows.length < 2) {
      return NextResponse.json({ registros: [] });
    }

    const registros = rows.slice(1).map((row) => ({
      fecha: row[0] ?? "",
      quien: row[1] ?? "",
      asunto: row[2] ?? "",
      enlace: row[3] ?? "",
      cuerpo: row[4] ?? "",
      estado: row[5] ?? "",
      tipo: row[6] ?? "",
      prioridad: row[7] ?? "",
      autoDropdown: row[8] ?? "",
      respuestaAuto: row[9] ?? "",
      telefono: row[10] ?? "",
    }));

    return NextResponse.json({ registros });
  } catch (err) {
    return NextResponse.json(
      { error: "Error interno", details: String(err) },
      { status: 500 }
    );
  }
}
