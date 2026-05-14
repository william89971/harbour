"use client";

/**
 * Lightweight per-run feedback widget. Three pill buttons (useful / neutral /
 * not useful) + an optional comment textarea. Saves to
 * POST /api/runs/:id/feedback. Re-rating updates in place.
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ThumbsUp, ThumbsDown, Minus, MessageSquare } from "lucide-react";
import { RoleGate } from "@/components/app/role-gate";

type FeedbackRating = "useful" | "not_useful" | "neutral";
type Row = {
  id: string;
  run_id: string;
  rating: FeedbackRating;
  comment: string | null;
  created_at: number;
  updated_at: number;
};

export function RunFeedback({ runId }: { runId: string }) {
  const qc = useQueryClient();
  const [showComment, setShowComment] = useState(false);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);

  const { data } = useQuery<{ mine: Row | null }>({
    queryKey: ["run-feedback", runId],
    queryFn: async () => {
      const r = await fetch(`/api/runs/${runId}/feedback`);
      if (!r.ok) return { mine: null };
      return r.json();
    },
  });
  const mine = data?.mine ?? null;
  const currentRating = mine?.rating ?? null;

  async function save(rating: FeedbackRating, withComment?: string) {
    setSaving(true);
    try {
      const res = await fetch(`/api/runs/${runId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, comment: withComment ?? mine?.comment ?? null }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j.error || "Failed to save feedback");
        return;
      }
      qc.invalidateQueries({ queryKey: ["run-feedback", runId] });
      qc.invalidateQueries({ queryKey: ["agent-scorecard"] });
      qc.invalidateQueries({ queryKey: ["agent-scorecards"] });
      qc.invalidateQueries({ queryKey: ["today"] });
    } finally {
      setSaving(false);
    }
  }

  function handleClick(rating: FeedbackRating) {
    if (currentRating === rating) return;
    save(rating);
  }

  async function handleSaveComment(e: React.FormEvent) {
    e.preventDefault();
    if (!currentRating) {
      alert("Pick a rating first.");
      return;
    }
    await save(currentRating, comment);
    setShowComment(false);
    setComment("");
  }

  function pillClass(rating: FeedbackRating, base: string) {
    const isOn = currentRating === rating;
    return `inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${
      isOn ? `${base} font-medium` : "text-muted-foreground hover:bg-accent"
    }`;
  }

  return (
    <RoleGate action="mutateRun">
      <section className="rounded-lg border p-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">Rate this run</span>
          <button
            type="button"
            onClick={() => handleClick("useful")}
            disabled={saving}
            className={pillClass("useful", "border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400")}
          >
            <ThumbsUp className="h-3.5 w-3.5" /> Useful
          </button>
          <button
            type="button"
            onClick={() => handleClick("neutral")}
            disabled={saving}
            className={pillClass("neutral", "border-muted-foreground/40 bg-muted text-foreground")}
          >
            <Minus className="h-3.5 w-3.5" /> Neutral
          </button>
          <button
            type="button"
            onClick={() => handleClick("not_useful")}
            disabled={saving}
            className={pillClass("not_useful", "border-rose-500/60 bg-rose-500/10 text-rose-700 dark:text-rose-400")}
          >
            <ThumbsDown className="h-3.5 w-3.5" /> Not useful
          </button>
          <button
            type="button"
            onClick={() => {
              setComment(mine?.comment ?? "");
              setShowComment(s => !s);
            }}
            className="ml-auto text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            <MessageSquare className="h-3.5 w-3.5" /> {mine?.comment ? "Edit note" : "Add note"}
          </button>
        </div>
        {mine?.comment && !showComment && (
          <p className="text-xs italic text-muted-foreground">{mine.comment}</p>
        )}
        {showComment && (
          <form onSubmit={handleSaveComment} className="space-y-2">
            <Textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              rows={2}
              placeholder="Why this rating? (optional)"
              className="text-sm"
            />
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={saving || !currentRating}>Save note</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => { setShowComment(false); setComment(""); }}>Cancel</Button>
            </div>
          </form>
        )}
      </section>
    </RoleGate>
  );
}
