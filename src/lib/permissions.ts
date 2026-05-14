/**
 * Client-safe RBAC types + permission matrix.
 *
 * This file deliberately has NO server-only imports (no `next/server`, no DB
 * access). Both client components and server-side `auth.ts` import from here,
 * so the role types and permission table never drag the server bundle into
 * the client.
 */

export type UserRole = "admin" | "operator" | "viewer";
export const USER_ROLES: UserRole[] = ["admin", "operator", "viewer"];

export function isValidUserRole(role: string): role is UserRole {
  return (USER_ROLES as string[]).includes(role);
}

/** Permission table. Each entry maps an action key to the set of roles that
 *  may perform it. Server routes consult this via the `require*` helpers in
 *  `src/lib/auth.ts`; the client consults it via `userCan` below + the
 *  `<RoleGate>` component. */
export const PERMISSIONS = {
  manageUsers:          ["admin"],
  manageAdminKeys:      ["admin"],
  manageGlobalSettings: ["admin"],
  viewDecryptedSecrets: ["admin"],
  manageEnvVars:        ["admin"],
  mutateAgent:          ["admin", "operator"],
  mutateJob:            ["admin", "operator"],
  mutateDoc:            ["admin", "operator"],
  mutateDatabase:       ["admin", "operator"],
  mutateProject:        ["admin", "operator"],
  mutateTeam:           ["admin", "operator"],
  mutateRun:            ["admin", "operator"],
  mutateWorkflow:       ["admin", "operator"],
  mutateGoal:           ["admin", "operator"],
  mutateTask:           ["admin", "operator"],
  mutateDecision:       ["admin", "operator"],
  mutateContact:        ["admin", "operator"],
  mutateCompany:        ["admin", "operator"],
  mutateOutreach:       ["admin", "operator"],
  manageAutonomyPolicies: ["admin"],
  approveAutonomy:      ["admin", "operator"],
  read:                 ["admin", "operator", "viewer"],
} as const satisfies Record<string, readonly UserRole[]>;

export type Permission = keyof typeof PERMISSIONS;

/** Returns false for null/undefined role so unauthenticated UI safely
 *  renders nothing rather than crashing. */
export function userCan(role: UserRole | undefined | null, action: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[action] as readonly UserRole[]).includes(role);
}
