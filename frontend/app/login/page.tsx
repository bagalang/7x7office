"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../components/AuthProvider";
import { useI18n } from "../../components/I18nProvider";
import { PreferencesButton } from "../../components/PreferencesButton";
import { ApiError, loginMfa } from "../../lib/api";

export default function LoginPage() {
  const { login, authed, ready } = useAuth();
  const { t } = useI18n();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaToken, setMfaToken] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ready && authed) router.replace("/");
  }, [ready, authed, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await login(email, password);
      if (data.mfa_token) {
        setMfaToken(data.mfa_token);
        return;
      }
      router.push("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("login.error"));
    } finally {
      setBusy(false);
    }
  }

  async function onMfa(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await loginMfa(mfaToken, code);
      router.push("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("login.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-prefs">
        <PreferencesButton />
      </div>
      <form className="login-card" onSubmit={mfaToken ? onMfa : onSubmit}>
        <div className="logo">
          <span className="logo-mark">7×7</span>
          7x7office
        </div>
        <p className="sub">{mfaToken ? t("login.mfa_sub") : t("login.sub")}</p>
        {mfaToken ? (
          <div className="field">
            <label htmlFor="code">{t("login.mfa_code")}</label>
            <input
              id="code"
              className="input"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
        ) : null}
        {mfaToken ? null : (
        <>
        <div className="field">
          <label htmlFor="email">{t("login.email")}</label>
          <input
            id="email"
            className="input"
            type="email"
            autoComplete="username"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="password">{t("login.password")}</label>
          <input
            id="password"
            className="input"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        </>
        )}
        {error ? <p className="err">{error}</p> : null}
        <button type="submit" className="btn" disabled={busy} style={{ marginTop: 8 }}>
          {busy ? t("login.submitting") : mfaToken ? t("login.mfa_submit") : t("login.submit")}
        </button>
        {mfaToken ? (
          <p className="sub" style={{ marginTop: 12, textAlign: "center" }}>
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                setMfaToken("");
                setCode("");
                setError("");
              }}
            >
              {t("login.mfa_back")}
            </button>
          </p>
        ) : (
          <p className="sub" style={{ marginTop: 12, textAlign: "center" }}>
            <a href="/forgot">{t("login.forgot")}</a>
          </p>
        )}
      </form>
    </div>
  );
}
