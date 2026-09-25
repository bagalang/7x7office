#!/usr/bin/env bash
# s3_smoke.sh — SECP_BLOB=s3 срещу местен S3, който проверява SigV4.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/target/secp"
DB="${S3_SMOKE_DB:-secp_s3}"
PORT="${S3_SMOKE_PORT:-8131}"
S3PORT="${S3_MOCK_PORT:-9131}"
PGURL="${PGURL:-postgresql://bagatest:pas+123@127.0.0.1:5432}"
DATA_ROOT="${S3_SMOKE_DATA:-/tmp/secp_s3_storage}"
B="http://127.0.0.1:$PORT"
PIDF=/tmp/secp_s3.pid
MOCK=/tmp/secp_s3_mock.pid
FAILED=0
pass() { echo "  ok   $1"; }
fail() { echo "  FAIL $1"; FAILED=1; }

boot() {
  cd /tmp
  PORT="$PORT" SECP_WS_PORT=0 SECP_SCHED_MS=0 JWT_SECRET=s3-smoke \
    SECP_BLOB=s3 \
    S3_ENDPOINT="http://127.0.0.1:$S3PORT" S3_BUCKET=secp S3_REGION=us-east-1 \
    S3_ACCESS_KEY=AKIAtest S3_SECRET_KEY='wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' \
    PGHOST=127.0.0.1 PGPORT=5432 PGUSER=bagatest PGPASSWORD='pas+123' PGDATABASE="$DB" \
    SECP_DATA_ROOT="$DATA_ROOT" SECP_PASS_ITERS=1000 \
    SECP_ADMIN_EMAIL=superadmin@secp.local SECP_ADMIN_PASSWORD='123+123' \
    SECP_ADMIN_NAME=SuperAdmin "$BIN" >/tmp/secp_s3.log 2>&1 &
  echo $! >"$PIDF"
  cd - >/dev/null
  for _ in $(seq 1 60); do
    curl -s -m 1 "$B/ready" | grep -q ready && return 0
    sleep 0.5
  done
  echo "FAIL: няма /ready"; tail -40 /tmp/secp_s3.log; return 1
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
python3 "$ROOT/tools/s3_mock.py" "$S3PORT" >/tmp/secp_s3_mock.log 2>&1 &
echo $! >"$MOCK"
for _ in $(seq 1 30); do
  curl -s -o /dev/null -m 1 "http://127.0.0.1:$S3PORT/" && break
  sleep 0.2
done

psql -qAt "$PGURL/postgres" -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB'" >/dev/null 2>&1
psql -qAt "$PGURL/postgres" -c "DROP DATABASE IF EXISTS $DB" >/dev/null 2>&1
psql -qAt "$PGURL/postgres" -c "CREATE DATABASE $DB TEMPLATE template0" >/dev/null 2>&1 || {
  echo "не мога да вдигна $DB"; exit 2; }
rm -rf "$DATA_ROOT"
boot || exit 1

ADM=$(curl -s -X POST "$B/v1/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"superadmin@secp.local","password":"123+123"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin).get("access_token",""))')
[[ -n "$ADM" ]] || { echo "FAIL: няма вход"; tail -30 /tmp/secp_s3.log; tail -20 /tmp/secp_s3_mock.log; exit 1; }
AUTH="Authorization: Bearer $ADM"
printf 'a\0b-s3' >/tmp/s3_note.bin
CODE=$(curl -s -o /tmp/s3_put.json -w '%{http_code}' -X PUT -H "$AUTH" --data-binary @/tmp/s3_note.bin "$B/v1/fs/file?path=/note.bin")
[[ "$CODE" == "201" || "$CODE" == "200" ]] && pass "качване през S3 ($CODE)" || fail "put $CODE $(cat /tmp/s3_put.json)"
curl -s -H "$AUTH" -o /tmp/s3_got.bin "$B/v1/fs/file?path=/note.bin"
cmp -s /tmp/s3_note.bin /tmp/s3_got.bin && pass "байтът 0 оцеля" || fail "тялото не съвпада"
# На диска на secp не бива да има blob-а.
if find "$DATA_ROOT" -type f 2>/dev/null | grep -q .; then
  fail "файлът е на локалния диск"
else
  pass "локалният диск е празен"
fi
grep -q 'bad signature' /tmp/secp_s3_mock.log && fail "подписът не мина" || pass "SigV4 е приет"

if [[ "$FAILED" -eq 0 ]]; then
  echo "s3_smoke: all passed"
else
  echo "s3_smoke: FAILED"
  tail -30 /tmp/secp_s3.log
  tail -20 /tmp/secp_s3_mock.log
  exit 1
fi
