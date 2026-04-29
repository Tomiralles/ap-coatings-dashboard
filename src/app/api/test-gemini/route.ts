import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

export async function GET() {
  const apiKey = process.env.GOOGLE_AI_API_KEY;

  if (!apiKey) {
    return NextResponse.json({
      ok: false,
      step: "api_key_check",
      error: "GOOGLE_AI_API_KEY no está configurada en Vercel"
    });
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent("Di 'hola' en español.");
    const text = result.response.text();
    return NextResponse.json({ ok: true, respuesta: text, keyPrefix: apiKey.substring(0, 10) + "..." });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({
      ok: false,
      step: "gemini_call",
      error: msg,
      keyPrefix: apiKey.substring(0, 10) + "..."
    });
  }
}
