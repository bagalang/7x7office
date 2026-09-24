#!/usr/bin/env bash
# ws_files_smoke.sh — интеграционна проверка на Фаза 2 за ФАЙЛОВЕТЕ:
# скоуп по пространство, роли върху реални файлове, backfill на стари възли
# и изчистване на дървото при триене на пространство.
#
# Защо shell, а не `baga` тест: тук се проверява поведението на ГОТОВИЯ сървър
# (рутиране, JWT, SQL миграции, boot реда) — не чиста функция. `baga` покрива
# само `idm/ws_roles.baga` (tests/ws_roles_test.baga). Това е евтиният начин
# `tree/auth` + `tree/backfill` + `tree/ws_cleanup` да не се счупят тихо.
#
# Изисква: работещ Postgres и построен `target/secp` (sandak build).
# Условия на средата се подават като променливи (виж defaults по-долу).
#
#   PGURL   — postgres URI към сървъра (без база), напр. postgres://user:pass@host:port
#   PGDATA  — базата/шаблонът, от който се клонира (template0)
#
# Изход: 0 = всичко мина; !=0 = първата счупена проверка (с контекст).

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/target/secp"
DB="${WS_SMOKE_DB:-secp_ws_files}"
PORT="${WS_SMOKE_PORT:-8102}"
PGURL="${PGURL:-postgresql://bagatest:pas+123@127.0.0.1:5432}"
DATA_ROOT="${WS_SMOKE_DATA:-/tmp/secp_ws_files_storage}"
# ВАЖНО: psql чете база само от URI-то. Подадеш ли "URI без база" + позиционен
# аргумент $DB, аргументът СЕ ИГНОРИРА и psql пада към PGDATABASE от средата —
# т.е. проверките четат чужда база и лъжат. Затова винаги слагаме $DB в URI-то.
PSQL_SRV="psql -qAt $PGURL"   # сървър/админ (за create/drop на базата)
PSQL="psql -qAt $PGURL/$DB"   # вече в целевата база

FAILED=0
pass() { echo "  ok   $1"; }
fail() { echo "  FAIL $1"; FAILED=1; }

