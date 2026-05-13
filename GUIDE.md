# Harbour Agent Guide

This document covers everything an agent needs to work with Harbour. It is served at `GET /api/guide`.

## Overview

Harbour is a control plane that manages your recurring jobs, shared docs, data stores, and encrypted environment variables. It doesn't control how you do your work — it tells you *what* to do, *when*, and gives you the context to do it.

You poll for work. Harbour returns a job with instructions, referenced docs, database rows, and env vars. You do the work, log your activity, and mark it done — or set it to "waiting" if you need human input. Humans respond on the dashboard, and your next poll picks it up. You can also create and update shared docs and manage structured data through the API.

Key concepts:
- **Jobs** — recurring responsibilities with a schedule, instructions, and linked docs/data/env vars
- **Runs** — a single execution of a job, with an activity log of agent and human messages
- **Docs** — shared markdown documents, injected into runs automatically
- **Databases** — SQLite tables you create and manage, injected into runs automatically
- **Env Vars** — encrypted key-value pairs (API keys, tokens), decrypted and injected at runtime

## Scheduling

Jobs use the `schedule` field to define when they run. Harbour automatically computes `next_run_at` when a job is created, and advances it each time a run completes (status changes to `done`, `failed`, or `skipped`). You don't need to manage `next_run_at` yourself.

All schedule times use the system timezone configured in Settings (auto-detected from the server on first run).

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

## Tool Permissions

Each agent has per-endpoint tool permissions, enforced server-side. Calls to a denied endpoint return:

```
HTTP/1.1 403 Forbidden
{ "error": "tool '<name>' is not permitted for this agent" }
```

The `api` block in the `/next` payload lists only the endpoints the agent may use. Endpoints absent from `api.endpoints` will 403 — don't try them.

Tools and the endpoints they gate:

- `post_activity` — `POST /api/runs/:id/activity`
- `update_status` — `PUT /api/runs/:id/status`
- `read_docs` / `write_docs` — `GET`/`POST`/`PUT`/`DELETE /api/docs[/:id]`
- `read_databases` / `write_databases` — `GET`/`POST /api/databases[/:id/rows]`
- `create_handoffs` — `POST /api/runs/:id/handoff`
- `create_runs` — `POST /api/runs`

Agents that need a capability the dashboard hasn't granted should fail the run with `status=failed` and a clear activity message explaining what was missing, rather than retrying.

## Autonomy & Approvals

On top of per-agent tool permissions, Harbour has an autonomy-policy layer. Declarative rules (configured in Settings) decide whether an action needs human approval. Tool calls intercepted by the policy receive a soft block:

```
HTTP/1.1 200 OK     # the tool dispatch path returns its normal envelope
{ "error": "tool 'send_email' requires approval (request ap_abc123): Policy \"Default Safety Policy\" requires approval for send_email" }
```

The check runs *inside the runner* — API-agent function calls hit `POST /api/internal/autonomy/check` before being dispatched, and on a block the runner returns the error string above as the tool result so the LLM can adapt. External agents pulling work through `/next` do not see this gate today; their tool calls are governed only by the per-agent `tool_permissions` matrix.

`action_type` values used by the policy layer:

- `send_email`, `send_message`, `contact_customer`
- `spend_money`
- `deploy_code`, `merge_pr`
- `delete_data`, `modify_production`, `use_secret`
- `external_api_call`, `create_handoff`, `update_status`
- `custom`

How agents should respond to an approval rejection:

1. Treat the error as a soft block — do **not** retry the same call in a tight loop.
2. Post an activity message explaining what was attempted and that approval is pending. Operators will see the request in **Settings → Autonomy & Approvals** and on the run page.
3. Either set the run to `waiting` (if the rest of the run depends on the blocked action) or continue with what you can. Approval is recorded after the fact; the human decides separately.

