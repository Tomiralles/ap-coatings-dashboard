# 📍 ESTADO DEL PROYECTO — Léeme si te has perdido

> Última actualización: junio 2026
> Si vuelves después de tiempo y no te acuerdas de nada, lee esto. En 30 segundos te sitúas.

---

## En este repo conviven 2 cosas

### 1️⃣ Dashboard de AP Coatings → ✅ HECHO
Tu panel para tu negocio de pinturas (pedidos, facturas, consultas, emails con IA).
**Funciona, lo usas, está terminado. No hay que tocar nada aquí.**

- Va desplegado en **Vercel**.
- El código está en `src/app/dashboard/`.

---

### 2️⃣ "Nura" — el robot que coge llamadas → ✅ FUNCIONA (falta subirlo)
Tu proyecto paralelo: la idea de montar una agencia y vender "agentes de IA" a otros negocios.

**Qué hace Nura:**
Coge una llamada → la escucha y entiende → decide si esa persona es buen cliente → te avisa por email.

**Esto es lo que te tuvo atascado meses. Ya está arreglado y probado.**
Está en la carpeta `nura-worker/`.

---

## 🎯 Si quieres retomar Nura, esto es lo único que falta

| Paso | Qué es | Tiempo |
|------|--------|--------|
| 1. Desplegar Nura | Subirlo a Cloudflare con `wrangler deploy` | ~15 min |
| 2. Email al cliente final | Verificar un dominio en resend.com/domains | ~10 min |
| 3. (Opcional) WhatsApp | Resolver el setup de Meta (te quedaste en un bucle de verificación) | pendiente |

**Cómo desplegar Nura:** los pasos exactos están en `nura-worker/README.md`.

---

## 🟡 Lo que quedó a medias: WhatsApp multi-cliente

Empezamos a montar un sistema para vender el agente a muchos negocios a la vez
(cada taller/clínica/restaurante con su propio WhatsApp). El **código está listo**:

- Migración: `scripts/migrations/006_clientes_whatsapp.sql` (sin ejecutar todavía en la BD)
- Panel para gestionar clientes: `/dashboard/clientes`
- API: `/api/clientes-wa`

**Pero está parado** porque el alta en Meta (Facebook) se quedó atascada en un bucle
de verificación de teléfono. Esto se retoma cuando tengas un primer cliente interesado.

⚠️ **Aviso importante:** tu número `626786207` tiene el WhatsApp de AP Coatings.
NO lo conectes a la API de WhatsApp o perderías el WhatsApp normal de tu negocio.

---

## 🧭 Recomendación

Si estás liado con otras prioridades: **déjalo aparcado, no se pierde nada** (está todo en GitHub).
El día que quieras enseñar Nura a alguien, abre el chat y di: *"quiero poner Nura en marcha"*.

Lo más impresionante para enseñar a un cliente es **Nura** (una llamada real que se
cualifica sola). Es lo único 100% terminado. Empieza por ahí.
