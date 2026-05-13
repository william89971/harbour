/**
 * End-to-end route-gate tests.
 *
 * Drives the actual POST handlers for the output + activity endpoints
 * with a real (in-memory SQLite) DB and a real bearer-token agent. The
 * goal is to lock in the tool-permission wiring: when an agent has
 * `can_post_activity = 0`, both endpoints return 403, regardless of how
 * deep into withOperator → withRole → requireAgentOwnership → requireTool
 * the request gets.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import { setDb, resetDb, initializeSchema } from "@/lib/db/schema";
import { createAgent, createOneOffRun, updateAgent } from "@/lib/db/queries";
import { POST as outputPost } from "@/app/api/runs/[id]/output/route";
import { POST as activityPost } from "@/app/api/runs/[id]/activity/route";
import { POST as wfApprovePost } from "@/app/api/workflow-runs/[id]/approve/route";
import { POST as wfRejectPost } from "@/app/api/workflow-runs/[id]/reject/route";
import { POST as wfResumePost } from "@/app/api/workflow-runs/[id]/resume/route";
import { POST as wfCommentPost } from "@/app/api/workflow-runs/[id]/comment/route";
import { POST as wfRequestChangesPost } from "@/app/api/workflow-runs/[id]/request-changes/route";
// Pass-2 routes now user-only; agents must 403 here.
import { POST as autonomyPoliciesPost } from "@/app/api/autonomy/policies/route";
import { POST as agentRotateKeyPost } from "@/app/api/agents/[id]/rotate-key/route";
import { GET as agentSettingsGet, PUT as agentSettingsPut } from "@/app/api/agents/[id]/settings/route";
import { GET as usersGet } from "@/app/api/users/route";
import { GET as settingsGet } from "@/app/api/settings/route";

function freshDb() {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

function bearerRequest(url: string, body: unknown, apiKey: string) {
  return new NextRequest(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  const db = freshDb();
  setDb(db);
  initializeSchema(db);
});

afterEach(() => {
  resetDb();
});

describe("route-level tool-permission gates", () => {
  it("POST /api/runs/:id/output returns 403 when can_post_activity is off", async () => {
    const agent = createAgent("OutBot", "", { type: "harbour", cli: "claude", model: "sonnet" });
    updateAgent(agent.id, { toolPermissions: { post_activity: false } });
    const run = createOneOffRun(agent.id, { name: "test", instructions: "x" });

    const req = bearerRequest(
      `http://test/api/runs/${run.runId}/output`,
      [{ event_type: "text_delta", content: "hi" }],
      agent.apiKey,
    );
    const res = await outputPost(req, { params: Promise.resolve({ id: run.runId }) });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toMatch(/post_activity/);
  });

  it("POST /api/runs/:id/output returns 201 when can_post_activity is on", async () => {
    const agent = createAgent("OutBot", "", { type: "harbour", cli: "claude", model: "sonnet" });
    const run = createOneOffRun(agent.id, { name: "test", instructions: "x" });

    const req = bearerRequest(
      `http://test/api/runs/${run.runId}/output`,
      [{ event_type: "text_delta", content: "hi" }],
      agent.apiKey,
    );
    const res = await outputPost(req, { params: Promise.resolve({ id: run.runId }) });
    expect(res.status).toBe(201);
  });

  it("POST /api/runs/:id/activity returns 403 when can_post_activity is off", async () => {
    const agent = createAgent("ActBot", "", { type: "harbour", cli: "claude", model: "sonnet" });
    updateAgent(agent.id, { toolPermissions: { post_activity: false } });
    const run = createOneOffRun(agent.id, { name: "test", instructions: "x" });

    const req = bearerRequest(
      `http://test/api/runs/${run.runId}/activity`,
      { content: "should be denied" },
      agent.apiKey,
    );
    const res = await activityPost(req, { params: Promise.resolve({ id: run.runId }) });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toMatch(/post_activity/);
  });

  it("rejects unauthenticated callers with 401", async () => {
    const agent = createAgent("AuthBot", "", { type: "harbour", cli: "claude", model: "sonnet" });
    const run = createOneOffRun(agent.id, { name: "test", instructions: "x" });

    const req = new NextRequest(`http://test/api/runs/${run.runId}/output`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ event_type: "text_delta", content: "hi" }]),
    });
    const res = await outputPost(req, { params: Promise.resolve({ id: run.runId }) });
    expect(res.status).toBe(401);
  });

  // H4 regression: workflow-run mutation routes must reject agent callers.
  // withOperator lets agents through (they bypass the role check); we need
  // withUserOperator so agents get 403 and human-in-the-loop is enforced.
  it("rejects agent Bearer tokens on workflow-run mutation routes with 403", async () => {
    const agent = createAgent("WfBot", "", { type: "harbour", cli: "claude", model: "sonnet" });
    const fakeWfRunId = "wf-run-does-not-matter";
    const fakeParams = { params: Promise.resolve({ id: fakeWfRunId }) };

    const routes: Array<[string, (req: NextRequest, ctx: typeof fakeParams) => Promise<Response>, unknown]> = [
      ["approve", wfApprovePost, { comment: "should fail" }],
      ["reject", wfRejectPost, { comment: "should fail" }],
      ["resume", wfResumePost, {}],
      ["comment", wfCommentPost, { content: "should fail" }],
      ["request-changes", wfRequestChangesPost, { comment: "needs more", extraInstructions: "x" }],
    ];

    for (const [name, handler, body] of routes) {
      const req = bearerRequest(`http://test/api/workflow-runs/${fakeWfRunId}/${name}`, body, agent.apiKey);
      const res = await handler(req, fakeParams);
      // The route must reject before touching the workflow run row, so the
      // status is 403 regardless of whether the run id resolves to a real row.
      expect(res.status, `${name} route should reject agent caller`).toBe(403);
    }
  });

  // Pass-2 H4/H5/H6/C1/M6/M7 regression: routes that should be user-only
  // must reject agent Bearer tokens with 403 (NOT 200). Pre-Pass-2 these
  // routes used withOperator/withAdmin which let agents bypass.
  it("rejects agent Bearer tokens on user-only management routes with 403", async () => {
    const agent = createAgent("LockedOut", "", { type: "harbour", cli: "claude", model: "sonnet" });

    // POST /api/autonomy/policies — should require admin USER, not agent.
    {
      const req = bearerRequest("http://test/api/autonomy/policies", { name: "x", scope_type: "global" }, agent.apiKey);
      const res = await autonomyPoliciesPost(req, { params: Promise.resolve({}) });
      expect(res.status, "autonomy policies create").toBe(403);
    }

    // POST /api/agents/:id/rotate-key — should require operator USER.
    {
      const req = bearerRequest(`http://test/api/agents/${agent.id}/rotate-key`, {}, agent.apiKey);
      const res = await agentRotateKeyPost(req, { params: Promise.resolve({ id: agent.id }) });
      expect(res.status, "agent rotate-key").toBe(403);
    }

    // GET /api/agents/:id/settings — should require operator USER.
    {
      const req = bearerRequest(`http://test/api/agents/${agent.id}/settings`, undefined, agent.apiKey);
      const res = await agentSettingsGet(req, { params: Promise.resolve({ id: agent.id }) });
      expect(res.status, "agent settings GET").toBe(403);
    }

    // PUT /api/agents/:id/settings — should require operator USER.
    {
      const req = bearerRequest(`http://test/api/agents/${agent.id}/settings`,
        { contents: '{"permissions":{}}' }, agent.apiKey);
      const res = await agentSettingsPut(req, { params: Promise.resolve({ id: agent.id }) });
      expect(res.status, "agent settings PUT").toBe(403);
    }

    // GET /api/users — should require USER auth.
    {
      const req = bearerRequest("http://test/api/users", undefined, agent.apiKey);
      const res = await usersGet(req, { params: Promise.resolve({}) });
      expect(res.status, "users list").toBe(403);
    }

    // GET /api/settings — should require USER auth.
    {
      const req = bearerRequest("http://test/api/settings", undefined, agent.apiKey);
      const res = await settingsGet(req, { params: Promise.resolve({}) });
      expect(res.status, "settings GET").toBe(403);
    }
  });

  it("rejects an agent calling another agent's run with 403 (requireAgentOwnership)", async () => {
    const agentA = createAgent("Owner", "", { type: "harbour", cli: "claude", model: "sonnet" });
    const agentB = createAgent("Other", "", { type: "harbour", cli: "claude", model: "sonnet" });
    const run = createOneOffRun(agentA.id, { name: "test", instructions: "x" });

    const req = bearerRequest(
      `http://test/api/runs/${run.runId}/output`,
      [{ event_type: "text_delta", content: "hi" }],
      agentB.apiKey,
    );
    const res = await outputPost(req, { params: Promise.resolve({ id: run.runId }) });
    expect(res.status).toBe(403);
  });
});
