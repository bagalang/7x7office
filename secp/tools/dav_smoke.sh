#!/usr/bin/env bash
# dav_smoke.sh — жив WebDAV върху secp (Фаза 4).
# Изисква Postgres и построен target/secp.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/target/secp"
DB="${DAV_SMOKE_DB:-secp_dav}"
PORT="${DAV_SMOKE_PORT:-8124}"
PGURL="${PGURL:-postgresql://bagatest:pas+123@127.0.0.1:5432}"
DATA_ROOT="${DAV_SMOKE_DATA:-/tmp/secp_dav_storage}"
PSQL_SRV="psql -qAt $PGURL/postgres"
B="http://127.0.0.1:$PORT"
U=''
PIDF=/tmp/secp_dav.pid
FAILED=0
pass() { echo "  ok   $1"; }
fail() { echo "  FAIL $1"; FAILED=1; }
code() { curl -s -o /dev/null -w '%{http_code}' -u "$U" "$@"; }

boot() {
  cd /tmp
  PORT="$PORT" SECP_WS_PORT=0 JWT_SECRET=dav-smoke \
    PGHOST=127.0.0.1 PGPORT=5432 PGUSER=bagatest PGPASSWORD='pas+123' PGDATABASE="$DB" \
    SECP_DATA_ROOT="$DATA_ROOT" SECP_SCHED_MS=0 SECP_PASS_ITERS=1000 \
    SECP_ADMIN_EMAIL=superadmin@secp.local SECP_ADMIN_PASSWORD='123+123' \
    SECP_ADMIN_NAME=SuperAdmin "$BIN" >/tmp/secp_dav.log 2>&1 &
  echo $! >"$PIDF"
  cd - >/dev/null
  for _ in $(seq 1 60); do
    curl -s -m 1 "$B/ready" | grep -q ready && return 0
    sleep 0.5
  done
  echo "FAIL: няма /ready"; tail -40 /tmp/secp_dav.log; return 1
}

stop() {
  if [[ -f "$PIDF" ]]; then
    kill "$(cat "$PIDF")" 2>/dev/null || true
    rm -f "$PIDF"
  fi
}

cleanup() {
  stop
  psql -qAt "$PGURL/postgres" -c "DROP DATABASE IF EXISTS $DB" >/dev/null 2>&1 || true
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

echo "=== ключ за папката ==="
LOGIN=$(curl -s -X POST "$B/v1/auth/login" -H 'content-type: application/json' \
  -d '{"email":"superadmin@secp.local","password":"123+123"}')
JWT=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1]).get("access_token",""))' "$LOGIN")
MINT=$(curl -s -X POST "$B/v1/me/dav" -H "Authorization: Bearer $JWT")
KEY=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1]).get("key",""))' "$MINT")
[[ "$KEY" == dav_* ]] && pass "ключът е издаден" || fail "няма ключ: $MINT"
U="superadmin@secp.local:$KEY"
[[ "$(curl -s -o /dev/null -w '%{http_code}' -u 'superadmin@secp.local:123+123' -X PROPFIND "$B/dav/0/")" == "401" ]] \
  && pass "паролата за вход не отваря WebDAV" || fail "късата парола мина"

echo "=== OPTIONS и вход ==="
HDR=$(curl -s -D - -o /dev/null -X OPTIONS "$B/dav/0")
echo "$HDR" | grep -qi '^DAV: 1' && pass "OPTIONS носи DAV: 1" || fail "OPTIONS: $HDR"
[[ "$(curl -s -o /dev/null -w '%{http_code}' -X PROPFIND "$B/dav/0/")" == "401" ]] \
  && pass "без парола → 401" || fail "липсва 401"

echo "=== папка, файл, четене ==="
[[ "$(code -X MKCOL "$B/dav/0/papers")" == "201" ]] && pass "MKCOL 201" || fail "MKCOL"
echo -n 'hello dav' >/tmp/dav_a.txt
[[ "$(code -X PUT --data-binary @/tmp/dav_a.txt "$B/dav/0/papers/a.txt")" == "201" ]] \
  && pass "PUT 201" || fail "PUT"