jqv() { python3 -c "import sys,json;d=json.load(sys.stdin);print(d$1)" 2>/dev/null; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

login() {
  curl -s -X POST "$B/v1/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" | jqv "['access_token']"
}

boot() {
  ( cd /tmp && PORT="$PORT" JWT_SECRET=ws-smoke \
      PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}" \
      PGUSER="${PGUSER:-bagatest}" PGPASSWORD="${PGPASSWORD:-pas+123}" PGDATABASE="$DB" \
      SECP_DATA_ROOT="$DATA_ROOT" SECP_SCHED_MS=0 SECP_PASS_ITERS=1000 \
      SECP_ADMIN_EMAIL=superadmin@secp.local SECP_ADMIN_PASSWORD='123+123' \
      SECP_ADMIN_NAME=SuperAdmin "$BIN" >"/tmp/ws_files_$1.log" 2>&1 ) &
  for _ in $(seq 1 60); do
    curl -s -m 1 "http://127.0.0.1:$PORT/ready" | grep -q ready && return 0
    sleep 0.5
  done
  echo "FAIL: сървърът не вдигна /ready (виж /tmp/ws_files_$1.log)"; return 1
}

stop() { pkill -f 'target/[s]ecp' 2>/dev/null; sleep 1; }

trap 'stop; $PSQL_SRV postgres -c "DROP DATABASE IF EXISTS $DB" >/dev/null 2>&1' EXIT

[[ -x "$BIN" ]] || { echo "липсва $BIN — пусни sandak build"; exit 2; }

stop
# Форсирано: висяща връзка от предишен boot кара DROP да се провали тихо и
# тестът тръгва върху стара база (грешки тип „6 потребителя при 3 създадени").
$PSQL_SRV postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB'" >/dev/null 2>&1
$PSQL_SRV postgres -c "DROP DATABASE IF EXISTS $DB" 2>&1 | grep -v '^$' || true
$PSQL_SRV postgres -c "CREATE DATABASE $DB TEMPLATE template0" >/dev/null 2>&1 || {
  echo "не мога да вдигна $DB (PGURL=$PGURL)"; exit 2; }
N=$($PSQL_SRV postgres -c "SELECT COUNT(*) FROM pg_database WHERE datname = '$DB'")
[[ "$N" == "1" ]] || { echo "базата $DB не е създадена"; exit 2; }
rm -rf "$DATA_ROOT"

echo "=== boot 1: схема + админ ==="
boot 1 || exit 1
B="http://127.0.0.1:$PORT"
ADM=$(login superadmin@secp.local '123+123')
[[ -n "$ADM" ]] || { echo "FAIL: админът не се вписа"; exit 1; }
AUTH="Authorization: Bearer $ADM"

echo "=== лично пространство: качване БЕЗ workspace_id ==="
echo "personal" >/tmp/wsf_p.txt
NM=$(curl -s -X PUT -H "$AUTH" --data-binary @/tmp/wsf_p.txt "$B/v1/fs/file?path=/p.txt" | jqv "['name']")
[[ "$NM" == "p.txt" ]] && pass "качен p.txt в личното" || fail "личен put → '$NM'"

echo "=== екипно пространство: изолация ==="
WS=$(curl -s -X POST "$B/v1/workspaces" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"label":"Team","description":""}' | jqv "['id']")
[[ -n "$WS" && "$WS" != "None" ]] && pass "създадено пространство #$WS" || fail "няма id"

echo "team" >/tmp/wsf_t.txt
curl -s -X PUT -H "$AUTH" --data-binary @/tmp/wsf_t.txt "$B/v1/fs/file?path=/t.txt&workspace_id=$WS" >/dev/null
PC=$(curl -s -H "$AUTH" "$B/v1/fs/list?path=/" | jqv "['count']")
TC=$(curl -s -H "$AUTH" "$B/v1/fs/list?path=/&workspace_id=$WS" | jqv "['count']")
[[ "$PC" == "1" && "$TC" == "1" ]] && pass "личният вижда 1, екипният 1 (без смесване)" \
  || fail "личният=$PC екипният=$TC (очаквах 1/1)"

echo "=== същият път в двете пространства = два реда ==="
echo "same-personal" >/tmp/wsf_s1.txt; echo "same-team" >/tmp/wsf_s2.txt
curl -s -X PUT -H "$AUTH" --data-binary @/tmp/wsf_s1.txt "$B/v1/fs/file?path=/same.txt" >/dev/null
curl -s -X PUT -H "$AUTH" --data-binary @/tmp/wsf_s2.txt "$B/v1/fs/file?path=/same.txt&workspace_id=$WS" >/dev/null
S1=$(curl -s -H "$AUTH" "$B/v1/fs/file?path=/same.txt")
S2=$(curl -s -H "$AUTH" "$B/v1/fs/file?path=/same.txt&workspace_id=$WS")
[[ "$S1" == *personal* && "$S2" == *team* ]] && pass "двете копия са различни" \
  || fail "same.txt се смеси ('$S1' / '$S2')"

echo "=== невалиден / несъществуващ workspace ==="
[[ "$(code -H "$AUTH" "$B/v1/fs/list?path=/&workspace_id=99999")" == "404" ]] \
  && pass "несъществуващ → 404" || fail "несъществуващ не е 404"
[[ "$(code -H "$AUTH" "$B/v1/fs/list?path=/&workspace_id=abc")" == "200" ]] \
  && pass "невалиден id → третира се като личен (200)" || fail "невалиден id не е 200"

echo "=== роли върху реални файлове (viewer/editor) ==="
for u in alice bob; do
  curl -s -X POST "$B/v1/users" -H "$AUTH" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$u@secp.local\",\"password\":\"pass12345\",\"name\":\"$u\"}" >/dev/null
done
ALICE=$(login alice@secp.local pass12345)
BOB=$(login bob@secp.local pass12345)
AWS=$(curl -s -X POST "$B/v1/workspaces" -H "Authorization: Bearer $ALICE" -H 'Content-Type: application/json' \
  -d '{"label":"Shared","description":""}' | jqv "['id']")
[[ -n "$AWS" && "$AWS" != "None" ]] && pass "alice създаде #$AWS" || fail "alice няма пространство"

[[ "$(code -H "Authorization: Bearer $BOB" "$B/v1/fs/list?path=/&workspace_id=$AWS")" == "404" ]] \
  && pass "не-член → 404 (не издава, че съществува)" || fail "не-член не е 404"

echo "alice-file" >/tmp/wsf_a.txt
curl -s -X PUT -H "Authorization: Bearer $ALICE" --data-binary @/tmp/wsf_a.txt \
  "$B/v1/fs/file?path=/a.txt&workspace_id=$AWS" >/dev/null

curl -s -X POST -H "Authorization: Bearer $ALICE" -H 'Content-Type: application/json' \
  -d '{"email":"bob@secp.local","role":"viewer"}' "$B/v1/workspaces/members?workspace_id=$AWS" >/dev/null

[[ "$(code -H "Authorization: Bearer $BOB" "$B/v1/fs/file?path=/a.txt&workspace_id=$AWS")" == "200" ]] \
  && pass "viewer чете" || fail "viewer не чете"
[[ "$(code -X PUT -H "Authorization: Bearer $BOB" --data-binary @/tmp/wsf_t.txt "$B/v1/fs/file?path=/bob.txt&workspace_id=$AWS")" == "403" ]] \
  && pass "viewer не пише (403)" || fail "viewer писа"
[[ "$(code -X POST -H "Authorization: Bearer $BOB" "$B/v1/fs/mkdir?path=/bobdir&workspace_id=$AWS")" == "403" ]] \
  && pass "viewer не прави папка (403)" || fail "viewer направи папка"
[[ "$(code -X DELETE -H "Authorization: Bearer $BOB" "$B/v1/fs/file?path=/a.txt&workspace_id=$AWS")" == "403" ]] \
  && pass "viewer не трие (403)" || fail "viewer изтри"

MID=$(curl -s -H "Authorization: Bearer $ALICE" "$B/v1/workspaces/members?workspace_id=$AWS" \
  | python3 -c "import sys,json
for m in json.load(sys.stdin)['items']:
    if m['email'].startswith('bob'): print(m['member_id'])" 2>/dev/null)
curl -s -X PATCH -H "Authorization: Bearer $ALICE" -H 'Content-Type: application/json' \
  -d '{"role":"editor"}' "$B/v1/workspaces/members?workspace_id=$AWS&member_id=$MID" >/dev/null
[[ "$(code -X PUT -H "Authorization: Bearer $BOB" --data-binary @/tmp/wsf_t.txt "$B/v1/fs/file?path=/bob.txt&workspace_id=$AWS")" == "200" ]] \
  && pass "editor пише" || fail "editor не пише"
[[ "$(code -X DELETE -H "Authorization: Bearer $BOB" "$B/v1/fs/file?path=/bob.txt&workspace_id=$AWS")" == "204" ]] \
  && pass "editor трие" || fail "editor не трие"

echo "=== личното на bob не вижда файловете на alice ==="
[[ "$(curl -s -H "Authorization: Bearer $BOB" "$B/v1/fs/list?path=/" | jqv "['count']")" == "0" ]] \
  && pass "bob лично е празно" || fail "bob вижда чужди файлове"

echo "=== ACL: изрични права по път (Фаза 2) ==="
# bob е editor в #$AWS (от горната секция). Правим /secret и /public и
# показваме, че ACL стеснява editor до нищо на /secret и разширява viewer
# до write на /public. Това е смисълът на модела „най-специфичният печели".
curl -s -o /dev/null -X POST -H "Authorization: Bearer $ALICE" \
  "$B/v1/fs/mkdir?path=/secret&workspace_id=$AWS"
echo "top-secret" >/tmp/wsf_sec.txt
curl -s -X PUT -H "Authorization: Bearer $ALICE" --data-binary @/tmp/wsf_sec.txt \
  "$B/v1/fs/file?path=/secret/data.txt&workspace_id=$AWS" >/dev/null
echo "public" >/tmp/wsf_pub.txt
curl -s -X PUT -H "Authorization: Bearer $ALICE" --data-binary @/tmp/wsf_pub.txt \
  "$B/v1/fs/file?path=/public.txt&workspace_id=$AWS" >/dev/null

# преди ACL: editor чете тайното
[[ "$(code -H "Authorization: Bearer $BOB" "$B/v1/fs/file?path=/secret/data.txt&workspace_id=$AWS")" == "200" ]] \
  && pass "преди ACL: editor чете /secret" || fail "editor не чете /secret преди ACL"

# не-owner не пипа правата
[[ "$(code -X POST -H "Authorization: Bearer $BOB" -H 'Content-Type: application/json' \
  -d "{\"path\":\"/secret\",\"kind\":\"user\",\"email\":\"alice@secp.local\",\"level\":1,\"inherit\":1}" \
  "$B/v1/fs/acl?workspace_id=$AWS")" == "403" ]] \
  && pass "не-owner не задава права (403)" || fail "не-owner зададе права"

# owner стеснява bob до нищо на /secret (inherit=1 → и под него)
ACL_BODY="{\"path\":\"/secret\",\"kind\":\"user\",\"email\":\"bob@secp.local\",\"level\":0,\"inherit\":1}"
ACL_ID=$(curl -s -X POST -H "Authorization: Bearer $ALICE" -H 'Content-Type: application/json' \
  -d "$ACL_BODY" "$B/v1/fs/acl?workspace_id=$AWS" | jqv "['id']")
[[ -n "$ACL_ID" && "$ACL_ID" != "None" ]] && pass "alice зададе ред #$ACL_ID" || fail "няма acl id"

# UI-ът показва име/имейл, не голо id — сървърът трябва да ги дава
ACL_EMAIL=$(curl -s -H "Authorization: Bearer $ALICE" "$B/v1/fs/acl?path=/secret&workspace_id=$AWS" \
  | jqv "['items'][0]['subject_email']")
[[ "$ACL_EMAIL" == "bob@secp.local" ]] && pass "редът носи имейла на субекта" \
  || fail "subject_email='$ACL_EMAIL' (очаквах bob@secp.local)"

[[ "$(code -H "Authorization: Bearer $BOB" "$B/v1/fs/file?path=/secret/data.txt&workspace_id=$AWS")" == "403" ]] \
  && pass "ACL: editor вече не чете /secret (403)" || fail "ACL не заключи /secret"
[[ "$(code -H "Authorization: Bearer $BOB" "$B/v1/fs/list?path=/secret&workspace_id=$AWS")" == "403" ]] \
  && pass "ACL: и списъкът на /secret е заключен" || fail "списъкът на /secret не е заключен"
# родителският списък също не бива да издава заключеното дете (иначе UI-ът
# показва папка, която дава 403 при отваряне, и име, което не се чете).
# Проверяваме ИМЕНАТА, не броя: в корена може да има и други файлове от
# предишни секции. Искаме /secret да липсва, а четеното /public.txt — да е там.
BOB_NAMES=$(curl -s -H "Authorization: Bearer $BOB" "$B/v1/fs/list?path=/&workspace_id=$AWS" \
  | python3 -c "import sys,json;print(','.join(sorted(i['name'] for i in json.load(sys.stdin)['items'])))")
case ",$BOB_NAMES," in
  *,secret,*) fail "коренът показа заключената папка (bob вижда: $BOB_NAMES)" ;;
  *,public.txt,*) pass "ACL: коренът крие /secret, но дава /public.txt" ;;
  *) fail "коренът за bob е неочакван: '$BOB_NAMES'" ;;
esac
ALICE_NAMES=$(curl -s -H "Authorization: Bearer $ALICE" "$B/v1/fs/list?path=/&workspace_id=$AWS" \
  | python3 -c "import sys,json;print(','.join(sorted(i['name'] for i in json.load(sys.stdin)['items'])))")
case ",$ALICE_NAMES," in
  *,secret,*) pass "ACL: owner пак вижда детето" ;;
  *) fail "owner не вижда заключената папка (вижда: $ALICE_NAMES)" ;;
