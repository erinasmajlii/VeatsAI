"use client";

import { createContext, useContext } from "react";
import type { SessionUser } from "@/lib/types";

const UserContext = createContext<SessionUser | null>(null);

/** The signed-in user (identity and role come from the server; the UI only uses them to show/hide controls). */
export function UserProvider({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  return <UserContext.Provider value={user}>{children}</UserContext.Provider>;
}

export function useUser(): SessionUser {
  const u = useContext(UserContext);
  if (!u) throw new Error("useUser must be used inside the signed-in app shell.");
  return u;
}

export const isEngineer = (u: SessionUser) => u.role === "engineer";
