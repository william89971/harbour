/**
 * Growth Outreach Loop — coverage:
 *   - DB CRUD for companies/contacts/outreach_drafts
 *   - FK behavior (ON DELETE SET NULL on company_id, contact_id)
 *   - CHECK constraints on enums
 *   - /api/outreach/:id/request-approval creates an approval_request
 *   - /api/outreach/:id/finalize requires approved
 *   - /api/outreach/:id/mark-sent bumps the contact status
 *   - Gmail config + createGmailDraft with mocked fetch
 *   - /api/today includes the `growth` block when drafts exist
 *   - growth-researcher script formatters
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import { setDb, resetDb, initializeSchema, getDb } from "@/lib/db/schema";
import {
  createUserAsync,
  createSession,
  createCompany,
  getCompanyById,
  listCompanies,
  updateCompany,
  deleteCompany,
  createContact,
  getContactById,
  listContacts,
  updateContact,
  deleteContact,
  createOutreachDraft,
  getOutreachDraftById,
  listOutreachDrafts,
  updateOutreachDraft,
  createEnvVarAsync,
  setSettingAsync,
} from "@/lib/db/queries";
import { POST as requestApprovalPost } from "@/app/api/outreach/[id]/request-approval/route";
import { POST as finalizePost } from "@/app/api/outreach/[id]/finalize/route";
import { POST as markSentPost } from "@/app/api/outreach/[id]/mark-sent/route";
import { GET as todayGet } from "@/app/api/today/route";
import { GET as gmailConfigGet, PUT as gmailConfigPut } from "@/app/api/integrations/gmail/config/route";
import { POST as gmailDraftsPost } from "@/app/api/integrations/gmail/drafts/route";
import {
  createGmailDraft,
  buildRfc2822,
  getGmailConfigAsync,
} from "@/lib/gmail";
import {
  approveRequestAsync,
  rejectRequestAsync,
  getApprovalRequestByIdAsync,
} from "@/lib/db/queries";
// @ts-expect-error -- pure .mjs script
import { detectPhase, extractNotes, gatherMarkdown, draftProposal, draftMarkdown } from "../../bin/workflows/growth-researcher.mjs";

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
afterEach(() => {
  resetDb();
  vi.restoreAllMocks();
});

const noCtx = { params: Promise.resolve({} as Record<string, string>) };

async function adminSession(): Promise<string> {
  const u = await createUserAsync("admin@x.com", "test-pw-1!!", "Admin", "admin");
  return createSession(u!.id);
}

function authedReq(url: string, sessionId: string, method = "GET", body?: unknown): NextRequest {
  const headers = new Headers({ cookie: `harbour_session=${sessionId}` });
  if (body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

// ---------------------------------------------------------------------------
// CRUD + FK behavior
// ---------------------------------------------------------------------------

describe("Companies CRUD", () => {
  it("creates with defaults", () => {
    const c = createCompany({ name: "Acme" });
    expect(c.status).toBe("prospect");
    expect(getCompanyById(c.id)?.name).toBe("Acme");
  });
  it("rejects invalid status at DB layer", () => {
    expect(() => getDb().prepare(`INSERT INTO companies (id, name, status) VALUES (?, ?, ?)`).run("x", "X", "bogus")).toThrow();
  });
});

describe("Contacts CRUD + FK", () => {
  it("creates and lists with company name joined", () => {
    const co = createCompany({ name: "Acme" });
    createContact({ name: "Alice", email: "alice@acme.com", companyId: co.id });
    const list = listContacts();
    expect(list[0].company_name).toBe("Acme");
  });
  it("deleting a company nulls contact.company_id", () => {
    const co = createCompany({ name: "Acme" });
    const c = createContact({ name: "Bob", companyId: co.id });
    deleteCompany(co.id);
    expect(getContactById(c.id)?.company_id).toBeNull();
  });
});

describe("Outreach CRUD + FK", () => {
  it("creates and lists with contact + company joined", () => {
    const co = createCompany({ name: "Acme" });
    const ct = createContact({ name: "Alice", email: "a@acme.com", companyId: co.id });
    createOutreachDraft({ subject: "Hi", body: "Hello.", contactId: ct.id, companyId: co.id });
    const list = listOutreachDrafts();
    expect(list[0].contact_name).toBe("Alice");
    expect(list[0].contact_email).toBe("a@acme.com");
    expect(list[0].company_name).toBe("Acme");
  });
  it("deleting a contact nulls outreach.contact_id", () => {
    const ct = createContact({ name: "Alice" });
    const d = createOutreachDraft({ subject: "Hi", body: "Hello.", contactId: ct.id });
    deleteContact(ct.id);
    expect(getOutreachDraftById(d.id)?.contact_id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Outreach lifecycle endpoints
// ---------------------------------------------------------------------------

describe("POST /api/outreach/:id/request-approval", () => {
  it("creates an approval_request and updates draft status", async () => {
    const sessionId = await adminSession();
    const ct = createContact({ name: "Alice", email: "a@acme.com" });
    const d = createOutreachDraft({ subject: "Hi", body: "Test", contactId: ct.id });
    const res = await requestApprovalPost(
      authedReq(`http://x/api/outreach/${d.id}/request-approval`, sessionId, "POST", { reason: "Quick intro" }),
      { params: Promise.resolve({ id: d.id }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("pending_approval");
    expect(json.approval_request_id).toBeTruthy();
    const approval = await getApprovalRequestByIdAsync(json.approval_request_id);
    expect(approval?.action_type).toBe("contact_customer");
    expect(approval?.risk_level).toBe("high");
  });
});

describe("POST /api/outreach/:id/finalize", () => {
  it("rejects when approval is not yet approved", async () => {
    const sessionId = await adminSession();
    const d = createOutreachDraft({ subject: "Hi", body: "Test" });
    // First, request approval.
    await requestApprovalPost(
      authedReq(`http://x/api/outreach/${d.id}/request-approval`, sessionId, "POST", {}),
      { params: Promise.resolve({ id: d.id }) },
    );
    // Finalize before approving → 400.
    const res = await finalizePost(
      authedReq(`http://x/api/outreach/${d.id}/finalize`, sessionId, "POST", {}),
      { params: Promise.resolve({ id: d.id }) },
    );
    expect(res.status).toBe(400);
  });

  it("promotes to approved after the approval is approved", async () => {
    const sessionId = await adminSession();
    const u = await createUserAsync("op@x.com", "p", "Op", "operator");
    const d = createOutreachDraft({ subject: "Hi", body: "Test" });
    const reqRes = await requestApprovalPost(
      authedReq(`http://x/api/outreach/${d.id}/request-approval`, sessionId, "POST", {}),
      { params: Promise.resolve({ id: d.id }) },
    );
    const reqJson = await reqRes.json();
    await approveRequestAsync(reqJson.approval_request_id, u!.id);
    const res = await finalizePost(
      authedReq(`http://x/api/outreach/${d.id}/finalize`, sessionId, "POST", {}),
      { params: Promise.resolve({ id: d.id }) },
    );
    expect(res.status).toBe(200);
    const final = await res.json();
    expect(final.status).toBe("approved");
  });

  it("blocks finalize when approval was rejected", async () => {
    const sessionId = await adminSession();
    const u = await createUserAsync("op@x.com", "p", "Op", "operator");
    const d = createOutreachDraft({ subject: "Hi", body: "Test" });
    const reqRes = await requestApprovalPost(
      authedReq(`http://x/api/outreach/${d.id}/request-approval`, sessionId, "POST", {}),
      { params: Promise.resolve({ id: d.id }) },
    );
    const reqJson = await reqRes.json();
    await rejectRequestAsync(reqJson.approval_request_id, u!.id, "nope");
    const res = await finalizePost(
      authedReq(`http://x/api/outreach/${d.id}/finalize`, sessionId, "POST", {}),
      { params: Promise.resolve({ id: d.id }) },
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/outreach/:id/mark-sent", () => {
  it("marks draft sent and bumps the linked contact's status to contacted", async () => {
    const sessionId = await adminSession();
    const ct = createContact({ name: "Alice", email: "a@acme.com", status: "researched" });
    const d = createOutreachDraft({ subject: "Hi", body: "Test", contactId: ct.id });
    updateOutreachDraft(d.id, { status: "approved" });
    const res = await markSentPost(
      authedReq(`http://x/api/outreach/${d.id}/mark-sent`, sessionId, "POST", {}),
      { params: Promise.resolve({ id: d.id }) },
    );
    expect(res.status).toBe(200);
    expect(getOutreachDraftById(d.id)?.status).toBe("sent");
    expect(getContactById(ct.id)?.status).toBe("contacted");
  });
});

// ---------------------------------------------------------------------------
// Gmail
// ---------------------------------------------------------------------------

describe("Gmail config endpoints", () => {
  it("PUT/GET round-trip, never leaks secrets", async () => {
    const sessionId = await adminSession();
    const r1 = await gmailConfigPut(
      authedReq("http://x/api/integrations/gmail/config", sessionId, "PUT", {
        clientIdEnvVarName: "GMAIL_CLIENT_ID",
        clientSecretEnvVarName: "GMAIL_CLIENT_SECRET",
        refreshTokenEnvVarName: "GMAIL_REFRESH_TOKEN",
        fromEmail: "alice@example.com",
      }),
      noCtx,
    );
    expect(r1.status).toBe(200);
    const r2 = await gmailConfigGet(authedReq("http://x/api/integrations/gmail/config", sessionId), noCtx);
    const j = await r2.json();
    expect(j.fromEmail).toBe("alice@example.com");
    expect(j.tokenConfigured).toBe(false);
    expect(JSON.stringify(j)).not.toContain("ghp_");
  });

  it("rejects invalid env var names", async () => {
    const sessionId = await adminSession();
    const r = await gmailConfigPut(
      authedReq("http://x/api/integrations/gmail/config", sessionId, "PUT", { clientIdEnvVarName: "../etc/passwd" }),
      noCtx,
    );
    expect(r.status).toBe(400);
  });
});

describe("buildRfc2822", () => {
  it("encodes ASCII subjects directly", () => {
    const msg = buildRfc2822("a@x.com", "b@y.com", "Hello", "Body");
    expect(msg).toContain("Subject: Hello");
    expect(msg).toContain("From: a@x.com");
    expect(msg).toContain("To: b@y.com");
    expect(msg.endsWith("Body") || msg.endsWith("Body\r\n")).toBe(true);
  });
  it("encodes non-ASCII subjects with MIME base64", () => {
    const msg = buildRfc2822("a@x.com", "b@y.com", "Héllo 🚀", "Body");
    expect(msg).toMatch(/Subject: =\?UTF-8\?B\?/);
  });
});

describe("createGmailDraft (mocked fetch)", () => {
  it("exchanges refresh token then POSTs the draft", async () => {
    await createEnvVarAsync("GMAIL_CLIENT_ID", "cid");
    await createEnvVarAsync("GMAIL_CLIENT_SECRET", "csecret");
    await createEnvVarAsync("GMAIL_REFRESH_TOKEN", "rtok");
    await setSettingAsync("gmail_from_email", "me@x.com");

    const calls: string[] = [];
    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      calls.push(url);
      if (url.includes("oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "tok-abc" }), { status: 200 });
      }
      if (url.includes("gmail.googleapis.com")) {
        return new Response(JSON.stringify({ id: "draft-1", message: { id: "m-1", threadId: "t-1" } }), { status: 200 });
      }
      return new Response("nope", { status: 404 });
    });

    const cfg = await getGmailConfigAsync();
    const out = await createGmailDraft(cfg, { to: "you@x.com", subject: "Hi", body: "Body" });
    expect(out.id).toBe("draft-1");
    expect(out.draftsUrl).toContain("mail.google.com");
    expect(calls.some(c => c.includes("oauth2.googleapis.com"))).toBe(true);
    expect(calls.some(c => c.includes("gmail.googleapis.com"))).toBe(true);
  });

  it("POST /api/integrations/gmail/drafts returns 400 when not configured", async () => {
    const sessionId = await adminSession();
    const r = await gmailDraftsPost(
      authedReq("http://x/api/integrations/gmail/drafts", sessionId, "POST", {
        to: "y@x.com", subject: "Hi", body: "Hi",
      }),
      noCtx,
    );
    expect(r.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// /api/today
// ---------------------------------------------------------------------------

describe("/api/today growth block", () => {
  it("is null when no growth state and no Gmail", async () => {
    const sessionId = await adminSession();
    const res = await todayGet(authedReq("http://x/api/today", sessionId), noCtx);
    const json = await res.json();
    expect(json.growth).toBeNull();
  });

  it("is populated when drafts exist + emits review-outreach suggestion", async () => {
    const sessionId = await adminSession();
    createContact({ name: "Alice", status: "new" });
    const d = createOutreachDraft({ subject: "Hi", body: "Hi" });
    updateOutreachDraft(d.id, { status: "pending_approval" });
    const res = await todayGet(authedReq("http://x/api/today", sessionId), noCtx);
    const json = await res.json();
    expect(json.growth).not.toBeNull();
    expect(json.growth.newContacts).toBe(1);
    expect(json.growth.pendingApprovalCount).toBe(1);
    expect(json.suggestions.some((s: { id: string }) => s.id === "review-outreach")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// growth-researcher script formatters
// ---------------------------------------------------------------------------

describe("growth-researcher script formatters", () => {
  it("detects gather + draft phases", () => {
    expect(detectPhase("GROWTH_PHASE: gather\n\netc.")).toBe("gather");
    expect(detectPhase("GROWTH_PHASE: draft\n\netc.")).toBe("draft");
    expect(detectPhase("not the marker")).toBeNull();
  });

  it("extracts notes from a draft instruction template", () => {
    const tmpl = `GROWTH_PHASE: draft\n\nUser notes:\nCONTACT: Alice <a@x.com> @ Acme\nSUBJECT: Hi\nHello!\n\nUsing the notes...`;
    expect(extractNotes(tmpl)).toContain("CONTACT: Alice");
  });

  it("draftProposal parses CONTACT/SUBJECT/body lines into structured drafts", () => {
    const notes = `CONTACT: Alice <alice@acme.com> @ Acme\nSUBJECT: Quick intro\nHi Alice,\n\nI saw Acme is hiring eng.\nCONTACT: Bob <bob@xyz.com>\nSUBJECT: Hello\nHey Bob,`;
    const p = draftProposal(notes);
    expect(p.source).toBe("growth-outreach-loop");
    expect(p.drafts).toHaveLength(2);
    expect(p.drafts[0].contact_name).toBe("Alice");
    expect(p.drafts[0].contact_email).toBe("alice@acme.com");
    expect(p.drafts[0].company_name).toBe("Acme");
    expect(p.drafts[0].subject).toBe("Quick intro");
    expect(p.drafts[0].body).toContain("I saw Acme is hiring eng.");
    expect(p.drafts[1].contact_name).toBe("Bob");
    expect(p.drafts[1].subject).toBe("Hello");
  });

  it("gatherMarkdown is graceful with no state", () => {
    expect(gatherMarkdown([], [], [])).toContain("(No prospects yet");
  });

  it("draftMarkdown wraps the proposal in a parseable fenced block", () => {
    const md = draftMarkdown("CONTACT: A <a@b.com>", draftProposal("CONTACT: A <a@b.com>"));
    expect(md).toContain("```json proposal");
    expect(md).toContain('"source": "growth-outreach-loop"');
  });
});

// ---------------------------------------------------------------------------
// updateCompany / updateContact (lint coverage for unused imports)
// ---------------------------------------------------------------------------
describe("update helpers", () => {
  it("updateCompany changes status", () => {
    const c = createCompany({ name: "Acme" });
    updateCompany(c.id, { status: "customer" });
    expect(getCompanyById(c.id)?.status).toBe("customer");
  });
  it("updateContact changes status", () => {
    const c = createContact({ name: "Alice" });
    updateContact(c.id, { status: "replied" });
    expect(getContactById(c.id)?.status).toBe("replied");
  });
  it("listCompanies orders prospects first", () => {
    createCompany({ name: "A", status: "archived" });
    createCompany({ name: "B", status: "prospect" });
    const list = listCompanies();
    expect(list[0].name).toBe("B");
  });
});
