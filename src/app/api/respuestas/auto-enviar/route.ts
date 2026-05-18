import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      tipo,
      destinatario,
      asunto,
      borrador,
      rowOrigen,
      contextoJson,
      threadId,
    } = body as {
      tipo: "email" | "whatsapp";
      destinatario: string;
      asunto: string;
      borrador: string;
      rowOrigen?: string;
      contextoJson?: string;
      threadId?: string;
    };

    // Validate required fields
    if (!tipo || !destinatario || !borrador) {
      return NextResponse.json(
        { error: "Faltan parámetros: tipo, destinatario, borrador" },
        { status: 400 }
      );
    }

    // Step 1: Check busy state
    let ocupado = false;
    try {
      const ocupadoRes = await fetch(
        `${request.headers.get("origin") || "http://localhost:3000"}/api/ocupado/estado`
      );
      if (ocupadoRes.ok) {
        const ocupadoData = await ocupadoRes.json();
        ocupado = ocupadoData.ocupado === true;
      }
    } catch (err) {
      console.warn("Error checking ocupado state:", err);
      // Continue with ocupado = false (safer default)
    }

    // Step 2: Create response (with auto flag)
    let respuestaId: string | undefined;
    try {
      const crearRes = await fetch(
        `${request.headers.get("origin") || "http://localhost:3000"}/api/respuestas/crear`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tipo,
            rowOrigen: rowOrigen ?? "",
            destinatario,
            asunto: asunto ?? "",
            threadId: threadId ?? "",
            borrador,
            contextoJson: contextoJson ?? "",
            auto: ocupado, // Pass auto flag based on busy state
          }),
        }
      );

      if (!crearRes.ok) {
        const error = await crearRes.json();
        return NextResponse.json(
          { ok: false, auto: false, error: "Error al crear respuesta", details: error },
          { status: 500 }
        );
      }

      const crearData = await crearRes.json();
      respuestaId = crearData.id;

      // If NOT ocupado, return now (response is pending, awaits approval)
      if (!ocupado) {
        return NextResponse.json({
          ok: true,
          auto: false,
          enviado: false,
          id: respuestaId,
          message: "Respuesta guardada en cola para aprobación manual",
        });
      }
    } catch (err) {
      console.error("Error creating respuesta:", err);
      return NextResponse.json(
        { ok: false, auto: false, error: "Error interno", details: String(err) },
        { status: 500 }
      );
    }

    // Step 3: If ocupado=true, auto-approve and send
    if (ocupado && respuestaId) {
      try {
        const aprobarRes = await fetch(
          `${request.headers.get("origin") || "http://localhost:3000"}/api/respuestas/aprobar`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: respuestaId,
              tipo,
              destinatario,
              asunto: asunto ?? "",
              threadId: threadId ?? "",
              borradorFinal: borrador,
              contextoJson: contextoJson ?? "",
            }),
          }
        );

        if (!aprobarRes.ok) {
          const error = await aprobarRes.json();
          console.error("Error auto-approving respuesta:", error);
          // Message was sent but not marked in sheets, still count as success
          return NextResponse.json({
            ok: true,
            auto: true,
            enviado: true,
            id: respuestaId,
            message: "Respuesta auto-aprobada y enviada (con advertencia de actualización)",
          });
        }

        return NextResponse.json({
          ok: true,
          auto: true,
          enviado: true,
          id: respuestaId,
          message: "Respuesta auto-aprobada y enviada automáticamente",
        });
      } catch (err) {
        console.error("Error auto-approving respuesta:", err);
        // If auto-approve fails, still return success (respuesta was created)
        return NextResponse.json({
          ok: true,
          auto: true,
          enviado: false,
          id: respuestaId,
          error: "Error al enviar automáticamente (respuesta está en cola)",
        });
      }
    }

    // Fallback (shouldn't reach here)
    return NextResponse.json({
      ok: true,
      auto: false,
      enviado: false,
      id: respuestaId,
    });
  } catch (err) {
    console.error("Error en /api/respuestas/auto-enviar:", err);
    return NextResponse.json(
      { ok: false, auto: false, error: "Error interno", details: String(err) },
      { status: 500 }
    );
  }
}
