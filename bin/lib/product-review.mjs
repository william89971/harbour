/**
 * Product Review Loop — install / uninstall helpers.
 *
 * Seeds the built-in "Product Reviewer" Custom Shell agent and the
 * "Product Review Loop" workflow (two steps: Gather and Draft) via the
 * harbour HTTP API. Mirrors the brief-install pattern: requires
 * HARBOUR_ADMIN_API_KEY in env, so the same call works on SQLite and
 * Postgres installs.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getHarbourDir, ensureDir, loadRunnerConfigs } from "./config.mjs";

const AGENT_NAME = "Product Reviewer";
const WORKFLOW_NAME = "Product Review Loop";
const SCRIPT_FILENAME = "product-reviewer.mjs";

const STEP_GATHER_INSTRUCTIONS = `PRODUCT_REVIEW_PHASE: gather

Gather the current Harbour state (today snapshot, active goals, open and blocked tasks, recent decisions) and post it as run activity for William's reference.`;

const STEP_DRAFT_INSTRUCTIONS = `PRODUCT_REVIEW_PHASE: draft

User notes:
{{input.notes}}

Using the user notes above plus a fresh snapshot of Harbour state, emit a structured proposal of next tasks and decisions in a fenced \`\`\`json proposal\`\`\` block. William will review and selectively save the proposal during the after-step approval gate.`;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const sourceScript = path.join(repoRoot, "bin", "workflows", SCRIPT_FILENAME);

function workflowsDir() {
  return path.join(getHarbourDir(), "workflows");
}

function installedScript() {
  return path.join(workflowsDir(), SCRIPT_FILENAME);
}

function resolveServerUrl() {
  if (process.env.HARBOUR_URL) return process.env.HARBOUR_URL.replace(/\/$/, "");
  const runners = loadRunnerConfigs();
  if (runners.length > 0 && runners[0].url) return runners[0].url.replace(/\/$/, "");
  return null;
}

function requireAdminKey() {
  const key = process.env.HARBOUR_ADMIN_API_KEY;
  if (!key) {
    console.error("HARBOUR_ADMIN_API_KEY is not set.");
    console.error("");
    console.error("Create one in the dashboard: Settings → Admin API Keys → New Key.");
    console.error("Then re-run: HARBOUR_ADMIN_API_KEY=<key> npm run harbour -- product-review install");
    process.exit(1);
  }
  return key;
}

async function listAgents(url, key) {
  const res = await fetch(`${url}/api/agents`, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`GET /api/agents returned HTTP ${res.status}`);
  return res.json();
}

async function listWorkflows(url, key) {
  const res = await fetch(`${url}/api/workflows`, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`GET /api/workflows returned HTTP ${res.status}`);
  return res.json();
}

function copyScript() {
  if (!fs.existsSync(sourceScript)) {
    console.error(`Cannot find source script at ${sourceScript}`);
    process.exit(1);
  }
  ensureDir();
  fs.mkdirSync(workflowsDir(), { recursive: true });
  const dst = installedScript();
  fs.copyFileSync(sourceScript, dst);
  fs.chmodSync(dst, 0o755);
  return dst;
}

async function ensureAgent(url, key) {
  const agents = await listAgents(url, key);
  const existing = agents.find(a => a.name === AGENT_NAME);
  if (existing) {
    console.log(`Agent "${AGENT_NAME}" already exists (id ${existing.id}).`);
    return existing.id;
  }
  const dst = installedScript();
  const body = {
    name: AGENT_NAME,
    description: "Built-in Custom Shell agent that powers the Product Review Loop workflow.",
    type: "harbour",
    cli: "shell",
    shellCommand: `node ${dst}`,
    permissionMode: "unrestricted",
  };
  const res = await fetch(`${url}/api/agents`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST /api/agents failed: HTTP ${res.status} ${text}`);
  }
  const agent = await res.json();
  console.log(`Created agent "${AGENT_NAME}" (id ${agent.id}).`);
  return agent.id;
}

async function ensureWorkflow(url, key, agentId) {
  const workflows = await listWorkflows(url, key);
  const existing = workflows.find(w => w.name === WORKFLOW_NAME);
  if (existing) {
    console.log(`Workflow "${WORKFLOW_NAME}" already exists (id ${existing.id}).`);
    console.log("Run `npm run harbour -- product-review uninstall` first for a clean reinstall.");
    return existing.id;
  }
  // 1. Create workflow.
  const wfRes = await fetch(`${url}/api/workflows`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: WORKFLOW_NAME,
      description: "Review Harbour state and your notes; produce a proposal of next tasks and decisions for William to approve and save.",
      autonomyLevel: "supervised",
      status: "active",
    }),
  });
  if (!wfRes.ok) {
    const text = await wfRes.text();
    throw new Error(`POST /api/workflows failed: HTTP ${wfRes.status} ${text}`);
  }
  const wf = await wfRes.json();

  // 2. Step 1 — Gather (no approval gate).
  await postStep(url, key, wf.id, {
    name: "Gather context",
    instructions: STEP_GATHER_INSTRUCTIONS,
    assignedAgentId: agentId,
    requiresHumanApproval: false,
    approvalType: "none",
    risky: false,
  });

  // 3. Step 2 — Draft (after-step approval gate).
  await postStep(url, key, wf.id, {
    name: "Draft proposal",
    instructions: STEP_DRAFT_INSTRUCTIONS,
    assignedAgentId: agentId,
    requiresHumanApproval: true,
    approvalType: "after_step",
    risky: true,
  });

  console.log(`Created workflow "${WORKFLOW_NAME}" (id ${wf.id}) with 2 steps.`);
  return wf.id;
}

async function postStep(url, key, workflowId, body) {
  const res = await fetch(`${url}/api/workflows/${workflowId}/steps`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST /api/workflows/${workflowId}/steps failed: HTTP ${res.status} ${text}`);
  }
  return res.json();
}

export async function installProductReview() {
  const url = resolveServerUrl();
  if (!url) {
    console.error("Cannot determine the harbour server URL.");
    console.error("Set HARBOUR_URL=<base-url> and retry, e.g. HARBOUR_URL=http://localhost:3000");
    process.exit(1);
  }
  const apiKey = requireAdminKey();

  const dst = copyScript();
  console.log(`Copied script to ${dst}`);

  const agentId = await ensureAgent(url, apiKey);
  const wfId = await ensureWorkflow(url, apiKey, agentId);

  console.log("");
  console.log(`Done. Start a review from ${url}/workflows/${wfId}`);
  console.log(`When the workflow run pauses for approval, edit the proposed tasks/decisions and click Save & approve.`);
}

export async function uninstallProductReview({ keepScript = false } = {}) {
  const url = resolveServerUrl();
  if (!url) {
    console.error("Cannot determine the harbour server URL. Set HARBOUR_URL and retry.");
    process.exit(1);
  }
  const apiKey = requireAdminKey();

  const workflows = await listWorkflows(url, apiKey);
  for (const w of workflows.filter(w => w.name === WORKFLOW_NAME)) {
    const res = await fetch(`${url}/api/workflows/${w.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`Failed to delete workflow ${w.id}: HTTP ${res.status} ${text}`);
    } else {
      console.log(`Deleted workflow ${w.id}.`);
    }
  }

  const agents = await listAgents(url, apiKey);
  for (const a of agents.filter(a => a.name === AGENT_NAME)) {
    const res = await fetch(`${url}/api/agents/${a.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`Failed to delete agent ${a.id}: HTTP ${res.status} ${text}`);
    } else {
      console.log(`Deleted agent ${a.id}.`);
    }
  }

  if (!keepScript) {
    const dst = installedScript();
    if (fs.existsSync(dst)) {
      fs.rmSync(dst);
      console.log(`Removed ${dst}.`);
    }
  }
}

export function productReviewStatus() {
  const dst = installedScript();
  console.log(`Script: ${fs.existsSync(dst) ? "installed" : "not installed"} (${dst})`);
  console.log(`Use \`npm run harbour -- product-review install\` to create the agent + workflow, or \`uninstall\` to remove them.`);
}
