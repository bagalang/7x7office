"use client";

// /search — търсене по име и по съдържание (фаза 6).
// Въпросът живее в URL-а (?q=), за да е споделим и да преживява refresh.
// Търси се на сървъра (ILIKE по име + извлечен текст) — тук само показваме.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AppShell } from "../../components/AppShell";
import { RequireAuth } from "../../components/RequireAuth";
import { useI18n } from "../../components/I18nProvider";
import { api, downloadFile, FsNode, SearchHit } from "../../lib/api";
import { formatBytes, messageOf } from "../../components/FileBrowser";
import { IconDownload, IconFileText, IconSearch } from "../../components/icons";

function toNode(hit: SearchHit): FsNode {
  return {
    id: hit.id,
    name: hit.name,
    path: hit.path,
    is_dir: hit.is_dir,
    size: hit.size,
    has_thumb: 0,
    updated_at: hit.updated_at,
  };
}

function SearchInner() {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Последно търсеният въпрос — пази от повторни заявки при re-render.
  const lastSearched = useRef("");

  // ?q= при зареждане (deep link от друг екран).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q") ?? "";
    setQuery(q);
    setSubmitted(q);
  }, []);

  const run = useCallback(
    async (raw: string) => {
      const q = raw.trim();
      if (q.length < 2) {
        setHits([]);
        setSearched(false);
        setError("");
        return;
      }
      setLoading(true);
      setError("");
      try {
        const res = await api.get<{ items: SearchHit[] }>(`/v1/search?q=${encodeURIComponent(q)}&limit=50`);
        setHits(res.items ?? []);
        setSearched(true);
        lastSearched.current = q;
      } catch (err) {
        setError(messageOf(err, t("common.error")));
        setHits([]);
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  // Търси при спиране на писането (350 ms). `submitted` не участва в guard-а —
  // иначе live търсенето не тръгва (query се мени, submitted още е старият).
  // Дедупликираме през lastSearched, за да не повтаряме същия въпрос.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      setSearched(false);
      return;
    }
    if (q === lastSearched.current) return;
    const id = window.setTimeout(() => void run(q), 350);
    return () => window.clearTimeout(id);
  }, [query, run]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    setSubmitted(q);
    window.history.replaceState(null, "", q ? `/search?q=${encodeURIComponent(q)}` : "/search");
    void run(q);
  }

  const searchBox = (
    <form className="topbar-search" onSubmit={submit} role="search">
      <IconSearch width={16} height={16} />
      <input
        ref={inputRef}
        className="input"
        placeholder={t("search.placeholder")}
        aria-label={t("search.placeholder")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />
    </form>
  );

  return (
    <AppShell search={searchBox}>
      <main className="content-main">
        <div className="page-head">
          <h1>{t("search.title")}</h1>
          {searched && !loading ? (
            <span className="muted">{t("search.count", { count: hits.length })}</span>
          ) : null}
        </div>

        {query.trim().length > 0 && query.trim().length < 2 ? (
          <div className="card content muted">{t("search.too_short")}</div>
        ) : null}

        {error ? <div className="error-text">{error}</div> : null}

        {loading ? (
          <div className="card content muted">{t("common.loading")}</div>
        ) : null}

        {!loading && searched && hits.length === 0 ? (
          <div className="card content muted">{t("search.empty", { query: submitted })}</div>
        ) : null}

        {!loading && hits.length > 0 ? (
          <div className="card">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t("search.col_name")}</th>
                    <th>{t("search.col_path")}</th>
                    <th>{t("files.col_size")}</th>
                    <th>{t("search.col_match")}</th>
                    <th style={{ width: 48 }} />
                  </tr>
                </thead>
                <tbody>
                  {hits.map((hit) => (
                    <tr key={hit.id}>
                      <td>
                        <span className="name-cell">
                          <IconFileText width={16} height={16} />
                          <Link href={`/edit?path=${encodeURIComponent(hit.path)}`} className="link">
                            {hit.name}
                          </Link>
                        </span>
                      </td>
                      <td className="muted">{hit.path}</td>
                      <td>{formatBytes(hit.size)}</td>
                      <td>
                        <span className={hit.in_text === 1 ? "badge" : "badge muted"}>
                          {hit.in_text === 1 ? t("search.match_content") : t("search.match_name")}
                        </span>
                      </td>
                      <td>
                        {hit.is_dir === 0 ? (
                          <button
                            type="button"
                            className="icon-btn"
                            title={t("files.download")}
                            onClick={() => void downloadFile(toNode(hit)).catch((err) => setError(messageOf(err, t("common.error"))))}
                          >
                            <IconDownload />
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {!loading && !searched && query.trim().length < 2 ? (
          <div className="card content muted">{t("search.hint")}</div>
        ) : null}
      </main>
    </AppShell>
  );
}

export default function SearchPage() {
  return (
    <RequireAuth>
      <SearchInner />
    </RequireAuth>
  );
}
