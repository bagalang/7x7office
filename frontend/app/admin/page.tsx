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
  secret_set?: string;
  region: string;
  timeout_s: string;
  source: string;
};

type BakForm = {
  on: string;
  endpoint: string;
  bucket: string;
  access_key: string;
  secret_key: string;
  secret_set?: string;
  region: string;
  prefix: string;
  timeout_s: string;
  last?: string;
  source: string;
};

type SiteForm = { url: string; source: string };

type Settings = { site: SiteForm; smtp: SmtpForm; s3: S3Form; bak?: BakForm };

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

const B2_REGIONS = [
  "eu-central-003",
  "us-west-004",
  "us-west-002",
  "us-west-001",
  "us-west-000",
  "us-east-005",
  "ca-central-001",
];

function isB2Region(region: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*-\d{3}$/.test(region);
}

function b2Endpoint(region: string): string {
  return `https://s3.${region}.backblazeb2.com`;
}

const emptyS3: S3Form = {
  on: "0",
  endpoint: b2Endpoint("eu-central-003"),
  bucket: "",
  access_key: "",
  secret_key: "",
  secret_set: "0",
  region: "eu-central-003",
  timeout_s: "30",
  source: "env",
};

function normalizeS3(raw: S3Form): S3Form {
  const s = { ...emptyS3, ...raw, secret_key: "" };
  if (isB2Region(s.region)) {
    return { ...s, endpoint: b2Endpoint(s.region) };
  }
  if (s.on !== "1" && s.endpoint === "") {
    return { ...s, region: "eu-central-003", endpoint: b2Endpoint("eu-central-003") };
  }
  return s;
}

const emptyBak: BakForm = {
  on: "0",
  endpoint: b2Endpoint("eu-central-003"),
  bucket: "",
  access_key: "",
  secret_key: "",
  secret_set: "0",
  region: "eu-central-003",
  prefix: "beckupDB",
  timeout_s: "120",
  last: "",
  source: "default",
};

function normalizeBak(raw?: BakForm): BakForm {
  const s = { ...emptyBak, ...raw, secret_key: "", prefix: (raw?.prefix || "beckupDB").trim() || "beckupDB" };
  if (isB2Region(s.region)) {
    return { ...s, endpoint: b2Endpoint(s.region) };
  }
  return s;
}

// normalizeBak чисти ключа за показване. При запис трябва да тръгне написаното,
// иначе след презареждане остава старият (или празен) ключ.
function bakForSave(raw: BakForm): BakForm {
  return { ...normalizeBak(raw), secret_key: raw.secret_key };
}

function sourceLabel(source: string, t: (k: string) => string): string {
  if (source === "db") return t("settings.source_db");
  if (source === "default") return t("settings.source_default");
  return t("settings.source_env");
}

