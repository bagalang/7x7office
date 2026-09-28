"use client";

import { FormEvent, useEffect, useState } from "react";
import { RequireAuth } from "../../components/RequireAuth";
import { AppShell } from "../../components/AppShell";
import { useI18n } from "../../components/I18nProvider";
import { api, setToken } from "../../lib/api";
import { messageOf } from "../../components/FileBrowser";

type Me = { sub?: string; username?: string; email?: string; totp_enabled?: number };
type AccountSaved = { username?: string; email?: string; access_token?: string };
type TotpStart = { secret: string; uri: string; recovery_codes: string[] };
type DavFolder = { url?: string; user?: string; has_key?: number; prefix?: string; key?: string };

function ProfileScreen() {
  const { t } = useI18n();
  const [me, setMe] = useState<Me | null>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [next2, setNext2] = useState("");
  const [totp, setTotp] = useState<TotpStart | null>(null);
  const [code, setCode] = useState("");
  const [offPass, setOffPass] = useState("");
  const [offCode, setOffCode] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"account" | "password" | "totp" | "dav">("account");
  const [username, setUsername] = useState("");
  const [mail, setMail] = useState("");
  const [accountPass, setAccountPass] = useState("");
  const [dav, setDav] = useState<DavFolder | null>(null);
  const [davKey, setDavKey] = useState("");

  useEffect(() => {
    let cancel = false;
    Promise.all([api.get<Me>("/v1/me"), api.get<DavFolder>("/v1/me/dav")])
      .then(([who, folder]) => {
        if (cancel) return;
        setMe(who);
        setUsername(who.username || "");
        setMail(who.email || who.sub || "");
        setDav(folder);
      })
      .catch((err) => {
        if (!cancel) setError(messageOf(err, t("common.error")));
      });
    return () => {
      cancel = true;
    };
  }, [t]);

  function flash(msg: string) {
    setError("");
    setNote(msg);
  }

  async function onAccount(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const row = await api.post<AccountSaved>("/v1/me/account", {
        username: username.trim(),
        email: mail.trim(),
        current: accountPass,
      });
      if (row.access_token) setToken(row.access_token);
      setAccountPass("");
      setMe((m) => (m ? { ...m, username: row.username, email: row.email, sub: row.username || m.sub } : m));
      if (row.username) setUsername(row.username);
      if (row.email) setMail(row.email);
      flash(t("profile.account_ok"));
    } catch (err) {
      setNote("");
      setError(messageOf(err, t("common.error")));
    } finally {
      setBusy(false);
    }
  }

  async function onPassword(e: FormEvent) {
    e.preventDefault();
    if (next !== next2) {
      setNote("");
      setError(t("profile.mismatch"));
      return;
    }
    if (next.length < 8) {
      setNote("");
      setError(t("profile.short"));
      return;
    }
    setBusy(true);
    try {
      await api.post("/v1/me/password", { current, password: next });
      setCurrent("");
      setNext("");
      setNext2("");
      flash(t("profile.password_ok"));
    } catch (err) {
      setNote("");
      setError(messageOf(err, t("common.error")));
    } finally {
      setBusy(false);
    }
  }

  async function startTotp() {
    setBusy(true);
    try {
      const row = await api.post<TotpStart>("/v1/me/totp/start");
      setTotp(row);
      setCode("");
      flash("");
    } catch (err) {
      setNote("");
      setError(messageOf(err, t("common.error")));
    } finally {
      setBusy(false);
    }
  }

  async function confirmTotp(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/v1/me/totp/confirm", { code });
      setTotp(null);
      setCode("");
      setMe((m) => (m ? { ...m, totp_enabled: 1 } : m));
      flash(t("profile.totp_ok"));
    } catch (err) {
      setNote("");
      setError(messageOf(err, t("common.error")));
    } finally {
      setBusy(false);
    }
  }

  async function disableTotp(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/v1/me/totp/disable", { password: offPass, code: offCode });
      setOffPass("");
      setOffCode("");
      setMe((m) => (m ? { ...m, totp_enabled: 0 } : m));
      flash(t("profile.totp_off_ok"));
    } catch (err) {
      setNote("");
      setError(messageOf(err, t("common.error")));
    } finally {
      setBusy(false);
    }
  }

  async function mintDav() {
    setBusy(true);
    try {
      const row = await api.post<DavFolder>("/v1/me/dav");
      setDav(row);
      setDavKey(row.key || "");
      flash("");
    } catch (err) {
      setNote("");
      setError(messageOf(err, t("common.error")));
    } finally {
      setBusy(false);
    }
  }

  const email = me?.username || me?.email || me?.sub || "";
  const totpOn = me?.totp_enabled === 1;
  const tabs = [
    ["account", "profile.tab_account"],
    ["password", "profile.tab_password"],
    ["totp", "profile.tab_totp"],
    ["dav", "profile.tab_dav"],
  ] as const;

  function openTab(id: "account" | "password" | "totp" | "dav") {
    setTab(id);
    setError("");
    setNote("");
  }

  return (
    <main className="content-main">
      <div className="page-head">
        <h1>{t("profile.title")}</h1>
      </div>
      <p className="muted">{email || t("profile.hint")}</p>
      <div className="share-tabs profile-tabs" role="tablist">
        {tabs.map(([id, key]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`btn ghost sm${tab === id ? " active" : ""}`}
            onClick={() => openTab(id)}
          >
            {t(key)}
          </button>
        ))}
      </div>
      {error ? <p className="err">{error}</p> : null}
      {note ? <p className="muted">{note}</p> : null}

      {tab === "account" ? (
        <section className="settings-block">
          <h2>{t("profile.tab_account")}</h2>
          <p className="muted small">{t("profile.account_hint")}</p>
          <form onSubmit={onAccount}>
            <div className="settings-grid">
              <div className="field">
                <label htmlFor="ac-user">{t("profile.username")}</label>
                <input id="ac-user" className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="ac-mail">{t("profile.email")}</label>
                <input id="ac-mail" className="input" type="email" autoComplete="email" value={mail} onChange={(e) => setMail(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="ac-pass">{t("profile.current")}</label>
                <input id="ac-pass" className="input" type="password" autoComplete="current-password" value={accountPass} onChange={(e) => setAccountPass(e.target.value)} />
              </div>
            </div>
            <button type="submit" className="btn" disabled={busy} style={{ marginTop: 4 }}>{t("profile.account_save")}</button>
          </form>
        </section>
      ) : null}

      {tab === "password" ? (
      <form className="settings-block" onSubmit={onPassword}>
        <h2>{t("profile.password")}</h2>
        <p className="muted small">{t("profile.password_hint")}</p>
        <div className="settings-grid">
          <div className="field">
            <label htmlFor="pw-current">{t("profile.current")}</label>
            <input id="pw-current" className="input" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="pw-new">{t("profile.new")}</label>
            <input id="pw-new" className="input" type="password" autoComplete="new-password" required minLength={8} value={next} onChange={(e) => setNext(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="pw-new2">{t("profile.new2")}</label>
            <input id="pw-new2" className="input" type="password" autoComplete="new-password" required minLength={8} value={next2} onChange={(e) => setNext2(e.target.value)} />
          </div>
        </div>
        <button type="submit" className="btn" disabled={busy}>{t("profile.password_save")}</button>
      </form>
      ) : null}

      {tab === "totp" ? (
      <section className="settings-block">
        <h2>{t("profile.totp")}</h2>
        <p className="muted small">{t("profile.totp_hint")}</p>
        <p>{totpOn ? t("profile.totp_on") : t("profile.totp_off")}</p>
        {totpOn ? (
          <form onSubmit={disableTotp}>
            <p className="muted small">{t("profile.totp_disable_hint")}</p>
            <div className="settings-grid">
              <div className="field">
                <label htmlFor="off-pass">{t("profile.current")}</label>
                <input id="off-pass" className="input" type="password" autoComplete="current-password" required value={offPass} onChange={(e) => setOffPass(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="off-code">{t("profile.totp_code")}</label>
                <input id="off-code" className="input" autoComplete="one-time-code" required value={offCode} onChange={(e) => setOffCode(e.target.value)} />
              </div>
            </div>
            <button type="submit" className="btn danger" disabled={busy}>{t("profile.totp_disable")}</button>
          </form>
        ) : (
          <>
            {totp ? (
              <form onSubmit={confirmTotp}>
                <div className="field">
                  <label htmlFor="totp-secret">{t("profile.totp_secret")}</label>
                  <input id="totp-secret" className="input" readOnly value={totp.secret} />
                </div>
                <div className="field">
                  <label htmlFor="totp-uri">{t("profile.totp_uri")}</label>
                  <input id="totp-uri" className="input" readOnly value={totp.uri} />
                </div>
                <p className="muted small">{t("profile.totp_recovery_hint")}</p>
                <div className="code-list">
                  {totp.recovery_codes.map((c) => (
                    <div key={c}>{c}</div>
                  ))}
                </div>
                <div className="field">
                  <label htmlFor="totp-code">{t("profile.totp_code")}</label>
                  <input id="totp-code" className="input" inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} />
                </div>
                <button type="submit" className="btn" disabled={busy}>{t("profile.totp_confirm")}</button>
              </form>
            ) : (
              <button type="button" className="btn" disabled={busy} onClick={startTotp}>{t("profile.totp_start")}</button>
            )}
          </>
        )}
      </section>
      ) : null}

      {tab === "dav" ? (
      <section className="settings-block">
        <h2>{t("profile.dav")}</h2>
        <p className="muted small">{t("profile.dav_hint")}</p>
        <div className="field">
          <label htmlFor="dav-url">{t("profile.dav_url")}</label>
          <input id="dav-url" className="input" readOnly value={dav?.url || ""} />
        </div>
        <div className="field">
          <label htmlFor="dav-user">{t("profile.dav_user")}</label>
          <input id="dav-user" className="input" readOnly value={dav?.user || email} />
        </div>
        {davKey ? (
          <>
            <p className="muted small">{t("profile.dav_once")}</p>
            <div className="field">
              <label htmlFor="dav-key">{t("profile.dav_key")}</label>
              <input id="dav-key" className="input" readOnly value={davKey} />
            </div>
          </>
        ) : dav?.has_key === 1 ? (
          <p className="muted small">{t("profile.dav_has")} {dav.prefix}…</p>
        ) : (
          <p className="muted small">{t("profile.dav_none")}</p>
        )}
        <button type="button" className="btn" disabled={busy} onClick={mintDav}>
          {dav?.has_key === 1 || davKey ? t("profile.dav_renew") : t("profile.dav_make")}
        </button>
      </section>
      ) : null}
    </main>
  );
}

export default function ProfilePage() {
  return (
    <RequireAuth>
      <AppShell>
        <ProfileScreen />
      </AppShell>
    </RequireAuth>
  );
}
