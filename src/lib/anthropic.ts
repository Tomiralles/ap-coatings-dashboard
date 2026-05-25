/**
 * Cliente del SDK oficial de Anthropic.
 *
 * Lee ANTHROPIC_API_KEY de las variables de entorno (configurada en Vercel
 * como variable de entorno cifrada).
 *
 * Modelo por defecto:
 *   - claude-opus-4-7 (el más capaz; mejor calidad para clasificación
 *     y extracción de datos estructurados).
 *
 * Se puede sobreescribir el modelo via env var ANTHROPIC_MODEL si se
 * quiere optimizar coste (ej. claude-sonnet-4-6 o claude-haiku-4-5).
 */

import Anthropic from "@anthropic-ai/sdk";

if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error(
    "ANTHROPIC_API_KEY no está definida. Configúrala en las variables de entorno de Vercel."
  );
}

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * Modelo a usar para el agente clasificador.
 * Por defecto: claude-opus-4-7 (máxima calidad).
 * Para reducir costes, configurar ANTHROPIC_MODEL=claude-sonnet-4-6
 * o claude-haiku-4-5 en variables de entorno.
 */
export const MODELO_CLASIFICADOR =
  process.env.ANTHROPIC_MODEL ?? "claude-opus-4-7";
