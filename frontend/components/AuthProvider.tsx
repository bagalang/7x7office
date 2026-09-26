"use client";

import { createContext, useCallback, useContext, useSyncExternalStore, ReactNode } from "react";
import { TOKEN_KEY, TokenResponse, login as apiLogin, logout as apiLogout } from "../lib/api";
import { readStorage, subscribeStorage } from "../lib/storage";

interface AuthContextValue {
  authed: boolean;
  ready: boolean;
  login: (email: string, password: string) => Promise<TokenResponse>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  authed: false,
  ready: false,
  login: async () => ({}),
  logout: () => {},
});

function useMounted(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const ready = useMounted();
  const token = useSyncExternalStore(
    subscribeStorage,
    () => readStorage(TOKEN_KEY) ?? "",
    () => ""
  );

  const login = useCallback(async (email: string, password: string) => {
    return apiLogin(email, password);
  }, []);

  const logout = useCallback(() => {
    apiLogout();
  }, []);

  return (
    <AuthContext.Provider value={{ authed: token !== "", ready, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
