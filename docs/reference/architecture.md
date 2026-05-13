# Architecture

A 30-minute orientation for someone digging in. Not exhaustive — pointer-rich.

## Overview

Harbour is a **single Next.js process** plus a **single SQLite file by default** (with optional Postgres for team deployments — see "Database backends" below). There is no Redis, no message queue, no separate worker pool. Recurring jobs become rows in `runs` with `status='scheduled'`; an agent (or workflow runner) polls an HTTP endpoint to claim work. State changes happen inside database transactions, so the run-claim path is atomic without external coordination.

Everything an installation needs lives under one directory — by default `~/.harbour/`:

| Path | Contents |
|---|---|
| `harbour.db` (+ `-wal`, `-shm`) | SQLite database (WAL mode) |
| `encryption.key` | 64-char hex key for env var AES-256-GCM |
| `uploads/runs/<runId>/` | Run attachment files |
| `runners.json` | Local runner config (agent → CLI tool mapping) |
| `sessions.json` | CLI session ID cache for run resume |
| `workflows/` | User-supplied scripts invoked by workflow jobs |
| `captain/` | Captain conversation workspace (default cwd) |
| `runner.log`, `runner.err.log` | macOS launchd output for the agent runner (Linux uses journald instead) |

Override roots via `HARBOUR_HOME`, `HARBOUR_DB_PATH`, `HARBOUR_UPLOADS_DIR`, `HARBOUR_ENCRYPTION_KEY`, `HARBOUR_MAX_UPLOAD_MB` (default 500). See `src/lib/paths.ts`.

## Tech stack

Versions pulled directly from `package.json` at v1.14.0:

| Layer | Choice | Version |
|---|---|---|
| Framework | Next.js (App Router) | 16.2.1 |
| UI runtime | React | 19.2.4 |
| Styling | Tailwind | ^4 (with `@tailwindcss/postcss`) |
| Components | shadcn/ui (built on `@base-ui/react`) | shadcn ^4.1.1 |
| DB driver | better-sqlite3 (default) | ^12.8.0 |
| DB driver | pg (Postgres, optional) | ^8.20.0 |
| Auth hashing | bcryptjs | ^3.0.3 |
| JWT/JOSE | jose | ^6.2.2 |
| Client state | TanStack Query | ^5.95.2 |
| Markdown | react-markdown + remark-gfm + marked | ^10.1.0 / ^4.0.1 / ^17.0.5 |
| Multipart upload | busboy | ^1.6.0 |
| Tests | Vitest | ^4.1.2 |
| Browser tests | @playwright/test | ^1.58.2 |
| Linting | ESLint 9 + eslint-config-next | ^9 / 16.2.1 |
| TypeScript | typescript | ^5 |

The repo ships a tiny CLI: `npm run harbour -- ...` resolves to `bin/harbour.mjs` (77 lines), which dispatches to the runner library under `bin/lib/`.

## Auth model

Three principals authenticate against the API:

