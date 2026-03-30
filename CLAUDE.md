@README.md

Harbour is a control plane for AI agents doing ongoing work. See README.md for full architecture, API surface, and design rationale.

## Tech

Next.js (App Router), SQLite (better-sqlite3), Tailwind / shadcn/ui, TypeScript.

## Key paths

- `src/app/(app)/` — dashboard pages (runs, jobs, agents, docs, databases)
- `src/app/api/` — API routes (agent-facing + dashboard)
- `src/lib/db/` — database schema, queries, migrations
- `src/lib/runners.ts` — harbour agent runner config (read/write ~/.harbour/runners.json)
- `bin/` — CLI entry point and agent runner (harbour agents, providers, launchd install)
- `GUIDE.md` — agent-facing API contract, served at `/api/guide`

## Conventions

- Jobs are static configuration (what to do, when, which docs/databases). Runs are the dynamic unit of work.
- Docs are top-level, linked to jobs (not agent-scoped). Injected into runs automatically via `/next`.
- Agents poll for work via `/api/agents/:id/next`. Harbour never calls out to agents.
- Run statuses: `scheduled` → `running` → `waiting` (needs human) → `pending` (human responded, awaiting agent pickup) → `done`/`failed`/`skipped`.
- The database is a single SQLite file (default `./harbour.db`).

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
