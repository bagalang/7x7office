#!/usr/bin/env python3
# Мини S3 (path-style) за smoke: пази обекти и проверява AWS SigV4.
import hashlib, hmac, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ACCESS = "AKIAtest"
SECRET = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
REGION = "us-east-1"
STORE = {}


def sign_key(secret, stamp, region, service):
    k = ("AWS4" + secret).encode()
    k = hmac.new(k, stamp.encode(), hashlib.sha256).digest()
    k = hmac.new(k, region.encode(), hashlib.sha256).digest()
    k = hmac.new(k, service.encode(), hashlib.sha256).digest()
    return hmac.new(k, b"aws4_request", hashlib.sha256).digest()


def expect(method, uri, host, amz, ph):
    canon = "\n".join([
        method,
        uri,
        "",
        "host:" + host,
        "x-amz-content-sha256:" + ph,
        "x-amz-date:" + amz,
        "",
        "host;x-amz-content-sha256;x-amz-date",
        ph,
    ])
    ch = hashlib.sha256(canon.encode()).hexdigest()
    scope = amz[:8] + "/" + REGION + "/s3/aws4_request"
    sts = "AWS4-HMAC-SHA256\n" + amz + "\n" + scope + "\n" + ch
    sig = hmac.new(sign_key(SECRET, amz[:8], REGION, "s3"), sts.encode(), hashlib.sha256).hexdigest()
    return (
        "AWS4-HMAC-SHA256 Credential="
        + ACCESS
        + "/"
        + scope
        + ", SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature="
        + sig
    )


class H(BaseHTTPRequestHandler):
    def _read(self):
        n = int(self.headers.get("Content-Length", "0"))
        return self.rfile.read(n) if n else b""

    def _auth(self, body):
        ph = hashlib.sha256(body).hexdigest()
        got = self.headers.get("Authorization", "")
        host = self.headers.get("Host", "")
        amz = self.headers.get("x-amz-date", "")
        sent = self.headers.get("x-amz-content-sha256", "")
        if sent != ph:
            self.send_error(400, "bad payload hash")
            return False
        want = expect(self.command, self.path, host, amz, ph)
        if got != want:
            sys.stderr.write("sig mismatch\n want " + want + "\n got  " + got + "\n")
            self.send_error(403, "bad signature")
            return False
        return True

    def _key(self):
        # /bucket/key
        parts = self.path.split("/", 2)
        if len(parts) < 3:
            return ""
        return parts[2]

    def do_PUT(self):
        body = self._read()
        if not self._auth(body):
            return
        STORE[self._key()] = body
        self.send_response(200)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        if not self._auth(b""):
            return
        key = self._key()
        if key not in STORE:
            self.send_error(404, "missing")
            return
        body = STORE[key]
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_HEAD(self):
        if not self._auth(b""):
            return
        key = self._key()
        if key not in STORE:
            self.send_error(404, "missing")
            return
        self.send_response(200)
        self.send_header("Content-Length", str(len(STORE[key])))
        self.end_headers()

    def do_DELETE(self):
        if not self._auth(b""):
            return
        STORE.pop(self._key(), None)
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("s3 " + (fmt % args) + "\n")


if __name__ == "__main__":
    port = int(sys.argv[1])
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