BODY=$(curl -s -u "$U" "$B/dav/0/papers/a.txt")
[[ "$BODY" == "hello dav" ]] && pass "GET връща същото" || fail "GET: $BODY"
PF=$(curl -s -u "$U" -X PROPFIND -H 'Depth: 1' "$B/dav/0/papers")
echo "$PF" | grep -q 'a.txt' && pass "PROPFIND вижда файла" || fail "PROPFIND: $PF"
echo "$PF" | grep -q 'getcontentlength>9<' && pass "дължината е в свойствата" || fail "няма length"

echo "=== преместване и копие ==="
MV=$(code -X MOVE -H "Destination: $B/dav/0/papers/b.txt" "$B/dav/0/papers/a.txt")
[[ "$MV" == "201" ]] && pass "MOVE 201" || fail "MOVE $MV"
[[ "$(code "$B/dav/0/papers/a.txt")" == "404" ]] && pass "старият път е 404" || fail "старият път живее"
CP=$(code -X COPY -H "Destination: $B/dav/0/papers/c.txt" "$B/dav/0/papers/b.txt")
[[ "$CP" == "201" ]] && pass "COPY 201" || fail "COPY $CP"
[[ "$(curl -s -u "$U" "$B/dav/0/papers/c.txt")" == "hello dav" ]] && pass "копието е същото" || fail "копие"

echo "=== заключване ==="
LOCKXML='<D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockinfo>'
LCODE=$(curl -s -o /tmp/dav_lock.xml -w '%{http_code}' -u "$U" -X LOCK \
  -H 'Timeout: Second-600' -H 'Content-Type: application/xml' --data "$LOCKXML" \
  "$B/dav/0/papers/b.txt")
TOKEN=$(grep -o 'opaquelocktoken:[a-f0-9A-F]*' /tmp/dav_lock.xml | head -1)
[[ "$LCODE" == "200" && -n "$TOKEN" ]] && pass "LOCK 200 $TOKEN" || fail "LOCK $LCODE"
[[ "$(code -X PUT --data-binary @/tmp/dav_a.txt "$B/dav/0/papers/b.txt")" == "423" ]] \
  && pass "PUT без токен → 423" || fail "PUT без токен"
[[ "$(code -X PUT -H "If: (<$TOKEN>)" --data-binary @/tmp/dav_a.txt "$B/dav/0/papers/b.txt")" == "204" ]] \
  && pass "PUT с токен → 204" || fail "PUT с токен"
[[ "$(code -X UNLOCK -H "Lock-Token: <$TOKEN>" "$B/dav/0/papers/b.txt")" == "204" ]] \
  && pass "UNLOCK 204" || fail "UNLOCK"
PP='<D:propertyupdate xmlns:D="DAV:"><D:set><D:prop><D:displayname>x</D:displayname></D:prop></D:set></D:propertyupdate>'
PB=$(curl -s -u "$U" -X PROPPATCH -H 'Content-Type: application/xml' --data "$PP" "$B/dav/0/papers/c.txt")
echo "$PB" | grep -q '403' && pass "PROPPATCH отказва свойството с 403" || fail "PROPPATCH: $PB"

echo "=== триене и отказ ==="
[[ "$(code -X DELETE "$B/dav/0/papers")" == "204" ]] && pass "DELETE 204" || fail "DELETE"
[[ "$(code -X PROPFIND -H 'Depth: 0' "$B/dav/0/papers")" == "404" ]] && pass "изтритата папка е 404" || fail "папката остана"

if command -v rclone >/dev/null 2>&1; then
  echo "=== rclone ==="
  PASS=$(rclone obscure "$KEY")
  echo -n 'from rclone' >/tmp/dav_r.txt
  if rclone copyto /tmp/dav_r.txt :webdav:inbox/from-rclone.txt \
      --webdav-url "$B/dav/0" --webdav-vendor other \
      --webdav-user 'superadmin@secp.local' --webdav-pass "$PASS" >/tmp/rclone_dav.log 2>&1; then
    GOT=$(curl -s -u "$U" "$B/dav/0/inbox/from-rclone.txt")
    [[ "$GOT" == "from rclone" ]] && pass "rclone качи файла" || fail "rclone четене: $GOT"
  else
    fail "rclone copyto"
    cat /tmp/rclone_dav.log
  fi
else
  echo "  skip rclone (няма го в PATH)"
fi

if [[ $FAILED -eq 0 ]]; then
  echo "dav_smoke: all passed"
  exit 0
fi
echo "dav_smoke: FAILED"
tail -30 /tmp/secp_dav.log
exit 1
