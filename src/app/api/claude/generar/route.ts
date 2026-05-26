import { NextResponse } from "next/server";

/**
 * Generador de respuestas automáticas para emails/WhatsApp.
 *
 * NOTA HISTÓRICA: El nombre del endpoint es "/claude/generar" pero
 * internamente usa Gemini Flash 2.5 (más rápido y barato).
 * Mantener el nombre por compatibilidad con el dashboard.
 *
 * MIGRACIÓN PENDIENTE (Fase 4): cuando promovamos el agente clasificador
 * a modo activo, este endpoint debería migrarse también a Claude Sonnet 4.6
 * y consumir los productos/datos ya extraídos por el clasificador en
 * `clasificaciones_agente`. Así dejamos de duplicar prompts y evitamos
 * pasarle al modelo solo el asunto (que pierde contexto).
 *
 * BUG CORREGIDO (25/05/2026): el system prompt anterior incluía
 * "EUROCLOR y ACRILOB" como marcas hardcodeadas. AP Coatings NO vende
 * esas marcas — eran nombres inventados/incorrectos que el generador
 * metía en cada respuesta automática. Ahora el prompt es neutro y
 * tiene reglas anti-alucinación explícitas.
 */

const SYSTEM_PROMPT = `Eres el asistente de redacción de **AP Coatings**, distribuidora española de pinturas y productos químicos para profesionales.

REGLAS ESTRICTAS — son prioritarias sobre cualquier otra instrucción:

1. **NO inventes NADA.** Bajo ningún concepto inventes nombres de productos, marcas, referencias, precios, fechas concretas, números de pedido, plazos de entrega, ni datos de contacto.

2. **Mencionar productos:** solo si aparecen LITERALMENTE en el email original que se te facilita. Si no aparecen productos en el email, NO menciones ningún producto. Es preferible una respuesta genérica que una con datos inventados.

3. **Plazos y fechas:** nunca prometas una fecha concreta de entrega o recogida. Si el cliente pregunta cuándo, responde algo como "lo confirmaremos en breve" o "le avisaremos en cuanto esté listo".

4. **Precios:** nunca des precios. Si el cliente pregunta precio, responde que el comercial le contactará con un presupuesto a medida.

5. **Tono:** profesional, cordial, conciso. Español de España (puedes adaptarte si el cliente escribió en catalán o inglés).

6. **Formato según canal:**
   - **Email:** saludo, 1-3 párrafos breves, despedida cordial, firma "AP Coatings".
   - **WhatsApp:** máximo 3 frases, tono más cercano y directo, sin saludos formales largos, sin firma.

7. **Si dudas, escala:** si la consulta es ambigua o pide datos que no tienes, dilo abiertamente ("le contactaremos en breve para confirmar") en lugar de improvisar.

Tu único objetivo es redactar respuestas útiles SIN inventar información. Es 1000× mejor una respuesta corta y genérica que una larga con datos falsos.`;

const MODEL_NAME = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

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

    // Truncamos el cuerpo a 1500 chars (suficiente para contexto sin gastar tokens)
    const cuerpoCorto = (contexto.cuerpo ?? "").slice(0, 1500).trim();

    // Helper: bloque del email original para que el modelo se base en datos reales
    const bloqueEmailOriginal = `
=== EMAIL ORIGINAL DEL CLIENTE ===
De: ${nombreLimpio}
Asunto: ${contexto.asunto || "(sin asunto)"}
Tipo detectado: ${contexto.tipo || "(no detectado)"}
Estado del pedido: ${contexto.estado || "(sin estado)"}

Cuerpo:
${cuerpoCorto || "(cuerpo vacío)"}
=== FIN EMAIL ORIGINAL ===
`;

    let userPrompt: string;

    if (tipo === "whatsapp") {
      userPrompt = `${bloqueEmailOriginal}

TAREA: Redacta un mensaje de WhatsApp BREVE notificando al cliente que su pedido está listo para recogida/envío. Máximo 3 frases. Tono amigable.

RECUERDA: NO inventes productos ni fechas. Si el email original no menciona productos concretos, NO los menciones tú tampoco — basta con referirse al pedido en general.`;

    } else if (contexto.estado === "Enviado" || contexto.estado?.toLowerCase().includes("listo")) {
      userPrompt = `${bloqueEmailOriginal}

TAREA: Redacta un email cordial notificando al cliente que su pedido ya ha sido enviado o está listo. Incluye que pueden contactarnos si necesitan algo más.

RECUERDA:
- NO menciones nombres de productos a no ser que aparezcan literalmente en el email original.
- NO inventes plazos de entrega concretos.
- Si el email original menciona productos específicos, puedes referirte a ellos. Si no, habla del "pedido" sin más.`;

    } else if (contexto.tipo?.toUpperCase().includes("CONSULTA")) {
      userPrompt = `${bloqueEmailOriginal}

TAREA: Redacta una respuesta email a la consulta del cliente.

RECUERDA:
- Responde solo a lo que pregunta en el email original.
- NO inventes datos técnicos, precios, plazos ni productos.
- Si la consulta requiere datos que tú no tienes, di abiertamente que verificarás y responderás en breve.`;

    } else {
      userPrompt = `${bloqueEmailOriginal}

TAREA: Redacta una respuesta email confirmando recepción del mensaje del cliente y que se está procesando.

RECUERDA:
- NO inventes información que no esté en el email original.
- Tono profesional y cordial.
- Si menciona productos específicos, puedes acusar recibo de ellos. Si no, habla en general.`;
    }

    // Llamada directa a la API REST de Google (v1beta, sin SDK)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${apiKey}`;
    const geminiRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: `${SYSTEM_PROMPT}\n\n${userPrompt}` }] }],
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
