"use client";

// /workspaces — работни пространства и членове (Фаза 2).
//
// Защо страница, а не само избор в горния бар: пространството носи роли,
// а ролите се управляват рядко. Тук е и мястото, където се вижда кой има
// достъп — иначе „защо Иван не вижда файла" се гадае.
//
// Личното пространство е само за четене в този екран: то не се трие, не
// се преименува и не приема членове (сървърът го пази, тук просто не
// показваме бутоните, за да не подвеждаме).

import { FormEvent, useCallback, useEffect, useState } from "react";
import { RequireAuth } from "../../components/RequireAuth";
import { AppShell } from "../../components/AppShell";
import { Dialog } from "../../components/Dialog";
import { useI18n } from "../../components/I18nProvider";
import { IconPlus } from "../../components/icons";
import {
  ApiError,
  Member,
  Workspace,
  addMember,
  api,
  createWorkspace,
  deleteWorkspace,
  listMembers,
  listWorkspaces,
  removeMember,
  updateMember,
  updateWorkspace,
} from "../../lib/api";

type Me = { sub?: string; is_admin?: number };

function messageOf(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

function roleLabel(t: (k: string) => string, role: string): string {
  if (role === "owner") return t("ws.role_owner");
  if (role === "editor") return t("ws.role_editor");
  if (role === "viewer") return t("ws.role_viewer");
  if (role === "admin") return t("ws.role_admin");
  return role;
}

function WorkspacesScreen() {
  const { t } = useI18n();
  const [me, setMe] = useState<Me | null>(null);
  const [rows, setRows] = useState<Workspace[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);

  // create / rename диалози
  const [createOpen, setCreateOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [desc, setDesc] = useState("");
  const [editing, setEditing] = useState<Workspace | null>(null);

  // членове
  const [membersOf, setMembersOf] = useState<Workspace | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [mEmail, setMEmail] = useState("");
  const [mRole, setMRole] = useState("viewer");
  const [mBusy, setMBusy] = useState(false);
  const [mError, setMError] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const who = await api.get<Me>("/v1/me");
      setMe(who);
      const list = await listWorkspaces();
      setRows(list.items ?? []);
    } catch (err) {
      setError(messageOf(err, t("common.error")));
    } finally {
      setBusy(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load, reload]);

  // отворен диалог за членове → всеки път презареждаме, за да не показва
  // stale роли след PATCH
  useEffect(() => {
    if (!membersOf) return;
    let cancel = false;
    setMBusy(true);
    setMError("");
    listMembers(membersOf.id)
      .then((list) => {
        if (!cancel) setMembers(list.items ?? []);
      })
      .catch((err) => {
        if (!cancel) setMError(messageOf(err, t("common.error")));
      })
      .finally(() => {
        if (!cancel) setMBusy(false);
      });
    return () => {
      cancel = true;
    };
  }, [membersOf, reload, t]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await createWorkspace(label.trim(), desc.trim());
      setLabel("");
      setDesc("");
      setCreateOpen(false);
      setNotice(t("ws.created"));
      setReload((n) => n + 1);
    } catch (err) {
      setError(messageOf(err, t("common.error")));
      setBusy(false);
    }
  }

  async function onRename(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    setError("");
    try {
      await updateWorkspace(editing.id, label.trim(), desc.trim());
      setEditing(null);
      setNotice(t("ws.saved"));
      setReload((n) => n + 1);
    } catch (err) {
      setError(messageOf(err, t("common.error")));
      setBusy(false);
    }
  }

  async function onDelete(ws: Workspace) {
    if (!window.confirm(t("ws.delete_confirm", { label: ws.label }))) return;
    setError("");
    try {
      await deleteWorkspace(ws.id);
      setNotice(t("ws.deleted"));
      setReload((n) => n + 1);
    } catch (err) {
      setError(messageOf(err, t("common.error")));
    }
  }

  async function onAddMember(e: FormEvent) {
    e.preventDefault();
    if (!membersOf) return;
    setMBusy(true);
    setMError("");
    try {
      await addMember(membersOf.id, mEmail.trim(), mRole);
      setMEmail("");
      setMRole("viewer");
      const list = await listMembers(membersOf.id);
      setMembers(list.items ?? []);
      setNotice(t("ws.member_added"));
    } catch (err) {
      setMError(messageOf(err, t("common.error")));
    } finally {
      setMBusy(false);
    }
  }

  async function onChangeRole(m: Member, role: string) {
    if (!membersOf) return;
    setMError("");
    try {
      await updateMember(membersOf.id, m.member_id, role);
      const list = await listMembers(membersOf.id);
      setMembers(list.items ?? []);
      setNotice(t("ws.member_updated"));
    } catch (err) {
      setMError(messageOf(err, t("common.error")));
    }
  }

  async function onRemoveMember(m: Member) {
    if (!membersOf) return;
    if (!window.confirm(t("ws.member_confirm_remove", { email: m.email }))) return;
    setMError("");
    try {
      await removeMember(membersOf.id, m.member_id);
      const list = await listMembers(membersOf.id);
      setMembers(list.items ?? []);
      setNotice(t("ws.member_removed"));
    } catch (err) {
      setMError(messageOf(err, t("common.error")));
    }
  }

  // Управлява owner или админ. Админът минава и когато е член с по-ниска
  // роля — сървърът го допуска (ws_access дава ниво admin), затова UI-ът
  // не бива да крие бутони, които сървърът ще изпълни.
  function canManage(ws: Workspace): boolean {
    return ws.role === "owner" || ws.role === "admin" || me?.is_admin === 1;
  }

  return (
    <AppShell>
      <main className="content-main">
        <div className="page-head">
          <h1>{t("ws.title")}</h1>
          <span className="grow" />
          <button type="button" className="btn" onClick={() => setCreateOpen(true)}>
            <IconPlus width={16} height={16} />
            {t("ws.new")}
          </button>
        </div>

        <p className="muted">{t("ws.hint")}</p>
        {error ? <p className="err">{error}</p> : null}
        {notice ? <p className="ok">{notice}</p> : null}
        {busy && rows.length === 0 ? <p className="muted">{t("common.loading")}</p> : null}
        {!busy && rows.length === 0 ? <p className="muted">{t("ws.empty")}</p> : null}

        {rows.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>{t("ws.col_label")}</th>
                <th style={{ width: 160 }}>{t("ws.col_role")}</th>
                <th style={{ width: 260 }}>{t("ws.col_actions")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((ws) => (
                <tr key={ws.id} style={{ cursor: "default" }}>
                  <td>
                    <span className="cell-name">
                      <span className="label">{ws.label}</span>
                      {ws.is_personal === 1 ? <span className="badge">{t("ws.personal")}</span> : null}
                    </span>
                    {ws.description ? <span className="muted block">{ws.description}</span> : null}
                  </td>
                  <td>
                    <span className={`badge${canManage(ws) ? " admin" : ""}`}>{roleLabel(t, ws.role)}</span>
                  </td>
                  <td>
                    <span className="row-actions">
                      <button
                        type="button"
                        className="btn ghost sm"
                        onClick={() => {
                          setMembersOf(ws);
                          setMError("");
                          setMEmail("");
                          setMRole("viewer");
                        }}
                      >
                        {t("ws.manage")}
                      </button>
                      {canManage(ws) && ws.is_personal === 0 ? (
                        <button
                          type="button"
                          className="btn ghost sm"
                          onClick={() => {
                            setEditing(ws);
                            setLabel(ws.label);
                            setDesc(ws.description);
                          }}
                        >
                          {t("ws.rename")}
                        </button>
                      ) : null}
                      {canManage(ws) && ws.is_personal === 0 ? (
                        <button type="button" className="btn ghost sm danger" onClick={() => void onDelete(ws)}>
                          {t("common.delete")}
                        </button>
                      ) : null}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </main>

      {createOpen ? (
        <Dialog title={t("ws.new")} onClose={() => setCreateOpen(false)}>
          <form onSubmit={onCreate}>
            <div className="field">
              <label htmlFor="ws-label">{t("ws.new_label")}</label>
              <input
                id="ws-label"
                className="input"
                required
                maxLength={200}
                autoFocus
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="ws-desc">{t("ws.new_desc")}</label>
              <input
                id="ws-desc"
                className="input"
                maxLength={1000}
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
              />
            </div>
            <div className="dialog-actions">
              <button type="button" className="btn ghost" onClick={() => setCreateOpen(false)}>
                {t("common.cancel")}
              </button>
              <button type="submit" className="btn" disabled={busy || label.trim() === ""}>
                {t("common.create")}
              </button>
            </div>
          </form>
        </Dialog>
      ) : null}

      {editing ? (
        <Dialog title={t("ws.rename")} onClose={() => setEditing(null)}>
          <form onSubmit={onRename}>
            <div className="field">
              <label htmlFor="ws-rename">{t("ws.new_label")}</label>
              <input
                id="ws-rename"
                className="input"
                required
                maxLength={200}
                autoFocus
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="ws-desc2">{t("ws.new_desc")}</label>
              <input
                id="ws-desc2"
                className="input"
                maxLength={1000}
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
              />
            </div>
            <div className="dialog-actions">
              <button type="button" className="btn ghost" onClick={() => setEditing(null)}>
                {t("common.cancel")}
              </button>
              <button type="submit" className="btn" disabled={busy || label.trim() === ""}>
                {t("common.save")}
              </button>
            </div>
          </form>
        </Dialog>
      ) : null}

      {membersOf ? (
        <Dialog title={t("ws.members_title", { label: membersOf.label })} onClose={() => setMembersOf(null)}>
          <p className="muted">{t("ws.owner_hint")}</p>
          {mError ? <p className="err">{mError}</p> : null}
          {members.length === 0 && !mBusy ? <p className="muted">{t("ws.members_empty")}</p> : null}
          {members.length > 0 ? (
            <table className="table compact">
              <tbody>
                {members.map((m) => {
                  const isMe = me?.sub === m.email;
                  const canEdit = canManage(membersOf);
                  return (
                    <tr key={m.member_id} style={{ cursor: "default" }}>
                      <td>
                        <span className="label">{m.email}</span>
                        {isMe ? <span className="badge">{t("ws.you")}</span> : null}
                        {m.name ? <span className="muted block">{m.name}</span> : null}
                      </td>
                      <td style={{ width: 180 }}>
                        {canEdit && m.role !== "owner" ? (
                          <select
                            className="input"
                            value={m.role}
                            onChange={(e) => void onChangeRole(m, e.target.value)}
                          >
                            <option value="editor">{t("ws.role_editor")}</option>
                            <option value="viewer">{t("ws.role_viewer")}</option>
                          </select>
                        ) : (
                          <span className="badge">{roleLabel(t, m.role)}</span>
                        )}
                      </td>
                      <td style={{ width: 90 }}>
                        {canEdit ? (
                          <button
                            type="button"
                            className="btn ghost sm danger"
                            onClick={() => void onRemoveMember(m)}
                          >
                            {t("common.delete")}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : null}

          {canManage(membersOf) && membersOf.is_personal === 0 ? (
            <form onSubmit={onAddMember}>
              <div className="field">
                <label htmlFor="m-email">{t("ws.member_email")}</label>
                <input
                  id="m-email"
                  className="input"
                  type="email"
                  required
                  value={mEmail}
                  onChange={(e) => setMEmail(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="m-role">{t("ws.member_role")}</label>
                <select id="m-role" className="input" value={mRole} onChange={(e) => setMRole(e.target.value)}>
                  <option value="viewer">{t("ws.role_viewer")}</option>
                  <option value="editor">{t("ws.role_editor")}</option>
                </select>
              </div>
              <div className="dialog-actions">
                <button type="button" className="btn ghost" onClick={() => setMembersOf(null)}>
                  {t("common.close")}
                </button>
                <button type="submit" className="btn" disabled={mBusy || mEmail.trim() === ""}>
                  {t("ws.member_add")}
                </button>
              </div>
            </form>
          ) : (
            <div className="dialog-actions">
              <button type="button" className="btn ghost" onClick={() => setMembersOf(null)}>
                {t("common.close")}
              </button>
            </div>
          )}
        </Dialog>
      ) : null}
    </AppShell>
  );
}

export default function WorkspacesPage() {
  return (
    <RequireAuth>
      <WorkspacesScreen />
    </RequireAuth>
  );
}
