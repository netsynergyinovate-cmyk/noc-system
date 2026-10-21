# Build on this starter

This is the **PostgreSQL base** of the ngodingpakeai starter family. Help beginners turn a plain-language idea into a working app. Keep explanations short, explain decisions in familiar words, and implement the smallest useful feature end to end. Ask only about product decisions that materially change the work.

## First prompt: set up, then build

A request to build or run an app includes preparing its local development environment. Do this on the first feature prompt even if the user never asks about a database. For read-only questions or reviews, do not start services unnecessarily.

1. Read `README.md`, `package.json`, and `.agents/skills/starter-setup/SKILL.md`.
2. If dependencies are missing, run `npm run setup`. If installed, run `npm run predev` and `npm run doctor`. These commands preserve existing settings and data, prepare missing secrets, start managed PostgreSQL, wait for health, and apply committed migrations. Fix a reported setup problem before relying on database behavior.
3. Use the local Docker database by default when no `DATABASE_URL` is supplied. Do not ask beginners to choose a database provider, generate passwords, copy environment files, or create tables. If an existing Docker installation is stopped, start it when permitted. If a prerequisite needs user action, explain the exact action and continue work that does not depend on it.
4. Start `npm run dev` in a persistent terminal unless this project's preview is already running. Verify the actual URL responds. Keep `BETTER_AUTH_URL` matched to that origin, including the port. Avoid duplicate servers.
5. Continue the user's requested feature. Setup alone does not complete a request to build an app.

Use the relevant skill below. Clients without skill discovery should open its file directly. `agent.md` is an alternate entrypoint to these canonical instructions.

| Task                                                   | Project skill                            |
| ------------------------------------------------------ | ---------------------------------------- |
| First app prompt or setup problem                      | `.agents/skills/starter-setup/SKILL.md`  |
| Start, inspect, stop, or troubleshoot the dev database | `.agents/skills/dev-database/SKILL.md`   |
| Build a feature, change the UI, or add data            | `.agents/skills/build-feature/SKILL.md`  |
| Create a dashboard/chatbot/other derivative            | `.agents/skills/create-variant/SKILL.md` |
| Standar Rekayasa & Eksekusi Task (Gemini & Claude Code)| `.agents/skills/gemini-claude-code/SKILL.md` |

## Development database

`compose.dev.yaml` runs PostgreSQL only; Next.js runs on the host. Use `npm run db:up`, `db:status`, `db:logs`, and `db:down` so private environment settings and the saved Compose project name are loaded. Fresh setup chooses a free database port, generates credentials, and stores data in a persistent named volume. `db:down` keeps that volume. Preserve `.env.local` and never run volume deletion or destructive resets to repair setup. Supplied external connections bypass Docker. See `docs/local-development.md` for the complete workflow.

## Current documentation with Context7

For library, framework, SDK, API, CLI, or cloud-service syntax, configuration, setup, migrations, or library-specific debugging, use Context7 even when the API seems familiar. Do not use it for pure business logic, general programming, or code review without an API question.

1. Call `resolve-library-id` with the library's official name and the actual question, unless the user supplied an exact Context7 library ID.
2. Select the official project or authoritative docs by relevance, reputation, coverage, and installed version. Refine a mismatched search.
3. Call `query-docs` with the resolved ID and a focused question. Use separate queries for unrelated concepts and observe the tool's call limits.
4. Check the examples against the installed version. If Context7 is unavailable, say so, use official documentation, and continue work that does not depend on the missing answer. Do not claim a connection was tested just because its config exists.

Project-scoped MCP files for Codex, Claude Code, Cursor, and VS Code are included. See `docs/ai-workflow.md` for activation. Never put credentials into prompts or committed MCP files.

## Code map and boundaries

Long per-feature notes (auth pages, session/access, billing, alerts, thresholds, audit) live in `docs/noc/`. Each bullet below names its file: read it before changing that feature.

