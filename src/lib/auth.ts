import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getSession, authenticateAgent, authenticateAdminApiKey } from "./db/queries";

// Re-export client-safe types + permissions so callers can still import from
// "@/lib/auth". Client files should import from "@/lib/permissions" directly
// to avoid pulling the server bundle into the client.
export type { UserRole, Permission } from "./permissions";
export { USER_ROLES, isValidUserRole, PERMISSIONS, userCan } from "./permissions";
import type { UserRole } from "./permissions";
import { isValidUserRole } from "./permissions";

export type UserAuth = {
  type: "user";
  userId: string;
  email: string;
  displayName: string;
  role: UserRole;
};

import type { ToolPermissions } from "./db/agents";

export type AgentAuth = {
  type: "agent";
  agentId: string;
  agentName: string;
  /** Per-agent tool permissions joined from the agents table at
   *  authentication time. Used by requireTool to gate mutation endpoints. */
  toolPermissions: ToolPermissions;
};

export type AuthContext = UserAuth | AgentAuth;

type RouteContext = { params: Promise<Record<string, string>> };

type AuthHandler = (req: NextRequest, auth: AuthContext, ctx: RouteContext) => Promise<Response>;
type UserAuthHandler = (req: NextRequest, auth: UserAuth, ctx: RouteContext) => Promise<Response>;

async function getAuthFromRequest(req: NextRequest): Promise<AuthContext | null> {
  // Check for API key auth (agents or admin keys)
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const apiKey = authHeader.slice(7);

    const agent = authenticateAgent(apiKey);
    if (agent) {
      return { type: "agent", agentId: agent.id, agentName: agent.name, toolPermissions: agent.tool_permissions };
    }

    // Admin API keys resolve to the creating user's identity, including role.
    const adminKey = authenticateAdminApiKey(apiKey);
    if (adminKey) {
      // Fall back to viewer (least privilege) if the role column is corrupted
      // or somehow contains an unknown value — defaulting to admin would silently
      // escalate a broken row into full privileges.
      let role: UserRole;
      if (isValidUserRole(adminKey.role)) {
        role = adminKey.role;
      } else {
        console.warn(`[auth] admin-api-key ${adminKey.created_by_user_id} has invalid role ${JSON.stringify(adminKey.role)} — treating as viewer`);
        role = "viewer";
      }
      return { type: "user", userId: adminKey.created_by_user_id, email: adminKey.email, displayName: adminKey.display_name, role };
    }

    return null;
  }

  // Check for session cookie auth (users)
  const sessionId = req.cookies.get("harbour_session")?.value;
  if (sessionId) {
    const session = getSession(sessionId);
    if (session) {
      let role: UserRole;
      if (isValidUserRole(session.role)) {
        role = session.role;
      } else {
        console.warn(`[auth] session ${session.userId} has invalid role ${JSON.stringify(session.role)} — treating as viewer`);
        role = "viewer";
      }
      return {
        type: "user",
        userId: session.userId,
        email: session.email,
        displayName: session.displayName,
        role,
      };
    }
  }

  return null;
}

export function withAuth(handler: AuthHandler) {
  return async (req: NextRequest, ctx: RouteContext) => {
    const auth = await getAuthFromRequest(req);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return handler(req, auth, ctx);
  };
}

export function withUserAuth(handler: UserAuthHandler) {
  return async (req: NextRequest, ctx: RouteContext) => {
    const auth = await getAuthFromRequest(req);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (auth.type !== "user") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return handler(req, auth, ctx);
  };
}

export async function getAuthFromCookies(): Promise<{ userId: string; email: string; displayName: string; role: UserRole } | null> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get("harbour_session")?.value;
  if (!sessionId) return null;
  const session = getSession(sessionId);
  if (!session) return null;
  return {
    userId: session.userId,
    email: session.email,
    displayName: session.displayName,
    role: isValidUserRole(session.role) ? session.role : "viewer",
  };
}

/** If caller is an agent, verify it owns the given agentId. Users pass through. Agentless runs (null agentId) allow any authenticated caller. */
export function requireAgentOwnership(auth: AuthContext, agentId: string | null): NextResponse | null {
  if (!agentId) return null;
  if (auth.type === "agent" && auth.agentId !== agentId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

export function getActorFromAuth(auth: AuthContext): { actorType: string; actorId: string } {
  if (auth.type === "user") {
    return { actorType: "user", actorId: auth.userId };
  }
  return { actorType: "agent", actorId: auth.agentId };
}

// ---------------------------------------------------------------------------
// RBAC: role-based authorization helpers
//
// Agents authenticate as AgentAuth and are scoped by `requireAgentOwnership`
// — they have no role and bypass these helpers (`requireRole` returns null
// for them). Only `UserAuth` (including admin-key callers, which inherit the
// creator's role) is gated here.
// ---------------------------------------------------------------------------

export function requireRole(auth: AuthContext, allowed: UserRole[]): NextResponse | null {
  if (auth.type !== "user") return null;
  if (!allowed.includes(auth.role)) {
    return NextResponse.json({ error: `requires one of: ${allowed.join(", ")}` }, { status: 403 });
  }
  return null;
}

export const requireAdmin = (auth: AuthContext) => requireRole(auth, ["admin"]);
export const requireOperatorOrAdmin = (auth: AuthContext) => requireRole(auth, ["admin", "operator"]);
export const requireReadAccess = (auth: AuthContext) => requireRole(auth, ["admin", "operator", "viewer"]);

/** Wrapper variants for routes that want a single decorator instead of an
 *  inline `requireXxx(auth)` check at the top of each handler. Agent callers
 *  bypass role checks (they're scoped by `requireAgentOwnership` elsewhere). */
export function withRole(roles: UserRole[], handler: AuthHandler) {
  return withAuth(async (req, auth, ctx) => {
    const e = requireRole(auth, roles);
    if (e) return e;
    return handler(req, auth, ctx);
  });
}
export const withAdmin = (handler: AuthHandler) => withRole(["admin"], handler);
export const withOperator = (handler: AuthHandler) => withRole(["admin", "operator"], handler);

/** Variant that REQUIRES a user (rejects agent callers) AND enforces the role.
 *  Use for endpoints that need `auth.userId` (e.g. captain conversations). */
export function withUserRole(roles: UserRole[], handler: UserAuthHandler) {
  return withUserAuth(async (req, auth, ctx) => {
    if (!roles.includes(auth.role)) {
      return NextResponse.json({ error: `requires one of: ${roles.join(", ")}` }, { status: 403 });
    }
    return handler(req, auth, ctx);
  });
}
export const withUserOperator = (handler: UserAuthHandler) => withUserRole(["admin", "operator"], handler);
export const withUserAdmin    = (handler: UserAuthHandler) => withUserRole(["admin"], handler);

// PERMISSIONS + userCan + Permission type are re-exported from "@/lib/permissions" at the top of this file.
