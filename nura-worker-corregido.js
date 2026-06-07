// ============================================================================
//  NURA — Cloudflare Worker (versión corregida y con diagnóstico)
//  Flujo: llamada Zadarma -> grabación -> Whisper -> GPT -> Airtable + email
//
//  CLAVE: ahora cada paso reporta su estado. Si algo falla, recibes UN email
//  de diagnóstico ("DIAG Nura") que te dice EXACTAMENTE dónde y por qué.
//  Deja de programar a ciegas.
// ============================================================================

const PROMPT = "Eres Nura de Estrategia IA. Analiza la transcripcion y decide si es buen lead (clinica estetica con mas de 20 citas/mes). Si es buen lead responde EXACTAMENTE: AGENDAR_DEMO|nombre|email|resumen. Si no: NO_CUALIFICA|motivo";
const EMAIL = "tomiralles@gmail.com";       // tu email (al que SÍ puede enviar Resend en modo test)
const TABLE = "tblQEU7snFnhTgDsi";
const CALENDLY = "https://calendly.com/tomiralles/30min";

// ⚠️ IMPORTANTE: pon aquí tu remitente.
//   - En modo test usa "onboarding@resend.dev" PERO solo enviará a EMAIL (tu propio correo).
//   - Para enviar al lead, verifica un dominio en resend.com/domains y pon ej. "nura@tudominio.com".
const FROM = "Nura <onboarding@resend.dev>";
const DOMINIO_VERIFICADO = false; // ponlo en true cuando verifiques tu dominio en Resend

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Verificación de webhook de Zadarma
    if (url.searchParams.get("zd_echo")) return new Response(url.searchParams.get("zd_echo"));
    if (url.pathname === "/") return new Response("Nura OK");

    // -------- Test manual del pipeline de análisis (sin llamada real) --------
    if (url.pathname === "/test" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const a = await analizar(body.transcripcion || "Clinica estetica con 80 citas al mes", env.OPENAI_API_KEY);
      const at = await guardar({ nombre: a.nombre, telefono: "test", email: a.email, resumen: a.resumen || a.motivo, es_lead: a.es_lead }, env);
      let envio = null;
      if (a.es_lead) envio = await enviar(a, "test", env.RESEND_API_KEY);
      return json({ analisis: a, airtable: at, envio });
    }

    // -------- Diagnóstico de autenticación Zadarma --------
    if (url.pathname === "/debug-zadarma") {
      const id = url.searchParams.get("id") || "";
      const results = {
        keyLen: env.ZADARMA_KEY?.length,
        secretLen: env.ZADARMA_SECRET?.length,
      };
      // /v1/info/ con Authorization header (forma correcta)
      try {
        const r = await zadarmaGet("/v1/info/", "", env);
        results.info = { status: r.status, data: r.data };
      } catch (e) { results.info = { error: e.message }; }
      // grabación si pasas ?id=<pbx_call_id>
      if (id) {
        try {
          const r = await zadarmaGet("/v1/pbx/record/request/", `lifetime=1800&pbx_call_id=${id}`, env);
          results.record = { status: r.status, data: r.data };
        } catch (e) { results.record = { error: e.message }; }
      }
      return json(results);
    }

    // -------- Webhook principal de llamadas --------
    if (url.pathname === "/llamada") {
      if (request.method === "GET") return new Response("OK");

      let body;
      const ct = request.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        body = await request.json().catch(() => ({}));
      } else {
        const text = await request.text();
        body = Object.fromEntries(new URLSearchParams(text).entries());
      }

      const evento = (body.event || body.notification_type || "").toUpperCase();
      const tel = body.caller_id || body.from || body.caller || "desconocido";
      // Zadarma manda pbx_call_id (permanente) y, si hay grabación, call_id_with_rec.
      const pbx_call_id = body.pbx_call_id || body.call_id || "";

      if (evento !== "NOTIFY_END") {
        return json({ ok: true, skipped: evento });
      }
      if (!pbx_call_id) {
        return json({ ok: false, error: "Sin pbx_call_id", body });
      }

      // Responder a Zadarma YA y procesar en segundo plano.
      ctx.waitUntil(procesarLlamada(pbx_call_id, tel, env));
      return json({ ok: true, processing: true });
    }

    return new Response("404", { status: 404 });
  }
};

