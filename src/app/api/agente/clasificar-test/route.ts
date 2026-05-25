import { NextRequest, NextResponse } from "next/server";

/**
 * Endpoint de prueba del agente clasificador.
 *
 * GET /api/agente/clasificar-test
 *   → Ejecuta los 5 ejemplos secuencialmente y devuelve resultados.
 *
 * GET /api/agente/clasificar-test?caso=1
 *   → Ejecuta SOLO el caso 1. Útil para depurar uno concreto.
 *
 * Casos cubiertos:
 *   1. Pedido SQL Pyme (autoenvío del propio Toni → debe detectarse como "pedido_cliente_telefono")
 *   2. Factura PDF de proveedor
 *   3. Solicitud de muestra (cliente potencial)
 *   4. Email con palabra-trampa "urgente" en remitente desconocido (debe NO clasificar como urgente real)
 *   5. Industriastak (VIP - 30% facturación → prioridad alta automática)
 *
 * Cada caso llama al endpoint /api/agente/clasificar y devuelve:
 *   { caso, descripcion, input, resultado, uso, latencia_ms }
 *
 * Útil para validar el agente sin necesidad de webhook real ni emails de prueba en Gmail.
 */

interface EmailEjemplo {
  caso: number;
  descripcion: string;
  esperado: string; // qué tipo/comportamiento esperamos del agente
  input: {
    asunto: string;
    remitente: string;
    cuerpo: string;
    tiene_adjuntos?: boolean;
    nombres_adjuntos?: string[];
    fecha_recibido?: string;
  };
}

