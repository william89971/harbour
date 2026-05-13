"use client";

import { useCurrentUser } from "@/lib/hooks/use-current-user";
import type { Permission } from "@/lib/permissions";

/** Conditionally renders children based on the current user's permission.
 *  Returns null while loading to avoid flashing admin-only controls. */
export function RoleGate({ action, children, fallback = null }: {
  action: Permission;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { can, isLoading } = useCurrentUser();
  if (isLoading) return null;
  return can(action) ? <>{children}</> : <>{fallback}</>;
}
