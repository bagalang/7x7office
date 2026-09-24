"use client";

import { FormEvent, useState } from "react";
import { useI18n } from "../../components/I18nProvider";
import { PreferencesButton } from "../../components/PreferencesButton";
import { ApiError, requestPasswordReset } from "../../lib/api";

// Заявка за смяна на забравена парола. Сървърът не издава дали имейлът
// съществува — затова и тук няма клон „няма такъв потребител": винаги
// показваме едно и също съобщение. Това пази от проверка на имейли.
export default function ForgotPage() {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await requestPasswordReset(email);
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("forgot.error"));
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
        <p className="sub">{t("forgot.sub")}</p>
        {sent ? (
          <p className="sub" style={{ marginTop: 12 }}>
            {t("forgot.sent")}
          </p>
        ) : (
          <>
            <div className="field">
              <label htmlFor="email">{t("forgot.email")}</label>
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
            {error ? <p className="err">{error}</p> : null}
            <button type="submit" className="btn" disabled={busy} style={{ marginTop: 8 }}>
              {busy ? t("forgot.submitting") : t("forgot.submit")}
            </button>
          </>
        )}
        <p className="sub" style={{ marginTop: 12, textAlign: "center" }}>
          <a href="/login">{t("forgot.back")}</a>
        </p>
      </form>
    </div>
  );
}
