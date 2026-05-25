-- =====================================================================
-- Migración 004: tabla clasificaciones_agente (shadow mode Fase 3)
-- =====================================================================
--
-- Almacena cada clasificación que el agente Claude Opus 4.7 hace sobre
-- los emails que llegan al webhook. Durante el período de validación
-- (2 semanas) se compara con la clasificación del sistema actual
-- (Apps Script + etiquetas Gmail) para validar precisión antes de
-- promover al agente como sistema principal.
--
-- Pegar en el SQL Editor de Neon y ejecutar.
-- Es idempotente: si la tabla ya existe, no se modifica.
-- =====================================================================

CREATE TABLE IF NOT EXISTS clasificaciones_agente (
  id BIGSERIAL PRIMARY KEY,

  -- ───── Identificación del email en Gmail ─────
  gmail_message_id TEXT NOT NULL UNIQUE,        -- ID único del email
  gmail_thread_id TEXT,                          -- ID del hilo
  cuenta_destino TEXT NOT NULL,                  -- ventas@apcoatings.net etc

  -- ───── Datos del email original (para auditoría) ─────
  asunto TEXT,
  remitente TEXT,
  fecha_recibido TIMESTAMPTZ,
  tiene_adjuntos BOOLEAN DEFAULT false,
  nombres_adjuntos TEXT[],
  cuerpo_preview TEXT,                           -- primeros 500 chars (debug)

  -- ───── Output del agente clasificador ─────
  clasificacion JSONB NOT NULL,                  -- output completo del agente
  tipo TEXT,                                     -- duplicado (clasificacion->'tipo') para queries rápidas
  prioridad TEXT,                                -- duplicado (clasificacion->'prioridad')
  confianza NUMERIC(3,2),                        -- duplicado (clasificacion->'confianza')
  accion_sugerida TEXT,                          -- duplicado (clasificacion->'accion_sugerida')
  es_industriastak BOOLEAN DEFAULT false,
  es_autoenvio_sql_pyme BOOLEAN DEFAULT false,

  -- ───── Metadatos de la llamada a Anthropic ─────
  modelo TEXT NOT NULL,
  input_tokens INT DEFAULT 0,
  output_tokens INT DEFAULT 0,
  cache_creation_input_tokens INT DEFAULT 0,
  cache_read_input_tokens INT DEFAULT 0,
  latencia_ms INT,
  stop_reason TEXT,
  coste_usd NUMERIC(10,6),                       -- calculado tras la llamada

  -- ───── Comparación con Apps Script (Fase 4) ─────
  clasificacion_apps_script TEXT,                -- etiqueta que Apps Script puso (cuando esté disponible)
  comparado_at TIMESTAMPTZ,                      -- cuándo se comparó
  coincide BOOLEAN,                              -- ¿coincide con Apps Script?
  notas_revision TEXT,                           -- comentarios manuales de Toni

  -- ───── Trazabilidad ─────
  -- evento_id como TEXT sin FK para tolerar distintos tipos en eventos.id
  -- (UUID en este proyecto). Lo guardamos como dato, no como integridad.
  evento_id TEXT,                                -- evento Pub/Sub que disparó esto (puede ser NULL)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para queries habituales
CREATE INDEX IF NOT EXISTS idx_clasif_agente_cuenta_fecha
  ON clasificaciones_agente (cuenta_destino, fecha_recibido DESC);

CREATE INDEX IF NOT EXISTS idx_clasif_agente_tipo
  ON clasificaciones_agente (tipo);

CREATE INDEX IF NOT EXISTS idx_clasif_agente_coincide
  ON clasificaciones_agente (coincide)
  WHERE coincide IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clasif_agente_industriastak
  ON clasificaciones_agente (es_industriastak)
  WHERE es_industriastak = true;

CREATE INDEX IF NOT EXISTS idx_clasif_agente_created
  ON clasificaciones_agente (created_at DESC);

-- Comentario en la tabla para documentación
COMMENT ON TABLE clasificaciones_agente IS
  'Shadow mode Fase 3: clasificaciones del agente Claude Opus 4.7 para validar contra Apps Script antes de promover.';

COMMENT ON COLUMN clasificaciones_agente.clasificacion IS
  'JSON completo devuelto por el clasificador (tipo, confianza, prioridad, datos_extraidos, etc.)';

COMMENT ON COLUMN clasificaciones_agente.coincide IS
  'NULL = aún no comparado. true/false = comparación con Apps Script.';

-- Sanity check
SELECT
  'clasificaciones_agente creada correctamente' AS resultado,
  (SELECT COUNT(*) FROM clasificaciones_agente) AS filas_actuales;
