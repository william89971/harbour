"use client";

import { createContext, useContext } from "react";

export type User = { userId: string; email: string; displayName: string };
export type Project = { id: string; name: string; created_at: number; updated_at: number };

export type AppContextType = {
  user: User | null;
  waitingCount: number;
  timezone: string;
  projects: Project[];
  activeProjectId: string | null;
  setActiveProjectId: (id: string | null) => void;
};

export const AppContext = createContext<AppContextType>({
  user: null,
  waitingCount: 0,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  projects: [],
  activeProjectId: null,
  setActiveProjectId: () => {},
});

export function useApp() {
  return useContext(AppContext);
}
