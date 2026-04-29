import { NextResponse } from "next/server";

export async function GET() {
  const apiKey = process.env.GOOGLE_AI_API_KEY;

  if (!apiKey) {
    return NextResponse.json({ ok: false, step: "api_key_check", error: "GOOGLE_AI_API_KEY no configurada" });
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "Di 'hola' en español." }] }],
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      return NextResponse.json({ ok: false, step: "gemini_call", error: json, keyPrefix: apiKey.substring(0, 10) + "..." });
    }
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    return NextResponse.json({ ok: true, respuesta: text, keyPrefix: apiKey.substring(0, 10) + "..." });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, step: "fetch_error", error: msg });
  }
}
