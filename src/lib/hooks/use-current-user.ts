"use client";

import { useQuery } from "@tanstack/react-query";
import { userCan, type Permission, type UserRole } from "@/lib/permissions";

type MeResponse =
  | { type: "user"; user: { id: string; email: string; display_name: string; role: UserRole } }
  | { type: "agent"; agent: { id: string; name: string } };

/** Returns the logged-in user's role + a `can(action)` permission check.
 *  Read once per session via React Query. Falls back to `viewer` defensively
 *  if /api/auth/me ever returns a non-user response (shouldn't happen for
 *  pages that are gated by the session cookie). */
export function useCurrentUser() {
  const { data, isLoading } = useQuery<MeResponse>({
    queryKey: ["auth", "me"],
    queryFn: async () => {
      const res = await fetch("/api/auth/me");
      if (!res.ok) throw new Error("Failed to fetch user");
      return res.json();
    },
    staleTime: 5 * 60 * 1000, // 5 minutes — role rarely changes
  });

  const user = data?.type === "user" ? data.user : null;
  const role: UserRole | undefined = user?.role;

  return {
    isLoading,
    user,
    role,
    isAdmin: role === "admin",
    isOperator: role === "operator",
    isViewer: role === "viewer",
    can: (action: Permission) => userCan(role, action),
  };
}
