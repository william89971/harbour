import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { requireTool } from "@/lib/tool-permissions";
import {
  getWeeklyReviewJobStatusAsync,
  isWeeklyReviewDue,
  listRecentWeeklyReviewsAsync,
} from "@/lib/weekly-review";

export const GET = withAuth(async (_req, auth) => {
  const readErr = requireTool(auth, "read_docs");
  if (readErr) return readErr;

  const [reviews, scheduledJob] = await Promise.all([
    listRecentWeeklyReviewsAsync(12),
    getWeeklyReviewJobStatusAsync(),
  ]);
  const latest = reviews[0] ?? null;

  return NextResponse.json({
    reviews: reviews.map(review => ({
      id: review.id,
      title: review.title,
      created_at: review.created_at,
      updated_at: review.updated_at,
      recommendations: review.recommendations,
    })),
    latest: latest
      ? {
          id: latest.id,
          title: latest.title,
          created_at: latest.created_at,
          updated_at: latest.updated_at,
          recommendations: latest.recommendations,
        }
      : null,
    due: isWeeklyReviewDue(latest),
    scheduledJob,
  });
});

