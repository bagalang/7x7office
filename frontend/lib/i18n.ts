// lib/i18n.ts — речници за превод. Четири езика: bg (дефолт), en, de, ru.
// Без външна зависимост: плоски ключове + `{var}` заместване.

import { bg } from "./i18n-bg";
import { en } from "./i18n-en";
import { de } from "./i18n-de";
import { ru } from "./i18n-ru";

export type Lang = "bg" | "en" | "de" | "ru";

export const DEFAULT_LANG: Lang = "bg";
export const LANGS: Lang[] = ["bg", "en", "de", "ru"];

// Показвано име на езика в превключвателя (на собствения му език).
export const LANG_LABEL: Record<Lang, string> = {
  bg: "Български",
  en: "English",
  de: "Deutsch",
  ru: "Русский",
};

// BCP-47 кодът за `lang` атрибута и за проверката на правописа.
// Тукашните 4 езика имат речници във всеки браузър — затова spellCheck
// работи без добавки.
export const HTML_LANG: Record<Lang, string> = {
  bg: "bg-BG",
  en: "en-US",
  de: "de-DE",
  ru: "ru-RU",
};

type Dict = Record<string, string>;

export const dictionaries: Record<Lang, Dict> = { bg, en, de, ru };

export type TVars = Record<string, string | number>;

export function isLang(v: string | null | undefined): v is Lang {
  return v === "bg" || v === "en" || v === "de" || v === "ru";
}

// translate("bg", "files.empty.query", { query: "отчет" })
//   → 'Няма резултати за „отчет“.'
// Липсващ ключ пада към български, после към самия ключ (видим при разработка).
export function translate(lang: Lang, key: string, vars?: TVars): string {
  const d = dictionaries[lang] ?? bg;
  let s = d[key] ?? bg[key] ?? key;
  if (vars) {
    for (const k of Object.keys(vars)) {
      s = s.split(`{${k}}`).join(String(vars[k]));
    }
  }
  return s;
}
