/**
 * Agent-to-agent + agent-to-team handoffs.
 *
 * Covers:
 *  - direct agent handoff: new one-off scheduled run for the target agent
 *  - team handoff: new one-off team-assigned job + agentless scheduled run
 *  - role-priority + fallback semantics on team handoffs
 *  - status transitions: pending → accepted → completed
 *  - safety validation (mutual exclusion, empty message)
 *  - source-run deletion preserves handoff visibility via snapshots
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { setDb, resetDb, initializeSchema } from "@/lib/db/schema";
import {
  createAgent, createJob, triggerJobRun,
  getAgentNextRun, updateRunStatus, getRunById, deleteRun,
  createTeam, addAgentToTeam,
  createHandoff, listOutgoingHandoffs, listIncomingHandoff, getHandoffById,
  listRunActivity,
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

afterEach(() => {
  resetDb();
});

function makeSourceRun() {
  const sourceAgent = createAgent("source-agent");
  const targetAgent = createAgent("target-agent");
  const job = createJob(sourceAgent.id, { name: "source job", schedule: '{"every":60}', instructions: "Do the thing." });
  const { runId } = triggerJobRun(job.id) || { runId: null };
  if (!runId) throw new Error("triggerJobRun did not return runId");
  return { sourceAgent, targetAgent, sourceRunId: runId };
}

describe("agent handoff", () => {
  it("creates a one-off scheduled run for the target agent", () => {
    const { targetAgent, sourceRunId } = makeSourceRun();
    const h = createHandoff(sourceRunId, { targetAgentId: targetAgent.id, message: "Please review." });
    expect(h.status).toBe("pending");
    expect(h.target_run_id).toBeTruthy();
    expect(h.target_agent_id).toBe(targetAgent.id);

    // The target run exists, is scheduled, and belongs to the target agent.
    const targetRun = getRunById(h.target_run_id!) as { status: string; agent_id: string };
    expect(targetRun.status).toBe("scheduled");
    expect(targetRun.agent_id).toBe(targetAgent.id);
  });

  it("posts system activity to source and target runs", () => {
    const { targetAgent, sourceRunId } = makeSourceRun();
    const h = createHandoff(sourceRunId, { targetAgentId: targetAgent.id, message: "Please review the migration." });

    const src = listRunActivity(sourceRunId) as { author_type: string; content: string | null }[];
    expect(src.some(a => a.author_type === "system" && (a.content || "").includes("Handed off to"))).toBe(true);
    expect(src.some(a => a.author_type === "system" && (a.content || "").includes("Please review the migration"))).toBe(true);
    const tgt = listRunActivity(h.target_run_id!) as { author_type: string; content: string | null }[];
    expect(tgt.some(a => a.author_type === "system" && (a.content || "").includes("Received handoff"))).toBe(true);
  });

  it("the target agent claims the handoff run on its next poll", () => {
    const { targetAgent, sourceRunId } = makeSourceRun();
    const h = createHandoff(sourceRunId, { targetAgentId: targetAgent.id, message: "msg" });
    const claim = getAgentNextRun(targetAgent.id) as { run: { id: string; status: string } } | null;
    expect(claim).toBeTruthy();
    expect(claim!.run.id).toBe(h.target_run_id);
    expect(claim!.run.status).toBe("running");
  });
});

describe("team handoff", () => {
  function setupTeam() {
    const { sourceRunId } = makeSourceRun();
    const team = createTeam("Eng");
    const researcher = createAgent("R");
    const builder = createAgent("B");
    addAgentToTeam(team.id, researcher.id, "researcher");
    addAgentToTeam(team.id, builder.id, "builder");
    return { sourceRunId, team, researcher, builder };
  }

  it("creates a one-off team-assigned job and an agentless scheduled run", () => {
    const { sourceRunId, team } = setupTeam();
    const h = createHandoff(sourceRunId, { targetTeamId: team.id, message: "review" });
    expect(h.target_team_id).toBe(team.id);
    expect(h.target_agent_id).toBeNull();
    const targetRun = getRunById(h.target_run_id!) as { status: string; agent_id: string | null };
    expect(targetRun.status).toBe("scheduled");
    expect(targetRun.agent_id).toBeNull();
  });

  it("a team member without role preference can claim", () => {
    const { sourceRunId, team, researcher } = setupTeam();
    const h = createHandoff(sourceRunId, { targetTeamId: team.id, message: "anyone" });
    const claim = getAgentNextRun(researcher.id) as { run: { id: string; status: string } } | null;
    expect(claim).toBeTruthy();
    expect(claim!.run.id).toBe(h.target_run_id);
    expect(claim!.run.status).toBe("running");
  });

  it("preferred_role routes to a matching member first", () => {
    const { sourceRunId, team, researcher, builder } = setupTeam();
    const h = createHandoff(sourceRunId, { targetTeamId: team.id, targetRole: "builder", message: "code task" });
    // Researcher polling first: must NOT claim (role mismatch + fallback any but builder is idle)
    expect(getAgentNextRun(researcher.id)).toBeNull();
    // Builder polling: claims it
    const claim = getAgentNextRun(builder.id) as { run: { id: string } };
    expect(claim).toBeTruthy();
    expect(claim.run.id).toBe(h.target_run_id);
  });

  it("fallback 'any' lets non-matching members claim once specialists are saturated", () => {
    const { sourceRunId, team, researcher, builder } = setupTeam();
    // Saturate the builder with a direct one-off run first
    const directJob = createJob(builder.id, { name: "direct", schedule: '{"every":60}' });
    triggerJobRun(directJob.id);
    getAgentNextRun(builder.id); // builder now has 1 running (cap = 1)

    // Now post a team handoff preferring builder; researcher should be allowed to claim
    // because every role-matching teammate is at capacity.
    createHandoff(sourceRunId, { targetTeamId: team.id, targetRole: "builder", message: "any-fallback" });
    const claim = getAgentNextRun(researcher.id);
    expect(claim).toBeTruthy();
  });
});

describe("handoff status", () => {
  it("transitions pending → accepted when the target run starts running", () => {
    const { targetAgent, sourceRunId } = makeSourceRun();
    const h = createHandoff(sourceRunId, { targetAgentId: targetAgent.id, message: "go" });
    expect(getHandoffById(h.id)!.status).toBe("pending");

    updateRunStatus(h.target_run_id!, "running");
    expect(getHandoffById(h.id)!.status).toBe("accepted");
  });

  it("transitions accepted → completed when the target run reaches done", () => {
    const { targetAgent, sourceRunId } = makeSourceRun();
    const h = createHandoff(sourceRunId, { targetAgentId: targetAgent.id, message: "go" });
    updateRunStatus(h.target_run_id!, "running");
    updateRunStatus(h.target_run_id!, "done");
    expect(getHandoffById(h.id)!.status).toBe("completed");
  });

  it("does NOT auto-transition on failed / killed / skipped", () => {
    const { targetAgent, sourceRunId } = makeSourceRun();
    const h = createHandoff(sourceRunId, { targetAgentId: targetAgent.id, message: "go" });
    updateRunStatus(h.target_run_id!, "running");
    updateRunStatus(h.target_run_id!, "failed");
    expect(getHandoffById(h.id)!.status).toBe("accepted");
  });
});

describe("handoff safety", () => {
  it("rejects empty message", () => {
    const { targetAgent, sourceRunId } = makeSourceRun();
    expect(() => createHandoff(sourceRunId, { targetAgentId: targetAgent.id, message: "" })).toThrow();
    expect(() => createHandoff(sourceRunId, { targetAgentId: targetAgent.id, message: "   " })).toThrow();
  });

  it("rejects both targetAgentId and targetTeamId set", () => {
    const { targetAgent, sourceRunId } = makeSourceRun();
    const team = createTeam("T");
    expect(() => createHandoff(sourceRunId, { targetAgentId: targetAgent.id, targetTeamId: team.id, message: "x" })).toThrow();
  });

  it("rejects neither target set", () => {
    const { sourceRunId } = makeSourceRun();
    expect(() => createHandoff(sourceRunId, { message: "x" })).toThrow();
  });

  it("source run deletion leaves the handoff visible via snapshots", () => {
    const { targetAgent, sourceRunId, sourceAgent } = makeSourceRun();
    const h = createHandoff(sourceRunId, { targetAgentId: targetAgent.id, message: "before deletion" });
    expect(h.source_run_name_snapshot).toBe("source job");
    expect(h.source_agent_name_snapshot).toBe(sourceAgent.name);

    deleteRun(sourceRunId);

    // Incoming view on the target run still shows the source via snapshots.
    const incoming = listIncomingHandoff(h.target_run_id!);
    expect(incoming).not.toBeNull();
    expect(incoming!.source_run_id).toBeNull(); // FK was SET NULL
    expect(incoming!.source_run_name_snapshot).toBe("source job");
    expect(incoming!.source_agent_name_snapshot).toBe(sourceAgent.name);
    expect(incoming!.message).toBe("before deletion");
  });

  // M8 regression: identical handoff POSTs (retried request, agent retry loop)
  // must be idempotent — they should return the SAME handoff/target run, not
  // spawn duplicate target runs every time.
  it("createHandoffAsync is idempotent on identical (source, target, message)", async () => {
    const { createHandoffAsync } = await import("@/lib/db/queries");
    const { targetAgent, sourceRunId } = makeSourceRun();
    const first = await createHandoffAsync(sourceRunId, { targetAgentId: targetAgent.id, message: "duplicate me" });
    const second = await createHandoffAsync(sourceRunId, { targetAgentId: targetAgent.id, message: "duplicate me" });
    expect(second.id).toBe(first.id);
    expect(second.target_run_id).toBe(first.target_run_id);

    // A different message produces a distinct handoff.
    const different = await createHandoffAsync(sourceRunId, { targetAgentId: targetAgent.id, message: "but this is new" });
    expect(different.id).not.toBe(first.id);
    expect(different.target_run_id).not.toBe(first.target_run_id);
  });

  it("listOutgoingHandoffs returns the handoff with join fields", () => {
    const { targetAgent, sourceRunId } = makeSourceRun();
    createHandoff(sourceRunId, { targetAgentId: targetAgent.id, message: "for the list" });
    const outgoing = listOutgoingHandoffs(sourceRunId) as { target_agent_name: string; status: string }[];
    expect(outgoing.length).toBe(1);
    expect(outgoing[0].target_agent_name).toBe(targetAgent.name);
    expect(outgoing[0].status).toBe("pending");
  });
});
