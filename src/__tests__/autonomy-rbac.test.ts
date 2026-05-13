/**
 * RBAC checks for autonomy routes. Goes through the actual route handlers
 * so the `withAdmin` / `withUserOperator` decorators are exercised. We mint
 * the session cookie directly rather than spinning up the HTTP stack.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import { setDb, resetDb, initializeSchema } from "@/lib/db/schema";
import { createUserAsync, createSession, createApprovalRequestAsync } from "@/lib/db/queries";
import { POST as approvePOST } from "@/app/api/autonomy/approvals/[id]/approve/route";
import { POST as policiesPOST } from "@/app/api/autonomy/policies/route";

function freshDb() {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

beforeEach(() => {
  const db = freshDb();
  setDb(db);
  initializeSchema(db);
});
afterEach(() => resetDb());

async function userWithSession(role: "admin" | "operator" | "viewer") {
  const u = await createUserAsync(`${role}@x.com`, "test-pw-1!!", `User-${role}`, role);
  const sessionId = createSession(u!.id);
  return { user: u!, sessionId };
}

function makeReq(url: string, sessionId: string, body?: unknown): NextRequest {
  const headers = new Headers({ cookie: `harbour_session=${sessionId}`, "content-type": "application/json" });
  return new NextRequest(url, {
    method: "POST",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

const noParams = { params: Promise.resolve({} as Record<string, string>) };

describe("autonomy RBAC", () => {
  it("viewer cannot approve (403)", async () => {
    const { sessionId } = await userWithSession("viewer");
    const req = await createApprovalRequestAsync({
      sourceType: "tool_call", sourceId: "r-1", actionType: "send_email", riskLevel: "high",
    });
    const r = makeReq(`http://x/api/autonomy/approvals/${req.id}/approve`, sessionId, {});
    const ctx = { params: Promise.resolve({ id: req.id }) };
    const resp = await approvePOST(r, ctx);
    expect(resp.status).toBe(403);
  });

  it("operator can approve", async () => {
    const { sessionId } = await userWithSession("operator");
    const req = await createApprovalRequestAsync({
      sourceType: "tool_call", sourceId: "r-2", actionType: "send_email", riskLevel: "high",
    });
    const r = makeReq(`http://x/api/autonomy/approvals/${req.id}/approve`, sessionId, {});
    const ctx = { params: Promise.resolve({ id: req.id }) };
    const resp = await approvePOST(r, ctx);
    expect(resp.status).toBe(200);
  });

  it("operator cannot create a policy (admin-only, 403)", async () => {
    const { sessionId } = await userWithSession("operator");
    const r = makeReq(
      "http://x/api/autonomy/policies", sessionId,
      { name: "Test", scope_type: "department", scope_id: "X" },
    );
    const resp = await policiesPOST(r, noParams);
    expect(resp.status).toBe(403);
  });

  it("admin can create a policy", async () => {
    const { sessionId } = await userWithSession("admin");
    const r = makeReq(
      "http://x/api/autonomy/policies", sessionId,
      { name: "Test", scope_type: "department", scope_id: "X" },
    );
    const resp = await policiesPOST(r, noParams);
    expect(resp.status).toBe(200);
  });
});
