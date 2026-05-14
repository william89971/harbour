import { NextResponse } from "next/server";
import { withOperator } from "@/lib/auth";
import {
  getOutreachDraftByIdAsync,
  updateOutreachDraftAsync,
} from "@/lib/db/outreach";
import { updateContactAsync, getContactByIdAsync } from "@/lib/db/contacts";

/**
 * POST /api/outreach/:id/mark-sent
 * Final transition: mark the draft as sent. Also bumps the linked
 * contact's status from `new`/`researched`/`drafted` → `contacted`.
 */
export const POST = withOperator(async (_req, _auth, { params }) => {
  const { id } = await params;
  const draft = await getOutreachDraftByIdAsync(id);
  if (!draft) return NextResponse.json({ error: "Outreach draft not found" }, { status: 404 });
  if (draft.status === "sent") return NextResponse.json(draft);
  if (draft.status !== "approved" && draft.status !== "draft") {
    return NextResponse.json({ error: `draft must be 'approved' or 'draft' (current: ${draft.status})` }, { status: 400 });
  }

  const updated = await updateOutreachDraftAsync(id, { status: "sent" });

  if (draft.contact_id) {
    const contact = await getContactByIdAsync(draft.contact_id);
    if (contact && ["new", "researched", "drafted"].includes(contact.status)) {
      await updateContactAsync(draft.contact_id, { status: "contacted" });
    }
  }

  return NextResponse.json(updated);
});
