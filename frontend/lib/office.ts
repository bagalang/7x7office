// Офис файловете се отварят в Collabora. Вграденият редактор остава за
// txt/md/csv. Кликът не вика /v1/fs/preview и /v1/doc/load: те разгъват
// целия ODS/XLSX в secp и в браузъра и могат да блокират машината.

const OFFICE_EXTS = new Set([
  "doc",
  "docx",
  "odt",
  "xls",
  "xlsx",
  "ods",
  "ppt",
  "pptx",
  "ppsx",
  "odp",
]);

export function isOfficeName(name: string): boolean {
  const slash = Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\"));
  const base = slash >= 0 ? name.slice(slash + 1) : name;
  const dot = base.lastIndexOf(".");
  if (dot < 0 || dot === base.length - 1) return false;
  return OFFICE_EXTS.has(base.slice(dot + 1).toLowerCase());
}

export function officeHref(path: string): string {
  return `/office?path=${encodeURIComponent(path)}`;
}

// Ляв клик отваря редактора в нов таб. Списъкът с файлове остава.
export function openOffice(path: string): void {
  window.open(officeHref(path), "_blank", "noopener,noreferrer");
}

function attr(attrs: string, key: string): string {
  const m = new RegExp(`\\b${key}="([^"]*)"`).exec(attrs);
  if (!m) return "";
  return m[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

// urlsrc от /hosting/discovery за даденото разширение. Празен низ, ако го няма.
export function discoveryUrlsrc(xml: string, ext: string): string {
  const re = /<action\b([^>]*)\/?>/g;
  let fallback = "";
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const attrs = m[1];
    const urlsrc = attr(attrs, "urlsrc");
    if (!urlsrc) continue;
    const name = attr(attrs, "name");
    if (name !== "edit" && name !== "view") continue;
    if (!fallback) fallback = urlsrc;
    if (attr(attrs, "ext").toLowerCase() === ext) return urlsrc;
  }
  return fallback;
}

// Collabora дава urlsrc със завършващ „?“. WOPISrc се кодира, иначе
// coolwsd отхвърля адреса.
export function collaboraEditorUrl(urlsrc: string, wopiSrc: string, lang: string, canWrite: boolean): string {
  let u = urlsrc.trim();
  const encoded = encodeURIComponent(wopiSrc);
  if (u.includes("<WOPISrc>")) {
    u = u.replace("<WOPISrc>", encoded);
  } else {
    if (!u.includes("?")) u += "?";
    if (!u.endsWith("?") && !u.endsWith("&")) u += "&";
    u += "WOPISrc=" + encoded;
  }
  if (!u.endsWith("?") && !u.endsWith("&")) u += "&";
  u += "lang=" + encodeURIComponent(lang);
  if (!canWrite) u += "&permission=readonly";
  return u;
}
