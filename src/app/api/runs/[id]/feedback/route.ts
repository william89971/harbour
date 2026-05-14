import { NextResponse } from "next/server";
import { withAuth, withUserOperator } from "@/lib/auth";
import {
  upsertRunFeedbackAsync,
  getMyRunFeedbackAsync,
  listRunFeedbackAsync,
  FEEDBACK_RATINGS,
  type FeedbackRating,
} from "@/lib/db/feedback";
import { getRunByIdAsync } from "@/lib/db/runs";

function isRating(v: unknown): v is FeedbackRating {
  return typeof v === "string" && (FEEDBACK_RATINGS as string[]).includes(v);
}

export const GET = withAuth(async (_req, auth, { params }) => {
  const { id } = await params;
  const all = await listRunFeedbackAsync(id);
  const mine = auth.type === "user"
    ? await getMyRunFeedbackAsync(id, auth.userId)
    : null;
  return NextResponse.json({ mine, all });
});

export const POST = withUserOperator(async (req, auth, { params }) => {
  const { id } = await params;
  const run = await getRunByIdAsync(id);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  let body: { rating?: unknown; comment?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!isRating(body.rating)) {
    return NextResponse.json({ error: `rating must be one of ${FEEDBACK_RATINGS.join(", ")}` }, { status: 400 });
  }
  const comment = typeof body.comment === "string" ? body.comment : null;

  const row = await upsertRunFeedbackAsync({
    runId: id,
    userId: auth.userId,
    rating: body.rating,
    comment,
  });
  return NextResponse.json(row);
});
