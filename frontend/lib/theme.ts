// lib/theme.ts — тема: избор, разрешаване, прилагане. Без React (ползва се и
// от inline скрипта в layout.tsx, който слага темата преди първото рисуване —
// иначе има „блясък" от бяло при тъмна тема).

export type ThemeChoice = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_KEY = "secp.theme";
export const THEME_CHOICES: ThemeChoice[] = ["system", "light", "dark"];
export const DEFAULT_THEME: ThemeChoice = "system";

export function isThemeChoice(v: string | null | undefined): v is ThemeChoice {
  return v === "system" || v === "light" || v === "dark";
}

// „system" следва предпочитанието на ОС; останалите са фиксирани.
export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): ResolvedTheme {
  if (choice === "system") return prefersDark ? "dark" : "light";
  return choice;
}

export function applyTheme(t: ResolvedTheme): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", t);
}

// Изпълнява се в <head> преди paint. Пази се минимален и без зависимости.
export const THEME_SCRIPT = `(function(){try{var k="secp.theme";var c=localStorage.getItem(k)||"system";if(c!=="light"&&c!=="dark"){c="system";}var d=false;try{d=window.matchMedia("(prefers-color-scheme: dark)").matches;}catch(e){}var t=(c==="system")?(d?"dark":"light"):c;document.documentElement.setAttribute("data-theme",t);}catch(e){}})();`;
