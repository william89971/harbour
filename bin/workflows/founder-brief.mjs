#!/usr/bin/env node
/**
 * Daily Founder Brief — workflow-only job script.
 *
 * Fetches /api/today, formats a deterministic markdown brief, and writes
 * it to stdout. The harbour runner captures stdout and posts it to
 * /api/runs/{id}/activity automatically.
 *
 * Exit codes:
 *   0  — brief generated, runner marks the run done
 *   77 — nothing to report (no activity, no callouts), runner marks skipped
 *   1  — fetch or runtime failure, runner marks failed
 *
 * Environment (injected by the runner for workflow-only jobs):
 *   HARBOUR_URL, HARBOUR_API_KEY, HARBOUR_RUN_ID, HARBOUR_JOB_ID
 */

const MAX_RUNS_PER_LIST = 5;
const MAX_DONE_PER_LIST = 10;

function truncate(items, max) {
  if (items.length <= max) return { shown: items, hidden: 0 };
  return { shown: items.slice(0, max), hidden: items.length - max };
}

function bulletList(label, items, max, render) {
  if (!items || items.length === 0) return "";
  const { shown, hidden } = truncate(items, max);
  const lines = shown.map(it => `  - ${render(it)}`);
  if (hidden > 0) lines.push(`  - …and ${hidden} more`);
  return `- **${label}** (${items.length})\n${lines.join("\n")}`;
}

function renderRun(r) {
  const who = r.agent_name ? ` · ${r.agent_name}` : r.job_workflow_only ? " · workflow" : "";
  return `${r.job_name ?? "(job)"}${who}`;
}

function renderApproval(a) {
  const action = (a.action_type ?? "").replace(/_/g, " ");
  return `${action} [${a.risk_level} risk]`;
}

function renderWorkflow(w) {
  const step = w.current_step_name ? ` — step: ${w.current_step_name}` : "";
  return `${w.workflow_name ?? "(workflow)"}${step}`;
}

/** Pure: takes a /api/today JSON response, returns the formatted markdown brief.
 *  Exported so it can be unit-tested. */
export function formatBrief(today) {
  const date = today?.timezone
    ? new Date((today.generatedAt ?? Math.floor(Date.now() / 1000)) * 1000).toLocaleDateString("en-US", {
        timeZone: today.timezone, year: "numeric", month: "short", day: "numeric",
      })
    : new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

  const parts = [`# Daily Founder Brief — ${date}`];

  // Top priorities — first 3 suggestions, excluding the empty-state one.
  const priorities = (today.suggestions ?? [])
    .filter(s => s.id !== "trigger-job")
    .slice(0, 3);
  if (priorities.length > 0) {
    parts.push("## Top priorities");
    parts.push(priorities.map((p, i) => `${i + 1}. ${p.label}`).join("\n"));
  }

  // Needs you.
  const ny = today.needsYou ?? {};
  const needsYouBlocks = [
    bulletList("Pending approvals", ny.pendingApprovals, MAX_RUNS_PER_LIST, renderApproval),
    bulletList("Waiting workflow gates", ny.waitingWorkflowRuns, MAX_RUNS_PER_LIST, renderWorkflow),
    bulletList("Waiting agents", ny.waitingRuns, MAX_RUNS_PER_LIST, renderRun),
    bulletList("Pending runs", ny.pendingRuns, MAX_RUNS_PER_LIST, renderRun),
  ].filter(Boolean);
  if (needsYouBlocks.length > 0) {
    parts.push("## Needs you");
    parts.push(needsYouBlocks.join("\n"));
  }

  // Running now.
  const rn = today.runningNow ?? {};
  const runningBlocks = [
    bulletList("Runs", rn.runs, MAX_RUNS_PER_LIST, renderRun),
    bulletList("Workflow runs", rn.workflowRuns, MAX_RUNS_PER_LIST, renderWorkflow),
  ].filter(Boolean);
  if (runningBlocks.length > 0) {
    parts.push("## Running now");
    parts.push(runningBlocks.join("\n"));
  }

  // Failed or stuck.
  const fs = today.failedOrStuck ?? {};
  const cy = today.completedYesterday ?? {};
  const failedBlocks = [
    bulletList("Today", fs.runs, MAX_RUNS_PER_LIST, renderRun),
    bulletList("Yesterday", cy.failed, MAX_RUNS_PER_LIST, renderRun),
    bulletList("Workflow runs (today)", fs.workflowRuns, MAX_RUNS_PER_LIST, renderWorkflow),
  ].filter(Boolean);
  if (failedBlocks.length > 0) {
    parts.push("## Failed or stuck");
    parts.push(failedBlocks.join("\n"));
  }

  // Completed.
  const ct = today.completedToday ?? {};
  const completedBlocks = [
    bulletList("Today", ct.done, MAX_DONE_PER_LIST, renderRun),
    bulletList("Yesterday", cy.done, MAX_DONE_PER_LIST, renderRun),
  ].filter(Boolean);
  if (completedBlocks.length > 0) {
    parts.push("## Completed");
    parts.push(completedBlocks.join("\n"));
  }

  // Active workflows.
  const aw = today.activeWorkflows ?? [];
  if (aw.length > 0) {
    parts.push("## Active workflows");
    const { shown, hidden } = truncate(aw, MAX_RUNS_PER_LIST);
    const lines = shown.map(w => `- ${renderWorkflow(w)} (${w.status?.replace(/_/g, " ") ?? "active"})`);
    if (hidden > 0) lines.push(`- …and ${hidden} more`);
    parts.push(lines.join("\n"));
  }

  // Security & cost callouts.
  const callouts = today.securityCallouts ?? [];
  if (callouts.length > 0) {
    parts.push("## Security & cost callouts");
    parts.push(callouts.map(c => `- ${c}`).join("\n"));
  }

  return parts.join("\n\n") + "\n";
}

