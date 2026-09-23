"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";
import {
  ApiError,
  FsList,
  FsNode,
  FsUsage,
  api,
  authedFetch,
  downloadFile,
  putFile,
  qpath,
} from "../lib/api";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
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

export function FileBrowser() {
  const { logout } = useAuth();
  const router = useRouter();
  const [path, setPath] = useState("/");
  const [items, setItems] = useState<FsNode[]>([]);
  const [usage, setUsage] = useState<FsUsage | null>(null);
  const [who, setWho] = useState("");
  const [admin, setAdmin] = useState(false);
  const [folder, setFolder] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [renamePath, setRenamePath] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [open, setOpen] = useState<FsNode | null>(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setBusy(true);
      setError("");
      try {
        const [list, use, me] = await Promise.all([
          api.get<FsList>(`/v1/fs/list?path=${qpath(path)}`),
          api.get<FsUsage>("/v1/fs/usage"),
          api.get<{ sub?: string; is_admin?: number }>("/v1/me"),
        ]);
        if (cancel) return;
        setItems(list.items ?? []);
        setUsage(use);
        setWho(me.sub ?? "");
        setAdmin(me.is_admin === 1);
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

  const sorted = items.slice().sort((a, b) => {
    if (a.is_dir !== b.is_dir) return b.is_dir - a.is_dir;
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
    await run(async () => {
      await api.post(`/v1/fs/mkdir?path=${qpath(dest)}`);
      setFolder("");
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
    await run(async () => {
      await api.post(`/v1/fs/move?from=${qpath(renamePath)}&to=${qpath(dest)}`);
      setRenamePath("");
    });
  }

  const used = usage?.used_bytes ?? 0;
  const quota = usage?.quota_bytes ?? 0;
  const pct = quota > 0 ? Math.min(100, Math.round((used / quota) * 100)) : 0;

  return (
    <>
      <header className="top">
        <b>7x7office · secp</b>
        {admin ? <Link href="/users">Потребители</Link> : null}
        <span className="grow" />
        <span className="who">{who}</span>
        <button
          type="button"
          className="link"
          onClick={() => {
            logout();
            router.replace("/login");
          }}
        >
          Изход
        </button>
      </header>
      <main className="wrap">
        <div className="crumbs">
          {crumbs(path).map((c, i) => (
            <span key={c.path}>
              {i > 0 ? <span className="sep">/</span> : null}
              <button type="button" className="crumb" onClick={() => { setOpen(null); setPath(c.path); }}>
                {c.name}
              </button>
            </span>
          ))}
        </div>

        <div className="toolbar">
          <form onSubmit={onMkdir} className="row">
            <input
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              placeholder="Нова папка"
              aria-label="Нова папка"
            />
            <button type="submit" disabled={busy}>
              Създай
            </button>
          </form>
          <label className="upload">
            Качи
            <input
              type="file"
              multiple
              onChange={(e) => {
                void onUpload(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
          <div className="quota">
            <div className="bar">
              <span style={{ width: `${pct}%` }} />
            </div>
            <span className="muted">
              {formatBytes(used)} / {formatBytes(quota)}
            </span>
          </div>
        </div>

        {error ? <p className="err">{error}</p> : null}
        {busy ? <p className="muted">Зареждане…</p> : null}

        <ul className="files">
          {path !== "/" ? (
            <li>
              <button type="button" className="name" onClick={() => { setOpen(null); setPath(parentOf(path)); }}>
                ..
              </button>
            </li>
          ) : null}
          {sorted.length === 0 ? <li className="muted empty">Папката е празна.</li> : null}
          {sorted.map((node) => (
            <li key={node.path}>
              {node.has_thumb === 1 ? <Thumb path={node.path} /> : <span className="ph">{node.is_dir ? "▣" : "▤"}</span>}
              {renamePath === node.path ? (
                <form onSubmit={onRename} className="row grow">
                  <input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    aria-label="Ново име"
                    autoFocus
                  />
                  <button type="submit">Запази</button>
                  <button type="button" className="ghost" onClick={() => setRenamePath("")}>
                    Отказ
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  className="name"
                  onClick={() => {
                    if (node.is_dir) {
                      setOpen(null);
                      setPath(node.path);
                    } else {
                      setOpen(node);
                    }
                  }}
                >
                  {node.name}
                </button>
              )}
              <span className="meta">{node.is_dir ? "папка" : formatBytes(node.size)}</span>
              <span className="actions">
                {node.is_dir === 0 ? (
                  <button type="button" onClick={() => void downloadFile(node).catch((err) => setError(messageOf(err)))}>
                    Свали
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    setRenamePath(node.path);
                    setRenameValue(node.name);
                  }}
                >
                  Преименувай
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => {
                    if (!window.confirm(`Изтриване на ${node.name}?`)) return;
                    void run(async () => {
                      await api.del(`/v1/fs/file?path=${qpath(node.path)}`);
                    });
                  }}
                >
                  Изтрий
                </button>
              </span>
            </li>
          ))}
        </ul>
        {open ? <FilePreview node={open} onClose={() => setOpen(null)} /> : null}
      </main>
    </>
  );
}

function FilePreview({ node, onClose }: { node: FsNode; onClose: () => void }) {
  const [kind, setKind] = useState("");
  const [text, setText] = useState("");
  const [img, setImg] = useState("");
  const [err, setErr] = useState("");

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
      if (prev.kind !== "image") return;
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
    <section className="preview">
      <div className="preview-bar">
        <b>{node.name}</b>
        <span className="grow" />
        <button type="button" onClick={() => void downloadFile(node).catch((e) => setErr(messageOf(e)))}>
          Свали
        </button>
        <button type="button" className="ghost" onClick={onClose}>
          Затвори
        </button>
      </div>
      {err ? <p className="err">{err}</p> : null}
      {kind === "image" && img ? <img className="preview-img" src={img} alt="" /> : null}
      {kind === "text" ? <pre>{text}</pre> : null}
      {kind === "empty" ? <p className="muted">Файлът е записан. Няма текстов преглед — сваля се с „Свали“.</p> : null}
      {kind === "" && !err ? <p className="muted">Отваряне…</p> : null}
    </section>
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
  if (!url) return <span className="ph">▤</span>;
  return <img className="thumb" src={url} alt="" />;
}
