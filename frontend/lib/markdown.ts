// Markdown ↔ HTML for the doc editor. Honest subset matching officebaga:
// headings 1-3, paragraphs, ul/ol, **bold**, *italic*, ***both***.

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inlineToHtml(s: string): string {
  let out = esc(s);
  out = out.replace(/\*\*\*([^*]+)\*\*\*/g, "<b><i>$1</i></b>");
  out = out.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  out = out.replace(/\*([^*]+)\*/g, "<i>$1</i>");
  return out;
}

export function mdToHtml(md: string): string {
  const lines = md.split("\n");
  const html: string[] = [];
  let para: string[] = [];
  let list: { tag: "ul" | "ol"; items: string[] } | null = null;

  function flushPara() {
    if (para.length > 0) {
      html.push(`<p>${inlineToHtml(para.join(" "))}</p>`);
      para = [];
    }
  }
  function flushList() {
    if (list) {
      html.push(`<${list.tag}>${list.items.map((it) => `<li>${inlineToHtml(it)}</li>`).join("")}</${list.tag}>`);
      list = null;
    }
  }

  for (const raw of lines) {
    const line = raw.trimEnd();
    const t = line.trim();
    if (t === "") {
      flushPara();
      flushList();
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(t);
    if (h) {
      flushPara();
      flushList();
      const lvl = Math.min(3, h[1].length);
      html.push(`<h${lvl}>${inlineToHtml(h[2])}</h${lvl}>`);
      continue;
    }
    const ul = /^[-*+•]\s+(.*)$/.exec(t);
    if (ul) {
      flushPara();
      if (!list || list.tag !== "ul") {
        flushList();
        list = { tag: "ul", items: [] };
      }
      list.items.push(ul[1]);
      continue;
    }
    const ol = /^\d+[.)]\s+(.*)$/.exec(t);
    if (ol) {
      flushPara();
      if (!list || list.tag !== "ol") {
        flushList();
        list = { tag: "ol", items: [] };
      }
      list.items.push(ol[1]);
      continue;
    }
    flushList();
    para.push(t);
  }
  flushPara();
  flushList();
  return html.join("");
}

function inlineToMd(node: Node): string {
  let out = "";
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      out += child.textContent ?? "";
      return;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return;
    const el = child as HTMLElement;
    const tag = el.tagName.toLowerCase();
    const inner = inlineToMd(el);
    if (inner === "") return;
    if (tag === "b" || tag === "strong") {
      // <b><i>…</i></b> → ***…***
      const onlyItalic =
        el.childNodes.length === 1 &&
        el.firstChild!.nodeType === Node.ELEMENT_NODE &&
        ["i", "em"].includes((el.firstChild as HTMLElement).tagName.toLowerCase());
      out += onlyItalic ? `***${inlineToMd(el.firstChild as HTMLElement)}***` : `**${inner}**`;
      return;
    }
    if (tag === "i" || tag === "em") {
      out += `*${inner}*`;
      return;
    }
    if (tag === "br") {
      out += "\n";
      return;
    }
    out += inner;
  });
  return out;
}

export function htmlToMd(root: HTMLElement): string {
  const blocks: string[] = [];

  function pushBlock(s: string) {
    const t = s.trim();
    if (t !== "") blocks.push(t);
  }

  root.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      pushBlock(node.textContent ?? "");
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    const h = /^h([1-6])$/.exec(tag);
    if (h) {
      pushBlock(`${"#".repeat(Math.min(6, Number(h[1])))} ${inlineToMd(el)}`);
      return;
    }
    if (tag === "ul" || tag === "ol") {
      let n = 0;
      el.childNodes.forEach((li) => {
        if (li.nodeType !== Node.ELEMENT_NODE) return;
        if ((li as HTMLElement).tagName.toLowerCase() !== "li") return;
        n += 1;
        const marker = tag === "ol" ? `${n}.` : "-";
        pushBlock(`${marker} ${inlineToMd(li as HTMLElement)}`);
      });
      return;
    }
    if (tag === "p" || tag === "div") {
      pushBlock(inlineToMd(el));
      return;
    }
    if (tag === "br" || tag === "hr") return;
    pushBlock(inlineToMd(el));
  });

  return blocks.join("\n\n") + "\n";
}
