import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Gestión de clientes WhatsApp (multi-tenant).
 *
 * GET    /api/clientes-wa          → lista todos los clientes
 * GET    /api/clientes-wa?slug=x   → un cliente concreto
 * POST   /api/clientes-wa          → crear/actualizar cliente (upsert por slug)
 * DELETE /api/clientes-wa?slug=x   → desactivar cliente (soft delete)
 *
 * NOTA: el access_token se devuelve enmascarado en GET (solo últimos 4 chars)
 * por seguridad. El valor completo solo se usa internamente al enviar mensajes.
 */

const SECTORES_VALIDOS = ["taller", "clinica", "restaurante", "peluqueria", "dentista", "otro"];

interface ClienteInput {
  slug: string;
  nombre: string;
  sector?: string;
  phone_number_id: string;
  access_token: string;
  template_name?: string;
  template_language?: string;
  prompt_agente?: string | null;
  activo?: boolean;
}

function maskToken(token: string): string {
  if (!token || token.length < 8) return "****";
  return "****" + token.slice(-4);
}

// ─────────────────────────────────────────────
//  GET — listar o consultar
// ─────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("slug");

  try {
    if (slug) {
      const rows = await sql`
        SELECT id, slug, nombre, sector, phone_number_id, access_token,
               template_name, template_language, prompt_agente, activo,
               creado_en, actualizado_en
        FROM clientes_whatsapp WHERE slug = ${slug} LIMIT 1
      `;
      if (rows.length === 0) {
        return NextResponse.json({ ok: false, error: "Cliente no encontrado" }, { status: 404 });
      }
      const c = rows[0];
      return NextResponse.json({
        ok: true,
        cliente: { ...c, access_token: maskToken(c.access_token as string) },
      });
    }

    const rows = await sql`
      SELECT id, slug, nombre, sector, phone_number_id, access_token,
             template_name, template_language, activo, creado_en
      FROM clientes_whatsapp ORDER BY creado_en DESC
    `;
    const clientes = rows.map((c: Record<string, unknown>) => ({
      ...c,
      access_token: maskToken(c.access_token as string),
    }));
    return NextResponse.json({ ok: true, total: clientes.length, clientes });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

// ─────────────────────────────────────────────
//  POST — crear o actualizar (upsert por slug)
// ─────────────────────────────────────────────
export async function POST(req: NextRequest) {
  let body: ClienteInput;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body inválido (no JSON)" }, { status: 400 });
  }

  // Validación de campos obligatorios
  if (!body.slug || !body.nombre || !body.phone_number_id || !body.access_token) {
    return NextResponse.json(
      { ok: false, error: "Faltan campos obligatorios: slug, nombre, phone_number_id, access_token" },
      { status: 400 }
    );
  }

  const sector = body.sector && SECTORES_VALIDOS.includes(body.sector) ? body.sector : "otro";
  const templateName = body.template_name ?? "notificacion_cita";
  const templateLang = body.template_language ?? "es";
  const promptAgente = body.prompt_agente ?? null;
  const activo = typeof body.activo === "boolean" ? body.activo : true;

  // Si el token viene enmascarado (****xxxx), es que el panel reenvió un valor
  // de solo lectura: NO sobrescribimos el token real, conservamos el existente.
  const tokenEnmascarado = body.access_token.startsWith("****");

  try {
    const rows = await sql`
      INSERT INTO clientes_whatsapp
        (slug, nombre, sector, phone_number_id, access_token,
         template_name, template_language, prompt_agente, activo, actualizado_en)
      VALUES
        (${body.slug}, ${body.nombre}, ${sector}, ${body.phone_number_id}, ${body.access_token},
         ${templateName}, ${templateLang}, ${promptAgente}, ${activo}, NOW())
      ON CONFLICT (slug) DO UPDATE SET
        nombre            = EXCLUDED.nombre,
        sector            = EXCLUDED.sector,
        phone_number_id   = EXCLUDED.phone_number_id,
        access_token      = CASE WHEN ${tokenEnmascarado}
                                 THEN clientes_whatsapp.access_token
                                 ELSE EXCLUDED.access_token END,
        template_name     = EXCLUDED.template_name,
        template_language = EXCLUDED.template_language,
        prompt_agente     = EXCLUDED.prompt_agente,
        activo            = EXCLUDED.activo,
        actualizado_en    = NOW()
      RETURNING id, slug, nombre, sector, activo
    `;

    return NextResponse.json({ ok: true, cliente: rows[0] });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

// ─────────────────────────────────────────────
//  DELETE — soft delete (desactivar)
// ─────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("slug");
  if (!slug) {
    return NextResponse.json({ ok: false, error: "Falta el parámetro slug" }, { status: 400 });
  }

  try {
    const rows = await sql`
      UPDATE clientes_whatsapp SET activo = false, actualizado_en = NOW()
      WHERE slug = ${slug}
      RETURNING slug, activo
    `;
    if (rows.length === 0) {
      return NextResponse.json({ ok: false, error: "Cliente no encontrado" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, cliente: rows[0] });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
