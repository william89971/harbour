/**
 * Product Review Loop — script formatters, proposal extraction, and the
 * save-proposal API endpoint.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import { setDb, resetDb, initializeSchema, getDb } from "@/lib/db/schema";
import {
  createUserAsync,
  createSession,
  createAgent,
  createWorkflow,
  createWorkflowStep,
  listTasksAsync,
  listDecisionsAsync,
} from "@/lib/db/queries";
import { POST as saveProposalPost } from "@/app/api/workflow-runs/[id]/save-proposal/route";
import { extractProposal } from "@/components/app/product-review-proposal-panel";
// @ts-expect-error -- pure .mjs script, no types
import { detectPhase, extractNotes, gatherMarkdown, draftProposal, draftMarkdown } from "../../bin/workflows/product-reviewer.mjs";
import { v4 as uuid } from "uuid";

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

// ---------------------------------------------------------------------------
// Script-pure functions
// ---------------------------------------------------------------------------

describe("product-reviewer script formatters", () => {
  it("detects gather + draft phase from instructions", () => {
    expect(detectPhase("PRODUCT_REVIEW_PHASE: gather\n\netc.")).toBe("gather");
    expect(detectPhase("PRODUCT_REVIEW_PHASE: draft\n\netc.")).toBe("draft");
    expect(detectPhase("no marker here")).toBeNull();
  });

  it("extracts user notes from rendered draft instructions", () => {
    const rendered = `PRODUCT_REVIEW_PHASE: draft

User notes:
Fix login bug !!
DECISION: Drop legacy API
BLOCKED: Waiting on Stripe?

Using the user notes...`;
    expect(extractNotes(rendered)).toBe("Fix login bug !!\nDECISION: Drop legacy API\nBLOCKED: Waiting on Stripe?");
  });

  it("returns empty notes when section is absent", () => {
    expect(extractNotes("PRODUCT_REVIEW_PHASE: draft\n\nNo notes here.")).toBe("");
  });

  it("gatherMarkdown produces a snapshot + sectioned bundle", () => {
    const md = gatherMarkdown(
      { direction: { activeGoals: 2, openTasks: 3, blockedTasks: 1 }, runningNow: { runs: [] }, failedOrStuck: { runs: [] } },
      [{ title: "Goal A", priority: "high" }, { title: "Goal B", priority: "low", target_date: 2_000_000_000 }],
      [{ title: "Task X", status: "todo", priority: "medium", owner_type: "user", owner_id: "u1", goal_title: "Goal A" }],
      [{ title: "Use SQLite", decision: "Default to SQLite for solo installs." }],
    );
    expect(md).toContain("# Product Review — gathered context");
    expect(md).toContain("Active goals: **2**");
    expect(md).toContain("Open tasks: **3**");
    expect(md).toContain("Blocked tasks: **1**");
    expect(md).toContain("Goal A (high)");
    expect(md).toContain("Task X");
    expect(md).toContain("user:u1");
    expect(md).toContain("goal: Goal A");
    expect(md).toContain("Use SQLite — Default to SQLite for solo installs.");
  });

  it("gatherMarkdown is graceful with no state", () => {
    const md = gatherMarkdown(null, [], [], []);
    expect(md).toContain("(No state captured.");
  });

  it("draftProposal parses notes into tasks + decisions with priority heuristics", () => {
    const notes = `Fix login bug !!
DECISION: Drop the legacy /v1 API on June 1
- Add e2e tests for billing flow
BLOCKED: Waiting on Stripe webhook docs?
DOING: Re-run cost analysis`;
    const proposal = draftProposal(notes);
    expect(proposal.source).toBe("product-review-loop");
    expect(proposal.tasks).toHaveLength(4);
    expect(proposal.decisions).toHaveLength(1);

    const titles = proposal.tasks.map((t: { title: string }) => t.title);
    expect(titles).toContain("Fix login bug");
    expect(titles).toContain("Add e2e tests for billing flow");
    expect(titles).toContain("Waiting on Stripe webhook docs?");
    expect(titles).toContain("Re-run cost analysis");

    const fixLogin = proposal.tasks.find((t: { title: string }) => t.title === "Fix login bug");
    expect(fixLogin?.priority).toBe("high");

    const stripeTask = proposal.tasks.find((t: { title: string }) => t.title.startsWith("Waiting on Stripe"));
    expect(stripeTask?.status).toBe("blocked");
    expect(stripeTask?.priority).toBe("low"); // trailing ? marker

    const doingTask = proposal.tasks.find((t: { title: string }) => t.title === "Re-run cost analysis");
    expect(doingTask?.status).toBe("doing");

    expect(proposal.decisions[0].decision).toBe("Drop the legacy /v1 API on June 1");
  });

  it("draftMarkdown wraps the proposal in a parseable fenced block", () => {
    const proposal = draftProposal("Fix bug");
    const md = draftMarkdown("Fix bug", proposal, { direction: { activeGoals: 1, openTasks: 0, blockedTasks: 0 } });
    expect(md).toContain("# Product Review — proposal");
    expect(md).toContain("```json proposal");
    expect(md).toContain('"source": "product-review-loop"');
  });
});

// ---------------------------------------------------------------------------
// Proposal extraction (the panel's parser)
// ---------------------------------------------------------------------------

describe("extractProposal", () => {
  it("returns the proposal when activity contains a fenced product-review-loop block", () => {
    const proposal = draftProposal("Fix login bug !!\nDECISION: Use SQLite");
    const md = draftMarkdown("Fix login bug !!\nDECISION: Use SQLite", proposal, null);
    const found = extractProposal([{ content: md }]);
    expect(found).not.toBeNull();
    expect(found?.source).toBe("product-review-loop");
    expect(found?.tasks).toHaveLength(1);
    expect(found?.decisions).toHaveLength(1);
  });

  it("returns null when no fenced proposal block is present", () => {
    expect(extractProposal([{ content: "plain output, no fence" }])).toBeNull();
    expect(extractProposal([])).toBeNull();
    expect(extractProposal(undefined)).toBeNull();
  });

  it("picks the most recent proposal when multiple appear in activity", () => {
    const oldP = draftProposal("first");
    const newP = draftProposal("second");
    const old = draftMarkdown("first", oldP, null);
    const fresh = draftMarkdown("second", newP, null);
    const found = extractProposal([{ content: old }, { content: fresh }]);
    expect(found?.tasks[0].title).toBe("second");
  });
});

// ---------------------------------------------------------------------------
// POST /api/workflow-runs/:id/save-proposal
// ---------------------------------------------------------------------------

describe("POST /api/workflow-runs/:id/save-proposal", () => {
  it("creates tasks and decisions, returns the created rows", async () => {
    const u = await createUserAsync("admin@x.com", "test-pw-1!!", "Admin", "admin");
    const sessionId = createSession(u!.id);

    // Seed a workflow + workflow_run row directly. The save-proposal endpoint
    // only validates that the workflow run exists; it doesn't require any
    // specific status when approveWorkflowRun is explicitly false.
    const agent = createAgent("Product Reviewer", "", { type: "harbour", cli: "shell", model: undefined, shellCommand: "echo" });
    const wf = createWorkflow({ name: "Product Review Loop", autonomyLevel: "supervised" });
    createWorkflowStep(wf.id, { name: "Draft", instructions: "...", assignedAgentId: agent.id });
    const wfRunId = uuid();
    getDb()
      .prepare(`INSERT INTO workflow_runs (id, workflow_id, status) VALUES (?, ?, 'running')`)
      .run(wfRunId, wf.id);

    const body = {
      tasks: [
        { title: "Fix login bug", status: "todo", priority: "high" },
        { title: "Write docs", priority: "medium" },
      ],
      decisions: [
        { title: "Drop legacy API", decision: "Drop /v1 on June 1", rationale: "Telemetry shows < 0.1% usage." },
      ],
      approveWorkflowRun: false,
    };
    const req = new NextRequest(`http://x/api/workflow-runs/${wfRunId}/save-proposal`, {
      method: "POST",
      headers: { cookie: `harbour_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const res = await saveProposalPost(req, { params: Promise.resolve({ id: wfRunId }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.created.tasks).toHaveLength(2);
    expect(json.created.decisions).toHaveLength(1);
    expect(json.approvalApplied).toBe(false);

    const tasks = await listTasksAsync();
    expect(tasks.map(t => t.title)).toEqual(expect.arrayContaining(["Fix login bug", "Write docs"]));
    const decisions = await listDecisionsAsync();
    expect(decisions.map(d => d.title)).toContain("Drop legacy API");
  });

  it("rejects empty titles with 400", async () => {
    const u = await createUserAsync("admin@x.com", "test-pw-1!!", "Admin", "admin");
    const sessionId = createSession(u!.id);
    const agent = createAgent("Product Reviewer", "", { type: "harbour", cli: "shell", shellCommand: "echo" });
    const wf = createWorkflow({ name: "Product Review Loop" });
    createWorkflowStep(wf.id, { name: "Draft", instructions: "...", assignedAgentId: agent.id });
    const wfRunId = uuid();
    getDb().prepare(`INSERT INTO workflow_runs (id, workflow_id, status) VALUES (?, ?, 'running')`).run(wfRunId, wf.id);

    const req = new NextRequest(`http://x/api/workflow-runs/${wfRunId}/save-proposal`, {
      method: "POST",
      headers: { cookie: `harbour_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ tasks: [{ title: "" }], decisions: [], approveWorkflowRun: false }),
    });
    const res = await saveProposalPost(req, { params: Promise.resolve({ id: wfRunId }) });
    expect(res.status).toBe(400);
  });

  it("returns 404 when the workflow run does not exist", async () => {
    const u = await createUserAsync("admin@x.com", "test-pw-1!!", "Admin", "admin");
    const sessionId = createSession(u!.id);
    const req = new NextRequest(`http://x/api/workflow-runs/nope/save-proposal`, {
      method: "POST",
      headers: { cookie: `harbour_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ tasks: [], decisions: [], approveWorkflowRun: false }),
    });
    const res = await saveProposalPost(req, { params: Promise.resolve({ id: "nope" }) });
    expect(res.status).toBe(404);
  });
});
