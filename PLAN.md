# secp — План-карта

Цел: office платформа като Pydio Cells, на Baga, в `app-product/7x7office/secp/`.
Референция: `secp/cells-5-dev/` (Cells v5, Go). Архитектура: [README.md](README.md).

```
Фаза 0  скелет        ──►  приложението се билдва и логва
Фаза 1  файлове MVP   ──►  upload/download/list + thumbnails
Фаза 2  idm + ACL     ──►  users, roles, workspaces, права
Фаза 3  споделяне     ──►  линкове, cells, activity, WS, чат
Фаза 4  WebDAV        ──►  davbaga, монтиране от ОС
Фаза 5  офис          ──►  preview/edit DOCX/XLSX/ODT/ODS + версии
Фаза 6  търсене/поща  ──►  FTS, smtpbaga, scheduler actions
Фаза 7  хардънинг     ──►  квоти, криптиране, WOPI, клъстер (по желание)
```

---

## Фаза 0 — Скелет на приложението ✅ (2026-09-24)

**Резултат:** `sandak build` минава; `secp serve` вдига fmrbaga с health, логин и празен UI.

- [x] `secp/sandak.toml` (name = `secp`, path deps към `../../fmrbaga` и др. по BASE.md)
- [x] Структура по шаблона `apps/api`: `start.baga`, `routes.baga`, `schema.baga`, модулни папки `idm/ system/ ui/ lib/`
- [x] Миграции (ormbaga): `idm_users`, `idm_sessions` (Postgres + boila двойни сетове)
- [x] Auth: логин/логаут с jwtbaga (HS256, bearer + HttpOnly cookie); пароли: PBKDF2-HMAC-SHA256 в `lib/pass.baga` (gaps G1 — std няма bcrypt; верифицирано срещу публикувани вектори)
- [x] Конфиг по 12-factor (`.env.example`), health/ready/meta/openapi/metrics endpoint-и
- [x] `tplbaga` базов layout + login страница (SSR, cookie→JWT)
- [x] Smoke: билд, миграции, seed admin, login (JSON + форма), me, logout, UI страници — **на Postgres 5432 и на boilaDB :6575** (ORM_BACKEND=boila, MAX(id)+1 път)
- [ ] Тестове: testbaga smoke по маршрутите (остава — `tests/` в baga монорепото)

**Зависимости:** fmrbaga, jwtbaga, ormbaga, pgbaga, logbaga, metbaga, flagbaga, tplbaga

## Фаза 1 — Файлове MVP

**Резултат:** през браузъра (Next.js в `frontend/`, порт 3010): качване, сваляне, списък, преименуване, триене; thumbnails за картинки. API-то остава в secp.

- [x] Модул `data`: datasource `local-fs` (blobs на диска, content-addressed по SHA-256 от std/crypto). Коренът е `SECP_DATA_ROOT` (`./storage`)
- [x] Модул `tree`: таблица `tree_nodes`, виртуални пътища чрез pathbaga
- [x] REST: `PUT/GET/DELETE /v1/fs/file?path=`, list/stat/mkdir/move/thumb/usage. Тялото се чете цяло (още няма streaming); paging на списъка липсва
- [ ] Upload: multipart + resumable — v1 е суров PUT на тялото
- [x] imgbaga има `img_resize_bilinear`; thumbnails го ползват
- [x] Thumbnail при качване (PNG, дългата страна 256px), кеш в blob store. Опашка в queuebaga остава за по-късно
- [x] Квота (`SECP_QUOTA_MB`, подразбиране 1 GiB) и горна граница (`SECP_MAX_FILE_MB`)

**Зависимости:** ormbaga, pathbaga, uuidbaga, imgbaga, queuebaga, ctxbaga, relbaga

## Фаза 2 — Идентичности, workspaces, ACL

**Резултат:** админ създава потребители/роли/workspaces; достъпът до възли се филтрира по ACL.

- [ ] Модул `idm`: списък и създаване на потребители (API + Next, само админ). `roles`, `groups`, `workspaces` остават
- [ ] ACL таблица: (subject: user/role, node, right: read/write/share, inherited)
- [ ] Изчисляване на ефективни права по пътя (кеш; по-късно policy engine)
- [ ] Админ UI (tplbaga): потребители, роли, workspaces
- [ ] otpbaga TOTP (по желание за админ), oauthbaga OIDC login (RS256/ES256 verify)
- [ ] Аудит лог на auth събития (logbaga)

**Зависимости:** otpbaga, oauthbaga, jwtbaga, ormbaga

## Фаза 3 — Споделяне и realtime

**Резултат:** публични линкове с парола/срок; споделени „клетки"; activity feed; WS нотификации; чат по стая.

- [ ] Модул `share`: линкове (uuidbaga токен, expiry, парола-чрез-hash, download count)
- [ ] „Cells" = споделен workspace с членове и роли (по `idm/share` модела)
- [ ] Activity feed: таблица `activity` (actor, verb, node, ts — chronobaga), изглед per node/user
- [ ] wsbaga gateway: канали per workspace; събития node.created/updated/deleted
- [ ] chatbaga интеграция: чат стая per cell
- [ ] Нотификации в UI (badge през WS)

**Зависимости:** uuidbaga, chronobaga, wsbaga, chatbaga

## Фаза 4 — WebDAV

**Резултат:** Finder/Explorer/rclone монтират workspace; файлов мениджър на ОС-то работи върху secp.

- [ ] **Нов пакет `davbaga`** (универсален): PROPFIND, PROPPATCH, MKCOL, GET, PUT, DELETE, COPY, MOVE, LOCK/UNLOCK (опция), Depth, If-* headers
- [ ] XML тела чрез xmlbaga; маршрут `/dav/<workspace>/...` в secp → tree модул
- [ ] ETag/Mtime консистентност с фаза 1; ACL enforcement (фаза 2)
- [ ] Тестове: litmus-стил сценарии + rclone mount ръчна проверка

