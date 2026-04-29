import { NextResponse } from "next/server";

const SYSTEM_PROMPT = `Eres el asistente de AP Coatings, empresa española distribuidora de pinturas y productos químicos (EUROCLOR, ACRILOB, entre otros). Responde siempre en español. Tono profesional y cordial, conciso y directo. Firma siempre como "AP Coatings". No inventes precios ni fechas de entrega concretas. Si es para WhatsApp, máximo 3 frases con tono más cercano, sin saludos formales extensos.`;

export async function POST(request: Request) {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GOOGLE_AI_API_KEY no configurada" }, { status: 500 });
  }

  try {
    const body = await request.json();
    const { tipo, contexto } = body as {
      tipo: "email" | "whatsapp";
      contexto: {
        quien: string;
        asunto: string;
        cuerpo: string;
        tipo: string;
        estado: string;
      };
    };

    if (!tipo || !contexto) {
      return NextResponse.json({ error: "Faltan parámetros: tipo, contexto" }, { status: 400 });
    }

    const nombreLimpio = contexto.quien.split("<")[0].replace(/"/g, "").trim();

    let userPrompt: string;

    if (tipo === "whatsapp") {
      userPrompt = `El cliente ${nombreLimpio} tiene un pedido con estado "${contexto.estado}". Asunto: "${contexto.asunto}". Redacta un mensaje breve de WhatsApp notificándole que su pedido está listo para recogida/envío. Máximo 3 frases, tono amigable.`;
    } else if (contexto.estado === "Enviado" || contexto.estado?.toLowerCase().includes("listo")) {
      userPrompt = `El cliente ${nombreLimpio} tiene un pedido listo (estado: "${contexto.estado}"). Asunto original: "${contexto.asunto}". Redacta un email profesional y cordial notificándole que su pedido está listo. Incluye que se pongan en contacto si necesitan algo más.`;
    } else if (contexto.tipo?.toUpperCase().includes("CONSULTA")) {
      userPrompt = `El cliente/contacto ${nombreLimpio} ha enviado una consulta. Asunto: "${contexto.asunto}". Contenido: "${contexto.cuerpo?.substring(0, 400)}". Redacta una respuesta email profesional y útil respondiendo a su consulta. Si no tienes datos concretos, indica que verificarás y responderás en breve.`;
    } else {
      userPrompt = `El cliente ${nombreLimpio} ha enviado un pedido/mensaje. Asunto: "${contexto.asunto}". Contenido: "${contexto.cuerpo?.substring(0, 400)}". Redacta una respuesta email confirmando la recepción y que se está procesando su solicitud. Tono profesional y cordial.`;
    }

    // Llamada directa a la API REST de Google (v1, sin SDK)
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    const geminiRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      }),
    });

    const geminiJson = await geminiRes.json();

    if (!geminiRes.ok) {
      console.error("Error Gemini API:", JSON.stringify(geminiJson));
      return NextResponse.json({ error: "Error Gemini", details: JSON.stringify(geminiJson) }, { status: 500 });
    }

    const borrador = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    if (!borrador) {
      return NextResponse.json({ error: "Respuesta vacía de Gemini", details: JSON.stringify(geminiJson) }, { status: 500 });
    }

    return NextResponse.json({ borrador });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Error generando borrador Gemini:", msg);
    return NextResponse.json({ error: "Error interno", details: msg }, { status: 500 });
  }
}
