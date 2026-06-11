-- Tabla de configuración WhatsApp por cliente (multi-tenant)
-- Cada fila = un negocio con su propio número de WhatsApp Business

CREATE TABLE IF NOT EXISTS clientes_whatsapp (
  id                  SERIAL PRIMARY KEY,
  slug                TEXT NOT NULL UNIQUE,         -- identificador corto, ej: "taller-garcia"
  nombre              TEXT NOT NULL,                -- nombre del negocio
  phone_number_id     TEXT NOT NULL,                -- WHATSAPP_PHONE_NUMBER_ID de Meta
  access_token        TEXT NOT NULL,                -- System User Token (no caduca)
  template_name       TEXT NOT NULL DEFAULT 'notificacion_cita',
  template_language   TEXT NOT NULL DEFAULT 'es',
  activo              BOOLEAN NOT NULL DEFAULT true,
  creado_en           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice para buscar por slug rápido
CREATE INDEX IF NOT EXISTS idx_clientes_whatsapp_slug ON clientes_whatsapp(slug);

-- Comentarios
COMMENT ON TABLE clientes_whatsapp IS 'Credenciales WhatsApp Business por cliente (multi-tenant)';
COMMENT ON COLUMN clientes_whatsapp.slug IS 'ID corto usado en la API, ej: taller-garcia';
COMMENT ON COLUMN clientes_whatsapp.access_token IS 'System User Token de Meta (no caduca). NO usar tokens temporales de 24h.';
