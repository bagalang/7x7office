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

type SaveMark = "saved" | "dirty" | "saving";

type CoolMsg = {
  MessageId?: string;
  Values?: { Modified?: boolean; success?: boolean; Status?: string };
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

function coolMsg(data: unknown): CoolMsg | null {
  if (typeof data === "string") {
    try {
      return JSON.parse(data) as CoolMsg;
    } catch {
      return null;
    }
  }
  if (data && typeof data === "object") return data as CoolMsg;
  return null;
}

function OfficeScreen() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const path = params.get("path") ?? "";
  const formRef = useRef<HTMLFormElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [error, setError] = useState("");
  const [action, setAction] = useState("");
  const [token, setToken] = useState("");
  const [ttl, setTtl] = useState("");
  const [mark, setMark] = useState<SaveMark | "">("");

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
    setMark("");
  }, [path]);

  useEffect(() => {
    if (!action) return;
    let origin = "";
    try {
      origin = new URL(action).origin;
    } catch {
      return;
    }
    let timer: number | null = null;
    let saving = false;
    let again = false;
    let tries = 0;

    function askSave() {
      const w = frameRef.current?.contentWindow;
      if (!w) return;
      saving = true;
      again = false;
      setMark("saving");
      w.postMessage(
        JSON.stringify({
          MessageId: "Action_Save",
          Values: { DontTerminateEdit: true, DontSaveIfUnmodified: true, Notify: true },
        }),
        origin,
      );
    }

    function schedule() {
      if (saving) {
        again = true;
        return;
      }
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        askSave();
      }, 2000);
    }

    function onLeave() {
      if (timer === null) return;
      window.clearTimeout(timer);
      timer = null;
      askSave();
    }

    function onMsg(ev: MessageEvent) {
      if (ev.origin !== origin) return;
      const frame = frameRef.current?.contentWindow;
      if (frame && ev.source !== frame) return;
      const msg = coolMsg(ev.data);
      const id = msg?.MessageId;
      if (!id) return;
      if (id === "App_LoadingStatus" && msg?.Values?.Status === "Document_Loaded") {
        frame?.postMessage(JSON.stringify({ MessageId: "Host_PostmessageReady" }), origin);
        return;
      }
      if (id === "App_LoadingStatus" && msg?.Values?.Status === "Failed") {
        setMark("dirty");
        return;
      }
      if (id === "Doc_ModifiedStatus") {
        if (msg?.Values?.Modified) {
          setMark("dirty");
          schedule();
        } else {
          again = false;
          tries = 0;
          if (timer !== null) {
            window.clearTimeout(timer);
            timer = null;
          }
          if (!saving) setMark("saved");
        }
        return;
      }
      if (id === "Action_Save_Resp") {
        saving = false;
        if (msg?.Values?.success === false) {
          setMark("dirty");
          if (tries < 2) {
            tries += 1;
            schedule();
          }
          return;
        }
        tries = 0;
        if (again) schedule();
        else setMark("saved");
      }
    }
    window.addEventListener("message", onMsg);
    window.addEventListener("pagehide", onLeave);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener("message", onMsg);
      window.removeEventListener("pagehide", onLeave);
    };
  }, [action]);

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
        {mark ? (
          <span
            className={`editor-mark ${mark}`}
            title={mark === "dirty" ? t("editor.dirty") : mark === "saving" ? t("editor.saving") : t("editor.saved")}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              {mark === "dirty" ? (
                <path
                  d="M4 4 12 12 M12 4 4 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              ) : (
                <path
                  d="M3.2 8.3 6.3 11.4 12.8 4.6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
            </svg>
            {mark === "dirty" ? t("editor.dirty") : mark === "saving" ? t("editor.saving") : t("editor.saved")}
          </span>
        ) : null}
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
        ref={frameRef}
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
