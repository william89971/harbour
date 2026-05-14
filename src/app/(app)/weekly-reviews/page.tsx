"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, FileText, Play, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/app/empty-state";
import { RoleGate } from "@/components/app/role-gate";
import { SaveAsMenu } from "@/components/app/save-as-menu";
import { SectionHeader } from "@/components/app/section-header";
import { formatTimestamp, timeAgo } from "@/lib/time";

type ReviewSummary = {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  recommendations: string[];
};

type ScheduledJob = {
  id: string;
  name: string;
  active: number;
  schedule: string;
  next_run_at: number | null;
  last_run_at: number | null;
} | null;

type WeeklyReviewsResponse = {
  reviews: ReviewSummary[];
  latest: ReviewSummary | null;
  due: boolean;
  scheduledJob: ScheduledJob;
};

export default function WeeklyReviewsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);

  const { data, isLoading } = useQuery<WeeklyReviewsResponse>({
    queryKey: ["weekly-reviews"],
    queryFn: async () => {
      const res = await fetch("/api/weekly-reviews");
      if (!res.ok) throw new Error("Failed to load weekly reviews");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  async function runReview() {
    setRunning(true);
    try {
      const res = await fetch("/api/weekly-reviews/run", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(json.error || "Failed to run Weekly Review.");
        return;
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["weekly-reviews"] }),
        qc.invalidateQueries({ queryKey: ["today"] }),
        qc.invalidateQueries({ queryKey: ["docs"] }),
      ]);
      if (json.doc?.id) router.push(`/docs/${json.doc.id}`);
    } finally {
      setRunning(false);
    }
  }

  if (isLoading || !data) {
    return <div className="text-sm text-muted-foreground py-12 text-center">Loading...</div>;
  }

  const { latest, reviews, due, scheduledJob } = data;

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Weekly Reviews</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Company OS recap, failures, costs, agent health, product/growth progress, and next-week priorities.
          </p>
        </div>
        <RoleGate action="mutateDoc">
          <Button onClick={runReview} disabled={running} size="sm">
            <Play className="h-4 w-4 mr-1.5" />
            {running ? "Running..." : "Run Weekly Review"}
          </Button>
        </RoleGate>
      </div>

      <section>
        <SectionHeader>Schedule</SectionHeader>
        <div className="rounded-lg border p-4 flex items-start gap-3">
          <CalendarCheck className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            {scheduledJob ? (
              <>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">Scheduled job installed</span>
                  <Badge variant={scheduledJob.active ? "default" : "secondary"} className="text-[10px]">
                    {scheduledJob.active ? "active" : "paused"}
                  </Badge>
                  {due && <Badge variant="secondary" className="text-[10px]">review due</Badge>}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Next run: {formatTimestamp(scheduledJob.next_run_at)}. Last run: {formatTimestamp(scheduledJob.last_run_at)}.
                </p>
              </>
            ) : (
              <>
                <div className="text-sm font-medium">No scheduled Weekly Review job installed.</div>
                <p className="text-xs text-muted-foreground mt-1">
                  Install it with <code>npm run harbour -- weekly-review install</code>, or run reviews manually from this page.
                </p>
              </>
            )}
          </div>
        </div>
      </section>

      {latest && (
        <section>
          <SectionHeader>Latest recommendations</SectionHeader>
          {latest.recommendations.length === 0 ? (
            <EmptyState icon={<Sparkles className="h-6 w-6 text-muted-foreground/40" />}>
              The latest review has no extracted recommendations.
            </EmptyState>
          ) : (
            <div className="space-y-2">
              {latest.recommendations.map((rec, i) => (
                <div key={`${latest.id}-${i}`} className="flex items-start gap-3 rounded-lg border p-3">
                  <Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">{rec}</p>
                    <div className="mt-1">
                      <SaveAsMenu content={rec} defaultTitle={rec} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <section>
        <SectionHeader count={reviews.length > 0 ? reviews.length : undefined}>Recent reviews</SectionHeader>
        {reviews.length === 0 ? (
          <EmptyState large icon={<FileText className="h-10 w-10 text-muted-foreground/40" />}>
            No weekly reviews yet. Run one to create the first durable review Doc.
          </EmptyState>
        ) : (
          <div className="space-y-2">
            {reviews.map(review => (
              <Link key={review.id} href={`/docs/${review.id}`} className="flex items-start gap-3 rounded-lg border p-3 hover:bg-accent/50 transition-colors">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <FileText className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{review.title}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {review.recommendations.length} recommendation{review.recommendations.length === 1 ? "" : "s"} - created {timeAgo(review.created_at)}
                  </div>
                </div>
                {review.id === latest?.id && <Badge variant="secondary" className="text-[10px]">latest</Badge>}
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

