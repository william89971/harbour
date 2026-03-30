"use client";

import { createContext, useContext } from "react";

export type User = { userId: string; email: string; displayName: string };

export type AppContextType = {
  user: User | null;
  waitingCount: number;
};

export const AppContext = createContext<AppContextType>({
  user: null,
  waitingCount: 0,
});

export function useApp() {
  return useContext(AppContext);
}
