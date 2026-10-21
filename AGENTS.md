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
- `src/lib/dashboard/handled-registry.ts`, `alert-actions.ts`, `src/components/dashboard/handle-alert-dialog.tsx`: "Tandai ditangani" (operator closes an active alert, it moves to the history). Mock server in `localStorage` key `alertHandled`; real API is `POST /api/v1/alerts/{id}/handle` (`backend/README.md`). Buttons use `aria-disabled`, never `disabled`. Details and tests in `docs/noc/dashboard-alerts.md`.
- `src/lib/dashboard/alert-badge.ts`, `src/components/dashboard/alert-count-badge.tsx`, `app-nav.tsx`: active alert count on the "Alert" menu item. The link's accessible name must stay exactly "Alert" (the pill is `aria-hidden`, the sentence is a sibling `role="status"`). Details in `docs/noc/dashboard-alerts.md`.
- `src/app/(protected)/app/billing`, `src/lib/dashboard/billing.ts`, `billing-filter.ts`, `use-refresh-at.ts`, `src/components/dashboard/billing-*.tsx`: the Status Billing page (`/app/billing`), mock data for now (`<MockDataNotice source="sistem billing" />`). `matchBilling` is the one statement of the PPPoE matching rule the Go sync must follow; a failed sync never hides data; statuses move through the Zustand store (`billingChanges`); the Lunas/Isolir badge is one component (`BillingStatusBadge`). The "Sinkron Tagihan" button in the Pelanggan table is old placeholder code, not connected. E2E runs against the production build: run `npm run build` first. Read `docs/noc/billing-page.md` before changing it.
- `src/lib/dashboard/thresholds.ts`, `threshold-registry.ts`, `src/components/dashboard/threshold-settings.tsx`, tab "Ambang Batas" of `settings-board.tsx` (`/app/pengaturan`): alert threshold settings, mock for now. Defaults are READ from `anomalyRules`, never repeated. HONESTY: the saved numbers are NOT read by the Go rule engine and do NOT change `anomalyRules`, mock alerts or the Anomali page. Stored in `localStorage` key `alertThresholds`; the other settings tabs still keep secrets (Telegram token, WhatsApp numbers) in plain `localStorage`, which is not a place for secrets. E2E runs against the production build: run `npm run build` first. Read `docs/noc/thresholds.md` before changing it.
- `src/lib/dashboard/audit.ts`, `src/components/dashboard/audit-board.tsx`, `src/app/(protected)/app/jejak-aktivitas/page.tsx`, `audit-filter.ts`: the activity log page, mock data for now (`<MockDataNotice source="log audit di backend" />`). `audit.ts` holds the contract of the future `GET /api/v1/audit`. SECRETS NEVER ENTER THE LOG: a secret field may only be `redacted(field)`, `changed()` and `buildAuditEntry` refuse secret-looking names and values, and the backend must apply the same rules before writing to `audit_log`. Keep `matches`, `filterAudit` and `auditFacetCounts` on ONE checker (`matchesWith`). Read `docs/noc/audit-log.md` before changing it.

- `src/db/schema/api-keys.ts`, `src/services/api-keys.service.ts`, `src/services/external-data.service.ts`, `src/app/api/api-keys/`, `src/app/api/v1/data/`, `src/app/(protected)/app/api-key/`: API keys for external apps. `withApiSession` accepts `Authorization: Bearer noc_...` and acts as the key's owner; `read` keys refuse non-GET; keys never manage keys. `GET /api/v1/data` pages through an explicit allowlist of tables with secret columns dropped; a new table is NOT exported until added there. Read `docs/noc/api-key.md` before changing it.

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

<!-- ngodingpakeai:skill:start -->
# NgodingPakeAI — Codebase Sync

NgodingPakeAI is the **project-memory and codebase-context layer** for AI coding agents.
It does NOT replace you — it gives you organized project memory and safe codebase
context through its CLI. When the user asks to **connect, index, or sync** this
repository with NgodingPakeAI, follow this skill.

> The CLI is the security gate. It decides what may leave the machine. You operate
> it; you never upload files yourself or call the HTTP API directly.

