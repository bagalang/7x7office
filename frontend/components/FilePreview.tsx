"use client";

// FilePreview — дясната лента: преглед (markdown/csv/sheet/pdf/image/zip/text),
// действия и диалог с версиите. Изнесено от FileBrowser, за да останат двата
// файла четими.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "./Dialog";
import { useI18n } from "./I18nProvider";
import { IconActivity, IconClose, IconDownload, IconHistory, IconPencil, IconShare, IconTrash } from "./icons";
import { ActivityFeed } from "./ActivityFeed";
import {
  FsNode,
  FsVersion,
  ZipEntry,
  api,
  authedFetchWs,
  downloadFile,
  downloadVersion,
  downloadZipEntry,
  listVersions,
  listZip,
  qpath,
  restoreVersion,
} from "../lib/api";
import { mdToHtml } from "../lib/markdown";
import { useWorkspace, canWrite, canShare } from "./WorkspaceProvider";
import { formatBytes, formatDate, messageOf } from "./FileBrowser";

export function FilePreview({
  node,
  onClose,
  onRename,
  onDelete,
  onShowVersions,
  onShare,
  onError,
}: {
  node: FsNode;
  onClose: () => void;
  onRename: () => void;
  onDelete: () => void;
  onShowVersions: () => void;
  onShare: () => void;
  onError: (msg: string) => void;
}) {
  const { t } = useI18n();
  const { active } = useWorkspace();
  const writable = canWrite(active);
  const shareable = canShare(active);
  const router = useRouter();
  const [kind, setKind] = useState("");
  const [text, setText] = useState("");
  const [img, setImg] = useState("");
  const [err, setErr] = useState("");
  // Историята е скрита по подразбиране: тя е контекст, не основното действие
  // (преглед). Отваря се с един бутон и се презарежда при смяна на файла —
  // затова е state тук, а не отделен диалог.
  const [showHistory, setShowHistory] = useState(false);
  const [wopi, setWopi] = useState<{ wopi_src: string; access_token: string } | null>(null);
  const [copied, setCopied] = useState("");
  const editable = /\.(docx|odt|txt|md|xlsx|ods|csv)$/i.test(node.name);

  // Нов файл → историята се затваря. Иначе редът „кой промени файла" остава
  // от предишния файл, докато панелът вече показва друг.
  useEffect(() => {
    setShowHistory(false);
  }, [node.path]);

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
      const prev = await api.preview(node.path);
      if (dead) return;
      setKind(prev.kind);
      setText(prev.text ?? "");
      if (prev.kind !== "image" && prev.kind !== "pdf") return;
      const res = await authedFetchWs(`/v1/fs/file?path=${qpath(node.path)}`);
      if (!res.ok || dead) return;
      obj = URL.createObjectURL(await res.blob());
      if (dead) {
        URL.revokeObjectURL(obj);
        return;
      }
      setImg(obj);
    })().catch((e: unknown) => {
      if (!dead) setErr(messageOf(e, t("common.error")));
    });
    return () => {
      dead = true;
      if (obj) URL.revokeObjectURL(obj);
    };
  }, [node.path, t]);

  return (
    <aside className="preview-pane">
      <div className="preview-bar">
        <span className="label">{node.name}</span>
        <span className="grow" />
        <button type="button" className="icon-btn" title={t("preview.close")} onClick={onClose}>
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
        {kind === "empty" ? <p className="muted">{t("preview.no_text")}</p> : null}
        {kind === "" && !err ? <p className="muted">{t("preview.opening")}</p> : null}

        <dl className="preview-facts">
          <div>
            <dt>{t("preview.size")}</dt>
            <dd>{formatBytes(node.size)}</dd>
          </div>
          <div>
            <dt>{t("preview.modified")}</dt>
            <dd>{formatDate(node.updated_at)}</dd>
          </div>
          <div>
            <dt>{t("preview.path")}</dt>
            <dd>{node.path}</dd>
          </div>
        </dl>

        {/* История на възела и поддървото му: същата лента като в горния бар,
            но стеснена до този път. Показва се само при поискване. */}
        {showHistory ? (
          <div className="preview-history">
            <p className="label">{t("activity.history_title", { name: node.name })}</p>
            <ActivityFeed path={node.path} limit={30} compact />
          </div>
        ) : null}

        <div className="preview-actions">
          {node.is_dir !== 1 ? (
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                setCopied("");
                void api
                  .get<{ wopi_src: string; access_token: string }>(`/v1/wopi/token?path=${qpath(node.path)}`)
                  .then(setWopi)
                  .catch((e) => onError(messageOf(e, t("common.error"))));
              }}
            >
              {t("wopi.open")}
            </button>
          ) : null}
          {editable && writable ? (
            <button
              type="button"
              className="btn"
              onClick={() => router.push(`/edit?path=${encodeURIComponent(node.path)}`)}
            >
              <IconPencil width={16} height={16} /> {t("preview.edit")}
            </button>
          ) : null}
          <button
            type="button"
            className={editable && writable ? "btn ghost" : "btn"}
            onClick={() => void downloadFile(node).catch((e) => onError(messageOf(e, t("common.error"))))}
          >
            <IconDownload width={16} height={16} /> {t("preview.download")}
          </button>
          <button type="button" className="btn ghost" onClick={onShowVersions}>
            <IconHistory width={16} height={16} /> {t("preview.versions")}
          </button>
          <button
            type="button"
            className={`btn ghost${showHistory ? " active" : ""}`}
            aria-pressed={showHistory}
            onClick={() => setShowHistory((v) => !v)}
          >
            <IconActivity width={16} height={16} /> {t("activity.history")}
          </button>
          {writable ? (
            <>
              <button type="button" className="btn ghost" onClick={onRename}>
                <IconPencil width={16} height={16} /> {t("preview.rename")}
              </button>
              <button type="button" className="btn danger-ghost" onClick={onDelete}>
                <IconTrash width={16} height={16} /> {t("preview.delete")}
              </button>
            </>
          ) : null}
          {shareable ? (
            <button type="button" className="btn ghost" onClick={onShare}>
              <IconShare width={16} height={16} /> {t("ws.share")}
            </button>
          ) : null}
        </div>
      </div>
      {wopi ? (
        <Dialog title={t("wopi.title")} onClose={() => setWopi(null)}>
          <p className="muted">{t("wopi.hint")}</p>
          <div className="field">
            <label>{t("wopi.src")}</label>
            <input className="input" readOnly value={wopi.wopi_src} />
          </div>
          <div className="field">
            <label>{t("wopi.token")}</label>
            <input className="input" readOnly value={wopi.access_token} />
          </div>
          <div className="dialog-actions">
            <button
              type="button"
              className="btn"
              onClick={() => {
                const text = `${wopi.wopi_src}\n${wopi.access_token}`;
                void navigator.clipboard.writeText(text).then(() => setCopied(t("wopi.copied")));
              }}
            >
              {copied || t("wopi.copy")}
            </button>
          </div>
        </Dialog>
      ) : null}
    </aside>
  );
}

