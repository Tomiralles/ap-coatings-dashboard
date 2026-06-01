import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

/**
 * Actualiza campos editables de un email en Postgres desde el dashboard,
 * cuando la fuente de datos es "postgres" (no Sheets).
 *
 * POST /api/registros-pg/update
 *   body: { id: string, campo: "estado"|"prioridad"|"telefono", valor: string }
 *
 * Los cambios se guardan dentro de datos_extraidos (JSONB) para no tocar
 * el enum estado_email (que es limitado). El endpoint de lectura
 * (registros-pg) lee estos overrides con prioridad sobre los valores
 * derivados/legacy.
 *
 * Campos soportados:
 *   - estado    → datos_extraidos.estado_override (texto libre, ej. "Enviado",
 *                 "Contabilizada", "Respondida"). También actualiza
 *                 estado_funcional a "archivado" si el estado indica
 *                 que ya está cerrado.
 *   - prioridad → datos_extraidos.prioridad
 *   - telefono  → datos_extraidos.telefono (y clientes.telefono si aplica)
 */

const CAMPOS_VALIDOS = new Set(["estado", "prioridad", "telefono"]);

// Estados que indican que el email ya está "cerrado" (no pendiente).
// Si el nuevo estado es uno de estos, marcamos estado_funcional=archivado.
const ESTADOS_CERRADOS = [
  "enviado",
  "contabilizada",
  "contabilizado",
  "respondida",
  "respondido",
  "completado",
  "completada",
  "archivado",
  "archivada",
  "revisada",
  "revisado",
  "cerrado",
  "cerrada",
];

export async function POST(req: NextRequest) {
  let body: { id?: string; campo?: string; valor?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body inválido" }, { status: 400 });
  }

  const { id, campo, valor } = body;

  if (!id) {
    return NextResponse.json({ ok: false, error: "Falta id" }, { status: 400 });
  }
  if (!campo || !CAMPOS_VALIDOS.has(campo)) {
    return NextResponse.json(
      { ok: false, error: `Campo inválido. Válidos: ${[...CAMPOS_VALIDOS].join(", ")}` },
      { status: 400 }
    );
  }

  const valorLimpio = (valor ?? "").trim();

  try {
    if (campo === "estado") {
      // Guardamos estado_override. Si es un estado "cerrado", también
      // marcamos estado_funcional=archivado (sale de pendientes).
      const esCerrado = ESTADOS_CERRADOS.some((e) =>
        valorLimpio.toLowerCase().includes(e)
      );
      const nuevoFuncional = esCerrado ? "archivado" : "pendiente";

      await sql`
        UPDATE emails
        SET datos_extraidos = jsonb_set(
              jsonb_set(
                COALESCE(datos_extraidos, '{}'::jsonb),
                '{estado_override}', to_jsonb(${valorLimpio}::text), true
              ),
              '{estado_funcional}', to_jsonb(${nuevoFuncional}::text), true
            ),
            updated_at = NOW()
        WHERE id = ${id}::uuid
      `;
    } else if (campo === "prioridad") {
      await sql`
        UPDATE emails
        SET datos_extraidos = jsonb_set(
              COALESCE(datos_extraidos, '{}'::jsonb),
              '{prioridad}', to_jsonb(${valorLimpio}::text), true
            ),
            updated_at = NOW()
        WHERE id = ${id}::uuid
      `;
    } else if (campo === "telefono") {
      // Actualizamos el telefono en datos_extraidos y también en el cliente
      await sql`
        UPDATE emails
        SET datos_extraidos = jsonb_set(
              COALESCE(datos_extraidos, '{}'::jsonb),
              '{telefono}', to_jsonb(${valorLimpio}::text), true
            ),
            updated_at = NOW()
        WHERE id = ${id}::uuid
      `;
      // Propagar al cliente vinculado (si lo hay y el telefono no está vacío)
      if (valorLimpio) {
        await sql`
          UPDATE clientes c
          SET telefono = ${valorLimpio}
          FROM emails e
          WHERE e.id = ${id}::uuid AND e.cliente_id = c.id
        `.catch(() => null);
      }
    }

    return NextResponse.json({ ok: true, id, campo, valor: valorLimpio });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
