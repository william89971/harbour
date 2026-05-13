import { NextResponse } from "next/server";
// Autonomy policy CRUD is admin-only and must NEVER be agent-callable —
// agents could otherwise create a policy that auto-allows their own risky
// tool calls or delete the seeded global safety policy. withUserAdmin
// rejects Bearer-token (agent) callers with 403.
import { withUserAdmin } from "@/lib/auth";
import {
  createPolicyAsync,
  listPoliciesAsync,
  listPolicyRulesAsync,
} from "@/lib/db/queries";
import { SCOPE_TYPES, type ScopeType } from "@/lib/autonomy/constants";

export const GET = withUserAdmin(async () => {
  const policies = await listPoliciesAsync();
  // Inline the rule counts so the list page can show "n rules" without N+1.
  const withCounts = await Promise.all(
    policies.map(async (p) => {
      const rules = await listPolicyRulesAsync(p.id);
      return { ...p, rule_count: rules.length };
    }),
  );
  return NextResponse.json({ policies: withCounts });
});

export const POST = withUserAdmin(async (req) => {
  let body: { name?: string; description?: string; scope_type?: string; scope_id?: string | null; enabled?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const name = String(body.name || "").trim();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  const scopeType = String(body.scope_type || "").trim() as ScopeType;
  if (!(SCOPE_TYPES as readonly string[]).includes(scopeType)) {
    return NextResponse.json({ error: `scope_type must be one of: ${SCOPE_TYPES.join(", ")}` }, { status: 400 });
  }
  const scopeId = scopeType === "global" ? null : (body.scope_id ? String(body.scope_id).trim() : null);
  if (scopeType !== "global" && !scopeId) {
    return NextResponse.json({ error: "scope_id required for non-global scopes" }, { status: 400 });
  }
  const policy = await createPolicyAsync({
    name,
    description: body.description?.trim() || null,
    scopeType,
    scopeId,
    enabled: body.enabled !== false,
  });
  return NextResponse.json({ policy });
});
