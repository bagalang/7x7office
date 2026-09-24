"use client";

// ActivityFeed — лентата с действия в пространството (Фаза 3).
//
// Ползва се на две места:
//   - като панел за цялото пространство (бутон в горния бар);
//   - като панел „История" на конкретен файл/папка (от FilePreview).
// Затова е един компонент с `path?: string`: с път сървърът връща само
// възела и поддървото му.
//
// Защо verb-ът се превежда тук, а не идва готов от сървъра: feed-ът е
// append-only, редовете стоят с години. Ако сървърът пишеше преведен текст,
// смяната на езика нямаше да преведе старите редове. Затова базата пази
// машинния ключ (`created`), а UI-ът го рендира по `activity.verb_*`.
// Непознат verb (бъдещ вид, сгрешен ред) не се показва — виж бележката в
// `tree/activity_kinds.baga`.

import { useCallback, useEffect, useState } from "react";
import { ActivityItem, ApiError, listActivity } from "../lib/api";
import { useI18n } from "./I18nProvider";
import { useWorkspace } from "./WorkspaceProvider";
import { IconHistory } from "./icons";

function messageOf(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

// „Иван Петров" → „ИП"; „ivan@x.bg" → „IV". Същият трик като в AppShell,
// но тук се показва до действието, не в профилния кръг.
function initialsOf(name: string, email: string): string {
  const base = name.trim() || (email.split("@")[0] ?? "");
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  if (parts.length > 1) return (parts[0][0] + parts[1][0]).toUpperCase();
  return base.slice(0, 2).toUpperCase() || "?";
}

function relTime(iso: string | undefined, now: number): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const secs = Math.max(0, Math.floor((now - t) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

// meta идва суров от сървъра: обект (JSON ред) или низ. Извличаме само
// полетата, които UI-ът знае как да покаже, и никога не рендираме суров
// JSON — иначе feed-ът показва `{"from":"/a"}` вместо „от /a".
function metaField(meta: unknown, key: string): string {
  if (!meta || typeof meta !== "object") return "";
  const v = (meta as Record<string, unknown>)[key];
  return typeof v === "string" ? v : "";
}

export function ActivityFeed({
  path,
  limit = 50,
  compact = false,
}: {
  path?: string;
  limit?: number;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const { wsId } = useWorkspace();
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  // Часовник за относителното време. Не е `Date.now()` в render-а: така всеки
  // рендер дава различен низ и React не може да сравнява. Тиктаме на минута.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(id);
  }, []);

  const load = useCallback(async () => {
    setBusy(true);
    setErr("");
    try {
      const res = await listActivity({ path, limit });
      setItems(res.items ?? []);
    } catch (e) {
      setErr(messageOf(e, t("common.error")));
    } finally {
      setBusy(false);
    }
  }, [path, limit, t]);

  useEffect(() => {
    void load();
  }, [load, wsId]);

  if (busy && items.length === 0) return <p className="muted small">{t("common.loading")}</p>;
  if (err) return <p className="err">{err}</p>;
  if (items.length === 0) return <p className="muted small">{t("activity.empty")}</p>;

  return (
    <ul className={`activity${compact ? " compact" : ""}`}>
      {items.map((it) => {
        const verbKey = `activity.verb_${it.verb}`;
        const label = t(verbKey);
        // Непознат verb → ключът не се превежда и се връща непроменен. По-добре
        // да не покажем нищо, отколкото суров ключ или погрешно действие.
        if (label === verbKey) return null;
        const metaPath = metaField(it.meta, "to");
        const fromPath = metaField(it.meta, "from");
        const email = metaField(it.meta, "email");
        const who = it.actor_name || it.actor_email || (it.actor_id === 0 ? t("activity.system") : `#${it.actor_id}`);
        return (
          <li key={it.id} className="activity-row">
            <span className="activity-avatar" title={it.actor_email || who}>
              {it.actor_id === 0 ? <IconHistory width={14} height={14} /> : initialsOf(it.actor_name, it.actor_email)}
            </span>
            <span className="activity-main">
              <span className="activity-line">
                <span className="activity-actor">{who}</span> <span className="activity-verb">{label}</span>
                {it.path ? (
                  <>
                    {" "}
                    <span className="activity-path" title={it.path}>
                      {it.path}
                    </span>
                  </>
                ) : null}
              </span>
              {fromPath && metaPath ? (
                <span className="activity-meta muted small" title={`${fromPath} → ${metaPath}`}>
                  {t("activity.moved_from", { from: fromPath })}
                </span>
              ) : null}
              {email ? <span className="activity-meta muted small">{t("activity.member", { email })}</span> : null}
            </span>
            <span className="activity-time muted small" title={it.at ?? ""}>
              {relTime(it.at, now)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
