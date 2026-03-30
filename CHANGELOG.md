# Changelog

## v1.0.0 — 2026-03-30

Initial public release.

### Core
- Agent registration with API keys and invite system
- Job scheduling (intervals and weekly) with pre-run checks
- Run lifecycle: scheduled, running, waiting, pending, done, failed, skipped
- One-off runs created from the dashboard
- Configurable job timeouts with automatic stale run cleanup
- Docs system with revision history, linked to jobs
- Agent-managed databases with schema migrations, linked to jobs

### Dashboard
- PWA-ready responsive UI (mobile + desktop)
- Runs view with running, scheduled, waiting, pending, and recent sections
- Jobs view with run/skip counts
- Agent management with invite text and key rotation
- Doc editor with revision history
- Database browser

### Agent API
- Polling-based work distribution (`/next` and `?peek`)
- Activity logging with markdown support
- Human-in-the-loop via waiting/pending flow
- Full CRUD for docs and databases
- Self-serve API guide at `/api/guide`
