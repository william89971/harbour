import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { setDb, resetDb, initializeSchema } from "@/lib/db/schema";
import { createAgent, createJob, createRun } from "@/lib/db/queries";
import {
  recordRunCost,
  getRunCost,
  sumCostsByAgent,
  sumCostsByJob,
  sumCostsByProject,
  sumCostsTotal,
  topAgentsByCost,
  topJobsByCost,
  breakdownByModel,
} from "@/lib/db/costs";
import { createProject, linkJobToProject } from "@/lib/db/projects";

function freshDb(): Database.Database {
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

describe("run_costs", () => {
  it("records cost with USD estimate for known model", () => {
    const agent = createAgent("bot", "desc");
    const job = createJob(agent!.id, { name: "Job A", schedule: '{"every":60}' });
    const run = createRun(job.id, agent!.id);

    const cost = recordRunCost(run!.id, {
      provider: "claude",
      model: "sonnet",
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
    });

    expect(cost).not.toBeNull();
    expect(cost!.input_tokens).toBe(1_000_000);
    expect(cost!.output_tokens).toBe(1_000_000);
    expect(cost!.total_tokens).toBe(2_000_000);
    expect(cost!.estimated_cost_usd).toBeCloseTo(18, 5);
    expect(cost!.pricing_known).toBe(1);
  });

  it("stores tokens with null USD when pricing unknown", () => {
    const agent = createAgent("bot2", "desc");
    const job = createJob(agent!.id, { name: "Job B", schedule: '{"every":60}' });
    const run = createRun(job.id, agent!.id);

    const cost = recordRunCost(run!.id, {
      provider: "claude",
      model: "fake-model",
      input_tokens: 5000,
      output_tokens: 1000,
    });

    expect(cost).not.toBeNull();
    expect(cost!.input_tokens).toBe(5000);
    expect(cost!.estimated_cost_usd).toBeNull();
    expect(cost!.pricing_known).toBe(0);
  });

  it("is idempotent — second call replaces the row", () => {
    const agent = createAgent("bot3", "desc");
    const job = createJob(agent!.id, { name: "Job C", schedule: '{"every":60}' });
    const run = createRun(job.id, agent!.id);

    recordRunCost(run!.id, { provider: "claude", model: "sonnet", input_tokens: 100, output_tokens: 100 });
    recordRunCost(run!.id, { provider: "claude", model: "sonnet", input_tokens: 200, output_tokens: 300 });

    const stored = getRunCost(run!.id);
    expect(stored!.input_tokens).toBe(200);
    expect(stored!.output_tokens).toBe(300);
  });

  it("aggregates by agent, job, and project", () => {
    const agent = createAgent("bot4", "desc");
    const job = createJob(agent!.id, { name: "Job D", schedule: '{"every":60}' });
    const run1 = createRun(job.id, agent!.id);
    const run2 = createRun(job.id, agent!.id);

    recordRunCost(run1!.id, { provider: "claude", model: "sonnet", input_tokens: 1_000_000, output_tokens: 0 });
    recordRunCost(run2!.id, { provider: "claude", model: "sonnet", input_tokens: 1_000_000, output_tokens: 0 });

    const byAgent = sumCostsByAgent(agent!.id);
    expect(byAgent.total_cost_usd).toBeCloseTo(6, 5); // 2 runs * $3
    expect(byAgent.run_count).toBe(2);

    const byJob = sumCostsByJob(job.id);
    expect(byJob.total_cost_usd).toBeCloseTo(6, 5);

    const project = createProject("P1");
    linkJobToProject(project.id, job.id);
    const byProject = sumCostsByProject(project.id);
    expect(byProject.total_cost_usd).toBeCloseTo(6, 5);

    const total = sumCostsTotal();
    expect(total.total_cost_usd).toBeCloseTo(6, 5);
  });

  it("breakdownByModel groups by provider/model", () => {
    const agent = createAgent("bot5", "desc");
    const job = createJob(agent!.id, { name: "Job E", schedule: '{"every":60}' });
    const r1 = createRun(job.id, agent!.id);
    const r2 = createRun(job.id, agent!.id);

    recordRunCost(r1!.id, { provider: "claude", model: "sonnet", input_tokens: 100, output_tokens: 0 });
    recordRunCost(r2!.id, { provider: "claude", model: "opus", input_tokens: 100, output_tokens: 0 });

    const rows = breakdownByModel();
    expect(rows.length).toBe(2);
    expect(rows[0].total_cost_usd).toBeGreaterThan(rows[1].total_cost_usd);
  });

  it("topAgentsByCost and topJobsByCost return ordered lists", () => {
    const agentA = createAgent("agent-a", "desc");
    const agentB = createAgent("agent-b", "desc");
    const jobA = createJob(agentA!.id, { name: "JA", schedule: '{"every":60}' });
    const jobB = createJob(agentB!.id, { name: "JB", schedule: '{"every":60}' });
    const r1 = createRun(jobA.id, agentA!.id);
    const r2 = createRun(jobB.id, agentB!.id);

    recordRunCost(r1!.id, { provider: "claude", model: "sonnet", input_tokens: 1_000_000, output_tokens: 0 });
    recordRunCost(r2!.id, { provider: "claude", model: "opus", input_tokens: 1_000_000, output_tokens: 0 });

    const topAgents = topAgentsByCost(10);
    expect(topAgents[0].agent_id).toBe(agentB!.id); // opus is more expensive
    expect(topAgents[1].agent_id).toBe(agentA!.id);

    const topJobs = topJobsByCost(10);
    expect(topJobs[0].job_id).toBe(jobB.id);
  });

  it("unknown_pricing_runs counts rows without pricing", () => {
    const agent = createAgent("bot6", "desc");
    const job = createJob(agent!.id, { name: "Job F", schedule: '{"every":60}' });
    const r1 = createRun(job.id, agent!.id);
    const r2 = createRun(job.id, agent!.id);

    recordRunCost(r1!.id, { provider: "claude", model: "sonnet", input_tokens: 100, output_tokens: 100 });
    recordRunCost(r2!.id, { provider: "claude", model: "mystery-model", input_tokens: 100, output_tokens: 100 });

    const total = sumCostsTotal();
    expect(total.unknown_pricing_runs).toBe(1);
    expect(total.run_count).toBe(2);
  });
});
