"use client";

// ThemeProvider — светла / тъмна / системна тема. Изборът се пази в
// localStorage; реалният атрибут `data-theme` на <html> се слага още преди
// първото рисуване от inline скрипт в layout.tsx (без блясък от бяло).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  ReactNode,
  useSyncExternalStore,
} from "react";
import {
  DEFAULT_THEME,
  ThemeChoice,
  applyTheme,
  isThemeChoice,
  resolveTheme,
} from "../lib/theme";
import { readStorage, subscribeStorage, writeStorage } from "../lib/storage";

const THEME_KEY = "secp.theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

interface ThemeContextValue {
  choice: ThemeChoice;
  setChoice: (t: ThemeChoice) => void;
  // Реалната тема в момента (system може да е light или dark).
  resolved: "light" | "dark";
}

const ThemeContext = createContext<ThemeContextValue>({
  choice: DEFAULT_THEME,
  setChoice: () => {},
  resolved: "light",
});

function subscribePrefersDark(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const mq = window.matchMedia(DARK_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const choice = useSyncExternalStore(
    subscribeStorage,
    () => {
      const v = readStorage(THEME_KEY);
      return isThemeChoice(v) ? v : DEFAULT_THEME;
    },
    () => DEFAULT_THEME,
  );

  const prefersDark = useSyncExternalStore(
    subscribePrefersDark,
    () => window.matchMedia(DARK_QUERY).matches,
    () => false,
  );

  const resolved = resolveTheme(choice, prefersDark);

  // Държи атрибута в синхрон при смяна (първоначалният го слага inline скриптът).
  useEffect(() => {
    applyTheme(resolved);
  }, [resolved]);

  const setChoice = useCallback((t: ThemeChoice) => writeStorage(THEME_KEY, t), []);

  const value = useMemo<ThemeContextValue>(
    () => ({ choice, setChoice, resolved }),
    [choice, setChoice, resolved],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
