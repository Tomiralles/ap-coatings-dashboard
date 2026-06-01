/**
 * Escribe los datos de una clasificación del agente en las tablas
 * "legacy" (las del dashboard antiguo): clientes, emails, pedidos.
 *
 * Esto se llama desde procesar-pendientes después de clasificar un email
 * con Claude. Resultado: el dashboard (Pedidos/Facturas/Consultas) ve
 * los emails nuevos en tiempo real, **sin depender de Apps Script**.
 *
 * Diseño:
 *   - Idempotente: ON CONFLICT (gmail_message_id) DO UPDATE → si el mismo
 *     email se procesa dos veces no duplica filas.
 *   - Tolerante a fallos: si la escritura legacy falla, lanza error pero
 *     NO impide que la clasificación se guarde en clasificaciones_agente.
 *     Es decir: peor caso → tenemos la clasificación, no se ve en dashboard
 *     legacy hasta arreglarlo.
 *
 * Mapeo de tipos:
 *   El agente devuelve tipos como `pedido_cliente_telefono`, `consulta_tecnica`,
 *   etc. La tabla legacy tiene un enum `tipo_email` con valores más limitados
 *   (`pedido_cliente`, `factura_proveedor`, `consulta_cliente`, `muestra_cliente`,
 *   `ficha_tecnica`, `ficha_seguridad`, `logistica`, `otro`). Mapeamos
 *   con `mapearTipoAgenteALegacy()`.
 */

import { sql } from "@/lib/db";
import { parsearQuien } from "@/lib/migracion-helpers";

/**
 * Tipos del agente → tipos del enum legacy `tipo_email`.
 * Si llega un tipo no contemplado, cae a 'otro'.
 */
const TIPO_AGENTE_A_LEGACY: Record<string, string> = {
  pedido_cliente: "pedido_cliente",
  pedido_cliente_telefono: "pedido_cliente",
  pedido_proveedor: "otro", // no hay equivalente exacto en legacy
  factura_proveedor: "factura_proveedor",
  factura_cliente: "factura_proveedor",
  consulta_comercial: "consulta_cliente",
  consulta_tecnica: "consulta_cliente",
  consulta_cliente: "consulta_cliente",
  estado_pedido: "consulta_cliente",
  muestra_cliente: "muestra_cliente",
  albaran: "logistica",
  logistica: "logistica",
  reclamacion: "consulta_cliente",
  ficha_tecnica: "ficha_tecnica",
  ficha_seguridad: "ficha_seguridad",
  spam: "otro",
  otro: "otro",
};

function mapearTipoAgenteALegacy(tipoAgente: string | null | undefined): string {
  if (!tipoAgente) return "otro";
  return TIPO_AGENTE_A_LEGACY[tipoAgente] ?? "otro";
}

/**
 * Estado inicial de un email recién clasificado por el agente.
 *
 * El enum legacy `estado_email` en Postgres NO acepta "pendiente" — solo
 * "archivado" entre otros. La migración antigua usaba siempre "archivado"
 * y el dashboard deriva el estado real desde otros campos (tipo, fecha,
 * datos_extraidos.accion_sugerida).
 *
 * Por consistencia con la migración, usamos siempre "archivado". El estado
 * de acción ("pendiente / enviado / etc.") vive en datos_extraidos donde
 * el dashboard ya lo lee.
 */
function estadoInicialLegacy(_tipoLegacy: string): string {
  return "archivado";
}

export interface EscribirLegacyParams {
  gmail_message_id: string;
  gmail_thread_id: string | null;
  asunto: string;
  remitente: string;
  cuerpo: string;
  fecha_recibido: string; // ISO 8601
  nombres_adjuntos: string[];
  clasificacion: Record<string, unknown>;
}

export interface EscribirLegacyResultado {
  cliente_id: string;
  email_id: string;
  pedido_id: string | null;
  es_cliente_nuevo: boolean;
  es_email_nuevo: boolean;
  es_pedido_nuevo: boolean;
  tipo_legacy: string;
}

