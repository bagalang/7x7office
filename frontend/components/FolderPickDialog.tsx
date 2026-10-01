"use client";

import { useEffect, useState } from "react";
import { Dialog } from "./Dialog";
import { useI18n } from "./I18nProvider";
import { IconFolder } from "./icons";
import { canWrite, useWorkspace } from "./WorkspaceProvider";
import { ApiError, FsList, FsNode, api, qpath } from "../lib/api";

function messageOf(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

function joinPath(dir: string, name: string): string {
  const clean = name.trim().replace(/^\/+|\/+$/g, "");
  if (!clean || clean.includes("/") || clean === "." || clean === "..") return "";
  if (dir === "/") return `/${clean}`;
  return `${dir}/${clean}`;
}

function crumbs(path: string, root: string): { name: string; path: string }[] {
  const out = [{ name: root, path: "/" }];
  if (path === "/") return out;
  let cur = "";
  for (const part of path.split("/").filter(Boolean)) {
    cur += `/${part}`;
    out.push({ name: part, path: cur });
  }
  return out;
}

export function FolderPick({
  id,
  label,
  value,
  allowAll,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  allowAll?: boolean;
  onChange: (path: string) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const empty = value === "";
  const shown = empty ? (allowAll ? t("flows.all_folders") : t("flows.pick")) : value;

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <button
        id={id}
        type="button"
        className={`input folder-pick${empty && !allowAll ? " placeholder" : ""}`}
        onClick={() => setOpen(true)}
      >
        <IconFolder width={16} height={16} />
        <span>{shown}</span>
      </button>
      {open ? (
        <FolderPickDialog
          title={label}
          initial={value || "/"}
          allowAll={allowAll}
          onClose={() => setOpen(false)}
          onPick={(path) => {
            onChange(path);
            setOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

function FolderPickDialog({
  title,
  initial,
  allowAll,
  onClose,
  onPick,
}: {
  title: string;
  initial: string;
  allowAll?: boolean;
  onClose: () => void;
  onPick: (path: string) => void;
}) {
  const { t } = useI18n();
  const { wsId, workspaces } = useWorkspace();
  const [space, setSpace] = useState(wsId);
  const [path, setPath] = useState(initial || "/");
  const [listed, setListed] = useState<FsNode[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const ws = workspaces.find((w) => Number(w.id) === space);
  const writable = ws ? canWrite(ws) : space === 0;

  useEffect(() => {
    let dead = false;
    setLoaded(false);
    // Изричен workspace_id, включително 0. api сам добавя активното
    // пространство, а този прозорец може да показва друго дърво.
    api
      .get<FsList>(`/v1/fs/list?path=${qpath(path)}&workspace_id=${space}`)
      .then((list) => {
        if (dead) return;
        setListed(list.items ?? []);
        setErr("");
        setLoaded(true);
      })
      .catch((e: unknown) => {
        if (dead) return;
        if (path !== "/") {
          setPath("/");
          return;
        }
        setListed([]);
        setErr(messageOf(e, t("common.error")));
        setLoaded(true);
      });
    return () => {
      dead = true;
    };
  }, [path, space, t]);

  const dirs = listed.filter((item) => item.is_dir === 1);

  async function createFolder() {
    const dest = joinPath(path, folderName);
    if (!dest) {
      setErr(t("files.err_bad_folder"));
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await api.post(`/v1/fs/mkdir?path=${qpath(dest)}&workspace_id=${space}`);
      setFolderName("");
      setPath(dest);
    } catch (e: unknown) {
      setErr(messageOf(e, t("common.error")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog wide title={title} onClose={onClose}>
      {workspaces.length > 1 ? (
        <div className="field">
          <label htmlFor="flow-folder-ws">{t("files.dest_space")}</label>
          <select
            id="flow-folder-ws"
            className="select"
            value={String(space)}
            onChange={(e) => {
              setSpace(Number(e.target.value));
              setPath("/");
              setErr("");
            }}
          >
            {!workspaces.some((w) => Number(w.id) === space) ? (
              <option value={String(space)}>{space > 0 ? `№${space}` : t("ws.personal_files")}</option>
            ) : null}
            {workspaces.map((w) => (
              <option key={w.id} value={String(w.id)}>
                {w.label} · №{w.id}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="field">
        <div className="transfer-crumbs">
          {crumbs(path, t("files.title")).map((c, i, all) => (
            <span key={c.path}>
              {i > 0 ? <span className="sep"> / </span> : null}
              {i === all.length - 1 ? (
                <span className="crumb current">{c.name}</span>
              ) : (
                <button type="button" className="crumb" onClick={() => setPath(c.path)}>
                  {c.name}
                </button>
              )}
            </span>
          ))}
        </div>
        <div className="transfer-dirs">
          {!loaded ? <p className="muted transfer-empty">{t("common.loading")}</p> : null}
          {loaded && dirs.length === 0 ? <p className="muted transfer-empty">{t("files.dest_empty")}</p> : null}
          {dirs.map((dir) => (
            <button key={dir.path} type="button" onClick={() => setPath(dir.path)}>
              <IconFolder width={16} height={16} />
              {dir.name}
            </button>
          ))}
        </div>
        <p className="muted transfer-here">{t("flows.pick_here_hint")}</p>
      </div>
      {writable ? (
        <div className="folder-new">
          <input
            className="input"
            value={folderName}
            placeholder={t("files.new_folder")}
            aria-label={t("files.new_folder")}
            onChange={(e) => setFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void createFolder();
              }
            }}
          />
          <button type="button" className="btn ghost" disabled={busy || !folderName.trim()} onClick={() => void createFolder()}>
            {t("common.create")}
          </button>
        </div>
      ) : null}
      {err ? <p className="err">{err}</p> : null}
      <div className="dialog-actions">
        <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
          {t("common.cancel")}
        </button>
        {allowAll ? (
          <button type="button" className="btn ghost" disabled={busy} onClick={() => onPick("")}>
            {t("flows.all_folders")}
          </button>
        ) : null}
        <button type="button" className="btn" disabled={busy} onClick={() => onPick(path)}>
          {t("flows.pick_here")}
        </button>
      </div>
    </Dialog>
  );
}
