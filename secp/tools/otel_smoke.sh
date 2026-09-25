#!/usr/bin/env bash
# otel_smoke.sh — traceparent по целия HTTP път и bulkhead 429.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/target/secp"
DB="${OTEL_SMOKE_DB:-secp_otel}"
PORT="${OTEL_SMOKE_PORT:-8132}"
OPORT="${OTEL_MOCK_PORT:-9132}"
PGURL="${PGURL:-postgresql://bagatest:pas+123@127.0.0.1:5432}"
DATA_ROOT="${OTEL_SMOKE_DATA:-/tmp/secp_otel_storage}"
B="http://127.0.0.1:$PORT"
PIDF=/tmp/secp_otel.pid
MOCK=/tmp/secp_otel_mock.pid
SPANS=/tmp/secp_otel_spans.jsonl
FAILED=0
pass() { echo "  ok   $1"; }
fail() { echo "  FAIL $1"; FAILED=1; }

boot() {
  cd /tmp
  PORT="$PORT" SECP_WS_PORT=0 SECP_SCHED_MS=0 JWT_SECRET=otel-smoke \
    FMR_WORKERS=2 SECP_BULKHEAD=1 SECP_BULKHEAD_HOLD_MS=400 \
    SECP_OTEL_URL="http://127.0.0.1:$OPORT/v1/traces" \
    PGHOST=127.0.0.1 PGPORT=5432 PGUSER=bagatest PGPASSWORD='pas+123' PGDATABASE="$DB" \
    SECP_DATA_ROOT="$DATA_ROOT" SECP_PASS_ITERS=1000 \
    SECP_ADMIN_EMAIL=superadmin@secp.local SECP_ADMIN_PASSWORD='123+123' \
    SECP_ADMIN_NAME=SuperAdmin "$BIN" >/tmp/secp_otel.log 2>&1 &
  echo $! >"$PIDF"
  cd - >/dev/null
  for _ in $(seq 1 60); do
    curl -s -m 1 "$B/ready" | grep -q ready && return 0
    sleep 0.5
  done
  echo "FAIL: няма /ready"; tail -40 /tmp/secp_otel.log; return 1
}

stop() {
  if [[ -f "$PIDF" ]]; then
    kill "$(cat "$PIDF")" 2>/dev/null || true
    wait "$(cat "$PIDF")" 2>/dev/null || true
    rm -f "$PIDF"
  fi
  if [[ -f "$MOCK" ]]; then
    kill "$(cat "$MOCK")" 2>/dev/null || true
    wait "$(cat "$MOCK")" 2>/dev/null || true
    rm -f "$MOCK"
  fi
}

cleanup() {
  stop
  psql -qAt "$PGURL/postgres" -c "DROP DATABASE IF EXISTS $DB" >/dev/null 2>&1 || true
  rm -rf "$DATA_ROOT"
}
trap cleanup EXIT

[[ -x "$BIN" ]] || { echo "липсва $BIN"; exit 2; }
stop
python3 "$ROOT/tools/otel_mock.py" "$OPORT" >/tmp/secp_otel_mock.log 2>&1 &
echo $! >"$MOCK"
for _ in $(seq 1 30); do
  curl -s -o /dev/null -m 1 "http://127.0.0.1:$OPORT/v1/traces" && break
  sleep 0.2
done

psql -qAt "$PGURL/postgres" -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB'" >/dev/null 2>&1
psql -qAt "$PGURL/postgres" -c "DROP DATABASE IF EXISTS $DB" >/dev/null 2>&1
psql -qAt "$PGURL/postgres" -c "CREATE DATABASE $DB TEMPLATE template0" >/dev/null 2>&1 || {
  echo "не мога да вдигна $DB"; exit 2; }
rm -rf "$DATA_ROOT"
boot || exit 1

curl -sD /tmp/otel_meta.txt -o /dev/null "$B/v1/meta"
grep -Eiq '^traceparent: 00-[0-9a-f]{32}-[0-9a-f]{16}-01' /tmp/otel_meta.txt \
  && pass "нов traceparent" || fail "няма traceparent $(tr -d '\r' </tmp/otel_meta.txt | grep -i traceparent || true)"

TP=00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
curl -sD /tmp/otel_child.txt -o /dev/null -H "traceparent: $TP" "$B/v1/meta"
CHILD=$(tr -d '\r' </tmp/otel_child.txt | grep -i '^traceparent:' | head -1)
echo "$CHILD" | grep -q '4bf92f3577b34da6a3ce929d0e0e4736' \
  && pass "същият trace id" || fail "trace id не се наследи ($CHILD)"
echo "$CHILD" | grep -q '00f067aa0ba902b7' \
  && fail "span-ът не е детски" || pass "нов span id"

CODE=$(curl -sD /tmp/otel_404.txt -o /dev/null -w '%{http_code}' "$B/no-such-otel")
[[ "$CODE" == "404" ]] && pass "404" || fail "404 е $CODE"
grep -Eiq '^traceparent: 00-[0-9a-f]{32}-[0-9a-f]{16}-01' /tmp/otel_404.txt \
  && pass "404 носи traceparent" || fail "404 без traceparent"

grep -q '4bf92f3577b34da6a3ce929d0e0e4736' "$SPANS" \
  && pass "колекторът получи span-а" || fail "празен колектор $(wc -c <"$SPANS")"
grep -q 'secp' "$SPANS" && pass "service secp" || fail "няма service name"

HIT=$(python3 - <<PY
import threading, urllib.request, urllib.error
codes = []
lock = threading.Lock()
def hit():
    try:
        r = urllib.request.urlopen("$B/v1/meta", timeout=5)
        c = r.status
    except urllib.error.HTTPError as e:
        c = e.code
    except Exception:
        c = 0
    with lock:
        codes.append(c)
ts = [threading.Thread(target=hit), threading.Thread(target=hit)]
for t in ts:
    t.start()
for t in ts:
    t.join()
print(" ".join(str(c) for c in codes))
PY
)
echo "$HIT" | grep -q 200 && echo "$HIT" | grep -q 429 \
  && pass "bulkhead 429 ($HIT)" || fail "няма 429 ($HIT)"

sleep 0.6
H=$(curl -s -o /dev/null -w '%{http_code}' "$B/health")
[[ "$H" == "200" ]] && pass "health извън тавана" || fail "health $H"

if [[ "$FAILED" -eq 0 ]]; then
  echo "otel_smoke: all passed"
else
  echo "otel_smoke: FAILED"
  tail -30 /tmp/secp_otel.log
  tail -20 /tmp/secp_otel_mock.log
  exit 1
fi