## Prerequisites
- Node.js available (the CLI runs via `npx ngodingpakeai …`).
- Workspace ID: `694a3de9-0d29-4dc5-8fbe-a5d7423ac5dd`
- An access token starting with `ngpk_`. Provide it via the `NGODINGPAKEAI_TOKEN`
  environment variable (preferred) or the `--token` flag on `connect`.
  Create one at https://www.ngodingpakeai.com/settings (API keys). Synced content is viewable at https://www.ngodingpakeai.com/workspace/694a3de9-0d29-4dc5-8fbe-a5d7423ac5dd.

## How sync works (one mode — YOU write the summaries)
NgodingPakeAI never uploads or stores raw source code. Instead **you**, the
agent, write short natural-language summaries of the code — locally, where you
already have file access — and the CLI uploads only file metadata + those
summaries. The server embeds them for semantic search and codebase chat, then
rolls them up into canonical repository/app/package docs. Every generated doc
keeps the exact contributing file paths and commit as source metadata.

## Existing codebase? The summary sync builds the pending plan for you
There are two safe entry points for an existing codebase:
- When this skill was installed from a Wiki/workspace page, the **Workspace ID
  above is the exact target**. Connect this repo to that workspace and do not
  choose a default workspace, create a new one, or follow another workspace
  link.
- When onboarding starts without a workspace target, the web app prepares an
  empty workspace with one **pending baseline plan** before the agent connects.

After the final summary sync, the
server reads the docs it just built and works BACKWARDS to produce the planning
documents — a PRD, then fitur and sub-fitur — describing the app **as it already
is**. Those fitur are created with status `done` and **no tasks**, because the
code for them already exists.

This means a user with an existing project does NOT have to write a PRD by hand.
They connect, sync once, and the workspace is populated.

## Project started from a template (`ngodingpakeai create`)
When the user began from a template in the web app, the copied prompt ran
`npx ngodingpakeai create --token …`. That command already downloaded the
source, made the first git commit, wrote `.ngodingpakeai/config.json`, and
installed this skill. In that case:
- **Skip `connect`.** The workspace, plan, and repo exist on the server and are
  bound by the config file. Never create another workspace for this folder.
- **Run the project's own setup first.** Templates ship their setup instructions
  (`AGENTS.md` "first prompt" section and/or `.agents/skills/*/SKILL.md`, e.g.
  `starter-setup`). Follow them to install dependencies, prepare the local
  database, and start the dev server — before working any task. Explain each
  step in plain language; the user may never have run a project before.
- The forked plan already describes what the template contains (fitur marked
  `done`). New work comes from the plan's planned fitur via `task next`.
- Commit after each completed task so the user always has a known-good state
  to return to. If something breaks, run `npm run doctor` (or the template's
  equivalent) and the dev-server logs before changing code.

## Reverse state transitions
The server owns the reverse state. Advance it by completing the CLI sync flow;
never edit the database, call the HTTP API directly, or invent a separate state
command. The expected transitions are:

- `waiting`: the prepared plan is waiting for the repository connection or first metadata pass.
- `syncing`: the CLI has started a sync run; wait for `sync` to complete.
- `awaiting_summaries`: `sync --plan` completed, but the agent still needs to write the requested summaries.
- `building_wiki`: the final `sync` uploaded summaries successfully and the server is rebuilding repository documentation.
- `running`: the wiki is ready and the server is generating the reverse PRD and feature inventory.
- `done`: the reverse plan is populated; its features describe existing code and have no implementation tasks.
- `error`: the server could not build the reverse plan; show the printed workspace/plan link and ask the user to retry from the web UI.

For a prepared reverse plan, `sync --plan` moves the flow toward
`awaiting_summaries`; writing `summaries.json` and running the final
`sync` moves it toward `building_wiki`. The server then advances the state
to `running` and `done` asynchronously. Run `status` after sync to confirm
the upload and report the exact link printed by the CLI, but do not poll or
manually mutate reverse state from the agent.

What you must do about it:
- The pending plan row exists before sync starts, but its CONTENTS take ~1–6
  minutes (the server is writing the PRD and reading out the fitur). The CLI
  prints the workspace link — **give that link to the user** and tell them the
  plan is still being assembled. Do not wait/poll for it, and do not re-run sync
  to "make it finish".
