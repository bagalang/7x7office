#!/usr/bin/env bash
# crypt_smoke.sh — AES-GCM blob при покой (Фаза 7).
# Изисква Postgres и построен target/secp. Не пипа другия secp процес.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/target/secp"
DB="${CRYPT_SMOKE_DB:-secp_crypt}"
PORT="${CRYPT_SMOKE_PORT:-8128}"
PGURL="${PGURL:-postgresql://bagatest:pas+123@127.0.0.1:5432}"
DATA_ROOT="${CRYPT_SMOKE_DATA:-/tmp/secp_crypt_storage}"
B="http://127.0.0.1:$PORT"
PIDF=/tmp/secp_crypt.pid
MASTER=00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff
FAILED=0
pass() { echo "  ok   $1"; }
fail() { echo "  FAIL $1"; FAILED=1; }

boot() {
  cd /tmp
  PORT="$PORT" SECP_WS_PORT=0 SECP_SCHED_MS=0 JWT_SECRET=crypt-smoke \
    SECP_MASTER_KEY="$1" \
    PGHOST=127.0.0.1 PGPORT=5432 PGUSER=bagatest PGPASSWORD='pas+123' PGDATABASE="$DB" \
    SECP_DATA_ROOT="$DATA_ROOT" SECP_PASS_ITERS=1000 \
    SECP_ADMIN_EMAIL=superadmin@secp.local SECP_ADMIN_PASSWORD='123+123' \
    SECP_ADMIN_NAME=SuperAdmin "$BIN" >/tmp/secp_crypt.log 2>&1 &
  echo $! >"$PIDF"
  cd - >/dev/null
  for _ in $(seq 1 60); do
    curl -s -m 1 "$B/ready" | grep -q ready && return 0
    sleep 0.5
  done
  echo "FAIL: няма /ready"; tail -40 /tmp/secp_crypt.log; return 1
}

login() {
  curl -s -X POST "$B/v1/auth/login" -H 'Content-Type: application/json' \
    -d '{"email":"superadmin@secp.local","password":"123+123"}' \
    | python3 -c 'import sys,json; print(json.load(sys.stdin).get("access_token",""))'
}

stop() {
  if [[ -f "$PIDF" ]]; then
    kill "$(cat "$PIDF")" 2>/dev/null || true
    wait "$(cat "$PIDF")" 2>/dev/null || true
    rm -f "$PIDF"
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
psql -qAt "$PGURL/postgres" -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB'" >/dev/null 2>&1
psql -qAt "$PGURL/postgres" -c "DROP DATABASE IF EXISTS $DB" >/dev/null 2>&1
psql -qAt "$PGURL/postgres" -c "CREATE DATABASE $DB TEMPLATE template0" >/dev/null 2>&1 || {
  echo "не мога да вдигна $DB"; exit 2; }
rm -rf "$DATA_ROOT"
boot "" || exit 1
ADM=$(login)
[[ -n "$ADM" ]] || { echo "FAIL: админът не се вписа"; tail -20 /tmp/secp_crypt.log; exit 1; }
AUTH="Authorization: Bearer $ADM"
echo -n 'legacy plain' >/tmp/crypt_old.txt
curl -s -X PUT -H "$AUTH" --data-binary @/tmp/crypt_old.txt "$B/v1/fs/file?path=/old.txt" >/dev/null
OLD=$(curl -s -H "$AUTH" "$B/v1/fs/file?path=/old.txt")
[[ "$OLD" == "legacy plain" ]] && pass "без ключ текстът е открит" || fail "без ключ: $OLD"
stop

boot "$MASTER" || exit 1
ADM=$(login)
[[ -n "$ADM" ]] || { echo "FAIL: админът не се вписа след ключа"; exit 1; }
AUTH="Authorization: Bearer $ADM"
KEEP=$(curl -s -H "$AUTH" "$B/v1/fs/file?path=/old.txt")
[[ "$KEEP" == "legacy plain" ]] && pass "стар файл се чете и с ключ" || fail "стар файл: $KEEP"

echo -n 'hello crypt' >/tmp/crypt_note.txt
curl -s -X PUT -H "$AUTH" --data-binary @/tmp/crypt_note.txt "$B/v1/fs/file?path=/note.txt" >/dev/null
BODY=$(curl -s -H "$AUTH" "$B/v1/fs/file?path=/note.txt")
[[ "$BODY" == "hello crypt" ]] && pass "чете се същият текст" || fail "GET: $BODY"

ENC=$(find "$DATA_ROOT/blobs" -type f -path '*/blobs/w*' | head -1)
[[ -n "$ENC" ]] && pass "има файл под blobs/w" || fail "няма шифрован файл"
if [[ -n "$ENC" ]]; then
  python3 - "$ENC" <<'PY'
import pathlib, sys
b = pathlib.Path(sys.argv[1]).read_bytes()
ok = b.startswith(b"S1") and b"hello crypt" not in b and len(b) > 30
sys.exit(0 if ok else 1)
PY
  [[ $? -eq 0 ]] && pass "дискът е S1 без открития текст" || fail "файлът не е запечатан"
fi

KEYN=$(psql -qAt "$PGURL/$DB" -c "SELECT COUNT(*) FROM data_keys")
[[ "$KEYN" == "1" ]] && pass "един увит ключ" || fail "data_keys: $KEYN"

if [[ "$FAILED" -eq 0 ]]; then
  echo "crypt_smoke: all passed"
else
  echo "crypt_smoke: FAILED"
  exit 1
fi
