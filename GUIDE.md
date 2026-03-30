# Harbour Agent Guide

This document covers everything an agent needs to work with Harbour. It is served at `GET /api/guide`.

## Overview

Harbour is a control plane that manages your recurring jobs, shared docs, and data stores. It doesn't control how you do your work — it tells you *what* to do, *when*, and gives you the context to do it.

You poll for work. Harbour returns a job with instructions, referenced docs, and database rows. You do the work, log your activity, and mark it done — or set it to "waiting" if you need human input. Humans respond on the dashboard, and your next poll picks it up. You can also create and update shared docs and manage structured data through the API.

Key concepts:
- **Jobs** — recurring responsibilities with a schedule, instructions, and linked docs/data
- **Runs** — a single execution of a job, with an activity log of agent and human messages
- **Docs** — shared markdown documents, injected into runs automatically
- **Databases** — SQLite tables you create and manage, injected into runs automatically

## Scheduling

Jobs use the `schedule` field to define when they run. Harbour automatically computes `next_run_at` when a job is created, and advances it each time a run completes (status changes to `done`, `failed`, or `skipped`). You don't need to manage `next_run_at` yourself.

**Choose the right schedule type for the job.** Most agent jobs should use short intervals (every few minutes), not weekly schedules. Use weekly/daily only for jobs that genuinely run on a calendar cadence (e.g. a weekly newsletter). For monitoring, triage, content posting, and most recurring work, use an interval.

### Schedule format

Schedules are JSON in one of two shapes:

**Interval** — run every N minutes:
```json
{"every": 5}
```

**Weekly** — run on specific days at a specific time:
```json
{"days": [1, 2, 3, 4, 5], "time": "09:00"}
```

Days are 0 (Sunday) through 6 (Saturday). Time is 24-hour `HH:MM`.

**Examples:**
- `{"every": 5}` — every 5 minutes (good default for most jobs)
- `{"every": 60}` — every hour
- `{"every": 1440}` — once a day
- `{"days": [1, 2, 3, 4, 5], "time": "09:00"}` — weekdays at 9am
- `{"days": [0, 1, 2, 3, 4, 5, 6], "time": "14:30"}` — daily at 2:30pm
- `{"days": [5], "time": "09:00"}` — Fridays at 9am

For convenience, the API also accepts human-readable strings and common cron expressions. These are automatically normalized to JSON on creation:
- `every 5 minutes` → `{"every": 5}`
- `daily at 9am` → `{"days": [0,1,2,3,4,5,6], "time": "09:00"}`
- `weekly on friday at 9am` → `{"days": [5], "time": "09:00"}`
- `*/5 * * * *` → `{"every": 5}`
- `0 9 * * 1-5` → `{"days": [1,2,3,4,5], "time": "09:00"}`

## Authentication

All API requests require a Bearer token in the Authorization header:

```
Authorization: Bearer hbr_<your_api_key>
```

API keys are issued when an agent is created and shown only once. Keys can be rotated from the dashboard.

## The Polling Loop

Agents pull work from Harbour on their own schedule. Harbour never calls out to agents.

### Get Next Work

```
GET /api/agents/:id/next
```

Returns the next thing for the agent to work on, or `null` if nothing to do.

**Priority order:**
1. Any stale `running` run past its job's timeout is automatically failed first
2. If the agent has a run in `running` status, returns `null` (agent is busy)
3. Any `pending` run (human responded, ready to resume) — resume it
4. Any `scheduled` run ready to start (one-off runs from dashboard) — claim it
5. Any recurring job past its scheduled time without an active run — create a new run
6. Nothing to do — returns `null`

**Response format:**
```json
{
  "run": {
    "id": "uuid",
    "status": "running",
    "activity": [...]
  },
  "job": {
    "id": "uuid",
    "name": "Morning Tweet",
    "instructions": "Write an engaging tweet about...",
    "check": "python3 checks/new_content.py"
  },
  "docs": [
    { "id": "uuid", "title": "Brand Voice", "content": "..." }
  ],
  "data": {
    "metrics": [{ "_id": 1, "followers": 12400, "engagement_rate": 3.2 }],
    "tweet_history": [{ "_id": 5, "date": "2024-03-01", "text": "...", "impressions": 340 }]
  }
}
```

Everything the agent needs is bundled in one response: the run, job instructions, referenced docs, and linked database rows (most recent 100 per table).

### Peek (Read-Only Check)

```
GET /api/agents/:id/next?peek=true
```

Check if work is available without claiming anything. Useful for cron guards.

## Pre-run Checks

Jobs can define an optional `check` — a shell command that runs before the LLM to decide if there's actual work to do.

**Contract:**
- **Input:** the full `/next` JSON payload on **stdin**
- **Output:** additional context on **stdout**
- **Exit 0:** proceed — start the LLM with run context + check output
- **Exit non-zero:** skip — mark the run as `skipped`, no LLM invoked

The check runs on the agent side, not in Harbour. It's included in the `/next` response for the agent runner to execute.

## Run Lifecycle

### Update Status

```
PUT /api/runs/:id/status
Content-Type: application/json

{ "status": "waiting" }
```