- `src/app`: Next.js App Router pages. Server Components by default; use client components for interaction.
- `src/app/(auth)`: signup/signin. `src/app/(protected)`: protected app screens. Route-group names do not affect URLs.
- `src/lib/auth.ts`, `auth-client.ts`, `session.ts`: Better Auth server, browser client, and real database-backed session checks. Keep `nextCookies()` last in the plugin list.
- `src/components/auth-form.tsx`, `src/lib/auth-errors.ts`, `src/app/(auth)/layout.tsx`, `src/app/page.tsx`, `src/components/brand.tsx`: the sign-in and sign-up pages (Indonesian copy). Real Better Auth only: no demo accounts, no bypass, no operational numbers on these public pages. `authFailureMessage` and `authFailureFocus` (`auth-errors.ts`) are the only place that turns a failure into the Indonesian message and the field to focus; sign-in gives ONE message for every credential failure. The login rate limit's client address is decided in `src/lib/auth-security.ts` (`TRUSTED_PROXIES`). Known limit: sign-up is open. Read `docs/noc/auth-pages.md` before changing them.
- `src/lib/permissions.ts`: shared access control statement and roles for the Better Auth admin plugin. Imported by both the server and browser client, so keep it free of secrets and server-only imports.
- `src/lib/roles.ts`, `src/lib/session-store.ts`, `src/components/session-provider.tsx`, `src/components/dashboard/role-badge.tsx`, `src/app/(protected)/layout.tsx`, `src/lib/access.ts`, `src/components/access.tsx`: the session and role store the UI reads, the mock role preview ("Lihat sebagai"), UI capabilities (`useCanDo`, `<Can>`), server-side write authorization for routers and alerts, and `npm run seed:accounts`. ONE Zustand store per `SessionProvider`, never a module-level `create()` store. Everything in the UI decides what is DISPLAYED, never access: pages and APIs keep `requirePermission` and `withApiPermission`. Read `docs/noc/session-access.md` before changing them.
- `backend/internal/billing/`, `backend/internal/httpapi/billing.go`, `backend/internal/state/billing.go`, `drizzle/0006_billing_sync.sql`: the REAL billing sync. Read "Sinkron billing (implementasi)" in `backend/README.md` and `docs/noc/billing-sync-backend.md` first. The matching rule exists twice (TS `matchBilling`, Go `MatchInvoices`) with a shared 543-case file; the scraper's `DefaultProfile()` must be matched to the real billing site; a failed sync never touches `billing_status`. Go tests that need PostgreSQL skip without `TEST_DATABASE_URL`, so run them with `npm test`; goldens are rewritten with `UPDATE_GOLDEN=1 npm test`.
- `src/db/schema/`, `src/db/index.ts`, `drizzle/`: PostgreSQL tables, shared node-postgres pool, committed migrations. Run on Node.js with a persistent PostgreSQL server.
- `src/app/api/`: thin HTTP route handlers. Use `withApiSession` from `src/lib/api.ts` for authenticated JSON endpoints.
- `src/services/`: server-only application logic and all domain Drizzle queries. Pass the verified session user ID separately; filter ownership in SQL.
- `src/validators/`: strict Zod input schemas and inferred types. See `docs/backend.md` and the Notes example.
- `src/components/ui`: owned shadcn/ui primitives. Reuse them and `cn()`; add components with `npx shadcn@4.21.0 add <component>`.
- `src/app/globals.css`: Tailwind v4 theme tokens. No Tailwind v3 config is needed. Motion imports come from `motion/react`; respect reduced motion.
- `starter.config.json` and `src/config/site.ts`: identity and common paths.
- `backend/`: separate Go module (`noc-isp/backend`) for the NOC data collector, rule engine, and WebSocket hub. It is not part of the Next.js build or image. Run `npm run backend:dev`, `backend:check`, `backend:build`; see `backend/README.md`. The Notes/Drizzle rules below apply to the Next.js side only.
- `src/app/api/realtime/ticket`, `src/lib/realtime-ticket.ts`: issue the short-lived signed ticket the Go backend checks (shared `REALTIME_TOKEN_SECRET`). Never expose the secret or put it in a `NEXT_PUBLIC_` variable; the format is documented in `backend/README.md`.
- `src/app/(protected)/setup`, `src/services/devices.service.ts`: the Setup Perangkat gate. With `DASHBOARD_DATA=live` the dashboard layout redirects to `/setup` until at least one active router or OLT has `last_seen_at` set; the default `demo` mode skips the gate because the dashboard still shows mock data. Flip the default to `live` only once adding and testing devices works, otherwise nobody can open the dashboard.
- `src/lib/dashboard/`, `src/components/dashboard/`: the dashboard UI with mock data. `store.ts` takes snapshot/delta messages; `mock-feed.ts` stands in for the backend WebSocket and is replaced inside `dashboard-feed.tsx`. Alerts live in ONE store (`useAlertStore`, fed by `DashboardFeed` mounted once in the app layout), not per-page polling. Render alert times with `AlertTime`/`AlertEndTime` and places with `AlertPlace` (never invent a point for a router alert); point at an incident through `focusMap` or `mapFocusHref` (`lib/dashboard/map-focus.ts`); `anomalyRules` is the single source for thresholds and must match the Go rule engine. Covers the traffic range picker, map focus, Alert page lists, resolved-history filters, alert sound, Deteksi Anomali, correlation and incident cards. Read `docs/noc/dashboard-alerts.md` before changing any of it.
- `src/lib/dashboard/handled-registry.ts`, `alert-actions.ts`, `src/components/dashboard/handle-alert-dialog.tsx`: "Tandai ditangani" (operator closes an active alert, it moves to the history). Live mode (`LiveAlertSync`, `alert-actions-live.ts`) writes the database through `POST /api/alerts/{id}/handle` (`handled_by`/`handled_at` on `alerts`); only demo mode's mock alerts use the mock server in `localStorage` key `alertHandled`, because they have no database rows. Buttons use `aria-disabled`, never `disabled`. Details and tests in `docs/noc/dashboard-alerts.md`.
- `src/lib/dashboard/alert-badge.ts`, `src/components/dashboard/alert-count-badge.tsx`, `app-nav.tsx`: active alert count on the "Alert" menu item. The link's accessible name must stay exactly "Alert" (the pill is `aria-hidden`, the sentence is a sibling `role="status"`). Details in `docs/noc/dashboard-alerts.md`.
- `src/app/(protected)/app/billing`, `src/lib/dashboard/billing.ts`, `billing-filter.ts`, `use-refresh-at.ts`, `src/components/dashboard/billing-*.tsx`: the Status Billing page (`/app/billing`), mock data for now (`<MockDataNotice source="sistem billing" />`). `matchBilling` is the one statement of the PPPoE matching rule the Go sync must follow; a failed sync never hides data; statuses move through the Zustand store (`billingChanges`); the Lunas/Isolir badge is one component (`BillingStatusBadge`). The "Sinkron Tagihan" button in the Pelanggan table is old placeholder code, not connected. E2E runs against the production build: run `npm run build` first. Read `docs/noc/billing-page.md` before changing it.
- `src/lib/dashboard/thresholds.ts`, `threshold-registry.ts`, `src/components/dashboard/threshold-settings.tsx`, tab "Ambang Batas" of `settings-board.tsx` (`/app/pengaturan`): alert threshold settings. Defaults are READ from `anomalyRules`, never repeated. Stored in table `alert_thresholds` via `GET/PUT/DELETE /api/thresholds` (`threshold:manage` to write); saving is blocked until the stored values loaded. HONESTY: the Go rule engine reads the table only at backend start (restart to apply), and the numbers do NOT change `anomalyRules`, demo mock alerts or the Anomali page. The other settings tabs still keep secrets (Telegram token, WhatsApp numbers) in plain `localStorage`, which is not a place for secrets. E2E runs against the production build: run `npm run build` first. Read `docs/noc/thresholds.md` before changing it.
- `src/lib/dashboard/audit.ts`, `src/components/dashboard/audit-board.tsx`, `src/app/(protected)/app/jejak-aktivitas/page.tsx`, `audit-filter.ts`: the activity log page, mock data for now (`<MockDataNotice source="log audit di backend" />`). `audit.ts` holds the contract of the future `GET /api/v1/audit`. SECRETS NEVER ENTER THE LOG: a secret field may only be `redacted(field)`, `changed()` and `buildAuditEntry` refuse secret-looking names and values, and the backend must apply the same rules before writing to `audit_log`. Keep `matches`, `filterAudit` and `auditFacetCounts` on ONE checker (`matchesWith`). Read `docs/noc/audit-log.md` before changing it.

