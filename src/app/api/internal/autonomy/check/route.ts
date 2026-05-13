import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { getRunByIdAsync } from "@/lib/db/queries";
import { actionTypeForTool } from "@/lib/autonomy/tool-map";
import { evaluatePolicy, fallbackRiskFor } from "@/lib/autonomy/resolve";
import { createApprovalRequestAsync } from "@/lib/db/queries";
import { getDbAsync } from "@/lib/db/schema";

/**
 * Runner-callable endpoint: should this API-agent tool call be allowed?
 *
 * Called by `bin/lib/api-agent.mjs` after the per-agent tool_permissions check
 * succeeds. Resolves the policy ladder; on block, records an approval_request
 * and returns `{ allow: false, requestId, reason }`. The runner returns that
 * rejection to the LLM as a normal tool error so the model can adapt.
 *
 * Tools without an entry in TOOL_ACTION_MAP (read_docs, read_databases,
 * post_activity) are non-gated and always allowed without recording anything.
 */
export const POST = withAuth(async (req, auth) => {
  // The runner calls this with its agent API key. Block user callers so
  // a logged-in viewer can't mint spurious tool_call approval requests by
  // POSTing bogus runIds.
  if (auth.type !== "agent") {
    return NextResponse.json({ error: "agent-only endpoint" }, { status: 403 });
  }

  let body: { runId?: string; toolName?: string; args?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const runId = String(body.runId || "").trim();
  const toolName = String(body.toolName || "").trim();
  if (!runId || !toolName) {
    return NextResponse.json({ error: "runId and toolName are required" }, { status: 400 });
  }

  const actionType = actionTypeForTool(toolName);
  if (!actionType) {
    return NextResponse.json({ allow: true, gated: false });
  }

  const run = await getRunByIdAsync(runId);
  if (!run) {
    return NextResponse.json({ error: "run not found" }, { status: 404 });
  }
  if (run.agent_id && run.agent_id !== auth.agentId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Resolve workflow + department context from the workflow step (if any).
  // Lookup is small and untyped to avoid pulling all workflow types here.
  const db = await getDbAsync();
  const wfCtx = await db.get<{ workflow_id: string; department: string | null }>(
    `SELECT w.id AS workflow_id, w.department AS department
     FROM workflow_step_runs sr
     JOIN workflow_steps s ON sr.step_id = s.id
     JOIN workflows w ON s.workflow_id = w.id
     WHERE sr.run_id = ?
     LIMIT 1`,
    [runId],
  );

  const decision = await evaluatePolicy({
    agentId: run.agent_id ?? null,
    workflowId: wfCtx?.workflow_id ?? null,
    department: wfCtx?.department ?? null,
    actionType,
  });

  if (decision.allow) {
    return NextResponse.json({ allow: true, gated: true });
  }

  const request = await createApprovalRequestAsync({
    sourceType: "tool_call",
    sourceId: runId,
    requestedByAgentId: run.agent_id ?? null,
    actionType,
    riskLevel: decision.rule.risk_level ?? fallbackRiskFor(actionType),
    reason: decision.reason,
    payloadJson: JSON.stringify({ toolName, args: body.args ?? null }),
  });

  return NextResponse.json({
    allow: false,
    gated: true,
    requestId: request.id,
    reason: decision.reason,
  });
});
