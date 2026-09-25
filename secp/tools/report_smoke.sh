#!/usr/bin/env bash
# report_smoke.sh — жив админ отчет (Фаза 6): място и активност.
# Изисква Postgres и построен target/secp. Не пипа другия secp процес.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/target/secp"
DB="${REPORT_SMOKE_DB:-secp_report}"
PORT="${REPORT_SMOKE_PORT:-8126}"
PGURL="${PGURL:-postgresql://bagatest:pas+123@127.0.0.1:5432}"
DATA_ROOT="${REPORT_SMOKE_DATA:-/tmp/secp_report_storage}"
PSQL_SRV="psql -qAt $PGURL/postgres"
B="http://127.0.0.1:$PORT"
PIDF=/tmp/secp_report.pid
FAILED=0
pass() { echo "  ok   $1"; }
fail() { echo "  FAIL $1"; FAILED=1; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

boot() {
  cd /tmp
  PORT="$PORT" SECP_WS_PORT=0 SECP_SCHED_MS=0 JWT_SECRET=report-smoke \
    PGHOST=127.0.0.1 PGPORT=5432 PGUSER=bagatest PGPASSWORD='pas+123' PGDATABASE="$DB" \
    SECP_DATA_ROOT="$DATA_ROOT" SECP_PASS_ITERS=1000 \
    SECP_ADMIN_EMAIL=superadmin@secp.local SECP_ADMIN_PASSWORD='123+123' \
    SECP_ADMIN_NAME=SuperAdmin "$BIN" >/tmp/secp_report.log 2>&1 &
  echo $! >"$PIDF"
  cd - >/dev/null
  for _ in $(seq 1 60); do
    curl -s -m 1 "$B/ready" | grep -q ready && return 0
    sleep 0.5
  done
  echo "FAIL: няма /ready"; tail -40 /tmp/secp_report.log; return 1
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
[[ -n "$ADM" ]] || { echo "FAIL: админът не се вписа"; tail -20 /tmp/secp_report.log; exit 1; }
AUTH="Authorization: Bearer $ADM"

echo "=== вход ==="
[[ "$(code "$B/v1/reports/storage")" == "401" ]] && pass "без токен → 401" || fail "без токен не е 401"
curl -s -X POST "$B/v1/users" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"email":"viewer@secp.local","password":"viewer12345","name":"Viewer"}' >/dev/null
VIEW=$(curl -s -X POST "$B/v1/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"viewer@secp.local","password":"viewer12345"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin).get("access_token",""))')
[[ -n "$VIEW" ]] || { echo "FAIL: зрителят не се вписа"; exit 1; }
[[ "$(code -H "Authorization: Bearer $VIEW" "$B/v1/reports/storage")" == "403" ]] \
  && pass "зрител → 403" || fail "зрител не е 403"
[[ "$(code -H "$AUTH" "$B/v1/reports/storage?format=exe")" == "400" ]] \
  && pass "лош format → 400" || fail "лош format не е 400"

echo "=== място ==="
echo -n 'hello report' >/tmp/rep_note.txt
curl -s -X PUT -H "$AUTH" --data-binary @/tmp/rep_note.txt "$B/v1/fs/file?path=/note.txt" >/dev/null
ST=$(curl -s -H "$AUTH" "$B/v1/reports/storage")
python3 - "$ST" <<'PY'
import json, sys
d = json.loads(sys.argv[1])
rows = [r for r in d.get("items", []) if r.get("is_personal") == 1]
ok = d.get("count", 0) >= 1 and rows and rows[0]["files"] >= 1 and rows[0]["bytes"] >= 12 and rows[0]["members"] >= 1
sys.exit(0 if ok else 1)
PY
[[ $? -eq 0 ]] && pass "личното пространство има файла и член" || fail "storage: $ST"

echo "=== активност ==="
AC=$(curl -s -H "$AUTH" "$B/v1/reports/activity")
python3 - "$AC" <<'PY'
import json, sys
d = json.loads(sys.argv[1])
rows = [r for r in d.get("items", []) if r.get("created", 0) >= 1]
sys.exit(0 if rows else 1)
PY
[[ $? -eq 0 ]] && pass "created е поне 1" || fail "activity: $AC"

echo "=== файлове ==="
CSV=$(curl -s -H "$AUTH" "$B/v1/reports/storage?format=csv&lang=en")
echo "$CSV" | head -1 | grep -q 'Id,Name,Slug,Personal,Files,Bytes,Members' \
  && pass "csv en заглавие" || fail "csv en: $CSV"
CSVBG=$(curl -s -H "$AUTH" "$B/v1/reports/storage?format=csv&lang=bg")
echo "$CSVBG" | head -1 | grep -q 'Име' && pass "csv bg има Име" || fail "csv bg: $CSVBG"
curl -s -H "$AUTH" -o /tmp/rep_storage.xlsx "$B/v1/reports/storage?format=xlsx&lang=bg"
python3 - <<'PY'
import pathlib
b = pathlib.Path("/tmp/rep_storage.xlsx").read_bytes()
raise SystemExit(0 if b.startswith(b"PK") and len(b) > 100 else 1)
PY
[[ $? -eq 0 ]] && pass "xlsx е zip" || fail "xlsx не е zip"
HTML=$(curl -s -H "$AUTH" "$B/v1/reports/activity?format=html&lang=en")
echo "$HTML" | grep -q '<table' && echo "$HTML" | grep -q 'created' \
  && pass "html таблица с verb" || fail "html: $HTML"
curl -s -H "$AUTH" -o /tmp/rep_storage.pdf "$B/v1/reports/storage?format=pdf&lang=en"
head -c 5 /tmp/rep_storage.pdf | grep -q '%PDF' && pass "pdf започва с %PDF" || fail "pdf: $(head -c 80 /tmp/rep_storage.pdf)"
curl -s -H "$AUTH" -o /tmp/rep_act.ods "$B/v1/reports/activity?format=ods&lang=de"
python3 - <<'PY'
import pathlib
b = pathlib.Path("/tmp/rep_act.ods").read_bytes()
raise SystemExit(0 if b.startswith(b"PK") else 1)
PY
[[ $? -eq 0 ]] && pass "ods е zip" || fail "ods не е zip"

if [[ "$FAILED" -eq 0 ]]; then
  echo "report_smoke: all passed"
else
  echo "report_smoke: FAILED"
  exit 1
fi