/** Pure: true if the brief would be empty (nothing to report). */
export function isBriefEmpty(today) {
  const ny = today.needsYou ?? {};
  const rn = today.runningNow ?? {};
  const fs = today.failedOrStuck ?? {};
  const ct = today.completedToday ?? {};
  const cy = today.completedYesterday ?? {};
  const counts = [
    ny.pendingApprovals, ny.waitingRuns, ny.pendingRuns, ny.waitingWorkflowRuns,
    rn.runs, rn.workflowRuns,
    fs.runs, fs.workflowRuns,
    ct.done, cy.done, cy.failed,
    today.activeWorkflows,
    today.securityCallouts,
  ];
  return counts.every(arr => !arr || arr.length === 0);
}

async function main() {
  const url = process.env.HARBOUR_URL;
  const apiKey = process.env.HARBOUR_API_KEY;
  if (!url || !apiKey) {
    process.stderr.write("HARBOUR_URL and HARBOUR_API_KEY must be set (the runner injects these).\n");
    process.exit(1);
  }

  // Drain stdin so the runner's payload pipe closes cleanly. We don't use it
  // today, but reading it avoids a hung pipe on small payloads.
  await new Promise(resolve => {
    if (process.stdin.isTTY) return resolve();
    process.stdin.on("data", () => {});
    process.stdin.on("end", () => resolve());
    process.stdin.on("error", () => resolve());
  });

  let res;
  try {
    res = await fetch(`${url.replace(/\/$/, "")}/api/today`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch (err) {
    process.stderr.write(`Failed to reach ${url}/api/today: ${err.message}\n`);
    process.exit(1);
  }
  if (!res.ok) {
    process.stderr.write(`GET /api/today returned HTTP ${res.status}\n`);
    process.exit(1);
  }
  const today = await res.json();

  if (isBriefEmpty(today)) {
    process.stderr.write("Nothing to report.\n");
    process.exit(77);
  }

  const brief = formatBrief(today);
  process.stdout.write(brief);
  process.exit(0);
}

// Only run when invoked as a script, not when imported by tests.
const invokedDirectly = process.argv[1] && import.meta.url === new URL(process.argv[1], "file://").href;
if (invokedDirectly) {
  main().catch(err => {
    process.stderr.write(`Brief generation failed: ${err?.message ?? err}\n`);
    process.exit(1);
  });
}
