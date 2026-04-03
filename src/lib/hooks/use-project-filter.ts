"use client";

import { useApp } from "@/components/app/app-context";

/** Returns a URLSearchParams string like "?projectId=abc" or "" if no project is active */
export function useProjectFilter() {
  const { activeProjectId } = useApp();
  return activeProjectId ? `?projectId=${activeProjectId}` : "";
}

/** Returns the raw activeProjectId (or null) */
export function useActiveProjectId() {
  const { activeProjectId } = useApp();
  return activeProjectId;
}
