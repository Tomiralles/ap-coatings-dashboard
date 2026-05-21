# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (uses Turbopack)
pnpm dev

# Build
pnpm build

# Lint
pnpm lint

# Start production server
pnpm start
```

There is no test suite. TypeScript errors and ESLint are suppressed during builds (`ignoreBuildErrors: true`, `ignoreDuringBuilds: true` in `next.config.ts`), so type errors won't block a build but should still be fixed.

To add shadcn/ui components: `pnpx shadcn@latest add <component>` (style: new-york, baseColor: neutral).

## Architecture Overview

This is a **Next.js 15 (App Router) + React 19** internal operations dashboard for AP Coatings, a Spanish paint/chemicals distributor. The app manages customer orders, supplier invoices, and inquiries with AI-assisted response drafting.

### Data Layer: Google Sheets as the Database

The primary data store is a Google Spreadsheet (`1AwQRGxXeIWIN5ODjvDbbjNGCB-UQ8UdEPZUpuoHKzvE`) with two relevant sheets:

- **`Hoja 1`** — main activity log (orders, invoices, inquiries)
- **`Cola_Respuestas`** — queue of AI-generated response drafts

All **write operations** go through Google Apps Script (`apps-script-actualizado.gs`), deployed as a web app URL in `GOOGLE_APPS_SCRIPT_URL`. The script handles: updating cells, saving to the queue, marking responses sent, and sending emails via Gmail.

**Read operations** try Apps Script first (`?accion=leerHoja`), then fall back to the Sheets REST API (`GOOGLE_SHEETS_API_KEY`).

The `@neondatabase/serverless` client (`src/lib/db.ts`) is configured but currently unused in the main data flows — it provides `sql` and `sqlDirect` exports for potential future direct Postgres queries.

### Column Mapping

`Hoja 1` rows (0-indexed in JS, 1-indexed when passed to Apps Script for updates):

| JS idx | Apps Script col | Field |
|--------|----------------|-------|
| 0 | — | fecha |
| 1 | — | quien (client name/email) |
| 2 | — | asunto |
| 3 | — | enlace (comma-separated URLs) |
| 4 | — | cuerpo (email body) |
| 5 | 6 | estado |
| 6 | 7 | tipo (Pedido / Factura / Consulta) |
| 7 | 8 | prioridad |
| 8 | 9 | autoDropdown |
| 9 | 10 | respuestaAuto |
| 10 | 11 | telefono |

When calling `/api/sheets/update`, pass `columna` as the **1-indexed** Apps Script column number.

### AI Response Flow

When a user marks a `Pedido` as **"Enviado"** on the dashboard, it automatically triggers the AI drafting pipeline:

1. `/api/claude/generar` — calls **Gemini** (`GOOGLE_AI_API_KEY`, default model `gemini-2.5-flash`) to generate an email and/or WhatsApp draft. Despite the route name `/api/claude/generar`, it uses Google's Gemini API (not Anthropic Claude).
2. `/api/respuestas/crear` — saves the draft to `Cola_Respuestas` sheet via Apps Script with status `pendiente`.
3. The dashboard polls `/api/respuestas` every 30 seconds and surfaces pending drafts in `ColaRespuestas` component.
4. User can **approve** (sends the message), **regenerate** (calls Gemini again), or **reject** (marks as rejected in the sheet).

**Auto-send mode** (`/api/ocupado/estado`): When `ocupado=true` in the `Config` sheet, the `/api/respuestas/auto-enviar` endpoint bypasses the approval queue and immediately sends the message. This mode is toggled via POST to the same endpoint.

### WhatsApp Integration

`src/lib/whatsapp.ts` wraps the Meta WhatsApp Business API (`v21.0`):
- `sendWhatsAppFreeform` — free-text message, only works within 24h of last customer contact.
- `sendWhatsAppNotification` — approved template message, works anytime. Template name is in `WHATSAPP_TEMPLATE_NAME`.

When approving a WhatsApp draft (`/api/respuestas/aprobar`), it attempts freeform first and falls back to the template automatically.

The direct WhatsApp send from the table UI (`getWhatsAppLink`) opens `wa.me` deep links in the browser — it does **not** use the API.

### API Routes Summary

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/sheets` | GET | Read `Hoja 1` registros |
| `/api/sheets/update` | POST | Update a cell (`fila`, `columna`, `valor`) |
| `/api/claude/generar` | POST | Generate draft via Gemini |
| `/api/respuestas` | GET | Read pending `Cola_Respuestas` entries |
| `/api/respuestas/crear` | POST | Save draft to queue |
| `/api/respuestas/aprobar` | POST | Send message + mark as approved |
| `/api/respuestas/rechazar` | POST | Mark as rejected |
| `/api/respuestas/auto-enviar` | POST | Create + conditionally auto-approve |
| `/api/ocupado/estado` | GET/POST | Read/write busy mode flag |
| `/api/whatsapp/send` | POST | Direct WhatsApp send (template or freeform) |
| `/api/db-test` | GET | Test Neon DB connection |

### Frontend Structure

`src/app/dashboard/page.tsx` is a single large client component (~1300 lines) containing the entire dashboard UI plus several co-located sub-components:

- `DashboardPage` — main component, owns all state and data-fetching
- `ColaRespuestas` — approval queue panel for AI drafts
- `KanbanBoard` / `KanbanCard` — drag-and-drop kanban view (HTML5 drag API)
- `EstadoDropdown` — state-aware status selector; options vary by record type
- `KPICard` — simple stat card

The dashboard supports two view modes (table / kanban) and filters by search text, estado, tipo, and tab (todo / pedidos / facturas / consultas). Test entries (asunto containing `(prueba)`) are hidden by default.

### UI Components

All UI primitives are in `src/components/ui/` and come from **shadcn/ui** (new-york style). Use `cn()` from `src/lib/utils.ts` for conditional class merging.

### Environment Variables

Required in `.env.local` (or Vercel env):

```
GOOGLE_AI_API_KEY          # Gemini API key
GOOGLE_APPS_SCRIPT_URL     # Deployed Apps Script web app URL (primary backend)
GOOGLE_SHEETS_API_KEY      # Fallback read-only Sheets API key
DATABASE_URL               # Neon Postgres (pooled)
DATABASE_URL_UNPOOLED      # Neon Postgres (direct, for migrations)
WHATSAPP_PHONE_NUMBER_ID   # Meta phone number ID
WHATSAPP_ACCESS_TOKEN      # Meta user token (expires; renew in Vercel if 401)
WHATSAPP_BUSINESS_ACCOUNT_ID
WHATSAPP_TEMPLATE_NAME     # Approved template name (e.g. "washap abad pinturas")
GEMINI_MODEL               # Optional, defaults to "gemini-2.5-flash"
```

### Google Apps Script

`apps-script-actualizado.gs` contains the code to add/replace in the deployed Apps Script. It handles `doPost` actions: `enviarEmail`, `guardarEnCola`, `actualizarCola`, `actualizarOcupado`, `leerOcupado`, and the default cell-update behavior. Run `crearHolaColaRespuestas()` once to create the `Cola_Respuestas` sheet with correct headers.
