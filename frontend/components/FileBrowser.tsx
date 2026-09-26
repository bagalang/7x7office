"use client";

import { FormEvent, useEffect, useState } from "react";
import { AppShell } from "./AppShell";
import { Dialog } from "./Dialog";
import { useI18n } from "./I18nProvider";
import { useWorkspace, canWrite, canShare } from "./WorkspaceProvider";
import { useNodeEvents } from "./RealtimeProvider";
import { FilePreview, VersionsDialog } from "./FilePreview";
import { ShareDialog } from "./ShareDialog";
import {
  IconChevronRight,
  IconDownload,
  IconFile,
  IconFileText,
  IconSlides,
  IconFolder,
  IconGridView,
  IconImage,
  IconListView,
  IconPencil,
  IconPlus,
  IconSearch,
  IconShare,
  IconTrash,
  IconUpload,
} from "./icons";
import {
  ApiError,
  FsList,
  FsNode,
  api,
  authedFetchWs,
  downloadFile,
  putFile,
  qpath,
} from "../lib/api";
import { readStorage, writeStorage } from "../lib/storage";
import { isOfficeName, openOffice } from "../lib/office";
import { blankOffice } from "../lib/blanks";

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

export function formatDate(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parentOf(path: string): string {
  if (path === "/") return "/";
  const i = path.lastIndexOf("/");
  if (i <= 0) return "/";
  return path.slice(0, i);
}

const FILE_KINDS = ["txt", "md", "csv", "docx", "odt", "xlsx", "ods", "pptx", "odp"] as const;
type FileKind = (typeof FILE_KINDS)[number];

function withKindExt(name: string, kind: FileKind): string {
  const trimmed = name.trim().replace(/[\\/]/g, "");
  const lower = trimmed.toLowerCase();
  let stem = trimmed;
  for (const ext of FILE_KINDS) {
    if (lower.endsWith(`.${ext}`)) {
      stem = trimmed.slice(0, -(ext.length + 1));
      break;
    }
  }
  const base = stem.trim() || "file";
  return `${base}.${kind}`;
}

function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let n = 2;
  let next = `${stem} (${n})${ext}`;
  while (taken.has(next)) {
    n += 1;
    next = `${stem} (${n})${ext}`;
  }
  return next;
}

