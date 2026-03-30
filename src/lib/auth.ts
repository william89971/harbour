import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getSession, authenticateAgent } from "./db/queries";

export type AuthContext = {
  type: "user";
  userId: string;
  email: string;
  displayName: string;
} | {
  type: "agent";
  agentId: string;
  agentName: string;
};

export async function getAuthFromRequest(req: NextRequest): Promise<AuthContext | null> {
  // Check for API key auth (agents)
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const apiKey = authHeader.slice(7);
    const agent = authenticateAgent(apiKey);
    if (agent) {
      return { type: "agent", agentId: agent.id, agentName: agent.name };
    }
    return null;
  }

  // Check for session cookie auth (users)
  const sessionId = req.cookies.get("harbour_session")?.value;
  if (sessionId) {
    const session = getSession(sessionId);
    if (session) {
      return { type: "user", userId: session.userId, email: session.email, displayName: session.displayName };
    }
  }

  return null;
}

export async function getAuthFromCookies(): Promise<{ userId: string; email: string; displayName: string } | null> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get("harbour_session")?.value;
  if (!sessionId) return null;
  const session = getSession(sessionId);
  if (!session) return null;
  return { userId: session.userId, email: session.email, displayName: session.displayName };
}

export function requireAuth(auth: AuthContext | null): NextResponse | null {
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export function getActorFromAuth(auth: AuthContext): { actorType: string; actorId: string } {
  if (auth.type === "user") {
    return { actorType: "user", actorId: auth.userId };
  }
  return { actorType: "agent", actorId: auth.agentId };
}
