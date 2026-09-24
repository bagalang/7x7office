"use client";

// Публичната страница на линк (Фаза 3): /share/<token>.
//
// Тук НЯМА вход — линкът е тайната. Затова заявките не минават през
// авторизирания клиент (той би сложил Bearer и workspace), а директно към
// `/s/<token>` (вж. lib/api.ts, share* функциите).
//
// Паролата не се пази в URL-а: unlock връща краткотраен `pass_token`, който
// носи в заявките. Така паролата не влиза в историята на браузъра/логове.
//
// useParams иска Suspense при статично рендиране — вътрешният компонент е
// отделен, както при /reset.

import { FormEvent, Suspense, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useI18n } from "../../../components/I18nProvider";
import { PreferencesButton } from "../../../components/PreferencesButton";
import {
  ApiError,
  FsNode,
  ShareMeta,
  ShareView,
  shareDownload,
  shareMeta,
  shareUnlock,
  shareUpload,
  shareView,
} from "../../../lib/api";

function messageOf(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// Пътят спрямо корена на линка. Ако не е вътре (не би трябвало да се случи —
// сървърът проверява), връщаме "" (стоим в корена).
function relTo(root: string, p: string): string {
  if (p === root) return "";
  if (root === "/") return p;
  if (p.startsWith(`${root}/`)) return p.slice(root.length);
  return "";
}

function SharePageInner() {
  const { t } = useI18n();
  const params = useParams<{ token: string }>();
  const token = typeof params.token === "string" ? params.token : "";

  const [meta, setMeta] = useState<ShareMeta | null>(null);
  const [view, setView] = useState<ShareView | null>(null);
  // pass_token от unlock — носи се в заявките, за да не се праща паролата.
  const [pass, setPass] = useState("");
  const [password, setPassword] = useState("");
  const [path, setPath] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (p: string, passToken: string) => {
      setLoading(true);
      setError("");
      try {
        const m = await shareMeta(token);
        setMeta(m);
        // Метаданните не искат парола (иначе не бихме знали, че има такава),
        // но съдържанието — да. Затова тук спираме и показваме формата.
        if (m.needs_password === 1 && !passToken) {
          setView(null);
          setPath(m.path);
          return;
        }
        const v = await shareView(token, p, passToken);
        setView(v);
        setPath(v.path);
      } catch (e) {
        setError(messageOf(e, t("share.error")));
      } finally {
        setLoading(false);
      }
    },
    [token, t],
  );

  useEffect(() => {
    if (!token) return;
    void load("", "");
  }, [token, load]);

  async function onUnlock(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const pt = await shareUnlock(token, password);
      setPass(pt);
      setPassword("");
      await load("", pt);
    } catch (err) {
      setError(messageOf(err, t("share.wrong_password")));
    } finally {
      setBusy(false);
    }
  }

  async function download(node: FsNode) {
    setError("");
    try {
      await shareDownload(token, node.path, pass, node.name);
    } catch (e) {
      setError(messageOf(e, t("share.error")));
    }
  }

  async function downloadCurrent() {
    if (!view || !meta) return;
    await download({ path: view.path, name: view.name ?? meta.name } as FsNode);
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !meta) return;
    setError("");
    setBusy(true);
    try {
      await shareUpload(token, path || meta.path, file.name, file, pass);
      await load(path, pass);
    } catch (err) {
      setError(messageOf(err, t("share.error")));
    } finally {
      setBusy(false);
    }
  }

  const root = meta?.path ?? "/";
  // Хлебни пътеки само ВЪТРЕ в линка — не показваме къде живее файлът.
  const crumbs: { name: string; path: string }[] = [{ name: meta?.name || root, path: root }];
  const rel = relTo(root, path);
  if (rel) {
    let acc = root === "/" ? "" : root;
    for (const seg of rel.split("/").filter(Boolean)) {
      acc = `${acc}/${seg}`;
      crumbs.push({ name: seg, path: acc });
    }
  }

  const canUpload = (view?.level ?? meta?.level ?? 1) >= 2;
  const left = meta && meta.max_downloads > 0 ? Math.max(0, meta.max_downloads - meta.downloads) : -1;
  const expires = meta && meta.expires_at > 0 ? new Date(meta.expires_at * 1000) : null;

  return (
    <div className="share-page">
      <header className="share-top">
        <div className="logo">
          <span className="logo-mark">7×7</span>
          7x7office
        </div>
        <div className="share-top-right">
          <span className="muted">{t("share.public_badge")}</span>
          <PreferencesButton />
        </div>
      </header>

      <main className="share-main">
        {loading ? <p className="muted">{t("common.loading")}</p> : null}

        {!loading && meta && meta.needs_password === 1 && !pass ? (
          <form className="login-card" onSubmit={onUnlock}>
            <p className="sub">{t("share.password_required")}</p>
            <div className="field">
              <label htmlFor="sp">{t("share.password")}</label>
              <input
                id="sp"
                type="password"
                className="input"
                autoFocus
                autoComplete="off"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error ? <p className="err">{error}</p> : null}
            <button type="submit" className="btn" disabled={busy}>
              {t("share.unlock")}
            </button>
          </form>
        ) : null}

        {!loading && view ? (
          <>
            <div className="crumbs">
              {crumbs.map((c, i) => (
                <span key={c.path} style={{ display: "inline-flex", alignItems: "center" }}>
                  {i > 0 ? <span className="sep">›</span> : null}
                  <button type="button" className="crumb" onClick={() => void load(c.path, pass)}>
                    {c.name}
                  </button>
                </span>
              ))}
            </div>

            {error ? <p className="err">{error}</p> : null}

            {view.is_dir === 1 ? (
              <>
                {canUpload ? (
                  <label className="btn ghost share-upload">
                    {t("share.upload")}
                    <input type="file" hidden onChange={onUpload} />
                  </label>
                ) : null}
                <table className="table">
                  <tbody>
                    {(view.items ?? []).map((node) => (
                      <tr key={node.id}>
                        <td>
                          {node.is_dir === 1 ? (
                            <button type="button" className="crumb" onClick={() => void load(node.path, pass)}>
                              📁 {node.name}
                            </button>
                          ) : (
                            <span>📄 {node.name}</span>
                          )}
                        </td>
                        <td className="muted">{node.is_dir === 1 ? "—" : fmtSize(node.size)}</td>
                        <td className="share-cell-act">
                          {node.is_dir === 0 ? (
                            <button type="button" className="btn ghost sm" onClick={() => void download(node)}>
                              {t("share.download")}
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(view.items ?? []).length === 0 ? <p className="muted">{t("share.empty")}</p> : null}
              </>
            ) : (
              <div className="share-file">
                <h2>{view.name}</h2>
                <p className="muted">
                  {view.mime} · {fmtSize(view.size ?? 0)}
                </p>
                {view.content ? (
                  <pre className="share-text">{view.content}</pre>
                ) : (
                  <p className="muted">{t("share.preview_unavailable")}</p>
                )}
                <button type="button" className="btn" onClick={() => void downloadCurrent()}>
                  {t("share.download")}
                </button>
              </div>
            )}

            {left >= 0 || expires ? (
              <p className="muted share-foot">
                {left >= 0 ? t("share.quota").replace("{left}", String(left)) : ""}
                {left >= 0 && expires ? " · " : ""}
                {expires ? t("share.expires").replace("{date}", expires.toLocaleDateString()) : ""}
              </p>
            ) : null}
          </>
        ) : null}

        {!loading && !meta && error ? <p className="err">{error}</p> : null}
      </main>
    </div>
  );
}

export default function SharePage() {
  const { t } = useI18n();
  return (
    <Suspense fallback={<p className="muted">{t("common.loading")}</p>}>
      <SharePageInner />
    </Suspense>
  );
}
