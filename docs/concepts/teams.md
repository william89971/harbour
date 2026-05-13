# Teams

A **team** groups multiple agents so a single job can be claimed by whichever team member is free. Each agent's membership in a team carries a **role**, and jobs can request a preferred role with a fallback policy. Teams are optional — Harbour's default flow is one job → one agent.

## When to use a team

- You want a job to flow to whichever specialist is free, not always the same agent. E.g. a research task could run on `Alice` or `Bob` depending on who has capacity.
- You want multiple agents collaborating on a stream of work — a Researcher pulling sources, a Builder writing code, a Reviewer reading PRs, all on independent jobs that share docs and env vars.
- You want capacity to scale by adding agents, not by raising per-agent concurrency (which keeps coding-agent collisions at bay).

## When NOT to use a team

- For a one-agent project, a Team is overhead. Direct-assign the job to the agent.
- If your workload is purely single-tenant and serial, the existing `max_concurrent_runs` setting on one agent will do the job.

## Roles

Each agent's team membership has a role:

| Role | Typical use |
|---|---|
| `researcher` | Reads docs, gathers context, no code edits |
| `builder` | Writes code, runs workflows, modifies files |
| `reviewer` | Reads diffs/PRs/output, leaves comments, no edits |
| `debugger` | Investigates failures, reads logs, proposes fixes |
| `custom` | Anything else — pair with a free-text label like `QA`, `Designer`, `SRE` |

The same agent can be a `Builder` in one team and a `Reviewer` in another. Roles attach to the *membership*, not the agent.

## Job assignment

A job belongs to either:

- a specific agent (`agent_id` set, `team_id` null) — the current default, unchanged
- a team (`agent_id` null, `team_id` set, optional `preferred_role` and `role_fallback`)
- nothing — workflow-only jobs with no LLM (`workflow_only = 1`, both null)

You cannot set both `agent_id` and `team_id`; the API rejects it with `400`.

## Routing

When an agent polls `/api/agents/:id/next` and has capacity (`running < max_concurrent_runs`), the server tries to claim work in this order:

1. **Pending** runs assigned directly to this agent (resume after human reply).
2. **Scheduled** runs assigned directly to this agent (one-off triggers, etc.).
3. **Recurring direct-assigned jobs** past their `next_run_at`.
4. **Team-assigned jobs** where this agent is a team member and the role rules permit:
   - If `preferred_role IS NULL` — any team member can claim.
   - If this agent's `team_agents.role` matches `preferred_role` — claim (preferred path).
   - If this agent's role doesn't match and `role_fallback = 'any'` — claim **only if** every role-matching teammate is at capacity. This gives specialists first dibs.
   - If `role_fallback = 'wait'` — only role-matching agents can claim. The job stays queued otherwise.

Within step 4, the SQL orders by role-match-first then `next_run_at` ASC, so when multiple eligible jobs are due, the most-preferred one goes first.

The whole claim runs inside a transaction. On SQLite, the database's exclusive-write lock makes the read-then-write atomic. On Postgres, the candidate `SELECT` uses `FOR UPDATE SKIP LOCKED` so concurrent agent polls don't serialize.

## Concurrency interaction

Per-agent `max_concurrent_runs` and team membership compose cleanly:

- Each team member respects its own `max_concurrent_runs` cap. A Builder with `max_concurrent_runs=3` can carry 3 in flight; a Researcher next to it with `max_concurrent_runs=1` carries 1.
- Capacity decisions are per agent. The team has no aggregate cap — its throughput is the sum of its members' caps.
- `role_fallback = 'any'` checks each role-matching teammate's *individual* capacity. If all specialists are saturated, fallback opens up.

## API summary

| Endpoint | Purpose |
|---|---|
| `GET /api/teams` | List teams (with member + job counts) |
| `POST /api/teams` | Create a team |
| `GET /api/teams/:id` | Team detail with members + roles |
| `PUT /api/teams/:id` | Rename / re-describe |
| `DELETE /api/teams/:id` | Delete team (jobs become unassigned, agents not affected) |
| `GET /api/teams/:id/agents` | List members |
| `POST /api/teams/:id/agents` | Add agent with role |
| `PUT /api/teams/:id/agents/:agentId` | Change role |
| `DELETE /api/teams/:id/agents/:agentId` | Remove member |
| `POST /api/teams/:id/jobs` | Create a team-assigned job (force `team_id`, allow `preferredRole` + `roleFallback`) |

## UI

The **Teams** page (sidebar, between Agents and Docs) lists teams. The detail page lets you add/remove members and change roles inline. Team-job creation in the dashboard is in flight — for now, use the API or assign existing jobs via PUT.
