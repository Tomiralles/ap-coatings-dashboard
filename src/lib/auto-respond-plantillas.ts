/**
 * Plantillas de respuestas automáticas.
 *
 * Diseño: textos FIJOS, sin variables peligrosas (precios, fechas, productos
 * concretos). Solo "hemos recibido X, le confirmaremos en breve". Esto
 * elimina por completo el riesgo de que el agente "invente" algo.
 *
 * Si en el futuro quieres respuestas más personalizadas, se puede llamar
 * a Claude con un prompt MUY estricto, pero por ahora plantillas fijas =
 * cero alucinación.
 */

export interface RespuestaPlantilla {
  id: string; // identificador interno para auditoría
  asunto: string;
  cuerpo: string;
}

interface ContextoPlantilla {
  nombreCliente: string;       // p.ej. "Juan García"
  asuntoOriginal: string;       // p.ej. "Pedido 26-178"
  idiomaDetectado?: string;     // "es", "ca", "en" - de momento solo respondemos en español
}

/**
 * Saludo formal apropiado según el nombre del cliente.
 * Si no hay nombre, usa fórmula impersonal.
 */
function saludo(nombreCliente: string): string {
  const nombre = (nombreCliente || "").trim();
  if (!nombre || nombre === "Desconocido" || nombre.includes("@")) {
    return "Buenos días,";
  }
  // Primer nombre solo (corta espacios)
  const primerNombre = nombre.split(/\s+/)[0];
  return `Estimado/a ${primerNombre},`;
}

/**
 * Cierra siempre igual: cordial y con firma fija de AP Coatings.
 */
function despedidaConFirma(): string {
  return `\n\nUn cordial saludo,\n\nAP Coatings\n\n---\nEste mensaje es una confirmación automática de recepción. Le contactaremos con la información completa lo antes posible.`;
}

/**
 * Asunto de respuesta: "Re: " + asunto original (mantener thread).
 */
function asuntoRespuesta(asuntoOriginal: string): string {
  const limpio = (asuntoOriginal || "Su mensaje").trim();
  // Si ya empieza por Re:, Rv:, Fwd:, etc., no duplicar
  if (/^(re|rv|fwd|fw)\s*:/i.test(limpio)) {
    return limpio;
  }
  return `Re: ${limpio}`;
}

/**
 * Genera la plantilla apropiada según el tipo del agente.
 * Devuelve null si no hay plantilla para ese tipo (el caller debe escalar).
 */
export function generarPlantilla(
  tipoAgente: string | null | undefined,
  ctx: ContextoPlantilla
): RespuestaPlantilla | null {
  const tipo = (tipoAgente ?? "").toLowerCase();
  const sal = saludo(ctx.nombreCliente);
  const asunto = asuntoRespuesta(ctx.asuntoOriginal);
  const fin = despedidaConFirma();

  switch (tipo) {
    case "pedido_cliente":
    case "pedido_cliente_telefono":
      return {
        id: "acuse_pedido_v1",
        asunto,
        cuerpo: `${sal}

Hemos recibido su pedido correctamente. Lo estamos revisando y le confirmaremos la preparación y plazo de entrega a la mayor brevedad.

Si tiene cualquier modificación o duda urgente, no dude en contactarnos.${fin}`,
      };

    case "factura_proveedor":
      return {
        id: "acuse_factura_proveedor_v1",
        asunto,
        cuerpo: `${sal}

Hemos recibido su factura. La procesaremos según las condiciones de pago acordadas.

Para cualquier consulta sobre el pago, puede contactarnos en cualquier momento.${fin}`,
      };

    case "muestra_cliente":
      return {
        id: "acuse_muestra_v1",
        asunto,
        cuerpo: `${sal}

Hemos recibido su solicitud de muestra. Nuestro equipo comercial se pondrá en contacto con usted en breve para gestionar el envío.${fin}`,
      };

    case "consulta_comercial":
      return {
        id: "acuse_consulta_comercial_v1",
        asunto,
        cuerpo: `${sal}

Gracias por su interés en AP Coatings. Hemos recibido su consulta y nuestro equipo comercial le contactará en breve para atenderle personalmente.${fin}`,
      };

    case "consulta_tecnica":
      return {
        id: "acuse_consulta_tecnica_v1",
        asunto,
        cuerpo: `${sal}

Hemos recibido su consulta técnica. La estamos derivando a nuestro equipo técnico, que le responderá en breve con la información necesaria.${fin}`,
      };

    case "consulta_cliente":
      return {
        id: "acuse_consulta_v1",
        asunto,
        cuerpo: `${sal}

Hemos recibido su consulta. La estamos revisando y le responderemos a la mayor brevedad posible.${fin}`,
      };

    default:
      // Tipo no soportado por plantillas → no autoresponder
      return null;
  }
}

/**
 * Versión "preview" para mostrar en dashboard sin enviar — útil para que
 * el usuario vea qué se enviaría antes de activar el toggle.
 */
export function previewPlantilla(
  tipoAgente: string | null | undefined,
  nombreCliente: string = "Juan García",
  asuntoOriginal: string = "Pedido 26-180"
): RespuestaPlantilla | null {
  return generarPlantilla(tipoAgente, {
    nombreCliente,
    asuntoOriginal,
  });
}
