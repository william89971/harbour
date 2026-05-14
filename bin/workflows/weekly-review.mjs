#!/usr/bin/env node
/**
 * Weekly Review - workflow-only job script.
 *
 * Calls POST /api/weekly-reviews/run so the server generates the review from
 * local DB/integration state and saves it as a Doc. The runner posts stdout to
 * the run activity thread after this script exits successfully.
 */

export function formatWeeklyReviewRunOutput(result, harbourUrl) {
  const doc = result?.doc;
  const review = result?.review;
  const base = (harbourUrl || "").replace(/\/$/, "");
  const lines = ["# Weekly Review saved"];

  if (doc?.title) lines.push(`- Doc: ${doc.title}`);
  if (doc?.id && base) lines.push(`- Open: ${base}/docs/${doc.id}`);
  if (review?.rangeLabel) lines.push(`- Range: ${review.rangeLabel}`);

  const recommendations = Array.isArray(review?.recommendations) ? review.recommendations : [];
  if (recommendations.length > 0) {
    lines.push("");
    lines.push("## Recommended priorities");
    for (const rec of recommendations.slice(0, 5)) {
      lines.push(`- ${rec}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

async function main() {
  const url = process.env.HARBOUR_URL;
  const apiKey = process.env.HARBOUR_API_KEY;
  if (!url || !apiKey) {
    process.stderr.write("HARBOUR_URL and HARBOUR_API_KEY must be set (the runner injects these).\n");
    process.exit(1);
  }

  await new Promise(resolve => {
    if (process.stdin.isTTY) return resolve();
    process.stdin.on("data", () => {});
    process.stdin.on("end", () => resolve());
    process.stdin.on("error", () => resolve());
  });

  const base = url.replace(/\/$/, "");
  const res = await fetch(`${base}/api/weekly-reviews/run`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ source: "scheduled" }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    process.stderr.write(`POST /api/weekly-reviews/run returned HTTP ${res.status}${text ? `: ${text.slice(0, 500)}` : ""}\n`);
    process.exit(1);
  }

  const result = await res.json();
  process.stdout.write(formatWeeklyReviewRunOutput(result, base));
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(process.argv[1], "file://").href;
if (invokedDirectly) {
  main().catch(err => {
    process.stderr.write(`Weekly review failed: ${err?.message ?? err}\n`);
    process.exit(1);
  });
}

