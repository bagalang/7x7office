"use client";

import { FormEvent, useEffect, useState } from "react";
import { RequireAuth } from "../../components/RequireAuth";
import { AppShell } from "../../components/AppShell";
import { Dialog } from "../../components/Dialog";
import { useI18n } from "../../components/I18nProvider";
import { IconPlus } from "../../components/icons";
import { ApiError, api } from "../../lib/api";

type Me = { sub?: string; is_admin?: number; name?: string };
type UserRow = { id: number; email: string; name: string; is_admin: number };
type UserList = { items: UserRow[]; count: number };

const AVATAR_COLORS = ["#1a73e8", "#188038", "#e37400", "#9334e6", "#d93025", "#0b8043"];

function colorOf(email: string): string {
  let h = 0;
  for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function initialsOf(email: string, name: string): string {
  const src = name || email.split("@")[0] || "";
  const parts = src.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : src.slice(0, 2);
  return letters.toUpperCase() || "?";
}

function messageOf(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

function UsersScreen() {
  const { t } = useI18n();
  const [me, setMe] = useState<Me | null>(null);
  const [rows, setRows] = useState<UserRow[]>([]);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [admin, setAdmin] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setBusy(true);
      setError("");
      try {
        const who = await api.get<Me>("/v1/me");
        if (cancel) return;
        setMe(who);
        if (who.is_admin !== 1) {
          setBusy(false);
          return;
        }
        const list = await api.get<UserList>("/v1/users");
        if (cancel) return;
        setRows(list.items ?? []);
      } catch (err) {
        if (!cancel) setError(messageOf(err, t("common.error")));
      } finally {
        if (!cancel) setBusy(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [reload, t]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.post("/v1/users", {
        email,
        name,
        password,
        is_admin: admin,
      });
      setEmail("");
      setName("");
      setPassword("");
      setAdmin(false);
      setCreateOpen(false);
      setReload((n) => n + 1);
    } catch (err) {
      setError(messageOf(err, t("common.error")));
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <main className="content-main">
        <div className="page-head">
          <h1>{t("users.title")}</h1>
          <span className="grow" />
          {me?.is_admin === 1 ? (
            <button type="button" className="btn" onClick={() => setCreateOpen(true)}>
              <IconPlus width={16} height={16} />
              {t("users.new")}
            </button>
          ) : null}
        </div>

        {me && me.is_admin !== 1 ? <p className="err">{t("users.admin_only")}</p> : null}
        {error ? <p className="err">{error}</p> : null}
        {busy ? <p className="muted">{t("common.loading")}</p> : null}

        {me?.is_admin === 1 ? (
          <table className="table">
            <thead>
              <tr>
                <th>{t("users.col_email")}</th>
                <th style={{ width: 220 }}>{t("users.col_name")}</th>
                <th style={{ width: 140 }}>{t("users.col_role")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} style={{ cursor: "default" }}>
                  <td>
                    <span className="cell-name">
                      <span className="avatar" style={{ background: colorOf(row.email), cursor: "default" }}>
                        {initialsOf(row.email, row.name)}
                      </span>
                      <span className="label">{row.email}</span>
                    </span>
                  </td>
                  <td className={row.name ? "" : "muted"}>{row.name || "—"}</td>
                  <td>
                    <span className={`badge${row.is_admin === 1 ? " admin" : ""}`}>
                      {row.is_admin === 1 ? t("users.role_admin") : t("users.role_user")}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </main>

      {createOpen ? (
        <Dialog title={t("users.new")} onClose={() => setCreateOpen(false)}>
          <form onSubmit={onCreate}>
            <div className="field">
              <label htmlFor="u-email">{t("users.col_email")}</label>
              <input
                id="u-email"
                className="input"
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="u-name">{t("common.name")}</label>
              <input
                id="u-name"
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="u-pass">{t("users.password")}</label>
              <input
                id="u-pass"
                className="input"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <label className="check">
              <input type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} />
              {t("users.admin_check")}
            </label>
            <div className="dialog-actions">
              <button type="button" className="btn ghost" onClick={() => setCreateOpen(false)}>
                {t("common.cancel")}
              </button>
              <button type="submit" className="btn" disabled={busy}>
                {t("common.create")}
              </button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </AppShell>
  );
}

export default function UsersPage() {
  return (
    <RequireAuth>
      <UsersScreen />
    </RequireAuth>
  );
}
