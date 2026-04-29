import { NextResponse } from "next/server";

export async function GET() {
  const apiKey = process.env.GOOGLE_AI_API_KEY;

  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "GOOGLE_AI_API_KEY no configurada" });
  }

  try {
    // Listar modelos disponibles para esta API key
    const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    const res = await fetch(listUrl);
    const json = await res.json();
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: json, keyPrefix: apiKey.substring(0, 10) + "..." });
    }
    // Filtrar solo los que soportan generateContent
    const modelos = (json.models ?? [])
      .filter((m: {supportedGenerationMethods?: string[]}) => m.supportedGenerationMethods?.includes("generateContent"))
      .map((m: {name: string}) => m.name);
    return NextResponse.json({ ok: true, modelos, keyPrefix: apiKey.substring(0, 10) + "..." });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg });
  }
}
