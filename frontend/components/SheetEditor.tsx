"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, DocContent, saveDoc } from "../lib/api";
import { useI18n } from "./I18nProvider";
import { IconClose, IconPlus } from "./icons";

type SaveState = "saved" | "dirty" | "saving";

const MIN_ROWS = 12;
const MIN_COLS = 6;

function colName(i: number): string {
  let s = "";
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

function parseTsv(text: string): string[][] {
  const rows = text
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => l.split("\t"));
  while (rows.length < MIN_ROWS) rows.push([]);
  return rows.map((r) => {
    const out = r.slice();
    while (out.length < MIN_COLS) out.push("");
    return out;
  });
}

function toTsv(rows: string[][]): string {
  // trim trailing empty rows/cells so the file stays compact
  let lastRow = rows.length - 1;
  while (lastRow >= 0 && rows[lastRow].every((c) => c.trim() === "")) lastRow--;
  return (
    rows
      .slice(0, lastRow + 1)
      .map((r) => {
        let lastCol = r.length - 1;
        while (lastCol >= 0 && r[lastCol].trim() === "") lastCol--;
        return r.slice(0, lastCol + 1).join("\t");
      })
      .join("\n") + "\n"
  );
}

export function SheetEditor({ doc }: { doc: DocContent }) {
  const { t } = useI18n();
  const router = useRouter();
  const [rows, setRows] = useState<string[][]>(() => parseTsv(doc.text));
  const [state, setState] = useState<SaveState>("saved");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const etagRef = useRef<string | undefined>(doc.etag);
  const stateRef = useRef<SaveState>("saved");

  // Държим ref в синхрон със state, но в effect (не по време на render).
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    setRows(parseTsv(doc.text));
    etagRef.current = doc.etag;
    setConflict(false);
    setState("saved");
  }, [doc.path]); // eslint-disable-line react-hooks/exhaustive-deps

  function setCell(r: number, c: number, value: string) {
    setRows((prev) => {
      const next = prev.map((row) => row.slice());
      next[r][c] = value;
      return next;
    });
    setState("dirty");
  }

  function addRow() {
    setRows((prev) => [...prev, Array(prev[0]?.length ?? MIN_COLS).fill("")]);
    setState("dirty");
  }

  function addCol() {
    setRows((prev) => prev.map((row) => [...row, ""]));
    setState("dirty");
  }

  async function save() {
    if (stateRef.current === "saving") return;
    setState("saving");
    setError("");
    try {
      const node = await saveDoc(doc.path, toTsv(rows), etagRef.current);
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
  }); // rows/state менят се — без deps масив, презаписваме слушателя

  const status =
    state === "saving" ? t("editor.saving") : state === "dirty" ? t("editor.dirty") : t("editor.saved");
  const cols = rows[0]?.length ?? MIN_COLS;

  return (
    <div className="editor-shell">
      <header className="editor-topbar">
        <button type="button" className="icon-btn" title={t("editor.back")} onClick={() => router.push("/")}>
          <IconClose />
        </button>
        <span className="editor-name">{doc.name}</span>
        <span className={`editor-status${state === "dirty" ? " dirty" : ""}`}>{status}</span>
        <span className="grow" />
        <button type="button" className="btn ghost" onClick={addRow}>
          <IconPlus width={14} height={14} /> {t("editor.add_row")}
        </button>
        <button type="button" className="btn ghost" onClick={addCol}>
          <IconPlus width={14} height={14} /> {t("editor.add_col")}
        </button>
        <button type="button" className="btn" onClick={() => void save()} disabled={state === "saving"}>
          {t("editor.save")}
        </button>
      </header>

      {error ? (
        <p className="err" style={{ margin: "8px 24px" }}>
          {error}
          {conflict ? t("editor.conflict_hint") : ""}
        </p>
      ) : null}

      <div className="editor-scroll sheet-scroll">
        <table className="sheet">
          <thead>
            <tr>
              <th className="sheet-corner" />
              {Array.from({ length: cols }, (_, c) => (
                <th key={c}>{colName(c)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                <th>{r + 1}</th>
                {row.map((cell, c) => (
                  <td key={c}>
                    <input
                      value={cell}
                      aria-label={`${colName(c)}${r + 1}`}
                      onChange={(e) => setCell(r, c, e.target.value)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
