"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, type ApiUser } from "@/lib/client";

interface ToastState {
  message: string;
  isError: boolean;
}

interface AppContextValue {
  user: ApiUser | null;
  refreshUser: () => Promise<void>;
  toast: (message: string, isError?: boolean) => void;
  rechargeOpen: boolean;
  setRechargeOpen: (open: boolean) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<ApiUser | null>(null);
  const [toastState, setToastState] = useState<ToastState | null>(null);
  const [rechargeOpen, setRechargeOpen] = useState(false);

  const refreshUser = useCallback(async () => {
    try {
      setUser(await api<ApiUser>("/api/me"));
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  const toast = useCallback((message: string, isError = false) => {
    setToastState({ message, isError });
    setTimeout(() => setToastState(null), 2800);
  }, []);

  return (
    <AppContext.Provider value={{ user, refreshUser, toast, rechargeOpen, setRechargeOpen }}>
      {children}
      {toastState && (
        <div
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 border text-sm px-6 py-3 rounded-3xl flex items-center gap-x-3 shadow-2xl z-[200] ${
            toastState.isError ? "bg-[#3f1f1f] border-red-500" : "bg-[#111] border-[#333]"
          }`}
        >
          <i className={`fas ${toastState.isError ? "fa-circle-exclamation text-red-400" : "fa-check-circle text-emerald-400"}`} />
          <span>{toastState.message}</span>
        </div>
      )}
    </AppContext.Provider>
  );
}