**Зависимости:** davbaga (нов: httpdbaga, xmlbaga)

## Фаза 5 — Офис документи и версии

**Резултат:** preview на DOCX/XLSX/ODT/ODS/PDF/CSV/MD в браузъра; редакция и запазване; история на версиите.

- [x] Preview pipeline (2026-09-24): `GET /v1/fs/preview` връща типизиран `kind` — `markdown` (docx/odt/doc чрез officebaga `office_to_markdown_rich`; .md суров), `sheet` (xlsx/xls/ods → TSV), `csv`, `text`, `image`, `pdf` (pdfbaga е само writer → браузърът рендира blob-а native чрез `<embed>`), `empty`. UI: markdown се рендира като HTML (client `mdToHtml`), csv/sheet като таблица, pdf вграден viewer
- [x] Редактор MVP (2026-09-24): `GET /v1/doc/load` + `PUT /v1/doc/save` (markdown за документи, TSV за таблици); DOCX round-trip пази заглавия/bold/italic/списъци (officebaga: `docx_markdown` + inline runs в `from_md`); ODT записва plain; legacy .doc/.xls само за четене. UI: `/edit` — Zoho-стил редактор (toolbar, страница, Ctrl+S) + sheet редактор (клетки, +ред/+колона); „Редактирай" в preview панела. OL номерацията става bullet при запис (v1)
- [x] Модул `versions` (2026-09-24): `tree_versions` (snapshot на предишното съдържание при всяко презаписване/редакция; blob-овете са content-addressed → версия = hash+size+ts); `GET /v1/fs/versions`, `GET /v1/fs/version/get`, `POST /v1/fs/version/restore` (restore snapshot-ва и текущото); cap `SECP_VERSIONS_MAX` (50) с GC; blob GC брои и version референции; версиите се трият с възела. UI: „Версии" диалог в preview панела (свали/възстанови). **Fix в boilaDB**: WHERE fallback — две+ условия от един вид (напр. `owner_id = $1 AND path = $2`) вече се препарсват като общ израз (dual evaluator) вместо `0A000 повторно = условие`, за SELECT и UPDATE/DELETE; `tree_usage` без COALESCE (boila няма COALESCE около агрегат — `pg_cell_i64` мапва NULL→0)
- [x] Конфликтно копие при едновременна редакция (ETag check) (2026-09-24): `doc/load` връща `etag` (hash); `doc/save?etag=` при несъвпадение записва новото съдържание като `<име>.conflict-<hash8>.<ext>` и отговаря 409 „файлът е променен междувременно; записано като …" вместо да презапише. UI: редакторите пратят etag-а от load, обновяват го от отговора на save и при 409 показват съобщението + „Запази отново" презаписва (stale etag се изчиства)
- [x] zipbaga: разглеждане на архив без разархивиране (2026-09-24): `GET /v1/fs/zip/list` (име/размер/папка от central directory) и `GET /v1/fs/zip/get?entry=` (разархивира само записа в паметта); preview `kind=zip`; UI: таблица с файловете в архива + бутон „Свали" per запис

**Зависимости:** officebaga, pdfbaga, csvbaga, mdbaga, zipbaga

## Фаза 6 — Търсене, поща, scheduler

**Резултат:** full-text търсене по име+съдържание; покани/ресет по имейл; фонови actions.

- [ ] v1 търсене: PG full-text (`to_tsvector`) чрез pgbaga + извличане на текст чрез officebaga
- [ ] **Нов пакет `smtpbaga`** (SMTP клиент, pure TLS от std): welcome, share invite, reset password
- [ ] Scheduler actions (по `scheduler/actions` модела): thumbnail, extract-text, expire-shares, quota-report — през queuebaga + timer
- [ ] reportbaga: админ отчети (storage per workspace, activity)
- [ ] **searchbaga** (само ако PG FTS не стигне): индекс върху rocksbaga

**Зависимости:** smtpbaga (нов), reportbaga, queuebaga, grebaga (CLI търсене)

## Фаза 7 — Хардънинг и мащаб (по желание)

- [ ] Криптиране на blobs при покой (AES-GCM от std/crypto, per-workspace ключове — модел `data/key`)
- [ ] WOPI: **wopibaga** за Collabora/OnlyOffice (допълнение към officebaga)
- [ ] **s3baga** datasource; blobs в rocksbaga или директно в **boilaDB** (rocksbaga storage под нея — може да се допълва при нужда) като алтернативи на FS
- [ ] Разцепване на процеси: scheduler отделно; raftbaga клъстер за метаданни (Track S)
- [ ] otelbaga traceparent през целия път; rate limiting (relbaga bulkhead)

---

## Рискове / отворени въпроси

| Тема | Въпрос | Къде се решава |
|---|---|---|
| imgbaga resize | има ли скалиране за thumbnails? | фаза 1, първа седмица |
| Парола-хеш | bcrypt/argon2 в std/crypto или нов `passbaga`? | фаза 0 |
| Streaming upload | httpdbaga chunked/multipart лимити | фаза 1 |
| Фронтенд редактори | колко JS е допустимо извън Baga | фаза 5 |
| Индекс при големи дървета | PG достатъчен ли е за 1M+ nodes | фаза 6 |

## Конвенции

- Всеки нов пакет: отделно репо `bagalang/<name>`, `sandak.toml`, `README.md`, `gaps.md`, submodule в `app-product/`.
- secp държи домейна в `actions/`, `models/`, `schema.baga` — нищо домейнско в пакетите.
- Минимум един `gaps.md` запис на фаза: какво е липсвало в езика/пакетите (обратна връзка към Baga).
