import { NextResponse } from "next/server";

const SPREADSHEET_ID = "1AwQRGxXeIWIN5ODjvDbbjNGCB-UQ8UdEPZUpuoHKzvE";
const SHEET_NAME = "Cola_Respuestas";

export interface RespuestaPendiente {
  id: string;
  fechaCreacion: string;
  tipo: "email" | "whatsapp";
  rowOrigen: string;
  destinatario: string;
  asunto: string;
  threadId: string;
  borrador: string;
  estado: "pendiente" | "aprobado" | "rechazado";
  enviadoEn: string;
  contextoJson: string;
}

export async function GET() {
  // Intentar primero vía Apps Script
  const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
  if (scriptUrl) {
    try {
      const res = await fetch(`${scriptUrl}?accion=leerHoja&hoja=${encodeURIComponent(SHEET_NAME)}`, {
        method: "GET",
        redirect: "follow",
      });
      const data = await res.json();
      if (data.ok && data.values) {
        const rows: string[][] = data.values;
        if (rows.length < 2) return NextResponse.json({ respuestas: [] });
        const respuestas: RespuestaPendiente[] = rows.slice(1)
          .filter((row) => (row[8] ?? "pendiente") === "pendiente")
          .map((row, idx) => ({
            id: row[0] ?? String(idx),
            fechaCreacion: row[1] ?? "",
            tipo: (row[2] ?? "email") as "email" | "whatsapp",
            rowOrigen: row[3] ?? "",
            destinatario: row[4] ?? "",
            asunto: row[5] ?? "",
            threadId: row[6] ?? "",
            borrador: row[7] ?? "",
            estado: (row[8] ?? "pendiente") as "pendiente" | "aprobado" | "rechazado",
            enviadoEn: row[9] ?? "",
            contextoJson: row[10] ?? "",
          }));
        return NextResponse.json({ respuestas });
      }
    } catch (err) {
      console.warn("Apps Script falló, intentando Sheets API:", err);
    }
  }

  // Fallback: Sheets API
  const apiKey = process.env.GOOGLE_SHEETS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Ni GOOGLE_APPS_SCRIPT_URL ni GOOGLE_SHEETS_API_KEY configuradas" }, { status: 500 });
  }

  try {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(SHEET_NAME)}?key=${apiKey}`;
    const res = await fetch(url, { next: { revalidate: 0 } });

    if (!res.ok) {
      const errBody = await res.text();
      if (res.status === 400 || res.status === 404) {
        return NextResponse.json({ respuestas: [] });
      }
      return NextResponse.json({ error: "Error al leer Cola_Respuestas", details: errBody }, { status: res.status });
    }

    const data = await res.json();
    const rows: string[][] = data.values ?? [];

    if (rows.length < 2) {
      return NextResponse.json({ respuestas: [] });
    }

    const respuestas: RespuestaPendiente[] = rows.slice(1)
      .filter((row) => (row[8] ?? "pendiente") === "pendiente")
      .map((row, idx) => ({
        id: row[0] ?? String(idx),
        fechaCreacion: row[1] ?? "",
        tipo: (row[2] ?? "email") as "email" | "whatsapp",
        rowOrigen: row[3] ?? "",
        destinatario: row[4] ?? "",
        asunto: row[5] ?? "",
        threadId: row[6] ?? "",
        borrador: row[7] ?? "",
        estado: (row[8] ?? "pendiente") as "pendiente" | "aprobado" | "rechazado",
        enviadoEn: row[9] ?? "",
        contextoJson: row[10] ?? "",
      }));

    return NextResponse.json({ respuestas });
  } catch (err) {
    return NextResponse.json({ error: "Error interno", details: String(err) }, { status: 500 });
  }
}