esac
[[ "$(code -H "Authorization: Bearer $BOB" "$B/v1/fs/file?path=/public.txt&workspace_id=$AWS")" == "200" ]] \
  && pass "ACL: останалото пак се чете" || fail "ACL заключи цялото пространство"
# собственикът не се самозаключва
[[ "$(code -H "Authorization: Bearer $ALICE" "$B/v1/fs/file?path=/secret/data.txt&workspace_id=$AWS")" == "200" ]] \
  && pass "ACL: owner пак чете (protect)" || fail "owner се заключи"

# търсенето също уважава ACL — иначе изтичат имена на заключени файлове
SRC=$(curl -s -H "Authorization: Bearer $BOB" "$B/v1/search?q=data&workspace_id=$AWS" | jqv "['count']")
[[ "$SRC" == "0" ]] && pass "ACL: търсенето не връща заключения файл" || fail "търсенето върна $SRC"

# понижаване на нивото (същият субект и път) не дублира реда
curl -s -X POST -H "Authorization: Bearer $ALICE" -H 'Content-Type: application/json' \
  -d "{\"path\":\"/secret\",\"kind\":\"user\",\"email\":\"bob@secp.local\",\"level\":1,\"inherit\":1}" \
  "$B/v1/fs/acl?workspace_id=$AWS" >/dev/null
