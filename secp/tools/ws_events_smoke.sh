#!/usr/bin/env bash
# ws_events_smoke.sh — интеграционна проверка на WS gateway-а (Фаза 3).
#
# Защо shell + python, а не `baga` тест: тук се проверява ЖИВИЯТ канал —
# handshake, автентикация, абонамент, излъчване на събития, ping/pong,
# затваряне. Чистата логика (имена на събития, JSON на съобщенията) е в
# `tests/ws_events_test.baga`; това тук хваща това, което unit тестът не
# може: че gateway-ът наистина чете одита и наистина го праща по мрежата.
#
# Клиентът е `tools/ws_client.py` — без външни зависимости (виж докстринга).
#
# Изисква: работещ Postgres и построен `target/secp` (sandak build).
#
#   PGURL   — postgres URI към сървъра (без база)
#
# Изход: 0 = всичко мина; !=0 = първата счупена проверка.

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/target/secp"
DB="${WS_SMOKE_DB:-secp_ws_events}"
PORT="${WS_SMOKE_PORT:-8112}"
WSPORT="${WS_SMOKE_WS_PORT:-8113}"
PGURL="${PGURL:-postgresql://bagatest:pas+123@127.0.0.1:5432}"
DATA_ROOT="${WS_SMOKE_DATA:-/tmp/secp_ws_events_storage}"
# ВНИМАВАЙ: при URI като първи аргумент `psql` брои следващия позиционен
# аргумент за ПОТРЕБИТЕЛ, не за база (`psql URI postgres` == `-U postgres`),
# а `-d postgres URI` е невалиден ред на аргументите. Затова админ базата се
# слага В URI-то (`$PGURL/postgres`, същият модел като `$PGURL/$DB` по-долу).
# Иначе заявките отиват в подразбиращата се база и скриптът пада при пускане
# на ръка (когато в средата няма `PGDATABASE`).
PSQL_SRV="psql -qAt $PGURL/postgres"
PSQL="psql -qAt $PGURL/$DB"

FAILED=0
pass() { echo "  ok   $1"; }
fail() { echo "  FAIL $1"; FAILED=1; }

# Всички проверки на канала минават през един python процес: той държи
# отворените връзки и чака събития. Така няма нужда от фонови клиенти.
PY="$ROOT/tools/ws_gateway_probe.py"

