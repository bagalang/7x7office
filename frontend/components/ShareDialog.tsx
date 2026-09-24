"use client";

// ShareDialog — изрични права върху файл/папка (Фаза 2, ACL).
//
// Показва се само за owner/admin на ЕКИПНО пространство (личният не се
// споделя — сървърът връща 409, тук просто не отваряме). Защо диалог, а не
// отделна страница: правата се гледат винаги в контекста на конкретен път,
// а пътят се избира в браузъра — така „Споделяне" стои до името на файла.
//
// Редът може да е за потребител (по имейл) или за роля в пространството.
// `level` 0..3 = нищо/четене/запис/споделяне; `inherit` = важи ли и за
// подпапките. Сървърът пази най-специфичния печели — тук само подаваме.

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Dialog } from "./Dialog";
import { useI18n } from "./I18nProvider";
import { useWorkspace } from "./WorkspaceProvider";
import { AclRow, ApiError, deleteAcl, listAcl, setAcl } from "../lib/api";

function messageOf(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

function subjectOf(t: (k: string) => string, row: AclRow): string {
  if (row.kind === "user") {
    return row.subject_name || row.subject_email || `#${row.subject_user_id}`;
  }
  const key = `ws.role_${row.subject_role}`;
  const label = t(key);
  return label === key ? row.subject_role : label;
}

export function ShareDialog({
  workspaceId,
  path,
  onClose,
}: {
  workspaceId: number;
  path: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { reload } = useWorkspace();
  const [rows, setRows] = useState<AclRow[]>([]);
  const [loadErr, setLoadErr] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const [kind, setKind] = useState<"user" | "role">("user");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("viewer");
  const [level, setLevel] = useState(1);
  const [inherit, setInherit] = useState(true);

  const load = useCallback(async () => {
    setLoadErr("");
    try {
      const res = await listAcl(workspaceId, path);
      setRows(res.items ?? []);
    } catch (err) {
      setLoadErr(messageOf(err, t("common.error")));
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
          await setAcl(workspaceId, {
            path,
            kind: "user",
            email: email.trim(),
            level,
            inherit: inherit ? 1 : 0,
          });
        } else {
          await setAcl(workspaceId, {
            path,
            kind: "role",
            role,
            level,
            inherit: inherit ? 1 : 0,
          });
        }
        setEmail("");
        setNotice(t("ws.share_added"));
        await load();
        // Правата може да променят write-а на текущия потребител — караме
        // контекста да презареди, за да не остане UI-ът с грешни бутони.
        reload();
      } catch (err) {
        setLoadErr(messageOf(err, t("common.error")));
      } finally {
        setBusy(false);
      }
    },
    [kind, email, role, level, inherit, workspaceId, path, load, reload, t],
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
        reload();
      } catch (err) {
        setLoadErr(messageOf(err, t("common.error")));
      } finally {
        setBusy(false);
      }
    },
    [workspaceId, load, reload, t],
  );

  return (
    <Dialog title={t("ws.share_title").replace("{path}", path)} onClose={onClose}>
      <p className="muted small">{t("ws.share_hint")}</p>

      {loadErr ? <p className="err">{loadErr}</p> : null}
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
                  <button
                    type="button"
                    className="btn danger sm"
                    disabled={busy}
                    onClick={() => void remove(row)}
                  >
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
            <input
              type="radio"
              name="acl-kind"
              checked={kind === "user"}
              onChange={() => setKind("user")}
            />{" "}
            {t("ws.share_user")}
          </label>
          <label>
            <input
              type="radio"
              name="acl-kind"
              checked={kind === "role"}
              onChange={() => setKind("role")}
            />{" "}
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
          <input
            type="checkbox"
            checked={inherit}
            onChange={(e) => setInherit(e.target.checked)}
          />{" "}
          {t("ws.share_inherit")}
        </label>

        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t("common.close")}
          </button>
          <button type="submit" className="btn" disabled={busy}>
            {t("ws.share_add")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
