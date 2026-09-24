"use client";

// RealtimeProvider — една WS връзка за целия таб (Фаза 3).
//
// ЗАЩО ЕДНА, А НЕ ПО КОМПОНЕНТ: каналът струва fd на сървъра; 10 компонента
// с по един сокет е 10 абонамента за същото пространство. Затова връзката
// живее тук, а компонентите се абонират за събития през контекста.
//
// Събитията се раздават на абонатите (listeners) и НЕ се пазят в state:
// всеки компонент знае какво да презареди. Пазенето на „последно събитие" в
// контекст би предизвикало нов render на цялото дърво при всеки одит ред.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  ReactNode,
} from "react";
import { RealtimeClient, WsStatus, WS_PROTOCOL } from "../lib/ws";
import { readStorage, subscribeStorage } from "../lib/storage";
import { TOKEN_KEY, getActiveWorkspace } from "../lib/api";
import { useWorkspace } from "./WorkspaceProvider";

// Машинните имена идват направо от сървъра (`system/ws_events.baga`) —
// тук няма втори списък, който да се разминава.
export type WsEventName = string;

export type WsEventListener = (ev: {
  event: WsEventName;
  item: Record<string, unknown>;
  workspaceId: number;
}) => void;

interface RealtimeContextValue {
  status: WsStatus;
  protocolMismatch: boolean;
  // Абонира се за събития. Връща функция за отписване.
  subscribe: (fn: WsEventListener) => () => void;
}

const noop = () => () => {};

const RealtimeContext = createContext<RealtimeContextValue>({
  status: "idle",
  protocolMismatch: false,
  subscribe: noop,
});

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { wsId } = useWorkspace();
  const token = useSyncExternalStore(
    subscribeStorage,
    () => readStorage(TOKEN_KEY) ?? "",
    () => "",
  );
  const [status, setStatus] = useState<WsStatus>("idle");
  const [protocolMismatch, setProtocolMismatch] = useState(false);
  // Абонатите са в ref, не в state: добавянето на слушател не бива да
  // предизвиква render (иначе всеки mount прави нов render на всички).
  const listeners = useRef<Set<WsEventListener>>(new Set());
  const client = useRef<RealtimeClient | null>(null);

  const subscribe = useCallback((fn: WsEventListener) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  useEffect(() => {
    // Без вход каналът няма как да се удостовери (upgrade-ът ще върне 401).
    // Не отваряме „мълчащ" сокет, който само ще трупа грешки в конзолата.
    if (!token) {
      client.current?.close();
      client.current = null;
      setStatus("idle");
      return;
    }
    if (!client.current) {
      client.current = new RealtimeClient({
        onStatus: setStatus,
        onEvent: (ev) => {
          for (const fn of listeners.current) {
            fn({ event: ev.event, item: ev.item, workspaceId: ev.workspace_id });
          }
        },
        onResync: () => {
          // Възстановена връзка: събитията от паузата ги няма (сървърът дава
          // нов курсор). Караме слушателите да презаредят — затова пращаме
          // синтетично събитие с името `resync`, което всеки разпознава.
          for (const fn of listeners.current) {
            fn({ event: "resync", item: {}, workspaceId: getActiveWorkspace() });
          }
        },
        onError: (reason) => {
          if (reason === "protocol") setProtocolMismatch(true);
        },
      });
    }
    client.current.open(wsId);
  }, [token, wsId]);

  // Размонтиране на provider-а = край на живота на таба (или изход).
  useEffect(() => {
    return () => {
      client.current?.close();
      client.current = null;
    };
  }, []);

  const value = useMemo<RealtimeContextValue>(
    () => ({ status, protocolMismatch, subscribe }),
    [status, protocolMismatch, subscribe],
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime() {
  return useContext(RealtimeContext);
}

// Помощник за компонент: „презареди, когато дойде събитие за ВЪЗЕЛ".
//
// Защо филтърът е тук, а не във всеки компонент: смяната на роля не променя
// файловете и не бива да кара FileBrowser да презарежда на всеки одит ред
// (членството е често в активен екип). `node.*` е събитие по съдържанието;
// `resync` значи „пропуснал си — презареди задължително".
export function useNodeEvents(onChange: () => void): void {
  const { subscribe } = useRealtime();
  const cb = useRef(onChange);
  // Ref-ът се обновява в effect, не по време на render: последното
  // `onChange` трябва да е налично на слушателя, без да пресъздаваме
  // абонамента при всяка промяна на функцията (иначе отписване/записване
  // на всеки render).
  useEffect(() => {
    cb.current = onChange;
  }, [onChange]);
  useEffect(() => {
    return subscribe((ev) => {
      if (ev.event === "resync" || ev.event.startsWith("node.")) {
        cb.current();
      }
    });
  }, [subscribe]);
}

// Заглавен индикатор: „има ново" (badge). Връща брояч и функция за
// изчистване. Броят се вдига само от събития по ВЪЗЛИ и то ако не са
// предизвикани от текущия потребител... сървърът не знае кой гледа, затова
// филтърът по actor е на клиента (тук).
export function useActivityBadge(selfEmail: string | undefined) {
  const { subscribe } = useRealtime();
  const [count, setCount] = useState(0);
  useEffect(() => {
    return subscribe((ev) => {
      if (ev.event === "resync") return;
      if (!ev.event.startsWith("node.") && !ev.event.startsWith("ws.member_")) return;
      const actor = typeof ev.item.actor_email === "string" ? ev.item.actor_email : "";
      // Собственото действие не е „новост" за мен — иначе всеки качен от
      // мен файл вдига брояча, който тъкмо изчистих.
      if (selfEmail && actor && actor === selfEmail) return;
      setCount((n) => n + 1);
    });
  }, [subscribe, selfEmail]);
  const clear = useCallback(() => setCount(0), []);
  return { count, clear };
}

export { WS_PROTOCOL };
