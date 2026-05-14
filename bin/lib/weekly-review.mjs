/**
 * Weekly Review - install / uninstall helpers.
 *
 * Creates a workflow-only scheduled job that runs bin/workflows/weekly-review.mjs
 * on a weekly cadence. The job reuses Harbour's existing workflow-only runner
 * queue and saves output through POST /api/weekly-reviews/run.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getHarbourDir, ensureDir, loadRunnerConfigs } from "./config.mjs";

const JOB_NAME = "Weekly Review";
const DEFAULT_SCHEDULE = "weekly on friday at 4pm";
const SCRIPT_FILENAME = "weekly-review.mjs";

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
    console.error("Create one in the dashboard: Settings -> Admin API Keys -> New Key.");
    console.error("Then re-run: HARBOUR_ADMIN_API_KEY=<key> npm run harbour -- weekly-review install");
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

export async function installWeeklyReview({ schedule = DEFAULT_SCHEDULE } = {}) {
  const url = resolveServerUrl();
  if (!url) {
    console.error("Cannot determine the harbour server URL.");
    console.error("Set HARBOUR_URL=<base-url> and retry, e.g. HARBOUR_URL=http://localhost:3000");
    process.exit(1);
  }
  const apiKey = requireAdminKey();

  const dst = copyScript();
  console.log(`Copied weekly review script to ${dst}`);

  const existing = await listJobsByName(url, apiKey, JOB_NAME);
  if (existing.length > 0) {
    console.log(`Job "${JOB_NAME}" already exists (id ${existing[0].id}). Skipping job creation.`);
    console.log("Run `npm run harbour -- weekly-review uninstall` first if you want a clean install.");
    return;
  }

  const body = {
    name: JOB_NAME,
    description: "Weekly Company OS review saved as a Doc with next-week recommendations.",
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
  console.log("Trigger it once from /weekly-reviews or /jobs to verify, or wait for the next scheduled run.");
}

export async function uninstallWeeklyReview({ keepScript = false } = {}) {
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

export function weeklyReviewStatus() {
  const dst = installedScript();
  console.log(`Script: ${fs.existsSync(dst) ? "installed" : "not installed"} (${dst})`);
  console.log("Use `npm run harbour -- weekly-review install` to create the scheduled job, or check /weekly-reviews in the dashboard.");
}

