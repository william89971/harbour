import { NextResponse } from "next/server";
import { getActorFromAuth, withOperator } from "@/lib/auth";
import { requireTool } from "@/lib/tool-permissions";
import { createWeeklyReviewDocAsync } from "@/lib/weekly-review";

export const POST = withOperator(async (req, auth) => {
  const writeErr = requireTool(auth, "write_docs");
  if (writeErr) return writeErr;

  const body = await req.json().catch(() => ({}));
  const startTs = Number.isFinite(Number(body.start_ts)) ? Number(body.start_ts) : undefined;
  const endTs = Number.isFinite(Number(body.end_ts)) ? Number(body.end_ts) : undefined;
  const nowTs = Number.isFinite(Number(body.now_ts)) ? Number(body.now_ts) : undefined;

  const { actorType, actorId } = getActorFromAuth(auth);
  const result = await createWeeklyReviewDocAsync({
    actorType,
    actorId,
    startTs,
    endTs,
    nowTs,
  });

  return NextResponse.json({
    doc: result.doc,
    review: result.review,
  }, { status: 201 });
});

