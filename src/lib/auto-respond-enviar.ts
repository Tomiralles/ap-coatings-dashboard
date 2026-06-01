/**
 * Envío de respuestas automáticas vía Gmail API impersonando una cuenta
 * del dominio Workspace (Domain-Wide Delegation).
 *
 * Construye un mensaje RFC 822 con cabeceras correctas para mantener el
 * hilo de conversación (In-Reply-To / References) y un header propio
 * (X-AP-Auto-Replied) para que se pueda identificar fácilmente que es
 * una respuesta automática del agente.
 */

import { getGmailClient } from "@/lib/google-auth";

export interface EnviarRespuestaParams {
  cuentaOrigen: string;             // ej. "tomiralles@apcoatings.net"
  destinatarioEmail: string;        // ej. "cliente@ejemplo.com"
  destinatarioNombre?: string;
  asunto: string;
  cuerpoTexto: string;              // plain text (sin HTML)
  inReplyToMessageId?: string | null; // gmail_message_id del email original
  threadId?: string | null;          // gmail thread_id para mantener hilo
  plantillaId: string;               // identificador de la plantilla usada
}

export interface EnviarRespuestaResultado {
  ok: boolean;
  gmail_message_id_enviado?: string;
  error?: string;
  latencia_ms: number;
}

/**
 * Codifica un texto en formato MIME quoted-printable o base64 según
 * convenga. Para mayor compatibilidad usamos base64 con charset UTF-8.
 */
function encodeBase64Mime(texto: string): string {
  const b64 = Buffer.from(texto, "utf-8").toString("base64");
  // Partir en líneas de 76 chars (requisito MIME)
  return b64.replace(/(.{76})/g, "$1\r\n");
}

/**
 * Codifica un asunto con caracteres especiales (UTF-8) en RFC 2047.
 * Para asuntos ASCII puros, los devuelve sin modificar.
 */
function encodeSubject(asunto: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(asunto)) return asunto;
  const b64 = Buffer.from(asunto, "utf-8").toString("base64");
  return `=?UTF-8?B?${b64}?=`;
}

/**
 * Formatea un email con nombre opcional: "Nombre <email@dominio>" o "email@dominio".
 */
function formatEmailHeader(email: string, nombre?: string): string {
  if (!nombre || !nombre.trim() || nombre === email) return email;
  const nombreLimpio = nombre.replace(/[<>"]/g, "").trim();
  // Si el nombre tiene caracteres no-ASCII, codificar
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(nombreLimpio)) {
    return `"${nombreLimpio}" <${email}>`;
  }
  const b64 = Buffer.from(nombreLimpio, "utf-8").toString("base64");
  return `=?UTF-8?B?${b64}?= <${email}>`;
}

/**
 * Construye un mensaje RFC 822 completo listo para enviar.
 */
function construirMensajeRfc822(params: EnviarRespuestaParams): string {
  const {
    cuentaOrigen,
    destinatarioEmail,
    destinatarioNombre,
    asunto,
    cuerpoTexto,
    inReplyToMessageId,
    plantillaId,
  } = params;

  const headers: string[] = [
    `From: AP Coatings <${cuentaOrigen}>`,
    `To: ${formatEmailHeader(destinatarioEmail, destinatarioNombre)}`,
    `Subject: ${encodeSubject(asunto)}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: base64`,
    // Headers de respuesta para mantener hilo
  ];

  if (inReplyToMessageId) {
    // Gmail acepta el message_id "raw" de la API como referencia.
    // El header oficial requiere formato <id@dominio>, pero Gmail
    // mapea su ID interno también si lo pasamos. Por compatibilidad,
    // formateamos como <gmailMsgId@gmail.com>.
    const refId = `<${inReplyToMessageId}@mail.gmail.com>`;
    headers.push(`In-Reply-To: ${refId}`);
    headers.push(`References: ${refId}`);
  }

  // Header propio para identificar respuestas automáticas (auditoría)
  headers.push(`X-AP-Auto-Replied: agent`);
  headers.push(`X-AP-Plantilla: ${plantillaId}`);

  const headersStr = headers.join("\r\n");
  const bodyEncoded = encodeBase64Mime(cuerpoTexto);

  return `${headersStr}\r\n\r\n${bodyEncoded}`;
}

/**
 * Envía la respuesta automática vía Gmail API.
 * Si threadId está presente, Gmail anidará la respuesta dentro del hilo
 * (Re: visible). Si no, será un email suelto.
 */
export async function enviarRespuestaAutomatica(
  params: EnviarRespuestaParams
): Promise<EnviarRespuestaResultado> {
  const t0 = Date.now();

  try {
    const gmail = await getGmailClient(params.cuentaOrigen);
    const mensajeRfc = construirMensajeRfc822(params);
    const raw = Buffer.from(mensajeRfc, "utf-8").toString("base64url");

    const resp = await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw,
        ...(params.threadId ? { threadId: params.threadId } : {}),
      },
    });

    const messageId = resp.data.id ?? undefined;

    return {
      ok: true,
      gmail_message_id_enviado: messageId,
      latencia_ms: Date.now() - t0,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[auto-respond-enviar] Falla envío:`, msg);
    return {
      ok: false,
      error: msg,
      latencia_ms: Date.now() - t0,
    };
  }
}
