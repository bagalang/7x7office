"use client";

// I18nProvider — език на интерфейса. Дефолт: български; ако браузърът иска
// един от нашите езици и няма запазен избор — него. Пази се в localStorage,
// четене през useSyncExternalStore (хидратационно-безопасно).

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
  DEFAULT_LANG,
  HTML_LANG,
  Lang,
  LANGS,
  TVars,
  isLang,
  translate,
} from "../lib/i18n";
import { readStorage, subscribeStorage, writeStorage } from "../lib/storage";

const LANG_KEY = "secp.lang";

interface I18nContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, vars?: TVars) => string;
}

const I18nContext = createContext<I18nContextValue>({
  lang: DEFAULT_LANG,
  setLang: () => {},
  t: (key) => key,
});

// Първо: избраният от потребителя език. Ако няма — от браузъра.
function clientLang(): Lang {
  const stored = readStorage(LANG_KEY);
  if (isLang(stored)) return stored;
  const nav = (typeof navigator === "undefined" ? "" : navigator.language).toLowerCase();
  for (const l of LANGS) {
    if (nav === l || nav.startsWith(`${l}-`)) return l;
  }
  return DEFAULT_LANG;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const lang = useSyncExternalStore(
    subscribeStorage,
    clientLang,
    () => DEFAULT_LANG,
  );

  const setLang = useCallback((l: Lang) => writeStorage(LANG_KEY, l), []);

  // <html lang> в синхрон — нужно за проверката на правописа и екранните четци.
  useEffect(() => {
    document.documentElement.lang = HTML_LANG[lang] ?? "bg-BG";
  }, [lang]);

  const value = useMemo<I18nContextValue>(
    () => ({
      lang,
      setLang,
      t: (key: string, vars?: TVars) => translate(lang, key, vars),
    }),
    [lang, setLang],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