// ============================================================================
//  PROCESAMIENTO PRINCIPAL — con diagnóstico paso a paso
// ============================================================================
async function procesarLlamada(pbx_call_id, tel, env) {
  const diag = { pbx_call_id, tel, pasos: [] };
  const paso = (nombre, detalle) => diag.pasos.push({ nombre, detalle, t: new Date().toISOString() });

  try {
    // 1) Obtener grabación CON REINTENTOS (puede no estar lista al instante)
    paso("inicio", "esperando grabación");
    const audioUrl = await obtenerGrabacionConReintentos(pbx_call_id, env, 6, 10000); // 6 intentos x 10s = hasta 60s
    paso("grabacion", audioUrl ? `OK: ${audioUrl.slice(0, 80)}...` : "FALLO: no se obtuvo URL");
    if (!audioUrl) return await enviarDiagnostico(diag, env);

    // 2) Transcribir
    const transcripcion = await transcribir(audioUrl, env.OPENAI_API_KEY);
    paso("transcripcion", transcripcion ? `OK (${transcripcion.length} chars): ${transcripcion.slice(0, 120)}...` : "FALLO: Whisper no devolvió texto");
    if (!transcripcion) return await enviarDiagnostico(diag, env);

    // 3) Analizar / cualificar
    const a = await analizar(transcripcion, env.OPENAI_API_KEY);
    paso("analisis", a.error ? `FALLO: ${a.error}` : `OK: ${a.es_lead ? "LEAD" : "no cualifica"} (${a.nombre || a.motivo})`);
    if (a.error) return await enviarDiagnostico(diag, env);

    // 4) Guardar en Airtable
    const at = await guardar({ nombre: a.nombre, telefono: tel, email: a.email, resumen: a.resumen || a.motivo, es_lead: a.es_lead }, env);
    paso("airtable", at.error ? `FALLO: ${at.error}` : `OK status ${at.status}`);

    // 5) Enviar emails (solo si es lead)
    if (a.es_lead) {
      const envio = await enviar(a, tel, env.RESEND_API_KEY);
      paso("email", envio.error ? `FALLO: ${envio.error}` : `OK (notif=${envio.notif}, lead=${envio.lead})`);
    } else {
      paso("email", "omitido (no es lead)");
    }

    diag.resultado = "COMPLETADO";
    await enviarDiagnostico(diag, env);
  } catch (e) {
    paso("EXCEPCION", e.message);
    await enviarDiagnostico(diag, env);
  }
}

// ============================================================================
//  ZADARMA
// ============================================================================
async function obtenerGrabacionConReintentos(pbx_call_id, env, intentos, esperaMs) {
  for (let i = 0; i < intentos; i++) {
    await sleep(esperaMs);
    const r = await zadarmaGet("/v1/pbx/record/request/", `lifetime=1800&pbx_call_id=${pbx_call_id}`, env);
    const link = r.data?.link || r.data?.url || (Array.isArray(r.data?.links) ? r.data.links[0] : null);
    if (link) return link;
    // si Zadarma dice que aún no está, seguimos reintentando
  }
  return null;
}

// Petición GET firmada a la API de Zadarma (firma correcta verificada).
async function zadarmaGet(path, params, env) {
  const paramsHash = md5js(params);
  const sign = await hmacSha1Base64(env.ZADARMA_SECRET, `${path}${params}${paramsHash}`);
  const auth = `${env.ZADARMA_KEY}:${sign}`;
  const fullUrl = `https://api.zadarma.com${path}` + (params ? `?${params}` : "");
  const res = await fetch(fullUrl, { headers: { "Authorization": auth } });
  let data;
  try { data = await res.json(); } catch { data = { _raw: await res.text() }; }
  return { status: res.status, data };
}

// Zadarma: base64( hex( hmac_sha1(message, secret) ) ) — equivale a PHP hash_hmac('sha1',..) + base64_encode
async function hmacSha1Base64(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
  return btoa(hex);
}

