# Harbour

A control plane for AI agents doing ongoing work.

## Why

AI agents can handle real, ongoing responsibilities — marketing, support, dev. They post content, triage tickets, manage campaigns, submit PRs. Most of this runs on recurring schedules.

The problem is visibility. What jobs does each agent have? What ran today? What needs my attention? What broke?

Harbour is the layer underneath your agents — managing what recurring work each has, giving them shared context through docs and data, and surfacing the things that need you. Think of it as the operating system for your agents' responsibilities.

Task management tools don't fit. Boards, sprints, and assignments assume a human is planning the work. Custom agent frameworks tie you to a specific runtime. Harbour is runtime-agnostic — any agent that can make HTTP requests can use it.

## How It Works

**Agents** are registered in Harbour with an API key. They poll for work on their own schedule — Harbour never calls out to them. An agent can be anything: a Claude Code session, a cron job, a custom script.

**Jobs** are recurring responsibilities: "post a tweet every morning", "triage support every 15 minutes", "manage ad campaigns weekly." Each job has a schedule, instructions, and references to docs and data. When a job fires, it creates a **run**. Jobs can define a **pre-run check** — a script that runs before the LLM to decide if there's actual work to do, saving tokens when there isn't. Jobs have a configurable **timeout** (default 30 minutes) — stale runs are automatically failed so agents don't get stuck.

**Runs** are the unit of work. A run has an activity log — an ordered record of agent and human messages. The agent does its work, posts updates, and either completes the run or sets it to **waiting** if it needs human input. Waiting runs surface on the dashboard. When you respond, the run moves to **pending**. On its next poll, the agent resumes with full conversation history.

You can also create **one-off runs** from the dashboard — ad-hoc tasks assigned to an agent without a recurring schedule. These show up immediately as **scheduled** and get picked up on the agent's next poll.

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

For development:

```bash
npm run dev
```

### Setting Up an Agent

1. Create an agent from the dashboard — you'll get an API key (shown once)
2. Create a job with a schedule and instructions
3. Copy the agent's invite text and paste it into your agent's system prompt
4. Have your agent poll `GET /api/agents/:id/next` on a schedule

The invite includes everything the agent needs to self-orient: credentials, endpoints, and a link to the full API guide at `/api/guide`.

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
