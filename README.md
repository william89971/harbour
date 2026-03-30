# Harbour

A control plane for AI agents doing ongoing work.

![Harbour Dashboard](public/screenshot.png)

## Why

AI agents can handle real, ongoing responsibilities — marketing, support, dev. They post content, triage tickets, manage campaigns, submit PRs. Most of this runs on recurring schedules.

The problem is visibility. What jobs does each agent have? What ran today? What needs my attention? What broke?

Harbour is the layer underneath your agents — managing what recurring work each has, giving them shared context through docs and data, and surfacing the things that need you. Think of it as the operating system for your agents' responsibilities.

## How It Works

Harbour is a polling-based control plane. It never calls out to agents — they pull work on their own schedule. Any agent that can make HTTP requests can use it.

**Agents** are registered with an API key. They poll `GET /api/agents/:id/next` for work. Harbour has built-in support for running agents via CLI tools like [Claude Code](https://claude.ai/claude-code), [Codex](https://github.com/openai/codex), and [Gemini CLI](https://github.com/google-gemini/gemini-cli) — or you can bring your own agent using any tool that can poll an endpoint, like [OpenClaw](https://openclaw.ai).

**Jobs** are recurring responsibilities: "post a tweet every morning", "triage support every 15 minutes", "manage ad campaigns weekly." Each job has a schedule, instructions, and references to docs and data. When a job fires, it creates a **run**.

**Runs** are the unit of work. A run has an activity log — an ordered record of agent and human messages. The agent does its work, posts updates, and either completes the run or sets it to **waiting** if it needs human input. Waiting runs surface on the dashboard.

**Docs** are shared markdown documents that provide context across jobs. Brand guidelines, escalation processes, strategy notes. Jobs declare which docs they need, and they're automatically injected into each run.

**Databases** are SQLite tables that agents create and manage through the API. Jobs declare which databases they use, and recent rows are automatically injected into each run.

## Getting Started

```bash
git clone https://github.com/geekforbrains/harbour.git
cd harbour
npm install
npm run build
npm start
```

Visit [http://localhost:3000](http://localhost:3000) and create your first account.

### Quick Start with a Harbour Agent

The fastest way to get an agent running. Requires [Claude Code](https://claude.ai/claude-code), [Codex](https://github.com/openai/codex), or [Gemini CLI](https://github.com/google-gemini/gemini-cli) installed and authenticated.

1. Open the dashboard and click **New Agent**
2. Select **Harbour Agent** and pick your CLI tool — Harbour auto-detects what's installed
3. Name it and pick a model
4. Create a **job** for the agent with a schedule and instructions
5. Install the runner:

```bash
npm run harbour -- agent install
```

That's it. The runner polls every 60 seconds, picks up work, runs your CLI tool, and posts results back to Harbour. Logs go to `~/.harbour/runner.log`.

Other runner commands:

```bash
npm run harbour -- agent list        # show configured agents
npm run harbour -- agent run         # manual poll (useful for testing)
npm run harbour -- agent uninstall   # stop the runner
```

### Bring Your Own Agent

Harbour is agent-agnostic. Any tool that can poll an HTTP endpoint works.

1. Create an agent from the dashboard — select **External** to get an API key
2. Create a job with a schedule and instructions
3. Copy the invite text into your agent's system prompt
4. Have your agent poll `GET /api/agents/:id/next` on a schedule

The invite includes credentials, endpoints, and a link to the full API guide at `/api/guide`. Tools like [OpenClaw](https://openclaw.ai), custom scripts, or any agent framework that can make HTTP requests will work.

## Agent API

Agents interact with Harbour through a polling API. The system never calls out to agents.

```
GET  /api/agents/:id/next           — get next run (or nothing)
GET  /api/agents/:id/next?peek=true — check for work without claiming it
PUT  /api/runs/:id/status           — update run status
POST /api/runs/:id/activity         — add to the run's activity log
POST /api/docs                      — create a doc
PUT  /api/docs/:id                  — update a doc
POST /api/databases                 — create a database
POST /api/databases/:id/rows        — insert rows
GET  /api/databases/:id/rows        — read rows (paginated)
GET  /api/guide                     — full API guide
```

`/next` returns a complete context bundle: the run, job instructions, referenced docs, database rows, and the pre-run check command (if any). The agent gets everything it needs in one call.

**Priority:** pending runs (human responded) > scheduled one-off runs > recurring jobs ready to fire.

**Timeouts:** runs that exceed their job's timeout are automatically failed on the next poll with a system message, unblocking the agent for new work.

Full API documentation is served at `/api/guide` and maintained in [GUIDE.md](GUIDE.md).

## Dashboard

- **Runs** — running, scheduled, waiting, pending, and recent runs. Create one-off runs with "New Run."
- **Jobs** — recurring jobs across agents, with run/skip counts and schedules.
- **Agents** — list of agents with jobs, activity, and poll status.
- **Docs** — shared knowledge base, editable by humans and agents.
- **Databases** — read-only view of agent-managed SQLite tables.

Available as a PWA — add to your home screen on mobile for a native app experience.

## Run Lifecycle

```
scheduled → running → done
                    → failed
                    → skipped (pre-run check)
                    → waiting (needs human) → pending (human responded) → running → ...
```

## Tech Stack

Next.js (App Router), SQLite (better-sqlite3), Tailwind / shadcn/ui, TypeScript.

Single binary-style deployment — no external database, no Redis, no background workers. Just `npm start`.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `HARBOUR_DB_PATH` | SQLite database file path | `./harbour.db` |

## License

[MIT](LICENSE)
