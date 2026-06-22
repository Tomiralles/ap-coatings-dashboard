import { NextRequest, NextResponse } from "next/server";
import { gmail_v1 } from "googleapis";
import { sql } from "@/lib/db";
import { getGmailClient } from "@/lib/google-auth";
import { clasificarEmail, EmailInput } from "@/lib/clasificador";
import { CUENTAS_VIGILADAS } from "@/lib/cuentas-vigiladas";
import { escribirEnLegacy } from "@/lib/escribir-legacy";
import { puedeAutoResponder } from "@/lib/auto-respond-filtros";
import { generarPlantilla } from "@/lib/auto-respond-plantillas";
import { enviarRespuestaAutomatica } from "@/lib/auto-respond-enviar";

// Lee la config del toggle de auto-respuesta una vez por invocación del cron
// (no por email, para no hacer una query extra cada vuelta).
interface AgentAutoReplyConfig {
  enabled: boolean;
  min_confianza: number;
}

async function leerConfigAutoReply(): Promise<AgentAutoReplyConfig> {
  try {
    const rows = await sql`
      SELECT valor FROM config WHERE clave = 'agent_auto_reply' LIMIT 1
    `;
    if (rows.length === 0) return { enabled: false, min_confianza: 0.9 };
    const v = rows[0].valor as Partial<AgentAutoReplyConfig> | undefined;
    return {
      enabled: typeof v?.enabled === "boolean" ? v.enabled : false,
      min_confianza:
        typeof v?.min_confianza === "number" ? v.min_confianza : 0.9,
    };
  } catch {
    return { enabled: false, min_confianza: 0.9 };
  }
}

/**
 * Subir el timeout de la función a 60s (Vercel Hobby permite hasta 60s).
 * Necesario porque, en el peor caso, podemos clasificar hasta 3 emails por
 * cuenta × 4 cuentas en paralelo, y cada clasificación de Opus 4.7 tarda
 * ~5-6 segundos.
 */
export const maxDuration = 60;

/**
 * Cron de Shadow Mode (Fase 3).
 *
 * GET /api/agente/procesar-pendientes
 *
 * Ejecutado automáticamente cada 5 minutos por Vercel Cron (vercel.json).
 *
 * Flujo:
 *   1. Para cada cuenta vigilada:
 *      a. Pedir a Gmail los últimos N mensajes del INBOX
 *      b. Por cada mensaje:
 *         - Si ya está en clasificaciones_agente → saltar
 *         - Si no:
 *            • Obtener metadatos + cuerpo + adjuntos
 *            • Llamar al clasificador
 *            • Guardar resultado en Postgres
 *
 * Idempotente: se puede ejecutar todas las veces que sea. La UNIQUE
 * constraint en `gmail_message_id` evita duplicados.
 *
 * Seguridad: requiere header `Authorization: Bearer <CRON_SECRET>`.
 * Vercel inyecta este header automáticamente en los crons configurados
 * en vercel.json. Las llamadas manuales también deben llevarlo.
 *
 * Respuesta:
 * {
 *   ok: true,
 *   procesados: 3,
 *   saltados: 17,           // ya estaban en BD
 *   errores: 0,
 *   por_cuenta: { ... },
 *   latencia_total_ms: 12345
 * }
 */

// Lista centralizada (ver src/lib/cuentas-vigiladas.ts).
// Antes era una copia manual de 4 alias; ahora solo tomiralles@.
// Esto reduce ~75% las llamadas a Gmail API por ciclo del cron.
const CUENTAS_A_PROCESAR = CUENTAS_VIGILADAS;

/**
 * Captación robusta (anti-"correo enterrado").
 *
 * ANTES: solo se inspeccionaban los 3 mensajes MÁS recientes del INBOX por
 * ciclo. Si entre dos ejecuciones del cron entraban >3 correos, los del
 * medio nunca llegaban a estar en ese top-3 y NUNCA se clasificaban
 * (se perdían para siempre). Eso enterró los pedidos autoenviados por SQL
 * Pyme a partir del 10-jun-2026.
 *
 * AHORA: listamos una VENTANA amplia del INBOX (con paginación) y procesamos
 * todos los que aún no estén en `clasificaciones_agente`, limitando solo el
 * número de CLASIFICACIONES nuevas por ejecución (no el de mensajes mirados).
 * Como el listado es amplio, ningún correo queda fuera: lo que no entra en
 * este ciclo entra en el siguiente. El tope por ciclo respeta el maxDuration.
 */