function PreviewTable({ text, sep }: { text: string; sep: string }) {
  const { t } = useI18n();
  const rows = text
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => l.split(sep));
  if (rows.length === 0) return <p className="muted">{t("preview.empty_table")}</p>;
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
  const { t } = useI18n();
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
        if (!dead) setErr(messageOf(e, t("common.error")));
      });
    return () => {
      dead = true;
    };
  }, [node.path, t]);

  if (err) return <p className="err">{err}</p>;
  if (!items) return <p className="muted">{t("zip.opening")}</p>;
  if (items.length === 0) return <p className="muted">{t("zip.empty")}</p>;
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
                    title={t("zip.download")}
                    onClick={() => void downloadZipEntry(node, it.name).catch((e) => onError(messageOf(e, t("common.error"))))}
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

export function VersionsDialog({
  node,
  onClose,
  onRestored,
}: {
  node: FsNode;
  onClose: () => void;
  onRestored: () => void;
}) {
  const { t } = useI18n();
  const { active } = useWorkspace();
  const canRestore = canWrite(active);
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
        if (!dead) setErr(messageOf(e, t("common.error")));
      });
    return () => {
      dead = true;
    };
  }, [node.path, t]);

  async function onRestore(v: FsVersion) {
    setBusy(true);
    setErr("");
    try {
      await restoreVersion(node.path, v.id);
      onRestored();
    } catch (e: unknown) {
      setErr(messageOf(e, t("common.error")));
      setBusy(false);
    }
  }

  return (
    <Dialog title={t("versions.title", { name: node.name })} onClose={onClose}>
      {err ? <p className="err">{err}</p> : null}
      {items.length === 0 && !err ? <p className="muted">{t("versions.empty")}</p> : null}
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
                title={t("versions.download")}
                onClick={() => void downloadVersion(node, v.id).catch((e: unknown) => setErr(messageOf(e, t("common.error"))))}
              >
                <IconDownload />
              </button>
              <button
                type="button"
                className="icon-btn"
                title={t("versions.restore")}
                disabled={busy || !canRestore}
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
          {t("versions.close")}
        </button>
      </div>
    </Dialog>
  );
}
