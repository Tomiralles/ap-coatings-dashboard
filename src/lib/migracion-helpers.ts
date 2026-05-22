/**
 * Funciones auxiliares para la migración de Sheets → Postgres.
 *
 * Extraen información estructurada de los campos crudos del Sheet:
 * - emails, nombres y empresas a partir del campo "quien"
 * - número de pedido a partir del asunto
 * - clasificación del email a partir de estado/tipo/asunto
 * - parseo de fechas en formato JS toString()
 */

import { createHash } from "crypto";

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i;
const DOMINIOS_GENERICOS = new Set([
  "gmail.com",
  "hotmail.com",
  "outlook.com",
  "yahoo.com",
  "icloud.com",
  "live.com",
  "msn.com",
]);

export interface QuienParseado {
  email: string;
  nombre: string;
  empresa: string | null;
}

/**
 * Extrae email, nombre y empresa del campo "quien" del Sheet.
 *
 * Formatos típicos que aparecen:
 *   - "Nombre Apellido" <email@dominio.com>
 *   - email@dominio.com
 *   - Solo nombre sin email
 *   - "Abad Pinturas S.l." <abadpinturas@abadpinturas.com>
 */
export function parsearQuien(quien: string): QuienParseado {
  const limpio = (quien || "").trim();

  const matchEmail = limpio.match(EMAIL_REGEX);
  const email = matchEmail ? matchEmail[0].toLowerCase() : "";

  // Nombre = lo que está antes del email, sin comillas ni <>
  let nombre = limpio
    .replace(EMAIL_REGEX, "")
    .replace(/[<>"]/g, "")
    .trim();

  // Si no hay nombre claro, usar la parte local del email
  if (!nombre && email) {
    nombre = email.split("@")[0];
  }

  // Empresa: derivada del dominio (si no es genérico) o del nombre
  let empresa: string | null = null;
  if (email) {
    const dominio = email.split("@")[1];
    if (dominio && !DOMINIOS_GENERICOS.has(dominio.toLowerCase())) {
      // Toma la parte antes del primer punto del dominio y la capitaliza
      const empresaDeDominio = dominio.split(".")[0];
      empresa = empresaDeDominio.charAt(0).toUpperCase() + empresaDeDominio.slice(1);
    }
  }

  return {
    email: email || `sin-email-${createHash("md5").update(limpio).digest("hex").slice(0, 8)}@desconocido.local`,
    nombre: nombre || "Desconocido",
    empresa,
  };
}

/**
 * Limpia el asunto quitando prefijos comunes de respuesta/reenvío.
 */
export function limpiarAsunto(asunto: string): string {
  if (!asunto) return "";
  return asunto
    .replace(/^\s*(Re|RE|Fwd|FW|Rv|RV|R)\s*:\s*/gi, "")
    .replace(/^\s*(Re|RE|Fwd|FW|Rv|RV|R)\s*:\s*/gi, "") // segunda pasada para anidados
    .trim();
}

/**
 * Parsea fechas en formato JS toString() ("Thu Feb 05 2026 15:41:28 GMT+0100 ...")
 * o en formato ISO o cualquier otro que Date pueda interpretar.
 */
export function parsearFecha(str: string): Date | null {
  if (!str) return null;
  const d = new Date(str);
  if (isNaN(d.getTime())) return null;
  return d;
}

/**
 * Extrae el número de pedido del asunto.
 *
 * Patrones que detecta:
 *   - "Pedido 26-158"       → "26-158"
 *   - "pedido 26-158"       → "26-158"
 *   - "PED-26-158"          → "26-158"
 *   - "Pedido P1984"        → "P1984"
 *   - "Pedido 26302334"     → "26302334"
 */
export function extraerNumeroPedido(asunto: string): string | null {
  if (!asunto) return null;

  // Patrón 1: "Pedido NN-NNN" o "pedido NN-NNN"
  const m1 = asunto.match(/\bpedido\s+([0-9]+(?:-[0-9]+)?)\b/i);
  if (m1) return m1[1];

  // Patrón 2: "PED-NN-NNN"
  const m2 = asunto.match(/\bPED-([0-9]+-[0-9]+)\b/i);
  if (m2) return m2[1];

  // Patrón 3: "Pedido P1984" (formato con letra)
  const m3 = asunto.match(/\bpedido\s+([A-Z]\d+)\b/i);
  if (m3) return m3[1];

  return null;
}

/**
 * Mapea (estado_legacy, tipo_legacy, asunto) → tipo_email ENUM de Postgres.
 *
 * estado_legacy: lo que había en la columna "estado" del Sheet
 * tipo_legacy: lo que había en la columna "tipo" del Sheet
 */
export function clasificarTipo(
  estadoLegacy: string,
  tipoLegacy: string,
  asunto: string
): string {
  const e = (estadoLegacy || "").toLowerCase();
  const t = (tipoLegacy || "").toLowerCase();
  const a = (asunto || "").toLowerCase();

  // Facturas proveedor
  if (e.includes("factura proveedor") || t.includes("factura")) {
    return "factura_proveedor";
  }

  // Pedidos cliente
  if (
    e.includes("pendiente (pedido)") ||
    t.includes("pedido") ||
    /\bpedido\b/i.test(a)
  ) {
    return "pedido_cliente";
  }

  // Consultas cliente
  if (e.includes("pendiente (consulta)") || t.includes("consulta")) {
    return "consulta_cliente";
  }

  // Muestras
  if (t.includes("muestra") || /\bmuestra/i.test(a)) {
    return "muestra_cliente";
  }

  // Fichas
  if (t.includes("ficha técnica") || /\bficha\s*técnica\b/i.test(a)) {
    return "ficha_tecnica";
  }
  if (t.includes("ficha seguridad") || t.includes("fds") || /\bfds\b/i.test(a)) {
    return "ficha_seguridad";
  }

  // Logística (envíos, albaranes, notificaciones de transportistas)
  if (
    t.includes("notificacion") ||
    t.includes("notificación") ||
    /\balbaran\b/i.test(a) ||
    /\balbarán\b/i.test(a) ||
    /\bsaliendo de origen\b/i.test(a)
  ) {
    return "logistica";
  }

  // Por defecto
  return "otro";
}

/**
 * Genera un ID único sintético para el email migrado.
 * Combina índice, fecha y hash del contenido para garantizar idempotencia.
 *
 * Si vuelves a ejecutar la migración, el mismo ID se genera y el UPSERT
 * lo identifica como "ya existe" y no lo duplica.
 */
export function generarMessageIdLegacy(
  idx: number,
  fecha: string,
  email: string,
  asunto: string
): string {
  const seed = `${fecha}|${email}|${asunto}`;
  const hash = createHash("sha1").update(seed).digest("hex").slice(0, 12);
  return `legacy-${String(idx).padStart(4, "0")}-${hash}`;
}

/**
 * Detecta si un cliente debería marcarse como VIP / Industriastak.
 */
export function esIndustriastak(email: string, nombre: string, empresa: string | null): boolean {
  const texto = `${email} ${nombre} ${empresa || ""}`.toLowerCase();
  return /\bindustriastak\b/.test(texto) || /\bindustria\s*stack\b/.test(texto);
}

/**
 * Detecta si un email corresponde a un autoenvío de SQL Pyme.
 * Esto requiere combinar: asunto + adjunto + remitente corporativo.
 */
export function esAutoenvioSqlPyme(quien: string, asunto: string, enlace: string): boolean {
  const remitente = (quien || "").toLowerCase();
  const a = (asunto || "").toLowerCase();
  const url = (enlace || "").toLowerCase();

  const esRemitenteCorporativo =
    /abadpinturas\.com/.test(remitente) || /apcoatings\.net/.test(remitente);
  const tieneAsuntoPedido = /\bpedido\s+[0-9]+(?:-[0-9]+)?/.test(a);
  const tieneAdjunto = url.includes("drive.google.com");

  return esRemitenteCorporativo && tieneAsuntoPedido && tieneAdjunto;
}