Valid statuses:
- `scheduled` — created from dashboard, waiting to be picked up
- `running` — agent is actively working
- `waiting` — agent needs human input (surfaces on dashboard)
- `pending` — human has responded, queued for agent pickup (set automatically when a human responds to a waiting run)
- `done` — completed successfully
- `failed` — something broke (or timed out)
- `skipped` — pre-run check determined nothing to do

When a run transitions to `done`, `failed`, or `skipped`, Harbour automatically advances the job's `next_run_at` to the next scheduled time. No manual schedule management needed.

**Timeouts:** Each job has a configurable `timeout_minutes` (default 30). If a run stays in `running` status longer than the timeout with no activity updates, it is automatically failed on the next poll with a system message. This prevents stuck runs from blocking the agent.

### Add Activity

```
POST /api/runs/:id/activity
Content-Type: application/json

{ "content": "Found 3 new mentions. Processing..." }
```

Activity entries support markdown. They form the visible record of what happened during the run.

**The waiting flow:**

1. You need human input — set the run to `waiting` and add an activity message explaining what you need
2. The run surfaces on the dashboard. The human reads your message and responds
3. The status automatically changes from `waiting` to `pending` — the human's response is in the activity log
4. On your next `/next` poll, Harbour returns this `pending` run — status flipped to `running`, full activity history included
5. You read the human's response from the activity log and continue your work

Pending runs **always take priority** over scheduled jobs. Other jobs continue to fire normally while a run is waiting — work doesn't block.

## Databases

Databases are real SQLite tables managed through the API. Each database is a named table with typed columns — agents create them, insert rows, and link them to jobs. Linked databases are automatically injected into the `/next` payload.

### Create a Database

```
POST /api/databases
Content-Type: application/json

{
  "name": "tweet_history",
  "columns": [
    { "name": "date", "type": "TEXT", "required": true },
    { "name": "text", "type": "TEXT", "required": true },
    { "name": "likes", "type": "INTEGER" },
    { "name": "impressions", "type": "INTEGER" }
  ]
}
```

If a database with the same name already exists, it returns the existing one. Column types are native SQLite: `TEXT`, `INTEGER`, `REAL`. Every table gets an auto-incrementing `_id` column.

### Insert Rows

```
POST /api/databases/:id/rows
Content-Type: application/json

[
  { "date": "2024-03-01", "text": "Hot take: most API docs...", "likes": 156, "impressions": 5400 },
  { "date": "2024-03-02", "text": "Ship it Friday...", "likes": 89, "impressions": 3100 }
]
```

Body can be a single object or an array. Unknown columns are silently ignored.

### Read Rows

```
GET /api/databases/:id/rows?limit=50&offset=0&orderBy=date&order=DESC
```

Returns `{ rows: [...], total: 100, limit: 50, offset: 0 }`.

### Update a Row

```
PUT /api/databases/:id/rows/:rowId
Content-Type: application/json

{ "likes": 200 }
```

### Delete a Row

```
DELETE /api/databases/:id/rows/:rowId
```

### Add a Column

```
POST /api/databases/:id/columns
Content-Type: application/json

{ "name": "retweets", "type": "INTEGER", "default": 0 }
```

Schema changes are tracked in a migration history.

### Link a Database to a Job

```
POST /api/jobs/:id/data
Content-Type: application/json

{ "databaseId": "uuid" }
```

Linked databases are included in the `/next` payload (most recent 100 rows per table).

### Convenience Endpoint

Agents can also use the combined endpoint to create + link + seed in one call:

```
POST /api/agents/:id/data
Content-Type: application/json

{
  "name": "tweet_history",
  "columns": [{ "name": "date", "type": "TEXT" }, { "name": "text", "type": "TEXT" }],
  "jobId": "uuid",
  "rows": [{ "date": "2024-03-01", "text": "First tweet" }]
}
```

## Docs

Docs are top-level resources linked to jobs. When a job fires, all its linked docs are included in the `/next` payload automatically. Agents can also create and update docs:

### Create a Doc

```
POST /api/docs
Content-Type: application/json

{ "title": "Content Calendar", "content": "## March 2024\n..." }
```

### Update a Doc

```
PUT /api/docs/:id
Content-Type: application/json

{ "content": "Updated content..." }
```

Doc revisions are preserved automatically.

## Reference Runner

```bash
#!/bin/bash
# Polls Harbour and invokes the LLM when there's work

RESPONSE=$(curl -s -H "Authorization: Bearer $KEY" \
  "$HARBOUR_URL/api/agents/$AGENT_ID/next")
[ -z "$RESPONSE" ] || [ "$RESPONSE" = "null" ] && exit 0

RUN_ID=$(echo "$RESPONSE" | jq -r '.run.id')

# Pre-run check (if job defines one)
CHECK=$(echo "$RESPONSE" | jq -r '.job.check // empty')
if [ -n "$CHECK" ]; then
  CHECK_OUTPUT=$(echo "$RESPONSE" | eval "$CHECK") || {
    curl -s -X PUT "$HARBOUR_URL/api/runs/$RUN_ID/status" \
      -H "Authorization: Bearer $KEY" \
      -H "Content-Type: application/json" \
      -d '{"status":"skipped"}'
    exit 0
  }
fi

# Your LLM invocation here
# RESPONSE and CHECK_OUTPUT contain the context
```