// ============================================================================
//  OPENAI — Whisper + análisis
// ============================================================================
async function transcribir(audioUrl, k) {
  try {
    const audioRes = await fetch(audioUrl);
    if (!audioRes.ok) return null;
    const audioBlob = await audioRes.blob();
    const form = new FormData();
    // Zadarma graba en mp3 -> la extensión correcta evita que Whisper rechace el archivo
    form.append("file", audioBlob, "audio.mp3");
    form.append("model", "whisper-1");
    form.append("language", "es");
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { "Authorization": "Bearer " + k },
      body: form
    });
    if (!res.ok) return null;
    const d = await res.json();
    return d.text || null;
  } catch { return null; }
}

async function analizar(t, k) {
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": "Bearer " + k, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: PROMPT }, { role: "user", content: "Transcripcion: " + t }],
        temperature: 0.3
      })
    });
    const d = await res.json();
    if (!d.choices || !d.choices.length) return { error: "OpenAI sin respuesta: " + JSON.stringify(d).slice(0, 200) };

    const txt = (d.choices[0].message.content || "").trim();
    if (txt.includes("AGENDAR_DEMO")) {
      // partimos por | y limpiamos cada campo (robusto ante espacios/saltos)
      const p = txt.split("|").map(s => s.trim());
      // p[0] = "AGENDAR_DEMO", p[1]=nombre, p[2]=email, p[3]=resumen
      return { es_lead: true, nombre: p[1] || "Desconocido", email: p[2] || "", resumen: p[3] || txt };
    }
    return { es_lead: false, motivo: txt.replace("NO_CUALIFICA", "").replace(/^\s*\|/, "").trim() };
  } catch (e) { return { error: e.message }; }
}

// ============================================================================
//  AIRTABLE
// ============================================================================
async function guardar(d, env) {
  try {
    if (!env.AIRTABLE_API_KEY || !env.AIRTABLE_BASE_ID) return { error: "Faltan credenciales Airtable" };
    const res = await fetch(`https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${TABLE}`, {
      method: "POST",
      headers: { "Authorization": "Bearer " + env.AIRTABLE_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: {
          "Nombre del cliente": d.nombre || "Desconocido",
          "Notas": d.resumen || "",
          "Estado de seguimiento": d.es_lead ? "Lead cualificado" : "No cualifica"
        }
      })
    });
    const rd = await res.json();
    if (!res.ok) return { error: `Airtable ${res.status}: ${JSON.stringify(rd).slice(0, 200)}` };
    return { status: res.status, data: rd };
  } catch (e) { return { error: e.message }; }
}

// ============================================================================
//  RESEND — emails
//  ⚠️ Con onboarding@resend.dev SOLO se puede enviar a EMAIL (tu propio correo).
//     El email al lead requiere dominio verificado (DOMINIO_VERIFICADO = true).
// ============================================================================
async function enviar(a, tel, k) {
  const out = { notif: false, lead: false };
  try {
    // 1) Notificación interna para ti (esta SÍ funciona en modo test)
    const r1 = await resendSend(k, {
      from: FROM,
      to: EMAIL,
      subject: "🎯 Nuevo lead cualificado: " + a.nombre,
      html: `<h2>Lead cualificado por Nura</h2>
<p><b>Nombre:</b> ${a.nombre}</p>
<p><b>Teléfono:</b> ${tel}</p>
<p><b>Email lead:</b> ${a.email || "no proporcionado"}</p>
<p><b>Resumen:</b> ${a.resumen}</p>
<hr><p><a href="${CALENDLY}">Ver disponibilidad en Calendly</a></p>`
    });
    out.notif = r1.ok;
    if (!r1.ok) out.error = "notif: " + r1.error;

    // 2) Email al lead — solo si tienes dominio verificado en Resend
    if (a.email && DOMINIO_VERIFICADO) {
      const r2 = await resendSend(k, {
        from: FROM,
        to: a.email,
        subject: "Tu demo con Estrategia IA — reserva tu hueco",
        html: `<h2>Hola ${a.nombre},</h2>
<p>Gracias por tu interés en automatizar tu clínica con IA.</p>
<p><a href="${CALENDLY}" style="background:#0066cc;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;margin-top:10px;">📅 Reservar mi demo gratuita</a></p>
<p style="margin-top:20px;color:#666;font-size:14px;">Estrategia IA · tomiralles@gmail.com</p>`
      });
      out.lead = r2.ok;
      if (!r2.ok) out.error = (out.error ? out.error + " | " : "") + "lead: " + r2.error;
    } else if (a.email && !DOMINIO_VERIFICADO) {
      out.error = "email al lead OMITIDO: verifica un dominio en resend.com/domains";
    }
    return out;
  } catch (e) { return { ...out, error: e.message }; }
}

