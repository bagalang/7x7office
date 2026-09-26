"use client";

import { FormEvent, useEffect, useState } from "react";
import { RequireAuth } from "../../components/RequireAuth";
import { AppShell } from "../../components/AppShell";
import { useI18n } from "../../components/I18nProvider";
import { api } from "../../lib/api";
import { messageOf } from "../../components/FileBrowser";

type Me = { sub?: string; email?: string; totp_enabled?: number };
type TotpStart = { secret: string; uri: string; recovery_codes: string[] };
type DavFolder = { url?: string; user?: string; has_key?: number; prefix?: string; key?: string };
type Storage = {
  enabled: number;
  provider: string;
  endpoint: string;
  bucket: string;
  region: string;
  access_key: string;
  secret_set: number;
};

const emptyStorage: Storage = {
  enabled: 0,
  provider: "b2",
  endpoint: "",
  bucket: "",
  region: "eu-central-003",
  access_key: "",
  secret_set: 0,
};

const presets: Record<string, { endpoint: string; region: string }> = {
  b2: { endpoint: "https://s3.eu-central-003.backblazeb2.com", region: "eu-central-003" },
  hetzner: { endpoint: "https://fsn1.your-objectstorage.com", region: "fsn1" },
  r2: { endpoint: "", region: "auto" },
  custom: { endpoint: "", region: "us-east-1" },
};

function ProfileScreen() {
  const { t } = useI18n();
  const [me, setMe] = useState<Me | null>(null);
  const [storage, setStorage] = useState<Storage>(emptyStorage);
  const [secret, setSecret] = useState("");
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
  const [tab, setTab] = useState<"password" | "totp" | "s3" | "dav">("password");
  const [dav, setDav] = useState<DavFolder | null>(null);
  const [davKey, setDavKey] = useState("");

  useEffect(() => {
    let cancel = false;
    Promise.all([api.get<Me>("/v1/me"), api.get<Storage>("/v1/me/storage"), api.get<DavFolder>("/v1/me/dav")])
      .then(([who, box, folder]) => {
        if (cancel) return;
        setMe(who);
        setStorage({ ...emptyStorage, ...box, provider: box.provider || "b2" });
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

  function pickProvider(id: string) {
    const preset = presets[id] ?? presets.custom;
    setStorage((s) => ({
      ...s,
      provider: id,
      endpoint: id === "custom" ? s.endpoint : preset.endpoint,
      region: id === "custom" ? s.region : preset.region,
    }));
  }

  async function onStorage(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const row = await api.put<Storage>("/v1/me/storage", {
        enabled: storage.enabled,
        provider: storage.provider,
        endpoint: storage.endpoint,
        bucket: storage.bucket,
        region: storage.region,
        access_key: storage.access_key,
        secret_key: secret,
      });
      setStorage({ ...emptyStorage, ...row, provider: row.provider || storage.provider });
      setSecret("");
      flash(t("profile.s3_ok"));
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

  async function checkStorage() {
    setBusy(true);
    try {
      await api.post("/v1/me/storage/check");
      flash(t("profile.s3_check_ok"));
    } catch (err) {
      setNote("");
      setError(messageOf(err, t("common.error")));
    } finally {
      setBusy(false);
    }
  }

  const email = me?.email || me?.sub || "";
  const totpOn = me?.totp_enabled === 1;
  const tabs = [
    ["password", "profile.tab_password"],
    ["totp", "profile.tab_totp"],
    ["s3", "profile.tab_s3"],
    ["dav", "profile.tab_dav"],
  ] as const;

  function openTab(id: "password" | "totp" | "s3" | "dav") {
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

      {tab === "s3" ? (
      <form className="settings-block" onSubmit={onStorage}>
        <h2>{t("profile.s3")}</h2>
        <p className="muted small">{t("profile.s3_hint")}</p>
        <p className="muted small">{t("profile.s3_where")} {t("profile.s3_owner")}</p>
        <div className="preset-row">
          {(["b2", "hetzner", "r2", "custom"] as const).map((id) => (
            <button
              key={id}
              type="button"
              className={`btn ghost sm${storage.provider === id ? " active" : ""}`}
              onClick={() => pickProvider(id)}
            >
              {t(`profile.provider_${id}`)}
            </button>
          ))}
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={storage.enabled === 1}
            onChange={(e) => setStorage({ ...storage, enabled: e.target.checked ? 1 : 0 })}
          />
          {t("profile.s3_on")}
        </label>
        <div className="settings-grid">
          <div className="field">
            <label htmlFor="s3-endpoint">{t("settings.endpoint")}</label>
            <input
              id="s3-endpoint"
              className="input"
              value={storage.endpoint}
              placeholder={storage.provider === "r2" ? "https://<accountid>.r2.cloudflarestorage.com" : ""}
              onChange={(e) => setStorage({ ...storage, endpoint: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="s3-bucket">{t("settings.bucket")}</label>
            <input id="s3-bucket" className="input" value={storage.bucket} onChange={(e) => setStorage({ ...storage, bucket: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="s3-region">{t("settings.region")}</label>
            <input id="s3-region" className="input" value={storage.region} onChange={(e) => setStorage({ ...storage, region: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="s3-access">{t("settings.access_key")}</label>
            <input id="s3-access" className="input" autoComplete="off" value={storage.access_key} onChange={(e) => setStorage({ ...storage, access_key: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="s3-secret">{t("settings.secret_key")}</label>
            <input
              id="s3-secret"
              className="input"
              type="password"
              autoComplete="new-password"
              value={secret}
              placeholder={storage.secret_set === 1 ? t("profile.s3_secret_keep") : ""}
              onChange={(e) => setSecret(e.target.value)}
            />
          </div>
        </div>
        {storage.provider === "r2" ? <p className="muted small">{t("profile.s3_r2")}</p> : null}
        <button type="submit" className="btn" disabled={busy}>{t("profile.s3_save")}</button>{" "}
        <button type="button" className="btn ghost" disabled={busy || storage.enabled !== 1} onClick={checkStorage}>
          {t("profile.s3_check")}
        </button>
      </form>
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
