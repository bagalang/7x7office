"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../components/AuthProvider";
import { useI18n } from "../../components/I18nProvider";
import { PreferencesButton } from "../../components/PreferencesButton";
import { ApiError } from "../../lib/api";

export default function LoginPage() {
  const { login, authed, ready } = useAuth();
  const { t } = useI18n();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
      await login(email, password);
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
      <form className="login-card" onSubmit={onSubmit}>
        <div className="logo">
          <span className="logo-mark">7×7</span>
          7x7office
        </div>
        <p className="sub">{t("login.sub")}</p>
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
        {error ? <p className="err">{error}</p> : null}
        <button type="submit" className="btn" disabled={busy} style={{ marginTop: 8 }}>
          {busy ? t("login.submitting") : t("login.submit")}
        </button>
      </form>
    </div>
  );
}
