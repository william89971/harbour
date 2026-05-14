#!/usr/bin/env node
/**
 * Product Review Loop — workflow-step script.
 *
 * Runs as a Custom Shell harbour agent in the "Product Reviewer" agent's
 * workflow steps. The current phase is encoded in the step instructions
 * (the harbour workflow engine substitutes {{input.notes}} server-side
 * before piping them to the runner, which passes them via stdin).
 *
 * Phase "gather": fetches Harbour state and writes a markdown context
 *                 bundle to stdout (auto-posted as run activity).
 * Phase "draft":  produces a JSON proposal scaffolded from the user notes
 *                 plus a recap of current Harbour state. Stdout becomes the
 *                 review surface for the after-step approval gate.
 *
 * Exit codes:
 *   0  — output produced, runner marks the underlying run done
 *   1  — runtime error, runner marks failed
 *
 * Environment (injected by the runner): HARBOUR_URL, HARBOUR_API_KEY,
 * HARBOUR_RUN_ID, HARBOUR_AGENT_ID, HARBOUR_JOB_ID.
 */

const PROPOSAL_SOURCE = "product-review-loop";

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

/** Detects the workflow phase from a rendered step instructions blob. */
export function detectPhase(instructions) {
  const m = /PRODUCT_REVIEW_PHASE:\s*(gather|draft)/i.exec(instructions || "");
  return m ? m[1].toLowerCase() : null;
}

/** Extracts the "User notes:\n..." block from rendered instructions. The
 *  notes section runs until a blank line followed by a capitalized divider
 *  sentence, or end-of-string. */
export function extractNotes(instructions) {
  if (!instructions) return "";
  const m = /User notes:\s*\n([\s\S]*?)(?:\n\n[A-Z][^\n]*|$)/i.exec(instructions);
  return m ? m[1].trim() : "";
}

function safeArray(v) {
  return Array.isArray(v) ? v : [];
}

function bullet(label, items, max, render) {
  if (!items || items.length === 0) return "";
  const shown = items.slice(0, max);
  const hidden = items.length - shown.length;
  const lines = shown.map(it => `  - ${render(it)}`);
  if (hidden > 0) lines.push(`  - …and ${hidden} more`);
  return `- **${label}** (${items.length})\n${lines.join("\n")}`;
}

/** Pure: format the gather-phase markdown bundle. */
export function gatherMarkdown(today, goals, tasks, decisions, github) {
  const parts = [`# Product Review — gathered context`];

  if (today) {
    const dir = today.direction;
    const summaryBits = [];
    if (dir) {
      summaryBits.push(`Active goals: **${dir.activeGoals ?? 0}**`);
      summaryBits.push(`Open tasks: **${dir.openTasks ?? 0}**`);
      summaryBits.push(`Blocked tasks: **${dir.blockedTasks ?? 0}**`);
    }
    summaryBits.push(`Running runs: **${safeArray(today.runningNow?.runs).length}**`);
    summaryBits.push(`Failed today: **${safeArray(today.failedOrStuck?.runs).length}**`);
    parts.push(`## Snapshot\n${summaryBits.map(b => `- ${b}`).join("\n")}`);
  }

  const goalBlock = bullet(
    "Active goals",
    safeArray(goals),
    20,
    g => `${g.title} (${g.priority ?? "medium"})${g.target_date ? ` — target ${new Date(g.target_date * 1000).toISOString().slice(0, 10)}` : ""}`,
  );
  if (goalBlock) parts.push(`## Goals\n${goalBlock}`);

  const taskBlock = bullet(
    "Open + blocked tasks",
    safeArray(tasks),
    25,
    t => {
      const owner = t.owner_type && t.owner_type !== "none" ? ` · ${t.owner_type}${t.owner_id ? `:${t.owner_id}` : ""}` : "";
      const goal = t.goal_title ? ` · goal: ${t.goal_title}` : "";
      return `${t.title} [${t.status}/${t.priority ?? "medium"}]${owner}${goal}`;
    },
  );
  if (taskBlock) parts.push(`## Tasks\n${taskBlock}`);

  const decBlock = bullet(
    "Recent decisions",
    safeArray(decisions),
    10,
    d => `${d.title} — ${d.decision}`,
  );
  if (decBlock) parts.push(`## Decisions\n${decBlock}`);

  if (github && github.configured) {
    const ghLines = [];
    if (github.repo) {
      const stale = github.staleDays !== null && github.staleDays > 7
        ? ` · **stale ${github.staleDays}d**`
        : "";
      ghLines.push(`- **Repo:** ${github.repo.full_name ?? "(unknown)"}${stale}`);
    }
    const commits = safeArray(github.commits).slice(0, 5);
    if (commits.length > 0) {
      ghLines.push(`- **Recent commits (${commits.length}):**`);
      for (const c of commits) {
        ghLines.push(`  - \`${c.sha.slice(0, 7)}\` ${c.message} — ${c.author}`);
      }
    }
    const issues = safeArray(github.issues).slice(0, 5);
    if (issues.length > 0) {
      ghLines.push(`- **Open issues (${safeArray(github.issues).length}):**`);
      for (const it of issues) {
        ghLines.push(`  - #${it.number} ${it.title} — ${it.user}`);
      }
    }
    const prs = safeArray(github.pullRequests).slice(0, 5);
    if (prs.length > 0) {
      ghLines.push(`- **Open PRs (${safeArray(github.pullRequests).length}):**`);
      for (const p of prs) {
        ghLines.push(`  - #${p.number} ${p.title} — ${p.user}${p.draft ? " (draft)" : ""}`);
      }
    }
    if (ghLines.length > 0) parts.push(`## GitHub\n${ghLines.join("\n")}`);
  }

  if (parts.length === 1) {
    parts.push("(No state captured. Add goals/tasks/decisions to make future reviews richer.)");
  }

  return parts.join("\n\n") + "\n";
}