1. **User session** — login at `/login`, sets the `harbour_session` cookie (HttpOnly, SameSite=Lax, 30 days). Sessions live in the `sessions` table. Created at `src/app/api/auth/login/route.ts`.
2. **Agent API key** — bearer token in `Authorization: Bearer <key>`. Stored bcrypt-hashed in `agents.api_key_hash`. Each agent has exactly one key; rotated via `POST /api/agents/:id/rotate-key`.
3. **Admin API key** — bearer token, but resolves to a **user identity** (the creator's `user_id`). Stored hashed in `admin_api_keys`. Lets an external operator agent act as a user.

Every route is wrapped in one of several HOFs from `src/lib/auth.ts`:

| Wrapper | Accepts | Notes |
|---|---|---|
| `withAuth(handler)` | user OR agent OR admin key | read-only or shared endpoints |
| `withUserAuth(handler)` | user OR admin key (not agent) | endpoints that need `auth.userId` |
| `withOperator(handler)` | user (admin OR operator) OR agent | mutations on agents/jobs/docs/databases/projects/teams/runs |
| `withAdmin(handler)` | user (admin only) OR agent | manage users / admin keys / global settings / env-var plaintexts |
| `withUserOperator`, `withUserAdmin` | same, but user-only (rejects agents) | for endpoints that also need `auth.userId` |

Inside a handler, two extra guards are used for finer-grained scope:

- **`requireAgentOwnership(auth, agentId)`** — when the auth principal is an agent, asserts it owns the resource. Returns 403 otherwise; users pass through. `src/lib/auth.ts`.
- **`requireRole(auth, roles[])`** — inline role check (sugar: `requireAdmin`, `requireOperatorOrAdmin`, `requireReadAccess`). Agent callers pass through (they have no role). Used inside the wrappers above or sparingly inline.

### User roles (RBAC)

Three coarse roles live on the `users.role` column (default `admin` for backwards compatibility):

- **admin** — full access; manage users, admin API keys, global settings, env-var plaintexts.
- **operator** — mutates agents/jobs/docs/databases/projects/teams/runs but not admin-only surfaces.
- **viewer** — read-only across the dashboard.

Permission matrix lives in `src/lib/auth.ts` as `PERMISSIONS` (server) and is consumed by the `useCurrentUser()` hook + `<RoleGate action="...">` component (client) for UI gating. The server-side wrappers are the enforcement; UI gating only hides controls. Admin API keys resolve to the **creator's** identity, including role.

There are **no** inline auth checks anywhere in `src/app/api/`; the wrappers are mandatory.

## Polling ladder

When a runner POSTs to `GET /api/agents/:id/next`, the server runs a priority ladder inside one transaction. The ladder is in `src/lib/db/runs.ts` (`getAgentNextRun`). Steps fall through if they don't match.

```
Step 0  Fail any 'running' runs that exceeded job.timeout_minutes (failStaleRuns)
Step 1  Agent already has a 'running' run? -> return null (busy)
Step 2  'pending' run for this agent? -> flip to 'running', return it
Step 3  'scheduled' run with scheduled_for <= now? -> claim, return it
Step 4  Recurring schedule-triggered job past next_run_at? -> create run, advance schedule
```

**Atomicity.** The whole sequence is a `db.transaction(() => ...)`.

**Workflow-only counterpart.** `getNextWorkflowRun()` in `src/lib/db/runs.ts` runs the same shape for agentless `workflow_only=1` jobs (no agent_id), exposed at `GET /api/workflows/next`.

## Run lifecycle

```
                                +-- failed (terminal)
                                |
                                +-- skipped (terminal; workflow exit 77)
                                |
                                +-- killed (terminal; SIGTERM, resumable via comment)
scheduled --> running ----------+
   ^             |              |
   |             +-- waiting -- pending --> running --> ...
   |                                ^
   +-- (never reached on terminal)  +-- comment from user on
                                        waiting/done/failed/killed
```

- **`scheduled`** — created by `triggerJobRun` (one-off) with a future `scheduled_for`, or by a job's recurring schedule.
- **`running`** — the runner has claimed it. Sets `claimed_at`. While in `running`, the job's other queued runs sit behind it.
- **`waiting`** — the agent paused, asked for human input.
- **`pending`** — a human responded (commented or retried). Step 2 of the polling ladder picks it up next.
- **`done` / `failed` / `skipped` / `killed`** — terminal. Sets `completed_at`. `done`/`failed`/`skipped` advance the job's `next_run_at`; `killed` does **not** (the user stopped it intentionally).

`PUT /api/runs/:id/status` (in `src/app/api/runs/[id]/status/route.ts`) validates the body against a fixed enum (`running`, `waiting`, `pending`, `done`, `failed`, `skipped`, `killed`); 400 for unknown values. The diagram above is enforced by callers, not a transition graph.

### Handoffs

An agent (or a dashboard user) can hand a run to **another agent** or to a **team** via `POST /api/runs/:id/handoff`. The handoff creates a new one-off job + scheduled run on the target side; the existing polling ladder claims it like any other run. `updateRunStatus` hooks the handoff record: `pending → accepted` when the target starts `running`, → `completed` when the target reaches `done`. The source run's `agent_name` and the job's `name` are snapshotted into the handoff so deleting the source run doesn't break visibility on the target. See [`src/lib/db/handoffs.ts`](../../src/lib/db/handoffs.ts) and the wire contract in [GUIDE.md](../../GUIDE.md#handoffs).

### The kill flow

The dashboard's **Kill** button writes `runs.kill_requested_at = unixepoch()`. The runner notices this **two ways**:

1. **Piggyback** — the runner POSTs streaming output to `/api/runs/:id/output` every ~750ms while the CLI is talking. Each response includes `kill_requested: <bool>`. When true, the runner aborts the child process. Latency: ≤ one flush cycle.
2. **Fallback poll** — if the CLI is silent (long thinking stretch, no output), the runner GETs `/api/runs/:id/kill` every 10s as a safety net.

The handlers live at `src/app/api/runs/[id]/output/route.ts` (piggyback) and `src/app/api/runs/[id]/kill/route.ts` (poll). The runner code is in `bin/lib/runner.mjs`. After SIGTERM, the runner saves the CLI session ID to `sessions.json` so a comment on the killed run can resume it from where it left off.

## Runner architecture

The runner is a **separate Node CLI** invoked by a system scheduler on a configurable interval (default 60 seconds; 5..3600). It is not run by the Next.js process. Install picks the right scheduler per OS:

- **macOS** — launchd plist at `~/Library/LaunchAgents/com.harbour.agent-runner.plist` with `StartInterval=<N>`. Logs to `~/.harbour/runner.log` / `runner.err.log`.
- **Linux** — user-level systemd `.service` + `.timer` at `~/.config/systemd/user/` (`OnUnitActiveSec=<N>s`, `Persistent=true`). Logs to journald: `journalctl --user -u harbour-agent-runner.service -f`. Headless servers need `loginctl enable-linger $USER`.

The interval is per-host, stored at `~/.harbour/runner-config.json`. Configure via `npm run harbour -- agent interval <N>` (CLI) or the dashboard's Settings page. Changes take effect on the next `agent install`. Eager polling (per-agent) is independent — it kicks in after a clean run finishes and drains the queue without waiting for the next scheduler tick.

```
scheduler (launchd StartInterval=60  /  systemd OnUnitActiveSec=60s)
    |
    +--> node bin/harbour.mjs agent run
              |
              +--> bin/lib/runner.mjs : runAgents()
                      for each runner in ~/.harbour/runners.json:
                        loop (eager agents) or once:
                          GET /api/agents/:id/next      --> spawn CLI
                      if any runner.url is local:
                        GET /api/workflows/next         --> spawn shell
```

Per-runner the inner step is single-shot by default. Agents flagged `eager` (column on `agents`, surfaced as `agent.eager` on the `/next` payload) keep polling and processing as long as the queue returns clean outcomes (`done`/`waiting`/`skipped`). A failed or killed run, an empty `/next`, or the 50-iteration safety cap exits the loop. Logic lives in `runSingleAgent` and `shouldContinueEagerLoop` (`bin/lib/runner.mjs`).

Key files:

| File | Role |
|---|---|
| `bin/harbour.mjs` | CLI dispatcher: `start | dev | agent {list,run,connect,install,uninstall,status}` |
| `bin/lib/runner.mjs` | Polling loop, prompt assembly, kill plumbing, session save (809 lines) |
| `bin/lib/providers.mjs` | Per-CLI provider (claude / codex / gemini / shell) — command building, JSONL parsing, kill-grace SIGTERM/SIGKILL. Provider contract documented in the file header. |
| `bin/lib/safe-settings.mjs` | Default safe-mode `.claude/settings.json` template + validator. Shared by the runner (materialize on first run, validate before launch) and mirrored server-side in `src/lib/claude-settings.ts` for the security panel. |
| `bin/lib/safe-shims.mjs` | Harbour-level soft-sandbox shim wrappers for non-Claude shell CLIs (rm/sudo/chmod/chown/ssh/scp + Authorization-blocking curl). Idempotent install + `safeModePath()` PATH builder. |
| `bin/lib/api-agent.mjs` | API-agent runtime (function-calling loop against OpenAI-compatible chat/completions endpoints). Tool dispatcher maps function calls to Harbour HTTP endpoints; tool spec filtered by per-agent permissions. |
| `bin/lib/install.mjs` | macOS launchd + Linux systemd install/uninstall/status |
| `bin/lib/connect.mjs` | Decode the `harbour agent connect <blob>` and write a runner config |
| `bin/lib/config.mjs` | Read/write `~/.harbour/runners.json` and `~/.harbour/sessions.json` |

The runner streams CLI output to the server in batches (750 ms flush). All three providers emit normalized event types: `text_delta`, `tool_start`, `tool_end`, `thinking`, `info`, `error`, `result`. Frontend consumes these via SSE at `/api/runs/:id/output/stream`.

Permission modes (`safe` / `custom` / `unrestricted`) are an agent-level column read live from the `/next` payload. For Claude in safe/custom mode the runner refuses to launch when `.claude/settings.json` is missing or invalid — no silent fallback to `--dangerously-skip-permissions`. For safe-mode Claude agents the runner materializes the bundled default `settings.json` on first run if absent (idempotent). The validator + default template live in `bin/lib/safe-settings.mjs`; the server-side mirror in `src/lib/claude-settings.ts` drives the **Settings → Security** panel.

For non-Claude shell-capable providers (Codex, Gemini, Custom Shell), safe mode installs shim wrappers at `~/.harbour/safe-shims/` for `rm`, `sudo`, `chmod`, `chown`, `ssh`, `scp`, and a `curl` shim that blocks `Authorization` headers. The runner prepends `<workspace>/bin/:~/.harbour/safe-shims/:` to PATH before spawning the CLI (see `bin/lib/safe-shims.mjs`). This is a **soft sandbox** — bypassable by absolute paths or by shelling through a non-shimmed binary. Documented honestly in the UI and docs; for real isolation, run the runner inside a container or `sandbox-exec`/`firejail`.

API agents (`cli="api"`) skip subprocess execution entirely. The runner branches into `bin/lib/api-agent.mjs::runApiAgent`, which drives a function-calling chat-completions loop against the configured OpenAI-compatible endpoint. The model never gets shell access; every "tool" is a Harbour HTTP endpoint, gated by the agent's `can_*` permission columns. The runtime emits the same `text_delta` / `tool_start` / `tool_end` events as CLI providers so the dashboard renders API runs identically.

Tool permissions are enforced server-side via `requireTool(auth, "<name>")` in `src/lib/tool-permissions.ts`, wired into every agent-callable mutation route (`activity`, `status`, `handoff`, `docs`, `databases`, `runs` create). The `/next` payload's `api.endpoints` block is filtered to only the endpoints an agent may use, so external agents see a coherent contract.

Workflow-only jobs are handled in the same poll cycle (`runAgentlessWorkflows`); only the runner whose `url` resolves to `localhost`/`127.0.0.1`/`::1`/`0.0.0.0` picks those up — see `isLocalUrl` and `runAgents` in `bin/lib/runner.mjs` (around lines 775-808). Remote runners deliberately skip the agentless workflow queue because the workflow scripts live on the harbour host.

**Remote-runner payload compatibility.** A remote runner polling an older harbour server may receive a `/next` payload missing the `agent.tool_permissions` and `agent.permission_mode` fields. The runner treats both as "no restrictions" / "unrestricted" — `bin/lib/api-agent.mjs::filteredTools` and the tool-call gate fall through when `toolPermissions` is null, and the runner's permission-mode branch defaults to `unrestricted` when the field is absent. This preserves pre-feature behavior for older servers and keeps remote-runner deploys forward-compatible with future field additions.

## Frontend layout

The App Router has two route groups:

- **`src/app/(auth)/`** — `login/`, `signup/`. Public routes; no shell.
- **`src/app/(app)/`** — everything inside the dashboard. Wrapped in `AppShell`.
  - `agents/`, `captain/`, `databases/`, `docs/`, `env-vars/`, `jobs/`, `runs/`, `settings/`, `users/`
  - `page.tsx` — root dashboard (today's runs)
  - `layout.tsx` — `<AppShell>` wrapper

`AppShell` (`src/components/app/app-shell.tsx`) handles auth check (calls `/api/auth/me`, redirects to `/login` on 401), project state (localStorage `harbour_active_project`), sidebar/mobile navigation, the theme toggle, and a 5s waiting-runs poll for the sidebar badge. The document-level theme class is bootstrapped in `src/app/layout.tsx` from the same `harbour_theme` localStorage key. Descendants read `{ user, waitingCount, timezone, projects, activeProjectId, setActiveProjectId }` via `useApp()`.

### React Query refetch policies

The `QueryClient` defaults at `src/components/providers/query-provider.tsx`:

```
staleTime: 2000
refetchOnWindowFocus: true
```

Per-query overrides are common throughout the app:

| Surface | `refetchInterval` | Notes |
|---|---|---|
| Sidebar projects (`AppShell`) | 10 s | `app-shell.tsx` |
| Most list pages (runs, jobs, agents, docs) | 5 s | quick feedback during runs |
| Lookup queries (e.g. CLI tools, doc list in dialogs) | none, `staleTime: 60_000` | rarely change |

Detail pages (run, agent, doc, database row table) typically poll at 5 s; SSE streams (run output, captain output) replace the poll once an agent is actually streaming.

## File layout

```
src/
  app/
    (auth)/             user-facing login/signup
    (app)/              dashboard pages (one folder per nav item)
    api/                67 route.ts files (100 HTTP method handlers)
    layout.tsx          root layout, theme bootstrap
  components/
    app/                AppShell, dialogs, run-status
    ui/                 shadcn primitives (button, dialog, etc.)
    providers/          QueryProvider
  lib/
    db/                 schema + per-table query modules
    captain/            spawn/stop a CLI subprocess for in-browser chat
    auth.ts             withAuth, withUserAuth, requireAgentOwnership
    encryption.ts       AES-256-GCM for env vars
    schedule.ts         schedule parsing + tz-aware next_run_at math
    paths.ts            HARBOUR_HOME-rooted file paths
    runners.ts          runners.json read/write
    cli-config.ts       per-CLI model and thinking options
    upload.ts           busboy multipart receive
    video-processing.ts ffmpeg + whisper screenshots/transcripts
    request-url.ts      reverse-proxy-aware base URL resolution
bin/
  harbour.mjs           CLI entry
  lib/                  runner, providers, install, config, connect (5 files, ~1573 lines)
docs/
  concepts/             mental-model writeups
  guides/               step-by-step setup
  reference/            this folder (architecture, schema, API)
GUIDE.md                served at GET /api/guide; agent wire contract
ADMIN_GUIDE.md          served at GET /api/admin-guide; admin-key wire contract
CHANGELOG.md            release history
terraform/              DigitalOcean droplet config
```

## Source-of-truth pointers

A new contributor should read these in order:

1. `src/lib/db/schema.ts` — every table, every migration. The file evolves; all schema lives here.
2. `src/lib/auth.ts` — auth model.
3. `src/lib/db/runs.ts` — the polling ladder, the kill request flow, and run lifecycle in one file.
4. `src/lib/db/jobs.ts` — schedule advance, job creation transactions.
5. `src/app/api/agents/[id]/next/route.ts` — the server side of agent polling, including the `api` section that travels with each payload.
6. `bin/lib/runner.mjs` — the client side of polling, prompt assembly, and the kill flow.
7. `bin/lib/providers.mjs` — Claude/Codex/Gemini/Custom-Shell command building and stream parsing. The contract block at the top of the file documents what each provider must export.
8. `src/components/app/app-shell.tsx` — frontend chrome and project filtering.
9. `GUIDE.md` and `ADMIN_GUIDE.md` — wire contracts; live-served on `/api/guide` and `/api/admin-guide`.
10. `src/lib/schedule.ts` — interval / weekly schedule parsing and timezone math.

## Database backends

Harbour supports two database backends, selected at process start by `DATABASE_URL`:

- **SQLite** (default) — `DATABASE_URL` unset or empty. Opens `~/.harbour/harbour.db` via `better-sqlite3` in WAL mode with `foreign_keys=ON`. Run claiming is atomic via SQLite's exclusive-write transaction lock.
- **Postgres** (optional) — `DATABASE_URL=postgres://...` or `postgresql://...`. Opens a `pg.Pool`; schema is initialized via `src/lib/db/schema-postgres.ts` (greenfield — there are no historical migrations because PG support is new). Run claiming uses `FOR UPDATE SKIP LOCKED` for finer-grained row-level locking.

Both backends share the same TypeScript surface through `DbAdapter` (`src/lib/db/adapter.ts`). The adapter exposes async `run`/`get`/`all`/`exec`/`transaction` methods; placeholder rewriting (`?` → `$1, $2, …`) and `unixepoch()` → `(extract(epoch from now())::bigint)` translation happen inside `adapter-postgres.ts`, so call sites can author SQL in the SQLite dialect.

Two access patterns coexist:

- `getDb(): Database.Database` — legacy sync handle. Throws fast if `DATABASE_URL` is a Postgres URL, with a clear message. Used by non-request code paths (the harbour CLI, the captain subprocess runner) and by the existing test suite.
- `getDbAsync(): Promise<DbAdapter>` — cross-backend async handle. **Every API route handler under `src/app/api/` uses this path.** New code should also use this.

Every DB module ships matching sync + async exports (e.g. `createAgent` + `createAgentAsync`). The async variants run identically against SQLite and Postgres, dispatched at adapter level. End-to-end coverage lives in `src/__tests__/postgres-flow.test.ts` (low-level helpers) and `src/__tests__/postgres-routes.test.ts` (CRUD round-trips for every migrated module). pg-mem caveats — primarily `FOR UPDATE SKIP LOCKED` (used by the run-claim path) and certain COUNT-subquery patterns in list queries — are documented in those test files; both run cleanly on real Postgres.
