import { NextRequest, NextResponse } from "next/server";
import { gmail_v1 } from "googleapis";
import { sql } from "@/lib/db";
import { getGmailClient } from "@/lib/google-auth";
import { clasificarEmail, EmailInput } from "@/lib/clasificador";
import { CUENTAS_VIGILADAS } from "@/lib/cuentas-vigiladas";
import { escribirEnLegacy } from "@/lib/escribir-legacy";

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
 * Número máximo de mensajes a inspeccionar por cuenta en cada ciclo.
 * Bajamos a 3 para que la latencia máxima por cuenta sea
 * ~3 × 5.5s = 16s, dejando margen dentro del timeout de cron-job.org
 * (30s en plan free) y del maxDuration de Vercel (60s).
 */
const MAX_MENSAJES_POR_CUENTA = 3;

interface ResultadoPorCuenta {
  cuenta: string;
  inspeccionados: number;
  procesados: number;
  saltados: number;
  errores: number;
  legacy_ok: number;       // escrituras a tablas legacy exitosas
  legacy_falla: number;    // escrituras a tablas legacy fallidas (no bloquea)
  detalles: Array<{
    gmail_message_id: string;
    accion: "procesado" | "saltado_ya_existe" | "error" | "auth_falla";
    tipo_clasificado?: string;
    legacy?: "ok" | "falla" | "saltado";
    legacy_error?: string;
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
async function procesarCuenta(cuenta: string): Promise<ResultadoPorCuenta> {
  const res: ResultadoPorCuenta = {
    cuenta,
    inspeccionados: 0,
    procesados: 0,
    saltados: 0,
    errores: 0,
    legacy_ok: 0,
    legacy_falla: 0,
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

  // 1. Listar los últimos N mensajes del INBOX
  let listResp;
  try {
    listResp = await gmail.users.messages.list({
      userId: "me",
      labelIds: ["INBOX"],
      maxResults: MAX_MENSAJES_POR_CUENTA,
    });
  } catch (err) {
    res.errores++;
    res.detalles.push({
      gmail_message_id: "(list_falla)",
      accion: "error",
      error: err instanceof Error ? err.message : String(err),
    });
    return res;
  }

  const mensajes = listResp.data.messages ?? [];
  res.inspeccionados = mensajes.length;

  // 2. Para cada mensaje, comprobar si ya está en BD; si no, clasificar
  // (secuencial DENTRO de la cuenta para no martillear Anthropic API)
  for (const m of mensajes) {
    if (!m.id) continue;

    // Comprobar duplicado por gmail_message_id
    const yaExiste = await sql`
      SELECT 1 FROM clasificaciones_agente
      WHERE gmail_message_id = ${m.id}
      LIMIT 1
    `;
    if (yaExiste.length > 0) {
      res.saltados++;
      res.detalles.push({
        gmail_message_id: m.id,
        accion: "saltado_ya_existe",
      });
      continue;
    }

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

      res.procesados++;
      res.detalles.push({
        gmail_message_id: m.id,
        accion: "procesado",
        tipo_clasificado: (c.tipo as string) ?? "?",
        legacy: legacyStatus,
        legacy_error: legacyError,
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

  // Procesamos las cuentas en PARALELO con Promise.all. Cada cuenta es
  // independiente (distinto cliente Gmail, distintos mensajes), así que
  // pasar de 4 cuentas secuenciales a 4 paralelas reduce la latencia
  // worst-case de ~4× a ~1×. Cada llamada a clasificarEmail() sigue siendo
  // secuencial DENTRO de una cuenta para no martillear la API.
  const porCuenta: ResultadoPorCuenta[] = await Promise.all(
    CUENTAS_A_PROCESAR.map((cuenta) => procesarCuenta(cuenta))
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
  `.catch((err) => {
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