/** Pure: parse the user's freeform notes into a structured proposal.
 *
 *  Heuristics, line-by-line (case-insensitive prefix match):
 *    DECISION: ...       → decision row (everything after the colon is the
 *                          decision text; the title is the first 8 words).
 *    BLOCKED: ...        → task with status="blocked"
 *    DOING: ...          → task with status="doing"
 *    DONE: ...           → task with status="done"
 *    everything else     → task with status="todo"
 *
 *  Priority is inferred from in-line markers:
 *    line contains "!!"  → priority="high"
 *    line ends with "?"  → priority="low"
 *    otherwise           → priority="medium"
 */
export function draftProposal(notes, github) {
  const lines = (notes || "")
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0);

  const tasks = [];
  const decisions = [];

  for (const line of lines) {
    // Strip leading list markers like "- " or "* " or "1. ".
    const cleaned = line.replace(/^([-*]|\d+\.)\s+/, "");

    const decisionMatch = /^DECISION:\s*(.+)$/i.exec(cleaned);
    if (decisionMatch) {
      const body = decisionMatch[1].trim();
      const titleWords = body.split(/\s+/).slice(0, 8).join(" ");
      decisions.push({
        title: titleWords.length < body.length ? titleWords + "…" : titleWords,
        decision: body,
      });
      continue;
    }

    let status = "todo";
    let title = cleaned;
    const statusMatch = /^(BLOCKED|DOING|DONE|TODO):\s*(.+)$/i.exec(cleaned);
    if (statusMatch) {
      status = statusMatch[1].toLowerCase();
      title = statusMatch[2].trim();
    }

    let priority = "medium";
    if (title.includes("!!")) priority = "high";
    else if (/\?$/.test(title)) priority = "low";

    // Strip the priority markers from the title for cleanliness.
    title = title.replace(/!!/g, "").trim();

    tasks.push({ title, status, priority });
  }

  // Append GitHub-derived task suggestions when stale issues/PRs exist.
  if (github && github.configured) {
    const staleDays = github.staleDays ?? null;
    if (staleDays !== null && staleDays > 7) {
      tasks.push({
        title: `Push code — repo idle for ${staleDays} days`,
        notes: "Suggested by GitHub integration: no recent commits.",
        status: "todo",
        priority: "medium",
      });
    }
    const openIssues = safeArray(github.issues);
    for (const it of openIssues.slice(0, 3)) {
      tasks.push({
        title: `Triage GH issue #${it.number}: ${it.title}`,
        notes: `Mirrors GitHub issue #${it.number}. Opened by ${it.user}. ${it.html_url}`,
        status: "todo",
        priority: "medium",
      });
    }
  }

  return { tasks, decisions, source: PROPOSAL_SOURCE };
}

