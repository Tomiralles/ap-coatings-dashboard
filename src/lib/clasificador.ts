/**
 * Función reutilizable para clasificar un email con Claude Opus 4.7.
 *
 * Esta función es la lógica núcleo que usan:
 *   - /api/agente/clasificar          (endpoint HTTP público)
 *   - /api/agente/procesar-pendientes (cron de shadow mode)
 *
 * Beneficios de extraerla aquí:
 *   - El cron no hace HTTP self-call (más rápido, menos overhead).
 *   - Misma lógica de prompt caching, parseo robusto y manejo de errores.
 *   - Calculamos coste estimado en USD en una sola pieza.
 */

import Anthropic from "@anthropic-ai/sdk";
import { anthropic, MODELO_CLASIFICADOR } from "@/lib/anthropic";
import { SYSTEM_PROMPT_CLASIFICADOR } from "@/lib/prompts/clasificador";

export interface EmailInput {
  asunto: string;
  remitente: string;
  cuerpo: string;
  tiene_adjuntos?: boolean;
  nombres_adjuntos?: string[];
  fecha_recibido?: string;
}

export interface ClasificacionUso {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

export interface ClasificacionResultado {
  ok: true;
  clasificacion: Record<string, unknown>;
  uso: ClasificacionUso;
  coste_usd: number;
  modelo: string;
  stop_reason: string | null;
  latencia_ms: number;
}

export interface ClasificacionError {
  ok: false;
  error: string;
  detalles?: string;
  parse_error?: string;
  respuesta_cruda?: string;
  stop_reason?: string | null;
  status?: number;
  latencia_ms: number;
}

/**
 * Tarifas Claude Opus 4.7 (USD por millón de tokens). Mantener sincronizado
 * con la documentación oficial. Si cambian, actualizar aquí.
 */
const PRECIO_OPUS_4_7 = {
  input_base: 5.0,         // $5 / 1M input tokens
  output_base: 25.0,        // $25 / 1M output tokens
  cache_write: 6.25,        // 1.25× input (ephemeral 5min)
  cache_read: 0.5,          // 0.1× input
} as const;

function calcularCosteUSD(uso: ClasificacionUso): number {
  const totalUSD =
    (uso.input_tokens * PRECIO_OPUS_4_7.input_base) / 1_000_000 +
    (uso.output_tokens * PRECIO_OPUS_4_7.output_base) / 1_000_000 +
    (uso.cache_creation_input_tokens * PRECIO_OPUS_4_7.cache_write) / 1_000_000 +
    (uso.cache_read_input_tokens * PRECIO_OPUS_4_7.cache_read) / 1_000_000;
  return Math.round(totalUSD * 1_000_000) / 1_000_000; // 6 decimales
}

/**
 * Construye el mensaje de usuario con la info del email.
 * El system prompt ya tiene todo el contexto.
 */
export function construirUserPrompt(input: EmailInput): string {
  const adjuntosInfo =
    input.tiene_adjuntos && input.nombres_adjuntos?.length
      ? `\nAdjuntos: ${input.nombres_adjuntos.join(", ")}`
      : input.tiene_adjuntos
        ? "\nAdjuntos: sí (nombres no proporcionados)"
        : "\nAdjuntos: no";

  const fechaInfo = input.fecha_recibido
    ? `\nFecha recibido: ${input.fecha_recibido}`
    : "";

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
 * o explicación adicional.
 */
export function extraerJSON(texto: string): string {
  if (texto.startsWith("{") && texto.endsWith("}")) return texto;

  const matchMarkdown = texto.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (matchMarkdown) return matchMarkdown[1].trim();

  const inicio = texto.indexOf("{");
  const fin = texto.lastIndexOf("}");
  if (inicio !== -1 && fin > inicio) return texto.slice(inicio, fin + 1);

  return texto;
}

/**
 * Clasifica un email llamando a Claude Opus 4.7 con prompt caching activo.
 *
 * Devuelve un objeto unificado con éxito o error — el caller siempre puede
 * comprobar `.ok` para distinguir.
 */
export async function clasificarEmail(
  input: EmailInput
): Promise<ClasificacionResultado | ClasificacionError> {
  const t0 = Date.now();

  if (!input.asunto || !input.remitente || input.cuerpo === undefined) {
    return {
      ok: false,
      error: "Faltan campos obligatorios: asunto, remitente, cuerpo",
      latencia_ms: Date.now() - t0,
    };
  }

  const userPrompt = construirUserPrompt(input);

  let response: Anthropic.Message;
  try {
    response = await anthropic.messages.create({
      model: MODELO_CLASIFICADOR,
      max_tokens: 2048,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT_CLASIFICADOR,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: userPrompt }],
    });
  } catch (err) {
    const detalles = err instanceof Error ? err.message : String(err);
    if (err instanceof Anthropic.RateLimitError) {
      return {
        ok: false,
        error: "Rate limit Anthropic",
        detalles,
        status: 429,
        latencia_ms: Date.now() - t0,
      };
    }
    if (err instanceof Anthropic.APIError) {
      return {
        ok: false,
        error: "Error API Anthropic",
        detalles,
        status: err.status,
        latencia_ms: Date.now() - t0,
      };
    }
    return {
      ok: false,
      error: "Error interno",
      detalles,
      latencia_ms: Date.now() - t0,
    };
  }

  // Extraer texto
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    return {
      ok: false,
      error: "Respuesta de Claude sin bloque de texto",
      stop_reason: response.stop_reason,
      latencia_ms: Date.now() - t0,
    };
  }

  const textoRespuesta = textBlock.text.trim();
  let clasificacion: Record<string, unknown>;
  try {
    clasificacion = JSON.parse(extraerJSON(textoRespuesta));
  } catch (parseErr) {
    return {
      ok: false,
      error: "El modelo devolvió un JSON inválido",
      respuesta_cruda: textoRespuesta.slice(0, 500),
      parse_error: parseErr instanceof Error ? parseErr.message : String(parseErr),
      latencia_ms: Date.now() - t0,
    };
  }

  const uso: ClasificacionUso = {
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
  };

  return {
    ok: true,
    clasificacion,
    uso,
    coste_usd: calcularCosteUSD(uso),
    modelo: response.model,
    stop_reason: response.stop_reason,
    latencia_ms: Date.now() - t0,
  };
}
