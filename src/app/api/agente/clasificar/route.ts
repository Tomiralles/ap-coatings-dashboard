import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { anthropic, MODELO_CLASIFICADOR } from "@/lib/anthropic";
import { SYSTEM_PROMPT_CLASIFICADOR } from "@/lib/prompts/clasificador";

/**
 * Endpoint del agente clasificador de emails.
 *
 * POST /api/agente/clasificar
 *
 * Body:
 * {
 *   "asunto": "Pedido 26-158",
 *   "remitente": "\"Abad Pinturas S.l.\" <abadpinturas@abadpinturas.com>",
 *   "cuerpo": "Saludos, Toni Miralles...",
 *   "tiene_adjuntos": true,
 *   "nombres_adjuntos": ["PED-26-158-14052026.pdf"],
 *   "fecha_recibido": "2026-05-25T10:30:00Z"   // opcional
 * }
 *
 * Devuelve el JSON estructurado del clasificador + metadatos:
 * {
 *   "ok": true,
 *   "clasificacion": { ... output del agente ... },
 *   "uso": { input_tokens, output_tokens, cache_read_input_tokens, ... },
 *   "modelo": "claude-opus-4-7",
 *   "latencia_ms": 1234
 * }
 *
 * Funcionalidad clave:
 *  - Prompt caching: el system prompt (~3KB) se cachea automáticamente
 *    con cache_control. Las peticiones repetidas leen del caché (~0.1× coste).
 *  - Estructured output forzado por el prompt — no necesitamos json_schema
 *    porque el prompt es exhaustivo y Opus 4.7 lo respeta.
 */

interface EmailInput {
  asunto: string;
  remitente: string;
  cuerpo: string;
  tiene_adjuntos?: boolean;
  nombres_adjuntos?: string[];
  fecha_recibido?: string;
}

export async function POST(req: NextRequest) {
  const t0 = Date.now();

  // 1. Parsear y validar body
  let input: EmailInput;
  try {
    input = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Body inválido (no es JSON)" },
      { status: 400 }
    );
  }

  if (!input.asunto || !input.remitente || input.cuerpo === undefined) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Faltan campos obligatorios: asunto, remitente, cuerpo (cuerpo puede ser cadena vacía)",
      },
      { status: 400 }
    );
  }

  // 2. Construir el prompt del usuario con la info del email
  const userPrompt = construirUserPrompt(input);

  // 3. Llamar a Claude con prompt caching activo
  let response: Anthropic.Message;
  try {
    response = await anthropic.messages.create({
      model: MODELO_CLASIFICADOR,
      max_tokens: 2048,
      // Prompt caching: el system prompt es estable, lo cacheamos
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT_CLASIFICADOR,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: userPrompt,
        },
      ],
    });
  } catch (err) {
    console.error("[agente/clasificar] Error llamando a Claude:", err);
    const detalles = err instanceof Error ? err.message : String(err);
    if (err instanceof Anthropic.RateLimitError) {
      return NextResponse.json(
        { ok: false, error: "Rate limit Anthropic", detalles },
        { status: 429 }
      );
    }
    if (err instanceof Anthropic.APIError) {
      return NextResponse.json(
        { ok: false, error: "Error API Anthropic", detalles, status: err.status },
        { status: err.status ?? 500 }
      );
    }
    return NextResponse.json(
      { ok: false, error: "Error interno", detalles },
      { status: 500 }
    );
  }

  // 4. Extraer el texto del primer bloque
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    return NextResponse.json(
      {
        ok: false,
        error: "Respuesta de Claude sin bloque de texto",
        stop_reason: response.stop_reason,
      },
      { status: 500 }
    );
  }

  // 5. Parsear el JSON. El prompt instruye al modelo a devolver SOLO JSON,
  // pero por si acaso buscamos el primer { y el último } para ser robustos.
  const textoRespuesta = textBlock.text.trim();
  let clasificacion: unknown;
  try {
    clasificacion = JSON.parse(extraerJSON(textoRespuesta));
  } catch (parseErr) {
    console.error("[agente/clasificar] JSON inválido:", textoRespuesta);
    return NextResponse.json(
      {
        ok: false,
        error: "El modelo devolvió un JSON inválido",
        respuesta_cruda: textoRespuesta.slice(0, 500),
        parse_error: parseErr instanceof Error ? parseErr.message : String(parseErr),
      },
      { status: 500 }
    );
  }

  const latencia_ms = Date.now() - t0;

  return NextResponse.json({
    ok: true,
    clasificacion,
    uso: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_creation_input_tokens:
        response.usage.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
    },
    modelo: response.model,
    stop_reason: response.stop_reason,
    latencia_ms,
  });
}

/**
 * Construye el mensaje del usuario con la info del email.
 * El system prompt ya tiene todo el contexto; aquí solo va el email
 * que se quiere clasificar.
 */
function construirUserPrompt(input: EmailInput): string {
  const adjuntosInfo =
    input.tiene_adjuntos && input.nombres_adjuntos?.length
      ? `\nAdjuntos: ${input.nombres_adjuntos.join(", ")}`
      : input.tiene_adjuntos
        ? "\nAdjuntos: sí (nombres no proporcionados)"
        : "\nAdjuntos: no";

  const fechaInfo = input.fecha_recibido
    ? `\nFecha recibido: ${input.fecha_recibido}`
    : "";

  // Truncar el cuerpo si es excesivamente largo (evitar gastar tokens en spam)
  const cuerpoSeguro =
    input.cuerpo.length > 3000
      ? input.cuerpo.slice(0, 3000) + "\n[...truncado, cuerpo original más largo...]"
      : input.cuerpo;

  return `Clasifica el siguiente email según las reglas del system prompt.

=== EMAIL ===
Remitente: ${input.remitente}
Asunto: ${input.asunto}${fechaInfo}${adjuntosInfo}

Cuerpo:
${cuerpoSeguro}
=== FIN EMAIL ===

Devuelve SOLO el JSON estructurado, sin markdown, sin explicación adicional fuera del JSON.`;
}

/**
 * Extrae el primer objeto JSON de un texto que puede tener markdown
 * o explicación adicional. Robusto pero no infalible.
 */
function extraerJSON(texto: string): string {
  // Caso 1: el texto ES un JSON puro
  if (texto.startsWith("{") && texto.endsWith("}")) {
    return texto;
  }

  // Caso 2: hay markdown ```json ... ```
  const matchMarkdown = texto.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (matchMarkdown) return matchMarkdown[1].trim();

  // Caso 3: buscamos el primer { y el último }
  const inicio = texto.indexOf("{");
  const fin = texto.lastIndexOf("}");
  if (inicio !== -1 && fin > inicio) {
    return texto.slice(inicio, fin + 1);
  }

  // Si nada funciona, devolvemos el texto tal cual y dejamos que JSON.parse falle
  return texto;
}
