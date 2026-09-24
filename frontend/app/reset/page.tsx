"use client";

import { FormEvent, Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useI18n } from "../../components/I18nProvider";
import { PreferencesButton } from "../../components/PreferencesButton";
import { ApiError, resetPassword } from "../../lib/api";

// Смяна на паролата по токен от писмото. useSearchParams иска Suspense
// граница при статично рендиране — затова вътрешният компонент е отделен.
function ResetForm() {
  const { t } = useI18n();
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError(t("reset.tooshort"));
      return;
    }
    if (password !== password2) {
      setError(t("reset.mismatch"));
      return;
    }
    setBusy(true);
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("reset.error"));
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
        <p className="sub">{t("reset.sub")}</p>
        {token === "" ? (
          <p className="err">{t("reset.notoken")}</p>
        ) : done ? (
          <p className="sub" style={{ marginTop: 12 }}>
            {t("reset.done")}
          </p>
        ) : (
          <>
            <div className="field">
              <label htmlFor="password">{t("reset.password")}</label>
              <input
                id="password"
                className="input"
                type="password"
                autoComplete="new-password"
                required
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="password2">{t("reset.password2")}</label>
              <input
                id="password2"
                className="input"
                type="password"
                autoComplete="new-password"
                required
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
              />
            </div>
            {error ? <p className="err">{error}</p> : null}
            <button type="submit" className="btn" disabled={busy} style={{ marginTop: 8 }}>
              {busy ? t("reset.submitting") : t("reset.submit")}
            </button>
          </>
        )}
        <p className="sub" style={{ marginTop: 12, textAlign: "center" }}>
          <a href="/login">{t("reset.back")}</a>
        </p>
      </form>
    </div>
  );
}

export default function ResetPage() {
  const { t } = useI18n();
  return (
    <Suspense fallback={<p className="muted">{t("reset.submitting")}</p>}>
      <ResetForm />
    </Suspense>
  );
}
