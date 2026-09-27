"use client";

import { FormEvent, useEffect, useState } from "react";
import { Dialog } from "./Dialog";
import { useI18n } from "./I18nProvider";
import { IconFolder } from "./icons";
import { canWrite } from "./WorkspaceProvider";
import { ApiError, FsList, FsNode, Workspace, api, qpath } from "../lib/api";

export type TransferMode = "copy" | "move";

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

export function TransferDialog({
  mode,
  nodes,
  workspaces,
  sourceWsId,
  onClose,
  onDone,
}: {
  mode: TransferMode;
  nodes: FsNode[];
  workspaces: Workspace[];
  sourceWsId: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const writable = workspaces.filter((w) => canWrite(w));
  const [destWs, setDestWs] = useState(() => {
    if (writable.some((w) => w.id === sourceWsId)) return sourceWsId;
    return writable[0]?.id ?? 0;
  });
  const [destPath, setDestPath] = useState("/");
  const [listed, setListed] = useState<FsNode[]>([]);
  const [name, setName] = useState(nodes.length === 1 ? nodes[0].name : "");
  const [nameTouched, setNameTouched] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const single = nodes[0];

  useEffect(() => {
    if (!destWs) return;
    let dead = false;
    api
      .get<FsList>(`/v1/fs/list?path=${qpath(destPath)}&workspace_id=${destWs}`)
      .then((list) => {
        if (dead) return;
        const items = list.items ?? [];
        setListed(items);
        setErr("");
        if (nodes.length === 1 && mode === "copy" && !nameTouched) {
          setName(uniqueName(nodes[0].name, new Set(items.map((item) => item.name))));
        }
      })
      .catch((e: unknown) => {
        if (!dead) {
          setListed([]);
          setErr(messageOf(e, t("common.error")));
        }
      });
    return () => {
      dead = true;
    };
  }, [destPath, destWs, mode, nodes, t, nameTouched]);

  const dirs = listed.filter((item) => item.is_dir === 1);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!destWs || busy) return;
    setErr("");
    const sameWs = destWs === sourceWsId;
    const sourcePaths = new Set(nodes.map((node) => node.path));
    const occupied = new Set(
      listed.filter((item) => !(sameWs && sourcePaths.has(item.path))).map((item) => item.name),
    );
    const jobs: { from: string; to: string }[] = [];
    for (const node of nodes) {
      let leaf = node.name;
      if (nodes.length === 1) leaf = name.trim();
      if (mode === "copy" && nodes.length > 1) leaf = uniqueName(node.name, occupied);
      const dest = joinPath(destPath, leaf);
      if (!dest) {
        setErr(t("files.err_bad_name"));
        return;
      }
      if (sameWs && dest === node.path) {
        setErr(t("files.err_same"));
        return;
      }
      if (sameWs && node.is_dir === 1 && dest.startsWith(`${node.path}/`)) {
        setErr(t("files.err_into"));
        return;
      }
      if (occupied.has(leaf)) {
        setErr(t("files.err_exists"));
        return;
      }
      occupied.add(leaf);
      jobs.push({ from: node.path, to: dest });
    }
    setBusy(true);
    const op = mode === "copy" ? "copy" : "move";
    try {
      for (const job of jobs) {
        await api.post(`/v1/fs/${op}?from=${qpath(job.from)}&to=${qpath(job.to)}&dest_ws=${destWs}`);
      }
      onDone();
    } catch (e: unknown) {
      setErr(messageOf(e, t("common.error")));
      setBusy(false);
    }
  }

  return (
    <Dialog wide title={t(mode === "copy" ? "files.copy_title" : "files.move_title")} onClose={onClose}>
      <form onSubmit={(e) => void onSubmit(e)}>
        <div className="field">
          <label htmlFor="transfer-ws">{t("files.dest_space")}</label>
          <select
            id="transfer-ws"
            className="select"
            value={destWs || ""}
            onChange={(e) => {
              setDestWs(Number(e.target.value));
              setDestPath("/");
              setErr("");
            }}
          >
            {writable.map((ws) => (
              <option key={ws.id} value={ws.id}>
                {ws.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>{t("files.dest_folder")}</label>
          <div className="transfer-crumbs">
            {crumbs(destPath, t("files.title")).map((c, i, all) => (
              <span key={c.path}>
                {i > 0 ? <span className="sep"> / </span> : null}
                {i === all.length - 1 ? (
                  <span className="crumb current">{c.name}</span>
                ) : (
                  <button type="button" className="crumb" onClick={() => setDestPath(c.path)}>
                    {c.name}
                  </button>
                )}
              </span>
            ))}
          </div>
          <div className="transfer-dirs">
            {dirs.length === 0 ? <p className="muted transfer-empty">{t("files.dest_empty")}</p> : null}
            {dirs.map((dir) => (
              <button key={dir.path} type="button" onClick={() => setDestPath(dir.path)}>
                <IconFolder width={16} height={16} />
                {dir.name}
              </button>
            ))}
          </div>
          <p className="muted transfer-here">{t("files.transfer_here")}</p>
        </div>
        {nodes.length === 1 && single ? (
          <div className="field">
            <label htmlFor="transfer-name">{t("files.transfer_name")}</label>
            <input
              id="transfer-name"
              className="input"
              value={name}
              onChange={(e) => {
                setNameTouched(true);
                setName(e.target.value);
              }}
            />
          </div>
        ) : null}
        {err ? <p className="err">{err}</p> : null}
        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="btn" disabled={busy || !destWs}>
            {t(mode === "copy" ? "files.copy" : "files.move")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