/**
 * Escribe las 3 tablas legacy a partir de una clasificación.
 * Idempotente: se puede llamar varias veces con el mismo gmail_message_id.
 */
export async function escribirEnLegacy(
  params: EscribirLegacyParams
): Promise<EscribirLegacyResultado> {
  const {
    gmail_message_id,
    gmail_thread_id,
    asunto,
    remitente,
    cuerpo,
    fecha_recibido,
    nombres_adjuntos,
    clasificacion,
  } = params;

  // ─── 1. Sacar datos del cliente ─────────────────────────────────────
  // Preferimos los datos extraídos por el agente (suelen ser más limpios).
  // Si no, parseamos el remitente con el helper antiguo.
  const clienteDetectado = (clasificacion.cliente_detectado ?? {}) as Record<
    string,
    unknown
  >;
  const datosExtraidos = (clasificacion.datos_extraidos ?? {}) as Record<
    string,
    unknown
  >;

  const quienParseado = parsearQuien(remitente);

  const email =
    (clienteDetectado.email as string | undefined)?.toLowerCase() ||
    quienParseado.email;
  const nombre =
    (clienteDetectado.nombre as string | undefined) || quienParseado.nombre;
  const empresa =
    (clienteDetectado.empresa as string | null | undefined) ??
    quienParseado.empresa;
  const esVip = (clasificacion.es_industriastak as boolean) ?? false;

  // ─── 2. UPSERT cliente ──────────────────────────────────────────────
  const clienteResult = await sql`
    INSERT INTO clientes (
      email, nombre, empresa, telefono,
      es_vip, es_industriastak,
      primer_contacto, ultimo_contacto
    )
    VALUES (
      ${email},
      ${nombre},
      ${empresa},
      NULL,
      ${esVip},
      ${esVip},
      ${fecha_recibido}::timestamptz,
      ${fecha_recibido}::timestamptz
    )
    ON CONFLICT (email) DO UPDATE SET
      nombre = COALESCE(EXCLUDED.nombre, clientes.nombre),
      empresa = COALESCE(EXCLUDED.empresa, clientes.empresa),
      es_vip = clientes.es_vip OR EXCLUDED.es_vip,
      es_industriastak = clientes.es_industriastak OR EXCLUDED.es_industriastak,
      ultimo_contacto = GREATEST(clientes.ultimo_contacto, EXCLUDED.ultimo_contacto)
    RETURNING id, (xmax = 0) AS es_nuevo
  `;
  const cliente_id = clienteResult[0].id as string;
  const es_cliente_nuevo = clienteResult[0].es_nuevo as boolean;

  // ─── 3. UPSERT email ────────────────────────────────────────────────
  const tipoLegacy = mapearTipoAgenteALegacy(
    clasificacion.tipo as string | undefined
  );
  const estadoLegacy = estadoInicialLegacy(tipoLegacy);

  // Adjuntos en formato JSONB (igual estructura que la migración antigua)
  const adjuntosInfo = nombres_adjuntos.map((nombre) => ({
    nombre,
    drive_url: null,
    tipo: nombre.toLowerCase().endsWith(".pdf") ? "pdf" : "otro",
  }));

  // "Estado funcional" derivado: lo que el dashboard usará para distinguir
  // pendiente vs archivado más allá del enum estado_email (limitado).
  // Facturas y logística entran como "archivado" funcional (informativo,
  // no requieren acción). Pedidos y consultas como "pendiente".
  const estadoFuncional =
    tipoLegacy === "factura_proveedor" ||
    tipoLegacy === "logistica" ||
    tipoLegacy === "otro"
      ? "archivado"
      : "pendiente";

  // Datos enriquecidos extraídos por el agente — los guardamos como JSONB
  // para que el dashboard pueda mostrarlos opcionalmente sin queries extra.
  const datosLegacy = {
    fuente: "agente_ia",
    modelo_clasificador: (clasificacion.modelo as string) ?? null,
    confianza_agente: clasificacion.confianza ?? null,
    prioridad_agente: clasificacion.prioridad ?? null,
    estado_funcional: estadoFuncional, // <-- usado por dashboard para filtros
    accion_sugerida: clasificacion.accion_sugerida ?? null,
    idioma: clasificacion.idioma ?? null,
    razon_clasificacion: clasificacion.razon ?? null,
    productos_mencionados: datosExtraidos.productos_mencionados ?? [],
    cantidades_mencionadas: datosExtraidos.cantidades_mencionadas ?? [],
    numero_pedido: datosExtraidos.numero_pedido ?? null,
    numero_factura: datosExtraidos.numero_factura ?? null,
    proveedor: datosExtraidos.proveedor ?? null,
    es_autoenvio_sql_pyme: datosExtraidos.es_autoenvio_sql_pyme ?? false,
  };

  const emailResult = await sql`
    INSERT INTO emails (
      gmail_message_id,
      remitente_email,
      remitente_nombre,
      empresa_detectada,
      cliente_id,
      asunto,
      asunto_limpio,
      cuerpo,
      adjuntos_count,
      adjuntos_info,
      tipo,
      estado,
      datos_extraidos,
      recibido_en,
      procesado_en
    )
    VALUES (
      ${gmail_message_id},
      ${email},
      ${nombre},
      ${empresa},
      ${cliente_id},
      ${asunto || ""},
      ${(asunto || "").replace(/^\s*(Re|RE|Fwd|FW|Rv|RV|R)\s*:\s*/gi, "")},
      ${cuerpo || ""},
      ${adjuntosInfo.length},
      ${JSON.stringify(adjuntosInfo)}::jsonb,
      ${tipoLegacy}::tipo_email,
      ${estadoLegacy}::estado_email,
      ${JSON.stringify(datosLegacy)}::jsonb,
      ${fecha_recibido}::timestamptz,
      NOW()
    )
    ON CONFLICT (gmail_message_id) DO UPDATE SET
      tipo = EXCLUDED.tipo,
      datos_extraidos = EXCLUDED.datos_extraidos,
      cliente_id = COALESCE(emails.cliente_id, EXCLUDED.cliente_id),
      updated_at = NOW()
    RETURNING id, (xmax = 0) AS es_nuevo
  `;

  const email_id = emailResult[0].id as string;
  const es_email_nuevo = emailResult[0].es_nuevo as boolean;

  // ─── 4. Crear pedido si aplica ──────────────────────────────────────
  let pedido_id: string | null = null;
  let es_pedido_nuevo = false;

  const numeroPedido = datosExtraidos.numero_pedido as string | null | undefined;
  const esPedido = tipoLegacy === "pedido_cliente";

  if (esPedido && numeroPedido) {
    const pedidoResult = await sql`
      INSERT INTO pedidos (
        numero_externo,
        cliente_id,
        email_origen_id,
        fecha_pedido,
        pdf_drive_url,
        estado
      )
      VALUES (
        ${numeroPedido},
        ${cliente_id},
        ${email_id},
        ${fecha_recibido.split("T")[0]}::date,
        NULL,
        'pendiente'::estado_pedido
      )
      ON CONFLICT (numero_externo) DO NOTHING
      RETURNING id, (xmax = 0) AS es_nuevo
    `;

    if (pedidoResult.length > 0) {
      pedido_id = pedidoResult[0].id as string;
      es_pedido_nuevo = pedidoResult[0].es_nuevo as boolean;
    }
  }

  return {
    cliente_id,
    email_id,
    pedido_id,
    es_cliente_nuevo,
    es_email_nuevo,
    es_pedido_nuevo,
    tipo_legacy: tipoLegacy,
  };
}
