import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
// User-only: agents must never read or write any agent's settings.json.
// withOperator would let agent Bearer tokens through (requireRole returns null
// for non-user auth), which would be a safe-mode escape vector — a Claude
// agent in safe mode could PUT a permissive settings.json to lift the
// deny-list on its own next run.
import { withUserOperator } from "@/lib/auth";
import { getAgentByIdAsync } from "@/lib/db/queries";
import { agentSettingsJsonPath, agentWorkspaceDir, ensureDir } from "@/lib/paths";
import { validateClaudeSettingsPath } from "@/lib/claude-settings";

type Agent = { id: string; name: string; cli: string | null; type: string; permission_mode: string };

async function ensureClaudeAgent(id: string): Promise<{ agent: Agent } | { error: NextResponse }> {
  const agent = (await getAgentByIdAsync(id)) as Agent | null;
  if (!agent) return { error: NextResponse.json({ error: "Agent not found" }, { status: 404 }) };
  if (agent.type !== "harbour" || agent.cli !== "claude") {
    return { error: NextResponse.json({ error: "settings.json is only configurable for Claude Code agents" }, { status: 400 }) };
  }
  return { agent };
}

export const GET = withUserOperator(async (_req, _auth, { params }) => {
  const { id } = await params;
  const r = await ensureClaudeAgent(id);
  if ("error" in r) return r.error;
  const settingsPath = agentSettingsJsonPath(r.agent.name);
  const v = validateClaudeSettingsPath(settingsPath);
  let contents: string | null = null;
  if (v.ok) {
    try { contents = fs.readFileSync(settingsPath, "utf-8"); } catch { /* race */ }
  }
  return NextResponse.json({
    mode: r.agent.permission_mode,
    settingsJsonPath: settingsPath,
    settingsJsonContents: contents,
    validationError: v.ok ? null : v.error,
  });
});

export const PUT = withUserOperator(async (req, _auth, { params }) => {
  const { id } = await params;
  const r = await ensureClaudeAgent(id);
  if ("error" in r) return r.error;

  let body: { contents?: string; confirm?: boolean } = {};
  try { body = await req.json(); } catch { /* empty body */ }
  if (typeof body.contents !== "string" || !body.contents.trim()) {
    return NextResponse.json({ error: "contents (JSON string) is required" }, { status: 400 });
  }
  let parsed: unknown;
  try { parsed = JSON.parse(body.contents); } catch (err) {
    return NextResponse.json({ error: `not valid JSON: ${(err as Error).message}` }, { status: 400 });
  }
  if (!parsed || typeof parsed !== "object") {
    return NextResponse.json({ error: "settings.json must be a JSON object" }, { status: 400 });
  }
  const obj = parsed as Record<string, unknown>;
  if (!obj.permissions || typeof obj.permissions !== "object") {
    return NextResponse.json({ error: "missing top-level `permissions` object" }, { status: 400 });
  }

  const settingsPath = agentSettingsJsonPath(r.agent.name);
  // Refuse to clobber an existing file unless explicitly confirmed. This is
  // a footgun guard for the case where a user has been hand-editing the
  // file and didn't realize the dashboard would overwrite it.
  if (fs.existsSync(settingsPath) && !body.confirm) {
    return NextResponse.json({ error: "settings.json already exists; pass confirm:true to overwrite" }, { status: 409 });
  }
  ensureDir(path.dirname(settingsPath));
  // Refuse symlinks defensively — a malicious link could otherwise redirect
  // the write to a sensitive file.
  try {
    const stat = fs.lstatSync(settingsPath);
    if (stat.isSymbolicLink()) {
      return NextResponse.json({ error: "settings.json is a symlink; refusing to write" }, { status: 400 });
    }
  } catch { /* file doesn't exist — fine */ }
  ensureDir(agentWorkspaceDir(r.agent.name));
  fs.writeFileSync(settingsPath, JSON.stringify(parsed, null, 2) + "\n");
  return NextResponse.json({ ok: true, settingsJsonPath: settingsPath });
});
