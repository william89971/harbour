/**
 * Daily Founder Brief — install / uninstall helpers.
 *
 * The CLI subcommand:
 *   1. Copies bin/workflows/founder-brief.mjs into ~/.harbour/workflows/.
 *   2. Creates (or removes) a workflow-only job named "Daily Founder Brief"
 *      via POST/DELETE /api/jobs using an admin API key (env var
 *      HARBOUR_ADMIN_API_KEY).
 *
 * Why HTTP instead of a direct DB write? POST /api/jobs works the same on
 * SQLite + Postgres, validates the schedule, and lets harbour handle
 * next_run_at — keeping us out of the schedule/parser business in `bin/`.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getHarbourDir, ensureDir, loadRunnerConfigs } from "./config.mjs";

const JOB_NAME = "Daily Founder Brief";
const DEFAULT_SCHEDULE = "daily at 8am";
const SCRIPT_FILENAME = "founder-brief.mjs";

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
    console.error("Then re-run: HARBOUR_ADMIN_API_KEY=<key> npm run harbour -- brief install");
    process.exit(1);
  }
  return key;
}

async function listJobsByName(url, key, name) {
  const res = await fetch(`${url}/api/jobs`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    throw new Error(`GET /api/jobs returned HTTP ${res.status}`);
  }
  const jobs = await res.json();
  return jobs.filter(j => j.name === name);
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

export async function installBrief({ schedule = DEFAULT_SCHEDULE } = {}) {
  const url = resolveServerUrl();
  if (!url) {
    console.error("Cannot determine the harbour server URL.");
    console.error("Set HARBOUR_URL=<base-url> and retry, e.g. HARBOUR_URL=http://localhost:3000");
    process.exit(1);
  }
  const apiKey = requireAdminKey();

  const dst = copyScript();
  console.log(`Copied brief script to ${dst}`);

  const existing = await listJobsByName(url, apiKey, JOB_NAME);
  if (existing.length > 0) {
    console.log(`Job "${JOB_NAME}" already exists (id ${existing[0].id}). Skipping job creation.`);
    console.log("Run `npm run harbour -- brief uninstall` first if you want a clean install.");
    return;
  }

  const body = {
    name: JOB_NAME,
    description: "Deterministic morning summary of approvals, runs, workflows, and security callouts.",
    schedule,
    workflowCommand: `node ${dst}`,
  };
  const res = await fetch(`${url}/api/jobs`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`Failed to create job: HTTP ${res.status} ${text}`);
    process.exit(1);
  }
  const job = await res.json();
  console.log(`Created workflow-only job "${JOB_NAME}" (id ${job.id}).`);
  console.log(`Schedule: ${schedule}.`);
  console.log("Trigger it once from the dashboard to verify, or wait for the next scheduled run.");
}

export async function uninstallBrief({ keepScript = false } = {}) {
  const url = resolveServerUrl();
  if (!url) {
    console.error("Cannot determine the harbour server URL. Set HARBOUR_URL and retry.");
    process.exit(1);
  }
  const apiKey = requireAdminKey();

  const jobs = await listJobsByName(url, apiKey, JOB_NAME);
  if (jobs.length === 0) {
    console.log(`No "${JOB_NAME}" job found.`);
  } else {
    for (const job of jobs) {
      const res = await fetch(`${url}/api/jobs/${job.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) {
        const text = await res.text();
        console.error(`Failed to delete job ${job.id}: HTTP ${res.status} ${text}`);
        process.exit(1);
      }
      console.log(`Deleted job ${job.id}.`);
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

export function briefStatus() {
  const dst = installedScript();
  console.log(`Script: ${fs.existsSync(dst) ? "installed" : "not installed"} (${dst})`);
  console.log(`Use \`npm run harbour -- brief install\` to create the job, or check /jobs in the dashboard.`);
}
