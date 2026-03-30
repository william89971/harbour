"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SectionHeader } from "@/components/app/section-header";
import { EmptyState } from "@/components/app/empty-state";
import { Textarea } from "@/components/ui/textarea";
import { BackLink } from "@/components/app/back-link";
import { Bot, User, Cog, Send, Play, CheckCheck } from "lucide-react";
import { timeAgo } from "@/lib/time";
import { StatusBadge } from "@/components/app/run-status";

type Activity = {
  id: string; run_id: string; author_type: string; author_id: string | null;
  author_name: string; content: string; created_at: number;
};

type Run = {
  id: string; job_id: string; agent_id: string; status: string;
  job_name: string; agent_name: string; one_off: number;
  created_at: number; updated_at: number; completed_at: number | null;
  activity: Activity[];
};

function AuthorIcon({ type }: { type: string }) {
  switch (type) {
    case "agent": return <Bot className="h-4 w-4" />;
    case "user": return <User className="h-4 w-4" />;
    default: return <Cog className="h-4 w-4" />;
  }
}

export default function RunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const { data: run = null, isLoading: loading } = useQuery<Run | null>({
    queryKey: ["runs", id],
    queryFn: async () => {
      const res = await fetch(`/api/runs/${id}`);
      if (!res.ok) return null;
      return res.json();
    },
    refetchInterval: 5000,
  });

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim()) return;
    setSending(true);
    const res = await fetch(`/api/runs/${id}/activity`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: message }),
    });
    if (res.ok) {
      setMessage("");
      queryClient.invalidateQueries({ queryKey: ["runs", id] });
    }
    setSending(false);
  }

  if (loading) return <div className="text-sm text-muted-foreground py-12 text-center">Loading...</div>;
  if (!run) return <div className="text-sm text-muted-foreground py-12 text-center">Run not found.</div>;

  return (
    <div className="space-y-6">
      <BackLink href="/" label="Runs" />

      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">{run.job_name}</h1>
          <StatusBadge status={run.status} />
        </div>
        {!run.one_off && (
          <Link href={`/jobs/${run.job_id}`}>
            <Button variant="outline" size="sm">View Job</Button>
          </Link>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-3 gap-x-4 rounded-lg border p-3">
        <div className="flex items-center gap-2 text-sm">
          <Bot className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <Link href={`/agents/${run.agent_id}`} className="text-muted-foreground hover:text-foreground transition-colors truncate">{run.agent_name}</Link>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Play className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-muted-foreground truncate">{timeAgo(run.created_at)}</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <CheckCheck className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-muted-foreground truncate">{run.completed_at ? timeAgo(run.completed_at) : "—"}</span>
        </div>
      </div>

      {/* Activity Log */}
      <div className="space-y-1">
        <SectionHeader>Activity</SectionHeader>
        <div className="space-y-3">
          {run.activity.length === 0 ? (
            <EmptyState>No activity yet.</EmptyState>
          ) : (
            run.activity.map(entry => (
              <div key={entry.id} className={`flex gap-3 ${entry.author_type === "system" ? "opacity-60" : ""}`}>
                <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full mt-0.5 ${
                  entry.author_type === "agent" ? "bg-primary/10 text-primary" :
                  entry.author_type === "user" ? "bg-blue-500/10 text-blue-600 dark:text-blue-400" :
                  "bg-muted text-muted-foreground"
                }`}>
                  <AuthorIcon type={entry.author_type} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{entry.author_name}</span>
                    <span className="text-xs text-muted-foreground">{timeAgo(entry.created_at)}</span>
                  </div>
                  <div className="prose prose-sm dark:prose-invert max-w-none mt-0.5 text-sm">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{entry.content}</ReactMarkdown>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Reply Form (only for waiting/running runs) */}
      {(run.status === "waiting" || run.status === "pending" || run.status === "running") && (
        <form onSubmit={handleSend} className="space-y-2">
          <Textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder="Type a response..."
            rows={3}
            onKeyDown={e => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleSend(e);
              }
            }}
          />
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={sending || !message.trim()}>
              <Send className="h-3.5 w-3.5 mr-1.5" /> Send
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
