# Nura — Agente de voz (Cloudflare Worker)

Pipeline: llamada Zadarma → grabación → Whisper → GPT → Airtable + email.

Este Worker es **independiente del dashboard** (el dashboard va en Vercel).
Aquí solo se despliega `index.js` en Cloudflare.

## Despliegue por comando

### 1. Instalar Wrangler (una sola vez)

```bash
npm install -g wrangler
```

### 2. Login en Cloudflare (abre el navegador)

```bash
wrangler login
```

### 3. Cargar los secretos (te pedirá pegar cada valor)

```bash
cd nura-worker
wrangler secret put ZADARMA_KEY
wrangler secret put ZADARMA_SECRET
wrangler secret put OPENAI_API_KEY
wrangler secret put RESEND_API_KEY
wrangler secret put AIRTABLE_API_KEY
wrangler secret put AIRTABLE_BASE_ID
```

### 4. Desplegar

```bash
wrangler deploy
```

Te dará una URL tipo `https://nura.<tu-subdominio>.workers.dev`.
Esa es la URL que pones como webhook NOTIFY_END en Zadarma.

## Probar sin llamada real

```bash
# Test del pipeline de análisis (transcripción de ejemplo)
curl -X POST https://nura.<tu-subdominio>.workers.dev/test \
  -H "Content-Type: application/json" \
  -d '{"transcripcion":"Hola, soy una clínica estética con 80 citas al mes"}'

# Diagnóstico de autenticación Zadarma
curl https://nura.<tu-subdominio>.workers.dev/debug-zadarma
```

## Notas

- **Email al lead**: por defecto `DOMINIO_VERIFICADO = false` en `index.js`.
  Solo envía a tu propio correo hasta que verifiques un dominio en
  [resend.com/domains](https://resend.com/domains) y pongas la constante en `true`.
- **Ver logs en vivo**: `wrangler tail`
