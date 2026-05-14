export function timeAgo(ts: number | null | undefined): string {
  if (!ts) return "never";
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

/**
 * Unix-seconds timestamp for the start of "today" in the given IANA timezone.
 * Used by aggregators that need to filter rows by `completed_at >= startOfToday`.
 */
export function startOfTodayUnix(timezone?: string): number {
  const now = new Date();
  const tz = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? "0");
  const y = get("year");
  const m = get("month");
  const d = get("day");
  const h = get("hour") % 24;
  const mi = get("minute");
  const s = get("second");
  // Wall-clock "now" in tz expressed as UTC epoch ms — diff to actual now gives the offset.
  const asUtc = Date.UTC(y, m - 1, d, h, mi, s);
  const offsetMs = asUtc - now.getTime();
  const startOfDayUtcMs = Date.UTC(y, m - 1, d, 0, 0, 0) - offsetMs;
  return Math.floor(startOfDayUtcMs / 1000);
}

/** Unix seconds for the start of "yesterday" in the given timezone. */
export function startOfYesterdayUnix(timezone?: string): number {
  return startOfTodayUnix(timezone) - 86400;
}

export function formatTimestamp(ts: number | null, timezone?: string): string | null {
  if (!ts) return null;
  const d = new Date(ts * 1000);
  const now = new Date();
  const opts: Intl.DateTimeFormatOptions = timezone ? { timeZone: timezone } : {};
  const isToday = d.toLocaleDateString("en-US", opts) === now.toLocaleDateString("en-US", opts);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", ...opts });
  if (isToday) return `Today at ${time}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (d.toLocaleDateString("en-US", opts) === tomorrow.toLocaleDateString("en-US", opts)) return `Tomorrow at ${time}`;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric", ...opts })} at ${time}`;
}