async function resendSend(k, payload) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": "Bearer " + k, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (res.ok) return { ok: true };
  const err = await res.text();
  return { ok: false, error: `${res.status}: ${err.slice(0, 200)}` };
}

// Email de diagnóstico: te dice EXACTAMENTE en qué paso se rompió todo.
async function enviarDiagnostico(diag, env) {
  const filas = diag.pasos.map(p => `<tr><td><b>${p.nombre}</b></td><td>${p.detalle}</td></tr>`).join("");
  await resendSend(env.RESEND_API_KEY, {
    from: FROM,
    to: EMAIL,
    subject: `🔧 DIAG Nura — ${diag.resultado || "INCOMPLETO"} (${diag.tel})`,
    html: `<h3>Diagnóstico de llamada</h3>
<p>pbx_call_id: ${diag.pbx_call_id}</p>
<table border="1" cellpadding="6" cellspacing="0">${filas}</table>`
  });
}

// ============================================================================
//  UTILIDADES
// ============================================================================
function json(obj) {
  return new Response(JSON.stringify(obj, null, 2), { headers: { "Content-Type": "application/json" } });
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// MD5 puro en JS (Web Crypto no incluye MD5; Zadarma lo necesita para la firma)
function md5js(str) {
  function safeAdd(x, y) { const lsw = (x & 0xffff) + (y & 0xffff); return (((x >> 16) + (y >> 16) + (lsw >> 16)) << 16) | (lsw & 0xffff); }
  function rol(num, cnt) { return (num << cnt) | (num >>> (32 - cnt)); }
  function cmn(q, a, b, x, s, t) { return safeAdd(rol(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b); }
  function ff(a, b, c, d, x, s, t) { return cmn((b & c) | ((~b) & d), a, b, x, s, t); }
  function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & (~d)), a, b, x, s, t); }
  function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
  function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | (~d)), a, b, x, s, t); }
  function blks(s) {
    const nblk = ((s.length + 8) >> 6) + 1, b = new Array(nblk * 16).fill(0);
    for (let i = 0; i < s.length; i++) b[i >> 2] |= s.charCodeAt(i) << ((i % 4) * 8);
    b[s.length >> 2] |= 0x80 << ((s.length % 4) * 8);
    b[nblk * 16 - 2] = s.length * 8; return b;
  }
  const x = blks(str);
  let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
  for (let i = 0; i < x.length; i += 16) {
    const [oa, ob, oc, od] = [a, b, c, d];
    a = ff(a, b, c, d, x[i], 7, -680876936); d = ff(d, a, b, c, x[i + 1], 12, -389564586); c = ff(c, d, a, b, x[i + 2], 17, 606105819); b = ff(b, c, d, a, x[i + 3], 22, -1044525330);
    a = ff(a, b, c, d, x[i + 4], 7, -176418897); d = ff(d, a, b, c, x[i + 5], 12, 1200080426); c = ff(c, d, a, b, x[i + 6], 17, -1473231341); b = ff(b, c, d, a, x[i + 7], 22, -45705983);
    a = ff(a, b, c, d, x[i + 8], 7, 1770035416); d = ff(d, a, b, c, x[i + 9], 12, -1958414417); c = ff(c, d, a, b, x[i + 10], 17, -42063); b = ff(b, c, d, a, x[i + 11], 22, -1990404162);
    a = ff(a, b, c, d, x[i + 12], 7, 1804603682); d = ff(d, a, b, c, x[i + 13], 12, -40341101); c = ff(c, d, a, b, x[i + 14], 17, -1502002290); b = ff(b, c, d, a, x[i + 15], 22, 1236535329);
    a = gg(a, b, c, d, x[i + 1], 5, -165796510); d = gg(d, a, b, c, x[i + 6], 9, -1069501632); c = gg(c, d, a, b, x[i + 11], 14, 643717713); b = gg(b, c, d, a, x[i], 20, -373897302);
    a = gg(a, b, c, d, x[i + 5], 5, -701558691); d = gg(d, a, b, c, x[i + 10], 9, 38016083); c = gg(c, d, a, b, x[i + 15], 14, -660478335); b = gg(b, c, d, a, x[i + 4], 20, -405537848);
    a = gg(a, b, c, d, x[i + 9], 5, 568446438); d = gg(d, a, b, c, x[i + 14], 9, -1019803690); c = gg(c, d, a, b, x[i + 3], 14, -187363961); b = gg(b, c, d, a, x[i + 8], 20, 1163531501);
    a = gg(a, b, c, d, x[i + 13], 5, -1444681467); d = gg(d, a, b, c, x[i + 2], 9, -51403784); c = gg(c, d, a, b, x[i + 7], 14, 1735328473); b = gg(b, c, d, a, x[i + 12], 20, -1926607734);
    a = hh(a, b, c, d, x[i + 5], 4, -378558); d = hh(d, a, b, c, x[i + 8], 11, -2022574463); c = hh(c, d, a, b, x[i + 11], 16, 1839030562); b = hh(b, c, d, a, x[i + 14], 23, -35309556);
    a = hh(a, b, c, d, x[i + 1], 4, -1530992060); d = hh(d, a, b, c, x[i + 4], 11, 1272893353); c = hh(c, d, a, b, x[i + 7], 16, -155497632); b = hh(b, c, d, a, x[i + 10], 23, -1094730640);
    a = hh(a, b, c, d, x[i + 13], 4, 681279174); d = hh(d, a, b, c, x[i], 11, -358537222); c = hh(c, d, a, b, x[i + 3], 16, -722521979); b = hh(b, c, d, a, x[i + 6], 23, 76029189);
    a = hh(a, b, c, d, x[i + 9], 4, -640364487); d = hh(d, a, b, c, x[i + 12], 11, -421815835); c = hh(c, d, a, b, x[i + 15], 16, 530742520); b = hh(b, c, d, a, x[i + 2], 23, -995338651);
    a = ii(a, b, c, d, x[i], 6, -198630844); d = ii(d, a, b, c, x[i + 7], 10, 1126891415); c = ii(c, d, a, b, x[i + 14], 15, -1416354905); b = ii(b, c, d, a, x[i + 5], 21, -57434055);
    a = ii(a, b, c, d, x[i + 12], 6, 1700485571); d = ii(d, a, b, c, x[i + 3], 10, -1894986606); c = ii(c, d, a, b, x[i + 10], 15, -1051523); b = ii(b, c, d, a, x[i + 1], 21, -2054922799);
    a = ii(a, b, c, d, x[i + 8], 6, 1873313359); d = ii(d, a, b, c, x[i + 15], 10, -30611744); c = ii(c, d, a, b, x[i + 6], 15, -1560198380); b = ii(b, c, d, a, x[i + 13], 21, 1309151649);
    a = ii(a, b, c, d, x[i + 4], 6, -145523070); d = ii(d, a, b, c, x[i + 11], 10, -1120210379); c = ii(c, d, a, b, x[i + 2], 15, 718787259); b = ii(b, c, d, a, x[i + 9], 21, -343485551);
    a = safeAdd(a, oa); b = safeAdd(b, ob); c = safeAdd(c, oc); d = safeAdd(d, od);
  }
  return [a, b, c, d].map(n => ('00000000' + (n < 0 ? n + 4294967296 : n).toString(16)).slice(-8).match(/../g).reverse().join('')).join('');
}
