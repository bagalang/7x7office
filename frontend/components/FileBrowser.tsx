"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "./AppShell";
import { Dialog } from "./Dialog";
import {
  IconChevronRight,
  IconClose,
  IconDownload,
  IconFile,
  IconFileText,
  IconFolder,
  IconGridView,
  IconHistory,
  IconImage,
  IconListView,
  IconPencil,
  IconPlus,
  IconSearch,
  IconTrash,
  IconUpload,
} from "./icons";
import {
  ApiError,
  FsList,
  FsNode,
  FsVersion,
  ZipEntry,
  api,
  authedFetch,
  downloadFile,
  downloadVersion,
  downloadZipEntry,
  listVersions,
  listZip,
  putFile,
  qpath,
  restoreVersion,
} from "../lib/api";
import { readStorage, writeStorage } from "../lib/storage";
import { mdToHtml } from "../lib/markdown";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

function formatDate(iso?: string): string {
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

function joinPath(dir: string, name: string): string {
  const clean = name.trim().replace(/^\/+|\/+$/g, "");
  if (!clean || clean.includes("/") || clean === "." || clean === "..") return "";
  if (dir === "/") return `/${clean}`;
  return `${dir}/${clean}`;
}

function crumbs(path: string): { name: string; path: string }[] {
  const out = [{ name: "Файлове", path: "/" }];
  if (path === "/") return out;
  let cur = "";
  for (const part of path.split("/").filter(Boolean)) {
    cur += `/${part}`;
    out.push({ name: part, path: cur });
  }
  return out;
}

function messageOf(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "грешка";
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i;
const TEXT_EXT = /\.(txt|md|markdown|csv|json|ya?ml|xml|log|baga|ts|tsx|js|css|html)$/i;

function FileIcon({ node }: { node: FsNode }) {
  if (node.is_dir) return <IconFolder />;
  if (IMAGE_EXT.test(node.name)) return <IconImage />;
  if (TEXT_EXT.test(node.name)) return <IconFileText />;
  return <IconFile />;
}

type View = "list" | "grid";
type SortKey = "name" | "size" | "date";

export function FileBrowser() {
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
  const [deleteTarget, setDeleteTarget] = useState<FsNode | null>(null);
  const [versionsFor, setVersionsFor] = useState<FsNode | null>(null);

  useEffect(() => {
    const saved = readStorage("secp.view");
    if (saved === "grid" || saved === "list") setView(saved);
  }, []);

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
        if (!cancel) setError(messageOf(err));
      } finally {
        if (!cancel) setBusy(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [path, reload]);

  const filtered = items.filter((n) =>
    query ? n.name.toLowerCase().includes(query.toLowerCase()) : true
  );

  const sorted = filtered.slice().sort((a, b) => {
    if (a.is_dir !== b.is_dir) return b.is_dir - a.is_dir;
    if (sort === "size") return b.size - a.size;
    if (sort === "date") return (b.updated_at ?? "").localeCompare(a.updated_at ?? "");
    return a.name.localeCompare(b.name, "bg");
  });

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
      setReload((n) => n + 1);
    } catch (err) {
      setError(messageOf(err));
      setBusy(false);
    }
  }

  async function onMkdir(e: FormEvent) {
    e.preventDefault();
    const dest = joinPath(path, folder);
    if (!dest) {
      setError("невалидно име на папка");
      return;
    }
    setMkdirOpen(false);
    setFolder("");
    await run(async () => {
      await api.post(`/v1/fs/mkdir?path=${qpath(dest)}`);
    });
  }

  async function onUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    const batch = Array.from(files);
    await run(async () => {
      for (const file of batch) {
        if (file.size < 1) throw new ApiError(400, `${file.name}: празен файл`);
        const dest = joinPath(path, file.name);
        if (!dest) throw new ApiError(400, `${file.name}: невалидно име`);
        await putFile(dest, file);
      }
    });
  }

  async function onRename(e: FormEvent) {
    e.preventDefault();
    const dest = joinPath(parentOf(renamePath), renameValue);
    if (!dest) {
      setError("невалидно име");
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
    } else {
      setOpen(node);
    }
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
        placeholder="Търсене в папката…"
        aria-label="Търсене"
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
          title="Свали"
          onClick={() => void downloadFile(node).catch((err) => setError(messageOf(err)))}
        >
          <IconDownload />
        </button>
      ) : null}
      <button type="button" className="icon-btn" title="Преименувай" onClick={() => startRename(node)}>
        <IconPencil />
      </button>
      <button type="button" className="icon-btn danger" title="Изтрий" onClick={() => setDeleteTarget(node)}>
        <IconTrash />
      </button>
    </span>
  );

  return (
    <AppShell search={searchBox}>
      <main className="content-main">
        <div className="crumbs">
          {crumbs(path).map((c, i, all) => (
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
          <label className="btn">
            <IconUpload width={16} height={16} />
            Качи
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
          <button type="button" className="btn ghost" onClick={() => setMkdirOpen(true)}>
            <IconPlus width={16} height={16} />
            Нова папка
          </button>
          <span className="grow" />
          <select
            className="select"
            aria-label="Сортиране"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
          >
            <option value="name">По име</option>
            <option value="size">По размер</option>
            <option value="date">По дата</option>
          </select>
          <span className="toggle" role="group" aria-label="Изглед">
            <button
              type="button"
              className={view === "list" ? "active" : ""}
              title="Списък"
              onClick={() => pickView("list")}
            >
              <IconListView />
            </button>
            <button
              type="button"
              className={view === "grid" ? "active" : ""}
              title="Решетка"
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
                <th>Име</th>
                <th style={{ width: 110 }}>Размер</th>
                <th style={{ width: 170 }}>Променен</th>
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
                          aria-label="Ново име"
                          autoFocus
                        />
                        <button type="submit" className="btn" style={{ padding: "5px 10px" }}>
                          Запази
                        </button>
                        <button type="button" className="btn ghost" style={{ padding: "5px 10px" }} onClick={() => setRenamePath("")}>
                          Отказ
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
                  <span className="sub">{node.is_dir ? "папка" : formatBytes(node.size)}</span>
                </span>
                {rowActions(node)}
              </div>
            ))}
          </div>
        )}

        {sorted.length === 0 && !busy ? (
          <div className="empty-state">
            {query ? `Няма резултати за „${query}“.` : "Папката е празна. Качете файл или създайте папка."}
          </div>
        ) : null}
        {busy ? <p className="muted">Зареждане…</p> : null}
      </main>

      {open ? (
        <FilePreview
          node={open}
          onClose={() => setOpen(null)}
          onRename={() => startRename(open)}
          onDelete={() => setDeleteTarget(open)}
          onShowVersions={() => setVersionsFor(open)}
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

      {mkdirOpen ? (
        <Dialog title="Нова папка" onClose={() => setMkdirOpen(false)}>
          <form onSubmit={onMkdir}>
            <div className="field">
              <label htmlFor="mkdir-name">Име</label>
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
                Отказ
              </button>
              <button type="submit" className="btn" disabled={busy}>
                Създай
              </button>
            </div>
          </form>
        </Dialog>
      ) : null}

      {deleteTarget ? (
        <Dialog title="Изтриване" onClose={() => setDeleteTarget(null)}>
          <p style={{ margin: 0 }}>
            Сигурни ли сте, че искате да изтриете <b>{deleteTarget.name}</b>?
          </p>
          <div className="dialog-actions">
            <button type="button" className="btn ghost" onClick={() => setDeleteTarget(null)}>
              Отказ
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
              Изтрий
            </button>
          </div>
        </Dialog>
      ) : null}
    </AppShell>
  );
}