- `src/db/schema/api-keys.ts`, `src/services/api-keys.service.ts`, `src/services/external-data.service.ts`, `src/app/api/api-keys/`, `src/app/api/v1/data/`, `src/app/(protected)/app/api-key/`: API keys for external apps. `withApiSession` accepts `Authorization: Bearer noc_...` and acts as the key's owner; `read` keys refuse non-GET; keys never manage keys. `GET /api/v1/data` pages through an explicit allowlist of tables with secret columns dropped; a new table is NOT exported until added there. Read `docs/noc/api-key.md` before changing it.
- `src/app/api/snap/`, `src/services/road-snap.service.ts`, `compose.osrm.yaml`: road snapping for the map app via self-hosted OSRM (`foot` profile, Sumatra data). Response is NOT wrapped in `{ data }`; failure returns the original points with `snapped:false`, never invented geometry. Read `docs/noc/road-snap.md` before changing it.

Authenticate at each server data boundary: use `requireSession()` for pages/actions, or `withApiSession(request, handler)` for APIs, which returns JSON 401 instead of redirecting. A protected layout alone does not protect actions or APIs. Filter every user-owned read/update/delete by the verified session's user ID; never trust a submitted owner ID. Keep secrets and database code server-only. Validate mutations server-side.

Authorize separately from authentication when a feature reaches past the caller's own rows. Declare the resource and actions in `src/lib/permissions.ts`, then guard with `withApiPermission(request, permissions, handler)` for APIs or `requirePermission(permissions)` for pages. Roles come from `user.role`, which signup cannot set; use `npm run role:set -- <email> <role>`. Name cross-account service functions with an `Any` suffix and call them only from a permission-guarded entrypoint. Hiding UI is never the access check. See the role section in `docs/backend.md`.