// Ventana de días hacia atrás que se inspecciona por defecto (Gmail `q`).
const VENTANA_DIAS_DEFECTO = 30;

// Tope de mensajes a LISTAR por cuenta (con paginación). Mirarlos es barato
// (una query para saber cuáles ya existen); solo clasificamos los nuevos.
const MAX_MENSAJES_LISTAR = 250;

// Tope de CLASIFICACIONES nuevas (llamadas al modelo) por ejecución y cuenta.
// Cada clasificación tarda ~5-6s; 8 × 6s ≈ 48s deja margen bajo maxDuration=60.
const MAX_CLASIFICACIONES_POR_CICLO_DEFECTO = 8;

interface OpcionesProcesado {
  // Filtro de Gmail (p.ej. "from:abadpinturas@abadpinturas.com") para un
  // backfill dirigido. Se combina con la ventana de días.
  queryExtra?: string;
  // Días hacia atrás a inspeccionar.
  dias: number;
  // Máximo de clasificaciones nuevas por ejecución y cuenta.
  maxClasificaciones: number;
  // Máximo de mensajes a listar.
  maxListar: number;
}

// Remitentes cuyos autoenvíos (pedidos de SQL Pyme) deben captarse AUNQUE
// estén archivados / fuera de Recibidos. Un filtro de Gmail los saca del
// INBOX al llegar, así que se buscan por remitente SIN el filtro labelIds.
// Nota: todos los alias @apcoatings.net comparten el buzón de tomiralles@.
const REMITENTES_AUTOENVIO = [
  "abadpinturas@abadpinturas.com",   // legacy (en baja); recupera los perdidos
  "administracion@apcoatings.net",   // posible nuevo origen de SQL Pyme
  "apcoatings@apcoatings.net",       // dirección "Enviar como" de la cuenta
];

/**
 * Lista mensajes de Gmail paginando hasta `maxListar`. Con `labelIds` filtra
 * por esas etiquetas (p.ej. INBOX); sin ellas, busca en todo el correo
 * (incluidos los archivados), excepto spam y papelera.
 */
async function paginarMensajes(
  gmail: gmail_v1.Gmail,
  params: { labelIds?: string[]; q: string },
  maxListar: number
): Promise<gmail_v1.Schema$Message[]> {
  const out: gmail_v1.Schema$Message[] = [];
  let pageToken: string | undefined = undefined;
  do {
    const resp = (await gmail.users.messages.list({
      userId: "me",
      ...(params.labelIds ? { labelIds: params.labelIds } : {}),
      q: params.q,
      maxResults: 100,
      pageToken,
    })) as unknown as { data: gmail_v1.Schema$ListMessagesResponse };
    for (const m of resp.data.messages ?? []) out.push(m);
    pageToken = resp.data.nextPageToken ?? undefined;
  } while (pageToken && out.length < maxListar);
  return out;
}

interface ResultadoPorCuenta {
  cuenta: string;
  inspeccionados: number;
  procesados: number;
  saltados: number;
  errores: number;
  legacy_ok: number;       // escrituras a tablas legacy exitosas
  legacy_falla: number;    // escrituras a tablas legacy fallidas (no bloquea)
  autoresp_enviadas: number;
  autoresp_no_aplica: number;
  autoresp_falladas: number;
  detalles: Array<{
    gmail_message_id: string;
    accion: "procesado" | "saltado_ya_existe" | "error" | "auth_falla";
    tipo_clasificado?: string;
    legacy?: "ok" | "falla" | "saltado";
    legacy_error?: string;
    autoresp?:
      | "enviada"
      | "no_aplica"
      | "fallada"
      | "toggle_off"
      | "no_plantilla";
    autoresp_razon?: string;
    autoresp_error?: string;
    error?: string;
    latencia_ms?: number;
  }>;
}

/**
 * Decodifica el cuerpo de un mensaje Gmail (los bodies vienen en
 * base64url, repartidos en una jerarquía de "parts").
 */