The runner records one approval request per blocked tool call. Approvals are advisory — they are not automatically re-dispatched. After a human approves, retry from the dashboard (or via a follow-up run) if you need the action carried out.

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
    "workflow": null,
    "workflow_only": false,
    "model": null,
    "thinking": null,
    "timeout_minutes": 30
  },
  "docs": [
    { "id": "uuid", "title": "Brand Voice", "content": "..." }
  ],
  "data": {
    "metrics": [{ "_id": 1, "followers": 12400, "engagement_rate": 3.2 }],
    "tweet_history": [{ "_id": 5, "date": "2024-03-01", "text": "...", "impressions": 340 }]
  },
  "env": {
    "GITHUB_TOKEN": "ghp_...",
    "FIGMA_API_KEY": "figd_..."
  },
  "attachments": [
    {
      "id": "uuid", "run_id": "uuid", "activity_id": null, "kind": "file",
      "filename": "screenshot.png", "mime_type": "image/png", "size_bytes": 124000,
      "url": "https://your-harbour.example.com/api/runs/<run_id>/attachments/<id>/file",
      "embed_provider": null, "title": null,
      "uploaded_by_type": "user", "uploaded_by_name": "Gavin",
      "created_at": 1700000000
    },
    {
      "id": "uuid", "run_id": "uuid", "activity_id": null, "kind": "embed",
      "filename": null, "mime_type": null, "size_bytes": null,
      "url": "https://www.loom.com/share/...", "embed_provider": "loom",
      "title": "Walkthrough",
      "uploaded_by_type": "user", "uploaded_by_name": "Gavin",
      "created_at": 1700000000
    }
  ],
  "api": {
    "base_url": "https://your-harbour.example.com",
    "endpoints": {
      "update_status": "PUT https://your-harbour.example.com/api/runs/<run_id>/status",
      "post_activity": "POST https://your-harbour.example.com/api/runs/<run_id>/activity",
      "upload_attachment": "POST https://your-harbour.example.com/api/runs/<run_id>/attachments",
      "create_doc": "POST https://your-harbour.example.com/api/docs",
      "update_doc": "PUT https://your-harbour.example.com/api/docs/:id",
      "create_database": "POST https://your-harbour.example.com/api/databases",
      "insert_rows": "POST https://your-harbour.example.com/api/databases/:id/rows",
      "read_rows": "GET https://your-harbour.example.com/api/databases/:id/rows",
      "guide": "GET https://your-harbour.example.com/api/guide"
    },
    "status_options": ["done", "failed", "waiting"],
    "notes": [
      "You MUST set a final status (done/failed) when finished, or waiting if you need human input.",
      "Post activity messages to log progress — these are visible on the dashboard.",
      "Attachments belong to the run thread — files (multipart) or video URL embeds (JSON {url}).",
      "Full API spec available at the guide endpoint."
    ]
  }
}
```

Everything the agent needs is bundled in one response: the run, job instructions (with optional per-job model/thinking overrides), referenced docs, linked database rows (most recent 100 per table), decrypted env vars, attachments (files + URL embeds), and the `api` section with pre-resolved endpoints for this run and available status options. Use the endpoints in `api` to update run status, post activity, upload attachments, and manage docs and databases — no need to construct URLs yourself.

The `env` field contains decrypted environment variables linked to the job. Use these for API keys, tokens, and other credentials needed during the run.

#### Process env vars injected by the runner

When the Harbour runner spawns your CLI subprocess (any provider — Claude Code, Codex, Gemini CLI, or Custom Shell), it injects these env vars on top of the job-linked ones so scripts can call back to Harbour without needing to construct URLs or look up keys:

| Variable | Meaning |
|---|---|
| `HARBOUR_URL` | the harbour base URL the runner is polling |
| `HARBOUR_API_KEY` | the agent's API key (Bearer token) |
| `HARBOUR_AGENT_ID` | the polling agent's id |
| `HARBOUR_RUN_ID` | the current run's id |
| `HARBOUR_JOB_ID` | the current job's id |

External agents that don't use the harbour runner construct their own equivalents during setup — these are runner-injected conveniences, not part of the on-wire `/next` payload.

The `attachments` field is the list of files and URL embeds attached to the run. Files have a download `url` that you can fetch with the same Bearer token. Embeds carry the source URL — recognised providers (`loom`, `youtube`, `vimeo`) render as inline players on the dashboard; anything else is recorded with `embed_provider: "generic"` and shown as a link.

### Peek (Read-Only Check)

```
GET /api/agents/:id/next?peek=true
```

Check if work is available without claiming anything. Useful for cron guards. Returns one of:

- `{"available": false, "reason": "busy"}` — agent already has a `running` run
- `{"available": false, "reason": "nothing_to_do"}` — no work
- `{"available": true, "type": "pending_resume", "run_id": "...", "job_name": "..."}` — a `pending` run is ready to resume
- `{"available": true, "type": "scheduled_run", "run_id": "...", "job_name": "..."}` — a one-off scheduled run is due
- `{"available": true, "type": "scheduled", "job_id": "...", "job_name": "..."}` — a recurring job is due (run will be created on the next non-peek call)

## Run Lifecycle

### Update Status

```
PUT /api/runs/:id/status
Content-Type: application/json

{ "status": "waiting" }
```

Valid statuses (the API accepts any of these in the body):
- `scheduled` — created from dashboard, waiting to be picked up
- `running` — agent is actively working
- `waiting` — agent needs human input (surfaces on dashboard)
- `pending` — human has responded, queued for agent pickup (set automatically when a human comments on a `waiting`/`done`/`failed`/`killed` run)
- `done` — completed successfully
- `failed` — something broke (or timed out)
- `skipped` — workflow determined nothing to do (exit code 77)
- `killed` — set by the harbour-agent runner when a kill request was honored; not used by external agents

When a run transitions to `done`, `failed`, or `skipped`, Harbour automatically advances the job's `next_run_at` to the next scheduled time. No manual schedule management needed.

**Retrying:** Failed, skipped, and killed runs can be retried from the dashboard via `POST /api/runs/:id/retry`. The run goes back to `pending` with a system activity note, and the agent picks it up on next poll.

**Timeouts:** Each job has a configurable `timeout_minutes` (default 30). If a run stays in `running` status longer than the timeout with no activity updates, it is automatically failed on the next poll with a system message. This prevents stuck runs from blocking the agent.

### Add Activity

```
POST /api/runs/:id/activity
Content-Type: application/json

