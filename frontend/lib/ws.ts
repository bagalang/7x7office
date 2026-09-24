// lib/ws.ts — realtime каналът към secp (Фаза 3).
//
// Тънък клиент на `system/ws_events.baga` (протоколът): абонира се за едно
// пространство и получава новите одитни редове като събития. Ползва се от
// `RealtimeProvider`, а не директно от компоненти.
//
// ЗАЩО САМО ЕДНА ВРЪЗКА НА ТАБ: каналът е за екип, а всеки сокет струва fd
// на сървъра (`ws_subs_max_clamp`). Един таб = една връзка, колкото и
// компонента да слушат; затова състоянието е в контекст, не в компонент.
//
// ЗАЩО TOKEN-ЪТ НЕ Е В URL-а ПО ПОДРАЗБИРАНЕ: сървърът приема и `?token=`
// (за не-браузър клиенти), но браузърният път е Cookie-то `secp_token`,
// което сървърът чете при upgrade-а. Токен в URL-а влиза в логовете на
// прокситата — затова се ползва само ако е изрично зададено
// `NEXT_PUBLIC_WS_TOKEN_IN_URL=1` (напр. когато WS-ът е на друг хост и
// бисквитката не пътува).

import { getToken } from "./api";

// Номерът на протокола. ТРЯБВА да съвпада с `ws_proto()` в
// `secp/system/ws_events.baga`. Смяната на формата на съобщенията вдига
// номера и тук, и там — иначе сървърът ни отказва с `error: protocol`.
export const WS_PROTOCOL = 1;

export type WsEvent = {
  type: "event";
  event: string;
  workspace_id: number;
  // Редът е в СЪЩИЯ вид като от `GET /v1/activity` — един модел за клиента,
  // независимо дали е дошъл по HTTP или по канала.
  item: Record<string, unknown>;
};

type WsMessage = {
  type: string;
  protocol?: number;
  workspace_id?: number;
  cursor?: number;
  event?: string;
  item?: Record<string, unknown>;
  reason?: string;
  msg?: string;
};

export type WsStatus = "idle" | "connecting" | "open" | "closed";

export type WsHandlers = {
  onStatus?: (s: WsStatus) => void;
  onEvent?: (ev: WsEvent) => void;
  // Извиква се след ВЪЗСТАНОВЕНА връзка: клиентът е пропуснал събития,
  // докато е бил офлайн (сървърът дава нов курсор при subscribe), затова
  // слушателят трябва да презареди веднъж. Без това таб, оставен за през
  // нощта, показва срязано състояние до следващото действие.
  onResync?: () => void;
  // Грешка по протокола (`reason` е машинен ключ: protocol/busy/not_found).
  onError?: (reason: string, msg: string) => void;
};

// Интервалът на сърдечния ритъм. По-малък от сървърния ping (30 s), за да
// усетим мъртва връзка от наша страна — браузърът не ни казва, че TCP-то
// е умряло, докато не опитаме запис.
const PING_MS = 20000;

// Backoff при прекъсване. Капакът е 15 s: по-дълго чакане прави UI-а
// „замръзнал" при кратък рестарт на сървъра; по-кратко е шум при спрян.
const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 15000;

// Адресът на канала.
//
// РЕД НА ИЗБОР (и защо точно такъв):
// 1. `NEXT_PUBLIC_WS_URL` — изричен адрес (ws:// или wss://). Ползва се, когато
//    каналът е на собствен хост/порт и пред него стои прокси, което подава
//    upgrade-а (nginx `map $http_upgrade`, Caddy `reverse_proxy`, HAProxy).
//    НЕ работи за `next dev`: Next проксира само HTTP заявки, а WebSocket
//    upgrade-ът минава през него като обикновена заявка и връща 404.
// 2. `NEXT_PUBLIC_WS_PORT` — dev улеснение: същият хост, но портът на secp
//    (`SECP_WS_PORT`, по подразбиране 8086). Нужно е, защото `next dev` слуша
//    на 3010, а каналът е на 8086, и Next не може да го проксира. Cookie-то
//    е по ХОСТ, не по порт — затова `secp_token` от 3010 стига и до 8086.
// 3. same-origin `/ws` — production: пред Next и secp стои едно прокси, което
//    подава `/ws` към `SECP_WS_PORT`. Тогава няма нужда от нищо друго.
export function wsUrl(workspaceId: number): string {
  const base = process.env.NEXT_PUBLIC_WS_URL;
  let url: string;
  if (base) {
    url = base.endsWith("/ws") ? base : `${base.replace(/\/+$/, "")}/ws`;
  } else if (process.env.NEXT_PUBLIC_WS_PORT) {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    url = `${proto}//${window.location.hostname}:${process.env.NEXT_PUBLIC_WS_PORT}/ws`;
  } else {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    url = `${proto}//${window.location.host}/ws`;
  }
  // Токен в URL-а само по изрично искане (виж бележката в началото). Дори
  // тогава `workspace_id` не влиза в адреса: той се праща в `subscribe`,
  // за да не се разминават „каналът" и „абонаментът".
  if (process.env.NEXT_PUBLIC_WS_TOKEN_IN_URL === "1") {
    const t = getToken();
    if (t) url += `?token=${encodeURIComponent(t)}`;
  }
  void workspaceId;
  return url;
}

