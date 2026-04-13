# Workflows

Workflows bring deterministic, code-based execution to Harbour jobs. A workflow is a shell command stored on a job that the runner executes locally — either as a pre-step before the AI agent, or as the entire job with no AI involved.

## Design Decisions

- **Agents remain required.** Every job belongs to an agent. Agents are "employees" — they own workspaces, identities, and jobs. Some of their jobs just don't need an LLM.
- **Workflows replace `check_command`.** Same protocol (stdin/stdout/exit codes), broader role. The rename reflects that workflows can be the work itself, not just a gate.
- **Workflows are always internal.** The harbour runner executes them locally. External agents cannot have workflows — they handle their own gating and deterministic logic.
- **Workflows have their own directory, separate from agent workspaces.** Agent workspaces (`~/.harbour/workspaces/<agent-name>/`) are for the LLM — cloned repos, local state, tool configs. Workflow scripts live in `~/.harbour/workflows/`, a single shared directory. The runner sets this as the cwd when executing workflow commands. Scripts can use subdirectories for organization (`python3 complex-one/main.py`), and one-liners need no files at all.
- **One runner, two concerns.** The existing runner polling loop handles both agent and workflow execution. No separate workflow runner.
- **No new API endpoints for discovery.** Workflow-only jobs are discovered through the existing agent polling mechanism (`/api/agents/:id/next`). The runner handles workflow execution based on job configuration.
- **Language-agnostic.** A workflow command can invoke anything: bash one-liners, Python scripts, Node scripts, compiled binaries, CLI tools. Harbour doesn't care — the contract is the protocol.

## Execution Modes

A job operates in one of three modes based on its configuration:

### Agent Only (default, current behavior)

No `workflow_command` set. The agent's CLI tool runs as normal. Nothing changes.

### Workflow + Agent

`workflow_command` is set, `workflow_only` is `false`. The workflow runs first as a gate and context-gatherer:

- **Exit 0:** stdout is passed to the agent as prompt context, LLM runs.
- **Exit 77:** run is skipped silently. Agent never fires.
- **Any other non-zero:** run fails. Agent never fires. Stderr logged as activity.

This replaces the current `check_command` behavior. Note: exit code semantics have changed — the old check command treated all non-zero as skip, while workflows use exit 77 for skip and all other non-zero as failure.

### Workflow Only

`workflow_command` is set, `workflow_only` is `true`. The workflow is the entire job — no LLM is invoked:

- **Exit 0:** run marked as `done`. Stdout logged as run activity.
- **Exit 77:** run marked as `skipped`.
- **Any other non-zero:** run marked as `failed`. Stderr logged as activity.

## Workflow Protocol

### Input

The full run payload (JSON) is piped to stdin. This is the same structure returned by `/api/agents/:id/next`:

```json
{
  "run": { "id": "...", "status": "running", "activity": [...] },
  "job": { "id": "...", "name": "...", "instructions": "...", ... },
  "docs": [{ "id": "...", "title": "...", "content": "..." }],
  "data": { "table_name": [{ ... }] },
  "env": { "API_KEY": "decrypted_value" },
  "attachments": [...]
}
```

### Output

- **stdout** — the workflow's result. In "workflow + agent" mode, this becomes prompt context for the LLM. In "workflow only" mode, it's logged as run activity.
- **stderr** — diagnostic/error output. Logged as activity on failure (any non-zero except 77).

### Exit Codes

Non-zero defaults to failure so that crashing scripts (Python tracebacks, unhandled exceptions) surface as errors without the author needing to do anything. Skip is opt-in via exit 77 — the established "skip" convention from GNU Automake (adopted by CMake and Meson). No workflow author will hit 77 by accident; it requires deliberate intent.

| Code | Meaning | Agent runs? | Run status |
|------|---------|-------------|------------|
| 0 | Success | Yes (workflow + agent) / No (workflow only) | continues / `done` |
| 77 | Skip — no work to do | No | `skipped` |
| Any other non-zero | Error | No | `failed` |

## Schema Changes

### Migration

SQLite doesn't support renaming columns with constraints in older versions, so the migration uses the rename syntax available since SQLite 3.25:

