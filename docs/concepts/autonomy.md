# Autonomy & Approvals

Harbour ships with several safety primitives that compose into a single policy layer:

- **RBAC** — admin/operator/viewer at the user level
- **Per-agent permission modes** — safe/custom/unrestricted
- **Per-agent tool permissions** — 10 `can_*` flags
- **Harbour-level safe mode** — shimmed wrappers for `rm`, `sudo`, etc.
- **Workflow approval gates** — `approval_type` + `risky` per step
- **Autonomy policies (this doc)** — declarative rules on top of the above

Policies live in **Settings → Autonomy & Approvals**. They're the part of Harbour that says "send_email always needs approval at $X cost, deploy_code never auto-runs in Engineering, the global default is approve-anything-high-risk." A blocked action doesn't crash the run — it returns a soft error to the agent and records a queryable `approval_requests` row that an operator can resolve later.

## Action types

Every gated action falls into one of 13 buckets:

| Action | Typical risk | Default |
|---|---|---|
| `send_email`, `send_message`, `contact_customer` | high | require approval |
| `spend_money` | medium | auto up to $10, then $100 with approval |
| `deploy_code`, `merge_pr` | high | require approval |
| `delete_data` | critical | require approval |
| `modify_production`, `use_secret` | high | require approval |
| `external_api_call`, `create_handoff` | high | require approval |
| `update_status` | low | auto-allow |
| `custom` | high | require approval (fallback) |

Defaults come from the seeded **Default Safety Policy**, which is created on first run. Editing or deleting it is fine — Harbour does not re-seed once you've customized it.

## Scope priority

Policies have a scope. When the same action could match multiple policies, Harbour walks the ladder in this order and uses the first match:

1. **agent** — applies only to runs/calls from one agent
2. **team** — applies to any agent in a team
3. **workflow** — applies to all steps in one workflow
4. **department** — applies to workflows tagged with that department name
5. **global** — applies to everything else

Within a matched policy, only the rule for the specific `action_type` matters. If the policy doesn't have a rule for that action, Harbour falls through to the next-lower scope. If nothing matches anywhere, the action is allowed — adding a new action type doesn't silently break installs.

## What gets intercepted

Three integration points:

### Workflow steps

Before a step's run is spawned, the policy is consulted. If it requires approval, the step pauses at `waiting_approval_before` (or `waiting_approval_after` for after-step gates) with a linked `approval_requests` row. Approving the step via the workflow-run page also resolves the linked request.

The autonomy policy gate composes with the existing workflow gate (`approval_type` + `risky`). If either says "pause", the step pauses.

### API-agent tool calls

The Harbour runner POSTs to `/api/internal/autonomy/check` before dispatching any tool. On a block, the tool result returned to the LLM is:

```
error: tool 'send_email' requires approval (request ap_abc123): Policy "Default Safety Policy" requires approval for send_email
```

The model adapts (typically by posting an activity message and stopping). The approval is recorded. Approving it later does **not** automatically retry — the action is your call to redo manually or via a follow-up run.

CLI agents (Claude Code, Codex, Gemini) don't have a tool-dispatch interception point — only API-agents go through this gate.

### Cost ceilings

When `run_costs` records a new charge, Harbour evaluates the `spend_money` rule. If the run's accumulated cost exceeds the cap, a `cost`-source approval_request is logged. The run itself is **not** halted — cost gating is a circuit breaker for the *next* call, not a hard pre-check, because cost is only known after the LLM call completes.

## Approving and rejecting

- **Settings → Autonomy & Approvals** — the central queue across the system.
- **Workflow-run detail** — policy approvals tied to the current step appear inline next to the step's approval panel.
- **Run detail** — when policy approvals exist for a run (tool_call or cost), an amber strip surfaces them above the activity log.

Buttons are gated by the `approveAutonomy` permission (admin + operator). Viewers see the queue but cannot resolve entries.

A simultaneous-approval race is handled by a CAS update — the second click receives a 409 cleanly rather than double-recording.

## Reserved columns

`policy_rules.allowed_roles` and `policy_rules.approval_roles` are JSON-array columns reserved for a future per-rule role filter (e.g. "only senior operators can approve `delete_data`"). They are written by the API when supplied but currently not read by the resolver — the active permission is `approveAutonomy` (admin + operator). They are documented here to flag the columns as not-yet-load-bearing; treat them as unused until a release note says otherwise.

## Limits worth knowing

- **Time-windowed policies** ("only during business hours") aren't modeled. Day-of-week / time-of-day filtering would require schema changes.
- **Multi-approver chains** aren't modeled. One operator approval resolves the request.
- **Auto-expiration** is not implemented — the `expired` status exists in the enum for future use, but Harbour has no background job to flip pending requests after N hours.
- **External agent tool gating** isn't covered. External agents that pull work through `/api/agents/:id/next` operate under the per-agent tool_permissions matrix but bypass the autonomy-policy layer for tool calls.