function extraerCuerpoTexto(
  payload: gmail_v1.Schema$MessagePart | undefined
): string {
  if (!payload) return "";

  // Caso 1: parte simple con body.data
  if (payload.body?.data) {
    try {
      return Buffer.from(payload.body.data, "base64url").toString("utf-8");
    } catch {
      return "";
    }
  }

  // Caso 2: multipart — buscar text/plain primero, luego text/html
  const parts = payload.parts ?? [];
  let textoPlano = "";
  let textoHtml = "";

  for (const part of parts) {
    if (part.mimeType === "text/plain" && part.body?.data) {
      try {
        textoPlano += Buffer.from(part.body.data, "base64url").toString("utf-8");
      } catch {
        /* ignore */
      }
    } else if (part.mimeType === "text/html" && part.body?.data) {
      try {
        textoHtml += Buffer.from(part.body.data, "base64url").toString("utf-8");
      } catch {
        /* ignore */
      }
    } else if (part.parts) {
      // recursivo (multipart/alternative dentro de multipart/mixed, etc.)
      const subTexto = extraerCuerpoTexto(part);
      if (subTexto) textoPlano += subTexto;
    }
  }

  if (textoPlano) return textoPlano;

  // Fallback: limpiar HTML básico (eliminar tags)
  if (textoHtml) {
    return textoHtml
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, " ")
      .trim();
  }

  return "";
}

/**
 * Extrae los nombres de adjuntos del payload del mensaje.
 */
function extraerAdjuntos(payload: gmail_v1.Schema$MessagePart | undefined): {
  tiene_adjuntos: boolean;
  nombres: string[];
} {
  const nombres: string[] = [];

  function recurse(part: gmail_v1.Schema$MessagePart | undefined) {
    if (!part) return;
    if (part.filename && part.filename.length > 0 && part.body?.attachmentId) {
      nombres.push(part.filename);
    }
    if (part.parts) {
      for (const p of part.parts) recurse(p);
    }
  }

  recurse(payload);

  return { tiene_adjuntos: nombres.length > 0, nombres };
}

/**
 * Obtiene el valor de un header concreto (case-insensitive).
 */
function getHeader(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  name: string
): string {
  if (!headers) return "";
  const h = headers.find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return h?.value ?? "";
}

function verificarCronSecret(req: NextRequest): boolean {
  // En desarrollo local: SKIP_CRON_AUTH=true permite llamar sin token
  if (process.env.SKIP_CRON_AUTH === "true") return true;

  const auth = req.headers.get("authorization");
  if (!auth) return false;

  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  return process.env.CRON_SECRET !== undefined &&
    process.env.CRON_SECRET.length > 0 &&
    auth === expected;
}

/**
 * Procesa una cuenta Gmail: lista N mensajes, salta los ya clasificados,
 * y clasifica + guarda los nuevos.
 *
 * Esta función es totalmente independiente (no comparte estado mutable),
 * por lo que se puede llamar a varias en paralelo con Promise.all sin
 * problemas de race conditions.
 */
