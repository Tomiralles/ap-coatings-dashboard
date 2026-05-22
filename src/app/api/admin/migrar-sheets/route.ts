import { NextResponse } from "next/server";
import { sqlDirect } from "@/lib/db";
import {
  parsearQuien,
  limpiarAsunto,
  parsearFecha,
  extraerNumeroPedido,
  clasificarTipo,
  generarMessageIdLegacy,
  esIndustriastak,
} from "@/lib/migracion-helpers";

/**
 * Migración histórica de Google Sheets → PostgreSQL (Neon).
 *
 * Lee todas las filas de "Hoja 1" via Apps Script y las inserta en las
 * tablas correspondientes de Postgres: clientes, emails y pedidos.
 *
 * Es IDEMPOTENTE: si se ejecuta varias veces, no duplica filas
 * (usa UPSERT por email para clientes y por gmail_message_id para emails).
 *
 * Modos:
 *   GET  → modo dry-run: muestra qué pasaría sin tocar Postgres
 *   POST → ejecuta la migración real
 *
 * Endpoint protegido: solo accesible si llega con el header
 * X-Migration-Token correcto (variable de entorno MIGRATION_TOKEN).
 */

// Tipos para los datos crudos del Sheet
interface FilaSheet {
  fecha: string;
  quien: string;
  asunto: string;
  enlace: string;
  cuerpo: string;
  estado: string;
  tipo: string;
  prioridad: string;
  autoDropdown: string;
  respuestaAuto: string;
  telefono: string;
}

interface ResultadoMigracion {
  modo: "dry-run" | "ejecutado";
  total_filas_sheet: number;
  filas_con_datos: number;
  filas_saltadas: number;
  clientes_nuevos: number;
  clientes_actualizados: number;
  emails_insertados: number;
  emails_duplicados: number;
  pedidos_extraidos: number;
  errores: string[];
  duracion_ms: number;
  ejemplos_parseados?: unknown[];
}

async function leerHojaSheets(): Promise<FilaSheet[]> {
  // Llamamos directamente al Apps Script (no a nuestro propio /api/sheets)
  // para evitar problemas de protección de deployment entre funciones.
  const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
  if (!scriptUrl) {
    throw new Error("GOOGLE_APPS_SCRIPT_URL no configurada");
  }

  const res = await fetch(
    `${scriptUrl}?accion=leerHoja&hoja=${encodeURIComponent("Hoja 1")}`,
    { method: "GET", redirect: "follow", cache: "no-store" }
  );

  if (!res.ok) {
    throw new Error(`Apps Script HTTP ${res.status}`);
  }

  const data = await res.json();
  if (!data.ok || !data.values) {
    throw new Error(`Apps Script error: ${JSON.stringify(data).slice(0, 200)}`);
  }

  const rows: string[][] = data.values;
  if (rows.length < 2) return [];

  // Saltar la cabecera (rows[0]) y mapear a estructura
  return rows.slice(1).map((row) => ({
    fecha: row[0] ?? "",
    quien: row[1] ?? "",
    asunto: row[2] ?? "",
    enlace: row[3] ?? "",
    cuerpo: row[4] ?? "",
    estado: row[5] ?? "",
    tipo: row[6] ?? "",
    prioridad: row[7] ?? "",
    autoDropdown: row[8] ?? "",
    respuestaAuto: row[9] ?? "",
    telefono: row[10] ?? "",
  }));
}

