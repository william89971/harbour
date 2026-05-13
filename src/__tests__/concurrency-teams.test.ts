/**
 * Per-agent concurrency + multi-agent teams with role routing.
 *
 * Covers:
 *  - default max_concurrent_runs = 1 (regression guard)
 *  - validation of max_concurrent_runs range (1..10)
 *  - capacity gate in getAgentNextRun
 *  - team CRUD + member roles (M:N)
 *  - team-job routing with preferred_role + role_fallback semantics
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { setDb, resetDb, initializeSchema } from "@/lib/db/schema";
import {
  createAgent, updateAgent, getAgentById,
  createJob, triggerJobRun, updateJob, getAgentNextRun,
  updateRunStatus,
  createTeam, getTeamById, listTeams, updateTeam, deleteTeam,
  addAgentToTeam, removeAgentFromTeam, listAgentsInTeam, listTeamsForAgent, setAgentRoleInTeam,
} from "@/lib/db/queries";

/** Force a job's next_run_at to "now" so the claim SQL picks it up. */
function makeDue(jobId: string) {
  updateJob(jobId, { nextRunAt: Math.floor(Date.now() / 1000) });
}

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

describe("max_concurrent_runs", () => {
  it("defaults to 1 on new agents", () => {
    const agent = createAgent("alice");
    const fetched = getAgentById(agent.id);
    expect(fetched.max_concurrent_runs).toBe(1);
  });

  it("accepts an explicit value within 1..10", () => {
    const agent = createAgent("bob", undefined, { maxConcurrentRuns: 5 });
    expect(agent.max_concurrent_runs).toBe(5);
  });

  it("rejects values outside 1..10 on create", () => {
    expect(() => createAgent("c", undefined, { maxConcurrentRuns: 0 })).toThrow();
    expect(() => createAgent("d", undefined, { maxConcurrentRuns: 11 })).toThrow();
    expect(() => createAgent("e", undefined, { maxConcurrentRuns: -1 })).toThrow();
  });

  it("rejects values outside 1..10 on update", () => {
    const a = createAgent("f");
    expect(() => updateAgent(a.id, { maxConcurrentRuns: 100 })).toThrow();
  });

  it("clamps non-integer input", () => {
    const a = createAgent("g");
    const updated = updateAgent(a.id, { maxConcurrentRuns: 3.7 });
    expect(updated.max_concurrent_runs).toBe(3);
  });
});

describe("capacity gate", () => {
  it("blocks a second claim when max_concurrent_runs = 1 and a run is active", () => {
    const agent = createAgent("solo");
    const job = createJob(agent.id, { name: "j1", schedule: '{"every":60}' });
    triggerJobRun(job.id);
    triggerJobRun(job.id);

    const first = getAgentNextRun(agent.id);
    expect(first).toBeTruthy();
    expect(first?.run.status).toBe("running");

    // Second poll should return null — agent at capacity (1 running)
    const second = getAgentNextRun(agent.id);
    expect(second).toBeNull();
  });

  it("allows N parallel claims when max_concurrent_runs = N", () => {
    const agent = createAgent("multi", undefined, { maxConcurrentRuns: 3 });
    const job = createJob(agent.id, { name: "j1", schedule: '{"every":60}' });
    triggerJobRun(job.id);
    triggerJobRun(job.id);
    triggerJobRun(job.id);
    triggerJobRun(job.id);

    const claims = [
      getAgentNextRun(agent.id),
      getAgentNextRun(agent.id),
      getAgentNextRun(agent.id),
      getAgentNextRun(agent.id),
    ];
    const claimed = claims.filter(c => c !== null);
    expect(claimed.length).toBe(3); // exactly maxConcurrentRuns
  });

  it("re-opens capacity once a running run completes", () => {
    const agent = createAgent("recover", undefined, { maxConcurrentRuns: 1 });
    const job = createJob(agent.id, { name: "j", schedule: '{"every":60}' });
    triggerJobRun(job.id);
    triggerJobRun(job.id);

    const first = getAgentNextRun(agent.id);
    expect(first).toBeTruthy();
    expect(getAgentNextRun(agent.id)).toBeNull();

    // Finish the first run
    updateRunStatus(first!.run.id, "done");

    const second = getAgentNextRun(agent.id);
    expect(second).toBeTruthy();
  });
});

