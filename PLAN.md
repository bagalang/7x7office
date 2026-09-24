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
Фаза 5.5 фронтенд      ──►  4 езика (bg/en/de/ru) + spellCheck + светла/тъмна тема
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

- [x] Модул `idm`: списък и създаване на потребители (API + Next, само админ) (2026-09-24)
- [x] Workspaces + членство с роли (2026-09-24): `idm_workspaces` + `idm_workspace_members`;
      роли `owner > editor > viewer` (нивата са в `idm/ws_roles.baga` — чист модул, тестван в
      `tests/ws_test.baga`). Личният workspace се създава лениво при първо отваряне на списъка,
      за да получат старите потребители свой контейнер без миграция на данни. API:
      `GET/POST /v1/workspaces`, `PATCH/DELETE ?workspace_id=`, `GET/POST/PATCH/DELETE
      /v1/workspaces/members`. Чуждият workspace дава 404 (не издава, че съществува); личният
      не се трие и не приема членове; последният owner не може да бъде махнат/понижен.
      UI: `/workspaces` (4 езика, светла/тъмна тема)
- [ ] `roles`/`groups` като собствени (извън фиксираната тройка); ACL таблица: (subject: user/role, node, right: read/write/share, inherited)
- [ ] `tree_nodes` още е с `owner_id`, не с `workspace_id` — връзването е следващата стъпка
      (schema.baga migration), с пренасяне на съществуващите възли в личния workspace
- [ ] Изчисляване на ефективни права по пътя (кеш; по-късно policy engine)
- [ ] Админ UI за потребители/workspaces в tplbaga (сега е Next: `/users`, `/workspaces`)
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

## Фаза 5.5 — Фронтенд: 4 езика и светла/тъмна тема ✅ (2026-09-24)

**Резултат:** интерфейсът говори английски, български, немски и руски; проверка на
правописа на същите езици; светла и тъмна тема по практиките за комфорт на очите.

- [x] i18n без външна библиотека (2026-09-24): `lib/i18n.ts` + `lib/i18n-{bg,en,de,ru}.ts`
  (109 ключа, плоски, `{var}` подстановки). Дефолт език: запазеният избор → браузърен
  `Accept-Language` (ако е един от нашите) → `bg`. `I18nProvider` държи `<html lang>` в
  синхрон; ключовете се проверяват за пълнота между четирите речника
- [x] Проверка на правописа (2026-09-24): `spellCheck` + `lang` на editor-а (`contentEditable`)
  и на `<html>`; bg/en/de/ru имат речници във всеки браузър — работи без добавки
- [x] Превод на целия UI (2026-09-24): login, файлов браузър (вкл. preview панела, zip и
  версиите), редакторите, потребителите, навигацията, квотата, съобщенията за грешки
- [x] Светла/тъмна/системна тема (2026-09-24): `lib/theme.ts` + `ThemeProvider`; атрибут
  `data-theme` на `<html>` се слага от inline скрипт **преди първото рисуване** (без бял
  блясък). „Системна" следва `prefers-color-scheme` на живо
