"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RequireAuth } from "../../components/RequireAuth";
import { useI18n } from "../../components/I18nProvider";
import { ApiError, api, qpath } from "../../lib/api";
import { collaboraEditorUrl, isOfficeName } from "../../lib/office";

type WopiToken = {
  wopi_src: string;
  access_token: string;
  can_write?: number;
};

function fileName(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash >= 0 ? path.slice(slash + 1) : path;
}

function fileExt(path: string): string {
  const name = fileName(path);
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

function OfficeScreen() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const path = params.get("path") ?? "";
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState("");
  const [action, setAction] = useState("");
  const [token, setToken] = useState("");
  const [ttl, setTtl] = useState("");

  useEffect(() => {
    let cancel = false;
    setError("");
    setAction("");
    setToken("");
    if (!path || !isOfficeName(path)) {
      setError(t("office.bad_path"));
      return;
    }
    (async () => {
      const cfg = await fetch(`/api/office-config?ext=${encodeURIComponent(fileExt(path))}`, {
        cache: "no-store",
      });
      if (!cfg.ok) throw new Error("collabora");
      const conf = (await cfg.json()) as { urlsrc?: string };
      if (!conf.urlsrc) throw new Error("collabora");
      const tok = await api.get<WopiToken>(`/v1/wopi/token?path=${qpath(path)}`);
      if (cancel) return;
      setAction(collaboraEditorUrl(conf.urlsrc, tok.wopi_src, lang, tok.can_write !== 0));
      setToken(tok.access_token);
      setTtl(String(Date.now() + 50 * 60 * 1000));
    })().catch((err: unknown) => {
      if (cancel) return;
      if (err instanceof Error && err.message === "collabora") {
        setError(t("office.unavailable"));
        return;
      }
      setError(err instanceof ApiError ? err.message : t("office.unavailable"));
    });
    return () => {
      cancel = true;
    };
  }, [path, lang, t]);

  useEffect(() => {
    if (action && token && formRef.current) formRef.current.submit();
  }, [action, token, ttl]);

  return (
    <div className="editor-shell">
      <header className="editor-topbar">
        <button type="button" className="icon-btn" title={t("office.back")} onClick={() => router.push("/")}>
          ←
        </button>
        <span className="editor-name">{fileName(path) || t("office.frame")}</span>
      </header>
      {error ? (
        <p className="err" style={{ margin: "16px 24px" }}>
          {error}
        </p>
      ) : null}
      {action && token ? (
        <form
          ref={formRef}
          className="office-form"
          action={action}
          method="post"
          target="office-frame"
          encType="application/x-www-form-urlencoded"
        >
          <input type="hidden" name="access_token" value={token} />
          <input type="hidden" name="access_token_ttl" value={ttl} />
        </form>
      ) : null}
      {!error && !action ? (
        <p className="muted" style={{ margin: "16px 24px" }}>
          {t("office.opening")}
        </p>
      ) : null}
      <iframe
        name="office-frame"
        className="office-frame"
        title={t("office.frame")}
        allow="clipboard-read; clipboard-write; fullscreen"
      />
    </div>
  );
}

export default function OfficePage() {
  const { t } = useI18n();
  return (
    <RequireAuth>
      <Suspense fallback={<p className="muted">{t("office.opening")}</p>}>
        <OfficeScreen />
      </Suspense>
    </RequireAuth>
  );
}
