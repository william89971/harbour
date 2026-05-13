import { NextResponse } from "next/server";
import { withUserAuth, requireAdmin } from "@/lib/auth";
import fs from "fs";
import path from "path";
import os from "os";

// Mirrors the constants in bin/lib/config.mjs (`.mjs` can't be imported from a
// .ts route, so we duplicate the five integers). Keep in sync.
const DEFAULT_SECONDS = 60;
const MIN_SECONDS = 5;
const MAX_SECONDS = 3600;

function harbourDir() {
  return process.env.HARBOUR_HOME || path.join(os.homedir(), ".harbour");
}
function intervalFile() {
  return path.join(harbourDir(), "runner-config.json");
}

function loadInterval(): number {
  const file = intervalFile();
  if (!fs.existsSync(file)) return DEFAULT_SECONDS;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
    const n = Number(raw?.pollIntervalSeconds);
    return Number.isInteger(n) && n >= MIN_SECONDS && n <= MAX_SECONDS ? n : DEFAULT_SECONDS;
  } catch {
    return DEFAULT_SECONDS;
  }
}

export const GET = withUserAuth(async () => {
  return NextResponse.json({
    pollIntervalSeconds: loadInterval(),
    min: MIN_SECONDS,
    max: MAX_SECONDS,
    default: DEFAULT_SECONDS,
  });
});

export const PUT = withUserAuth(async (req, auth) => {
  const e = requireAdmin(auth); if (e) return e;
  const body = await req.json();
  const n = Number(body?.pollIntervalSeconds);
  if (!Number.isInteger(n) || n < MIN_SECONDS || n > MAX_SECONDS) {
    return NextResponse.json(
      { error: `pollIntervalSeconds must be an integer between ${MIN_SECONDS} and ${MAX_SECONDS}` },
      { status: 400 },
    );
  }
  fs.mkdirSync(harbourDir(), { recursive: true });
  fs.writeFileSync(intervalFile(), JSON.stringify({ pollIntervalSeconds: n }, null, 2));
  return NextResponse.json({ pollIntervalSeconds: n });
});
