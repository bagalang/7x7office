"use client";

import { FormEvent, useEffect, useState } from "react";
import { RequireAuth } from "../../components/RequireAuth";
import { AppShell } from "../../components/AppShell";
import { useI18n } from "../../components/I18nProvider";
import { api } from "../../lib/api";
import { messageOf } from "../../components/FileBrowser";

type SmtpForm = {
  host: string;
  port: string;
  tls: string;
  from: string;
  user: string;
  pass: string;
  helo: string;
  timeout_s: string;
  insecure: string;
  source: string;
};

type S3Form = {
  on: string;
  endpoint: string;
  bucket: string;
  access_key: string;
  secret_key: string;
  region: string;
  timeout_s: string;
  source: string;
};

type SiteForm = { url: string; source: string };

type Settings = { site: SiteForm; smtp: SmtpForm; s3: S3Form };

const emptySmtp: SmtpForm = {
  host: "",
  port: "587",
  tls: "starttls",
  from: "",
  user: "",
  pass: "",
  helo: "",
  timeout_s: "20",
  insecure: "0",
  source: "env",
};

const emptySite: SiteForm = { url: "http://127.0.0.1:3010", source: "env" };

const emptyS3: S3Form = {
  on: "0",
  endpoint: "",
  bucket: "",
  access_key: "",
  secret_key: "",
  region: "us-east-1",
  timeout_s: "30",
  source: "env",
};

function sourceLabel(source: string, t: (k: string) => string): string {
  if (source === "db") return t("settings.source_db");
  return t("settings.source_env");
}

