import { NextRequest, NextResponse } from "next/server";
import { clasificarEmail, EmailInput } from "@/lib/clasificador";

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
 * Devuelve:
 * {
 *   "ok": true,
 *   "clasificacion": { ... output del agente ... },
 *   "uso": { input_tokens, output_tokens, cache_*_input_tokens },
 *   "coste_usd": 0.012345,
 *   "modelo": "claude-opus-4-7",
 *   "latencia_ms": 1234
 * }
 *
 * NOTA: la lógica está en src/lib/clasificador.ts para que pueda ser
 * reutilizada por el cron de shadow mode (sin self-HTTP).
 */

export async function POST(req: NextRequest) {
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

  // 2. Clasificar (lógica compartida con el cron de shadow mode)
  const resultado = await clasificarEmail(input);

  if (!resultado.ok) {
    const status = resultado.status ?? 500;
    console.error(
      "[agente/clasificar] Error:",
      resultado.error,
      resultado.detalles ?? ""
    );
    return NextResponse.json(resultado, { status });
  }

  return NextResponse.json(resultado);
}