- This reverse bootstrap happens ONLY for the prepared pending plan in its
  reserved workspace. If the skill above contains a real Workspace ID from an
  existing Wiki page, keep the sync in that exact workspace; do not redirect it
  to the reserved/default workspace.
- Never try to build the PRD or fitur yourself through the CLI. The server does
  it from the summaries you already wrote.

## Instructions — the sync loop
1. `npx ngodingpakeai doctor` — check environment + connectivity.
2. `npx ngodingpakeai connect --workspace 694a3de9-0d29-4dc5-8fbe-a5d7423ac5dd --token "$NGODINGPAKEAI_TOKEN"` — link this repo to the workspace (first time only).
3. `npx ngodingpakeai sync --plan` — detects repository apps/packages, scans + uploads file METADATA (paths/hashes only), then writes `.ngodingpakeai/pending.json`: the list of new/changed files that need summaries (already curated — lockfiles/fixtures/barrels are excluded, so no wasted effort).
4. **Write the summaries.** Read each file in `pending.json` and produce `.ngodingpakeai/summaries.json` (format below). Only files in the pending list — unchanged files keep their existing summaries.
5. `npx ngodingpakeai sync` — validates and uploads summaries only. It FAILS with a list if any pending file is missing a summary (fix and re-run; `--allow-missing` skips them only if the user says so). **This final summary pass CLOSES the cycle** — run it only when every task is done (see hard rule 6). The earlier `sync --plan` metadata pass never closes a cycle.
6. `npx ngodingpakeai status` — confirm; then report to the user: files indexed/summarized, warnings, and the exact plan link printed by the CLI. Its canonical shape is `/workspace/<workspaceId>?plan=<planId>`. Do not guess either id.

## summaries.json format
A FLAT JSON object keyed by file path — no wrapper, no `version`, no `files` array:
```json
{
  "src/server/services/plan.service.ts": {
    "summary": "Service layer untuk plan/PRD: CRUD, chat persistence, kompaksi riwayat.",
    "sections": [
      { "symbol": "planService.createPlan", "startLine": 1, "endLine": 120,
        "summary": "Membuat plan baru dari jawaban onboarding; alokasi slug unik." }
    ]
  }
}
```
Field names are exact: `summary`, `sections[]`, and inside a section `symbol` (NOT `symbolName`), `startLine`, `endLine`, `summary`. `sections` is optional.

Rules for good summaries:
- **Bahasa Indonesia**, 1–3 kalimat per summary. Sebut nama simbol, route, dan tabel yang relevan — itu yang membuat pencarian akurat.
- Every summary (file-level AND section-level) must be **10–2000 characters**; the CLI rejects anything outside that before uploading.
- Jelaskan peran file dalam app/package-nya serta interface yang dibentuk (route, API, event, export, worker) bila ada. Ringkasan ini menjadi bukti untuk dokumen kanonis, bukan dokumentasi per-folder.
- `sections`: bagi file per fungsi/kelompok logis dengan rentang baris nyata. File kecil boleh tanpa `sections` sama sekali.
- Do NOT put file hashes anywhere. The CLI computes them itself while scanning — they appear in neither `pending.json` nor `summaries.json`. If you edit a file after summarizing it, just run `sync --plan` again.
- **NEVER paste code, credentials, connection strings, or API keys into a summary.** Describe behavior, don't quote source.

`pending.json` (written by `sync --plan`) is `{ repo, generatedForCommit, files: [{ path, reason, language, size }] }` — `reason` is `new` | `changed` | `needs_summary`. Summarize exactly the paths it lists.

## Hard rules — do not violate
1. Use the CLI for everything. Do not upload files yourself or call the HTTP API directly.
2. Raw source code must never leave the machine — the CLI only uploads metadata + your summaries, and the server rejects/strips anything else.
3. Never put secrets in summaries. Never read or print `.env*` files.
4. Respect `.gitignore` and `.ngodingpakeaiignore`. If the CLI blocks a file, do not bypass it.
5. Always report the sync summary and https://www.ngodingpakeai.com/workspace/694a3de9-0d29-4dc5-8fbe-a5d7423ac5dd. Only pass on links the CLI actually printed — never assemble one from an id yourself.
6. **For active implementation plans, run the final `sync` ONLY when every task is done — never mid-cycle.** The final summaries pass closes the cycle, rebuilds the wiki, and records a wiki version. `sync --plan` is metadata discovery only and is safe. A prepared reverse baseline plan has no tasks, so its first summary sync is the entry point.
7. **Workspace targeting is fixed.** Use the exact Workspace ID embedded above and the repo's `.ngodingpakeai/config.json`. Never infer a workspace from a plan, account default, URL, or another agent session. If the server reports a workspace conflict or the target looks wrong, STOP and ask the user; never retry with another workspace ID.

