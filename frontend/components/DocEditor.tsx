"use client";

// DocEditor — markdown редактор (contentEditable). `spellCheck` е включен:
// браузърът проверява според `lang` на <html>, който I18nProvider държи в
// синхрон с избрания език (bg/en/de/ru имат речници във всеки браузър).

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, DocContent, saveDoc } from "../lib/api";
import { htmlToMd, mdToHtml } from "../lib/markdown";
import { useI18n } from "./I18nProvider";
import { IconClose } from "./icons";

type SaveState = "saved" | "dirty" | "saving";

function ToolButton({
  label,
  title,
  onAction,
}: {
  label: React.ReactNode;
  title: string;
  onAction: () => void;
}) {
  return (
    <button
      type="button"
      className="tool-btn"
      title={title}
      onMouseDown={(e) => {
        e.preventDefault(); // keep selection in the editable area
        onAction();
      }}
    >
      {label}
    </button>
  );
}

export function DocEditor({ doc }: { doc: DocContent }) {
  const { t, lang } = useI18n();
  const router = useRouter();
  const areaRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<SaveState>("saved");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const etagRef = useRef<string | undefined>(doc.etag);
  const stateRef = useRef<SaveState>("saved");

  // Държим ref в синхрон със state, но в effect (не по време на render) —
  // иначе React ругае и може да пропусне обновяване.
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (areaRef.current) {
      areaRef.current.innerHTML = mdToHtml(doc.text);
    }
    etagRef.current = doc.etag;
    setConflict(false);
    setState("saved");
    // run once per document
  }, [doc.path]); // eslint-disable-line react-hooks/exhaustive-deps

  function exec(command: string, value?: string) {
    document.execCommand(command, false, value);
    areaRef.current?.focus();
    setState("dirty");
  }

  async function save() {
    if (!areaRef.current || stateRef.current === "saving") return;
    setState("saving");
    setError("");
    try {
      const node = await saveDoc(doc.path, htmlToMd(areaRef.current), etagRef.current);
      if (node.etag) etagRef.current = node.etag;
      setConflict(false);
      setState("saved");
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // A conflict copy was already stored; drop our stale etag so the
        // next save writes the editor content over the file.
        etagRef.current = undefined;
        setConflict(true);
      }
      setError(err instanceof Error ? err.message : t("editor.err_save"));
      setState("dirty");
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const status =
    state === "saving" ? t("editor.saving") : state === "dirty" ? t("editor.dirty") : t("editor.saved");

  return (
    <div className="editor-shell">
      <header className="editor-topbar">
        <button type="button" className="icon-btn" title={t("editor.back")} onClick={() => router.push("/")}>
          <IconClose />
        </button>
        <span className="editor-name">{doc.name}</span>
        <span className={`editor-status${state === "dirty" ? " dirty" : ""}`}>{status}</span>
        <span className="grow" />
        <button type="button" className="btn" onClick={() => void save()} disabled={state === "saving"}>
          {t("editor.save")}
        </button>
      </header>

      <div className="editor-toolbar">
        <ToolButton label={<b>B</b>} title={t("editor.bold")} onAction={() => exec("bold")} />
        <ToolButton label={<i>I</i>} title={t("editor.italic")} onAction={() => exec("italic")} />
        <span className="tool-sep" />
        <ToolButton label="H1" title={t("editor.h1")} onAction={() => exec("formatBlock", "h1")} />
        <ToolButton label="H2" title={t("editor.h2")} onAction={() => exec("formatBlock", "h2")} />
        <ToolButton label="H3" title={t("editor.h3")} onAction={() => exec("formatBlock", "h3")} />
        <ToolButton label="¶" title={t("editor.paragraph")} onAction={() => exec("formatBlock", "p")} />
        <span className="tool-sep" />
        <ToolButton label="•" title={t("editor.bullet")} onAction={() => exec("insertUnorderedList")} />
        <ToolButton label="1." title={t("editor.numbered")} onAction={() => exec("insertOrderedList")} />
        <span className="tool-sep" />
        <ToolButton label="⌫" title={t("editor.clear_format")} onAction={() => exec("removeFormat")} />
      </div>

      {error ? (
        <p className="err" style={{ margin: "8px 24px" }}>
          {error}
          {conflict ? t("editor.conflict_hint") : ""}
        </p>
      ) : null}

      <div className="editor-scroll">
        <div
          ref={areaRef}
          className="editor-page"
          contentEditable
          suppressContentEditableWarning
          // Проверката на правописа следва езика на интерфейса (bg/en/de/ru).
          // `lang` на елемента е необходим, защото contentEditable не наследява
          // винаги <html lang> в Chrome.
          lang={lang}
          spellCheck
          onInput={() => setState("dirty")}
        />
      </div>
    </div>
  );
}
