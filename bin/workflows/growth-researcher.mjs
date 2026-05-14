#!/usr/bin/env node
/**
 * Growth Outreach Loop — workflow-step script.
 *
 * Runs as a Custom Shell harbour agent in the "Growth Researcher" agent's
 * workflow steps. The current phase is encoded in the step instructions.
 *
 * Phase "gather": fetches Harbour state (new contacts, prospect companies,
 *                 existing outreach drafts) and writes a markdown context
 *                 bundle to stdout (auto-posted as run activity).
 * Phase "draft":  produces a JSON outreach proposal scaffolded from the
 *                 user's freeform notes. Stdout becomes the review surface
 *                 for the after-step approval gate.
 */

const PROPOSAL_SOURCE = "growth-outreach-loop";

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

export function detectPhase(instructions) {
  const m = /GROWTH_PHASE:\s*(gather|draft)/i.exec(instructions || "");
  return m ? m[1].toLowerCase() : null;
}

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

export function gatherMarkdown(contacts, companies, outreach) {
  const parts = [`# Growth Outreach — gathered context`];
  const contactsBlock = bullet(
    "New / researched contacts",
    safeArray(contacts),
    20,
    c => `${c.name}${c.email ? ` <${c.email}>` : ""}${c.company_name ? ` @ ${c.company_name}` : ""} [${c.status}]`,
  );
  if (contactsBlock) parts.push(`## Contacts\n${contactsBlock}`);

  const companiesBlock = bullet(
    "Prospect companies",
    safeArray(companies),
    15,
    co => `${co.name}${co.industry ? ` (${co.industry})` : ""}${co.website ? ` — ${co.website}` : ""}`,
  );
  if (companiesBlock) parts.push(`## Companies\n${companiesBlock}`);

  const outreachBlock = bullet(
    "Open / pending outreach",
    safeArray(outreach),
    15,
    d => `${d.subject} → ${d.contact_name ?? "(no contact)"} [${d.status}]`,
  );
  if (outreachBlock) parts.push(`## Open drafts\n${outreachBlock}`);

  if (parts.length === 1) {
    parts.push("(No prospects yet. Add some contacts/companies first.)");
  }
  return parts.join("\n\n") + "\n";
}

/** Parse freeform notes into a structured proposal of outreach drafts.
 *
 *  Heuristics, simple line-based:
 *    CONTACT: <name> <email?> @ <company?>   → starts a new draft block
 *    SUBJECT: <text>                          → sets the current draft's subject
 *    everything else                          → appended to the current draft's body
 *
 *  Returns { source: "growth-outreach-loop", drafts: [...] } with at least
 *  one draft when notes are non-empty.
 */
export function draftProposal(notes) {
  const lines = (notes || "").split(/\r?\n/);
  const drafts = [];
  let current = null;

  function pushCurrent() {
    if (current) {
      current.body = current.body.trim();
      if (!current.subject) current.subject = "(no subject)";
      drafts.push(current);
    }
  }

  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) {
      if (current) current.body += "\n";
      continue;
    }
    const contactMatch = /^CONTACT:\s*(.+)$/i.exec(line);
    if (contactMatch) {
      pushCurrent();
      const rest = contactMatch[1].trim();
      // Extract email <foo@bar> and company "@ Acme"
      const emailMatch = rest.match(/<([^>]+@[^>]+)>/);
      const email = emailMatch ? emailMatch[1].trim() : null;
      let cleaned = rest.replace(/<[^>]+>/, "").trim();
      let company = null;
      const atIndex = cleaned.lastIndexOf(" @ ");
      if (atIndex > -1) {
        company = cleaned.slice(atIndex + 3).trim();
        cleaned = cleaned.slice(0, atIndex).trim();
      }
      current = {
        contact_name: cleaned || null,
        contact_email: email,
        company_name: company,
        subject: "",
        body: "",
      };
      continue;
    }
    const subjectMatch = /^SUBJECT:\s*(.+)$/i.exec(line);
    if (subjectMatch) {
      if (!current) {
        current = { contact_name: null, contact_email: null, company_name: null, subject: "", body: "" };
      }
      current.subject = subjectMatch[1].trim();
      continue;
    }
    if (!current) {
      current = { contact_name: null, contact_email: null, company_name: null, subject: "", body: "" };
    }
    current.body += line + "\n";
  }
  pushCurrent();

  return { source: PROPOSAL_SOURCE, drafts };
}

export function draftMarkdown(notes, proposal) {
  const parts = [`# Growth Outreach — proposal`];
  if (notes) {
    parts.push(`## Your notes\n${notes.split("\n").map(l => `> ${l}`).join("\n")}`);
  } else {
    parts.push(`## Your notes\n_(no notes were supplied.)_`);
  }
  parts.push(`Drafts proposed: **${proposal.drafts.length}**`);
  parts.push("## Proposed drafts");
  parts.push("```json proposal\n" + JSON.stringify(proposal, null, 2) + "\n```");
  parts.push(
    "Review the proposal on the workflow run detail page. Edit, deselect items, and click _Save & approve_ to create outreach drafts.",
  );
  return parts.join("\n\n") + "\n";
}

// ---------------------------------------------------------------------------
// Runtime
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
  if (!res.ok) throw new Error(`GET ${url} returned HTTP ${res.status}`);
  return res.json();
}

async function gather(url, apiKey) {
  const base = url.replace(/\/$/, "");
  const [contacts, companies, outreach] = await Promise.all([
    fetchJson(`${base}/api/contacts?status=new,researched`, apiKey).catch(() => []),
    fetchJson(`${base}/api/companies?status=prospect`, apiKey).catch(() => []),
    fetchJson(`${base}/api/outreach?status=draft,pending_approval`, apiKey).catch(() => []),
  ]);
  return { contacts, companies, outreach };
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
  try { payload = JSON.parse(stdin || "{}"); } catch { /* ignore */ }
  const instructions = payload?.job?.instructions || payload?.instructions || "";

  const phase = detectPhase(instructions);
  if (!phase) {
    process.stderr.write("Could not detect GROWTH_PHASE in instructions.\n");
    process.exit(1);
  }

  if (phase === "gather") {
    const { contacts, companies, outreach } = await gather(url, apiKey);
    process.stdout.write(gatherMarkdown(contacts, companies, outreach));
    process.exit(0);
  }

  // phase === "draft"
  const notes = extractNotes(instructions);
  const proposal = draftProposal(notes);
  process.stdout.write(draftMarkdown(notes, proposal));
  process.exit(0);
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(process.argv[1], "file://").href;
if (invokedDirectly) {
  main().catch(err => {
    process.stderr.write(`Growth Outreach script failed: ${err?.message ?? err}\n`);
    process.exit(1);
  });
}