describe("teams CRUD + membership", () => {
  it("creates, fetches, updates, and deletes a team", () => {
    const t = createTeam("Engineering", "Backend services");
    expect(t.name).toBe("Engineering");
    expect(t.description).toBe("Backend services");

    const fetched = getTeamById(t.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.name).toBe("Engineering");

    const updated = updateTeam(t.id, { name: "Eng" });
    expect(updated!.name).toBe("Eng");

    deleteTeam(t.id);
    expect(getTeamById(t.id)).toBeNull();
  });

  it("lists teams ordered by name", () => {
    createTeam("Zeta");
    createTeam("Alpha");
    createTeam("Mu");
    const teams = listTeams();
    expect(teams.map((t: { name: string }) => t.name)).toEqual(["Alpha", "Mu", "Zeta"]);
  });

  it("adds agents to a team with roles", () => {
    const team = createTeam("eng");
    const a = createAgent("alice");
    const b = createAgent("bob");
    addAgentToTeam(team.id, a.id, "researcher");
    addAgentToTeam(team.id, b.id, "builder");

    const members = listAgentsInTeam(team.id);
    expect(members.length).toBe(2);
    expect(members.find(m => m.agent_id === a.id)?.role).toBe("researcher");
    expect(members.find(m => m.agent_id === b.id)?.role).toBe("builder");
  });

  it("supports an agent in multiple teams with different roles", () => {
    const a = createAgent("polyglot");
    const t1 = createTeam("backend");
    const t2 = createTeam("frontend");
    addAgentToTeam(t1.id, a.id, "builder");
    addAgentToTeam(t2.id, a.id, "reviewer");

    const teams = listTeamsForAgent(a.id);
    expect(teams.length).toBe(2);
    const backend = teams.find(t => t.id === t1.id);
    const frontend = teams.find(t => t.id === t2.id);
    expect(backend?.role).toBe("builder");
    expect(frontend?.role).toBe("reviewer");
  });

  it("supports custom roles with a label", () => {
    const team = createTeam("ops");
    const a = createAgent("oncall");
    addAgentToTeam(team.id, a.id, "custom", "On-call SRE");

    const members = listAgentsInTeam(team.id);
    expect(members[0].role).toBe("custom");
    expect(members[0].custom_role).toBe("On-call SRE");
  });

  it("rejects custom role without a label", () => {
    const team = createTeam("ops");
    const a = createAgent("oncall");
    expect(() => addAgentToTeam(team.id, a.id, "custom")).toThrow();
  });

  it("rejects unknown roles", () => {
    const team = createTeam("ops");
    const a = createAgent("oncall");
    expect(() => addAgentToTeam(team.id, a.id, "ninja")).toThrow();
  });

  it("changes an agent's role via setAgentRoleInTeam", () => {
    const team = createTeam("eng");
    const a = createAgent("alice");
    addAgentToTeam(team.id, a.id, "researcher");
    setAgentRoleInTeam(team.id, a.id, "builder");
    const members = listAgentsInTeam(team.id);
    expect(members[0].role).toBe("builder");
  });

  it("removes an agent from a team", () => {
    const team = createTeam("eng");
    const a = createAgent("alice");
    addAgentToTeam(team.id, a.id, "researcher");
    removeAgentFromTeam(team.id, a.id);
    expect(listAgentsInTeam(team.id).length).toBe(0);
  });
});