function SettingsScreen() {
  const { t } = useI18n();
  const [admin, setAdmin] = useState<boolean | null>(null);
  const [site, setSite] = useState<SiteForm>(emptySite);
  const [smtp, setSmtp] = useState<SmtpForm>(emptySmtp);
  const [s3, setS3] = useState<S3Form>(emptyS3);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setBusy(true);
      setError("");
      try {
        const who = await api.get<{ is_admin?: number }>("/v1/me");
        if (cancel) return;
        if (who.is_admin !== 1) {
          setAdmin(false);
          setBusy(false);
          return;
        }
        setAdmin(true);
        const body = await api.get<Settings>("/v1/admin/settings");
        if (cancel) return;
        setSite({ ...emptySite, ...body.site });
        setSmtp({ ...emptySmtp, ...body.smtp });
        setS3({ ...emptyS3, ...body.s3 });
      } catch (err) {
        if (!cancel) setError(messageOf(err, t("common.error")));
      } finally {
        if (!cancel) setBusy(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [t]);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const body = await api.put<Settings>("/v1/admin/settings", { site, smtp, s3 });
      setSite({ ...emptySite, ...body.site });
      setSmtp({ ...emptySmtp, ...body.smtp });
      setS3({ ...emptyS3, ...body.s3 });
      setSaved(true);
    } catch (err) {
      setError(messageOf(err, t("common.error")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <main className="content-main">
        <div className="page-head">
          <h1>{t("settings.title")}</h1>
        </div>
        <p className="muted">{t("settings.hint")}</p>
        {admin === false ? <p className="err">{t("settings.admin_only")}</p> : null}
        {error ? <p className="err">{error}</p> : null}
        {saved ? <p className="muted">{t("settings.saved")}</p> : null}
        {busy && admin !== true ? <p className="muted">{t("common.loading")}</p> : null}

        {admin === true ? (
          <form onSubmit={onSave}>
            <section className="settings-block">
              <h2>{t("settings.site")}</h2>
              <p className="muted small">
                {t("settings.site_hint")} {sourceLabel(site.source, t)}
              </p>
              <div className="field">
                <label htmlFor="site-url">{t("settings.domain")}</label>
                <input
                  id="site-url"
                  className="input"
                  value={site.url}
                  placeholder="127.0.0.1"
                  onChange={(e) => setSite({ ...site, url: e.target.value })}
                />
              </div>
            </section>

            <section className="settings-block">
              <h2>{t("settings.smtp")}</h2>
              <p className="muted small">
                {t("settings.smtp_hint")} {sourceLabel(smtp.source, t)}
              </p>
              <div className="settings-grid">
                <div className="field">
                  <label htmlFor="smtp-host">{t("settings.host")}</label>
                  <input id="smtp-host" className="input" value={smtp.host} onChange={(e) => setSmtp({ ...smtp, host: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="smtp-port">{t("settings.port")}</label>
                  <input id="smtp-port" className="input" inputMode="numeric" value={smtp.port} onChange={(e) => setSmtp({ ...smtp, port: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="smtp-tls">{t("settings.tls")}</label>
                  <select id="smtp-tls" className="input" value={smtp.tls} onChange={(e) => setSmtp({ ...smtp, tls: e.target.value })}>
                    <option value="starttls">{t("settings.tls_starttls")}</option>
                    <option value="tls">{t("settings.tls_tls")}</option>
                    <option value="plain">{t("settings.tls_plain")}</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="smtp-from">{t("settings.from")}</label>
                  <input id="smtp-from" className="input" type="email" value={smtp.from} onChange={(e) => setSmtp({ ...smtp, from: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="smtp-user">{t("settings.user")}</label>
                  <input id="smtp-user" className="input" value={smtp.user} autoComplete="off" onChange={(e) => setSmtp({ ...smtp, user: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="smtp-pass">{t("settings.pass")}</label>
                  <input id="smtp-pass" className="input" type="password" value={smtp.pass} autoComplete="new-password" onChange={(e) => setSmtp({ ...smtp, pass: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="smtp-helo">{t("settings.helo")}</label>
                  <input id="smtp-helo" className="input" value={smtp.helo} onChange={(e) => setSmtp({ ...smtp, helo: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="smtp-timeout">{t("settings.timeout")}</label>
                  <input id="smtp-timeout" className="input" inputMode="numeric" value={smtp.timeout_s} onChange={(e) => setSmtp({ ...smtp, timeout_s: e.target.value })} />
                </div>
              </div>
              <label className="check">
                <input
                  type="checkbox"
                  checked={smtp.insecure === "1"}
                  onChange={(e) => setSmtp({ ...smtp, insecure: e.target.checked ? "1" : "0" })}
                />
                {t("settings.insecure")}
              </label>
            </section>

            <section className="settings-block">
              <h2>{t("settings.s3")}</h2>
              <p className="muted small">
                {t("settings.s3_hint")} {sourceLabel(s3.source, t)}
              </p>
              <label className="check">
                <input
                  type="checkbox"
                  checked={s3.on === "1"}
                  onChange={(e) => setS3({ ...s3, on: e.target.checked ? "1" : "0" })}
                />
                {t("settings.s3_on")}
              </label>
              <div className="settings-grid">
                <div className="field">
                  <label htmlFor="s3-endpoint">{t("settings.endpoint")}</label>
                  <input id="s3-endpoint" className="input" value={s3.endpoint} onChange={(e) => setS3({ ...s3, endpoint: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="s3-bucket">{t("settings.bucket")}</label>
                  <input id="s3-bucket" className="input" value={s3.bucket} onChange={(e) => setS3({ ...s3, bucket: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="s3-access">{t("settings.access_key")}</label>
                  <input id="s3-access" className="input" value={s3.access_key} autoComplete="off" onChange={(e) => setS3({ ...s3, access_key: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="s3-secret">{t("settings.secret_key")}</label>
                  <input id="s3-secret" className="input" type="password" value={s3.secret_key} autoComplete="new-password" onChange={(e) => setS3({ ...s3, secret_key: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="s3-region">{t("settings.region")}</label>
                  <input id="s3-region" className="input" value={s3.region} onChange={(e) => setS3({ ...s3, region: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="s3-timeout">{t("settings.timeout")}</label>
                  <input id="s3-timeout" className="input" inputMode="numeric" value={s3.timeout_s} onChange={(e) => setS3({ ...s3, timeout_s: e.target.value })} />
                </div>
              </div>
            </section>

            <button type="submit" className="btn" disabled={busy}>
              {t("common.save")}
            </button>
          </form>
        ) : null}
      </main>
    </AppShell>
  );
}

export default function AdminSettingsPage() {
  return (
    <RequireAuth>
      <SettingsScreen />
    </RequireAuth>
  );
}
