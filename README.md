# Harbour

A control plane for AI agents doing ongoing work.

![Harbour Dashboard](public/screenshot.png)

> I do AI consulting for agencies and busy professionals — helping teams get real, ongoing work out of agents without it becoming a second full-time job. Always happy to hop on a call and figure out how I can be helpful: [gavin@geekforbrains.com](mailto:gavin@geekforbrains.com).

## Why

AI agents can handle real, ongoing responsibilities — marketing, support, dev. They post content, triage tickets, manage campaigns, submit PRs. Most of this runs on recurring schedules.

The problem is visibility. What jobs does each agent have? What ran today? What needs my attention? What broke?

Harbour is the layer underneath your agents — managing what recurring work each has, giving them shared context through docs and data, and surfacing the things that need you.

## How It Works

Harbour is a polling-based control plane. It never calls out to agents — they pull work on their own schedule.

**Jobs** are recurring responsibilities with a schedule, instructions, and references to docs, data, and env vars. When a job fires, it creates a **run**. Jobs come in two flavors: **agent jobs** where an AI agent does the work, and **workflow jobs** where a shell command handles everything — no LLM involved. A job can also combine both: a workflow runs first as a gate, and the agent only fires if the workflow exits successfully. Agents poll for runs, do the work, post updates, and set a final status — or set it to **waiting** if they need human input.

**Docs** are shared markdown documents (brand guidelines, processes, strategy) injected into runs automatically. **Databases** are SQLite tables agents create and manage through the API, also injected into runs. **Env Vars** are encrypted key-value pairs (API keys, tokens) decrypted and injected at runtime.

### The `/next` Endpoints

Agent jobs are discovered through `GET /api/agents/:id/next`. The response bundles everything: run context, job instructions, docs, database rows, env vars, and an `api` section with pre-resolved endpoints and status options for the run. Agents use `?peek=true` to check for work without claiming it.

Workflow-only jobs that have no agent are discovered through `GET /api/workflows/next`. The harbour runner polls both endpoints automatically.

## Designing Your Agent Team

By default each agent processes one run at a time. This is the safe default — coding agents writing to a shared workspace can collide if you let two runs touch the same files at once. There are three knobs for going beyond that:

- **Per-project agents.** Create `ProjectA Developer`, `ProjectB Developer`, etc., so work on different projects runs in parallel. Each has its own prompt, model, thinking level, and repo context. Use the **Projects** feature to filter the sidebar down to whatever you're focused on.
- **Per-agent concurrency (optional).** Each agent has a `max_concurrent_runs` setting (default 1, capped at 10). Raise it and the runner will spawn up to N runs in parallel. When concurrency > 1, each run gets its own working directory at `~/.harbour/workspaces/<agent>/runs/<runId>/` and its own session file — siblings cannot stomp on each other. Recommended setting: **1 for repo-modifying coding agents**; higher for stateless text-only agents (summarizers, classifiers, draft writers).
- **Teams (optional).** Group multiple agents under a Team. Jobs can be assigned to a team rather than a single agent; whichever team member has capacity claims it. Each team membership carries a **role** (`Researcher`, `Builder`, `Reviewer`, `Debugger`, or a custom label). A team job can request a `preferred_role` plus a `role_fallback` of `any` (let non-matching members claim once specialists are saturated) or `wait` (queue until a matching role frees up). See [docs/concepts/teams.md](docs/concepts/teams.md) for the full model.

Docs, env vars, and databases are top-level and can be linked to any number of jobs across agents, so duplicating agents per project mostly means duplicating prompt/model config — not your shared knowledge base.

> **Risks of high concurrency.** Each concurrent run is an independent LLM session — costs scale linearly. Coding agents sharing a repo or shell environment can corrupt each other's work even with per-run cwds (think: shared git index, package managers, ports). Keep coding-agent concurrency at 1 unless you've explicitly isolated each run's environment.

## Getting Started

### With Docker (recommended)

Only requirement is Docker.

