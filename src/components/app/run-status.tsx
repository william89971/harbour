import {
  AlertCircle, CheckCircle2, XCircle, Clock, SkipForward, Hourglass, CalendarClock,
} from "lucide-react";

const statusIcons: Record<string, { icon: typeof Clock; color: string; bg: string }> = {
  scheduled: { icon: CalendarClock, color: "text-violet-500",        bg: "bg-violet-500/10" },
  waiting:   { icon: AlertCircle,   color: "text-amber-500",         bg: "bg-amber-500/10" },
  pending:   { icon: Hourglass,     color: "text-blue-500",          bg: "bg-blue-500/10" },
  done:      { icon: CheckCircle2,  color: "text-green-500",         bg: "bg-green-500/10" },
  failed:    { icon: XCircle,       color: "text-red-500",           bg: "bg-red-500/10" },
  running:   { icon: Clock,         color: "text-blue-500",          bg: "bg-blue-500/10" },
  skipped:   { icon: SkipForward,   color: "text-muted-foreground",  bg: "bg-muted" },
};

/** Boxed status icon (8x8 rounded-lg) used in list views */
export function RunStatusIcon({ status }: { status: string }) {
  const cfg = statusIcons[status];
  const Icon = cfg?.icon ?? Clock;
  return (
    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${cfg?.bg ?? "bg-muted"}`}>
      <Icon className={`h-4 w-4 ${cfg?.color ?? "text-muted-foreground"}`} />
    </div>
  );
}

/** Inline status icon (3.5x3.5) for compact views */
export function StatusDot({ status }: { status: string }) {
  const cfg = statusIcons[status];
  const Icon = cfg?.icon ?? Clock;
  return <Icon className={`h-3.5 w-3.5 ${cfg?.color ?? "text-muted-foreground"}`} />;
}

/** Colored text badge */
export function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    scheduled: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
    running:   "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    waiting:   "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    pending:   "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    done:      "bg-green-500/10 text-green-600 dark:text-green-400",
    failed:    "bg-red-500/10 text-red-600 dark:text-red-400",
    skipped:   "bg-muted text-muted-foreground",
  };
  return <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${colors[status] || ""}`}>{status}</span>;
}
