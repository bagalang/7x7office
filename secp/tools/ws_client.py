"""ws_client.py — минимален WebSocket клиент без външни зависимости.

Защо не `websockets`/`websocket-client`: тестовете на secp се пускат на
чиста машина (`tools/ws_files_smoke.sh`), а `pip install` там не е гарантиран
(и е бавен). RFC 6455 handshake-ът е ~30 реда, а сървърът ни праща само
текстови кадри без компресия и без фрагментация — покриваме точно това.

Ползва се само от тестовете. Продуктовият клиент е в `frontend/lib/ws.ts`.
"""

import base64
import hashlib
import json
import os
import socket
import struct
import time

OP_CONT = 0x0
OP_TEXT = 0x1
OP_BIN = 0x2
OP_CLOSE = 0x8
OP_PING = 0x9
OP_PONG = 0xA

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


class WsError(Exception):
    pass


class WsClient:
    """Блокиращ WS клиент: connect → send_text/recv_text.

    `recv_text(timeout)` връща низ или хвърля `TimeoutError`. Control кадрите
    (ping) се отговарят автоматично, както прави всеки браузър — иначе
    сървърът ни брои за мъртви и затваря канала след `ping_ms`.
    """

    def __init__(self, host, port, path="/ws", timeout=5.0, extra_headers=None):
        self.sock = socket.create_connection((host, port), timeout=timeout)
        self.sock.settimeout(timeout)
        self.buf = b""
        self.closed = False
        self._handshake(host, port, path, extra_headers)

    def _handshake(self, host, port, path, extra_headers=None):
        key = base64.b64encode(os.urandom(16)).decode()
        req = (
            f"GET {path} HTTP/1.1\r\n"
            f"Host: {host}:{port}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n"
        )
        # Извънредните header-и са за проверката на пътя на БРАУЗЪРА: той не
        # може да сложи `Authorization`, затова токенът идва в Cookie.
        for name, value in (extra_headers or {}).items():
            req += f"{name}: {value}\r\n"
        req += "\r\n"
        self.sock.sendall(req.encode())
        head = b""
        while b"\r\n\r\n" not in head:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise WsError(f"връзката затворена по време на handshake: {head!r}")
            head += chunk
        raw, _, rest = head.partition(b"\r\n\r\n")
        self.buf = rest
        text = raw.decode("latin-1")
        status = text.split("\r\n")[0]
        if "101" not in status:
            # Сървърът ни отговаря с истински HTTP статус, когато отказва
            # (401/404/400) — това е смисълът на теста, затова го връщаме.
            raise WsError(f"upgrade отказан: {status}")
        expect = base64.b64encode(
            hashlib.sha1((key + GUID).encode()).digest()
        ).decode()
        if expect.lower() not in text.lower():
            raise WsError("грешен Sec-WebSocket-Accept")

    # --- кадри ---

    def _send_frame(self, opcode, payload=b""):
        mask = os.urandom(4)
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        n = len(payload)
        if n < 126:
            head = struct.pack("!BB", 0x80 | opcode, 0x80 | n)
        elif n < 65536:
            head = struct.pack("!BBH", 0x80 | opcode, 0x80 | 126, n)
        else:
            head = struct.pack("!BBQ", 0x80 | opcode, 0x80 | 127, n)
        self.sock.sendall(head + mask + masked)

    def send_text(self, text):
        self._send_frame(OP_TEXT, text.encode())

    def send_json(self, obj):
        self.send_text(json.dumps(obj, separators=(",", ":")))

    def send_ping(self, payload=b""):
        self._send_frame(OP_PING, payload)

    def send_close(self, code=1000):
        self._send_frame(OP_CLOSE, struct.pack("!H", code))

    def _recv_exact(self, n):
        while len(self.buf) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise WsError("EOF от сървъра")
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def _recv_frame(self):
        b0, b1 = self._recv_exact(2)
        fin = b0 & 0x80
        opcode = b0 & 0x0F
        masked = b1 & 0x80
        n = b1 & 0x7F
        if n == 126:
            n = struct.unpack("!H", self._recv_exact(2))[0]
        elif n == 127:
            n = struct.unpack("!Q", self._recv_exact(8))[0]
        mask = self._recv_exact(4) if masked else None
        payload = self._recv_exact(n) if n else b""
        if mask:
            payload = bytes(p ^ mask[i % 4] for i, p in enumerate(payload))
        return fin, opcode, payload

    def recv_text(self, timeout=5.0):
        """Следващото ТЕКСТОВО съобщение (control кадрите се обслужват вътре)."""
        deadline = time.time() + timeout
        while True:
            left = deadline - time.time()
            if left <= 0:
                raise TimeoutError("няма съобщение в срока")
            self.sock.settimeout(max(0.05, left))
            fin, opcode, payload = self._recv_frame()
            if opcode == OP_TEXT:
                return payload.decode()
            if opcode == OP_PING:
                self._send_frame(OP_PONG, payload)
                continue
            if opcode == OP_PONG:
                return None  # маркер за pong; викащият реши какво да прави
            if opcode == OP_CLOSE:
                self.closed = True
                self.sock.close()
                return None
            # bin / cont не ползваме — игнорираме, за да не чупим теста.

    def recv_json(self, timeout=5.0):
        while True:
            text = self.recv_text(timeout)
            if text is None:
                raise TimeoutError("каналът се затвори без съобщение")
            return json.loads(text)

    def wait_for(self, predicate, timeout=8.0):
        """Чака съобщение, което да отговаря на `predicate`."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            left = max(0.1, deadline - time.time())
            try:
                msg = self.recv_json(left)
            except TimeoutError:
                return None
            if predicate(msg):
                return msg
        return None

    def close(self):
        try:
            if not self.closed:
                self.send_close()
        except OSError:
            pass
        try:
            self.sock.close()
        except OSError:
            pass


def handshake_status(host, port, path):
    """Само handshake → статусът като низ (или изключение). Ползва се за
    проверките „лош токен → 401", „грешен път → 404", където не искаме
    отворен канал."""
    try:
        c = WsClient(host, port, path)
        c.close()
        return "101"
    except WsError as e:
        msg = str(e)
        if "upgrade отказан: " in msg:
            return msg.split("upgrade отказан: ", 1)[1].split(" ", 1)[0]
        raise