describe("team-job routing", () => {
  function setup() {
    const team = createTeam("eng");
    const researcher = createAgent("R");
    const builder = createAgent("B");
    const reviewer = createAgent("V");
    addAgentToTeam(team.id, researcher.id, "researcher");
    addAgentToTeam(team.id, builder.id, "builder");
    addAgentToTeam(team.id, reviewer.id, "reviewer");
    return { team, researcher, builder, reviewer };
  }

  it("routes a preferred_role=builder job to the builder", () => {
    const { team, researcher, builder, reviewer } = setup();
    const job = createJob(null, {
      name: "code task",
      schedule: '{"every":60}',
      teamId: team.id,
      preferredRole: "builder",
      roleFallback: "any",
    });
    expect(job).toBeTruthy();
    makeDue(job.id);

    // Researcher polls first — should NOT claim (preferred_role mismatch, fallback would
    // only allow if builder is at capacity, but builder is idle)
    const rPoll = getAgentNextRun(researcher.id);
    expect(rPoll).toBeNull();

    // Reviewer also should not claim for the same reason
    const vPoll = getAgentNextRun(reviewer.id);
    expect(vPoll).toBeNull();

    // Builder polls — should claim
    const bPoll = getAgentNextRun(builder.id);
    expect(bPoll).toBeTruthy();
    expect(bPoll!.run.status).toBe("running");
  });

  it("fallback='any' opens to non-matching members when role-matching is at capacity", () => {
    const { team, researcher, builder } = setup();
    // Saturate builder first
    const directJob = createJob(builder.id, { name: "direct", schedule: '{"every":60}' });
    triggerJobRun(directJob.id);
    const claimed = getAgentNextRun(builder.id);
    expect(claimed).toBeTruthy(); // builder now has 1 running

    // Team job with preferred_role=builder, fallback=any
    const tj = createJob(null, {
      name: "team task",
      schedule: '{"every":60}',
      teamId: team.id,
      preferredRole: "builder",
      roleFallback: "any",
    });
    makeDue(tj.id);

    // Researcher should NOW be able to claim it (builder is saturated at default cap=1)
    const rPoll = getAgentNextRun(researcher.id);
    expect(rPoll).toBeTruthy();
  });

  it("fallback='wait' keeps the job queued until role-matching agent has capacity", () => {
    const { team, researcher, builder } = setup();
    // Saturate builder
    const directJob = createJob(builder.id, { name: "direct", schedule: '{"every":60}' });
    triggerJobRun(directJob.id);
    getAgentNextRun(builder.id);

    // Team job preferring builder, fallback=wait
    const tj = createJob(null, {
      name: "wait task",
      schedule: '{"every":60}',
      teamId: team.id,
      preferredRole: "builder",
      roleFallback: "wait",
    });
    makeDue(tj.id);

    // Researcher must NOT claim it even though builder is at capacity
    const rPoll = getAgentNextRun(researcher.id);
    expect(rPoll).toBeNull();
  });

  it("preferred_role IS NULL lets any team member claim", () => {
    const { team, researcher } = setup();
    const tj = createJob(null, {
      name: "anyone",
      schedule: '{"every":60}',
      teamId: team.id,
      preferredRole: null,
      roleFallback: "any",
    });
    makeDue(tj.id);
    const claim = getAgentNextRun(researcher.id);
    expect(claim).toBeTruthy();
  });

  it("direct-assigned jobs continue to work alongside team jobs (regression)", () => {
    const { team, builder } = setup();
    const directJob = createJob(builder.id, { name: "direct", schedule: '{"every":60}' });
    makeDue(directJob.id);
    const tj = createJob(null, { name: "team", schedule: '{"every":60}', teamId: team.id });
    makeDue(tj.id);
    // Builder polls — should claim its direct job first
    const claim = getAgentNextRun(builder.id);
    expect(claim).toBeTruthy();
    expect(claim!.job.id).toBe(directJob.id);
  });
});

describe("job assignment validation", () => {
  it("rejects a job with both agentId and teamId", () => {
    const agent = createAgent("a");
    const team = createTeam("t");
    expect(() => createJob(agent.id, { name: "x", schedule: '{"every":60}', teamId: team.id })).toThrow();
  });

  it("rejects a non-workflow job with neither agent nor team", () => {
    expect(() => createJob(null, { name: "x", schedule: '{"every":60}' })).toThrow();
  });

  it("allows a workflow-only job with no agent and no team", () => {
    expect(() => createJob(null, { name: "x", schedule: '{"every":60}', workflowOnly: true, workflowCommand: "echo hi" })).not.toThrow();
  });
});
