#!/usr/bin/env bash
# wopi_smoke.sh — жив WOPI host (Фаза 7): CheckFileInfo, Get/Put, LOCK.
# Изисква Postgres и построен target/secp. Не пипа другия secp процес.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/target/secp"
DB="${WOPI_SMOKE_DB:-secp_wopi}"
PORT="${WOPI_SMOKE_PORT:-8129}"
PGURL="${PGURL:-postgresql://bagatest:pas+123@127.0.0.1:5432}"
DATA_ROOT="${WOPI_SMOKE_DATA:-/tmp/secp_wopi_storage}"
B="http://127.0.0.1:$PORT"
PIDF=/tmp/secp_wopi.pid
FAILED=0
pass() { echo "  ok   $1"; }
fail() { echo "  FAIL $1"; FAILED=1; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

boot() {
  cd /tmp
  PORT="$PORT" SECP_WS_PORT=0 SECP_SCHED_MS=0 JWT_SECRET=wopi-smoke \
    PGHOST=127.0.0.1 PGPORT=5432 PGUSER=bagatest PGPASSWORD='pas+123' PGDATABASE="$DB" \
    SECP_DATA_ROOT="$DATA_ROOT" SECP_PASS_ITERS=1000 SECP_PUBLIC_URL="$B" \
    SECP_ADMIN_EMAIL=superadmin@secp.local SECP_ADMIN_PASSWORD='123+123' \
    SECP_ADMIN_NAME=SuperAdmin "$BIN" >/tmp/secp_wopi.log 2>&1 &
  echo $! >"$PIDF"
  cd - >/dev/null
  for _ in $(seq 1 60); do
    curl -s -m 1 "$B/ready" | grep -q ready && return 0
    sleep 0.5
  done
  echo "FAIL: няма /ready"; tail -40 /tmp/secp_wopi.log; return 1
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
boot || exit 1

ADM=$(curl -s -X POST "$B/v1/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"superadmin@secp.local","password":"123+123"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin).get("access_token",""))')
[[ -n "$ADM" ]] || { echo "FAIL: админът не се вписа"; tail -20 /tmp/secp_wopi.log; exit 1; }
AUTH="Authorization: Bearer $ADM"
echo -n 'wopi-body' >/tmp/wopi_note.txt
curl -s -X PUT -H "$AUTH" --data-binary @/tmp/wopi_note.txt "$B/v1/fs/file?path=/note.docx" >/dev/null
TOK=$(curl -s -H "$AUTH" "$B/v1/wopi/token?path=/note.docx")
FID=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["file_id"])' "$TOK")
ACC=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["access_token"])' "$TOK")
SRC=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["wopi_src"])' "$TOK")
[[ "$SRC" == "$B/wopi/files/$FID" ]] && pass "адресът сочи файла" || fail "src: $SRC"

INFO=$(curl -s "$B/wopi/files/$FID?access_token=$ACC")
echo "$INFO" | grep -q 'BaseFileName":"note.docx' && pass "CheckFileInfo име" || fail "info: $INFO"
echo "$INFO" | grep -q 'UserCanWrite":true' && pass "админът пише" || fail "няма write"
BODY=$(curl -s "$B/wopi/files/$FID/contents?access_token=$ACC")
[[ "$BODY" == "wopi-body" ]] && pass "GetFile" || fail "get: $BODY"
[[ "$(code "$B/wopi/files/$FID?access_token=nope")" == "401" ]] && pass "лош токен → 401" || fail "лош токен"

echo -n 'wopi-next' >/tmp/wopi_next.txt
PUT=$(code -X POST --data-binary @/tmp/wopi_next.txt "$B/wopi/files/$FID/contents?access_token=$ACC" -H 'X-WOPI-Override: PUT')
[[ "$PUT" == "200" ]] && pass "PutFile без ключалка" || fail "put $PUT"
AFTER=$(curl -s "$B/wopi/files/$FID/contents?access_token=$ACC")
[[ "$AFTER" == "wopi-next" ]] && pass "новият текст се чете" || fail "after: $AFTER"

LOCK=$(code -X POST "$B/wopi/files/$FID?access_token=$ACC" -H 'X-WOPI-Override: LOCK' -H 'X-WOPI-Lock: abc')
[[ "$LOCK" == "200" ]] && pass "LOCK" || fail "lock $LOCK"
BAD=$(code -X POST --data-binary 'no' "$B/wopi/files/$FID/contents?access_token=$ACC" -H 'X-WOPI-Override: PUT' -H 'X-WOPI-Lock: zzz')
[[ "$BAD" == "409" ]] && pass "чужд lock → 409" || fail "409: $BAD"
echo -n 'wopi-locked' >/tmp/wopi_locked.txt
OKP=$(code -X POST --data-binary @/tmp/wopi_locked.txt "$B/wopi/files/$FID/contents?access_token=$ACC" -H 'X-WOPI-Override: PUT' -H 'X-WOPI-Lock: abc')
[[ "$OKP" == "200" ]] && pass "PutFile със същия lock" || fail "locked put $OKP"
UN=$(code -X POST "$B/wopi/files/$FID?access_token=$ACC" -H 'X-WOPI-Override: UNLOCK' -H 'X-WOPI-Lock: abc')
[[ "$UN" == "200" ]] && pass "UNLOCK" || fail "unlock $UN"

curl -s -X POST "$B/v1/users" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"email":"viewer@secp.local","password":"viewer12345","name":"Viewer"}' >/dev/null
VIEW=$(curl -s -X POST "$B/v1/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"viewer@secp.local","password":"viewer12345"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin).get("access_token",""))')
# Зрителят няма файла в личното си пространство — токенът е на админа.
# Тук само проверяваме, че чужд WOPI токен не се издава за липсващ път.
[[ "$(code -H "Authorization: Bearer $VIEW" "$B/v1/wopi/token?path=/note.docx")" == "404" ]] \
  && pass "чуждият път не дава токен" || fail "viewer token"

if [[ "$FAILED" -eq 0 ]]; then
  echo "wopi_smoke: all passed"
else
  echo "wopi_smoke: FAILED"
  exit 1
fi
