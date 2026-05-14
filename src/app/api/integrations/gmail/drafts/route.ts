import { NextResponse } from "next/server";
import { withOperator } from "@/lib/auth";
import { createGmailDraft, getGmailConfigAsync, isGmailConfigured } from "@/lib/gmail";

/** POST /api/integrations/gmail/drafts
 *  Body: { to, subject, body }. Creates a Gmail draft via the user's
 *  configured OAuth credentials. Never sends. */
export const POST = withOperator(async (req) => {
  const cfg = await getGmailConfigAsync();
  if (!isGmailConfigured(cfg)) {
    return NextResponse.json({ error: "Gmail is not configured. Open Settings → Gmail." }, { status: 400 });
  }
  let body: { to?: unknown; subject?: unknown; body?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (typeof body.to !== "string" || !body.to.includes("@")) {
    return NextResponse.json({ error: "to must be a valid email address" }, { status: 400 });
  }
  if (typeof body.subject !== "string" || !body.subject.trim()) {
    return NextResponse.json({ error: "subject is required" }, { status: 400 });
  }
  if (typeof body.body !== "string" || !body.body.trim()) {
    return NextResponse.json({ error: "body is required" }, { status: 400 });
  }
  try {
    const result = await createGmailDraft(cfg, {
      to: body.to,
      subject: body.subject,
      body: body.body,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
});