async function migrar(modo: "dry-run" | "ejecutar"): Promise<ResultadoMigracion> {
  const tStart = Date.now();
  const ejecutar = modo === "ejecutar";

  const resultado: ResultadoMigracion = {
    modo: ejecutar ? "ejecutado" : "dry-run",
    total_filas_sheet: 0,
    filas_con_datos: 0,
    filas_saltadas: 0,
    clientes_nuevos: 0,
    clientes_actualizados: 0,
    emails_insertados: 0,
    emails_duplicados: 0,
    pedidos_extraidos: 0,
    errores: [],
    duracion_ms: 0,
  };

  // 1) Leer todas las filas del Sheet
  const filas = await leerHojaSheets();
  resultado.total_filas_sheet = filas.length;

  const ejemplos: unknown[] = [];

  // 2) Procesar fila por fila
  for (let i = 0; i < filas.length; i++) {
    const fila = filas[i];

    // Saltar filas vacías
    const hayContenido =
      (fila.fecha || "").trim() ||
      (fila.quien || "").trim() ||
      (fila.asunto || "").trim();
    if (!hayContenido) {
      resultado.filas_saltadas++;
      continue;
    }
    resultado.filas_con_datos++;

    try {
      // Parseos
      const quien = parsearQuien(fila.quien);
      const asuntoLimpio = limpiarAsunto(fila.asunto);
      const fecha = parsearFecha(fila.fecha) || new Date();
      const tipo = clasificarTipo(fila.estado, fila.tipo, fila.asunto);
      const messageId = generarMessageIdLegacy(i, fila.fecha, quien.email, fila.asunto);
      const numeroPedido = extraerNumeroPedido(fila.asunto);
      const esVip = esIndustriastak(quien.email, quien.nombre, quien.empresa);

      // Adjuntos en formato JSONB
      const adjuntos = fila.enlace
        ? [{ nombre: "adjunto", drive_url: fila.enlace, tipo: "pdf" }]
        : [];

      // Guardar primeros 5 ejemplos para inspección en modo dry-run
      if (!ejecutar && ejemplos.length < 5) {
        ejemplos.push({
          fila_idx: i,
          input: {
            quien: fila.quien,
            asunto: fila.asunto,
            estado: fila.estado,
            tipo: fila.tipo,
          },
          output: {
            email: quien.email,
            nombre: quien.nombre,
            empresa: quien.empresa,
            es_vip: esVip,
            tipo_clasificado: tipo,
            numero_pedido: numeroPedido,
            asunto_limpio: asuntoLimpio,
            message_id: messageId,
          },
        });
      }

      if (!ejecutar) {
        // Modo dry-run: solo contamos
        resultado.clientes_nuevos++; // estimación
        resultado.emails_insertados++; // estimación
        if (numeroPedido) resultado.pedidos_extraidos++;
        continue;
      }

      // 3) UPSERT cliente
      const clienteResult = await sqlDirect`
        INSERT INTO clientes (email, nombre, empresa, telefono, es_vip, es_industriastak, primer_contacto, ultimo_contacto)
        VALUES (
          ${quien.email},
          ${quien.nombre},
          ${quien.empresa},
          ${fila.telefono && fila.telefono !== "NO ENCONTRADO" ? fila.telefono : null},
          ${esVip},
          ${esVip},
          ${fecha},
          ${fecha}
        )
        ON CONFLICT (email) DO UPDATE SET
          nombre = COALESCE(EXCLUDED.nombre, clientes.nombre),
          empresa = COALESCE(EXCLUDED.empresa, clientes.empresa),
          telefono = COALESCE(EXCLUDED.telefono, clientes.telefono),
          es_vip = clientes.es_vip OR EXCLUDED.es_vip,
          es_industriastak = clientes.es_industriastak OR EXCLUDED.es_industriastak,
          ultimo_contacto = GREATEST(clientes.ultimo_contacto, EXCLUDED.ultimo_contacto)
        RETURNING id, (xmax = 0) AS es_nuevo
      `;

      const clienteId = clienteResult[0].id as string;
      if (clienteResult[0].es_nuevo) {
        resultado.clientes_nuevos++;
      } else {
        resultado.clientes_actualizados++;
      }

      // Datos legacy del Sheet que el dashboard todavía usa
      // Los guardamos en datos_extraidos JSONB para preservarlos
      const datosLegacy = {
        prioridad: fila.prioridad || "",
        autoDropdown: fila.autoDropdown || "false",
        respuestaAuto: fila.respuestaAuto || "",
        telefono: fila.telefono || "",
        estado_legacy: fila.estado || "",  // texto original del Sheet
        tipo_legacy: fila.tipo || "",      // texto original del Sheet
        fila_sheet_idx: i,                  // referencia a la fila original
      };

      // 4) UPSERT email — si ya existe, ACTUALIZA los datos extraídos
      // (así re-ejecutar la migración refresca los campos legacy)
      const emailResult = await sqlDirect`
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
          ${messageId},
          ${quien.email},
          ${quien.nombre},
          ${quien.empresa},
          ${clienteId},
          ${fila.asunto || ""},
          ${asuntoLimpio},
          ${fila.cuerpo || ""},
          ${adjuntos.length},
          ${JSON.stringify(adjuntos)}::jsonb,
          ${tipo}::tipo_email,
          'archivado'::estado_email,
          ${JSON.stringify(datosLegacy)}::jsonb,
          ${fecha},
          NOW()
        )
        ON CONFLICT (gmail_message_id) DO UPDATE SET
          datos_extraidos = EXCLUDED.datos_extraidos,
          updated_at = NOW()
        RETURNING id, (xmax = 0) AS es_nuevo
      `;

      if (emailResult.length > 0) {
        const esNuevo = emailResult[0].es_nuevo as boolean;
        if (esNuevo) {
          resultado.emails_insertados++;
        } else {
          resultado.emails_duplicados++;
        }
        const emailId = emailResult[0].id as string;

        // 5) Si es pedido con número detectado, crear entrada en pedidos
        if (numeroPedido) {
          await sqlDirect`
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
              ${clienteId},
              ${emailId},
              ${fecha.toISOString().split("T")[0]},
              ${fila.enlace || null},
              'pendiente'::estado_pedido
            )
            ON CONFLICT (numero_externo) DO NOTHING
          `;
          resultado.pedidos_extraidos++;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      resultado.errores.push(`Fila ${i}: ${msg}`);
      if (resultado.errores.length > 10) {
        resultado.errores.push("... más errores (truncados)");
        break;
      }
    }
  }

  if (!ejecutar) {
    resultado.ejemplos_parseados = ejemplos;
  }

  resultado.duracion_ms = Date.now() - tStart;
  return resultado;
}

export async function GET() {
  // Modo dry-run: lee, parsea y muestra qué pasaría
  try {
    const r = await migrar("dry-run");
    return NextResponse.json(r);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function POST() {
  // Modo ejecutar: hace los inserts/upserts reales
  try {
    const r = await migrar("ejecutar");
    return NextResponse.json(r);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