function SettingsScreen() {
  const { t } = useI18n();
  const [admin, setAdmin] = useState<boolean | null>(null);
  const [site, setSite] = useState<SiteForm>(emptySite);
  const [smtp, setSmtp] = useState<SmtpForm>(emptySmtp);
  const [s3, setS3] = useState<S3Form>(emptyS3);
  const [bak, setBak] = useState<BakForm>(emptyBak);
  const [error, setError] = useState("");
  const [smtpTo, setSmtpTo] = useState("");
  const [smtpSent, setSmtpSent] = useState("");
  const [saved, setSaved] = useState(false);
  const [checked, setChecked] = useState(false);
  const [bakChecked, setBakChecked] = useState(false);
  const [bakKey, setBakKey] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setBusy(true);
      setError("");
      try {
        const who = await api.get<{ is_admin?: number; email?: string }>("/v1/me");
        if (cancel) return;
        if (who.is_admin !== 1) {
          setAdmin(false);
          setBusy(false);
          return;
        }
        setAdmin(true);
        if (who.email) setSmtpTo((cur) => cur || who.email || "");
        const body = await api.get<Settings>("/v1/admin/settings");
        if (cancel) return;
        setSite({ ...emptySite, ...body.site });
        setSmtp({ ...emptySmtp, ...body.smtp });
        setS3(normalizeS3(body.s3));
        setBak(normalizeBak(body.bak));
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

  async function persist(): Promise<boolean> {
    setBusy(true);
    setError("");
    setSaved(false);
    setChecked(false);
    setBakChecked(false);
    setSmtpSent("");
    let next = s3;
    if (isB2Region(s3.region)) {
      next = { ...s3, endpoint: b2Endpoint(s3.region) };
    }
    try {
      const body = await api.put<Settings>("/v1/admin/settings", { site, smtp, s3: next, bak: bakForSave(bak) });
      setSite({ ...emptySite, ...body.site });
      setSmtp({ ...emptySmtp, ...body.smtp });
      setS3(normalizeS3(body.s3));
      setBak(normalizeBak(body.bak));
      setSaved(true);
      return true;
    } catch (err) {
      setError(messageOf(err, t("common.error")));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    await persist();
  }

  async function onSmtpTest() {
    const to = smtpTo.trim();
    if (!to) return;
    const ok = await persist();
    if (!ok) return;
    setBusy(true);
    setError("");
    setSmtpSent("");
    try {
      await api.post("/v1/admin/smtp/check", { to });
      setSmtpSent(to);
    } catch (err) {
      setError(messageOf(err, t("common.error")));
    } finally {
      setBusy(false);
    }
  }

  async function onCheck() {
    const ok = await persist();
    if (!ok) return;
    setBusy(true);
    setError("");
    setChecked(false);
    try {
      await api.post("/v1/admin/settings/check");
      setChecked(true);
    } catch (err) {
      setError(messageOf(err, t("common.error")));
    } finally {
      setBusy(false);
    }
  }

  async function onBakCheck() {
    const ok = await persist();
    if (!ok) return;
    setBusy(true);
    setError("");
    setBakChecked(false);
    try {
      await api.post("/v1/admin/backup/check");
      setBakChecked(true);
    } catch (err) {
      setError(messageOf(err, t("common.error")));
    } finally {
      setBusy(false);
    }
  }

  async function onBakRun() {
    const ok = await persist();
    if (!ok) return;
    setBusy(true);
    setError("");
    setBakKey("");
    try {
      const row = await api.post<{ key?: string }>("/v1/admin/backup");
      setBakKey(row.key || "");
      setBak({ ...bak, last: row.key || bak.last });
    } catch (err) {
      setError(messageOf(err, t("common.error")));
    } finally {
      setBusy(false);
    }
  }

  function setRegion(region: string) {
    const next = region.toLowerCase();
    setS3({
      ...s3,
      region: next,
      endpoint: isB2Region(next) ? b2Endpoint(next) : s3.endpoint,
    });
  }

  function setS3On(on: boolean) {
    if (on && !isB2Region(s3.region)) {
      setS3({
        ...s3,
        on: "1",
        region: "eu-central-003",
        endpoint: b2Endpoint("eu-central-003"),
      });
      return;
    }
    setS3({ ...s3, on: on ? "1" : "0" });
  }

  const endpoint = isB2Region(s3.region) ? b2Endpoint(s3.region) : s3.endpoint;

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
        {smtpSent ? <p className="muted">{t("settings.smtp_test_ok", { to: smtpSent })}</p> : null}
        {checked ? <p className="muted">{t("settings.s3_check_ok")}</p> : null}
        {bakChecked ? <p className="muted">{t("settings.bak_check_ok")}</p> : null}
        {bakKey ? <p className="muted">{t("settings.bak_ok")} {bakKey}</p> : null}
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
              <div className="settings-mail-test">
                <div className="field">
                  <label htmlFor="smtp-test-to">{t("settings.smtp_test_to")}</label>
                  <input
                    id="smtp-test-to"
                    className="input"
                    type="email"
                    autoComplete="email"
                    value={smtpTo}
                    onChange={(e) => setSmtpTo(e.target.value)}
                  />
                </div>
                <button
                  type="button"
                  className="btn ghost"
                  disabled={busy || smtp.host.trim() === "" || smtpTo.trim() === ""}
                  onClick={onSmtpTest}
                >
                  {t("settings.smtp_test")}
                </button>
              </div>
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
                  onChange={(e) => setS3On(e.target.checked)}
                />
                {t("settings.s3_on")}
              </label>
              <div className="settings-grid">
                <div className="field">
                  <label htmlFor="s3-region">{t("settings.region")}</label>
                  <input id="s3-region" className="input" list="b2-regions" value={s3.region} onChange={(e) => setRegion(e.target.value.trim())} />
                  <datalist id="b2-regions">
                    {B2_REGIONS.map((id) => (
                      <option key={id} value={id} />
                    ))}
                  </datalist>
                </div>
                <div className="field">
                  <label htmlFor="s3-endpoint">{t("settings.endpoint")}</label>
                  <input id="s3-endpoint" className="input" readOnly value={endpoint} />
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
                  <input
                    id="s3-secret"
                    className="input"
                    type="password"
                    value={s3.secret_key}
                    autoComplete="new-password"
                    placeholder={s3.secret_set === "1" ? t("settings.s3_secret_keep") : ""}
                    onChange={(e) => setS3({ ...s3, secret_key: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="s3-timeout">{t("settings.timeout")}</label>
                  <input id="s3-timeout" className="input" inputMode="numeric" value={s3.timeout_s} onChange={(e) => setS3({ ...s3, timeout_s: e.target.value })} />
                </div>
              </div>
            </section>

            <section className="settings-block">
              <h2>{t("settings.bak")}</h2>
              <p className="muted small">
                {t("settings.bak_hint")} {sourceLabel(bak.source, t)}
              </p>
              <label className="check">
                <input
                  type="checkbox"
                  checked={bak.on === "1"}
                  onChange={(e) => setBak({ ...bak, on: e.target.checked ? "1" : "0" })}
                />
                {t("settings.bak_on")}
              </label>
              <div className="settings-grid">
                <div className="field">
                  <label htmlFor="bak-region">{t("settings.region")}</label>
                  <input id="bak-region" className="input" list="b2-regions" value={bak.region} onChange={(e) => setBak({ ...bak, region: e.target.value.trim().toLowerCase() })} />
                </div>
                <div className="field">
                  <label htmlFor="bak-bucket">{t("settings.bucket")}</label>
                  <input id="bak-bucket" className="input" value={bak.bucket} onChange={(e) => setBak({ ...bak, bucket: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="bak-prefix">{t("settings.bak_prefix")}</label>
                  <input id="bak-prefix" className="input" value={bak.prefix} onChange={(e) => setBak({ ...bak, prefix: e.target.value.trim() })} />
                </div>
                <div className="field">
                  <label htmlFor="bak-access">{t("settings.access_key")}</label>
                  <input id="bak-access" className="input" autoComplete="off" value={bak.access_key} onChange={(e) => setBak({ ...bak, access_key: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="bak-secret">{t("settings.secret_key")}</label>
                  <input
                    id="bak-secret"
                    className="input"
                    type="password"
                    autoComplete="new-password"
                    value={bak.secret_key}
                    placeholder={bak.secret_set === "1" ? t("settings.s3_secret_keep") : ""}
                    onChange={(e) => setBak({ ...bak, secret_key: e.target.value })}
                  />
                </div>
              </div>
              {bak.last ? <p className="muted small">{t("settings.bak_last")} {bak.last}</p> : null}
              <button type="button" className="btn ghost" disabled={busy || bak.on !== "1"} onClick={onBakCheck}>
                {t("settings.bak_check")}
              </button>{" "}
              <button type="button" className="btn activate" disabled={busy || bak.on !== "1"} onClick={onBakRun}>
                {t("settings.bak_now")}
              </button>
            </section>

            <button type="submit" className="btn" disabled={busy}>
              {t("common.save")}
            </button>{" "}
            <button type="button" className="btn ghost" disabled={busy || s3.on !== "1"} onClick={onCheck}>
              {t("settings.s3_check")}
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