```sql
ALTER TABLE jobs RENAME COLUMN check_command TO workflow_command;
ALTER TABLE jobs ADD COLUMN workflow_only INTEGER NOT NULL DEFAULT 0;
```

All existing jobs retain their `check_command` value (now `workflow_command`) and get `workflow_only = 0`. Note: exit code semantics have changed — existing check commands that use `exit 1` for skip should be updated to use `exit 77`.

### Agents

Harbour agents may optionally have no CLI tool configured. This supports agents whose jobs are all workflow-only. If an agent has no CLI tool, any non-workflow-only jobs on that agent will fail at execution time (the runner has nothing to invoke).

## API Changes

### Run Payload

The `job.check` field becomes `job.workflow`:

```json
{
  "job": {
    "workflow": "python3 check_prs.py",
    "workflow_only": false,
    "name": "...",
    "instructions": "...",
    "timeout_minutes": 30
  }
}
```

### Job Creation / Update

Existing endpoints accept the renamed fields:

- `POST /api/agents/:id/jobs` — accepts `workflowCommand` and `workflowOnly`
- `PUT /api/jobs/:id` — same

One-off runs (`POST /api/runs`) do not support workflow fields. One-off runs are agent-only — for ad-hoc LLM tasks. To run a workflow immediately, use "Trigger Now" on the job.

### No New Endpoints

The runner discovers workflow-only jobs through the existing `/api/agents/:id/next` polling. No `/api/workflows/next` endpoint is needed. The runner's behavior changes based on the `workflow_only` flag in the returned payload.

## Runner Changes

### Execution Flow

```
runSingleAgent(runner):
  1. Poll GET /api/agents/:id/next → payload
  2. If no payload → nothing to do, return

  3. If payload.job.workflow exists:
     a. Execute: bash -c <command>, stdin=JSON payload, cwd=~/.harbour/workflows/
        (poll for kill signals during execution — SIGTERM on kill)
     b. Exit 77 → POST activity (if stderr), PUT status=skipped, return
     c. Any other non-zero → POST activity (stderr), PUT status=failed, return
     d. Killed during execution → PUT status=killed, return
     e. Exit 0 → capture stdout as workflow_output
        - If workflow_only:
            POST stdout as activity (author_type: system)
            PUT status=done
            return
        - If not workflow_only:
            Continue to step 4 with workflow_output

  4. Build prompt (append workflow_output as "## Workflow Output" section if present)
  5. Execute CLI tool (existing behavior)
  6. Handle result (existing behavior)
```

### Timeouts

- **Workflow + agent mode:** 30-second timeout on the workflow step (same as current `check_command`). The workflow is a gate, not the work.
- **Workflow only mode:** uses the job's `timeout_minutes` (default 30 min). The workflow IS the work and may need real time.

### Working Directory

Agent workspaces and workflow directories are separate execution environments:

- **Workflow step** runs in `~/.harbour/workflows/`. Created automatically on first workflow execution. This is a single shared directory — all workflow commands across all jobs use it as their cwd. Scripts can organize into subdirectories as needed. Temp files and state management are the script author's responsibility.
- **LLM step** (if applicable) runs in `~/.harbour/workspaces/<agent-name>/`. Unchanged from current behavior. The agent's persistent environment for repos, configs, and state shared across jobs.

The workflow does not need access to the agent workspace. It receives all context via stdin (the payload with docs, env vars, database rows). If a workflow needs to reference external paths, it can use values from env vars.

### Kill Handling

The runner polls for kill signals during workflow execution, same pattern as CLI agent runs. If the run is marked `killed` in Harbour, the runner sends `SIGTERM` to the workflow process and marks the run accordingly. This reuses the existing kill-polling mechanism — no new machinery.

Workflow-only jobs can run for extended periods (up to `timeout_minutes`), so kill support is necessary. The same mechanism applies to the workflow step in workflow+agent mode for consistency.

### What Workflows Don't Have

- **No session management.** Workflows are stateless, single-shot commands. No resume support.

## Code Migration

