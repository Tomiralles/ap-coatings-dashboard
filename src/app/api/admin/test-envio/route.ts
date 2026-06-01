import { NextRequest, NextResponse } from "next/server";
import { enviarRespuestaAutomatica } from "@/lib/auto-respond-enviar";
import { CUENTAS_VIGILADAS } from "@/lib/cuentas-vigiladas";

/**
 * Endpoint de prueba para validar el ENVÍO vía Gmail API sin pasar por
 * los filtros del agente. Útil cuando queremos confirmar que la cadena
 * DWD + Gmail API + RFC 822 funciona correctamente, independientemente
 * de qué decida el clasificador.
 *
 * POST /api/admin/test-envio
 *   body: { destinatario: string, asunto?: string }
 *   headers: Authorization: Bearer <CRON_SECRET>
 *
 * Envía un email de prueba (acuse de recibo genérico) al destinatario
 * indicado desde la cuenta vigilada (tomiralles@apcoatings.net por DWD).
 *
 * IMPORTANTE: este endpoint NO debe estar habilitado en producción real
 * más allá del periodo de testing. Lo dejamos protegido con CRON_SECRET
 * para minimizar riesgo.
 */

function verificarCronSecret(req: NextRequest): boolean {
  if (process.env.SKIP_CRON_AUTH === "true") return true;
  const auth = req.headers.get("authorization");
  if (!auth) return false;
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  return (
    process.env.CRON_SECRET !== undefined &&
    process.env.CRON_SECRET.length > 0 &&
    auth === expected
  );
}

export async function POST(req: NextRequest) {
  if (!verificarCronSecret(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: { destinatario?: string; asunto?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body inválido" }, { status: 400 });
  }

  const destinatario = body.destinatario;
  if (!destinatario || !destinatario.includes("@")) {
    return NextResponse.json(
      { ok: false, error: "Falta destinatario válido en el body" },
      { status: 400 }
    );
  }

  const asunto = body.asunto || "Test de envío AP Coatings - " + new Date().toISOString();
  const cuentaOrigen = CUENTAS_VIGILADAS[0]; // tomiralles@apcoatings.net

  const resultado = await enviarRespuestaAutomatica({
    cuentaOrigen,
    destinatarioEmail: destinatario,
    destinatarioNombre: "",
    asunto,
    cuerpoTexto: `Buenos días,

Este es un email de PRUEBA del sistema de auto-respuesta de AP Coatings.

Si está leyendo este mensaje significa que el envío vía Gmail API
funciona correctamente. Puede ignorar este email.

Saludos,
AP Coatings - Sistema automatizado`,
    inReplyToMessageId: null,
    threadId: null,
    plantillaId: "test_envio_diagnostico",
  });

  return NextResponse.json({
    ok: resultado.ok,
    desde: cuentaOrigen,
    para: destinatario,
    gmail_message_id_enviado: resultado.gmail_message_id_enviado,
    error: resultado.error,
    latencia_ms: resultado.latencia_ms,
  });
}