jqv() { python3 -c "import sys,json;d=json.load(sys.stdin);print(d$1)" 2>/dev/null; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

login() {
  curl -s -X POST "$B/v1/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" | jqv "['access_token']"
}

boot() {
  ( cd /tmp && PORT="$PORT" SECP_WS_PORT="$WSPORT" JWT_SECRET=ws-smoke \
      PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}" \
      PGUSER="${PGUSER:-bagatest}" PGPASSWORD="${PGPASSWORD:-pas+123}" PGDATABASE="$DB" \
      SECP_DATA_ROOT="$DATA_ROOT" SECP_SCHED_MS=0 SECP_PASS_ITERS=1000 \
      SECP_WS_POLL_MS=100 SECP_WS_PING_MS=5000 \
      SECP_ADMIN_EMAIL=superadmin@secp.local SECP_ADMIN_PASSWORD='123+123' \
      SECP_ADMIN_NAME=SuperAdmin "$BIN" >"/tmp/ws_events_$1.log" 2>&1 ) &
  for _ in $(seq 1 60); do
    curl -s -m 1 "http://127.0.0.1:$PORT/ready" | grep -q ready && return 0
    sleep 0.5
  done
  echo "FAIL: сървърът не вдигна /ready (виж /tmp/ws_events_$1.log)"; return 1
}

stop() { pkill -f 'target/[s]ecp' 2>/dev/null; sleep 1; }

trap 'stop; $PSQL_SRV -c "DROP DATABASE IF EXISTS $DB" >/dev/null 2>&1' EXIT

[[ -x "$BIN" ]] || { echo "липсва $BIN — пусни sandak build"; exit 2; }

stop
$PSQL_SRV -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB'" >/dev/null 2>&1
$PSQL_SRV -c "DROP DATABASE IF EXISTS $DB" >/dev/null 2>&1
$PSQL_SRV -c "CREATE DATABASE $DB TEMPLATE template0" >/dev/null 2>&1 || {
  echo "не мога да вдигна $DB (PGURL=$PGURL)"; exit 2; }
rm -rf "$DATA_ROOT"

echo "=== boot ==="
boot 1 || exit 1
B="http://127.0.0.1:$PORT"
ADM=$(login superadmin@secp.local '123+123')
[[ -n "$ADM" ]] || { echo "FAIL: админът не се вписа"; exit 1; }
AUTH="Authorization: Bearer $ADM"

echo "=== границата на сигурността: upgrade преди 101 ==="
# Каналът носи имена на файлове и имейли. Затова отказът е ПРЕДИ upgrade, а
# не „отворен канал, който мълчи" — тестваме и трите причини за отказ.
# Клиентът печата САМО статуса (`401`/`404`), не целия ред — затова
# сравнението е точно, а не „съдържа някъде".
OUT=$(python3 "$PY" --host 127.0.0.1 --port "$WSPORT" --case deny | tail -1)
[[ "$OUT" == "401" ]] && pass "без токен → 401 (преди 101)" || fail "без токен: $OUT"
OUT=$(python3 "$PY" --host 127.0.0.1 --port "$WSPORT" --case deny --token 'not-a-jwt' | tail -1)
[[ "$OUT" == "401" ]] && pass "счупен токен → 401" || fail "счупен токен: $OUT"
# Токен, подписан с ДРУГА тайна — точно случаят „откраднат токен от друг сървър".
FORGED="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJzdXBlcmFkbWluQHNlY3AubG9jYWwifQ.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
OUT=$(python3 "$PY" --host 127.0.0.1 --port "$WSPORT" --case deny --token "$FORGED" | tail -1)
[[ "$OUT" == "401" ]] && pass "токен с чужда тайна → 401" || fail "чужда тайна: $OUT"
OUT=$(python3 "$PY" --host 127.0.0.1 --port "$WSPORT" --case deny --path /v1/fs/list | tail -1)
[[ "$OUT" == "404" ]] && pass "друг път на канала → 404" || fail "друг път: $OUT"

echo "=== абонамент и hello ==="
OUT=$(python3 "$PY" --host 127.0.0.1 --port "$WSPORT" --case subscribe --token "$ADM" | tail -1)
[[ "$OUT" == "subscribed=ok hello=ok proto=1" ]] && pass "subscribe → subscribed + hello" \
  || fail "subscribe: $OUT"
# workspace_id=0 значи личното пространство (същото правило като HTTP API-то).
OUT=$(python3 "$PY" --host 127.0.0.1 --port "$WSPORT" --case badproto --token "$ADM" | tail -1)
[[ "$OUT" == "proto_error=ok" ]] && pass "стар протокол се отказва явно" || fail "протокол: $OUT"
OUT=$(python3 "$PY" --host 127.0.0.1 --port "$WSPORT" --case unknown_ws --token "$ADM" | tail -1)
[[ "$OUT" == "ws_not_found=ok" ]] && pass "чуждо пространство → not_found (не 403)" \
  || fail "чуждо пространство: $OUT"

echo "=== ping/pong и затваряне ==="
OUT=$(python3 "$PY" --host 127.0.0.1 --port "$WSPORT" --case ping --token "$ADM" | tail -1)
[[ "$OUT" == "pong=ok" ]] && pass "текстов ping → pong" || fail "ping: $OUT"
# Сървърът праща и WS-level ping (не текст). Браузърът отговаря сам; тук
# проверяваме, че клиентът получава ping и че каналът не се затваря от него.
OUT=$(python3 "$PY" --host 127.0.0.1 --port "$WSPORT" --case close --token "$ADM" | tail -1)
[[ "$OUT" == "close=ok" ]] && pass "close кадърът затваря връзката чисто" || fail "close: $OUT"

echo "=== излъчване: HTTP действието стига по канала ==="
# Тук е смисълът на целия gateway: абонатът вижда събитие за чуждо действие,
# без да пита. Правим го с два отделни процеса — единият държи отворен канал
# и чака, другият (curl) пише файл. Така се проверява и че събитието стига,
# докато клиентът само чака (push, не poll от страна на клиента).
WSOUT=/tmp/ws_events_listen.txt
# ВАЖНО: трием изхода ПРЕДИ пускането. Иначе `grep ready` от предишен
# прогon кара shell-а да пусне действието, преди абонатът да се е вдигнал —
# и събитието се губи (клиентът почва от по-висок курсор). Точно този
# дефект даде „събития: ''" при първото пускане на теста.
rm -f "$WSOUT"
python3 "$PY" --host 127.0.0.1 --port "$WSPORT" --case listen --token "$ADM" \
  --live 12 --out "$WSOUT" >/dev/null 2>&1 &
LPID=$!
# Чакаме абонаментът да е готов, преди да пишем (иначе събитието може да
# изпревари subscribe-а и клиентът да почне от по-висок курсор).
for _ in $(seq 1 80); do
  [[ -f "$WSOUT" ]] && grep -q '^ready' "$WSOUT" && break
  sleep 0.2
done
grep -q '^ready' "$WSOUT" || { fail "абонатът не се вдигна"; cat "$WSOUT"; }
echo "broadcast" >/tmp/wse_b.txt
curl -s -X PUT -H "$AUTH" --data-binary @/tmp/wse_b.txt "$B/v1/fs/file?path=/broadcast.txt" >/dev/null
curl -s -X POST -H "$AUTH" "$B/v1/fs/mkdir?path=/broadcast-dir" >/dev/null
wait "$LPID" 2>/dev/null
# Събитията трябва да са ДВЕ и с правилните имена. Редът е по id, т.е. по
# реда на действията — проверяваме множеството, не последователността.
EVS=$(grep '^event ' "$WSOUT" | awk '{print $2}' | sort | tr '\n' ',')
[[ "$EVS" == "node.created,node.created," ]] && pass "двете действия дойдоха като node.created" \
  || fail "събития: '$EVS' (очаквах node.created,node.created,)"
PATHS=$(grep '^path ' "$WSOUT" | awk '{print $2}' | sort | tr '\n' ',')
[[ "$PATHS" == "/broadcast-dir,/broadcast.txt," ]] && pass "събитията носят точния път" \
  || fail "пътища: '$PATHS'"
# Едно събитие = един пълен ред от activity feed-а, с актьор и verb. Ако
# носеше само id, клиентът пак щеше да пита HTTP-а и каналът е безсмислен.
grep -q '^actor_bad' "$WSOUT" && fail "събитието няма actor_email" \
  || pass "събитието носи актьора (без допълнителна заявка)"
grep -q '^verb created$' "$WSOUT" && pass "събитието носи verb-а" || fail "липсва verb"

echo "=== изолация: абонат на едно пространство не вижда друго ==="
# Второ пространство + втори абонат. Действие в ПЪРВОТО не бива да стига до
# втория клиент — иначе каналът е глобален слушател и изтича активност.
WS2=$(curl -s -X POST "$B/v1/workspaces" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"label":"Second","description":""}' | jqv "['id']")
[[ -n "$WS2" && "$WS2" != "None" ]] && pass "създадено второ пространство #$WS2" || fail "няма второ ws"
ISOOUT=/tmp/ws_events_iso.txt
rm -f "$ISOOUT"
python3 "$PY" --host 127.0.0.1 --port "$WSPORT" --case listen --token "$ADM" \
  --ws "$WS2" --live 8 --out "$ISOOUT" >/dev/null 2>&1 &
IPID=$!
for _ in $(seq 1 80); do
  [[ -f "$ISOOUT" ]] && grep -q '^ready' "$ISOOUT" && break
  sleep 0.2
done
grep -q '^ready' "$ISOOUT" || fail "вторият абонат не се вдигна"
echo "elsewhere" >/tmp/wse_e.txt
curl -s -X PUT -H "$AUTH" --data-binary @/tmp/wse_e.txt "$B/v1/fs/file?path=/elsewhere.txt" >/dev/null
wait "$IPID" 2>/dev/null
grep -q '^event ' "$ISOOUT" && fail "чуждият абонат получи събитие от друго пространство" \
  || pass "абонатът на #$WS2 не видя действието в личното"
# ...но събитие В НЕГОВОТО пространство трябва да дойде.
rm -f "$ISOOUT"
python3 "$PY" --host 127.0.0.1 --port "$WSPORT" --case listen --token "$ADM" \
  --ws "$WS2" --live 8 --out "$ISOOUT" >/dev/null 2>&1 &
IPID=$!
for _ in $(seq 1 80); do
  [[ -f "$ISOOUT" ]] && grep -q '^ready' "$ISOOUT" && break
  sleep 0.2
done
grep -q '^ready' "$ISOOUT" || fail "вторият абонат не се вдигна (втори опит)"
curl -s -X POST -H "$AUTH" "$B/v1/fs/mkdir?path=/in-second&workspace_id=$WS2" >/dev/null
wait "$IPID" 2>/dev/null
grep -q '^event node.created$' "$ISOOUT" && pass "събитието в неговото пространство дойде" \
  || fail "събитие в #$WS2 не дойде"

echo "=== дължината е в байтове, таванът е реален ==="
# Кирилицата е 2 байта/знак, емоджито 4. Ако сървърът броеше знаци, кадърът
# щеше да е с грешен размер, а таванът да пропуска двойно повече.
OUT=$(python3 "$PY" --host 127.0.0.1 --port "$WSPORT" --case unicode --token "$ADM" | tail -1)
[[ "$OUT" == "utf8_ok=ok too_large=ok alive=ok" ]] \
  && pass "UTF-8 дължина в байтове; над тавана → too_large, каналът оцелява" \
  || fail "utf8/таван: $OUT"

echo "=== старият клиент получава ЯВЕН отказ, не тишина ==="
# Смяната на формата на съобщенията вдига `ws_proto`; стар клиент трябва да
# разбере да се презареди, вместо да чака съобщения, които не разбира.
OUT=$(python3 "$PY" --host 127.0.0.1 --port "$WSPORT" --case proto_future --token "$ADM" | tail -1)
[[ "$OUT" == "proto_rejected=ok" ]] && pass "бъдещ протокол → error protocol" \
  || fail "бъдещ протокол: $OUT"

echo "=== без вход няма канал (401, не 101) ==="
OUT=$(python3 "$PY" --host 127.0.0.1 --port "$WSPORT" --case cookie --token "$ADM" | tail -1)
[[ "$OUT" == "cookie=ok" ]] && pass "токенът се приема и от Cookie (пътят на браузъра)" \
  || fail "cookie: $OUT"

echo "=== изключен канал при SECP_WS_PORT=0 ==="
# 0 значи „изключен" — тестове и `--check` не бива да вдигат сокет.
stop
( cd /tmp && PORT="$PORT" SECP_WS_PORT=0 JWT_SECRET=ws-smoke \
    PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}" \
    PGUSER="${PGUSER:-bagatest}" PGPASSWORD="${PGPASSWORD:-pas+123}" PGDATABASE="$DB" \
    SECP_DATA_ROOT="$DATA_ROOT" SECP_SCHED_MS=0 SECP_PASS_ITERS=1000 \
    SECP_ADMIN_EMAIL=superadmin@secp.local SECP_ADMIN_PASSWORD='123+123' \
    SECP_ADMIN_NAME=SuperAdmin "$BIN" >"/tmp/ws_events_off.log" 2>&1 ) &
for _ in $(seq 1 60); do
  curl -s -m 1 "http://127.0.0.1:$PORT/ready" | grep -q ready && break
  sleep 0.5
done
if (exec 3<>"/dev/tcp/127.0.0.1/$WSPORT") 2>/dev/null; then
  fail "SECP_WS_PORT=0 все пак слуша на :$WSPORT"
else
  pass "SECP_WS_PORT=0 не отваря порт (HTTP работи)"
fi

echo
if [[ $FAILED -eq 0 ]]; then
  echo "ws_events_smoke: all passed"
else
  echo "ws_events_smoke: ИМА ПРОВАЛИ"
fi
exit $FAILED