```bash
git clone https://github.com/geekforbrains/harbour.git
cd harbour
make run
```

Visit [http://localhost:3030](http://localhost:3030) and create your first account. All state (DB, uploads, encryption key) lives in `./data` — back up that directory and you have a snapshot of everything.

```bash
make logs     # follow logs
make down     # stop the container
make rebuild  # rebuild image and restart (after code changes)
make clean    # stop and wipe ./data (destructive)
```

To simulate a remote-runner setup end-to-end (see [Running the runner on a different machine](#running-the-runner-on-a-different-machine)), add the `remote` profile:

```bash
docker compose --profile remote up -d
```

This brings up a second container (`harbour-remote`) that polls the server and acts as if it were a separate machine. Useful for testing the connect flow locally before pointing a real Mac/Linux box at your harbour.

### Without Docker

```bash
git clone https://github.com/geekforbrains/harbour.git
cd harbour
npm install
npm run build
npm start
```

Visit [http://localhost:3000](http://localhost:3000) and create your first account.

### Deploy to DigitalOcean

Terraform config for a single-droplet deployment (Ubuntu + Caddy + Let's Encrypt + HTTP Basic Auth, running Harbour directly as a systemd service) lives in [`terraform/`](terraform/README.md). One `terraform apply` spins up a production-ready box in ~5 minutes.

### Updating

When Harbour is running under launchd on macOS, rebuilding in place leaves the running server referencing chunks that get replaced mid-build — pages render unstyled until the server restarts. Use the release script to rebuild and bounce the whole local stack:

```bash
npm run release
```

The script stops `com.harbour.server`, rebuilds, starts it back up, and then restarts `com.harbour.agent-runner` so it picks up any changes under `bin/`. If the agent-runner isn't installed, it's skipped. macOS only today; Linux/systemd support will land alongside a systemd install path.

### Harbour Agents

Built-in support for running agents via [Claude Code](https://claude.ai/claude-code), [Codex](https://github.com/openai/codex), [Gemini CLI](https://github.com/google-gemini/gemini-cli), or a **Custom Shell Agent** (any command you write — see below). A local runner polls for work, spawns your CLI tool, streams output to the dashboard, and posts the result as run activity.

1. Dashboard → **New Agent** → select **Harbour Agent** and pick your CLI tool
2. Name it, pick a model and thinking/effort level, create a job with a schedule and instructions
3. Install the runner:

```bash
npm run harbour -- agent install
```

The install command auto-detects your OS:

- **macOS** — writes a launchd plist to `~/Library/LaunchAgents/com.harbour.agent-runner.plist` and `launchctl load`s it. Logs at `~/.harbour/runner.log` / `runner.err.log`. Tail with `tail -f ~/.harbour/runner.log`.
- **Linux** — writes a user-level systemd service + timer to `~/.config/systemd/user/harbour-agent-runner.{service,timer}` and `systemctl --user enable --now`s the timer. View logs with `journalctl --user -u harbour-agent-runner.service -f`. On a headless server, enable lingering so user services keep running after logout: `loginctl enable-linger $USER`.
- **Other platforms** — the install command refuses with a clear error. Run the loop manually with `npm run harbour -- agent run` from cron or your supervisor of choice.

Either way the runner polls every 60 seconds. All configured agents and agentless workflow jobs run concurrently.

```bash
npm run harbour -- agent list        # show configured agents
npm run harbour -- agent run         # manual poll (useful for testing)
npm run harbour -- agent status      # is the runner installed + active?
npm run harbour -- agent uninstall   # stop the runner
```

The runner injects the Harbour API credentials and endpoints into each prompt, so harbour agents can set run status (`done`, `waiting`, `failed`), post activity messages, and manage docs and databases — just like external agents. If an agent doesn't set a final status, the runner marks the run as failed. Stuck or misdirected runs can be killed from the dashboard — comment on a killed run to resume the CLI session where it left off.

Model and thinking/effort levels can be set per agent (default) and overridden per job — letting you use a lighter model for routine tasks and a heavier one for complex work.

#### Polling interval

The runner polls every **60 seconds** by default. Configure with the CLI or the dashboard:

```bash
npm run harbour -- agent interval        # show current
npm run harbour -- agent interval 15     # set to 15s
```

Or open **Settings → Runner polling interval** in the dashboard. Range: 5–3600 seconds. Below 15s, both surfaces print a warning — every poll spawns the runner and may invoke the LLM, so cost scales linearly with frequency.

The interval governs cold polls only. **Eager polling** (per-agent toggle, see below) still kicks in immediately after a clean run completes, so a fast cadence + eager mode drains backlogs the fastest.

Changes apply on the next `agent install`. The interval is stored at `~/.harbour/runner-config.json` per machine — when you operate a runner on a different host, set the interval there with the CLI.

#### Eager polling

By default the runner pauses 60 seconds between runs, even when there's a backlog of pending work. Toggle **Eager polling** on a harbour agent to drain the queue without that pause: when a run finishes cleanly (`done`, `waiting`, or `skipped`), the runner immediately polls for another run instead of waiting for the next launchd tick. As soon as the queue empties, the agent falls back to the normal 60s cadence.

A failed or killed run breaks the eager loop — failures are most often transient (network, rate limits, timeouts), so the 60s gap acts as a free backoff. Eager mode trades latency for cost: stacking many LLM-driven runs back-to-back burns budget faster than the natural pacing. Off by default; enable per-agent in the agent's settings.

#### Custom Shell Agent

Any CLI tool, local LLM, or orchestration script can become a Harbour agent. Pick **Custom Shell** when creating a new harbour agent and supply:

- **Shell command** — runs under `sh -c '…'`. Required.
- **Working directory** — optional; defaults to the agent's workspace dir.
- **Display label** — optional cosmetic name shown in the dashboard where models normally appear.

How it works:

- Harbour pipes the run's full prompt (instructions + docs + db rows + extra context) to your command's **stdin**. Read it with `cat`, `read`, or whatever your runtime exposes.
- Your stdout and stderr stream back to Harbour as run output — visible live on the run detail page.
- If your command exits non-zero, Harbour marks the run `failed` automatically.
- If you don't set a final status before exit, Harbour's failsafe also marks the run `failed`. To finish cleanly, call the Harbour API yourself.

Four env vars are injected so your script can talk back to Harbour without extra wiring:

| Variable | Value |
|---|---|
| `HARBOUR_URL` | base URL, e.g. `http://localhost:3000` |
| `HARBOUR_API_KEY` | the agent's API key (the same one external agents use) |
| `HARBOUR_AGENT_ID` | the polling agent's id |
| `HARBOUR_RUN_ID` | the current run's id |
| `HARBOUR_JOB_ID` | the current job's id |

Minimal working script:

```sh
#!/usr/bin/env bash
set -euo pipefail
prompt="$(cat)"
reply="$(curl -s https://my-llm.example/chat -d "$prompt")"
echo "$reply"
# Post the result as activity and mark the run done
curl -s -X POST -H "Authorization: Bearer $HARBOUR_API_KEY" \
  -H "Content-Type: application/json" \
  "$HARBOUR_URL/api/runs/$HARBOUR_RUN_ID/activity" \
  -d "$(jq -nc --arg c "$reply" '{content: $c}')"
curl -s -X PUT -H "Authorization: Bearer $HARBOUR_API_KEY" \
  -H "Content-Type: application/json" \
  "$HARBOUR_URL/api/runs/$HARBOUR_RUN_ID/status" \
  -d '{"status":"done"}'
```

⚠ **Security:** the command runs with the runner's full privileges. Anyone who can edit the agent in the dashboard can run anything on the host. Only configure Custom Shell agents with commands you fully trust.

#### Permission modes

Every harbour agent runs in one of three permission modes: `safe`, `custom`, `unrestricted`. What each mode actually enforces depends on the provider, because the providers have very different safety stories.

| Provider | Native permissions | Harbour safe mode |
|---|---|---|
| **Claude Code** | Yes — `.claude/settings.json` allow/deny rules + hooks | Harbour materializes a deny-list `settings.json` in the workspace and Claude enforces it |
| **Codex / Gemini / Custom Shell** | None | Harbour-level **soft sandbox**: shim PATH wrappers block `rm`, `sudo`, `chmod`, `chown`, `ssh`, `scp`, and `curl` with `Authorization` headers. Not a true sandbox — see caveats below |
| **API agent** (DeepSeek / Kimi / OpenAI-compatible) | No shell at all | The model can only call Harbour HTTP tools you've enabled in tool permissions |

New Claude and API agents default to `safe`. Codex, Gemini, and Custom Shell default to `unrestricted` — you have to opt them into the soft sandbox explicitly because that protection is best-effort. Existing agents migrated from before this feature stay on `unrestricted` so nothing breaks.

##### Safe mode by provider

**Claude Code.** Harbour writes `~/.harbour/workspaces/<agent>/.claude/settings.json` with a default deny-list (`rm -rf`, `sudo`, `chmod`, `chown`, `ssh`, `scp`, `curl` with auth headers, and reads of `.env*`, `~/.ssh/`, `~/.harbour/encryption.key`/`runners.json`/`harbour.db`). `permissions.defaultMode` is `"dontAsk"` so anything outside the allow-list is auto-denied — required for non-interactive `-p` runs. The file is materialized once and never overwritten, so your edits stick.

**Codex, Gemini, Custom Shell.** These CLIs don't have a permission system Harbour can plug into. Safe mode here means:
- Harbour installs shim scripts at `~/.harbour/safe-shims/` for `rm`, `sudo`, `chmod`, `chown`, `ssh`, `scp`, and `curl`. Each shim exits non-zero with a `harbour-safe-mode: <cmd> is denied — switch to unrestricted mode if you need this` message.
- The runner prepends `<workspace>/bin/:~/.harbour/safe-shims/:` to PATH so when the CLI tries to spawn `rm`, the shim runs and the action fails visibly.
- **This is a soft sandbox.** An LLM that calls `/bin/rm` by absolute path, shells through `python -c`, or sets PATH itself can still escape. We catch the common case of Codex/Gemini emitting raw bash commands; we don't pretend to do more. If you need real isolation, run the runner inside Docker, `sandbox-exec`, or `firejail`.

**API agents.** No shell exists. The runner connects to your OpenAI-compatible endpoint (DeepSeek, Kimi, OpenAI, anything that speaks `chat/completions`) and gives the model a function-calling spec built from the agent's tool permissions. The model can post activity, read/write docs, read/write databases, read job env vars, set status, and hand off — and nothing else. Safe mode pre-selects a minimal tool set; you can toggle individual tools in the agent's settings.

**Custom mode** keeps the same mechanism as Safe but defaults tool permissions to all-on for the explicit "I'm doing something specific, tune the knobs yourself" case. **Unrestricted** runs with no shims and (for Claude) `--dangerously-skip-permissions`. The agent detail page shows a "Switch to Safe" callout on unrestricted Claude agents so flipping back is one click.

##### Tool permissions

Every agent has ten per-endpoint permission flags, enforced **server-side** with a 403 response when a denied call comes in:

| Tool | Endpoint gated |
|---|---|
| `read_docs` | `GET /api/docs`, `GET /api/docs/:id` |
| `write_docs` | `POST/PUT/DELETE /api/docs[/:id]` |
| `read_databases` | `GET /api/databases`, `GET /api/databases/:id/rows` |
| `write_databases` | `POST /api/databases`, `POST /api/databases/:id/rows` |
| `read_env_vars` | API-agent only; reads job-linked env vars from within the agent process |
| `create_runs` | `POST /api/runs` |
| `create_handoffs` | `POST /api/runs/:id/handoff` |
| `post_activity` | `POST /api/runs/:id/activity` |
| `update_status` | `PUT /api/runs/:id/status` |
| `use_shell` | Informational — whether the agent's CLI is expected to spawn shell subprocesses |

The `api` block in `/api/agents/:id/next` lists only the endpoints the agent may use, so an external agent reading the payload sees an honest contract. Existing agents migrate with every permission **on** (backwards compat); new agents pick defaults from their mode.

**Settings → Security** surfaces the four risks Harbour can detect: agents in unrestricted mode, safe/custom Claude agents with a broken `settings.json`, name-slug workspace collisions, and safe-mode agents that nonetheless have `can_use_shell` or `can_read_env_vars` flipped on.

#### Running the runner on a different machine

Sometimes a job needs to run on a specific machine — iOS/Xcode builds on a Mac, GPU work on a workstation — while the harbour server lives elsewhere. Harbour supports this by letting you mark an agent as **remote**: harbour won't install a local runner for it, and you run the runner on the target machine instead.

1. On harbour, **New Agent** → Harbour Agent → pick a CLI → enable **"Run on a different machine"** → Create. Copy the `harbour agent connect <blob>` command.
2. On the remote machine, clone harbour and install dependencies:
   ```bash
   git clone https://github.com/geekforbrains/harbour.git
   cd harbour
   npm install
   ```
3. Paste the command on the remote machine:
   ```bash
   npm run harbour -- agent connect <blob>
   ```
   The CLI decodes the blob, verifies it can reach harbour with the API key, and writes an entry to `~/.harbour/runners.json`.
4. Schedule polling the same way as local agents: `npm run harbour -- agent install`. The install command auto-detects the host OS — macOS uses launchd, Linux uses a user-level systemd timer (and `loginctl enable-linger $USER` on headless servers).

The blob contains the agent's API key — treat it like a password. If it's ever lost or leaked, open the agent detail page, click the **Connect Remote Runner** button, and generate a new command (rotates the key).

**Two caveats worth knowing:**
- **Reachability.** The remote machine must be able to reach harbour at the URL embedded in the blob. Tailscale or any private-mesh tool works well for home setups; otherwise expose harbour behind whatever you normally use for remote HTTP.
- **Workflow scripts run locally.** If the agent's jobs use a workflow gate (shell command), that script must live at `~/.harbour/workflows/` on the remote machine, not on the harbour server. Keep the scripts in a git repo and sync as you would any other dotfile.

Remote runners skip the agentless workflow-only poll (`/api/workflows/next`) — those jobs stay with whichever runner is co-located with the harbour server.

### External Agents

Any tool that can poll an HTTP endpoint works — [OpenClaw](https://openclaw.ai), custom scripts, or any agent framework.

1. Dashboard → **New Agent** → select **External** to get an API key
2. Create a job with a schedule and instructions
3. Copy the invite text into your agent's system prompt

The invite includes credentials and the polling loop. The `/next` endpoint provides everything the agent needs, including the API reference for the current run.

## Admin API Keys

Admin API keys give external agents full management access to Harbour — creating agents, jobs, runs, docs, databases, env vars, and modifying settings. This is how you let a separate AI assistant help you operate Harbour remotely.

1. Dashboard → **Settings** → **Admin API Keys** → **New Key**
2. Name it, copy the invite text (includes key, URL, and bootstrap instructions)
3. Paste the invite into your management agent's conversation

The invite tells the agent to fetch `GET /api/admin-guide` with its key, which returns the full admin API reference. Admin keys resolve to the creating user's identity for audit trails.

Admin API documentation is served at `/api/admin-guide` and maintained in [ADMIN_GUIDE.md](ADMIN_GUIDE.md).

## User roles

Every Harbour user has one of three roles. Existing users become **admin** on migration so nobody is locked out.

- **admin** — full access. Manages users, admin API keys, global settings, env-var plaintexts. Can do anything operators and viewers can do.
- **operator** — runs the day-to-day work. Create / edit / delete agents, jobs, docs, databases, projects, teams; trigger / retry / kill runs; comment on runs. Cannot manage users, admin keys, global settings, or reveal env-var plaintexts.
- **viewer** — read-only. Sees the same dashboard pages as everyone else but every create / edit / delete button is hidden. Cannot reveal env-var plaintexts, trigger runs, comment, or change settings.

Admins change a user's role from **Users** in the dashboard, or via:

```
PUT /api/users/<id>
Authorization: Bearer <admin-api-key>
Content-Type: application/json

{"role": "operator"}
```

Harbour blocks demoting (or deleting) the **last admin** and blocks self-delete. **Agent** callers and **admin API key** callers bypass the role checks: agents are scoped per-resource by API key, and admin keys carry their creator's role.

## Agent API

```
GET  /api/agents/:id/next           — get next agent run (or nothing)
GET  /api/agents/:id/next?peek=true — check for work without claiming it
GET  /api/workflows/next            — get next agentless workflow run (runner only)
POST /api/jobs                      — create a workflow-only job (no agent)
PUT  /api/runs/:id/status           — update run status
POST /api/runs/:id/activity         — add to the run's activity log
POST /api/runs/:id/retry            — retry a failed/skipped/killed run
POST /api/runs/:id/kill             — kill a running harbour-agent run
DELETE /api/runs/:id                — delete a run and its attachments
POST /api/runs/:id/attachments      — upload a file or attach an embed URL
GET  /api/runs/:id/attachments/:aid/file — download an uploaded file
POST /api/docs                      — create a doc
PUT  /api/docs/:id                  — update a doc
POST /api/databases                 — create a database
POST /api/databases/:id/rows        — insert rows
GET  /api/databases/:id/rows        — read rows (paginated)
GET  /api/guide                     — full API guide
```

Full API documentation is served at `/api/guide` and maintained in [GUIDE.md](GUIDE.md).

## Run Lifecycle

```
scheduled → running → done
                    → failed
                    → killed (harbour agent stopped mid-run)
                    → skipped (workflow determined nothing to do)
                    → waiting (needs human) → pending (human responded) → running → ...
```

Failed, skipped, and killed runs can be retried from the dashboard — the run goes back to `pending` and the agent picks it up on next poll. Killed runs can also be resumed via comment, continuing the CLI session where it left off.

## Workflows (Company OS)

Workflows turn Harbour from "one agent does one job on a schedule" into a place where you can model **repeatable business processes**: lead intake → research → draft outreach → human review → send. Each workflow is an ordered list of steps; each step routes to an agent or team and can pause for human approval before or after running.

**Building blocks:**

- **Workflow** — top-level definition (name, department, status, autonomy level).
- **Steps** — ordered. Each step has instructions, an assignment (single agent OR team + preferred role), and approval settings.
- **Autonomy level** (per workflow):
  - `manual` — human approves every step.
  - `supervised` (default) — human approves risky steps and steps explicitly marked `requires_human_approval`.
  - `autonomous` — only steps explicitly requiring approval pause; everything else runs.
- **Risky** — a per-step flag. Auto-checked when the instructions contain keywords like `send email`, `deploy`, `delete`, `production`, `pay`, `refund`. Drives the supervised-mode gating decision. The user can always toggle it.

**Lifecycle:**

1. User clicks **Start** (optionally passing a JSON input). Harbour creates a `workflow_run` row and the first `workflow_step_run`.
2. Each step that's ready spawns a one-off job + run using the existing agent/team routing. The runner picks it up identically to any other run — nothing changes about how agents execute work.
3. When the run reaches `done`, Harbour's `updateRunStatus` hook advances the workflow: either start the next step, or pause for after-step approval.
4. A human reviewer sees the waiting workflow run in **Workflows → (run)**, with **Approve**, **Reject**, **Request Changes** buttons. Request-changes appends reviewer feedback to the step's instructions and re-runs it.
5. Reject terminates the workflow run. Done after the last step completes.

**Examples** (replicate as workflows in your install — no template registry, just blank workflows you fill in):
- Sales lead pipeline: research lead → draft outreach (after-step approval) → send email (before-step approval).
- Support triage: classify ticket → search KB → propose response (after-step approval) → reply.
- Bug fix pipeline: research the report → propose a fix (after-step approval) → write the patch → run tests.
- Content production: outline → draft (after-step approval) → publish (before-step approval).

Workflows live at `/workflows`. Workflow run progress views live at `/workflow-runs/<id>` and link to the underlying `/runs/<id>` pages for live agent logs. The full execution model + risky-keyword list are in [`docs/concepts/workflows.md`](docs/concepts/workflows.md).

## Shell workflow jobs

Independent of the workflow feature above, Harbour jobs can also have a **deterministic shell pre-step** (or be entirely shell-only, with no LLM at all). A shell-workflow job runs a command via `~/.harbour/workflows/`:

| Mode | Config | What happens |
|------|--------|-------------|
| Agent only | No workflow command | Agent runs as normal |
| Workflow + Agent | Workflow command, workflow_only off | Workflow runs first as a gate. Exit 0 = agent runs with stdout as context. Exit 77 = skip. Other = fail. |
| Workflow only | Workflow command, workflow_only on | Workflow is the entire job. No agent, no LLM. Exit 0 = done. Exit 77 = skip. Other = fail. |

Workflow-only jobs don't require an agent — they're standalone scheduled commands. The runner receives the full run payload (JSON) on stdin.

```bash
# Example: workflow-only job that checks an API
# workflow_command: python3 check_health.py
```

## Projects

Projects are an optional way to organize your work. They're a view layer — a bag of references to agents, jobs, docs, env vars, and databases. They don't own anything; entities live at the top level and can belong to multiple projects (or none).

- Create projects from the sidebar dropdown (desktop) or the header (mobile)
- Switch between projects to filter all pages, or view "All Projects" to see everything
- When viewing a project, "Add Existing" buttons let you attach existing items
- Creating new items while in a project auto-links them
- Adding a job to a project auto-links its agent, docs, env vars, and databases
- Manage projects (rename, delete) in Settings while viewing a project
- Deleting a project only removes the grouping — nothing else is affected

## Captain

![Captain](public/screenshot-captain.png)

**Captain** is an in-browser chat with a CLI tool (Claude Code, Codex, or Gemini CLI) that runs server-side and streams output back over SSE — your operator's console for the harbour itself. Ask it to summarize what ran today, query the database, debug a stuck job, or set up a new agent without leaving the dashboard.

- Multi-conversation with session continuity. Stop a response mid-stream; old conversations stay resumable.
- Tool calls render as collapsible blocks alongside the assistant's text so you can see what was actually run.
- Workspace at `~/.harbour/captain/` is auto-provisioned on first use with a `CLAUDE.md` describing Harbour's schema, API endpoints, and key paths. `AGENTS.md` and `GEMINI.md` symlink to the same file so all three CLIs share one knowledge base — and you can customize it (Captain never overwrites).
- Pick CLI tool, model, thinking/effort level, and override the working directory in **Settings**.

## Dashboard

- **Captain** — in-browser chat with a local CLI tool (see above) for managing the harbour.
- **Runs** — running, scheduled, waiting, pending, and recent runs. Create one-off runs or recurring jobs from a unified dialog.
- **Jobs** — split into Agent Jobs and Workflow Jobs. Shows run/skip counts, schedules, and linked docs/env vars.
- **Agents** — list of agents with jobs, activity, and poll status. Harbour agents show CLI tool, model, and thinking level.
- **Docs** — shared knowledge base, editable by humans and agents. Pin docs to auto-attach to all new jobs.
- **Databases** — read-only view of agent-managed SQLite tables.
- **Env Vars** — encrypted variables (API keys, tokens) injected at runtime. Pin to auto-attach to all new jobs.
- **Settings** — system timezone, signup control, project management, Captain configuration, and admin API keys.

Available as a PWA — add to your home screen on mobile for a native app experience.

## Documentation

Long-form docs live in [`docs/`](docs/). The index ([docs/README.md](docs/README.md)) groups them into:

- **Concepts** — [agents](docs/concepts/agents.md), [jobs and runs](docs/concepts/jobs-and-runs.md), [workflows](docs/concepts/workflows.md), [projects](docs/concepts/projects.md), [shared context](docs/concepts/shared-context.md), [Captain](docs/concepts/captain.md), [attachments](docs/concepts/attachments.md)
- **Guides** — [getting started](docs/guides/getting-started.md), [running on a different machine](docs/guides/run-on-different-machine.md), [deploying to production](docs/guides/deploy-to-production.md)
- **Reference** — [architecture](docs/reference/architecture.md), [database schema](docs/reference/database-schema.md), [API overview](docs/reference/api.md)

The two wire-contract documents are [GUIDE.md](GUIDE.md) (agent-facing, served at `/api/guide`) and [ADMIN_GUIDE.md](ADMIN_GUIDE.md) (admin-agent-facing, served at `/api/admin-guide`). Those are the source of truth for what's on the wire.

## Tech Stack

Next.js (App Router), SQLite (better-sqlite3), Tailwind / shadcn/ui, TypeScript. Single binary-style deployment — no external database, no Redis, no background workers. Just `npm start`.

## Environment Variables

All Harbour state lives under `~/.harbour` by default — DB, uploads, encryption key, runner config. Back up that directory and you have a snapshot of everything.

| Variable | Description | Default |
|----------|-------------|---------|
| `HARBOUR_HOME` | Root directory for all Harbour state | `~/.harbour` |
| `HARBOUR_DB_PATH` | SQLite database file path | `<HARBOUR_HOME>/harbour.db` |
| `DATABASE_URL` | Optional Postgres connection string (e.g. `postgres://user:pass@host:5432/harbour`). When set, Harbour uses Postgres instead of SQLite. Leave unset for the default SQLite experience. | _(unset — uses SQLite)_ |
| `HARBOUR_UPLOADS_DIR` | Run attachments directory | `<HARBOUR_HOME>/uploads` |
| `HARBOUR_ENCRYPTION_KEY` | 64-char hex key for env var encryption | Auto-generated at `<HARBOUR_HOME>/encryption.key` |
| `HARBOUR_MAX_UPLOAD_MB` | Per-file upload cap in MB | `500` |

### Postgres support (optional)

Harbour ships with a Postgres adapter for team and managed-DB deployments. SQLite remains the default and recommended choice for solo installs — single-file backups, zero-ops, the simplest possible deploy. Postgres is worth considering once you have multiple harbour processes hitting one database, a managed-DB compliance requirement, or a database large enough that the SQLite file is awkward to back up.

To run with Postgres locally via Docker Compose:

```bash
docker compose --profile postgres up -d postgres
export DATABASE_URL=postgres://harbour:harbour@localhost:5432/harbour
docker compose up -d harbour
```

`DATABASE_URL` must begin with `postgres://` or `postgresql://`. Any other prefix (or an unset value) keeps Harbour on SQLite — there is no automatic migration in either direction. To switch an existing SQLite install to Postgres, treat it as a fresh setup: start the PG instance, point `DATABASE_URL` at it, and recreate your agents/jobs/docs from scratch.

> **Note:** Every API route now uses the async DB adapter, so Postgres is a fully-supported backend for fresh installs. The migration covered all 60+ route handlers under `src/app/api/` (auth, agents, jobs, runs, docs, databases, env-vars, projects, teams, captain, users, admin-api-keys, system, usage). SQLite remains the default; setting `DATABASE_URL=postgres://...` switches to the Postgres adapter at boot. There is **no automatic schema migration between backends** — switching an existing SQLite install to Postgres means starting with a fresh DB. Known caveats are around test tooling (pg-mem can't model `FOR UPDATE SKIP LOCKED` or some COUNT-subquery patterns; the polling and list queries work on real Postgres). Track progress in [docs/reference/architecture.md](docs/reference/architecture.md).

## License

[MIT](LICENSE)