function FilePreview({
  node,
  onClose,
  onRename,
  onDelete,
  onShowVersions,
  onError,
}: {
  node: FsNode;
  onClose: () => void;
  onRename: () => void;
  onDelete: () => void;
  onShowVersions: () => void;
  onError: (msg: string) => void;
}) {
  const router = useRouter();
  const [kind, setKind] = useState("");
  const [text, setText] = useState("");
  const [img, setImg] = useState("");
  const [err, setErr] = useState("");
  const editable = /\.(docx|odt|txt|md|xlsx|ods|csv)$/i.test(node.name);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let dead = false;
    let obj = "";
    setKind("");
    setText("");
    setImg("");
    setErr("");
    (async () => {
      const prev = await api.get<{ kind: string; text: string }>(`/v1/fs/preview?path=${qpath(node.path)}`);
      if (dead) return;
      setKind(prev.kind);
      setText(prev.text ?? "");
      if (prev.kind !== "image" && prev.kind !== "pdf") return;
      const res = await authedFetch(`/v1/fs/file?path=${qpath(node.path)}`);
      if (!res.ok || dead) return;
      obj = URL.createObjectURL(await res.blob());
      if (dead) {
        URL.revokeObjectURL(obj);
        return;
      }
      setImg(obj);
    })().catch((e: unknown) => {
      if (!dead) setErr(messageOf(e));
    });
    return () => {
      dead = true;
      if (obj) URL.revokeObjectURL(obj);
    };
  }, [node.path]);

  return (
    <aside className="preview-pane">
      <div className="preview-bar">
        <span className="label">{node.name}</span>
        <span className="grow" />
        <button type="button" className="icon-btn" title="Затвори" onClick={onClose}>
          <IconClose />
        </button>
      </div>
      <div className="preview-body">
        {err ? <p className="err">{err}</p> : null}
        {kind === "image" && img ? <img className="preview-img" src={img} alt="" /> : null}
        {kind === "pdf" && img ? (
          <embed className="preview-pdf" src={img} type="application/pdf" />
        ) : null}
        {kind === "markdown" ? (
          <div className="preview-md" dangerouslySetInnerHTML={{ __html: mdToHtml(text) }} />
        ) : null}
        {kind === "csv" ? <PreviewTable text={text} sep={text.includes(";") ? ";" : ","} /> : null}
        {kind === "sheet" ? <PreviewTable text={text} sep={"\t"} /> : null}
        {kind === "zip" ? <ZipPreview node={node} onError={onError} /> : null}
        {kind === "text" ? <pre>{text}</pre> : null}
        {kind === "empty" ? <p className="muted">Няма текстов преглед за този файл.</p> : null}
        {kind === "" && !err ? <p className="muted">Отваряне…</p> : null}

        <dl className="preview-facts">
          <div>
            <dt>Размер</dt>
            <dd>{formatBytes(node.size)}</dd>
          </div>
          <div>
            <dt>Променен</dt>
            <dd>{formatDate(node.updated_at)}</dd>
          </div>
          <div>
            <dt>Път</dt>
            <dd>{node.path}</dd>
          </div>
        </dl>

        <div className="preview-actions">
          {editable ? (
            <button
              type="button"
              className="btn"
              onClick={() => router.push(`/edit?path=${encodeURIComponent(node.path)}`)}
            >
              <IconPencil width={16} height={16} /> Редактирай
            </button>
          ) : null}
          <button
            type="button"
            className={editable ? "btn ghost" : "btn"}
            onClick={() => void downloadFile(node).catch((e) => onError(messageOf(e)))}
          >
            <IconDownload width={16} height={16} /> Свали
          </button>
          <button type="button" className="btn ghost" onClick={onShowVersions}>
            <IconHistory width={16} height={16} /> Версии
          </button>
          <button type="button" className="btn ghost" onClick={onRename}>
            <IconPencil width={16} height={16} /> Преименувай
          </button>
          <button type="button" className="btn danger-ghost" onClick={onDelete}>
            <IconTrash width={16} height={16} /> Изтрий
          </button>
        </div>
      </div>
    </aside>
  );
}