{ "content": "Found 3 new mentions. Processing...", "attachment_ids": ["uuid", ...] }
```

Activity entries support markdown. They form the visible record of what happened during the run. Returns the created entry with HTTP 201.

`attachment_ids` is optional. To attach files or embeds to a comment, upload them first via `POST /api/runs/:id/attachments`, then pass the returned ids in this field. Comments may have empty `content` if they only carry attachments — but a comment with neither `content` nor `attachment_ids` is rejected with 400.

### Attachments

Attach files (screenshots, PDFs, exports) or URL embeds (Loom, YouTube, Vimeo, or generic links) to a run. Both kinds appear in the activity thread on the dashboard and in the `attachments` array of `/next`.

**Upload a file (multipart/form-data):**

```
POST /api/runs/:id/attachments
Content-Type: multipart/form-data; boundary=...

--boundary
Content-Disposition: form-data; name="file"; filename="screenshot.png"
Content-Type: image/png

<binary>
--boundary--
```

Multiple `file` parts in one request are supported. Per-file limit is set by `HARBOUR_MAX_UPLOAD_MB` (default 500MB); files larger than the cap fail with HTTP 413. Returns an array of attachment records.

**Attach an embed URL (JSON):**

```
POST /api/runs/:id/attachments
Content-Type: application/json

{ "url": "https://www.loom.com/share/abc123", "title": "Walkthrough" }
```

`title` is optional. The provider (`loom`, `youtube`, `vimeo`, `generic`) is detected from the URL — only well-formed URLs are accepted (returns 400 otherwise). Returns a single attachment record (201).

**List attachments:** `GET /api/runs/:id/attachments`
**Delete an attachment:** `DELETE /api/runs/:id/attachments/:aid`
**Download a file:** `GET /api/runs/:id/attachments/:aid/file` — same Bearer token works.

**The waiting flow:**

1. You need human input — set the run to `waiting` and add an activity message explaining what you need
2. The run surfaces on the dashboard. The human reads your message and responds
3. The status automatically changes from `waiting` to `pending` — the human's response is in the activity log
4. On your next `/next` poll, Harbour returns this `pending` run — status flipped to `running`, full activity history included
5. You read the human's response from the activity log and continue your work

Pending runs **always take priority** over scheduled jobs. Other jobs continue to fire normally while a run is waiting — work doesn't block.

## Handoffs

You can hand work off to another agent or team instead of escalating to a human. Harbour creates a new scheduled run on the target side, forwards the source instructions + activity log + linked docs/env vars, and the next time the target agent (or any eligible team member) polls, the work appears in its queue. The existing run lifecycle handles everything else.

```
POST /api/runs/<source-run-id>/handoff
Authorization: Bearer <your-agent-api-key>
Content-Type: application/json
```

**Direct to an agent:**
```json
{
  "targetAgentId": "agent-uuid",
  "message": "Please review the migration plan in this run's activity log and approve or suggest fixes."
}
```

**To a team:**
```json
{
  "targetTeamId": "team-uuid",
  "message": "..."
}
```

**To a team, preferring a role:**
```json
{
  "targetTeamId": "team-uuid",
  "targetRole": "reviewer",
  "message": "..."
}
```

Rules:

- Exactly one of `targetAgentId` or `targetTeamId` must be set. The API rejects both, or neither, with HTTP 400.
- `message` is required and non-empty.
- `targetRole` is honored on team handoffs: if a member has that role, they get the work first. With the default fallback (`any`), non-matching members can claim once all role-matching specialists are at their `max_concurrent_runs` cap. (Specify `"targetRole"` only; the fallback is fixed at `any` for now.)

What flows to the target run automatically:

- The source job's instructions (verbatim, as a section in the target's instructions)
- A snapshot of the source run's activity log (every entry, in order)
- The source job's linked docs and env vars
- Your `message` (also posted as a system activity entry on both runs)

What the **message** is for: tell the target *what you need from them*, not what context they already have. They get the source's instructions and activity automatically — the message is the bridge, not a repeat.

**Status lifecycle:** the handoff starts at `pending`, moves to `accepted` when the target run transitions to `running`, and to `completed` when it reaches `done`. On `failed`, `killed`, or `skipped` we deliberately don't auto-transition — the handoff stays `accepted` (or `pending`) so the source operator can see something's off.

If the source run is later deleted, the handoff persists with `source_run_name_snapshot` and `source_agent_name_snapshot` set, so the target still sees who handed it the work even if the source link is broken.

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

All query params are optional. Defaults: `limit=100`, `offset=0`, `order=DESC`, sorted by `rowid` descending when `orderBy` is omitted. `orderBy` must reference a real column or the request fails with 400.

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

Docs are top-level resources linked to jobs. When a job fires, all its linked docs are included in the `/next` payload automatically. Pinned docs are auto-attached to all new jobs and one-off runs. Agents can also create and update docs:

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

# Your LLM invocation here
# RESPONSE contains the full run context
```
