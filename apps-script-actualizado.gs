// ==========================================
// ⚙️ CÓDIGO NUEVO PARA AÑADIR AL APPS SCRIPT EXISTENTE
// ==========================================
// INSTRUCCIONES:
// 1. Abre tu Apps Script en https://script.google.com
// 2. Añade estas funciones al final del archivo existente
// 3. Modifica la función doPost(e) existente para incluir los nuevos casos
// ==========================================

// ==========================================
// 📨 NUEVA FUNCIÓN: Enviar email de respuesta
// ==========================================
function enviarEmailRespuesta(para, asunto, cuerpo, threadId) {
  var opciones = {
    name: NOMBRE_MOSTRAR,
    replyTo: EMAIL_REMITENTE_ALIAS
  };

  // Si hay threadId, responde en el mismo hilo de Gmail
  if (threadId && threadId !== "") {
    try {
      var thread = GmailApp.getThreadById(threadId);
      if (thread) {
        thread.reply(cuerpo, opciones);
        return { ok: true, metodo: "hilo" };
      }
    } catch (e) {
      console.warn("No se pudo responder en hilo, enviando email nuevo: " + e.message);
    }
  }

  // Email nuevo
  MailApp.sendEmail(para, asunto, cuerpo, opciones);
  return { ok: true, metodo: "nuevo" };
}

// ==========================================
// 📋 NUEVA FUNCIÓN: Guardar en Cola_Respuestas
// ==========================================
function guardarEnCola(datos) {
  var hoja;
  try {
    hoja = SpreadsheetApp.openById(ID_HOJA_REGISTRO).getSheetByName("Cola_Respuestas");
    if (!hoja) {
      console.error("No existe la hoja Cola_Respuestas. Créala manualmente.");
      return { ok: false, error: "Hoja Cola_Respuestas no encontrada" };
    }
  } catch (e) {
    return { ok: false, error: e.message };
  }

  var ahora = new Date();
  hoja.appendRow([
    ahora,                      // A: id (timestamp único)
    ahora,                      // B: fecha_creacion
    datos.tipo || "email",      // C: tipo (email|whatsapp)
    datos.rowOrigen || "",      // D: row_origen (fila en Hoja 1)
    datos.destinatario || "",   // E: destinatario
    datos.asunto || "",         // F: asunto
    datos.threadId || "",       // G: thread_id
    datos.borrador || "",       // H: borrador IA
    "pendiente",                // I: estado
    "",                         // J: enviado_en
    datos.contextoJson || ""    // K: contexto_json
  ]);

  return { ok: true };
}

// ==========================================
// ✏️ NUEVA FUNCIÓN: Actualizar estado en Cola_Respuestas
// ==========================================
function actualizarCola(id, estado, borradorFinal) {
  var hoja;
  try {
    hoja = SpreadsheetApp.openById(ID_HOJA_REGISTRO).getSheetByName("Cola_Respuestas");
    if (!hoja) {
      return { ok: false, error: "Hoja Cola_Respuestas no encontrada" };
    }
  } catch (e) {
    return { ok: false, error: e.message };
  }

  var datos = hoja.getDataRange().getValues();
  var encontrado = false;

  for (var i = 1; i < datos.length; i++) {
    var idFila = datos[i][0];
    // Comparar como string para manejar timestamps/fechas
    if (idFila && idFila.toString() === id.toString()) {
      hoja.getRange(i + 1, 9).setValue(estado);  // Col I: estado
      if (borradorFinal) {
        hoja.getRange(i + 1, 8).setValue(borradorFinal);  // Col H: borrador
      }
      if (estado === "aprobado") {
        hoja.getRange(i + 1, 10).setValue(new Date());  // Col J: enviado_en
      }
      encontrado = true;
      break;
    }
  }

  if (!encontrado) {
    return { ok: false, error: "ID no encontrado en Cola_Respuestas" };
  }

  return { ok: true };
}

// ==========================================
// 🔄 FUNCIÓN doPost ACTUALIZADA
// ==========================================
// REEMPLAZA tu doPost(e) existente con esta versión.
// Si ya tienes lógica en doPost, intégrala dentro del bloque 'else'.
// ==========================================
function doPost(e) {
  try {
    var datos;
    if (e.postData && e.postData.contents) {
      datos = JSON.parse(e.postData.contents);
    } else {
      datos = e.parameter;
    }

    var accion = datos.accion || "";
    var resultado;

    if (accion === "enviarEmail") {
      // Payload: {accion, para, asunto, cuerpo, threadId}
      resultado = enviarEmailRespuesta(
        datos.para,
        datos.asunto,
        datos.cuerpo,
        datos.threadId || ""
      );

    } else if (accion === "guardarEnCola") {
      // Payload: {accion, tipo, rowOrigen, destinatario, asunto, threadId, borrador, contextoJson}
      resultado = guardarEnCola(datos);

    } else if (accion === "actualizarCola") {
      // Payload: {accion, id, estado, borradorFinal?}
      resultado = actualizarCola(datos.id, datos.estado, datos.borradorFinal || "");

    } else {
      // ── Comportamiento original: actualizar celda ──
      // Payload: {fila, columna, valor}
      var fila = parseInt(datos.fila);
      var columna = parseInt(datos.columna);
      var valor = datos.valor;

      var sheet = SpreadsheetApp.openById(ID_HOJA_REGISTRO).getSheetByName(NOMBRE_HOJA_LOG);
      sheet.getRange(fila, columna).setValue(valor);
      resultado = { ok: true };
    }

    return ContentService
      .createTextOutput(JSON.stringify(resultado))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ==========================================
// 📊 INSTRUCCIONES: Crear hoja Cola_Respuestas
// ==========================================
// Ejecuta esta función UNA SOLA VEZ desde el editor de Apps Script
// para crear la hoja con las cabeceras correctas.
// ==========================================
function crearHolaColaRespuestas() {
  var libro = SpreadsheetApp.openById(ID_HOJA_REGISTRO);
  var existente = libro.getSheetByName("Cola_Respuestas");
  if (existente) {
    Logger.log("La hoja Cola_Respuestas ya existe.");
    return;
  }

  var hoja = libro.insertSheet("Cola_Respuestas");
  hoja.getRange(1, 1, 1, 11).setValues([[
    "id",
    "fecha_creacion",
    "tipo",
    "row_origen",
    "destinatario",
    "asunto",
    "thread_id",
    "borrador",
    "estado",
    "enviado_en",
    "contexto_json"
  ]]);

  // Formato cabecera
  hoja.getRange(1, 1, 1, 11)
    .setBackground("#f97316")
    .setFontColor("#ffffff")
    .setFontWeight("bold");

  // Anchos de columna
  hoja.setColumnWidth(1, 180);  // id
  hoja.setColumnWidth(5, 220);  // destinatario
  hoja.setColumnWidth(8, 400);  // borrador
  hoja.setColumnWidth(11, 300); // contexto_json

  Logger.log("✅ Hoja Cola_Respuestas creada correctamente.");
}
