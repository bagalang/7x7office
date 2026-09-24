"use client";

// PreferencesButton — тема (светла/тъмна/системна) и език (bg/en/de/ru).
// Едно меню в горния десен ъгъл, за да не се разпилява UI-ът.

import { useEffect, useRef, useState } from "react";
import { useI18n } from "./I18nProvider";
import { useTheme } from "./ThemeProvider";
import { HTML_LANG, LANG_LABEL, Lang, LANGS } from "../lib/i18n";
import { ThemeChoice } from "../lib/theme";
import { IconCheck, IconGlobe, IconMoon, IconSun, IconSystem } from "./icons";

function ThemeIcon({ t }: { t: ThemeChoice }) {
  if (t === "light") return <IconSun width={16} height={16} />;
  if (t === "dark") return <IconMoon width={16} height={16} />;
  return <IconSystem width={16} height={16} />;
}

export function PreferencesButton() {
  const { t, lang, setLang } = useI18n();
  const { choice, setChoice } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  const themes: ThemeChoice[] = ["light", "dark", "system"];

  return (
    <div className="menu-wrap" ref={ref}>
      <button
        type="button"
        className="icon-btn"
        aria-label={t("theme.aria")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <IconGlobe />
      </button>

      {open ? (
        <div className="menu prefs" role="menu">
          <div className="menu-sect">{t("theme.aria")}</div>
          {themes.map((th) => (
            <button
              key={th}
              type="button"
              role="menuitemradio"
              aria-checked={choice === th}
              className={`menu-item${choice === th ? " on" : ""}`}
              onClick={() => setChoice(th)}
            >
              <ThemeIcon t={th} />
              {t(`theme.${th}`)}
              {choice === th ? <IconCheck width={15} height={15} /> : null}
            </button>
          ))}

          <div className="menu-sep" />
          <div className="menu-sect">{t("lang.aria")}</div>
          {LANGS.map((l: Lang) => (
            <button
              key={l}
              type="button"
              role="menuitemradio"
              aria-checked={lang === l}
              // spellCheck тук не е нужен (това са имена), но lang е хубаво.
              lang={HTML_LANG[l]}
              className={`menu-item${lang === l ? " on" : ""}`}
              onClick={() => setLang(l)}
            >
              <span className="lang-code">{l.toUpperCase()}</span>
              {LANG_LABEL[l]}
              {lang === l ? <IconCheck width={15} height={15} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
