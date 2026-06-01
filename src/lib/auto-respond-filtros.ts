/**
 * Filtros de seguridad para decidir si el agente puede auto-responder
 * un email determinado.
 *
 * La regla de oro: en caso de duda, NO responder.
 * Es mejor que Toni vea un email de más a que el agente conteste algo
 * que no debería.
 */

import { CUENTAS_VIGILADAS } from "@/lib/cuentas-vigiladas";

/**
 * Tipos del agente que sí pueden recibir una auto-respuesta segura.
 * Cualquier otro tipo (estado_pedido, reclamacion, spam, otro, etc.)
 * se escala a Toni siempre.
 */
const TIPOS_AUTORESPONDIBLES = new Set([
  "pedido_cliente",
  "pedido_cliente_telefono",
  "factura_proveedor",
  "muestra_cliente",
  "consulta_comercial",
  "consulta_tecnica",
  "consulta_cliente",
]);

/**
 * Tipos especiales que NUNCA se auto-responden, pase lo que pase.
 * Independiente de confianza o cualquier otra cosa.
 */
const TIPOS_PROHIBIDOS = new Set([
  "reclamacion",
  "estado_pedido", // implican confirmar plazos/datos concretos
  "spam",
  "otro",
]);

/**
 * Palabras en el cuerpo o asunto que vetan la auto-respuesta.
 * Indican que el cliente quiere algo concreto (precio, fecha, urgencia,
 * queja) que necesita criterio humano.
 */
const PALABRAS_VETO = [
  "reclamo",
  "reclamación",
  "queja",
  "denuncia",
  "abogado",
  "devolución",
  "devolucion",
  "defecto",
  "defectuoso",
  "roto",
  "rotura",
  "no funciona",
  "no me ha llegado",
  "no llegó",
  "no llego",
];

/**
 * Dominios "técnicos" que nunca deben recibir respuesta.
 * Anti-bucle y anti-spam.
 */
const DOMINIOS_PROHIBIDOS = [
  "noreply",
  "no-reply",
  "donotreply",
  "mailer-daemon",
  "postmaster",
  "bounce",
  "notification",
  "notifications",
];

export interface ClasificacionParaFiltro {
  tipo?: string | null;
  confianza?: number | string | null;
  es_industriastak?: boolean;
  accion_sugerida?: string | null;
  palabras_trampa_detectadas?: string[];
  cliente_detectado?: {
    email?: string;
    es_prospecto?: boolean;
  };
  datos_extraidos?: {
    es_autoenvio_sql_pyme?: boolean;
  };
  // texto crudo para chequeo de palabras
  asunto?: string;
  cuerpo?: string;
}

export interface DecisionFiltro {
  puede: boolean;
  razon: string;
  detalles?: string;
}

/**
 * Decide si una clasificación puede recibir auto-respuesta.
 * Devuelve { puede, razon } con explicación humana.
 */
export function puedeAutoResponder(
  clasif: ClasificacionParaFiltro,
  minConfianza: number = 0.9
): DecisionFiltro {
  // 1. Tipo debe estar en whitelist
  const tipo = (clasif.tipo ?? "").toLowerCase();
  if (!tipo) {
    return { puede: false, razon: "sin_tipo" };
  }
  if (TIPOS_PROHIBIDOS.has(tipo)) {
    return { puede: false, razon: "tipo_prohibido", detalles: tipo };
  }
  if (!TIPOS_AUTORESPONDIBLES.has(tipo)) {
    return { puede: false, razon: "tipo_no_whitelist", detalles: tipo };
  }

  // 2. Confianza suficiente
  const confianza =
    clasif.confianza == null
      ? 0
      : typeof clasif.confianza === "string"
        ? parseFloat(clasif.confianza)
        : clasif.confianza;
  if (confianza < minConfianza) {
    return {
      puede: false,
      razon: "confianza_baja",
      detalles: `${confianza} < ${minConfianza}`,
    };
  }

  // 3. NUNCA Industriastak (VIP)
  if (clasif.es_industriastak) {
    return { puede: false, razon: "industriastak_vip" };
  }

  // 4. Si el propio agente decidió escalar, respetar
  if (clasif.accion_sugerida === "escalar_a_humano") {
    return { puede: false, razon: "agente_pidio_escalar" };
  }

  // 5. Palabras-trampa: si el agente detectó alguna, sospechamos
  if (
    clasif.palabras_trampa_detectadas &&
    clasif.palabras_trampa_detectadas.length > 0
  ) {
    return {
      puede: false,
      razon: "palabras_trampa",
      detalles: clasif.palabras_trampa_detectadas.join(","),
    };
  }

  // 6. Prospecto nuevo (cliente no conocido) → escalar a comercial
  if (clasif.cliente_detectado?.es_prospecto) {
    return { puede: false, razon: "prospecto_nuevo" };
  }

  // 7. Anti-bucle: no responder a nuestras propias cuentas
  const emailDestino = (clasif.cliente_detectado?.email ?? "").toLowerCase();
  if (CUENTAS_VIGILADAS.includes(emailDestino as never)) {
    return { puede: false, razon: "anti_bucle_dominio_propio" };
  }

  // 8. Anti-bucle: no responder a noreply / mailer-daemon / etc.
  for (const patron of DOMINIOS_PROHIBIDOS) {
    if (emailDestino.includes(patron)) {
      return {
        puede: false,
        razon: "dominio_sistema",
        detalles: patron,
      };
    }
  }

  // 9. Anti-bucle: emails del propio dominio apcoatings.net
  // (probablemente reenvíos internos o el propio SQL Pyme autoenvío)
  if (emailDestino.endsWith("@apcoatings.net")) {
    return { puede: false, razon: "dominio_apcoatings_interno" };
  }

  // 10. Autoenvíos SQL Pyme: NO responder, son del propio Toni
  if (clasif.datos_extraidos?.es_autoenvio_sql_pyme) {
    return { puede: false, razon: "autoenvio_sql_pyme" };
  }

  // 11. Palabras de veto en asunto o cuerpo (reclamaciones, defectos…)
  const textoCompleto = `${clasif.asunto ?? ""} ${clasif.cuerpo ?? ""}`.toLowerCase();
  for (const palabra of PALABRAS_VETO) {
    if (textoCompleto.includes(palabra)) {
      return {
        puede: false,
        razon: "palabra_veto",
        detalles: palabra,
      };
    }
  }

  // ¡PASA TODOS LOS FILTROS! Puede auto-responder
  return { puede: true, razon: "ok" };
}
