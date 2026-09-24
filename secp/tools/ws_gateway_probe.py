#!/usr/bin/env python3
"""ws_gateway_probe.py — сценариите на `ws_events_smoke.sh` върху живия канал.

Всеки сценарий е един процес: свързва се, прави нещо и печата един последен
ред, който shell-ът сравнява. Така тестът е четим и няма нужда от фонови
клиенти — `--case listen` е единственият, който чака.

Печата се машинен резултат (`key=value`), не текст: сравнението в shell-а е
точно, а не „съдържа някъде".
"""

import argparse
import json
import sys

from ws_client import WsClient, WsError


def ws_query(token):
    q = f"?token={token}" if token else ""
    return "/ws" + q


def connect(args, path=None, headers=None):
    return WsClient(args.host, args.port, path or ws_query(args.token),
                    extra_headers=headers)


def sync(c, ws=0, proto=1, timeout=5.0):
    """Абонира се и изяжда ВСИЧКО до `hello` (вкл. евентуален `error`).

    ЗАЩО НЕ `subscribed` + `hello` на две четения: сървърът праща и двете
    съобщения, но клиентът (и този тест) не бива да разчита на точния им
    брой — ако добавим трето съобщение в бъдеще, тестът щеше да „изяде"
    следващия отговор и да сравни грешното нещо. Чакането на `hello` е
    стабилната котва: то е договорено като последно в ръкостискането.
    """
    c.send_json({"type": "subscribe", "workspace_id": ws, "protocol": proto})
    msg = c.wait_for(lambda m: m.get("type") in ("hello", "error"), timeout)
    if msg is None:
        raise TimeoutError("няма hello/error след subscribe")
    return msg


# ---------- сценарии ----------

def case_deny(args):
    """Опит за upgrade без/с лош токен или на чужд път → HTTP КОД.

    Печата само цифровия код (`401`/`404`), не „HTTP/1.1 401 ...": така
    shell-ът сравнява точно и не зависи от reason phrase-а (който сървърът
    може да смени).
    """
    try:
        path = args.path if args.path else ws_query(args.token)
        c = connect(args, path=path)
        c.close()
        print("opened")
        return 0
    except WsError as e:
        msg = str(e)
        if "upgrade отказан: " in msg:
            # „HTTP/1.1 401 Unauthorized" → взимаме токена след протокола.
            parts = msg.split("upgrade отказан: ", 1)[1].split()
            print(parts[1] if len(parts) > 1 else parts[0] if parts else "?")
            return 0
        print(f"err={msg}")
        return 1


def case_subscribe(args):
    """Трябва да получи и `subscribed`, и `hello` — в този ред."""
    c = connect(args)
    c.send_json({"type": "subscribe", "workspace_id": 0, "protocol": 1})
    first = c.wait_for(lambda m: m.get("type") in ("subscribed", "error"))
    second = c.wait_for(lambda m: m.get("type") in ("hello", "error"))
    ok = "subscribed=ok" if (first or {}).get("type") == "subscribed" else f"subscribed={first}"
    ok2 = "hello=ok" if (second or {}).get("type") == "hello" else f"hello={second}"
    proto = (second or {}).get("protocol", "?")
    c.close()
    print(f"{ok} {ok2} proto={proto}")
    return 0


def case_badproto(args):
    """Протокол 999 (бъдещ) → error, не silently ignored."""
    c = connect(args)
    c.send_json({"type": "subscribe", "workspace_id": 0, "protocol": 999})
    msg = c.wait_for(lambda m: m.get("type") == "error")
    c.close()
    if msg is not None and msg.get("reason") == "protocol":
        print("proto_error=ok")
        return 0
    print(f"proto_error={msg}")
    return 1


def case_unknown_ws(args):
    """Чуждо/несъществуващо пространство → not_found (не 403)."""
    c = connect(args)
    c.send_json({"type": "subscribe", "workspace_id": 987654, "protocol": 1})
    msg = c.wait_for(lambda m: m.get("type") == "error")
    c.close()
    if msg is not None and msg.get("reason") == "not_found":
        print("ws_not_found=ok")
        return 0
    print(f"ws_not_found={msg}")
    return 1


def case_ping(args):
    c = connect(args)
    sync(c)
    c.send_json({"type": "ping"})
    msg = c.wait_for(lambda m: m.get("type") == "pong")
    c.close()
    print("pong=ok" if msg else "pong=none")
    return 0 if msg else 1


def case_close(args):
    c = connect(args)
    sync(c)
    c.send_close(1000)
    # Сървърът трябва да отговори със затварящ кадър и да затвори TCP-то.
    text = c.recv_text(3.0)
    c.close()
    print("close=ok" if text is None else f"close={text!r}")
    return 0


