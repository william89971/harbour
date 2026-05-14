/**
 * Goals + Tasks + Decisions — DB helper CRUD + Today aggregator integration.
 *
 * Exercises both sync and async helpers against in-memory SQLite, plus the
 * ON DELETE SET NULL behavior on tasks.goal_id, and confirms /api/today now
 * surfaces direction counts + recent decisions.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import { setDb, resetDb, initializeSchema, getDb } from "@/lib/db/schema";
import {
  createUserAsync,
  createSession,
  createGoal,
  getGoalById,
  listGoals,
  updateGoal,
  deleteGoal,
  createGoalAsync,
  countGoalsAsync,
  createTask,
  getTaskById,
  listTasks,
  updateTask,
  deleteTask,
  createTaskAsync,
  countTasksByStatusAsync,
  listTasksByGoalAsync,
  createDecision,
  listDecisions,
  updateDecision,
  deleteDecision,
  listRecentDecisionsAsync,
} from "@/lib/db/queries";
import { GET as todayGet } from "@/app/api/today/route";

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

const noCtx = { params: Promise.resolve({} as Record<string, string>) };

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

describe("Goals CRUD", () => {
  it("creates with defaults and reads back", () => {
    const g = createGoal({ title: "Reach 100 customers" });
    expect(g.status).toBe("active");
    expect(g.priority).toBe("medium");
    expect(g.target_date).toBeNull();
    const fetched = getGoalById(g.id);
    expect(fetched?.title).toBe("Reach 100 customers");
  });

  it("respects explicit status/priority/target_date and lists active-first", () => {
    createGoal({ title: "Old", status: "archived", priority: "low" });
    createGoal({ title: "Current", status: "active", priority: "high" });
    const list = listGoals();
    expect(list[0].title).toBe("Current");
  });

  it("updates and deletes", () => {
    const g = createGoal({ title: "Initial", priority: "low" });
    updateGoal(g.id, { status: "completed", priority: "high" });
    const after = getGoalById(g.id);
    expect(after?.status).toBe("completed");
    expect(after?.priority).toBe("high");
    deleteGoal(g.id);
    expect(getGoalById(g.id)).toBeNull();
  });

  it("CHECK constraint rejects invalid status at the DB layer", () => {
    expect(() => {
      getDb().prepare(`INSERT INTO goals (id, title, status) VALUES (?, ?, ?)`).run("x1", "Bad", "nope");
    }).toThrow();
  });

  it("countGoalsAsync filters by status", async () => {
    await createGoalAsync({ title: "A", status: "active" });
    await createGoalAsync({ title: "B", status: "active" });
    await createGoalAsync({ title: "C", status: "archived" });
    expect(await countGoalsAsync("active")).toBe(2);
    expect(await countGoalsAsync("archived")).toBe(1);
    expect(await countGoalsAsync()).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

describe("Tasks CRUD", () => {
  it("creates with defaults and reads back", () => {
    const t = createTask({ title: "Do the thing" });
    expect(t.status).toBe("todo");
    expect(t.priority).toBe("medium");
    expect(t.owner_type).toBe("none");
    expect(t.goal_id).toBeNull();
  });

  it("links to a goal and survives goal deletion (ON DELETE SET NULL)", () => {
    const g = createGoal({ title: "Ship V1" });
    const t = createTask({ title: "Write schema", goalId: g.id });
    expect(t.goal_id).toBe(g.id);

    deleteGoal(g.id);
    const after = getTaskById(t.id);
    expect(after).not.toBeNull();
    expect(after?.goal_id).toBeNull();
  });

  it("listTasks filters by status array and joins goal_title", () => {
    const g = createGoal({ title: "Ship V1" });
    createTask({ title: "Doing one", status: "doing", goalId: g.id });
    createTask({ title: "Blocked one", status: "blocked", goalId: g.id });
    createTask({ title: "Done one", status: "done", goalId: g.id });

    const open = listTasks({ statuses: ["todo", "doing"] });
    expect(open).toHaveLength(1);
    expect(open[0].title).toBe("Doing one");
    expect(open[0].goal_title).toBe("Ship V1");

    const blocked = listTasks({ statuses: ["blocked"] });
    expect(blocked).toHaveLength(1);
  });

  it("countTasksByStatusAsync sums multiple statuses", async () => {
    await createTaskAsync({ title: "1", status: "todo" });
    await createTaskAsync({ title: "2", status: "doing" });
    await createTaskAsync({ title: "3", status: "blocked" });
    expect(await countTasksByStatusAsync(["todo", "doing"])).toBe(2);
    expect(await countTasksByStatusAsync(["blocked"])).toBe(1);
    expect(await countTasksByStatusAsync([])).toBe(0);
  });

  it("listTasksByGoalAsync scopes correctly", async () => {
    const g = createGoal({ title: "Goal X" });
    await createTaskAsync({ title: "in-goal", goalId: g.id });
    await createTaskAsync({ title: "no-goal" });
    const inGoal = await listTasksByGoalAsync(g.id);
    expect(inGoal.map(t => t.title)).toEqual(["in-goal"]);
  });

  it("updates and deletes", () => {
    const t = createTask({ title: "A" });
    updateTask(t.id, { status: "doing", priority: "high", ownerType: "user", ownerId: "u-1" });
    const after = getTaskById(t.id);
    expect(after?.status).toBe("doing");
    expect(after?.owner_type).toBe("user");
    expect(after?.owner_id).toBe("u-1");
    deleteTask(t.id);
    expect(getTaskById(t.id)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

describe("Decisions CRUD", () => {
  it("creates, lists newest-first, updates, deletes", async () => {
    const a = createDecision({ title: "Use SQLite", decision: "Default to SQLite for solo installs." });
    const b = createDecision({ title: "Use Postgres optionally", decision: "Add a DATABASE_URL escape hatch.", rationale: "Team setups need it." });
    const list = listDecisions();
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe(b.id); // newest-first

    const recent = await listRecentDecisionsAsync(1);
    expect(recent).toHaveLength(1);
    expect(recent[0].id).toBe(b.id);

    updateDecision(a.id, { consequences: "Single-file backups." });
    deleteDecision(b.id);
    const afterDelete = listDecisions();
    expect(afterDelete).toHaveLength(1);
    expect(afterDelete[0].consequences).toBe("Single-file backups.");
  });
});

// ---------------------------------------------------------------------------
// /api/today integration
// ---------------------------------------------------------------------------

describe("/api/today direction block", () => {
  it("includes activeGoals + openTasks + blockedTasks + recentDecisions", async () => {
    const u = await createUserAsync("admin@x.com", "test-pw-1!!", "Admin", "admin");
    const sessionId = createSession(u!.id);

    await createGoalAsync({ title: "Goal A", status: "active" });
    await createGoalAsync({ title: "Goal B", status: "active" });
    await createGoalAsync({ title: "Goal C", status: "archived" });
    await createTaskAsync({ title: "T1", status: "todo" });
    await createTaskAsync({ title: "T2", status: "doing" });
    await createTaskAsync({ title: "T3", status: "doing" });
    await createTaskAsync({ title: "T4", status: "blocked" });
    createDecision({ title: "D1", decision: "Chose X over Y" });
    createDecision({ title: "D2", decision: "Chose Z" });

    const headers = new Headers({ cookie: `harbour_session=${sessionId}` });
    const req = new NextRequest("http://x/api/today", { method: "GET", headers });
    const res = await todayGet(req, noCtx);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.direction.activeGoals).toBe(2);
    expect(body.direction.openTasks).toBe(3);
    expect(body.direction.blockedTasks).toBe(1);
    expect(body.direction.recentDecisions).toHaveLength(2);

    // Blocked-tasks suggestion appears.
    expect(body.suggestions.some((s: { id: string }) => s.id === "blocked-tasks")).toBe(true);
  });
});
