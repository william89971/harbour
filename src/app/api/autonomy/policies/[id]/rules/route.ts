import { NextResponse } from "next/server";
// Admin-only AND user-only: agents must never reach policy rules CRUD.
import { withUserAdmin } from "@/lib/auth";
import {
  listPolicyRulesAsync,
  setPolicyRuleAsync,
  deletePolicyRuleAsync,
  getPolicyByIdAsync,
} from "@/lib/db/queries";
import { isActionType, isRiskLevel } from "@/lib/autonomy/constants";

export const GET = withUserAdmin(async (_req, _auth, { params }) => {
  const { id } = await params;
  const rules = await listPolicyRulesAsync(id);
  return NextResponse.json({ rules });
});

export const PUT = withUserAdmin(async (req, _auth, { params }) => {
  const { id } = await params;
  const policy = await getPolicyByIdAsync(id);
  if (!policy) return NextResponse.json({ error: "policy not found" }, { status: 404 });
  let body: {
    action_type?: string;
    risk_level?: string;
    require_approval?: boolean;
    max_cost_usd?: number | null;
    allowed_roles?: string[] | null;
    approval_roles?: string[] | null;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const action = String(body.action_type || "");
  const risk = String(body.risk_level || "");
  if (!isActionType(action)) return NextResponse.json({ error: "invalid action_type" }, { status: 400 });
  if (!isRiskLevel(risk)) return NextResponse.json({ error: "invalid risk_level" }, { status: 400 });
  const rule = await setPolicyRuleAsync(id, {
    actionType: action,
    riskLevel: risk,
    requireApproval: body.require_approval === true,
    maxCostUsd: typeof body.max_cost_usd === "number" ? body.max_cost_usd : null,
    allowedRoles: Array.isArray(body.allowed_roles) ? body.allowed_roles : null,
    approvalRoles: Array.isArray(body.approval_roles) ? body.approval_roles : null,
  });
  return NextResponse.json({ rule });
});

export const DELETE = withUserAdmin(async (req, _auth, { params }) => {
  const { id } = await params;
  const body = await req.json().catch(() => ({} as { action_type?: string }));
  const action = String(body.action_type || "");
  if (!isActionType(action)) return NextResponse.json({ error: "invalid action_type" }, { status: 400 });
  await deletePolicyRuleAsync(id, action);
  return NextResponse.json({ ok: true });
});