function PreviewTable({ text, sep }: { text: string; sep: string }) {
  const rows = text
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => l.split(sep));
  if (rows.length === 0) return <p className="muted">Празна таблица.</p>;
  return (
    <div className="preview-table-wrap">
      <table className="preview-table">
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (r === 0 ? <th key={c}>{cell}</th> : <td key={c}>{cell}</td>))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ZipPreview({ node, onError }: { node: FsNode; onError: (msg: string) => void }) {
  const [items, setItems] = useState<ZipEntry[] | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let dead = false;
    setItems(null);
    setErr("");
    listZip(node.path)
      .then((z) => {
        if (!dead) setItems(z.items);
      })
      .catch((e: unknown) => {
        if (!dead) setErr(messageOf(e));
      });
    return () => {
      dead = true;
    };
  }, [node.path]);

  if (err) return <p className="err">{err}</p>;
  if (!items) return <p className="muted">Отваряне на архива…</p>;
  if (items.length === 0) return <p className="muted">Празен архив.</p>;
  return (
    <div className="preview-table-wrap">
      <table className="preview-table">
        <tbody>
          {items.map((it) => (
            <tr key={it.name}>
              <td>
                <span className="zip-name">
                  {it.is_dir ? "📁 " : ""}
                  {it.name}
                </span>
              </td>
              <td className="muted">{it.is_dir ? "" : formatBytes(it.size)}</td>
              <td>
                {it.is_dir ? null : (
                  <button
                    type="button"
                    className="icon-btn"
                    title="Свали"
                    onClick={() => void downloadZipEntry(node, it.name).catch((e) => onError(messageOf(e)))}
                  >
                    <IconDownload width={15} height={15} />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function VersionsDialog({
  node,
  onClose,
  onRestored,
}: {
  node: FsNode;
  onClose: () => void;
  onRestored: () => void;
}) {
  const [items, setItems] = useState<FsVersion[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let dead = false;
    listVersions(node.path)
      .then((list) => {
        if (!dead) setItems(list.items ?? []);
      })
      .catch((e: unknown) => {
        if (!dead) setErr(messageOf(e));
      });
    return () => {
      dead = true;
    };
  }, [node.path]);

  async function onRestore(v: FsVersion) {
    setBusy(true);
    setErr("");
    try {
      await restoreVersion(node.path, v.id);
      onRestored();
    } catch (e: unknown) {
      setErr(messageOf(e));
      setBusy(false);
    }
  }

  return (
    <Dialog title={`Версии на ${node.name}`} onClose={onClose}>
      {err ? <p className="err">{err}</p> : null}
      {items.length === 0 && !err ? (
        <p className="muted">Няма запазени версии. Версия се пази при всяка промяна на файла.</p>
      ) : null}
      <div className="versions-list">
        {items.map((v) => (
          <div key={v.id} className="version-row">
            <span className="version-meta">
              <span className="label">v{v.id}</span>
              <span className="sub">
                {formatBytes(v.size)} · {formatDate(v.created_at)}
              </span>
            </span>
            <span className="row-actions" style={{ opacity: 1 }}>
              <button
                type="button"
                className="icon-btn"
                title="Свали тази версия"
                onClick={() => void downloadVersion(node, v.id).catch((e: unknown) => setErr(messageOf(e)))}
              >
                <IconDownload />
              </button>
              <button
                type="button"
                className="icon-btn"
                title="Възстанови"
                disabled={busy}
                onClick={() => void onRestore(v)}
              >
                <IconHistory />
              </button>
            </span>
          </div>
        ))}
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn ghost" onClick={onClose}>
          Затвори
        </button>
      </div>
    </Dialog>
  );
}

function Thumb({ path }: { path: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let dead = false;
    let obj = "";
    (async () => {
      const res = await authedFetch(`/v1/fs/thumb?path=${qpath(path)}`);
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
  }, [path]);
  if (!url) return <IconFile width={18} height={18} />;
  return <img src={url} alt="" />;
}