## Command reference
| Command | Purpose |
| --- | --- |
| `npx ngodingpakeai doctor` | Verify environment, token, and connectivity. |
| `npx ngodingpakeai connect --workspace <id> --token <ngpk_…>` | Link the repo to a workspace. |
| `npx ngodingpakeai status` | Show connection + last sync state. |
| `npx ngodingpakeai sync --plan` | Upload metadata + write `pending.json` (files needing summaries). |
| `npx ngodingpakeai sync` | Validate + upload `summaries.json`. Fails if pending summaries are missing. |
| `npx ngodingpakeai sync --if-changed` | Skip instantly when HEAD commit is already synced (cheap for loops/CI). |
| `npx ngodingpakeai index` | Local scan preview only (no upload). |
| `npx ngodingpakeai plan get <planId>` | Print a plan's PRD (project context) before working its tasks. |
| `npx ngodingpakeai task next --plan <planId>` | Serve the SINGLE next task to work (full prompt inline), page-ordered & frontend-first. The main loop; `--json` to script. |
| `npx ngodingpakeai task get <ref>` | Fetch a task's title + plan/feature context (no per-task prompt or description; combine with the PRD + your code reading). |
| `npx ngodingpakeai task start <ref>` | Mark a task in-progress (status: doing). |
| `npx ngodingpakeai task complete <ref>` | Mark a task done. |
| `npx ngodingpakeai task fail <ref> "<reason>"` | Report a task stuck/failed with a reason. |
| `npx ngodingpakeai task reset <ref> "<reason>"` | Put a task back to `todo`; a `done` task asks for confirmation. **Only when the user asks.** |
| `npx ngodingpakeai disconnect` | Unlink the repo. |

> `<ref>` is a task reference: either the readable path `<plan>/<feature>/<task>`
> (e.g. `tokoku/autentikasi/buat-form-login`, as shown by `task next`) or the
> task's UUID. Both resolve to the same task — prefer the readable path.

## What the workspace can do after sync
- **A plan built from the code** (first sync of an empty workspace): PRD + fitur + sub-fitur describing what already exists, so the user can plan the NEXT change against it instead of starting from a blank page.
- **Codebase chat**: the user asks questions about their codebase in the web app; answers cite `path:line` from your summaries.
- **Canonical docs**: one repository overview, one overview per meaningful app/package, plus one interface/user-flow document for each app when applicable. They are rebuilt from summaries, with source paths + commit stored as metadata.
- Semantic + symbol search over the whole index; feature → file mapping.
- "Continue project" guidance based on what's already implemented.

## Working on tasks (assigned via a `<task>` block)
When the user hands you a task — usually by pasting a block like:

```
Work on NgodingPakeAI task:

<task identifier="manajemen-konten/transaksi/buat-tabel-transaksi-migrasi">
<title>Buat tabel transaksi & migrasi</title>
<feature>Manajemen Konten</feature>
</task>
```

Use the `identifier` as the `<ref>` below (readable path; the task's UUID also
works). Drive it through the CLI — do NOT guess the work from the title alone:

