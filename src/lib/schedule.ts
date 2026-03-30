// Canonical schedule JSON shapes:
//   Interval: {"every": N}  — N is minutes
//   Weekly:   {"days": [0-6], "time": "HH:MM"} — days are 0=Sun..6=Sat, time is 24h

// ---------------------------------------------------------------------------
// Normalization: convert any accepted format to canonical JSON
// ---------------------------------------------------------------------------

const DAY_NAMES: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function parseAmPm(hour: number, ampm?: string): number {
  if (ampm === "pm" && hour < 12) return hour + 12;
  if (ampm === "am" && hour === 12) return 0;
  return hour;
}

// Normalize any supported schedule string to canonical JSON.
// Returns the canonical JSON string, or null if the input can't be parsed.
export function normalizeSchedule(input: string): string | null {
  const s = input.trim();

  // 1. Already canonical JSON?
  try {
    const parsed = JSON.parse(s);
    if ("every" in parsed && typeof parsed.every === "number" && parsed.every > 0) {
      return JSON.stringify({ every: parsed.every });
    }
    if (Array.isArray(parsed.days) && typeof parsed.time === "string") {
      const days = parsed.days.filter((d: any) => typeof d === "number" && d >= 0 && d <= 6).sort((a: number, b: number) => a - b);
      if (days.length > 0 && /^\d{2}:\d{2}$/.test(parsed.time)) {
        return JSON.stringify({ days, time: parsed.time });
      }
    }
    // Parsed as JSON but doesn't match either shape
    return null;
  } catch {
    // Not JSON — continue
  }

  const lower = s.toLowerCase();

  // 2. "every N unit(s)"
  const everyMatch = lower.match(/^every\s+(\d+)\s+(second|minute|hour|day|week)s?$/);
  if (everyMatch) {
    const n = parseInt(everyMatch[1], 10);
    const multiplier: Record<string, number> = { second: 1 / 60, minute: 1, hour: 60, day: 1440, week: 10080 };
    const mins = Math.round(n * multiplier[everyMatch[2]]);
    return mins > 0 ? JSON.stringify({ every: mins }) : null;
  }

  // 3. "hourly" or "hourly at :MM"
  const hourlyMatch = lower.match(/^hourly(?:\s+at\s+:(\d{2}))?$/);
  if (hourlyMatch) {
    return JSON.stringify({ every: 60 });
  }

  // 4. "daily" or "daily at HH:MM/Ham/Hpm"
  const dailyMatch = lower.match(/^daily(?:\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?$/);
  if (dailyMatch) {
    const hour = parseAmPm(dailyMatch[1] ? parseInt(dailyMatch[1], 10) : 0, dailyMatch[3]);
    const minute = dailyMatch[2] ? parseInt(dailyMatch[2], 10) : 0;
    return JSON.stringify({ days: ALL_DAYS, time: `${pad(hour)}:${pad(minute)}` });
  }

  // 5. "weekly [on <day>] [at HH:MM]"
  const weeklyMatch = lower.match(/^weekly(?:\s+on\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday))?(?:\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?$/);
  if (weeklyMatch) {
    const day = weeklyMatch[1] ? DAY_NAMES[weeklyMatch[1]] : 1;
    const hour = parseAmPm(weeklyMatch[2] ? parseInt(weeklyMatch[2], 10) : 0, weeklyMatch[4]);
    const minute = weeklyMatch[3] ? parseInt(weeklyMatch[3], 10) : 0;
    return JSON.stringify({ days: [day], time: `${pad(hour)}:${pad(minute)}` });
  }

  // 6. Cron expressions (common patterns only)
  const parts = s.split(/\s+/);
  if (parts.length === 5) {
    const [cronMin, cronHr, , , cronDow] = parts;

    // */N * * * * → interval
    const minInterval = cronMin.match(/^\*\/(\d+)$/);
    if (minInterval && cronHr === "*") {
      return JSON.stringify({ every: parseInt(minInterval[1], 10) });
    }

    // 0 */N * * * → hourly interval
    const hrInterval = cronHr.match(/^\*\/(\d+)$/);
    if (hrInterval && cronMin === "0") {
      return JSON.stringify({ every: parseInt(hrInterval[1], 10) * 60 });
    }

    // M H * * DOW → specific time + days
    const h = parseInt(cronHr, 10);
    const m = parseInt(cronMin, 10);
    if (!isNaN(h) && !isNaN(m) && h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      const time = `${pad(h)}:${pad(m)}`;
      if (cronDow === "*") return JSON.stringify({ days: ALL_DAYS, time });
      const days = parseCronDays(cronDow);
      if (days.length > 0) return JSON.stringify({ days, time });
    }
  }

  return null;
}

function parseCronDays(dow: string): number[] {
  const days = new Set<number>();
  for (const part of dow.split(",")) {
    const range = part.match(/^(\d)-(\d)$/);
    if (range) {
      for (let i = parseInt(range[1]); i <= parseInt(range[2]); i++) days.add(i);
    } else if (/^\d$/.test(part)) {
      days.add(parseInt(part));
    }
  }
  return [...days].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Next run time: only handles canonical JSON (all storage is normalized)
// ---------------------------------------------------------------------------

export function getNextRunTime(schedule: string, from?: Date): number | null {
  const now = from || new Date();

  try {
    const parsed = JSON.parse(schedule);

    if ("every" in parsed && typeof parsed.every === "number") {
      const ms = parsed.every * 60000;
      const next = Math.ceil(now.getTime() / ms) * ms;
      return Math.floor(next / 1000);
    }

    if (parsed.days && parsed.time) {
      const [h, m] = parsed.time.split(":").map(Number);
      const currentDay = now.getDay();
      const sortedDays = parsed.days.slice().sort((a: number, b: number) => a - b);

      for (let offset = 0; offset <= 7; offset++) {
        const candidateDay = (currentDay + offset) % 7;
        if (!sortedDays.includes(candidateDay)) continue;
        const candidate = new Date(now);
        candidate.setDate(candidate.getDate() + offset);
        candidate.setHours(h, m, 0, 0);
        if (candidate > now) return Math.floor(candidate.getTime() / 1000);
      }
      // Wrap to next week
      const candidate = new Date(now);
      candidate.setDate(candidate.getDate() + ((sortedDays[0] - currentDay + 7) % 7 || 7));
      candidate.setHours(h, m, 0, 0);
      return Math.floor(candidate.getTime() / 1000);
    }
  } catch {
    // Not valid JSON
  }

  return null;
}

export function isValidSchedule(schedule: string): boolean {
  return normalizeSchedule(schedule) !== null;
}