NROWS=$(curl -s -H "Authorization: Bearer $ALICE" "$B/v1/fs/acl?path=/secret&workspace_id=$AWS" | jqv "['count']")
[[ "$NROWS" == "1" ]] && pass "повторно задаване сменя реда, не дублира" || fail "редове=$NROWS (очаквах 1)"
[[ "$(code -H "Authorization: Bearer $BOB" "$B/v1/fs/file?path=/secret/data.txt&workspace_id=$AWS")" == "200" ]] \
  && pass "вдигане на нивото отпуши четенето" || fail "вдигането не проработи"

# права към несъществуващ път се отказват
[[ "$(code -X POST -H "Authorization: Bearer $ALICE" -H 'Content-Type: application/json' \
  -d "{\"path\":\"/няма-такъв\",\"kind\":\"role\",\"role\":\"viewer\",\"level\":2,\"inherit\":1}" \
  "$B/v1/fs/acl?workspace_id=$AWS")" == "404" ]] \
  && pass "права към липсващ път → 404" || fail "правата към липсващ път минаха"

# ниво извън 0..3 се отказва (иначе 99 = admin през ACL)
[[ "$(code -X POST -H "Authorization: Bearer $ALICE" -H 'Content-Type: application/json' \
  -d "{\"path\":\"/secret\",\"kind\":\"role\",\"role\":\"viewer\",\"level\":99,\"inherit\":1}" \
  "$B/v1/fs/acl?workspace_id=$AWS")" == "400" ]] \
  && pass "level=99 се отказва" || fail "level=99 мина"

# изтриването на реда връща старото ниво
[[ "$(code -X DELETE -H "Authorization: Bearer $ALICE" "$B/v1/fs/acl?acl_id=$ACL_ID&workspace_id=$AWS")" == "204" ]] \
  && pass "ACL редът се трие" || fail "ACL редът не се изтри"
NROWS=$(curl -s -H "Authorization: Bearer $ALICE" "$B/v1/fs/acl?path=/secret&workspace_id=$AWS" | jqv "['count']")
[[ "$NROWS" == "0" ]] && pass "след триене няма редове" || fail "останаха $NROWS реда"

# изтриването на ВЪЗЕЛ маха и правата му (иначе нов файл на същия път
# наследява стари права)
ACL2=$(curl -s -X POST -H "Authorization: Bearer $ALICE" -H 'Content-Type: application/json' \
  -d "{\"path\":\"/secret\",\"kind\":\"user\",\"email\":\"bob@secp.local\",\"level\":0,\"inherit\":1}" \
  "$B/v1/fs/acl?workspace_id=$AWS" | jqv "['id']")
curl -s -o /dev/null -X DELETE -H "Authorization: Bearer $ALICE" "$B/v1/fs/file?path=/secret&workspace_id=$AWS"
LEFTACL=$($PSQL -c "SELECT COUNT(*) FROM tree_acl WHERE workspace_id=$AWS")
[[ "$LEFTACL" == "0" ]] && pass "изтрит възел маха и правата си" || fail "останали $LEFTACL acl реда"

echo "=== триене на пространство изчиства дървото ==="
curl -s -o /dev/null -X DELETE -H "Authorization: Bearer $ALICE" "$B/v1/workspaces?workspace_id=$AWS"
A=$($PSQL -c "SELECT COUNT(*) FROM tree_acl WHERE workspace_id=$AWS")
N=$($PSQL -c "SELECT COUNT(*) FROM tree_nodes WHERE workspace_id=$AWS")
V=$($PSQL -c "SELECT COUNT(*) FROM tree_versions WHERE workspace_id=$AWS")
T=$($PSQL -c "SELECT COUNT(*) FROM tree_text WHERE workspace_id=$AWS")
[[ "$A$N$V$T" == "0000" ]] && pass "acl/възли/версии/текст = 0" \
  || fail "остатъци: acl=$A nodes=$N versions=$V text=$T"

echo "=== backfill: стари възли (ws=0) → личното на собственика ==="
stop
$PSQL -c "INSERT INTO tree_nodes (owner_id,path,parent_path,name,is_dir,size,hash,thumb_hash,workspace_id) VALUES (1,'/old.txt','/','old.txt',0,5,'deadbeef','',0)" >/dev/null
$PSQL -c "INSERT INTO tree_nodes (owner_id,path,parent_path,name,is_dir,size,hash,thumb_hash,workspace_id) VALUES (1,'/olddir','/','olddir',1,0,'','',0)" >/dev/null
NID=$($PSQL -c "SELECT id FROM tree_nodes WHERE path='/old.txt'")
$PSQL -c "INSERT INTO tree_versions (node_id,owner_id,path,size,hash,workspace_id) VALUES ($NID,1,'/old.txt',3,'cafebabe',0)" >/dev/null
$PSQL -c "INSERT INTO tree_text (node_id,owner_id,text,workspace_id) VALUES ($NID,1,'старо съдържание',0)" >/dev/null

boot 2 || exit 1
LEFT=$($PSQL -c "SELECT (SELECT COUNT(*) FROM tree_nodes WHERE workspace_id IS NULL OR workspace_id=0) + (SELECT COUNT(*) FROM tree_versions WHERE workspace_id IS NULL OR workspace_id=0) + (SELECT COUNT(*) FROM tree_text WHERE workspace_id IS NULL OR workspace_id=0)")
[[ "$LEFT" == "0" ]] && pass "нищо не остана с ws=0" || fail "останали $LEFT реда с ws=0"

ADM=$(login superadmin@secp.local '123+123')
OLD=$(curl -s -H "Authorization: Bearer $ADM" "$B/v1/fs/list?path=/" \
  | python3 -c "import sys,json;print(sum(1 for i in json.load(sys.stdin)['items'] if i['name'] in ('old.txt','olddir')))" 2>/dev/null)
[[ "$OLD" == "2" ]] && pass "старите файлове се виждат в личното" || fail "виждат се $OLD/2 стари файла"
SRCH=$(curl -s -H "Authorization: Bearer $ADM" "$B/v1/search?q=старо" | jqv "['count']")
[[ "$SRCH" == "1" ]] && pass "търсенето намира стария текст" || fail "търсенето върна $SRCH (очаквах 1)"

echo
if [[ $FAILED -eq 0 ]]; then
  echo "ws_files_smoke: all passed"
else
  echo "ws_files_smoke: ИМА ПРОВАЛИ"
fi
exit $FAILED
