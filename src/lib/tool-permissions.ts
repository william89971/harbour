import { NextResponse } from "next/server";
import type { AuthContext } from "./auth";
import type { ToolName } from "./db/agents";

/** Server-side gate: a UserAuth caller (admin/operator/viewer) always passes
 *  the tool-permission check (role gating happens separately via the
 *  `withOperator` / `requireRole` wrappers). An AgentAuth caller is denied
 *  with 403 when the named tool is FALSE in its tool_permissions map.
 *
 *  Returns null when the caller is permitted; returns a NextResponse to
 *  short-circuit when denied. Designed to be called inline at the top of
 *  a route handler:
 *
 *    const denied = requireTool(auth, "write_docs");
 *    if (denied) return denied;
 */
export function requireTool(auth: AuthContext, tool: ToolName): NextResponse | null {
  if (auth.type !== "agent") return null;
  if (auth.toolPermissions[tool]) return null;
  return NextResponse.json(
    { error: `tool '${tool}' is not permitted for this agent` },
    { status: 403 },
  );
}