- [x] Практики за очите (2026-09-24): фонът не е чист черен (#14171c), текстът не е чист
  бял (#e3e6ea) — по-нисък максимален контраст без „ореол"; по-светъл акцент; тъмни
  сенки; `prefers-reduced-motion`; `:focus-visible`; по-големи цели при тъч
- [x] Меню „тема + език" в горния бар (и на login страницата), за да не се разпилява UI-ът
- [x] Файловете се разделиха: `FilePreview.tsx` (преглед/zip/версии) от `FileBrowser.tsx`

**Зависимости:** няма нови пакети — само frontend (`frontend/lib`, `frontend/components`)

**Бележка (обратна връзка към Cells):** `cells-5-dev` ползва JSON речници
(`{locale}.all.json`) + Crowdin за превод. Ние оставаме с TS речници — по-малко
движещи се части, типобезопасни и без build стъпка; ако преводите станат много,
може да се мине на Crowdin без промяна в кода (речниците са изолирани).

## Фаза 6 — Търсене, поща, scheduler

**Резултат:** full-text търсене по име+съдържание; покани/ресет по имейл; фонови actions.

### 6.1 Търсене ✅ (2026-09-24)

- [x] Извличане на текст при запис: `tree/text.baga` — plain/md/csv/json/html/xml + DOCX/XLSX/ODT/ODS
      през officebaga; таван `SECP_TEXT_MAX_KB` (по подразбиране 1 MiB) да пази базата от гигантски текстове
- [x] Извлеченият текст е в отделна таблица `tree_text` (node_id е PK, 1:1 с файл) — не раздува `tree_nodes`
- [x] `GET /v1/search?q=` — `ILIKE` по име **и** по извлечено текст (`ESCAPE '\'`, за да не стане „100%" шаблон).
      Избран е `ILIKE`, а не PG `to_tsvector`: boilaDB няма FTS, а приложението трябва да работи и на двете (gaps G11)
- [x] Резултат: id/име/път/размер/`in_text` (съвпадение в съдържанието) + брояч; лимит 1..100
- [x] Фронтенд `/search`: търсене на живо (350 ms debounce), въпросът влиза в URL-а (`?q=` — споделим линк),
      връзка в навигацията; 4 езика
- [x] `POST /v1/search/reindex` (само админ): нарежда `extract-text` за файловете, които още нямат индекс
      (файловете отпреди тази фаза). Идемпотентно
- [x] `scripts/check-i18n.mjs` — проверка, че четирите речника имат еднакви ключове **и** еднакви `{var}`;
      вързана в `npm run check`. Хваща „преведох ключа само в bg"

**Забележка:** пълнотекстовото търсене умишлено не е `to_tsvector` — виж gaps G11. При ръст (1M+ възела)
се минава на PG GIN + `pg_trgm` или на **searchbaga** върху rocksbaga (по-долу).

### 6.2 Scheduler ✅ (2026-09-24)

- [x] Таблица `ops_jobs` — **персистентна** опашка (kind, payload, status, attempts, run_at, last_error).
      Не queuebaga: тя пази работата в `/tmp` и иска споделено състояние между нишки (gaps G12);
      тук задачите трябва да преживеят рестарт и да се виждат от всички worker-и
- [x] `system/scheduler.baga`: един ticker worker (вдига се от `main`), който на партиди (8) взима
      `pending` → `running` → `done`/`failed`. След 3 опита остава `failed` с причината
- [x] Възстановяване след рестарт: `running` задачите се връщат на `pending` при старт
      (иначе висят вечно — няма lease/timeout, виж gaps G13)
- [x] Вид `extract-text` (ползва се от reindex); `expire` е за Фаза 7 (TTL)
- [x] `SECP_SCHED_MS` (дефолт 5000) — 0 изключва scheduler-а (за тестове / `--check`)
- [x] Всяка итерация отваря собствена DB връзка: връзките не се споделят между нишки (gaps G12)

**Зависимости:** officebaga, ormbaga, fmrbaga

### 6.3 Поща (smtpbaga) ✅ (2026-09-24)

- [x] **Нов пакет `smtpbaga`** — SMTP клиент върху `std/net` (TCP + TLS 1.3):
      EHLO, STARTTLS (RFC 3207), AUTH LOGIN, multipart/alternative, RFC 5322
      дата, RFC 2047 UTF-8 заглавия, dot-stuffing. Тест `tests/smtp_test.baga`
      с mock сървър (plain + STARTTLS), без реален доставчик.
- [x] secp: `POST /v1/auth/forgot` + `POST /v1/auth/reset` — токен с TTL
      (`SECP_RESET_TTL_MIN`, деф. 60 мин), пази се само SHA-256 хешът,
      еднократна употреба; нов токен инвалидира старите. Писмото минава
      през scheduler-а (нов вид `mail-send`) — заявката отговаря веднага
- [x] secp: welcome писмо при създаване на потребител (пак през опашката)
- [x] UI: `/forgot` и `/reset` страници (4 езика, светла/тъмна тема)
- [x] dev инструмент: `secp/tools/mock_smtp.baga` — SMTP сървър, който
      записва писмата във файл (тестове без реален доставчик)
- [ ] reportbaga: админ отчети (storage per workspace, activity)
- [ ] **searchbaga** (само ако PG FTS не стигне): индекс върху rocksbaga

**Зависимости:** smtpbaga (готов), reportbaga, queuebaga, grebaga (CLI търсене)

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
