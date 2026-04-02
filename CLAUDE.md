@README.md

Harbour is a control plane for AI agents doing ongoing work. See README.md for full architecture, API surface, and design rationale.

## Tech

Next.js (App Router), SQLite (better-sqlite3), Tailwind / shadcn/ui, TypeScript.

## Key paths

- `src/app/(app)/` — dashboard pages (runs, jobs, agents, docs, databases, env-vars, settings)
- `src/app/api/` — API routes (agent-facing + dashboard), all use `withAuth`/`withUserAuth` wrappers
- `src/lib/db/projects.ts` — project CRUD + linking/unlinking (auto-links job dependencies)
- `src/components/app/project-switcher.tsx` — sidebar/mobile project dropdown with create dialog
- `src/components/app/project-link-dialog.tsx` — "Add Existing" dialog for linking items to projects
- `src/lib/hooks/use-project-filter.ts` — hook for passing active project to API queries
- `src/lib/auth.ts` — `withAuth`, `withUserAuth`, `requireAgentOwnership` HOF wrappers for API routes (admin API keys resolve to creating user's identity)
- `src/lib/db/admin-api-keys.ts` — admin API key CRUD + authentication
- `ADMIN_GUIDE.md` — admin agent onboarding guide, served at `/api/admin-guide`
- `src/lib/db/` — database schema, queries, migrations
- `src/lib/encryption.ts` — AES-256-GCM encryption for env vars
- `src/lib/schedule.ts` — schedule parsing and timezone-aware next-run-time calculation
- `src/lib/cli-config.ts` — shared CLI tool config (models, thinking options per tool)
- `src/lib/runners.ts` — harbour agent runner config (read/write ~/.harbour/runners.json)
- `src/components/app/create-dialog.tsx` — unified New Run / New Job dialog (shared component)
- `src/components/app/model-thinking-select.tsx` — shared Model/Thinking select for CLI agents
- `bin/` — CLI entry point and agent runner (harbour agents, providers, launchd install)
- `GUIDE.md` — agent-facing API contract, served at `/api/guide`

## Conventions

- Jobs are static configuration (what to do, when, which docs/databases/env vars). Runs are the dynamic unit of work.
- Docs and env vars are top-level, linked to jobs. Injected into runs automatically via `/next`.
- Pinned docs and env vars are auto-attached to all new jobs and one-off runs.
- Agents poll for work via `/api/agents/:id/next`. Harbour never calls out to agents.
- Run statuses: `scheduled` → `running` → `waiting` (needs human) → `pending` (human responded, awaiting agent pickup) → `done`/`failed`/`skipped`.
- Failed/skipped runs can be retried (go back to `pending`).
- The database is a single SQLite file (default `./harbour.db`).
- Env vars are encrypted with AES-256-GCM. Key at `~/.harbour/encryption.key` (auto-generated on first run).
- System timezone (configured in Settings) is used for all schedule calculations.
- Model and thinking/effort can be set per agent (default) and overridden per job.
- API routes use `withAuth(handler)` or `withUserAuth(handler)` — never inline auth checks. Agent-facing mutation routes use `requireAgentOwnership()` to enforce scope.
- Job and run creation functions (`createJob`, `createOneOffRun`, `getAgentNextRun`) are wrapped in transactions.
- Projects are optional view-layer groupings. Entities don't know about projects — linking tables hold the references. All list queries accept an optional `projectId` filter. Adding a job to a project auto-links its agent, docs, env vars, and databases.

## Browser testing / screenshots

Use `playwright-cli` for visual review and screenshots. Key flow:

```bash
# Open browser and navigate (browser persists across commands)
playwright-cli open "http://localhost:3001/some-page"

# Auth: set session cookie (get a valid session ID from the sessions table)
playwright-cli eval "document.cookie = 'harbour_session=SESSION_ID; path=/'"
playwright-cli goto "http://localhost:3001/some-page"  # reload with auth

# Screenshots
playwright-cli screenshot --full-page --filename /tmp/screenshot.png

# Resize for mobile/desktop testing
playwright-cli resize 1280 900    # desktop
playwright-cli resize 390 844     # mobile (iPhone 14)

# Other useful commands
playwright-cli snapshot           # accessibility tree (element refs)
playwright-cli click <ref>        # interact with elements
playwright-cli eval "js expression"  # run JS in page context
```

Dev server runs on port 3001 (`npm run dev -- -p 3001`) to avoid conflicting with a production server on 3000.
