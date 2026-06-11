-- Tabla de configuración WhatsApp por cliente (multi-tenant)
-- Cada fila = un negocio con su propio número de WhatsApp Business

CREATE TABLE IF NOT EXISTS clientes_whatsapp (
  id                  SERIAL PRIMARY KEY,
  slug                TEXT NOT NULL UNIQUE,         -- identificador corto, ej: "taller-garcia"
  nombre              TEXT NOT NULL,                -- nombre del negocio
  sector              TEXT NOT NULL DEFAULT 'otro', -- taller | clinica | restaurante | peluqueria | dentista | otro
  phone_number_id     TEXT NOT NULL,                -- WHATSAPP_PHONE_NUMBER_ID de Meta
  access_token        TEXT NOT NULL,                -- System User Token (no caduca)
  template_name       TEXT NOT NULL DEFAULT 'notificacion_cita',
  template_language   TEXT NOT NULL DEFAULT 'es',
  prompt_agente       TEXT,                         -- prompt personalizado para el agente IA (opcional)
  activo              BOOLEAN NOT NULL DEFAULT true,
  creado_en           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_clientes_whatsapp_slug   ON clientes_whatsapp(slug);
CREATE INDEX IF NOT EXISTS idx_clientes_whatsapp_sector ON clientes_whatsapp(sector);

-- Prompts por defecto según sector (tabla auxiliar)
CREATE TABLE IF NOT EXISTS sectores_config (
  sector          TEXT PRIMARY KEY,
  label           TEXT NOT NULL,
  prompt_default  TEXT NOT NULL,
  template_ejmplo TEXT
);

INSERT INTO sectores_config (sector, label, prompt_default, template_ejmplo) VALUES
  ('taller',      'Taller mecánico',   'Eres un asistente de un taller mecánico. Gestiona citas de reparación y revisión. Cuando el usuario quiera cita, recoge: nombre, teléfono, matrícula y tipo de avería.', 'Hola {nombre}, recordamos tu cita en el taller el {fecha} a las {hora}.'),
  ('clinica',     'Clínica estética',  'Eres un asistente de una clínica estética. Gestiona citas de tratamientos. Cuando el usuario quiera cita, recoge: nombre, teléfono, tratamiento y fecha preferida.', 'Hola {nombre}, confirmamos tu cita de {tratamiento} el {fecha} a las {hora}.'),
  ('restaurante', 'Restaurante',       'Eres un asistente de un restaurante. Gestiona reservas de mesa. Recoge: nombre, teléfono, número de comensales y fecha.', 'Hola {nombre}, confirmamos tu reserva para {comensales} personas el {fecha} a las {hora}.'),
  ('peluqueria',  'Peluquería',        'Eres un asistente de una peluquería. Gestiona citas. Recoge: nombre, teléfono, servicio y fecha preferida.', 'Hola {nombre}, te esperamos el {fecha} a las {hora} para tu {servicio}.'),
  ('dentista',    'Clínica dental',    'Eres un asistente de una clínica dental. Gestiona citas. Recoge: nombre, teléfono, tipo de consulta y fecha preferida.', 'Hola {nombre}, recordamos tu cita dental el {fecha} a las {hora}.'),
  ('otro',        'Otro negocio',      'Eres un asistente virtual. Ayuda al usuario a gestionar su consulta o cita.', 'Hola {nombre}, confirmamos tu cita el {fecha} a las {hora}.')
ON CONFLICT (sector) DO NOTHING;

-- Comentarios
COMMENT ON TABLE clientes_whatsapp IS 'Credenciales WhatsApp Business por cliente (multi-tenant)';
COMMENT ON COLUMN clientes_whatsapp.sector IS 'Tipo de negocio: taller | clinica | restaurante | peluqueria | dentista | otro';
COMMENT ON COLUMN clientes_whatsapp.access_token IS 'System User Token de Meta (no caduca). NO usar tokens temporales de 24h.';
COMMENT ON COLUMN clientes_whatsapp.prompt_agente IS 'Prompt personalizado. Si es NULL, se usa el prompt_default de sectores_config.';
