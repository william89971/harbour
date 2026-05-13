import { NextResponse } from "next/server";
// Admin-only AND user-only: agents must never reach policy CRUD.
import { withUserAdmin } from "@/lib/auth";
import {
  getPolicyByIdAsync,
  updatePolicyAsync,
  deletePolicyAsync,
  listPolicyRulesAsync,
} from "@/lib/db/queries";

export const GET = withUserAdmin(async (_req, _auth, { params }) => {
  const { id } = await params;
  const policy = await getPolicyByIdAsync(id);
  if (!policy) return NextResponse.json({ error: "not found" }, { status: 404 });
  const rules = await listPolicyRulesAsync(id);
  return NextResponse.json({ policy, rules });
});

export const PUT = withUserAdmin(async (req, _auth, { params }) => {
  const { id } = await params;
  let body: { name?: string; description?: string; enabled?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const policy = await updatePolicyAsync(id, {
    name: body.name,
    description: body.description ?? undefined,
    enabled: body.enabled,
  });
  if (!policy) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ policy });
});

export const DELETE = withUserAdmin(async (_req, _auth, { params }) => {
  const { id } = await params;
  // Block deleting the seeded global policy: the resolver's fail-open behavior
  // relies on a baseline always being present. Custom global policies (added
  // by an admin) are still deletable — only the seeded baseline is locked.
  const policy = await getPolicyByIdAsync(id);
  if (!policy) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (policy.scope_type === "global") {
    return NextResponse.json(
      { error: "cannot delete the global safety policy — disable it instead" },
      { status: 400 },
    );
  }
  await deletePolicyAsync(id);
  return NextResponse.json({ ok: true });
});
