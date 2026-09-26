"use client";

import { FormEvent, useEffect, useState } from "react";
import { RequireAuth } from "../../components/RequireAuth";
import { AppShell } from "../../components/AppShell";
import { useI18n } from "../../components/I18nProvider";
import { api } from "../../lib/api";
import { messageOf } from "../../components/FileBrowser";

type Flow = {
  id: number;
  name: string;
  enabled: number;
  trigger: string;
  path_prefix: string;
  ext: string;
  action: string;
  arg: string;
};

type FlowList = { items: Flow[]; count: number };

const empty = {
  name: "",
  trigger: "upload",
  path_prefix: "",
  ext: "",
  action: "move",
  arg: "/Архив",
};

function FlowsScreen() {
  const { t } = useI18n();
  const [admin, setAdmin] = useState<boolean | null>(null);
  const [rows, setRows] = useState<Flow[]>([]);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setBusy(true);
      setError("");
      try {
        const who = await api.get<{ is_admin?: number }>("/v1/me");
        if (cancel) return;
        if (who.is_admin !== 1) {
          setAdmin(false);
          setBusy(false);
          return;
        }
        setAdmin(true);
        const list = await api.get<FlowList>("/v1/flows");
        if (cancel) return;
        setRows(list.items ?? []);
      } catch (err) {
        if (!cancel) setError(messageOf(err, t("common.error")));
      } finally {
        if (!cancel) setBusy(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [reload, t]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.post("/v1/flows", form);
      setForm(empty);
      setReload((n) => n + 1);
    } catch (err) {
      setError(messageOf(err, t("common.error")));
      setBusy(false);
    }
  }

  async function onDelete(id: number) {
    setBusy(true);
    setError("");
    try {
      await api.del(`/v1/flows?id=${id}`);
      setReload((n) => n + 1);
    } catch (err) {
      setError(messageOf(err, t("common.error")));
      setBusy(false);
    }
  }

  async function onRun(id: number) {
    setBusy(true);
    setError("");
    try {
      const out = await api.post<{ queued?: number }>(`/v1/flows/run?id=${id}`);
      setError(t("flows.queued", { count: out.queued ?? 0 }));
      setBusy(false);
    } catch (err) {
      setError(messageOf(err, t("common.error")));
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <main className="content-main">
        <div className="page-head">
          <h1>{t("flows.title")}</h1>
        </div>
        <p className="muted">{t("flows.hint")}</p>
        {admin === false ? <p className="err">{t("flows.admin_only")}</p> : null}
        {error ? <p className="muted">{error}</p> : null}
        {busy && admin !== true ? <p className="muted">{t("common.loading")}</p> : null}

        {admin === true ? (
          <>
            <form className="settings-block" onSubmit={onCreate}>
              <h2>{t("flows.new")}</h2>
              <div className="settings-grid">
                <div className="field">
                  <label htmlFor="flow-name">{t("common.name")}</label>
                  <input id="flow-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
                </div>
                <div className="field">
                  <label htmlFor="flow-trigger">{t("flows.trigger")}</label>
                  <select id="flow-trigger" className="input" value={form.trigger} onChange={(e) => setForm({ ...form, trigger: e.target.value })}>
                    <option value="upload">{t("flows.trigger_upload")}</option>
                    <option value="manual">{t("flows.trigger_manual")}</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="flow-prefix">{t("flows.prefix")}</label>
                  <input id="flow-prefix" className="input" value={form.path_prefix} placeholder="/Входящи" onChange={(e) => setForm({ ...form, path_prefix: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="flow-ext">{t("flows.ext")}</label>
                  <input id="flow-ext" className="input" value={form.ext} placeholder="pdf" onChange={(e) => setForm({ ...form, ext: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="flow-action">{t("flows.action")}</label>
                  <select
                    id="flow-action"
                    className="input"
                    value={form.action}
                    onChange={(e) => setForm({ ...form, action: e.target.value, arg: e.target.value === "mail" ? "" : "/Архив" })}
                  >
                    <option value="move">{t("flows.action_move")}</option>
                    <option value="copy">{t("flows.action_copy")}</option>
                    <option value="mail">{t("flows.action_mail")}</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="flow-arg">{form.action === "mail" ? t("flows.arg_mail") : t("flows.arg_folder")}</label>
                  <input id="flow-arg" className="input" value={form.arg} onChange={(e) => setForm({ ...form, arg: e.target.value })} required />
                </div>
              </div>
              <button type="submit" className="btn" disabled={busy}>
                {t("common.create")}
              </button>
            </form>

            <table className="table">
              <thead>
                <tr>
                  <th>{t("common.name")}</th>
                  <th>{t("flows.trigger")}</th>
                  <th>{t("flows.action")}</th>
                  <th>{t("flows.arg_folder")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      {row.name}
                      <div className="muted small">
                        {row.path_prefix || "/"} {row.ext ? `.${row.ext}` : ""}
                      </div>
                    </td>
                    <td>{row.trigger === "manual" ? t("flows.trigger_manual") : t("flows.trigger_upload")}</td>
                    <td>{t(`flows.action_${row.action}`)}</td>
                    <td>{row.arg}</td>
                    <td>
                      <button type="button" className="btn ghost" disabled={busy} onClick={() => void onRun(row.id)}>
                        {t("flows.run")}
                      </button>{" "}
                      <button type="button" className="btn ghost" disabled={busy} onClick={() => void onDelete(row.id)}>
                        {t("common.delete")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 ? <p className="muted">{t("flows.empty")}</p> : null}
          </>
        ) : null}
      </main>
    </AppShell>
  );
}

export default function FlowsPage() {
  return (
    <RequireAuth>
      <FlowsScreen />
    </RequireAuth>
  );
}