const EJEMPLOS: EmailEjemplo[] = [
  // ─────────────────────────────────────────────────────────────────────
  // CASO 1: Pedido SQL Pyme (autoenvío)
  // El sistema SQL Pyme del propio Toni reenvía pedidos telefónicos
  // como emails al buzón. Patrón: remitente = Toni, adjunto PDF que
  // empieza por PED- y cuerpo prácticamente vacío.
  // ─────────────────────────────────────────────────────────────────────
  {
    caso: 1,
    descripcion: "Pedido autoenvío SQL Pyme (cliente telefónico registrado por Toni)",
    esperado: "tipo=pedido_cliente_telefono, prioridad=media, autoenvio_sql_pyme=true",
    input: {
      asunto: "Pedido 26-158",
      remitente: '"Toni Miralles" <tomiralles@apcoatings.net>',
      cuerpo: "", // SQL Pyme suele enviar cuerpo vacío
      tiene_adjuntos: true,
      nombres_adjuntos: ["PED-26-158-14052026.pdf"],
      fecha_recibido: "2026-05-25T10:30:00Z",
    },
  },

  // ─────────────────────────────────────────────────────────────────────
  // CASO 2: Factura PDF de proveedor
  // ─────────────────────────────────────────────────────────────────────
  {
    caso: 2,
    descripcion: "Factura de proveedor con PDF adjunto",
    esperado: "tipo=factura_proveedor, prioridad=media, accion_sugerida=archivar/contabilizar",
    input: {
      asunto: "Factura nº F-2026-04812 - Suministros Químicos Levante S.L.",
      remitente: '"Administración" <facturacion@suministroslevante.es>',
      cuerpo: `Estimados clientes,

Adjuntamos a este correo la factura correspondiente a su pedido del pasado 15 de mayo de 2026.

Importe total: 4.382,55 €
Vencimiento: 30 días fecha factura
Forma de pago: transferencia bancaria

Atentamente,
Departamento de Administración
Suministros Químicos Levante S.L.`,
      tiene_adjuntos: true,
      nombres_adjuntos: ["FAC-F-2026-04812.pdf"],
      fecha_recibido: "2026-05-25T08:15:00Z",
    },
  },

  // ─────────────────────────────────────────────────────────────────────
  // CASO 3: Solicitud de muestra (cliente potencial)
  // ─────────────────────────────────────────────────────────────────────
  {
    caso: 3,
    descripcion: "Solicitud de muestra de pintura (lead comercial)",
    esperado: "tipo=solicitud_muestra, prioridad=alta (lead), accion_sugerida=enviar_a_comercial",
    input: {
      asunto: "Consulta - Muestra epoxi suelo industrial",
      remitente: '"Carlos Vidal - Construcciones Vidal" <cvidal@construccionesvidal.com>',
      cuerpo: `Buenos días,

Mi nombre es Carlos Vidal, soy responsable de compras en Construcciones Vidal.
Tenemos un proyecto de pavimentación industrial de aproximadamente 1.200 m²
y estamos evaluando proveedores de pintura epoxi para suelos.

¿Sería posible que nos enviasen una muestra de su epoxi bicomponente
para suelos industriales? Necesitaríamos también la ficha técnica y
el precio orientativo por m².

Quedo a la espera de su respuesta.

Saludos cordiales,
Carlos Vidal
Construcciones Vidal S.L.
Tel: 96 555 12 34`,
      tiene_adjuntos: false,
      fecha_recibido: "2026-05-25T11:42:00Z",
    },
  },

  // ─────────────────────────────────────────────────────────────────────
  // CASO 4: Palabra-trampa "URGENTE" en spam/phishing
  // El agente NO debe clasificar esto como urgente real - debe detectar
  // que es un email sospechoso (palabra-trampa + remitente desconocido + tono).
  // ─────────────────────────────────────────────────────────────────────
  {
    caso: 4,
    descripcion: "Palabra-trampa URGENTE - posible phishing/spam (no es urgencia real)",
    esperado: "tipo=spam o no_relacionado, prioridad=baja, NO urgente",
    input: {
      asunto: "URGENTE!! Última oportunidad - Acción requerida 24h",
      remitente: '"Premios Internacional" <ganador@notif-premios-promo.info>',
      cuerpo: `¡FELICIDADES!

Usted ha sido seleccionado como ganador de nuestro sorteo internacional.
PREMIO: 50.000 EUROS

ATENCIÓN: Debe confirmar sus datos en las próximas 24 HORAS o perderá el premio.

Haga click aquí para reclamar URGENTEMENTE: http://bit.ly/reclamar-premio-eu

No deje pasar esta oportunidad única.`,
      tiene_adjuntos: false,
      fecha_recibido: "2026-05-25T03:22:00Z",
    },
  },

  // ─────────────────────────────────────────────────────────────────────
  // CASO 5: Industriastak (cliente VIP - 30% facturación)
  // Cualquier email de este cliente debe marcarse como prioridad alta.
  // ─────────────────────────────────────────────────────────────────────
  {
    caso: 5,
    descripcion: "Email de Industriastak (VIP, 30% facturación → prioridad alta automática)",
    esperado: "cliente_vip=true, prioridad=alta independientemente del contenido",
    input: {
      asunto: "Consulta sobre pedido en curso",
      remitente: '"Compras Industriastak" <compras@industriastak.com>',
      cuerpo: `Hola Toni,

Una consulta rápida sobre el pedido que tenemos pendiente de entrega.
¿Podrías confirmarme si el plazo sigue siendo para el viernes 29?
Necesitamos planificar la recepción en almacén.

Gracias,
Equipo de Compras
Industriastak S.A.`,
      tiene_adjuntos: false,
      fecha_recibido: "2026-05-25T09:05:00Z",
    },
  },
];

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const casoParam = searchParams.get("caso");

  // Filtrar a un solo caso si se especifica ?caso=N
  let ejemplos = EJEMPLOS;
  if (casoParam) {
    const casoNum = parseInt(casoParam, 10);
    if (isNaN(casoNum) || casoNum < 1 || casoNum > EJEMPLOS.length) {
      return NextResponse.json(
        {
          ok: false,
          error: `Parámetro 'caso' inválido. Debe ser un número entre 1 y ${EJEMPLOS.length}.`,
        },
        { status: 400 }
      );
    }
    ejemplos = EJEMPLOS.filter((e) => e.caso === casoNum);
  }

  // Construir URL absoluta al endpoint /api/agente/clasificar
  // Usamos el host del request entrante para que funcione tanto en
  // local (localhost:3000) como en producción (vercel.app).
  const baseUrl = req.nextUrl.origin;
  const clasificarUrl = `${baseUrl}/api/agente/clasificar`;

  const tInicio = Date.now();
  const resultados = [];

  for (const ejemplo of ejemplos) {
    const tCaso = Date.now();
    try {
      const resp = await fetch(clasificarUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ejemplo.input),
      });

      const data = await resp.json();
      const latenciaCaso = Date.now() - tCaso;

      resultados.push({
        caso: ejemplo.caso,
        descripcion: ejemplo.descripcion,
        esperado: ejemplo.esperado,
        input: ejemplo.input,
        http_status: resp.status,
        respuesta: data,
        latencia_caso_ms: latenciaCaso,
      });
    } catch (err) {
      resultados.push({
        caso: ejemplo.caso,
        descripcion: ejemplo.descripcion,
        esperado: ejemplo.esperado,
        input: ejemplo.input,
        error: err instanceof Error ? err.message : String(err),
        latencia_caso_ms: Date.now() - tCaso,
      });
    }
  }

  const latenciaTotal = Date.now() - tInicio;

  // Resumen de uso de tokens (suma de todos los casos con respuesta válida)
  const resumenUso = resultados.reduce(
    (acc, r) => {
      const uso = r.respuesta?.uso;
      if (!uso) return acc;
      acc.input_tokens += uso.input_tokens ?? 0;
      acc.output_tokens += uso.output_tokens ?? 0;
      acc.cache_creation_input_tokens += uso.cache_creation_input_tokens ?? 0;
      acc.cache_read_input_tokens += uso.cache_read_input_tokens ?? 0;
      return acc;
    },
    {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    }
  );

  return NextResponse.json({
    ok: true,
    total_casos: resultados.length,
    latencia_total_ms: latenciaTotal,
    uso_acumulado: resumenUso,
    resultados,
  });
}