Use PostgreSQL pgTable/boolean/timestamp columns and asynchronous queries. DATABASE_URL is the runtime connection. MIGRATION_DATABASE_URL optionally provides a direct migration connection. Never substitute SQLite syntax or disable TLS verification. Tests require Docker and use unique disposable PostgreSQL servers.

Build application backend features with API routes calling services. Do not put domain queries in routes, pages, or components. Validate request bodies, IDs, and pagination before service calls. Require the configured Origin on cookie-authenticated mutations, including DELETE. Services contain SQL and domain logic; HTTP responses and cookie handling stay in the API layer. Reuse the Notes pattern documented in `docs/backend.md`.

Keep each Drizzle table in `src/db/schema/<table>.ts` and export it from `src/db/schema/index.ts`. Use direct sibling imports for foreign keys. For a schema change, edit the table file, run `npm run db:generate`, inspect the new SQL, then run `npm run db:migrate`. Commit SQL and `drizzle/meta` together. Do not rewrite applied migrations or run destructive resets to repair an error.

## Verify and hand off

Run `npm run check` and `npm run build` for substantive changes. For setup or Compose changes also run `npm run test:setup` to verify a fresh copy and data persistence. For auth/routing/session changes run `npm run test:e2e` after the build. Add tests for real behavior or data isolation when extending the app. Review the UI at narrow and wide widths when changing layout.

Report the result, how to use it, checks run, and any remaining limitation. Keep dashboard-specific, chatbot-specific, billing, and provider-specific features in derivatives unless the user asks to add them to this base. Do not deploy, purchase services, or choose an AI provider just because this is an AI-friendly starter.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

NgodingPakeAI (connect, sync, `<task>` blocks): read `.claude/skills/ngodingpakeai/SKILL.md`.
