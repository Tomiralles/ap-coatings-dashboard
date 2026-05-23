import { NextResponse } from "next/server";
import {
  getGmailClient,
  getServiceAccountEmail,
  getServiceAccountProjectId,
} from "@/lib/google-auth";

/**
 * Endpoint de verificación: comprueba que el Service Account + DWD
 * funcionan correctamente con las 4 cuentas Workspace de AP Coatings.
 *
 * GET /api/gmail/test-auth
 *
 * Para cada cuenta:
 *  - Intenta obtener el perfil de Gmail
 *  - Cuenta cuántos mensajes hay en total
 *  - Reporta errores si los hay
 *
 * Si todas las cuentas reportan OK, significa que:
 *  - GOOGLE_SERVICE_ACCOUNT_JSON está bien configurada
 *  - Domain-Wide Delegation está activado en Workspace Admin
 *  - Los scopes autorizados son los correctos
 */

const CUENTAS_A_VERIFICAR = [
  "abadpinturas@abadpinturas.com",
  "ventas@apcoatings.net",
  "logistica@apcoatings.net",
  "administracion@apcoatings.net",
];

export async function GET() {
  const resultados: Array<{
    cuenta: string;
    ok: boolean;
    email_address?: string;
    messages_total?: number;
    threads_total?: number;
    error?: string;
  }> = [];

  for (const cuenta of CUENTAS_A_VERIFICAR) {
    try {
      const gmail = await getGmailClient(cuenta);
      const profile = await gmail.users.getProfile({ userId: "me" });
      resultados.push({
        cuenta,
        ok: true,
        email_address: profile.data.emailAddress ?? undefined,
        messages_total: profile.data.messagesTotal ?? undefined,
        threads_total: profile.data.threadsTotal ?? undefined,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      resultados.push({ cuenta, ok: false, error: msg });
    }
  }

  const todasOk = resultados.every((r) => r.ok);

  return NextResponse.json({
    ok: todasOk,
    service_account_email: getServiceAccountEmail(),
    project_id: getServiceAccountProjectId(),
    cuentas: resultados,
    mensaje: todasOk
      ? "Todas las cuentas Workspace responden correctamente"
      : "Hay cuentas con error - revisa Domain-Wide Delegation en Workspace Admin",
  });
}