def case_unicode(args):
    """Дължината на кадъра е в БАЙТОВЕ, не в знаци.

    Двете грешки, които това хваща:
      - ако сървърът строи кадъра с дължина в знаци, кирилицата/емоджито
        дават frame с грешен размер и клиентът чете боклук;
      - ако таванът `SECP_WS_MSG_MAX` се мери в знаци, 3000 кирилски знака
        (6000 байта) минават, а трябва да са над 4096.

    Проверява и че НАД лимита дава `error too_large`, вместо да скъса
    връзката (сгрешен клиент не бива да събаря канала).
    """
    c = connect(args)
    sync(c)

    # 1. Под лимита, но многобайтово: ~1500 кирилски знака = ~3000 байта.
    # Приема се и отговорът е ЧЕТИМ (не развален кадър).
    pad_ok = "я" * 1500
    c.send_text(json.dumps({"type": "subscribe", "workspace_id": 0,
                            "protocol": 1, "pad": pad_ok},
                           ensure_ascii=False))
    hello = c.wait_for(lambda m: m.get("type") in ("hello", "error"))
    if hello is None or hello.get("type") != "hello":
        c.close()
        print(f"utf8_ok=fail:{hello}")
        return 1

    # 2. Над лимита (5000 знака × 2 байта + емоджи) → too_large.
    too_big = "тест-🚀-" + ("я" * 5000)
    c.send_text(json.dumps({"type": "subscribe", "workspace_id": 0,
                            "protocol": 1, "pad": too_big},
                           ensure_ascii=False))
    err = c.wait_for(lambda m: m.get("type") == "error")
    if err is None or err.get("reason") != "too_large":
        c.close()
        print(f"too_large={err}")
        return 1

    # 3. Връзката е ЖИВА след отказа (не сме я скъсали).
    c.send_json({"type": "ping"})
    alive = c.wait_for(lambda m: m.get("type") == "pong", 3.0)
    c.close()
    if not alive:
        print("alive_after_too_large=fail")
        return 1
    print("utf8_ok=ok too_large=ok alive=ok")
    return 0


def case_proto_future(args):
    """Точно това, което прави кешираният (стар) клиент: праща своя номер."""
    c = connect(args)
    c.send_json({"type": "subscribe", "workspace_id": 0, "protocol": 999})
    msg = c.wait_for(lambda m: m.get("type") == "error")
    # След error каналът остава отворен (клиентът може да се презареди).
    c.send_json({"type": "ping"})
    still = c.wait_for(lambda m: m.get("type") == "pong", 2.0)
    c.close()
    if msg is not None and msg.get("reason") == "protocol" and still:
        print("proto_rejected=ok")
        return 0
    print(f"proto_rejected={msg} alive={bool(still)}")
    return 1


def case_cookie(args):
    """Браузърът не може да сложи Authorization на WS upgrade — носи Cookie."""
    headers = {"Cookie": f"secp_token={args.token}; other=x"}
    c = connect(args, path="/ws", headers=headers)
    sync(c)
    c.close()
    print("cookie=ok")
    return 0


def case_listen(args):
    """Абонира се, маркира `ready` и чака събития `--live` секунди.

    Пише във `--out` (ред по ред), защото shell-ът чака `ready`, преди да
    задейства действието — иначе събитието изпреварва абонамента.
    """
    out = open(args.out, "w", buffering=1)
    try:
        c = connect(args)
        hello = sync(c, ws=args.ws)
        if hello.get("type") != "hello":
            out.write("not_subscribed\n")
            return 1
        out.write("ready\n")
        import time
        deadline = time.time() + args.live
        seen = 0
        while time.time() < deadline:
            left = max(0.1, deadline - time.time())
            try:
                msg = c.recv_json(left)
            except TimeoutError:
                continue
            if msg is None:
                break
            if msg.get("type") != "event":
                continue
            item = msg.get("item") or {}
            out.write(f"event {msg.get('event')}\n")
            out.write(f"path {item.get('path')}\n")
            out.write(f"verb {item.get('verb')}\n")
            out.write(f"actor {item.get('actor_email')}\n")
            if not item.get("actor_email"):
                out.write("actor_bad\n")
            seen += 1
        c.close()
    finally:
        out.close()
    return 0


CASES = {
    "deny": case_deny,
    "subscribe": case_subscribe,
    "badproto": case_badproto,
    "unknown_ws": case_unknown_ws,
    "ping": case_ping,
    "close": case_close,
    "unicode": case_unicode,
    "proto_future": case_proto_future,
    "cookie": case_cookie,
    "listen": case_listen,
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--case", choices=sorted(CASES), required=True)
    ap.add_argument("--token", default="")
    ap.add_argument("--path", default="")
    ap.add_argument("--ws", type=int, default=0)
    ap.add_argument("--live", type=float, default=8.0)
    ap.add_argument("--out", default="/tmp/ws_probe_out.txt")
    args = ap.parse_args()
    try:
        return CASES[args.case](args)
    except WsError as e:
        print(f"wserr={e}")
        return 1
    except TimeoutError:
        print("timeout")
        return 1


if __name__ == "__main__":
    sys.exit(main())
