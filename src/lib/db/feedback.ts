import { getDbAsync } from "./schema";
import { nowSql } from "./dialect";
import { v4 as uuid } from "uuid";

export type FeedbackRating = "useful" | "not_useful" | "neutral";
export const FEEDBACK_RATINGS: FeedbackRating[] = ["useful", "not_useful", "neutral"];

export type RunFeedbackRow = {
  id: string;
  run_id: string;
  created_by_user_id: string | null;
  rating: FeedbackRating;
  comment: string | null;
  created_at: number;
  updated_at: number;
};

/** Upsert one feedback row per (run, user). Re-rating updates rating + comment + updated_at. */
export async function upsertRunFeedbackAsync(input: {
  runId: string;
  userId: string;
  rating: FeedbackRating;
  comment?: string | null;
}): Promise<RunFeedbackRow> {
  const db = await getDbAsync();
  const id = uuid();
  await db.run(
    `INSERT INTO run_feedback (id, run_id, created_by_user_id, rating, comment)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(run_id, created_by_user_id) DO UPDATE SET
       rating = excluded.rating,
       comment = excluded.comment,
       updated_at = ${nowSql(db)}`,
    [id, input.runId, input.userId, input.rating, input.comment ?? null],
  );
  const row = await db.get<RunFeedbackRow>(
    `SELECT * FROM run_feedback WHERE run_id = ? AND created_by_user_id = ?`,
    [input.runId, input.userId],
  );
  return row!;
}

export async function getMyRunFeedbackAsync(runId: string, userId: string): Promise<RunFeedbackRow | null> {
  const db = await getDbAsync();
  const row = await db.get<RunFeedbackRow>(
    `SELECT * FROM run_feedback WHERE run_id = ? AND created_by_user_id = ?`,
    [runId, userId],
  );
  return row ?? null;
}

export async function listRunFeedbackAsync(runId: string): Promise<RunFeedbackRow[]> {
  const db = await getDbAsync();
  return db.all<RunFeedbackRow>(
    `SELECT * FROM run_feedback WHERE run_id = ? ORDER BY created_at DESC`,
    [runId],
  );
}

export async function countAgentFeedbackAsync(agentId: string): Promise<{ useful: number; not_useful: number; neutral: number }> {
  const db = await getDbAsync();
  const rows = await db.all<{ rating: FeedbackRating; n: number }>(
    `SELECT f.rating AS rating, COUNT(*) AS n
     FROM run_feedback f
     JOIN runs r ON r.id = f.run_id
     WHERE r.agent_id = ?
     GROUP BY f.rating`,
    [agentId],
  );
  const out = { useful: 0, not_useful: 0, neutral: 0 };
  for (const row of rows) {
    if (row.rating === "useful") out.useful = Number(row.n);
    else if (row.rating === "not_useful") out.not_useful = Number(row.n);
    else if (row.rating === "neutral") out.neutral = Number(row.n);
  }
  return out;
}