async function procesarCuenta(
  cuenta: string,
  configAutoReply: AgentAutoReplyConfig,
  opts: OpcionesProcesado
): Promise<ResultadoPorCuenta> {
  const res: ResultadoPorCuenta = {
    cuenta,
    inspeccionados: 0,
    procesados: 0,
    saltados: 0,
    errores: 0,
    legacy_ok: 0,
    legacy_falla: 0,
    autoresp_enviadas: 0,
    autoresp_no_aplica: 0,
    autoresp_falladas: 0,
    detalles: [],
  };

  let gmail: gmail_v1.Gmail;
  try {
    gmail = await getGmailClient(cuenta);
  } catch (err) {
    // Cuenta no autorizada por DWD (ej. abadpinturas@ está fuera del dominio)
    res.detalles.push({
      gmail_message_id: "(n/a)",
      accion: "auth_falla",
      error: err instanceof Error ? err.message : String(err),
    });
    return res;
  }

  // 1. Reunir mensajes de DOS fuentes y deduplicar por id:
  //    (a) INBOX: correo entrante normal (ventana de N días).
  //    (b) Autoenvíos de SQL Pyme (pedidos) buscados por remitente SIN el
  //        filtro INBOX, para captarlos aunque un filtro de Gmail los haya
  //        archivado (no aparecen en Recibidos pero sí en una búsqueda).
  const ventana = `newer_than:${opts.dias}d`;
  const qInbox = [ventana, opts.queryExtra].filter(Boolean).join(" ");
  const fromAutoenvio = REMITENTES_AUTOENVIO.map((e) => `from:${e}`).join(" OR ");
  // `in:anywhere` incluye Enviados, Archivados, Spam y Papelera: los
  // autoenvíos de SQL Pyme salen DESDE la propia cuenta, así que están en
  // ENVIADOS (no en Recibidos). Sin esto no se captarían.
  const qAutoenvio = `(${fromAutoenvio}) ${ventana} in:anywhere`;

  const porId = new Map<string, gmail_v1.Schema$Message>();
  try {
    const inbox = await paginarMensajes(
      gmail,
      { labelIds: ["INBOX"], q: qInbox },
      opts.maxListar
    );
    const autoenvios = await paginarMensajes(
      gmail,
      { q: qAutoenvio }, // sin labelIds → incluye los archivados
      opts.maxListar
    );
    for (const m of [...inbox, ...autoenvios]) {
      if (m.id) porId.set(m.id, m);
    }
  } catch (err) {
    res.errores++;
    res.detalles.push({
      gmail_message_id: "(list_falla)",
      accion: "error",
      error: err instanceof Error ? err.message : String(err),
    });
    return res;
  }

  const mensajes = [...porId.values()];
  res.inspeccionados = mensajes.length;

  // Prefetch: una sola query para saber cuáles ya están clasificados.
  // Evita un SELECT por mensaje (N+1) dentro del bucle.
  const idsListados = mensajes
    .map((m) => m.id)
    .filter((id): id is string => Boolean(id));
  const yaClasificados = new Set<string>();
  if (idsListados.length > 0) {
    const existentes = await sql`
      SELECT gmail_message_id FROM clasificaciones_agente
      WHERE gmail_message_id = ANY(${idsListados})
    `;
    for (const row of existentes) {
      yaClasificados.add(row.gmail_message_id as string);
    }
  }

  // 2. Saltar los ya clasificados; clasificar los nuevos hasta el tope del
  // ciclo (secuencial para no martillear el modelo). Lo que no entre en este
  // ciclo se procesa en el siguiente: el listado es amplio, no se pierde nada.
  let clasificadasEsteCiclo = 0;
  for (const m of mensajes) {
    if (!m.id) continue;

    // Duplicado: ya estaba en BD (Set precargado, sin query extra)
    if (yaClasificados.has(m.id)) {
      res.saltados++;
      continue;
    }

    // Tope por ciclo alcanzado → paramos (el resto se coge en el próximo ciclo)
    if (clasificadasEsteCiclo >= opts.maxClasificaciones) break;
    clasificadasEsteCiclo++;

    // Obtener mensaje completo
    let msgResp;
    try {
      msgResp = await gmail.users.messages.get({
        userId: "me",
        id: m.id,
        format: "full",
      });
    } catch (err) {
      res.errores++;
      res.detalles.push({
        gmail_message_id: m.id,
        accion: "error",
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    const headers = msgResp.data.payload?.headers;
    const asunto = getHeader(headers, "subject");
    const remitente = getHeader(headers, "from");
    const fechaHdr = getHeader(headers, "date");
    const fechaRecibida = fechaHdr ? new Date(fechaHdr) : new Date();
    const fechaIso = isNaN(fechaRecibida.getTime())
      ? new Date().toISOString()
      : fechaRecibida.toISOString();

    const cuerpo = extraerCuerpoTexto(msgResp.data.payload ?? undefined);
    const { tiene_adjuntos, nombres: nombres_adjuntos } = extraerAdjuntos(
      msgResp.data.payload ?? undefined
    );

    // Llamar al clasificador
    const input: EmailInput = {
      asunto,
      remitente,
      cuerpo,
      tiene_adjuntos,
      nombres_adjuntos,
      fecha_recibido: fechaIso,
    };

    const resultado = await clasificarEmail(input);

    if (!resultado.ok) {
      res.errores++;
      res.detalles.push({
        gmail_message_id: m.id,
        accion: "error",
        error: resultado.error + (resultado.detalles ? ": " + resultado.detalles : ""),
      });
      continue;
    }

    // Guardar en Postgres
    try {
      const c = resultado.clasificacion;
      const datosExtraidos = (c.datos_extraidos ?? {}) as Record<string, unknown>;

      await sql`
        INSERT INTO clasificaciones_agente (
          gmail_message_id,
          gmail_thread_id,
          cuenta_destino,
          asunto,
          remitente,
          fecha_recibido,
          tiene_adjuntos,
          nombres_adjuntos,
          cuerpo_preview,
          clasificacion,
          tipo,
          prioridad,
          confianza,
          accion_sugerida,
          es_industriastak,
          es_autoenvio_sql_pyme,
          modelo,
          input_tokens,
          output_tokens,
          cache_creation_input_tokens,
          cache_read_input_tokens,
          latencia_ms,
          stop_reason,
          coste_usd
        )
        VALUES (
          ${m.id},
          ${m.threadId ?? null},
          ${cuenta},
          ${asunto},
          ${remitente},
          ${fechaIso}::timestamptz,
          ${tiene_adjuntos},
          ${nombres_adjuntos},
          ${cuerpo.slice(0, 500)},
          ${JSON.stringify(c)}::jsonb,
          ${(c.tipo as string) ?? null},
          ${(c.prioridad as string) ?? null},
          ${(c.confianza as number) ?? null},
          ${(c.accion_sugerida as string) ?? null},
          ${(c.es_industriastak as boolean) ?? false},
          ${(datosExtraidos.es_autoenvio_sql_pyme as boolean) ?? false},
          ${resultado.modelo},
          ${resultado.uso.input_tokens},
          ${resultado.uso.output_tokens},
          ${resultado.uso.cache_creation_input_tokens},
          ${resultado.uso.cache_read_input_tokens},
          ${resultado.latencia_ms},
          ${resultado.stop_reason ?? null},
          ${resultado.coste_usd}
        )
        ON CONFLICT (gmail_message_id) DO NOTHING
      `;

      // ─── Escribir también en tablas legacy (clientes / emails / pedidos) ──
      // Esto reemplaza a Apps Script + sync horario: el dashboard antiguo
      // (Sheets/Postgres) ve los emails nuevos en cuanto los clasificamos.
      // Si falla, NO bloqueamos el procesado — la clasificación ya está
      // guardada en clasificaciones_agente. Solo dejamos constancia.
      let legacyStatus: "ok" | "falla" | "saltado" = "saltado";
      let legacyError: string | undefined;
      try {
        await escribirEnLegacy({
          gmail_message_id: m.id,
          gmail_thread_id: m.threadId ?? null,
          asunto,
          remitente,
          cuerpo,
          fecha_recibido: fechaIso,
          nombres_adjuntos,
          clasificacion: c,
        });
        legacyStatus = "ok";
        res.legacy_ok++;
      } catch (legacyErr) {
        legacyStatus = "falla";
        legacyError =
          legacyErr instanceof Error ? legacyErr.message : String(legacyErr);
        res.legacy_falla++;
        console.error(
          `[procesar-pendientes] Legacy write FALLO para ${m.id}:`,
          legacyError
        );
        // No relanzamos: el procesado del agente sigue contando como OK.
      }

      // ─── 4D: Auto-respuesta segura ──────────────────────────────────
      // Solo si el toggle está ON. Filtros estrictos antes de generar y
      // enviar. Cada paso registra el motivo si decide no enviar, para
      // que veas en logs por qué este email no recibió auto-respuesta.
      let autorespStatus:
        | "enviada"
        | "no_aplica"
        | "fallada"
        | "toggle_off"
        | "no_plantilla" = "toggle_off";
      let autorespRazon: string | undefined;
      let autorespError: string | undefined;

      if (configAutoReply.enabled) {
        const decision = puedeAutoResponder(
          {
            tipo: c.tipo as string | null | undefined,
            confianza: c.confianza as number | undefined,
            es_industriastak: c.es_industriastak as boolean | undefined,
            accion_sugerida: c.accion_sugerida as string | null | undefined,
            palabras_trampa_detectadas:
              (c.palabras_trampa_detectadas as string[] | undefined) ?? [],
            cliente_detectado:
              (c.cliente_detectado as
                | { email?: string; es_prospecto?: boolean }
                | undefined) ?? {},
            datos_extraidos: {
              es_autoenvio_sql_pyme: (datosExtraidos.es_autoenvio_sql_pyme as
                | boolean
                | undefined) ?? false,
            },
            asunto,
            cuerpo,
          },
          configAutoReply.min_confianza
        );

        if (!decision.puede) {
          autorespStatus = "no_aplica";
          autorespRazon = decision.razon +
            (decision.detalles ? ` (${decision.detalles})` : "");
          res.autoresp_no_aplica++;
        } else {
          // Generar plantilla
          const clienteDetectado =
            (c.cliente_detectado as
              | { email?: string; nombre?: string }
              | undefined) ?? {};
          const destinatarioEmail =
            (clienteDetectado.email ?? "").toLowerCase();
          const destinatarioNombre = clienteDetectado.nombre ?? "";

          const plantilla = generarPlantilla(c.tipo as string | undefined, {
            nombreCliente: destinatarioNombre,
            asuntoOriginal: asunto,
            idiomaDetectado: c.idioma as string | undefined,
          });

          if (!plantilla) {
            autorespStatus = "no_plantilla";
            autorespRazon = `tipo ${c.tipo} sin plantilla`;
            res.autoresp_no_aplica++;
          } else if (!destinatarioEmail || !destinatarioEmail.includes("@")) {
            autorespStatus = "no_aplica";
            autorespRazon = "destinatario_invalido";
            res.autoresp_no_aplica++;
          } else {
            // Insertar fila PRELIMINAR en respuestas_auto_enviadas con
            // enviado_ok=false. Si el envío falla, queda la auditoría.
            let respAutoId: number | null = null;
            try {
              const insertResult = await sql`
                INSERT INTO respuestas_auto_enviadas (
                  gmail_message_id_entrante,
                  gmail_thread_id,
                  cuenta_origen,
                  destinatario_email,
                  destinatario_nombre,
                  asunto_entrante,
                  asunto_respuesta,
                  cuerpo_respuesta,
                  tipo_email,
                  plantilla_usada,
                  enviado_ok
                )
                VALUES (
                  ${m.id},
                  ${m.threadId ?? null},
                  ${cuenta},
                  ${destinatarioEmail},
                  ${destinatarioNombre},
                  ${asunto},
                  ${plantilla.asunto},
                  ${plantilla.cuerpo},
                  ${(c.tipo as string) ?? null},
                  ${plantilla.id},
                  false
                )
                ON CONFLICT (gmail_message_id_entrante)
                  WHERE enviado_ok = true
                DO NOTHING
                RETURNING id
              `;

              if (insertResult.length === 0) {
                // Ya había una respuesta enviada para este email → anti-dup
                autorespStatus = "no_aplica";
                autorespRazon = "ya_respondido_antes";
                res.autoresp_no_aplica++;
              } else {
                respAutoId = insertResult[0].id as number;

                // Enviar vía Gmail
                const envio = await enviarRespuestaAutomatica({
                  cuentaOrigen: cuenta,
                  destinatarioEmail,
                  destinatarioNombre,
                  asunto: plantilla.asunto,
                  cuerpoTexto: plantilla.cuerpo,
                  inReplyToMessageId: m.id,
                  threadId: m.threadId ?? null,
                  plantillaId: plantilla.id,
                });

                if (envio.ok) {
                  autorespStatus = "enviada";
                  res.autoresp_enviadas++;
                  // Actualizar fila marcando éxito
                  await sql`
                    UPDATE respuestas_auto_enviadas
                    SET enviado_ok = true,
                        enviado_at = NOW(),
                        gmail_message_id_enviado = ${envio.gmail_message_id_enviado ?? null}
                    WHERE id = ${respAutoId}
                  `;
                } else {
                  autorespStatus = "fallada";
                  autorespError = envio.error;
                  res.autoresp_falladas++;
                  await sql`
                    UPDATE respuestas_auto_enviadas
                    SET error_envio = ${envio.error ?? null}
                    WHERE id = ${respAutoId}
                  `;
                }
              }
            } catch (autoErr) {
              autorespStatus = "fallada";
              autorespError =
                autoErr instanceof Error ? autoErr.message : String(autoErr);
              res.autoresp_falladas++;
              console.error(
                `[procesar-pendientes] Auto-respuesta FALLO para ${m.id}:`,
                autorespError
              );
            }
          }
        }
      }

      res.procesados++;
      res.detalles.push({
        gmail_message_id: m.id,
        accion: "procesado",
        tipo_clasificado: (c.tipo as string) ?? "?",
        legacy: legacyStatus,
        legacy_error: legacyError,
        autoresp: autorespStatus,
        autoresp_razon: autorespRazon,
        autoresp_error: autorespError,
        latencia_ms: resultado.latencia_ms,
      });
    } catch (err) {
      res.errores++;
      res.detalles.push({
        gmail_message_id: m.id,
        accion: "error",
        error:
          "Error al insertar en BD: " +
          (err instanceof Error ? err.message : String(err)),
      });
    }
  }

  return res;
}

export async function GET(req: NextRequest) {
  // Verificar auth
  if (!verificarCronSecret(req)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Unauthorized. Falta header 'Authorization: Bearer <CRON_SECRET>' o el secreto no coincide.",
      },
      { status: 401 }
    );
  }

  const t0 = Date.now();

  // Parámetros opcionales (backfill manual y ajuste fino):
  //   ?dias=30      ventana de días del INBOX a inspeccionar
  //   ?max=8        máximo de clasificaciones nuevas por ciclo y cuenta
  //   ?listar=250   tope de mensajes a listar
  //   ?q=from:...   filtro extra de Gmail (backfill dirigido)
  const { searchParams } = new URL(req.url);
  const parseNum = (
    v: string | null,
    def: number,
    min: number,
    max: number
  ): number => {
    const n = v == null ? NaN : parseInt(v, 10);
    return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : def;
  };
  const opts: OpcionesProcesado = {
    dias: parseNum(searchParams.get("dias"), VENTANA_DIAS_DEFECTO, 1, 90),
    maxClasificaciones: parseNum(
      searchParams.get("max"),
      MAX_CLASIFICACIONES_POR_CICLO_DEFECTO,
      1,
      20
    ),
    maxListar: parseNum(
      searchParams.get("listar"),
      MAX_MENSAJES_LISTAR,
      10,
      500
    ),
    queryExtra: searchParams.get("q")?.trim() || undefined,
  };

  // Leemos la config del toggle auto-respuesta UNA VEZ por invocación
  // (no por cuenta y desde luego no por email — evitamos N+1 queries).
  const configAutoReply = await leerConfigAutoReply();

  // Procesamos las cuentas en PARALELO con Promise.all. Cada cuenta es
  // independiente (distinto cliente Gmail, distintos mensajes), así que
  // pasar de 4 cuentas secuenciales a 4 paralelas reduce la latencia
  // worst-case de ~4× a ~1×. Cada llamada a clasificarEmail() sigue siendo
  // secuencial DENTRO de una cuenta para no martillear la API.
  const porCuenta: ResultadoPorCuenta[] = await Promise.all(
    CUENTAS_A_PROCESAR.map((cuenta) =>
      procesarCuenta(cuenta, configAutoReply, opts)
    )
  );

  const totalProcesados = porCuenta.reduce((a, b) => a + b.procesados, 0);
  const totalSaltados = porCuenta.reduce((a, b) => a + b.saltados, 0);
  const totalErrores = porCuenta.reduce((a, b) => a + b.errores, 0);

  // Registrar el ciclo en eventos para auditoría
  await sql`
    INSERT INTO eventos (tipo, nivel, mensaje, detalles, ejecutado_por)
    VALUES (
      'agente_procesar_pendientes',
      ${totalErrores > 0 ? "warning" : "info"},
      ${`Cron shadow mode: ${totalProcesados} procesados, ${totalSaltados} saltados, ${totalErrores} errores`},
      ${JSON.stringify({
        total_procesados: totalProcesados,
        total_saltados: totalSaltados,
        total_errores: totalErrores,
        por_cuenta: porCuenta,
        latencia_total_ms: Date.now() - t0,
      })}::jsonb,
      'cron'
    )
  `.catch((err: unknown) => {
    console.error("[procesar-pendientes] No se pudo registrar evento:", err);
  });

  return NextResponse.json({
    ok: true,
    procesados: totalProcesados,
    saltados: totalSaltados,
    errores: totalErrores,
    latencia_total_ms: Date.now() - t0,
    por_cuenta: porCuenta,
  });
}
