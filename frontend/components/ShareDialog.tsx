"use client";

// ShareDialog — споделяне на файл/папка (Фаза 2 ACL + Фаза 3 линкове).
//
// Два разделa, защото са два различни модела:
//   - „Хора" (ACL): изрични права за потребител/роля В пространството. Само
//     за екипни пространства — в личното няма с кого да се дели.
//   - „Линкове" (Фаза 3): публичен URL, който работи БЕЗ вход. Срок, таван на
//     свалянията, парола. Работи и в личното (там е основният случай: „прати
//     този файл на човек без акаунт").
//
// Диалог, а не страница: споделя се винаги в контекста на конкретен път, а
// пътят се избира в браузъра — така бутонът стои до името на файла.

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Dialog } from "./Dialog";
import { useI18n } from "./I18nProvider";
import { useWorkspace, canAcl } from "./WorkspaceProvider";
import {
  AclRow,
  ApiError,
  ShareLink,
  createShare,
  deleteAcl,
  listAcl,
  listShares,
  revokeShare,
  setAcl,
} from "../lib/api";

function messageOf(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

type Tab = "people" | "links";

export function ShareDialog({
  workspaceId,
  path,
  isDir,
  onClose,
}: {
  workspaceId: number;
  path: string;
  isDir: number;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { active, reload } = useWorkspace();
  // В личното пространство ACL няма смисъл — отваряме направо „Линкове".
  const aclAllowed = canAcl(active);
  const [tab, setTab] = useState<Tab>(aclAllowed ? "people" : "links");

  return (
    <Dialog title={t("ws.share_title").replace("{path}", path)} onClose={onClose} wide>
      <div className="share-tabs">
        {aclAllowed ? (
          <button
            type="button"
            className={`btn ghost sm ${tab === "people" ? "active" : ""}`}
            onClick={() => setTab("people")}
          >
            {t("ws.share_tab_people")}
          </button>
        ) : null}
        <button
          type="button"
          className={`btn ghost sm ${tab === "links" ? "active" : ""}`}
          onClick={() => setTab("links")}
        >
          {t("ws.share_tab_links")}
        </button>
      </div>
      {tab === "people" ? (
        <AclPanel workspaceId={workspaceId} path={path} onChanged={reload} />
      ) : (
        <LinksPanel workspaceId={workspaceId} path={path} isDir={isDir} onChanged={reload} />
      )}
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onClose}>
          {t("common.close")}
        </button>
      </div>
    </Dialog>
  );
}

// ---------- ACL (Фаза 2) ----------

function subjectOf(t: (k: string) => string, row: AclRow): string {
  if (row.kind === "user") {
    return row.subject_name || row.subject_email || `#${row.subject_user_id}`;
  }
  const key = `ws.role_${row.subject_role}`;
  const label = t(key);
  return label === key ? row.subject_role : label;
}

function AclPanel({
  workspaceId,
  path,
  onChanged,
}: {
  workspaceId: number;
  path: string;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const [rows, setRows] = useState<AclRow[]>([]);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const [kind, setKind] = useState<"user" | "role">("user");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("viewer");
  const [level, setLevel] = useState(1);
  const [inherit, setInherit] = useState(true);

  const load = useCallback(async () => {
    setErr("");
    try {
      const res = await listAcl(workspaceId, path);
      setRows(res.items ?? []);
    } catch (e) {
      setErr(messageOf(e, t("common.error")));
    }
  }, [workspaceId, path, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setBusy(true);
      setNotice("");
      try {
        if (kind === "user") {
          await setAcl(workspaceId, { path, kind: "user", email: email.trim(), level, inherit: inherit ? 1 : 0 });
        } else {
          await setAcl(workspaceId, { path, kind: "role", role, level, inherit: inherit ? 1 : 0 });
        }
        setEmail("");
        setNotice(t("ws.share_added"));
        await load();
        onChanged();
      } catch (e) {
        setErr(messageOf(e, t("common.error")));
      } finally {
        setBusy(false);
      }
    },
    [kind, email, role, level, inherit, workspaceId, path, load, onChanged, t],
  );

  const remove = useCallback(
    async (row: AclRow) => {
      const subj = subjectOf(t, row);
      if (!window.confirm(t("ws.share_confirm_remove").replace("{subject}", subj))) return;
      setBusy(true);
      setNotice("");
      try {
        await deleteAcl(workspaceId, row.id);
        setNotice(t("ws.share_removed"));
        await load();
        onChanged();
      } catch (e) {
        setErr(messageOf(e, t("common.error")));
      } finally {
        setBusy(false);
      }
    },
    [workspaceId, load, onChanged, t],
  );

  return (
    <>
      <p className="muted small">{t("ws.share_hint")}</p>
      {err ? <p className="err">{err}</p> : null}
      {notice ? <p className="ok">{notice}</p> : null}

      {rows.length === 0 ? (
        <p className="muted small">{t("ws.share_empty")}</p>
      ) : (
        <table className="table compact">
          <thead>
            <tr>
              <th>{t("ws.share_subject")}</th>
              <th>{t("ws.share_level")}</th>
              <th>{t("ws.share_inherit")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  {row.kind === "user" ? (
                    <span title={row.subject_email || `user #${row.subject_user_id}`}>
                      {row.subject_name || row.subject_email || `#${row.subject_user_id}`}
                    </span>
                  ) : (
                    t(`ws.role_${row.subject_role}`)
                  )}
                </td>
                <td>{t(`ws.acl_level_${row.level}`)}</td>
                <td>{row.inherit ? t("ws.acl_inherit_yes") : t("ws.acl_inherit_no")}</td>
                <td>
                  <button type="button" className="btn danger sm" disabled={busy} onClick={() => void remove(row)}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form className="share-form" onSubmit={submit}>
        <div className="share-kind">
          <label>
            <input type="radio" name="acl-kind" checked={kind === "user"} onChange={() => setKind("user")} />{" "}
            {t("ws.share_user")}
          </label>
          <label>
            <input type="radio" name="acl-kind" checked={kind === "role"} onChange={() => setKind("role")} />{" "}
            {t("ws.share_role")}
          </label>
        </div>

        {kind === "user" ? (
          <input
            type="email"
            required
            placeholder={t("ws.share_email")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        ) : (
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="viewer">{t("ws.role_viewer")}</option>
            <option value="editor">{t("ws.role_editor")}</option>
            <option value="owner">{t("ws.role_owner")}</option>
          </select>
        )}

        <select value={level} onChange={(e) => setLevel(Number(e.target.value))}>
          <option value={0}>{t("ws.acl_level_0")}</option>
          <option value={1}>{t("ws.acl_level_1")}</option>
          <option value={2}>{t("ws.acl_level_2")}</option>
          <option value={3}>{t("ws.acl_level_3")}</option>
        </select>

        <label className="share-inherit">
          <input type="checkbox" checked={inherit} onChange={(e) => setInherit(e.target.checked)} />{" "}
          {t("ws.share_inherit")}
        </label>

        <button type="submit" className="btn" disabled={busy}>
          {t("ws.share_add")}
        </button>
      </form>
    </>
  );
}

// ---------- публични линкове (Фаза 3) ----------

// Абсолютният URL, който да се покаже/копира. Сървърът връща готов URL с
// SECP_PUBLIC_URL, но той може да сочи към backend (различен хост в dev), а
// не към приложението, което потребителят вижда. Затова строим от текущия
// origin + токена, а сървърния URL е само резерва.
function absoluteShareUrl(url: string, token: string): string {
  if (token && typeof window !== "undefined") {
    return `${window.location.origin}/share/${token}`;
  }
  if (!url) return "";
  try {
    const u = new URL(url);
    if (typeof window !== "undefined") {
      return `${window.location.origin}/share/${u.pathname.split("/").filter(Boolean).pop() ?? ""}`;
    }
    return url;
  } catch {
    return url;
  }
}

function LinksPanel({
  workspaceId,
  path,
  isDir,
  onChanged,
}: {
  workspaceId: number;
  path: string;
  isDir: number;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const [rows, setRows] = useState<ShareLink[]>([]);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<ShareLink | null>(null);

  const [level, setLevel] = useState(1);
  const [expiresH, setExpiresH] = useState(168);
  const [maxDownloads, setMaxDownloads] = useState(0);
  const [password, setPassword] = useState("");

  const load = useCallback(async () => {
    setErr("");
    try {
      const res = await listShares(workspaceId, path);
      setRows(res.items ?? []);
    } catch (e) {
      setErr(messageOf(e, t("common.error")));
    }
  }, [workspaceId, path, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setBusy(true);
      setNotice("");
      setFresh(null);
      try {
        const link = await createShare(workspaceId, {
          path,
          level,
          expires_h: expiresH,
          max_downloads: maxDownloads,
          password: password ? password : undefined,
        });
        setFresh(link);
        setPassword("");
        await load();
        onChanged();
      } catch (e) {
        setErr(messageOf(e, t("common.error")));
      } finally {
        setBusy(false);
      }
    },
    [workspaceId, path, level, expiresH, maxDownloads, password, load, onChanged, t],
  );

  const revoke = useCallback(
    async (row: ShareLink) => {
      if (!window.confirm(t("ws.share_link_confirm_revoke"))) return;
      setBusy(true);
      try {
        await revokeShare(workspaceId, row.id);
        setNotice(t("ws.share_link_revoked"));
        setFresh(null);
        await load();
        onChanged();
      } catch (e) {
        setErr(messageOf(e, t("common.error")));
      } finally {
        setBusy(false);
      }
    },
    [workspaceId, load, onChanged, t],
  );

  const copy = useCallback(
    async (url: string) => {
      try {
        await navigator.clipboard.writeText(url);
        setNotice(t("ws.share_link_copied"));
      } catch {
        setErr(t("ws.share_link_copy_failed"));
      }
    },
    [t],
  );

  const freshUrl = fresh ? absoluteShareUrl(fresh.url ?? "", fresh.token ?? "") : "";

  return (
    <>
      <p className="muted small">{t("ws.share_link_hint")}</p>
      {err ? <p className="err">{err}</p> : null}
      {notice ? <p className="ok">{notice}</p> : null}

      {freshUrl ? (
        <div className="share-fresh">
          <p className="small">{t("ws.share_link_created")}</p>
          <div className="share-copy">
            <input readOnly value={freshUrl} onFocus={(e) => e.currentTarget.select()} />
            <button type="button" className="btn sm" onClick={() => void copy(freshUrl)}>
              {t("ws.share_link_copy")}
            </button>
          </div>
          <p className="muted small">{t("ws.share_link_once")}</p>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <p className="muted small">{t("ws.share_link_empty")}</p>
      ) : (
        <table className="table compact">
          <thead>
            <tr>
              <th>{t("ws.share_link_level")}</th>
              <th>{t("ws.share_link_expires")}</th>
              <th>{t("ws.share_link_downloads")}</th>
              <th>{t("ws.share_link_password")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const dead = row.revoked_at > 0;
              return (
                <tr key={row.id} className={dead ? "muted" : ""}>
                  <td>{t(`ws.share_level_${row.level}`)}</td>
                  <td>
                    {row.expires_at > 0 ? (
                      <span title={new Date(row.expires_at * 1000).toLocaleString()}>
                        {new Date(row.expires_at * 1000).toLocaleDateString()}
                      </span>
                    ) : (
                      t("ws.share_link_never")
                    )}
                  </td>
                  <td>
                    {row.max_downloads > 0
                      ? `${row.downloads} / ${row.max_downloads}`
                      : `${row.downloads}`}
                  </td>
                  <td>{row.has_password ? "•••" : "—"}</td>
                  <td>
                    {dead ? (
                      <span className="muted small">{t("ws.share_link_is_revoked")}</span>
                    ) : (
                      <button type="button" className="btn danger sm" disabled={busy} onClick={() => void revoke(row)}>
                        {t("ws.share_link_revoke")}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <form className="share-form" onSubmit={submit}>
        {/* Ниво 2 (качване) е смисъл само за папка — сървърът отказва за файл. */}
        {isDir ? (
          <select value={level} onChange={(e) => setLevel(Number(e.target.value))}>
            <option value={1}>{t("ws.share_level_1")}</option>
            <option value={2}>{t("ws.share_level_2")}</option>
          </select>
        ) : (
          <select value={1} disabled>
            <option value={1}>{t("ws.share_level_1")}</option>
          </select>
        )}

        <label className="share-field">
          {t("ws.share_link_expires_h")}
          <input
            type="number"
            min={0}
            value={expiresH}
            onChange={(e) => setExpiresH(Math.max(0, Number(e.target.value) || 0))}
          />
        </label>

        <label className="share-field">
          {t("ws.share_link_max_dl")}
          <input
            type="number"
            min={0}
            value={maxDownloads}
            onChange={(e) => setMaxDownloads(Math.max(0, Number(e.target.value) || 0))}
          />
        </label>

        <input
          type="text"
          placeholder={t("ws.share_link_pass_ph")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <button type="submit" className="btn" disabled={busy}>
          {t("ws.share_link_create")}
        </button>
      </form>
    </>
  );
}
