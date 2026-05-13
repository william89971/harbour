/**
 * Approval-gate integration + team routing.
 *
 * Exercises the real start/approve/reject/request-changes/resume code
 * paths against in-memory SQLite. Complements workflows-approval.test.ts
 * which covers the pure decision functions.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { setDb, resetDb, initializeSchema } from "@/lib/db/schema";
import {
  createAgentAsync, createTeamAsync, addAgentToTeamAsync,
  createWorkflowAsync, createWorkflowStepAsync,
  startWorkflowRunAsync,
  getWorkflowRunByIdAsync, listWorkflowStepRunsAsync,
  approveCurrentStepAsync, rejectWorkflowRunAsync, requestStepChangesAsync, resumeAfterChangesAsync,
  updateRunStatusAsync,
  listWorkflowRunActivityAsync,
  createUserAsync,
} from "@/lib/db/queries";

async function makeUser(email = "approver@example.com") {
  const u = await createUserAsync(email, "test-pw-1!!", "Approver");
  return u!;
}

function freshDb() {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

async function makeAgent(name = "Worker") {
  return createAgentAsync(name, "", { type: "harbour", cli: "claude", model: "sonnet" });
}

beforeEach(() => {
  const db = freshDb();
  setDb(db);
  initializeSchema(db);
});

afterEach(() => {
  resetDb();
});

describe("manual autonomy: every step pauses for before-approval", () => {
  it("first step pauses; approve resumes; running run completes → next step also pauses", async () => {
    const agent = await makeAgent();
    const user = await makeUser();
    const w = await createWorkflowAsync({ name: "Manual", autonomyLevel: "manual" });
    await createWorkflowStepAsync(w.id, { name: "A", instructions: "x", assignedAgentId: agent.id });
    await createWorkflowStepAsync(w.id, { name: "B", instructions: "y", assignedAgentId: agent.id });

    const { workflowRunId } = await startWorkflowRunAsync(w.id, { userId: user.id, userName: user.display_name });
    let wfRun = await getWorkflowRunByIdAsync(workflowRunId);
    expect(wfRun?.status).toBe("waiting_for_approval");
    let stepRuns = await listWorkflowStepRunsAsync(workflowRunId);
    expect(stepRuns[0].status).toBe("waiting_approval_before");
    expect(stepRuns[0].run_id).toBeNull();

    // Approve → step 1 spawns a run.
    await approveCurrentStepAsync(workflowRunId, { userId: user.id, userName: user.display_name });
    stepRuns = await listWorkflowStepRunsAsync(workflowRunId);
    expect(stepRuns[0].status).toBe("running");
    expect(stepRuns[0].run_id).toBeTruthy();
    wfRun = await getWorkflowRunByIdAsync(workflowRunId);
    expect(wfRun?.status).toBe("running");

    // Simulate run complete → step 2 is created and waiting.
    await updateRunStatusAsync(stepRuns[0].run_id!, "done");
    stepRuns = await listWorkflowStepRunsAsync(workflowRunId);
    expect(stepRuns[1].status).toBe("waiting_approval_before");
    wfRun = await getWorkflowRunByIdAsync(workflowRunId);
    expect(wfRun?.status).toBe("waiting_for_approval");
  });
});

describe("supervised autonomy + risky step", () => {
  it("risky step pauses; non-risky step runs", async () => {
    const agent = await makeAgent();
    const w = await createWorkflowAsync({ name: "Mixed", autonomyLevel: "supervised" });
    await createWorkflowStepAsync(w.id, { name: "safe", instructions: "Summarize the brief", assignedAgentId: agent.id, risky: false });
    await createWorkflowStepAsync(w.id, { name: "risky", instructions: "Send the email", assignedAgentId: agent.id, risky: true });

    const { workflowRunId } = await startWorkflowRunAsync(w.id);
    const stepRuns = await listWorkflowStepRunsAsync(workflowRunId);
    // First step is non-risky → runs immediately.
    expect(stepRuns[0].status).toBe("running");

    // Mark first run done → second step is risky → pauses for approval.
    await updateRunStatusAsync(stepRuns[0].run_id!, "done");
    const updated = await listWorkflowStepRunsAsync(workflowRunId);
    expect(updated[1].status).toBe("waiting_approval_before");
  });
});

describe("autonomous autonomy + after-step approval", () => {
  it("step runs first, then pauses for after-step approval when requires_human_approval is set", async () => {
    const agent = await makeAgent();
    const user = await makeUser();
    const w = await createWorkflowAsync({ name: "Auto-after", autonomyLevel: "autonomous" });
    await createWorkflowStepAsync(w.id, {
      name: "compose draft", instructions: "x", assignedAgentId: agent.id,
      requiresHumanApproval: true, approvalType: "after_step",
    });
    await createWorkflowStepAsync(w.id, { name: "next", instructions: "y", assignedAgentId: agent.id });

    const { workflowRunId } = await startWorkflowRunAsync(w.id);
    let stepRuns = await listWorkflowStepRunsAsync(workflowRunId);
    expect(stepRuns[0].status).toBe("running");

    // Run completes → pauses for approval (does NOT advance to step 2).
    await updateRunStatusAsync(stepRuns[0].run_id!, "done");
    stepRuns = await listWorkflowStepRunsAsync(workflowRunId);
    expect(stepRuns[0].status).toBe("waiting_approval_after");
    expect(stepRuns.length).toBe(1);
    const wfRun = await getWorkflowRunByIdAsync(workflowRunId);
    expect(wfRun?.status).toBe("waiting_for_approval");

    // Approve → step 2 runs.
    await approveCurrentStepAsync(workflowRunId, { userId: user.id, userName: user.display_name });
    stepRuns = await listWorkflowStepRunsAsync(workflowRunId);
    expect(stepRuns[0].status).toBe("done");
    expect(stepRuns[1].status).toBe("running");
  });
});

describe("reject + request-changes + resume", () => {
  it("reject terminates the workflow run", async () => {
    const agent = await makeAgent();
    const user = await makeUser();
    const w = await createWorkflowAsync({ name: "Rejected", autonomyLevel: "manual" });
    await createWorkflowStepAsync(w.id, { name: "A", instructions: "x", assignedAgentId: agent.id });
    const { workflowRunId } = await startWorkflowRunAsync(w.id);

    await rejectWorkflowRunAsync(workflowRunId, { userId: user.id, userName: user.display_name, comment: "not approved" });
    const wfRun = await getWorkflowRunByIdAsync(workflowRunId);
    expect(wfRun?.status).toBe("rejected");
    expect(wfRun?.completed_at).toBeTruthy();
    const activity = await listWorkflowRunActivityAsync(workflowRunId);
    expect(activity.find(a => a.kind === "reject")).toBeTruthy();
  });

  it("request-changes pauses with feedback; resume re-runs the step with appended instructions", async () => {
    const agent = await makeAgent();
    const user = await makeUser();
    const w = await createWorkflowAsync({ name: "Iterate", autonomyLevel: "autonomous" });
    await createWorkflowStepAsync(w.id, {
      name: "draft", instructions: "Write a draft", assignedAgentId: agent.id,
      requiresHumanApproval: true, approvalType: "after_step",
    });
    const { workflowRunId } = await startWorkflowRunAsync(w.id);
    let stepRuns = await listWorkflowStepRunsAsync(workflowRunId);
    await updateRunStatusAsync(stepRuns[0].run_id!, "done");

    await requestStepChangesAsync(workflowRunId, {
      userId: user.id, userName: user.display_name,
      comment: "Tone is off",
      extraInstructions: "Make it warmer",
    });
    stepRuns = await listWorkflowStepRunsAsync(workflowRunId);
    expect(stepRuns[0].status).toBe("needs_changes");
    expect(stepRuns[0].approval_comment).toContain("Make it warmer");

    // Resume → step runs again with the feedback baked in.
    await resumeAfterChangesAsync(workflowRunId, { userId: user.id, userName: user.display_name });
    stepRuns = await listWorkflowStepRunsAsync(workflowRunId);
    expect(stepRuns[0].status).toBe("running");
    expect(stepRuns[0].run_id).toBeTruthy();
  });
});

describe("team routing", () => {
  it("step assigned to a team creates a job with that team_id and preferred_role", async () => {
    const team = await createTeamAsync("Eng Pod");
    const a = await makeAgent("Builder");
    await addAgentToTeamAsync(team.id, a.id, "builder");
    const w = await createWorkflowAsync({ name: "Team routing", autonomyLevel: "autonomous" });
    await createWorkflowStepAsync(w.id, {
      name: "build it", instructions: "do the build",
      assignedTeamId: team.id, preferredRole: "builder",
    });

    const { workflowRunId } = await startWorkflowRunAsync(w.id);
    const [stepRun] = await listWorkflowStepRunsAsync(workflowRunId);
    expect(stepRun.job_id).toBeTruthy();
    // The job row should carry team_id + preferred_role; we read it via the
    // underlying SQLite without a separate helper for that.
    const Database = (await import("better-sqlite3")).default;
    const { getDb } = await import("@/lib/db/schema");
    const db = getDb() as InstanceType<typeof Database>;
    const job = db.prepare(`SELECT team_id, preferred_role, agent_id FROM jobs WHERE id = ?`).get(stepRun.job_id) as { team_id: string; preferred_role: string; agent_id: string | null };
    expect(job.team_id).toBe(team.id);
    expect(job.preferred_role).toBe("builder");
    expect(job.agent_id).toBeNull();
  });
});
