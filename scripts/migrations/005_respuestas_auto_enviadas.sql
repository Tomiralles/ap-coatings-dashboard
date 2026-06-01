-- =====================================================================
-- Migración 005: auto-respuestas del agente (Fase 4C+4D)
-- =====================================================================
--
-- Crea la tabla de auditoría de respuestas enviadas automáticamente por
-- el agente, y el valor inicial del toggle en la tabla `config`.
--
-- Pegar en Neon SQL Editor y ejecutar.
-- Es idempotente.
-- =====================================================================

-- ─── 1. Tabla respuestas_auto_enviadas ──────────────────────────────
CREATE TABLE IF NOT EXISTS respuestas_auto_enviadas (
  id BIGSERIAL PRIMARY KEY,

  -- Trazabilidad
  clasificacion_agente_id BIGINT,            -- FK suave a clasificaciones_agente.id
  gmail_message_id_entrante TEXT NOT NULL,   -- email que disparó la respuesta
  gmail_thread_id TEXT,                       -- hilo en Gmail (para mantener Re:)
  cuenta_origen TEXT NOT NULL,                -- desde qué cuenta se respondió (tomiralles@...)

  -- Destinatario
  destinatario_email TEXT NOT NULL,
  destinatario_nombre TEXT,
  asunto_entrante TEXT,

  -- Respuesta
  asunto_respuesta TEXT,
  cuerpo_respuesta TEXT NOT NULL,
  tipo_email TEXT,                            -- tipo del agente (pedido_cliente, etc.)
  plantilla_usada TEXT,                       -- ID de la plantilla de respuesta

  -- Métricas de generación (si usamos Claude para personalizar; null si plantilla fija)
  modelo_usado TEXT,
  input_tokens INT,
  output_tokens INT,
  coste_usd NUMERIC(10,6),

  -- Estado del envío
  enviado_ok BOOLEAN NOT NULL DEFAULT false,
  enviado_at TIMESTAMPTZ,
  gmail_message_id_enviado TEXT,              -- ID en Gmail del email enviado
  error_envio TEXT,                            -- si hubo error de Gmail API

  -- Auditoría
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices habituales
CREATE INDEX IF NOT EXISTS idx_respauto_created
  ON respuestas_auto_enviadas (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_respauto_thread
  ON respuestas_auto_enviadas (gmail_thread_id)
  WHERE gmail_thread_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_respauto_destinatario
  ON respuestas_auto_enviadas (destinatario_email);

-- Constraint útil: cada gmail_message_id_entrante solo puede tener
-- una respuesta enviada exitosa (anti-bucle / anti-dup).
CREATE UNIQUE INDEX IF NOT EXISTS uq_respauto_entrante_ok
  ON respuestas_auto_enviadas (gmail_message_id_entrante)
  WHERE enviado_ok = true;

COMMENT ON TABLE respuestas_auto_enviadas IS
  'Auditoría de respuestas automáticas enviadas por el agente (Fase 4C+4D).';

-- ─── 2. Toggle ON/OFF en config ──────────────────────────────────────
-- El dashboard lee/escribe este valor. Por defecto está APAGADO para
-- que el sistema NO envíe nada hasta que el usuario lo encienda.
INSERT INTO config (clave, valor, descripcion, actualizado_por, actualizado_en)
VALUES (
  'agent_auto_reply',
  '{"enabled": false, "min_confianza": 0.90}'::jsonb,
  'Toggle ON/OFF + parámetros para que el agente responda automáticamente.',
  'migracion-005',
  NOW()
)
ON CONFLICT (clave) DO NOTHING;  -- si ya existe (re-ejecución), no tocar

-- Sanity check
SELECT
  'respuestas_auto_enviadas creada y config inicializado' AS resultado,
  (SELECT COUNT(*) FROM respuestas_auto_enviadas) AS filas_respauto,
  (SELECT valor FROM config WHERE clave = 'agent_auto_reply') AS toggle;