1. `npx ngodingpakeai task get <ref>` — read the task's `title` + its feature/plan
   context. Figure out the work from the `title`, the PRD (`plan get`), and your
   own reading of the codebase (there's no per-task prompt or description).
2. `npx ngodingpakeai task start <ref>` — mark it in-progress before you begin.
3. Do the work. First explore the existing code & conventions, then follow them.
   Stay within the task's scope — don't invent files/libraries outside the stack.
4. When done: `npx ngodingpakeai task complete <ref>`.

### If you get stuck (don't go silent)
If you can't finish — blocked, missing info, repeated failure — REPORT it instead
of stalling:

```
npx ngodingpakeai task fail <ref> "alasan singkat: apa yang nge-block & sudah coba apa"
```

This flips the task to `failed` and records your reason so the human can unblock
it. Reporting a clear blocker is success, not failure.

### Putting a task back to `todo` (reset) — only when the USER asks
A task can be sent back to `todo` so it can be picked up fresh later:

```
npx ngodingpakeai task reset <ref> "alasan singkat kenapa dibalikin"
```

This clears the "already pulled" mark and appends your reason to the task's log —
the earlier log lines stay, so the history of what was tried is preserved.

**Never reset a task on your own initiative.** Do it ONLY when the user explicitly
asks (e.g. "balikin task ini ke todo", "reset task itu", "batalin yang lagi
dikerjain"). Do not reset to escape a task you find hard — if you're blocked, use
`task fail` and explain. Resetting a `done` task reopens finished work, so the CLI
will show the task and require explicit user confirmation. Never answer that prompt
on the user's behalf or add `--yes` unless the user has explicitly confirmed the
completed-task reset.

### Working through tasks — ONE task at a time via `task next` (the main loop)
Never use `task list`; it is retired and does not return tasks. If the plan ID
is missing, ask the user for the target plan before fetching any tasks.
Do NOT pull the whole backlog and grind through it in one context — that's what makes
output degrade. Instead let the server hand you ONE task at a time and give each its own
clean focus. The backlog is ordered into **phases** (build order) and, within each phase,
**layers** (`frontend` first, then `backend`), then by page (feature) and position. `task
next` walks that order for you: it returns the SINGLE next task — the FIRST page's frontend
tasks first, backend later.

When the user says "kerjakan task" (or hands you a feature/plan instead of a single
`<task>` block), read the PRD once, then loop:

```
npx ngodingpakeai plan get <planId>                    # PRD: project goal, features, tech stack (once)
npx ngodingpakeai task next --plan <planId> --json     # THE single next task
```

The `task next` JSON is `{ done, task, progress }`:
- `done: true` → no task left. **STOP and report to the user.** You're finished.
- `task` → `{ ref, title, ... }` — work from the `title`, backed by the PRD and your own
  reading of the codebase. There is no per-task `prompt` or `description` field; don't wait
  for one.
- `progress` → `{ page, phase: { current, total }, layer, remainingInPage, remainingInLayer }`
  — mostly context, BUT track `layer` and `phase.current`: a change marks a **checkpoint**
  where you stop for the user to verify (see below).

**Checkpoints — stop at each layer/phase boundary.** Remember the `layer` and
`phase.current` of the task you just finished. When `task next` returns a task whose
`layer` differs (e.g. frontend→backend) OR whose `phase.current` is higher, do NOT
`task start` it. STOP, report what's done (e.g. "✅ Frontend phase 1 done — click through
it in the browser"), and WAIT for the user to say "lanjut"/"continue". Then resume
`task next` and keep going to the next boundary. The FIRST task of a session (no previous
task) is NOT a checkpoint — just start it.

For each served task:
1. Read the PRD FIRST (once, at the start) — it's the project's intent.
2. **Checkpoint gate:** if this task's `layer`/`phase.current` crossed a boundary vs the
   last one you finished, STOP and wait for the user (above) instead of starting.
3. `task start <ref>` — mark it in-progress.
4. Do ONLY this task, to completion: explore the existing code & conventions first, then
   follow them. Do NOT read or start any other task while this one is open.
5. `task complete <ref>` (or `task fail <ref> "alasan"` if blocked).
6. Call `task next` again for the next one. Repeat until `done: true` (pausing at each
   layer/phase boundary for the user to verify).

**One task per loop = clean context = sharper output.** Trust the order — never batch
several tasks into one context to "save round-trips"; that defeats the whole point.

**Frontend-first:** `task next` serves `frontend` tasks before `backend`. A frontend task
builds the UI on mock/stub data, ASSUMING the API contract; backend tasks come later and
implement that contract. During a frontend task don't wait on backend — stub it. (If you
ever pull a task by ref directly, `task get` on a locked future phase or the other layer
returns **423 Locked** — that work isn't available yet; keep following `task next`.)

---
_Generated by NgodingPakeAI for AI coding agents. Source of truth: https://www.ngodingpakeai.com._
<!-- ngodingpakeai:skill:end -->