/** Pure: format the draft-phase markdown that wraps the proposal. */
export function draftMarkdown(notes, proposal, today) {
  const dir = today?.direction;
  const recap = dir
    ? `Snapshot at draft time: ${dir.activeGoals ?? 0} active goals · ${dir.openTasks ?? 0} open tasks · ${dir.blockedTasks ?? 0} blocked tasks.`
    : "Snapshot at draft time unavailable.";

  const parts = [`# Product Review — proposal`, recap];

  if (notes) {
    parts.push(`## Your notes\n${notes.split("\n").map(l => `> ${l}`).join("\n")}`);
  } else {
    parts.push(`## Your notes\n_(no notes were supplied at workflow start.)_`);
  }

  parts.push("## Proposed updates");
  parts.push("```json proposal\n" + JSON.stringify(proposal, null, 2) + "\n```");
  parts.push(
    "Review the proposal in the Workflow Run detail page. Edit, uncheck items you don't want, and click _Save & approve_ to persist them as tasks and decisions.",
  );

  return parts.join("\n\n") + "\n";
}

// ---------------------------------------------------------------------------
// Runtime — invoked when this file is run as a script
// ---------------------------------------------------------------------------

async function readStdin() {
  if (process.stdin.isTTY) return "";
  return new Promise(resolve => {
    let buf = "";
    process.stdin.on("data", d => { buf += d.toString(); });
    process.stdin.on("end", () => resolve(buf));
    process.stdin.on("error", () => resolve(buf));
  });
}

async function fetchJson(url, apiKey) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) {
    throw new Error(`GET ${url} returned HTTP ${res.status}`);
  }
  return res.json();
}

async function gather(url, apiKey) {
  const base = url.replace(/\/$/, "");
  const [today, goals, tasks, decisions, github] = await Promise.all([
    fetchJson(`${base}/api/today`, apiKey).catch(() => null),
    fetchJson(`${base}/api/goals?status=active`, apiKey).catch(() => []),
    fetchJson(`${base}/api/tasks?status=todo,doing,blocked`, apiKey).catch(() => []),
    fetchJson(`${base}/api/decisions?limit=10`, apiKey).catch(() => []),
    fetchJson(`${base}/api/integrations/github/summary`, apiKey).catch(() => ({ configured: false })),
  ]);
  return { today, goals, tasks, decisions, github };
}

async function main() {
  const url = process.env.HARBOUR_URL;
  const apiKey = process.env.HARBOUR_API_KEY;
  if (!url || !apiKey) {
    process.stderr.write("HARBOUR_URL and HARBOUR_API_KEY must be set (the runner injects these).\n");
    process.exit(1);
  }

  const stdin = await readStdin();
  let payload = {};
  try { payload = JSON.parse(stdin || "{}"); } catch { /* ignore — instructions still come from env */ }
  const instructions = payload?.job?.instructions || payload?.instructions || "";

  const phase = detectPhase(instructions);
  if (!phase) {
    process.stderr.write("Could not detect PRODUCT_REVIEW_PHASE in instructions.\n");
    process.exit(1);
  }

  if (phase === "gather") {
    const { today, goals, tasks, decisions, github } = await gather(url, apiKey);
    process.stdout.write(gatherMarkdown(today, goals, tasks, decisions, github));
    process.exit(0);
  }

  // phase === "draft"
  const notes = extractNotes(instructions);
  const { today, github } = await gather(url, apiKey);
  const proposal = draftProposal(notes, github);
  process.stdout.write(draftMarkdown(notes, proposal, today));
  process.exit(0);
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(process.argv[1], "file://").href;
if (invokedDirectly) {
  main().catch(err => {
    process.stderr.write(`Product review script failed: ${err?.message ?? err}\n`);
    process.exit(1);
  });
}
