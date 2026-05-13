# Database schema

A dense reference. Source of truth: `src/lib/db/schema.ts`. The numbers below are computed from a freshly initialized DB, not paraphrased.

- **Tables: 28**
- **Indexes: 18 explicit** (plus auto-indexes on PRIMARY KEY / UNIQUE columns)

Notation in the column tables:
- **PK** — PRIMARY KEY (composite PKs noted in the description column)
- **FK** — REFERENCES, with the cascade behavior in parentheses
- **NN** — NOT NULL
- **U** — UNIQUE
- **CHECK** — has a CHECK constraint (described inline)
- Default values shown only when non-trivial; `created_at`/`updated_at` default to `unixepoch()` everywhere.

## Auth

### `users`
Human accounts for dashboard auth.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | TEXT | PK | uuid v4 |
| `email` | TEXT | NN, U | |
| `password_hash` | TEXT | NN | bcryptjs hash |
| `display_name` | TEXT | NN | |
| `role` | TEXT | NN, CHECK | one of `admin`, `operator`, `viewer`. Default `admin` (backwards-compat). RBAC gates wrap mutation routes in `src/lib/auth.ts`. |
| `created_at` | INTEGER | NN | |
| `updated_at` | INTEGER | NN | |

### `sessions`
Cookie-backed user sessions.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | TEXT | PK | the cookie value |
| `user_id` | TEXT | NN, FK → `users(id)` (CASCADE) | |
| `expires_at` | INTEGER | NN | epoch seconds |
| `created_at` | INTEGER | NN | |

Index: `idx_sessions_user(user_id)`.

## Agents and jobs

### `agents`
Top-level entity. Each agent has zero-or-many jobs and one API key.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | TEXT | PK | |
| `name` | TEXT | NN | |
| `description` | TEXT | | |
| `api_key_hash` | TEXT | NN | sha256 hex of the bearer key |
| `last_polled_at` | INTEGER | | updated by `/api/agents/:id/next` |
| `type` | TEXT | NN, default `'external'` | `'external'` or `'harbour'` |
| `cli` | TEXT | | `'claude'` / `'codex'` / `'gemini'` (harbour agents) |
| `model` | TEXT | | default model override (harbour agents) |
| `thinking` | TEXT | | default thinking/effort override |
| `remote` | INTEGER | NN, default 0 | runner lives off-host |
| `eager` | INTEGER | NN, default 0 | drain queue back-to-back instead of waiting 60s between runs (harbour agents only) |
| `created_at` | INTEGER | NN | |
| `updated_at` | INTEGER | NN | |

### `jobs`
Static configuration for recurring work.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | TEXT | PK | |
| `agent_id` | TEXT | FK → `agents(id)` (CASCADE) | **nullable** for workflow-only jobs |
| `name` | TEXT | NN | |
| `description` | TEXT | | |
| `instructions` | TEXT | | the prompt body for agent jobs |
| `schedule` | TEXT | NN | normalized JSON: `{"every":N}` or `{"days":[0-6],"time":"HH:MM"}` |
| `workflow_command` | TEXT | | shell command (gate or full job) |
| `workflow_only` | INTEGER | NN, default 0 | 1 = no agent involved |
| `timeout_minutes` | INTEGER | NN, default 30 | |
| `one_off` | INTEGER | NN, default 0 | 1 = deactivate after first run |
| `active` | INTEGER | NN, default 1 | |
| `last_run_at` | INTEGER | | |
| `next_run_at` | INTEGER | | populated by schedule advance |
| `model` | TEXT | | per-job override (harbour agents) |
| `thinking` | TEXT | | per-job override |
| `created_at` | INTEGER | NN | |
| `updated_at` | INTEGER | NN | |

Indexes: `idx_jobs_agent(agent_id)`, `idx_jobs_schedule(agent_id, active, next_run_at)`.

### `runs`
A single execution of a job.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | TEXT | PK | |
| `job_id` | TEXT | NN, FK → `jobs(id)` (CASCADE) | |
| `agent_id` | TEXT | FK → `agents(id)` (CASCADE) | nullable for agentless workflow runs |
| `status` | TEXT | NN, CHECK | `scheduled \| running \| waiting \| pending \| done \| failed \| skipped \| killed` |
| `scheduled_for` | INTEGER | | for one-off runs |
| `claimed_at` | INTEGER | | set when status flips to `running` |
| `completed_at` | INTEGER | | set on terminal status |
| `kill_requested_at` | INTEGER | | dashboard kill trigger |
| `extra_instructions` | TEXT | | trigger-time override appended to prompt |
| `session_id` | TEXT | | CLI session ID for resume |
| `session_cwd` | TEXT | | working dir captured for resume |
| `created_at` | INTEGER | NN | |
| `updated_at` | INTEGER | NN | |

