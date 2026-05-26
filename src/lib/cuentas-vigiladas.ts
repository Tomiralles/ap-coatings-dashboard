/**
 * Lista centralizada de cuentas Workspace que el sistema vigila/procesa.
 *
 * IMPORTANTE — sobre los alias:
 * El dominio Workspace de AP Coatings tiene un solo buzón físico
 * (tomiralles@apcoatings.net) con varios alias que apuntan a él:
 *
 *   - ventas@apcoatings.net          → alias de tomiralles
 *   - logistica@apcoatings.net       → alias de tomiralles
 *   - administracion@apcoatings.net  → alias de tomiralles
 *
 * Por tanto, vigilar las 3 cuentas alias era REDUNDANTE: cada llamada
 * a Gmail API devolvía exactamente los mismos mensajes que la principal.
 * Tres veces más coste de API + tres veces más procesamiento, mismos datos.
 *
 * Solución: vigilar solo la cuenta principal `tomiralles@apcoatings.net`.
 *
 * NOTA — sobre abadpinturas@abadpinturas.com:
 * Esta cuenta legacy está en un dominio externo (NO Workspace de AP Coatings),
 * por lo que Domain-Wide Delegation no la puede impersonar. Se quitó de la
 * lista porque solo generaba errores de auth en cada ciclo del cron.
 * Cuando se desactive el hosting de abadpinturas.com (previsto), no se pierde
 * nada. Si en el futuro hay que recuperarla, se debería montar OAuth manual
 * o esperar a que se migre al dominio Workspace.
 */
export const CUENTAS_VIGILADAS = [
  "tomiralles@apcoatings.net",
] as const;

/**
 * Tipo derivado de las cuentas vigiladas. Útil para tipado fuerte
 * en endpoints que solo deben aceptar cuentas de la lista.
 */
export type CuentaVigilada = typeof CUENTAS_VIGILADAS[number];
