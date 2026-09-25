#!/usr/bin/env python3
# Мини OTLP/JSON колектор: пази телата на POST /v1/traces.
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

OUT = "/tmp/secp_otel_spans.jsonl"


class H(BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(n) if n else b""
        with open(OUT, "ab") as f:
            f.write(body + b"\n")
        self.send_response(200)
        self.send_header("Content-Length", "2")
        self.end_headers()
        self.wfile.write(b"{}")

    def log_message(self, fmt, *args):
        sys.stderr.write("otel " + (fmt % args) + "\n")


if __name__ == "__main__":
    port = int(sys.argv[1])
    open(OUT, "w").close()
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