Indexes: `idx_runs_job(job_id)`, `idx_runs_agent(agent_id)`, `idx_runs_status(status)`.

### `run_activity`
Ordered log of human/agent/system messages on a run.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | TEXT | PK | |
| `run_id` | TEXT | NN, FK → `runs(id)` (CASCADE) | |
| `author_type` | TEXT | NN, CHECK in (`agent`, `user`, `system`) | |
| `author_id` | TEXT | | |
| `author_name` | TEXT | | |
| `content` | TEXT | | |
| `created_at` | INTEGER | NN | |

Indexes: `idx_run_activity_run(run_id)`, `idx_run_activity_run_time(run_id, created_at)`.

### `run_output`
Streamed CLI events captured during execution. Backs the SSE stream at `/api/runs/:id/output/stream`.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | INTEGER | PK AUTOINCREMENT | monotonic; the SSE `?after=N` cursor |
| `run_id` | TEXT | NN, FK → `runs(id)` (CASCADE) | |
| `event_type` | TEXT | NN | `text_delta \| tool_start \| tool_end \| thinking \| info \| error \| result` |
| `content` | TEXT | | |
| `tool_name` | TEXT | | populated on `tool_*` events |
| `created_at` | INTEGER | NN | |

Index: `idx_run_output_run(run_id)`.

## Shared context

### `docs`
Top-level markdown documents. Linked to jobs via `job_docs`; pinned docs auto-attach to all new jobs.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | TEXT | PK | |
| `title` | TEXT | NN | |
| `pinned` | INTEGER | NN, default 0 | auto-attach toggle |
| `created_by_type` | TEXT | CHECK in (`user`, `agent`) | |
| `created_by_id` | TEXT | | |
| `created_at` | INTEGER | NN | |
| `updated_at` | INTEGER | NN | |

### `doc_revisions`
Append-only history. Newest row's `content` is the live body; older rows are diffable via `/api/docs/:id/revisions`.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | TEXT | PK | |
| `doc_id` | TEXT | NN, FK → `docs(id)` (CASCADE) | |
| `content` | TEXT | NN | full markdown snapshot |
| `author_type` | TEXT | CHECK in (`user`, `agent`) | |
| `author_id` | TEXT | | |
| `created_at` | INTEGER | NN | |

Index: `idx_doc_revisions_doc(doc_id)`.

### `databases`
Named registry of agent-managed SQLite tables (the underlying tables are siblings in the same DB).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | TEXT | PK | |
| `name` | TEXT | NN, U | display name |
| `table_name` | TEXT | NN, U | actual SQLite identifier |
| `created_at` | INTEGER | NN | |
| `updated_at` | INTEGER | NN | |

### `database_migrations`
Per-database DDL history (column additions, etc.).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | TEXT | PK | |
| `database_id` | TEXT | NN, FK → `databases(id)` (CASCADE) | |
| `version` | INTEGER | NN | monotonic |
| `description` | TEXT | | |
| `sql` | TEXT | NN | the executed DDL |
| `created_at` | INTEGER | NN | |

Index: `idx_database_migrations_db(database_id)`.

### `env_vars`
Encrypted key-value pairs (AES-256-GCM via `~/.harbour/encryption.key`).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | TEXT | PK | |
| `name` | TEXT | NN, U | env variable name |
| `encrypted_value` | TEXT | NN | `hex(iv):hex(tag):hex(ciphertext)` (12-byte IV, 16-byte tag) |
| `pinned` | INTEGER | NN, default 0 | auto-attach toggle |
| `created_at` | INTEGER | NN | |
| `updated_at` | INTEGER | NN | |

The plaintext is decrypted lazily inside `getDecryptedEnvVarsForJob()` and only travels in agent `/next` payloads.

### `settings`
Tiny key-value store. Keys include `timezone`, `signup_enabled`, `recent_runs_limit`, `captain_cli`, `captain_model`, `captain_thinking`, `captain_cwd`, `video_auto_process`, `video_screenshot_interval`, `video_transcript_provider`, `video_openai_api_key`, `video_gemini_api_key`.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `key` | TEXT | PK | |
| `value` | TEXT | NN | |

## Junctions (linking tables)

