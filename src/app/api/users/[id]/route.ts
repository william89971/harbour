import { NextResponse } from "next/server";
import { withUserAuth, requireAdmin, USER_ROLES, isValidUserRole } from "@/lib/auth";
import { getUserByIdAsync, updateUserAsync, deleteUserAsync, countAdminsAsync } from "@/lib/db/queries";

export const GET = withUserAuth(async (_req, _auth, { params }) => {
  const { id } = await params;
  const user = await getUserByIdAsync(id);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
  return NextResponse.json(user);
});

export const PUT = withUserAuth(async (req, auth, { params }) => {
  const e = requireAdmin(auth); if (e) return e;
  const { id } = await params;
  const existing = await getUserByIdAsync(id);
  if (!existing) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const body = await req.json();
  if (body.role !== undefined && !isValidUserRole(body.role)) {
    return NextResponse.json({ error: `role must be one of: ${USER_ROLES.join(", ")}` }, { status: 400 });
  }

  // Last-admin safeguard: don't allow demoting the only admin (whether
  // self-demotion or admin-on-admin demotion).
  if (body.role !== undefined && body.role !== "admin" && existing.role === "admin") {
    const admins = await countAdminsAsync();
    if (admins <= 1) {
      return NextResponse.json({ error: "cannot demote the last admin" }, { status: 400 });
    }
  }

  try {
    const updated = await updateUserAsync(id, {
      displayName: typeof body.displayName === "string" ? body.displayName : undefined,
      role: body.role,
    });
    return NextResponse.json(updated);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
});

export const DELETE = withUserAuth(async (_req, auth, { params }) => {
  const e = requireAdmin(auth); if (e) return e;
  const { id } = await params;
  if (id === auth.userId) {
    return NextResponse.json({ error: "cannot delete yourself" }, { status: 400 });
  }
  const target = await getUserByIdAsync(id);
  if (!target) return NextResponse.json({ ok: true });
  // Last-admin safeguard: never delete the only admin.
  if (target.role === "admin" && (await countAdminsAsync()) <= 1) {
    return NextResponse.json({ error: "cannot delete the last admin" }, { status: 400 });
  }
  await deleteUserAsync(id);
  return NextResponse.json({ ok: true });
});
