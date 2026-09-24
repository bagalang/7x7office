// scripts/check-i18n.mjs — проверява, че четирите речника имат еднакви ключове.
// Хваща точно класа грешки „преведох нов ключ само в bg" (тогава в UI излиза
// суровият ключ, напр. "search.col_path").
//
// Пуска се от `npm run check:i18n` (и от lint, ако е включен в CI).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const lib = join(here, "..", "lib");

const LANGS = ["bg", "en", "de", "ru"];

// Извлича плоските ключове: `  "common.save": "...",`
function keysOf(lang) {
  const src = readFileSync(join(lib, `i18n-${lang}.ts`), "utf8");
  const keys = new Set();
  const seen = new Set();
  const re = /^\s*"([^"]+)"\s*:/gm;
  let m;
  while ((m = re.exec(src)) !== null) {
    const k = m[1];
    if (seen.has(k)) {
      console.error(`✗ i18n-${lang}: дублиран ключ "${k}"`);
      process.exitCode = 1;
    }
    seen.add(k);
    keys.add(k);
  }
  return keys;
}

const dicts = Object.fromEntries(LANGS.map((l) => [l, keysOf(l)]));
const base = dicts.bg;
let bad = 0;

for (const lang of LANGS) {
  if (lang === "bg") continue;
  const missing = [...base].filter((k) => !dicts[lang].has(k));
  const extra = [...dicts[lang]].filter((k) => !base.has(k));
  if (missing.length > 0) {
    console.error(`✗ i18n-${lang}: липсват ${missing.length} ключа: ${missing.join(", ")}`);
    bad++;
  }
  if (extra.length > 0) {
    console.error(`✗ i18n-${lang}: излишни ${extra.length} ключа (няма ги в bg): ${extra.join(", ")}`);
    bad++;
  }
}

// Място за подстановки: {var} трябва да съвпада между езиците.
function varsOf(lang) {
  const src = readFileSync(join(lib, `i18n-${lang}.ts`), "utf8");
  const out = new Map();
  const re = /^\s*"([^"]+)"\s*:\s*"((?:[^"\\]|\\.)*)"/gm;
  let m;
  while ((m = re.exec(src)) !== null) {
    const vars = [...m[2].matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort();
    if (vars.length > 0) out.set(m[1], vars.join(","));
  }
  return out;
}

const bgVars = varsOf("bg");
for (const lang of LANGS) {
  if (lang === "bg") continue;
  for (const [k, v] of varsOf(lang)) {
    if (bgVars.has(k) && bgVars.get(k) !== v) {
      console.error(`✗ i18n-${lang}: "${k}" ползва {${v}}, а bg ползва {${bgVars.get(k)}}`);
      bad++;
    }
  }
}

if (bad === 0) {
  console.log(`i18n: OK — ${LANGS.length} езика × ${base.size} ключа, еднакви.`);
} else {
  process.exitCode = 1;
}
