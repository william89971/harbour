/**
 * approval_requests state machine: pending → approved | rejected, plus the
 * CAS guard against double-approve / double-reject races.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { setDb, resetDb, initializeSchema } from "@/lib/db/schema";
import {
  createApprovalRequestAsync, approveRequestAsync, rejectRequestAsync,
  listApprovalRequestsAsync, getApprovalRequestByIdAsync, createUserAsync,
} from "@/lib/db/queries";

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

async function makeUser(email = "ops@example.com") {
  const u = await createUserAsync(email, "test-pw-1!!", "Ops");
  if (!u) throw new Error("user creation failed");
  return u;
}

describe("approval requests", () => {
  it("createApprovalRequestAsync inserts a pending row", async () => {
    const req = await createApprovalRequestAsync({
      sourceType: "tool_call",
      sourceId: "run-1",
      actionType: "send_email",
      riskLevel: "high",
      reason: "outbound email",
    });
    expect(req.status).toBe("pending");
    expect(req.action_type).toBe("send_email");
  });

  it("approveRequestAsync resolves with comment + user", async () => {
    const user = await makeUser();
    const req = await createApprovalRequestAsync({
      sourceType: "workflow_step", sourceId: "sr-1", actionType: "deploy_code", riskLevel: "high",
    });
    const after = await approveRequestAsync(req.id, user.id, "looks good");
    expect(after?.status).toBe("approved");
    expect(after?.approved_by_user_id).toBe(user.id);
    expect(after?.approval_comment).toBe("looks good");
    expect(after?.resolved_at).toBeTruthy();
  });

  it("rejectRequestAsync resolves to rejected", async () => {
    const user = await makeUser("reject@example.com");
    const req = await createApprovalRequestAsync({
      sourceType: "cost", sourceId: "run-2", actionType: "spend_money", riskLevel: "medium",
    });
    const after = await rejectRequestAsync(req.id, user.id, "too expensive");
    expect(after?.status).toBe("rejected");
    expect(after?.approval_comment).toBe("too expensive");
  });

  it("CAS guard: double-approve returns null on the second call", async () => {
    const user = await makeUser("racy@example.com");
    const req = await createApprovalRequestAsync({
      sourceType: "tool_call", sourceId: "run-3", actionType: "use_secret", riskLevel: "high",
    });
    const first = await approveRequestAsync(req.id, user.id);
    const second = await approveRequestAsync(req.id, user.id);
    expect(first?.status).toBe("approved");
    expect(second).toBeNull();
  });

  it("listApprovalRequestsAsync filters by status", async () => {
    const user = await makeUser("filter@example.com");
    const a = await createApprovalRequestAsync({
      sourceType: "tool_call", sourceId: "run-4", actionType: "send_email", riskLevel: "high",
    });
    const b = await createApprovalRequestAsync({
      sourceType: "tool_call", sourceId: "run-5", actionType: "send_email", riskLevel: "high",
    });
    await approveRequestAsync(a.id, user.id);
    const pending = await listApprovalRequestsAsync({ status: "pending" });
    expect(pending.map(r => r.id)).toContain(b.id);
    expect(pending.map(r => r.id)).not.toContain(a.id);
  });

  it("listApprovalRequestsAsync filters by source_id", async () => {
    await createApprovalRequestAsync({
      sourceType: "workflow_step", sourceId: "step-A", actionType: "merge_pr", riskLevel: "high",
    });
    await createApprovalRequestAsync({
      sourceType: "workflow_step", sourceId: "step-B", actionType: "merge_pr", riskLevel: "high",
    });
    const a = await listApprovalRequestsAsync({ sourceId: "step-A" });
    expect(a).toHaveLength(1);
    expect(a[0].source_id).toBe("step-A");
  });

  it("getApprovalRequestByIdAsync returns null for unknown id", async () => {
    expect(await getApprovalRequestByIdAsync("nope")).toBeNull();
  });
});
