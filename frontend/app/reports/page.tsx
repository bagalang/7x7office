"use client";

// /reports — админ отчети: място и активност по пространство (фаза 6).
// JSON-ът храни таблицата. Файлът (csv/xlsx/ods/html/pdf) идва от reportbaga
// със същия език като интерфейса.

import { useEffect, useState } from "react";
import { RequireAuth } from "../../components/RequireAuth";
import { AppShell } from "../../components/AppShell";
import { useI18n } from "../../components/I18nProvider";
import { formatBytes, messageOf } from "../../components/FileBrowser";
import { ApiError, api, authedFetch } from "../../lib/api";
import { IconDownload } from "../../components/icons";

type Me = { is_admin?: number };

type StorageRow = {
  id: number;
  label: string;
  slug: string;
  is_personal: number;
  files: number;
  bytes: number;
  members: number;
};

type StorageList = {
  items: StorageRow[];
  count: number;
  files: number;
  bytes: number;
};

type ActivityRow = {
  id: number;
  label: string;
  total: number;
} & Record<string, number | string>;

type ActivityList = { items: ActivityRow[]; count: number };

// Редът е същият като activity_verbs() в tree/activity_kinds.baga.
const VERBS = [
  "created",
  "deleted",
  "member_added",
  "member_removed",
  "member_updated",
  "moved",
  "restored",
  "shared",
  "unshared",
  "updated",
  "workspace_created",
] as const;

const FORMATS = ["csv", "xlsx", "ods", "html", "pdf"] as const;

function ReportsScreen() {
  const { t, lang } = useI18n();
  const [me, setMe] = useState<Me | null>(null);
  const [storage, setStorage] = useState<StorageRow[]>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState("");

  useEffect(() => {
    let cancel = false;
    (async () => {
      setBusy(true);
      setError("");
      try {
        const who = await api.get<Me>("/v1/me");
        if (cancel) return;
        setMe(who);
        if (who.is_admin !== 1) {
          setBusy(false);
          return;
        }
        const [st, ac] = await Promise.all([
          api.get<StorageList>("/v1/reports/storage"),
          api.get<ActivityList>("/v1/reports/activity"),
        ]);
        if (cancel) return;
        setStorage(st.items ?? []);
        setActivity(ac.items ?? []);
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

  async function download(kind: "storage" | "activity", format: string) {
    setSaving(`${kind}:${format}`);
    setError("");
    try {
      const res = await authedFetch(
        `/v1/reports/${kind}?format=${encodeURIComponent(format)}&lang=${encodeURIComponent(lang)}`,
      );
      if (!res.ok) {
        const text = await res.text();
        let msg = text;
        try {
          const parsed = JSON.parse(text) as { detail?: string };
          if (parsed.detail) msg = parsed.detail;
        } catch {
          msg = text;
        }
        throw new ApiError(res.status, msg || res.statusText);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${kind}_report.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(messageOf(err, t("common.error")));
    } finally {
      setSaving("");
    }
  }

  function downloads(kind: "storage" | "activity") {
    return (
      <div className="report-actions">
        {FORMATS.map((format) => (
          <button
            key={format}
            type="button"
            className="btn ghost sm"
            disabled={saving !== ""}
            onClick={() => void download(kind, format)}
          >
            <IconDownload width={14} height={14} />
            {t(`reports.format_${format}`)}
          </button>
        ))}
      </div>
    );
  }

  return (
    <AppShell>
      <main className="content-main">
        <div className="page-head">
          <h1>{t("reports.title")}</h1>
        </div>
        <p className="muted report-hint">{t("reports.hint")}</p>
        {me && me.is_admin !== 1 ? <p className="err">{t("reports.admin_only")}</p> : null}
        {error ? <p className="err">{error}</p> : null}
        {busy ? <p className="muted">{t("common.loading")}</p> : null}

        {me?.is_admin === 1 && !busy ? (
          <>
            <section className="report-block">
              <h2>{t("reports.storage")}</h2>
              {downloads("storage")}
              {storage.length === 0 ? <p className="muted">{t("reports.empty")}</p> : null}
              {storage.length > 0 ? (
                <div className="table-scroll">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>{t("reports.col_name")}</th>
                        <th>{t("reports.col_slug")}</th>
                        <th>{t("reports.col_personal")}</th>
                        <th>{t("reports.col_files")}</th>
                        <th>{t("reports.col_bytes")}</th>
                        <th>{t("reports.col_members")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {storage.map((row) => (
                        <tr key={row.id}>
                          <td>{row.label}</td>
                          <td className="muted">{row.slug}</td>
                          <td>{row.is_personal === 1 ? t("reports.personal_yes") : t("reports.personal_no")}</td>
                          <td>{row.files}</td>
                          <td>{formatBytes(row.bytes)}</td>
                          <td>{row.members}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </section>

            <section className="report-block">
              <h2>{t("reports.activity")}</h2>
              {downloads("activity")}
              {activity.length === 0 ? <p className="muted">{t("reports.empty")}</p> : null}
              {activity.length > 0 ? (
                <div className="table-scroll">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>{t("reports.col_name")}</th>
                        <th>{t("reports.col_total")}</th>
                        {VERBS.map((verb) => (
                          <th key={verb}>{t(`activity.verb_${verb}`)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {activity.map((row) => (
                        <tr key={row.id}>
                          <td>{row.label}</td>
                          <td>{row.total}</td>
                          {VERBS.map((verb) => (
                            <td key={verb}>{Number(row[verb] ?? 0)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </section>
          </>
        ) : null}
      </main>
    </AppShell>
  );
}

export default function ReportsPage() {
  return (
    <RequireAuth>
      <ReportsScreen />
    </RequireAuth>
  );
}