All composite PKs, all `ON DELETE CASCADE` on both sides.

| Table | A | B |
|---|---|---|
| `job_docs` | `job_id` → `jobs` | `doc_id` → `docs` |
| `job_databases` | `job_id` → `jobs` | `database_id` → `databases` |
| `job_env_vars` | `job_id` → `jobs` | `env_var_id` → `env_vars` |
| `project_agents` | `project_id` → `projects` | `agent_id` → `agents` |
| `project_jobs` | `project_id` → `projects` | `job_id` → `jobs` |
| `project_docs` | `project_id` → `projects` | `doc_id` → `docs` |
| `project_env_vars` | `project_id` → `projects` | `env_var_id` → `env_vars` |
| `project_databases` | `project_id` → `projects` | `database_id` → `databases` |

## Attachments and processing

### `run_attachments`
Files uploaded or embed URLs attached to a run. Holds either a file (storage_path) or an embed (url + provider).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | TEXT | PK | |
| `run_id` | TEXT | NN, FK → `runs(id)` (CASCADE) | |
| `activity_id` | TEXT | FK → `run_activity(id)` (SET NULL) | links attachment to the activity entry it landed with |
| `kind` | TEXT | NN, CHECK in (`file`, `embed`) | |
| `filename` | TEXT | | file kind |
| `storage_path` | TEXT | | relative to `uploadsDir()` |
| `mime_type` | TEXT | | |
| `size_bytes` | INTEGER | | |
| `url` | TEXT | | embed kind |
| `embed_provider` | TEXT | | `youtube \| loom \| vimeo \| ...` |
| `title` | TEXT | | |
| `uploaded_by_type` | TEXT | CHECK in (`user`, `agent`) | |
| `uploaded_by_id` | TEXT | | |
| `uploaded_by_name` | TEXT | | |
| `created_at` | INTEGER | NN | |

Indexes: `idx_run_attachments_run(run_id)`, `idx_run_attachments_activity(activity_id)`.

### `attachment_processing`
Tracks ffmpeg+whisper processing state for video attachments.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | TEXT | PK | |
| `attachment_id` | TEXT | NN, U, FK → `run_attachments(id)` (CASCADE) | one row per attachment max |
| `run_id` | TEXT | NN | denormalized for easy lookup |
| `status` | TEXT | NN, CHECK in (`queued`, `processing`, `done`, `failed`) | |
| `transcript_path` | TEXT | | relative to uploads dir |
| `screenshots_dir` | TEXT | | relative to uploads dir |
| `screenshot_count` | INTEGER | NN, default 0 | |
| `screenshot_interval` | INTEGER | | seconds between frames |
| `duration_seconds` | REAL | | |
| `error` | TEXT | | populated when `status='failed'` |
| `started_at` | INTEGER | | |
| `completed_at` | INTEGER | | |
| `created_at` | INTEGER | NN | |

Indexes: `idx_attachment_processing_attachment`, `idx_attachment_processing_run`.

## Captain

In-browser CLI chat. Server-side process manager spawns a CLI tool, streams output back via SSE.

### `captain_conversations`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | TEXT | PK | |
| `title` | TEXT | NN | |
| `cli` | TEXT | NN | `claude \| codex \| gemini` |
| `model` | TEXT | | |
| `thinking` | TEXT | | |
| `session_id` | TEXT | | CLI session for continuity |
| `cwd` | TEXT | | overrides default `~/.harbour/captain/` |
| `user_id` | TEXT | NN, FK → `users(id)` (CASCADE) | |
| `created_at` | INTEGER | NN | |
| `updated_at` | INTEGER | NN | |

Index: `idx_captain_conversations_user(user_id)`.

### `captain_messages`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | TEXT | PK | |
| `conversation_id` | TEXT | NN, FK → `captain_conversations(id)` (CASCADE) | |
| `role` | TEXT | NN, CHECK in (`user`, `assistant`) | |
| `content` | TEXT | NN, default `''` | accumulates as the response streams |
| `created_at` | INTEGER | NN | |

Index: `idx_captain_messages_conversation`.

### `captain_output`
Per-message stream events (text deltas, tool calls).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | INTEGER | PK AUTOINCREMENT | SSE cursor |
| `conversation_id` | TEXT | NN, FK → `captain_conversations(id)` (CASCADE) | |
| `message_id` | TEXT | FK → `captain_messages(id)` (CASCADE) | nullable |
| `event_type` | TEXT | NN | same vocabulary as `run_output` |
| `content` | TEXT | | |
| `tool_name` | TEXT | | |
| `created_at` | INTEGER | NN | |

