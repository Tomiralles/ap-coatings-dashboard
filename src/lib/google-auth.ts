/**
 * Autenticación con Service Account de Google + Domain-Wide Delegation.
 *
 * Lee la variable de entorno GOOGLE_SERVICE_ACCOUNT_JSON (el JSON completo
 * de la clave descargada) y crea clientes de Google API capaces de
 * impersonar cualquier usuario del dominio Workspace.
 *
 * Uso:
 *   const gmail = await getGmailClient("ventas@apcoatings.net");
 *   const profile = await gmail.users.getProfile({ userId: "me" });
 *
 * Variables de entorno necesarias:
 *   GOOGLE_SERVICE_ACCOUNT_JSON   JSON completo de la clave del SA
 *                                  (inyectado en Vercel, no en el repo)
 */

import { JWT } from "google-auth-library";
import { google, gmail_v1 } from "googleapis";

// Scopes que el Service Account está autorizado a usar para todos los
// usuarios del dominio (configurado en Workspace Admin Console > DWD).
//
// NOTA IMPORTANTE: NO incluir "gmail.metadata" aquí. Aunque parece aditivo,
// Gmail API lo trata como RESTRICTIVO: si se pide junto a readonly/modify,
// fuerza que todas las llamadas devuelvan solo cabeceras y bloquea
// `format: "full"` con el error «Metadata scope doesn't allow format FULL».
// `gmail.readonly` ya da acceso a cabeceras + cuerpo + adjuntos.
const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
];

interface ServiceAccountKey {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri: string;
  token_uri: string;
  auth_provider_x509_cert_url: string;
  client_x509_cert_url: string;
}

let cachedKey: ServiceAccountKey | null = null;

/**
 * Parsea la clave del Service Account desde la variable de entorno.
 * El resultado se cachea en memoria (vive lo que dure la función Vercel).
 */
function getServiceAccountKey(): ServiceAccountKey {
  if (cachedKey) return cachedKey;

  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON no está definida en las variables de entorno"
    );
  }

  try {
    cachedKey = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON no es un JSON válido: " + String(err)
    );
  }

  if (!cachedKey || !cachedKey.private_key || !cachedKey.client_email) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON está incompleta (faltan private_key o client_email)"
    );
  }

  return cachedKey;
}

/**
 * Crea un cliente JWT autenticado para impersonar a un usuario del dominio.
 *
 * @param userEmail  Email del usuario al que vamos a impersonar
 *                   (debe pertenecer al dominio configurado en DWD).
 */
export function getJWTClient(userEmail: string): JWT {
  const key = getServiceAccountKey();

  return new JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: GMAIL_SCOPES,
    subject: userEmail, // <-- Esto activa Domain-Wide Delegation
  });
}

/**
 * Devuelve un cliente de Gmail autenticado para una cuenta concreta del
 * dominio Workspace.
 *
 * @example
 *   const gmail = await getGmailClient("ventas@apcoatings.net");
 *   const labels = await gmail.users.labels.list({ userId: "me" });
 */
export async function getGmailClient(
  userEmail: string
): Promise<gmail_v1.Gmail> {
  const auth = getJWTClient(userEmail);
  await auth.authorize();
  return google.gmail({ version: "v1", auth });
}

/**
 * Devuelve el email del Service Account.
 * Útil para diagnóstico.
 */
export function getServiceAccountEmail(): string {
  return getServiceAccountKey().client_email;
}

/**
 * Devuelve el project_id de la clave del Service Account.
 * Útil para diagnóstico.
 */
export function getServiceAccountProjectId(): string {
  return getServiceAccountKey().project_id;
}