// Една връзка, един абонамент. Животът ѝ е животът на таба.
export class RealtimeClient {
  private sock: WebSocket | null = null;
  private handlers: WsHandlers;
  private ws = 0;
  private cursor = 0;
  private pingTimer: number | null = null;
  private retryTimer: number | null = null;
  private retryMs = RECONNECT_MIN_MS;
  private everOpen = false;
  private stopped = false;

  constructor(handlers: WsHandlers = {}) {
    this.handlers = handlers;
  }

  status(): WsStatus {
    if (this.stopped) return "closed";
    if (!this.sock) return "idle";
    return this.sock.readyState === WebSocket.OPEN ? "open" : "connecting";
  }

  // Отваря канала (или се абонира в него, ако вече е отворен). Идемпотентно:
  // смяната на пространството не бива да къса TCP-то, само абонамента.
  open(workspaceId: number): void {
    this.ws = workspaceId;
    this.stopped = false;
    if (this.sock) {
      // Вече има връзка: сменяме само абонамента. Сървърът приема повторен
      // subscribe и връща нов курсор — така не отваряме втори сокет.
      if (this.sock.readyState === WebSocket.OPEN) this.subscribe();
      return;
    }
    this.connect();
  }

  close(): void {
    this.stopped = true;
    this.clearTimers();
    if (this.sock) {
      // Не пипаме readyState: `close()` по време на CONNECTING хвърля в стар
      // WebKit, затова просто пускаме референцията и оставяме GC/браузъра.
      try {
        this.sock.close();
      } catch {
        /* нищо: затворена вече */
      }
      this.sock = null;
    }
    this.handlers.onStatus?.("closed");
  }

  private clearTimers(): void {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.retryTimer !== null) {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private connect(): void {
    this.handlers.onStatus?.("connecting");
    let sock: WebSocket;
    try {
      sock = new WebSocket(wsUrl(this.ws));
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.sock = sock;

    sock.onopen = () => {
      this.retryMs = RECONNECT_MIN_MS;
      this.handlers.onStatus?.("open");
      this.subscribe();
      // Сърдечен ритъм: сървърът отговаря с ТЕКСТОВ `pong` (не control
      // кадър), защото браузърното API не показва control кадрите на JS.
      this.pingTimer = window.setInterval(() => this.send({ type: "ping" }), PING_MS);
    };

    sock.onmessage = (ev: MessageEvent<string>) => this.handle(ev.data);

    sock.onerror = () => {
      // onerror не носи причина (браузърът крие детайли). Затваряме и
      // разчитаме на onclose за reconnect — иначе можем да останем в
      // readyState CLOSING без onclose при някои браузъри.
      this.clearPing();
    };

    sock.onclose = () => {
      this.clearPing();
      this.sock = null;
      if (this.stopped) return;
      this.handlers.onStatus?.("closed");
      this.scheduleReconnect();
    };
  }

  private clearPing(): void {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.retryTimer !== null) return;
    const wait = this.retryMs;
    // Растежът е експоненциален само след ПЪРВИ успешен вход: при спрян
    // сървър иначе ще стигнем капака за секунди и UI-ът ще чака 15 s дори
    // след като сървърът е готов.
    this.retryMs = this.everOpen
      ? Math.min(RECONNECT_MAX_MS, this.retryMs * 2)
      : RECONNECT_MIN_MS;
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, wait);
  }

  private send(obj: unknown): void {
    if (!this.sock || this.sock.readyState !== WebSocket.OPEN) return;
    try {
      this.sock.send(JSON.stringify(obj));
    } catch {
      // Запис в затваряща се връзка: onclose ще се погрижи за reconnect.
    }
  }

  private subscribe(): void {
    this.send({ type: "subscribe", workspace_id: this.ws, protocol: WS_PROTOCOL });
  }

  private handle(raw: string): void {
    let m: WsMessage;
    try {
      m = JSON.parse(raw) as WsMessage;
    } catch {
      return; // сървърът не праща невалиден JSON; ако прати — игнорираме
    }
    if (m.type === "hello") {
      this.cursor = typeof m.cursor === "number" ? m.cursor : 0;
      // Възстановена връзка (не първата): събитията, станали докато сме били
      // офлайн, не идват (курсорът е новият максимум) — затова караме
      // слушателя да презареди веднъж.
      if (this.everOpen) this.handlers.onResync?.();
      this.everOpen = true;
      return;
    }
    if (m.type === "subscribed") return;
    if (m.type === "pong") return;
    if (m.type === "error") {
      this.handlers.onError?.(m.reason ?? "server", m.msg ?? "");
      return;
    }
    if (m.type === "event" && m.event && m.item) {
      if (typeof m.item.id === "number") this.cursor = m.item.id as number;
      this.handlers.onEvent?.({
        type: "event",
        event: m.event,
        workspace_id: m.workspace_id ?? this.ws,
        item: m.item,
      });
    }
    // Непознат тип: ново съобщение от по-нов сървър. Тишината е нарочна —
    // по-добре стар клиент без нова функция, отколкото счупен.
  }
}