Index: `idx_captain_output_conversation`.

## Admin

### `admin_api_keys`
Bearer keys that resolve to the **creator's** user identity for API auth.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | TEXT | PK | |
| `name` | TEXT | NN | |
| `api_key_hash` | TEXT | NN, U | sha256 hex |
| `created_by_user_id` | TEXT | NN, FK → `users(id)` (CASCADE) | |
| `last_used_at` | INTEGER | | |
| `created_at` | INTEGER | NN | |
| `updated_at` | INTEGER | NN | |

## Projects

### `projects`
Optional view-layer grouping. Entities don't know about projects; the five `project_*` junctions hold the references.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | TEXT | PK | |
| `name` | TEXT | NN | |
| `created_at` | INTEGER | NN | |
| `updated_at` | INTEGER | NN | |

Junction tables: see [Junctions](#junctions-linking-tables). Auto-link behavior — adding a job to a project also links its agent, docs, env vars, and databases — lives in `src/lib/db/projects.ts` (`linkJobToProject`).

## Handoffs

### `run_handoffs`

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `id` | TEXT | PK | UUID |
| `source_run_id` | TEXT | FK runs, SET NULL on delete | the run that initiated the handoff |
| `source_agent_id` | TEXT | FK agents, SET NULL on delete | |
| `target_agent_id` | TEXT | FK agents, SET NULL on delete | XOR with `target_team_id` at insert time |
| `target_team_id` | TEXT | FK teams, SET NULL on delete | |
| `target_role` | TEXT | nullable | preferred team role (e.g. `reviewer`) |
| `target_job_id` | TEXT | FK jobs, SET NULL on delete | the one-off job created for the handoff |
| `target_run_id` | TEXT | FK runs, SET NULL on delete | the new scheduled run created for the target |
| `message` | TEXT | NN | required free-text message |
| `source_run_name_snapshot` | TEXT | nullable | snapshot of source job name (preserved on source-run deletion) |
| `source_agent_name_snapshot` | TEXT | nullable | snapshot of source agent name |
| `status` | TEXT | NN, CHECK | one of `pending`, `accepted`, `completed`, `cancelled` |
| `created_at`, `updated_at` | INTEGER | NN | unix epoch |

Status transitions are driven by `updateRunStatus` against `target_run_id`:
- `pending → accepted` when the target run transitions to `running`
- `accepted → completed` when the target run reaches `done`
- No auto-transition on `failed`/`killed`/`skipped` (source operator can see something's off)

Indexes: `idx_run_handoffs_source(source_run_id)`, `idx_run_handoffs_target_run(target_run_id)`, `idx_run_handoffs_target_job(target_job_id)`.

## Workflows (Company OS)

Top-level pipelines of ordered steps with optional human approval gates. A workflow step, when its turn comes, creates a one-off job + run pair via the existing machinery; the only new runtime hook is in `updateRunStatusAsync` which calls `advanceWorkflowAfterRunAsync` on terminal status.

### `workflows`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | TEXT | PK | UUID |
| `name` | TEXT | NN | |
| `description` | TEXT | | |
| `department` | TEXT | | freeform tag (Sales, Engineering, …) |
| `status` | TEXT | NN, CHECK | `draft|active|paused|archived` |
| `autonomy_level` | TEXT | NN, CHECK | `manual|supervised|autonomous`, default `supervised` |
| `created_at`, `updated_at` | INTEGER | NN | |

### `workflow_steps`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | TEXT | PK | UUID |
| `workflow_id` | TEXT | NN, FK → `workflows(id)` CASCADE | |
| `step_order` | INTEGER | NN | sparse (10/20/30…) so reorder doesn't renumber |
| `name` | TEXT | NN | |
| `description` | TEXT | | |
| `instructions` | TEXT | NN | supports `{{input.key}}` substitution at workflow-start time |
| `assigned_agent_id` | TEXT | FK agents, SET NULL | XOR with `assigned_team_id` |
| `assigned_team_id` | TEXT | FK teams, SET NULL | |
| `preferred_role` | TEXT | | matches `jobs.preferred_role` |
| `role_fallback` | TEXT | NN, CHECK | `any|wait`, default `any` |
| `requires_human_approval` | INTEGER | NN | 0/1 — forces an approval gate regardless of autonomy |
| `approval_type` | TEXT | NN, CHECK | `none|before_step|after_step` |
| `risky` | INTEGER | NN | 0/1 — auto-set on create when instructions match risky keywords |
| `timeout_minutes` | INTEGER | NN | default 30 |
| `created_at`, `updated_at` | INTEGER | NN | |

### `workflow_runs`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | TEXT | PK | UUID |
| `workflow_id` | TEXT | NN, FK → `workflows(id)` CASCADE | |
| `status` | TEXT | NN, CHECK | `running|waiting_for_approval|done|failed|rejected` |
| `current_step_id` | TEXT | FK workflow_steps, SET NULL | null when terminal |
| `started_by_user_id` | TEXT | FK users, SET NULL | |
| `input_payload` | TEXT | | JSON string, optional inputs passed at start |
| `started_at`, `completed_at` | INTEGER | | |
| `created_at`, `updated_at` | INTEGER | NN | |

### `workflow_step_runs`

One per (workflow_run, step) pair. Links the workflow layer to the underlying `runs.id`.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | TEXT | PK | UUID |
| `workflow_run_id` | TEXT | NN, FK → `workflow_runs(id)` CASCADE | |
| `step_id` | TEXT | NN, FK → `workflow_steps(id)` CASCADE | |
| `step_order` | INTEGER | NN | denormalized for sort |
| `job_id` | TEXT | FK jobs, SET NULL | null until the step spawns |
| `run_id` | TEXT | FK runs, SET NULL | null until the step spawns; carries the underlying run |
| `status` | TEXT | NN, CHECK | `pending|waiting_approval_before|running|waiting_approval_after|done|failed|skipped|rejected|needs_changes` |
| `approval_user_id` | TEXT | FK users, SET NULL | |
| `approval_at` | INTEGER | | |
| `approval_comment` | TEXT | | for `needs_changes`, also stores reviewer's extra instructions appended on resume |
| `created_at`, `updated_at` | INTEGER | NN | |

### `workflow_run_activity`

Append-only audit log for the workflow-level actions that don't naturally belong on the underlying `runs.activity` thread.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | TEXT | PK | UUID |
| `workflow_run_id` | TEXT | NN, FK → `workflow_runs(id)` CASCADE | |
| `step_run_id` | TEXT | FK workflow_step_runs, SET NULL | nullable for workflow-level entries (start/finish/comments) |
| `author_type` | TEXT | NN | `user`/`system` |
| `author_id`, `author_name` | TEXT | | |
| `kind` | TEXT | NN, CHECK | `comment|approve|reject|request_changes|status|start|finish` |
| `content` | TEXT | | |
| `created_at` | INTEGER | NN | |

Indexes: `idx_workflow_steps_workflow(workflow_id, step_order)`, `idx_workflow_runs_workflow(workflow_id)`, `idx_workflow_runs_status(status)`, `idx_workflow_step_runs_workflow_run(workflow_run_id, step_order)`, `idx_workflow_step_runs_run(run_id)`, `idx_workflow_run_activity_run(workflow_run_id, created_at)`.

## Autonomy & approvals

Declarative policies layered over the per-agent permission system. A single global "Default Safety Policy" is seeded on first init; scope-specific policies (agent / team / workflow / department) take priority in that order.

### `autonomy_policies`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | TEXT | PK | UUID, except the seeded global policy uses `ap_default_global` |
| `name` | TEXT | NN | Display name |
| `description` | TEXT | | |
| `scope_type` | TEXT | NN, CHECK | `global|department|workflow|agent|team` |
| `scope_id` | TEXT | | null for `global`; freeform string for `department`; FK-style id for the others (not enforced) |
| `enabled` | INTEGER | NN, default 1 | 0 = ignored at resolution time |
| `created_at`, `updated_at` | INTEGER | NN | |

### `policy_rules`

One rule per (policy, action_type). Unique constraint on the pair so upserts are idempotent.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | TEXT | PK | UUID |
| `policy_id` | TEXT | NN, FK → `autonomy_policies(id)` CASCADE | |
| `action_type` | TEXT | NN | One of: `send_email`, `send_message`, `contact_customer`, `spend_money`, `deploy_code`, `merge_pr`, `delete_data`, `modify_production`, `use_secret`, `external_api_call`, `create_handoff`, `update_status`, `custom` |
| `risk_level` | TEXT | NN, CHECK | `low|medium|high|critical` |
| `require_approval` | INTEGER | NN, default 0 | 1 = block; 0 = allow |
| `max_cost_usd` | REAL | | Spend ceiling, only meaningful for `spend_money`. Null = no cap |
| `allowed_roles` | TEXT | | JSON-encoded array of `UserRole`s permitted to initiate (advisory) |
| `approval_roles` | TEXT | | JSON-encoded array of `UserRole`s permitted to approve (falls back to `approveAutonomy`) |
| `created_at`, `updated_at` | INTEGER | NN | |

Unique: `(policy_id, action_type)`.

### `approval_requests`

Pending and resolved approval records. Created automatically by the workflow gate, the cost-ceiling alert, and the api-agent tool gate.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | TEXT | PK | UUID |
| `source_type` | TEXT | NN, CHECK | `run|workflow_run|workflow_step|tool_call|cost` |
| `source_id` | TEXT | NN | Refers to the corresponding `runs.id` / `workflow_runs.id` / `workflow_step_runs.id` (not enforced via FK to allow soft deletes) |
| `requested_by_agent_id` | TEXT | FK → `agents(id)` SET NULL | |
| `action_type` | TEXT | NN | Same enum as `policy_rules.action_type` |
| `risk_level` | TEXT | NN | Snapshot from the matching rule |
| `reason` | TEXT | | Human-readable explanation; rendered in the approvals UI |
| `payload_json` | TEXT | | JSON snapshot of relevant inputs (tool args, step info, cost figure) |
| `status` | TEXT | NN, CHECK, default `pending` | `pending|approved|rejected|expired` |
| `approved_by_user_id` | TEXT | FK → `users(id)` SET NULL | |
| `approval_comment` | TEXT | | |
| `created_at`, `resolved_at` | INTEGER | NN/nullable | |

Indexes: `idx_autonomy_policies_scope(scope_type, scope_id, enabled)`, `idx_policy_rules_policy(policy_id)`, `idx_approval_requests_status(status, created_at)`, `idx_approval_requests_source(source_type, source_id)`.

## FK graph

```
users ─────── sessions
   ├──── admin_api_keys
   └──── captain_conversations ──── captain_messages ──── captain_output

agents ──── jobs ──── runs ──── run_activity ──── run_attachments (via activity_id)
                       │           │                ↑
                       │           └── run_output   │
                       │                            │
                       └────────── run_attachments ─┘

docs ─── doc_revisions          databases ─── database_migrations
   │                                │
   └── job_docs ─── jobs            └── job_databases ─── jobs

env_vars ─── job_env_vars ─── jobs

projects
   ├── project_agents ──── agents
   ├── project_jobs ────── jobs
   ├── project_docs ────── docs
   ├── project_env_vars ── env_vars
   └── project_databases ─ databases

attachment_processing ─ run_attachments
```

## Notable invariants

- **Polling-ladder atomicity.** The claim sequence inside `getAgentNextRun` and `getNextWorkflowRun` runs as one `db.transaction`.
- **One-of-a-kind processing record.** `attachment_processing.attachment_id` is `UNIQUE` — a re-process deletes the old row first.
- **Agentless jobs.** When `workflow_only=1`, `agent_id` may be NULL on both `jobs` and `runs`. Picked up by `/api/workflows/next`.
- **Env var encryption.** Plaintext never lands in the DB. The encryption key is read from `HARBOUR_ENCRYPTION_KEY` or auto-generated at `~/.harbour/encryption.key`.
- **Schedule normalization.** Non-JSON legacy schedule strings are coerced to canonical JSON during initialization (`src/lib/db/schema.ts:441-451`).

## Migrations

`schema.ts` follows three sections in order, all triggered by a single `initializeSchema(db)` call from `getDb()` on first use:

1. **`db.exec(...)` of `CREATE TABLE IF NOT EXISTS ...`** — idempotent table and index creation. This block describes the **target shape**; running it on an empty DB creates everything from scratch.
2. **Procedural ALTER blocks** — additive column adds (e.g. `agents.cli`, `jobs.workflow_only`) and CHECK-constraint changes (rebuilding `runs` to add `'pending'`, `'scheduled'`, `'killed'` over time). Each block guards itself with a `PRAGMA table_info` lookup or `sqlite_master.sql LIKE` test, so re-running is a no-op.
3. **Backfills** — ensure encryption key is initialized, ensure `timezone` and `signup_enabled` settings exist.

There is no separate migrations folder; the function above is the only migration runner. New schema changes go in as additional ALTER blocks — pattern: read `PRAGMA table_info`, branch on the column's existence, run the ALTER inside the same `initializeSchema` pass.
