/**
 * Growth Outreach Loop — install / uninstall helpers.
 *
 * Seeds:
 *   - "Growth Researcher" Custom Shell harbour agent
 *   - "Growth Outreach Loop" workflow with two steps (Gather + Draft)
 *
 * Mirrors bin/lib/product-review.mjs: requires HARBOUR_ADMIN_API_KEY in env,
 * uses the harbour HTTP API so it works on SQLite + Postgres installs.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getHarbourDir, ensureDir, loadRunnerConfigs } from "./config.mjs";

const AGENT_NAME = "Growth Researcher";
const WORKFLOW_NAME = "Growth Outreach Loop";
const SCRIPT_FILENAME = "growth-researcher.mjs";

const STEP_GATHER_INSTRUCTIONS = `GROWTH_PHASE: gather

Gather the current Harbour growth state (new/researched contacts, prospect companies, open outreach drafts) and post it as run activity.`;

const STEP_DRAFT_INSTRUCTIONS = `GROWTH_PHASE: draft

User notes:
{{input.notes}}

Using the notes above, emit a structured proposal of outreach drafts in a fenced \`\`\`json proposal\`\`\` block. The operator will review and selectively save each draft during the after-step approval gate.`;

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
    console.error("Create one in the dashboard: Settings → Admin API Keys → New Key.");
    console.error("Then re-run: HARBOUR_ADMIN_API_KEY=<key> npm run harbour -- growth-outreach install");
    process.exit(1);
  }
  return key;
}

async function listAgents(url, key) {
  const r = await fetch(`${url}/api/agents`, { headers: { Authorization: `Bearer ${key}` } });
  if (!r.ok) throw new Error(`GET /api/agents returned HTTP ${r.status}`);
  return r.json();
}

async function listWorkflows(url, key) {
  const r = await fetch(`${url}/api/workflows`, { headers: { Authorization: `Bearer ${key}` } });
  if (!r.ok) throw new Error(`GET /api/workflows returned HTTP ${r.status}`);
  return r.json();
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
  const body = {
    name: AGENT_NAME,
    description: "Built-in Custom Shell agent that powers the Growth Outreach Loop.",
    type: "harbour",
    cli: "shell",
    shellCommand: `node ${installedScript()}`,
    permissionMode: "unrestricted",
  };
  const r = await fetch(`${url}/api/agents`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`POST /api/agents failed: HTTP ${r.status} ${await r.text()}`);
  const agent = await r.json();
  console.log(`Created agent "${AGENT_NAME}" (id ${agent.id}).`);
  return agent.id;
}

async function postStep(url, key, workflowId, body) {
  const r = await fetch(`${url}/api/workflows/${workflowId}/steps`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`POST /api/workflows/${workflowId}/steps failed: HTTP ${r.status} ${await r.text()}`);
  return r.json();
}

async function ensureWorkflow(url, key, agentId) {
  const workflows = await listWorkflows(url, key);
  const existing = workflows.find(w => w.name === WORKFLOW_NAME);
  if (existing) {
    console.log(`Workflow "${WORKFLOW_NAME}" already exists (id ${existing.id}).`);
    console.log("Run `npm run harbour -- growth-outreach uninstall` first for a clean reinstall.");
    return existing.id;
  }
  const r = await fetch(`${url}/api/workflows`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: WORKFLOW_NAME,
      description: "Research prospects, draft outreach, gate approval. Outreach Draft rows land in /outreach.",
      autonomyLevel: "supervised",
      status: "active",
    }),
  });
  if (!r.ok) throw new Error(`POST /api/workflows failed: HTTP ${r.status} ${await r.text()}`);
  const wf = await r.json();
  await postStep(url, key, wf.id, {
    name: "Gather prospects",
    instructions: STEP_GATHER_INSTRUCTIONS,
    assignedAgentId: agentId,
    requiresHumanApproval: false,
    approvalType: "none",
    risky: false,
  });
  await postStep(url, key, wf.id, {
    name: "Draft outreach",
    instructions: STEP_DRAFT_INSTRUCTIONS,
    assignedAgentId: agentId,
    requiresHumanApproval: true,
    approvalType: "after_step",
    risky: true,
  });
  console.log(`Created workflow "${WORKFLOW_NAME}" (id ${wf.id}) with 2 steps.`);
  return wf.id;
}

export async function installGrowthOutreach() {
  const url = resolveServerUrl();
  if (!url) {
    console.error("Cannot determine the harbour server URL. Set HARBOUR_URL and retry.");
    process.exit(1);
  }
  const apiKey = requireAdminKey();
  const dst = copyScript();
  console.log(`Copied script to ${dst}`);
  const agentId = await ensureAgent(url, apiKey);
  const wfId = await ensureWorkflow(url, apiKey, agentId);
  console.log("");
  console.log(`Done. Start a Growth Outreach run from ${url}/workflows/${wfId}`);
  console.log(`Each Draft step pauses for review. Approved drafts land in ${url}/outreach.`);
}

export async function uninstallGrowthOutreach({ keepScript = false } = {}) {
  const url = resolveServerUrl();
  if (!url) {
    console.error("Cannot determine the harbour server URL. Set HARBOUR_URL and retry.");
    process.exit(1);
  }
  const apiKey = requireAdminKey();

  const workflows = await listWorkflows(url, apiKey);
  for (const w of workflows.filter(w => w.name === WORKFLOW_NAME)) {
    const r = await fetch(`${url}/api/workflows/${w.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!r.ok) console.error(`Failed to delete workflow ${w.id}: HTTP ${r.status}`);
    else console.log(`Deleted workflow ${w.id}.`);
  }

  const agents = await listAgents(url, apiKey);
  for (const a of agents.filter(a => a.name === AGENT_NAME)) {
    const r = await fetch(`${url}/api/agents/${a.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!r.ok) console.error(`Failed to delete agent ${a.id}: HTTP ${r.status}`);
    else console.log(`Deleted agent ${a.id}.`);
  }

  if (!keepScript) {
    const dst = installedScript();
    if (fs.existsSync(dst)) {
      fs.rmSync(dst);
      console.log(`Removed ${dst}.`);
    }
  }
}

export function growthOutreachStatus() {
  const dst = installedScript();
  console.log(`Script: ${fs.existsSync(dst) ? "installed" : "not installed"} (${dst})`);
  console.log(`Use \`npm run harbour -- growth-outreach install\` to create the workflow + agent.`);
}
