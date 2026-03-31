"use client";

import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/app/section-header";
import { EmptyState } from "@/components/app/empty-state";
import { Textarea } from "@/components/ui/textarea";
import { BackLink } from "@/components/app/back-link";
import { Bot, User, Cog, Send, Play, CheckCheck, Terminal } from "lucide-react";
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

type OutputEvent = {
  id: number;
  run_id: string;
  event_type: string;
  content: string | null;
  tool_name: string | null;
  created_at: number;
};

function AuthorIcon({ type }: { type: string }) {
  switch (type) {
    case "agent": return <Bot className="h-4 w-4" />;
    case "user": return <User className="h-4 w-4" />;
    default: return <Cog className="h-4 w-4" />;
  }
}

function LiveOutput({ runId, status }: { runId: string; status: string }) {
  const [events, setEvents] = useState<OutputEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastIdRef = useRef(0);
  const isActive = status === "running" || status === "pending";

  // Load existing output events on mount, then connect SSE
  useEffect(() => {
    let cancelled = false;

    async function init() {
      // Fetch existing events first
      try {
        const res = await fetch(`/api/runs/${runId}/output`);
        if (res.ok && !cancelled) {
          const data = await res.json() as OutputEvent[];
          if (data.length > 0) {
            setEvents(data);
            lastIdRef.current = data[data.length - 1].id;
          }
        }
      } catch { /* ignore */ }

      // If run is active, connect SSE for new events
      if (!isActive || cancelled) return;

      const evtSource = new EventSource(`/api/runs/${runId}/output/stream?after=${lastIdRef.current}`);
      if (!cancelled) setConnected(true);

      evtSource.addEventListener("output", (e) => {
        if (cancelled) return;
        const evt = JSON.parse(e.data) as OutputEvent;
        // Deduplicate by ID
        if (evt.id <= lastIdRef.current) return;
        lastIdRef.current = evt.id;
        setEvents(prev => [...prev, evt]);
      });

      evtSource.addEventListener("done", () => {
        evtSource.close();
        if (!cancelled) setConnected(false);
      });

      evtSource.onerror = () => {
        evtSource.close();
        if (!cancelled) setConnected(false);
      };

      // Store cleanup ref
      cleanupRef = () => {
        evtSource.close();
        setConnected(false);
      };
    }

    let cleanupRef: (() => void) | null = null;
    init();

    return () => {
      cancelled = true;
      cleanupRef?.();
    };
  }, [runId, isActive]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events]);

  if (events.length === 0 && !isActive) return null;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <SectionHeader>
          <span className="flex items-center gap-1.5">
            <Terminal className="h-4 w-4" />
            Output
          </span>
        </SectionHeader>
        {connected && (
          <span className="flex items-center gap-1.5 text-xs text-emerald-500">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            Live
          </span>
        )}
      </div>
      <div
        ref={scrollRef}
        className="bg-zinc-950 rounded-lg border border-zinc-800 p-3 font-mono text-xs max-h-[500px] overflow-y-auto"
      >
        {events.length === 0 ? (
          <span className="text-zinc-500">Waiting for output...</span>
        ) : (
          events.map((evt) => (
            <OutputLine key={evt.id} event={evt} />
          ))
        )}
        {connected && (
          <span className="inline-block w-2 h-3.5 bg-emerald-500/70 animate-pulse ml-0.5" />
        )}
      </div>
    </div>
  );
}

function OutputLine({ event }: { event: OutputEvent }) {
  switch (event.event_type) {
    case "text_delta":
      return <span className="text-zinc-200 whitespace-pre-wrap">{event.content}</span>;
    case "thinking":
      return <span className="text-zinc-500 italic whitespace-pre-wrap">{event.content}</span>;
    case "tool_start":
      return (
        <div className="text-amber-400/80 mt-1.5 mb-0.5">
          <span className="text-amber-500">{">"}</span>{" "}
          {event.tool_name && <span className="font-semibold">{event.tool_name}</span>}
          {event.content && <span className="text-zinc-400 ml-1">{event.content}</span>}
        </div>
      );
    case "tool_end":
      return (
        <div className="text-zinc-500 mb-1.5 pl-3 border-l border-zinc-800 whitespace-pre-wrap max-h-40 overflow-y-auto">
          {event.content ? (event.content.length > 500 ? event.content.slice(0, 500) + "..." : event.content) : "(done)"}
        </div>
      );
    case "info":
      return (
        <div className="text-blue-400/70 mb-1">
          {event.content}
        </div>
      );
    case "result":
      return (
        <div className="text-zinc-500 mt-2 pt-1.5 border-t border-zinc-800">
          {event.content}
        </div>
      );
    case "error":
      return (
        <div className="text-red-400 mt-1">
          {event.content}
        </div>
      );
    default:
      return <span className="text-zinc-400 whitespace-pre-wrap">{event.content}</span>;
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
          <span className="text-muted-foreground truncate">{run.completed_at ? timeAgo(run.completed_at) : "\u2014"}</span>
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

      {/* Live Output */}
      <LiveOutput runId={run.id} status={run.status} />
    </div>
  );
}
