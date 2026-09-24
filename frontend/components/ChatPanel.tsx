"use client";

// Чат на пространството (Фаза 3). Стаята е самото пространство: членовете
// вече са там, отделна „клетка" не се пази.
//
// Историята идва по HTTP. Новите реплики идват по канала като
// `chat.message`, за да не презареждаме целия списък на всеки ред.

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { ApiError, ChatMessage, listChat, postChat } from "../lib/api";
import { useI18n } from "./I18nProvider";
import { useWorkspace } from "./WorkspaceProvider";
import { useRealtime } from "./RealtimeProvider";

function messageOf(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

function whoOf(m: ChatMessage): string {
  return m.author_name || m.author_email || `#${m.author_id}`;
}

export function ChatPanel() {
  const { t } = useI18n();
  const { wsId } = useWorkspace();
  const { subscribe } = useRealtime();
  const [items, setItems] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const seen = useRef<Set<number>>(new Set());

  const load = useCallback(async () => {
    setErr("");
    try {
      const res = await listChat(50);
      const rows = res.items ?? [];
      seen.current = new Set(rows.map((m) => m.id));
      setItems(rows);
    } catch (e) {
      setErr(messageOf(e, t("common.error")));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load, wsId]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items]);

  useEffect(() => {
    return subscribe((ev) => {
      if (ev.event === "resync") {
        void load();
        return;
      }
      if (ev.event !== "chat.message") return;
      const item = ev.item as unknown as ChatMessage;
      if (!item || typeof item.id !== "number" || typeof item.text !== "string") return;
      if (seen.current.has(item.id)) return;
      seen.current.add(item.id);
      setItems((prev) => [...prev, item].slice(-200));
    });
  }, [subscribe, load]);

  async function onSend(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    if (new TextEncoder().encode(body).length > 2000) {
      setErr(t("chat.too_long"));
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const saved = await postChat(body);
      setText("");
      if (!seen.current.has(saved.id)) {
        seen.current.add(saved.id);
        setItems((prev) => [...prev, saved].slice(-200));
      }
    } catch (e) {
      setErr(messageOf(e, t("common.error")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="chat-panel">
      <div className="chat-log" ref={listRef}>
        {items.length === 0 ? <p className="muted small">{t("chat.empty")}</p> : null}
        {items.map((m) => (
          <div key={m.id} className="chat-row">
            <div className="chat-who">{whoOf(m)}</div>
            <div className="chat-text">{m.text}</div>
          </div>
        ))}
      </div>
      {err ? <p className="err">{err}</p> : null}
      <form className="chat-form" onSubmit={(e) => void onSend(e)}>
        <input
          className="input"
          value={text}
          maxLength={2000}
          placeholder={t("chat.placeholder")}
          aria-label={t("chat.placeholder")}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="btn" disabled={busy || text.trim() === ""}>
          {t("chat.send")}
        </button>
      </form>
    </div>
  );
}