function joinPath(dir: string, name: string): string {
  const clean = name.trim().replace(/^\/+|\/+$/g, "");
  if (!clean || clean.includes("/") || clean === "." || clean === "..") return "";
  if (dir === "/") return `/${clean}`;
  return `${dir}/${clean}`;
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i;
const TEXT_EXT = /\.(txt|md|markdown|csv|json|ya?ml|xml|log|baga|ts|tsx|js|css|html)$/i;
const SLIDE_EXT = /\.(pptx|ppsx|ppt|odp)$/i;

function FileIcon({ node }: { node: FsNode }) {
  if (node.is_dir) return <IconFolder />;
  if (IMAGE_EXT.test(node.name)) return <IconImage />;
  if (SLIDE_EXT.test(node.name)) return <IconSlides />;
  if (TEXT_EXT.test(node.name)) return <IconFileText />;
  return <IconFile />;
}

type View = "list" | "grid";
type SortKey = "name" | "size" | "date";

export function FileBrowser() {
  const { t, lang } = useI18n();
  const { wsId, active } = useWorkspace();
  const writable = canWrite(active);
  const shareable = canShare(active);
  const [path, setPath] = useState("/");
  const [items, setItems] = useState<FsNode[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [renamePath, setRenamePath] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [open, setOpen] = useState<FsNode | null>(null);
  const [view, setView] = useState<View>("list");
  const [sort, setSort] = useState<SortKey>("name");
  const [query, setQuery] = useState("");
  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [folder, setFolder] = useState("");
  const [fileOpen, setFileOpen] = useState(false);
  const [fileKind, setFileKind] = useState<FileKind>("txt");
  const [fileName, setFileName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<FsNode | null>(null);
  const [versionsFor, setVersionsFor] = useState<FsNode | null>(null);
  const [shareFor, setShareFor] = useState<FsNode | null>(null);

  useEffect(() => {
    const saved = readStorage("secp.view");
    if (saved === "grid" || saved === "list") setView(saved);
  }, []);

  // Смяна на пространството = друг корен: затваряме прегледа и се връщаме в
  // "/", за да не искаме път, който в новото пространство не съществува.
  useEffect(() => {
    setPath("/");
    setOpen(null);
    setQuery("");
  }, [wsId]);

  function pickView(v: View) {
    setView(v);
    writeStorage("secp.view", v);
  }

  useEffect(() => {
    let cancel = false;
    (async () => {
      setBusy(true);
      setError("");
      try {
        const list = await api.get<FsList>(`/v1/fs/list?path=${qpath(path)}`);
        if (cancel) return;
        setItems(list.items ?? []);
      } catch (err) {
        if (!cancel) setError(messageOf(err, t("common.error")));
      } finally {
        if (!cancel) setBusy(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [path, reload, t, wsId]);

  // Realtime (Фаза 3): чуждо действие по възел в това пространство
  // презарежда списъка. Без това двама души в една папка виждат различно
  // съдържание, докато някой не натисне F5 — точно проблемът, който каналът
  // съществува да реши. Собствените действия също идват, но те вече са
  // презаредили през `run()`; вторият fetch е евтин и не мига (busy не се
  // вдига, защото `reload` не пипа `busy`).
  useNodeEvents(() => setReload((n) => n + 1));

  const filtered = items.filter((n) =>
    query ? n.name.toLowerCase().includes(query.toLowerCase()) : true
  );

  const sorted = filtered.slice().sort((a, b) => {
    if (a.is_dir !== b.is_dir) return b.is_dir - a.is_dir;
    if (sort === "size") return b.size - a.size;
    if (sort === "date") return (b.updated_at ?? "").localeCompare(a.updated_at ?? "");
    return a.name.localeCompare(b.name, lang);
  });

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
      setReload((n) => n + 1);
    } catch (err) {
      setError(messageOf(err, t("common.error")));
      setBusy(false);
    }
  }

  async function onMkdir(e: FormEvent) {
    e.preventDefault();
    const dest = joinPath(path, folder);
    if (!dest) {
      setError(t("files.err_bad_folder"));
      return;
    }
    setMkdirOpen(false);
    setFolder("");
    await run(async () => {
      await api.post(`/v1/fs/mkdir?path=${qpath(dest)}`);
    });
  }

  async function onCreateFile(e: FormEvent) {
    e.preventDefault();
    const named = withKindExt(fileName || t(`files.name_${fileKind}`), fileKind);
    const taken = new Set(items.map((item) => item.name));
    const dest = joinPath(path, uniqueName(named, taken));
    if (!dest) {
      setError(t("files.err_bad_name"));
      return;
    }
    setFileOpen(false);
    const bytes = fileKind === "txt" || fileKind === "md" || fileKind === "csv" ? new Uint8Array([10]) : blankOffice(fileKind);
    await run(async () => {
      await putFile(dest, new Blob([bytes.slice()]));
    });
  }

  async function onUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    const batch = Array.from(files);
    await run(async () => {
      for (const file of batch) {
        if (file.size < 1) throw new ApiError(400, t("files.err_empty_file", { name: file.name }));
        const dest = joinPath(path, file.name);
        if (!dest) throw new ApiError(400, t("files.err_bad_file", { name: file.name }));
        await putFile(dest, file);
      }
    });
  }

  async function onRename(e: FormEvent) {
    e.preventDefault();
    const dest = joinPath(parentOf(renamePath), renameValue);
    if (!dest) {
      setError(t("files.err_bad_name"));
      return;
    }
    const from = renamePath;
    setRenamePath("");
    await run(async () => {
      await api.post(`/v1/fs/move?from=${qpath(from)}&to=${qpath(dest)}`);
      if (open && open.path === from) setOpen(null);
    });
  }

  function activate(node: FsNode) {
    if (node.is_dir) {
      setOpen(null);
      setPath(node.path);
      return;
    }
    // Офис файлът се отваря в нов таб. Списъкът остава, без локален преглед.
    if (isOfficeName(node.name)) {
      setOpen(null);
      openOffice(node.path);
      return;
    }
    setOpen(node);
  }

  function startRename(node: FsNode) {
    setRenamePath(node.path);
    setRenameValue(node.name);
  }

  const searchBox = (
    <div className="topbar-search">
      <IconSearch width={16} height={16} />
      <input
        className="input"
        placeholder={t("files.search_placeholder")}
        aria-label={t("files.search_aria")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
    </div>
  );

  const rowActions = (node: FsNode) => (
    <span className="row-actions" onClick={(e) => e.stopPropagation()}>
      {node.is_dir === 0 ? (
        <button
          type="button"
          className="icon-btn"
          title={t("files.download")}
          onClick={() => void downloadFile(node).catch((err) => setError(messageOf(err, t("common.error"))))}
        >
          <IconDownload />
        </button>
      ) : null}
      {writable ? (
        <>
          <button type="button" className="icon-btn" title={t("files.rename")} onClick={() => startRename(node)}>
            <IconPencil />
          </button>
          <button type="button" className="icon-btn danger" title={t("files.delete")} onClick={() => setDeleteTarget(node)}>
            <IconTrash />
          </button>
        </>
      ) : null}
      {shareable ? (
        <button
          type="button"
          className="icon-btn"
          title={t("ws.share")}
          onClick={() => setShareFor(node)}
        >
          <IconShare />
        </button>
      ) : null}
    </span>
  );

  return (
    <AppShell search={searchBox}>
      <main className="content-main">
        <div className="crumbs">
          {crumbs(path, t("files.title")).map((c, i, all) => (
            <span key={c.path} style={{ display: "inline-flex", alignItems: "center" }}>
              {i > 0 ? (
                <span className="sep">
                  <IconChevronRight width={14} height={14} />
                </span>
              ) : null}
              <button
                type="button"
                className={`crumb${i === all.length - 1 ? " current" : ""}`}
                onClick={() => {
                  setOpen(null);
                  setPath(c.path);
                }}
              >
                {c.name}
              </button>
            </span>
          ))}
        </div>

        <div className="toolbar">
          {writable ? (
            <label className="btn">
              <IconUpload width={16} height={16} />
              {t("files.upload")}
              <input
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  void onUpload(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
          ) : (
            <span className="badge muted">{t("ws.readonly")}</span>
          )}
          {writable ? (
            <button type="button" className="btn ghost" onClick={() => setMkdirOpen(true)}>
              <IconPlus width={16} height={16} />
              {t("files.new_folder")}
            </button>
          ) : null}
          {writable ? (
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                setFileKind("docx");
                setFileName(t("files.name_docx"));
                setFileOpen(true);
              }}
            >
              <IconFile width={16} height={16} />
              {t("files.new_file")}
            </button>
          ) : null}
          <span className="grow" />
          <select
            className="select"
            aria-label={t("files.sort_aria")}
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
          >
            <option value="name">{t("files.sort_name")}</option>
            <option value="size">{t("files.sort_size")}</option>
            <option value="date">{t("files.sort_date")}</option>
          </select>
          <span className="toggle" role="group" aria-label={t("files.view_aria")}>
            <button
              type="button"
              className={view === "list" ? "active" : ""}
              title={t("files.view_list")}
              onClick={() => pickView("list")}
            >
              <IconListView />
            </button>
            <button
              type="button"
              className={view === "grid" ? "active" : ""}
              title={t("files.view_grid")}
              onClick={() => pickView("grid")}
            >
              <IconGridView />
            </button>
          </span>
        </div>

        {error ? <p className="err">{error}</p> : null}

        {view === "list" ? (
          <table className="table">
            <thead>
              <tr>
                <th>{t("files.col_name")}</th>
                <th style={{ width: 110 }}>{t("files.col_size")}</th>
                <th style={{ width: 170 }}>{t("files.col_modified")}</th>
                <th style={{ width: 110 }} />
              </tr>
            </thead>
            <tbody>
              {path !== "/" ? (
                <tr
                  onClick={() => {
                    setOpen(null);
                    setPath(parentOf(path));
                  }}
                >
                  <td>
                    <span className="cell-name">
                      <span className="cell-icon">
                        <IconFolder />
                      </span>
                      <span className="label">..</span>
                    </span>
                  </td>
                  <td className="muted">—</td>
                  <td className="muted">—</td>
                  <td />
                </tr>
              ) : null}
              {sorted.map((node) => (
                <tr
                  key={node.path}
                  className={open?.path === node.path ? "selected" : ""}
                  onClick={() => activate(node)}
                >
                  <td>
                    {renamePath === node.path ? (
                      <form className="rename-form" onSubmit={onRename} onClick={(e) => e.stopPropagation()}>
                        <input
                          className="input"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          aria-label={t("files.new_name_aria")}
                          autoFocus
                        />
                        <button type="submit" className="btn" style={{ padding: "5px 10px" }}>
                          {t("common.save")}
                        </button>
                        <button type="button" className="btn ghost" style={{ padding: "5px 10px" }} onClick={() => setRenamePath("")}>
                          {t("common.cancel")}
                        </button>
                      </form>
                    ) : (
                      <span className="cell-name">
                        <span className="cell-icon">
                          {node.has_thumb === 1 ? <Thumb path={node.path} /> : <FileIcon node={node} />}
                        </span>
                        <span className="label">{node.name}</span>
                      </span>
                    )}
                  </td>
                  <td className="muted">{node.is_dir ? "—" : formatBytes(node.size)}</td>
                  <td className="muted">{formatDate(node.updated_at)}</td>
                  <td>{rowActions(node)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="grid-cards">
            {sorted.map((node) => (
              <div
                key={node.path}
                className={`grid-card${open?.path === node.path ? " selected" : ""}`}
                onClick={() => activate(node)}
              >
                <span className="grid-thumb">
                  {node.has_thumb === 1 ? (
                    <Thumb path={node.path} />
                  ) : (
                    <FileIcon node={node} />
                  )}
                </span>
                <span className="grid-meta">
                  <span className="label">{node.name}</span>
                  <span className="sub">{node.is_dir ? t("files.folder") : formatBytes(node.size)}</span>
                </span>
                {rowActions(node)}
              </div>
            ))}
          </div>
        )}

        {sorted.length === 0 && !busy ? (
          <div className="empty-state">
            {query ? t("files.empty_query", { query }) : t("files.empty_folder")}
          </div>
        ) : null}
        {busy ? <p className="muted">{t("common.loading")}</p> : null}
      </main>

      {open ? (
        <FilePreview
          node={open}
          onClose={() => setOpen(null)}
          onRename={() => startRename(open)}
          onDelete={() => setDeleteTarget(open)}
          onShowVersions={() => setVersionsFor(open)}
          onShare={() => setShareFor(open)}
          onError={setError}
        />
      ) : null}

      {versionsFor ? (
        <VersionsDialog
          node={versionsFor}
          onClose={() => setVersionsFor(null)}
          onRestored={() => {
            setVersionsFor(null);
            setOpen(null);
            setReload((n) => n + 1);
          }}
        />
      ) : null}

      {fileOpen ? (
        <Dialog title={t("files.new_file_title")} onClose={() => setFileOpen(false)}>
          <form onSubmit={onCreateFile}>
            <div className="field">
              <label htmlFor="new-file-type">{t("files.new_file_type")}</label>
              <select
                id="new-file-type"
                className="input"
                value={fileKind}
                onChange={(e) => {
                  const next = e.target.value as FileKind;
                  setFileKind(next);
                  setFileName(t(`files.name_${next}`));
                }}
              >
                {FILE_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {t(`files.kind_${kind}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="new-file-name">{t("common.name")}</label>
              <input
                id="new-file-name"
                className="input"
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="dialog-actions">
              <button type="button" className="btn ghost" onClick={() => setFileOpen(false)}>
                {t("common.cancel")}
              </button>
              <button type="submit" className="btn" disabled={busy}>
                {t("common.create")}
              </button>
            </div>
          </form>
        </Dialog>
      ) : null}

      {mkdirOpen ? (
        <Dialog title={t("files.mkdir_title")} onClose={() => setMkdirOpen(false)}>
          <form onSubmit={onMkdir}>
            <div className="field">
              <label htmlFor="mkdir-name">{t("common.name")}</label>
              <input
                id="mkdir-name"
                className="input"
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
                autoFocus
              />
            </div>
            <div className="dialog-actions">
              <button type="button" className="btn ghost" onClick={() => setMkdirOpen(false)}>
                {t("common.cancel")}
              </button>
              <button type="submit" className="btn" disabled={busy}>
                {t("common.create")}
              </button>
            </div>
          </form>
        </Dialog>
      ) : null}

      {deleteTarget ? (
        <Dialog title={t("files.delete_title")} onClose={() => setDeleteTarget(null)}>
          <p style={{ margin: 0 }}>{t("files.delete_confirm", { name: deleteTarget.name })}</p>
          <div className="dialog-actions">
            <button type="button" className="btn ghost" onClick={() => setDeleteTarget(null)}>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn danger-ghost"
              onClick={() => {
                const target = deleteTarget;
                setDeleteTarget(null);
                if (open?.path === target.path) setOpen(null);
                void run(async () => {
                  await api.del(`/v1/fs/file?path=${qpath(target.path)}`);
                });
              }}
            >
              {t("common.delete")}
            </button>
          </div>
        </Dialog>
      ) : null}

      {shareFor ? (
        <ShareDialog
          workspaceId={wsId}
          path={shareFor.path}
          isDir={shareFor.is_dir}
          onClose={() => setShareFor(null)}
        />
      ) : null}
    </AppShell>
  );
}

function crumbs(path: string, rootLabel: string): { name: string; path: string }[] {
  const out = [{ name: rootLabel, path: "/" }];
  if (path === "/") return out;
  let cur = "";
  for (const part of path.split("/").filter(Boolean)) {
    cur += `/${part}`;
    out.push({ name: part, path: cur });
  }
  return out;
}

export function messageOf(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

function Thumb({ path }: { path: string }) {
  const { wsId } = useWorkspace();
  const [url, setUrl] = useState("");
  useEffect(() => {
    let dead = false;
    let obj = "";
    (async () => {
      const res = await authedFetchWs(`/v1/fs/thumb?path=${qpath(path)}`);
      if (!res.ok || dead) return;
      obj = URL.createObjectURL(await res.blob());
      if (dead) {
        URL.revokeObjectURL(obj);
        return;
      }
      setUrl(obj);
    })();
    return () => {
      dead = true;
      if (obj) URL.revokeObjectURL(obj);
    };
  }, [path, wsId]);
  if (!url) return <IconFile width={18} height={18} />;
  return <img src={url} alt="" />;
}