| Before | After |
|--------|-------|
| `check_command` (schema) | `workflow_command` |
| `checkCommand` (TypeScript) | `workflowCommand` |
| `job.check` (run payload) | `job.workflow` |
| `runCheckCommand()` (runner) | `runWorkflow()` |
| "Pre-run Check Command" (UI) | "Workflow Command" |
| "Pre-run Check Output" (prompt) | "Workflow Output" |

### Documentation Updates

- **GUIDE.md** — remove all `check` / `check_command` references. External agents don't see workflow fields; workflows are internal-only.
- **ADMIN_GUIDE.md** — replace `checkCommand` with `workflowCommand` and add `workflowOnly` in job creation/update examples.
- **README.md** — update any references to check commands in the agent/job descriptions.
- **CLAUDE.md** — update key paths or conventions if affected.

## UI Changes

### Job Creation / Edit

- "Pre-run Check Command" field renamed to **"Workflow Command"**.
- New **"Workflow Only"** toggle, visible when a workflow command is set. When enabled, agent/model fields are de-emphasized (the LLM won't be used for this job).
- Help text explains the three modes and exit code protocol.

### Jobs List

- Execution mode indicator: agent-only, workflow + agent, or workflow-only.

### Run Detail Page

- Workflow-only runs show stdout/stderr as activity entries.
- No console output section (no CLI tool was invoked).

### Trigger Dialog

- The trigger confirmation dialog works for all job types, including workflow-only.
- For agent jobs, the text field is "Extra instructions" — appended to the agent's prompt.
- For workflow-only jobs, the text field is "Note" — posted as activity on the run. Provides a paper trail for why the job was manually triggered. The runner does not inject it anywhere (there is no prompt).

### Agent Creation

- CLI tool selection becomes optional for harbour agents (to support workflow-only agents).
- Validation: if an agent has no CLI tool, block adding non-workflow-only jobs. An agent without a CLI tool can only have workflow-only jobs.

## Examples

### Workflow Only: Health Check

```bash
# workflow_command: bash health_check.sh
# workflow_only: true
```

```bash
#!/bin/bash
# ~/.harbour/workflows/health_check.sh
status=$(curl -s -o /dev/null -w "%{http_code}" https://api.example.com/health)
if [ "$status" = "200" ]; then
  echo "API healthy: returned $status"
  exit 0
else
  echo "API unhealthy: returned $status" >&2
  exit 2
fi
```

### Workflow + Agent: Gated PR Review

```bash
# workflow_command: python3 check_prs.py
# workflow_only: false
```

```python
# ~/.harbour/workflows/check_prs.py
import json, sys, subprocess

payload = json.load(sys.stdin)
env = payload.get("env", {})

result = subprocess.run(
    ["gh", "pr", "list", "--repo", env["GITHUB_REPO"],
     "--json", "number,title,url", "--limit", "5"],
    capture_output=True, text=True
)

prs = json.loads(result.stdout)
if not prs:
    sys.exit(77)  # No open PRs — skip

print(f"Found {len(prs)} open PRs to review:\n")
for pr in prs:
    print(f"- #{pr['number']}: {pr['title']} ({pr['url']})")
# Exit 0 — agent receives this PR list as context
```

### Workflow Only: One-Liner

```bash
# workflow_command: curl -s https://api.example.com/metrics | jq '.summary'
# workflow_only: true
# (no files needed — the command itself is the workflow)
```

## Directory Lifecycle

- `~/.harbour/workflows/` is created automatically by the runner on first workflow execution.
- The directory is shared across all jobs and persists indefinitely. Scripts are placed here by humans or agents and referenced by workflow commands.
- Deleting a job does not affect the workflows directory — scripts are independent of jobs. Cleanup of unused scripts is the user's responsibility.

## Future Considerations

These are not in scope for v1 but the design accommodates them:

- **Env var injection into shell environment.** Currently env vars are in the stdin JSON. Injecting them as real environment variables (`$API_KEY`) would be more ergonomic for workflow scripts.
- **Post-run workflows.** A `post_workflow_command` that runs after the agent completes — for cleanup, notifications, or chaining to another system.
- **Structured output.** Workflows could return JSON with specific fields (`context`, `skip_reason`, `env_overrides`) for richer agent handoff. Plain stdout is sufficient for v1.
