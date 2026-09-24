# 7x7office — **secp**

**Office платформа за споделяне на файлове като [Pydio Cells](https://pydio.com/),
написана на [Baga](https://github.com/katehonz/baga-lang).**

> `secp/cells-5-dev/` е **референтно копие** на Pydio Cells v5 (Go) — ползваме
> го като архитектурна карта (сервизи, потоци, протоколи), не като код за порт.

| | |
|--|--|
| **Език** | Baga 1.1.2 |
| **Приложение** | `app-product/7x7office/secp/` (sandak app, модулен монолит) |
| **Стек** | `fmrbaga → httpdbaga · jwtbaga · ormbaga → pgbaga / boilaDB` (виж [BASE.md](../BASE.md)) |
| **План** | [PLAN.md](PLAN.md) |

## Какво е secp

Самохоствана платформа за **файлове + офис документи за организации**:
workspaces, споделени „клетки" (cells), ACL права, версии, WebDAV достъп,
преглед/редакция на DOCX/XLSX/ODT/ODS директно чрез `officebaga`,
realtime събития по WebSocket и фонови задачи.

## От Cells микросервизи → към Baga модули

Cells v5 е микросервизна архитектура (Go + gRPC + NATS + MySQL + S3).
**secp е модулен монолит** по шаблона `apps/*` от BASE.md — един fmrbaga
процес с вътрешни модули, които огледално следват сервизите на Cells.
Разцепване на процеси (по `raftbaga`/`queuebaga`) е фаза 7, не ден 1.

```
                        ┌──────────────────────────────────────────┐
  браузър / dav клиент  │                secp (fmrbaga app)        │
  ─────────────────────►│                                          │
   REST  WebDAV  WS     │  gateway      REST маршрути + davbaga    │
                        │              + wsbaga събития            │
                        │  idm          users · roles · workspaces │
                        │              · acl · policies (jwtbaga)  │
                        │  tree         виртуално дърво nodes +    │
                        │              versions + meta (ormbaga)   │
                        │  data         datasources: local FS →    │
                        │              blobs (rocksbaga по-късно)  │
                        │  office       preview/edit чрез          │
                        │              officebaga · pdfbaga ·      │
                        │              imgbaga · csvbaga · mdbaga  │
                        │  share        публични линкове · cells   │
                        │  broker       activity · chat (chatbaga) │
                        │              · mail (smtpbaga – нов)     │
                        │  scheduler    queuebaga jobs: thumbnails,│
                        │              индексиране, изтичания      │
                        └──────┬───────────────────────┬───────────┘
                               ▼                       ▼
                     ormbaga → pgbaga → Postgres    локален FS
                     (или boilabaga → boilaDB)      (blobs)
```

### Съответствие Cells → secp

| Cells v5 (`cells-5-dev/`) | secp модул | Baga пакети |
|---|---|---|
| `gateway/restv2` | REST API | fmrbaga, httpdbaga, jsonrpcbaga |
| `gateway/dav` | WebDAV gateway | **davbaga (нов)** ← httpdbaga + xmlbaga |
| `gateway/websocket` | events/нотификации | wsbaga |
| `gateway/wopi` | WOPI (Collabora/OnlyOffice) | **wopibaga (нов, фаза 7)** |
| `idm/user · role · policy` | idm | jwtbaga, otpbaga, oauthbaga, ormbaga |
| `idm/workspace · acl` | workspaces + ACL | ormbaga, pathbaga |
| `idm/share` | share links / cells | uuidbaga, jwtbaga |
| `data/tree · versions · meta` | tree + versions | ormbaga, chronobaga |
| `data/source` | datasources | std FS → rocksbaga / **s3baga (по-късно)** |
| `data/search` | търсене | PG FTS чрез pgbaga → **searchbaga (нов)** |
| `broker/activity · chat · log` | activity + chat | chatbaga, wsbaga, logbaga |
| `broker/mailer` | поща | **smtpbaga (нов)** ← std TLS |
| `scheduler/jobs · tasks · timer` | scheduler | queuebaga, relbaga, ctxbaga |
| `common/crypto` | енкрипция | std/crypto (AES-GCM, X25519) |
| — | офис документи | **officebaga** (DOCX/XLSX/ODT/ODS) — тук сме по-силни от Cells, което разчита на външен Collabora |

## Монолит → микросервизи (архитектурно решение)

Модулният монолит е **временна форма, не ограничение**: модулите следват 1:1
сервизите на Cells и се пишат от ден 1 с граници на микросервизи, за да е
евтино разцепването, когато се наложи.

**Правила, задължителни от Фаза 0:**

1. **Междумодулна комуникация само през интерфейси** — `tree` никога не пише в
   таблиците на `idm`, а вика `idm.effective_rights(user, node)`. В монолита е
   function call, в микросвят — RPC със същата сигнатура. Без shared database.
2. **Схема per модул** — всяка таблица има точно един собственик-модул
   (`idm_users`, `tree_nodes`, `share_links`…). Базата се разделя по префикси.
3. **Събития през bus-абстракция** — в монолита `broker` е in-process опашка
   (queuebaga); при разцепване се сменя само transport-ът (jsonrpcbaga/pbbaga),
   а производителите/консуматорите на `node.created` и пр. не се пипат.
4. **Stateless gateway** — сесийно състояние само в JWT (jwtbaga); gateway-ят
   се мащабира хоризонтално още преди разцепване.

**Пакети за микросвят (вече налични):**

| Нужда | Пакет |
|---|---|
| RPC между процеси | jsonrpcbaga · pbbaga (protobuf + gRPC framing) · statusbaga · mdtbaga |
| Context/deadline propagation | ctxbaga |
| Консенсус за метаданни | raftbaga |
| Разпределени транзакции | txnbaga (2PC + MVCC) |
| Трейсинг през процеси | otelbaga (W3C traceparent) |
| Устойчивост | relbaga (retry/breaker/bulkhead) |

**Път на разцепване (Фаза 7):**

```
монолит
  → 7а: scheduler/worker отделно (queuebaga вече е границата)
  → 7б: data/blobs отделно (тежък IO — S3/rocksbaga)
  → 7в: idm отделно (споделен login с други приложения, напр. bagabuch)
  → idm + tree + gateway отделни = архитектурата на Cells
```

## Пакети

### Налични — ползваме директно

| Група | Пакети |
|---|---|
| Web/HTTP | fmrbaga · httpdbaga (H1+H2) · wsbaga · jsonrpcbaga |
| Auth | jwtbaga (HS256/RS256/ES256) · otpbaga · oauthbaga |
| Данни | ormbaga · pgbaga · boilabaga (boilaDB) · txnbaga |
| Офис | **officebaga** · pdfbaga · imgbaga · csvbaga · zipbaga · xmlbaga · mdbaga |
| Асинхронно | queuebaga · ctxbaga · relbaga |
| Инфра | logbaga · metbaga · otelbaga · flagbaga · rocksbaga |
| Утилита | pathbaga · globbaga · uuidbaga · bufbaga · chronobaga · tplbaga · grebaga |

### Липсващи — нови пакети (по BASE.md правило „универсални, без домейн")

| Пакет | Роля | Зависи от | Фаза |
|---|---|---|---|
| **davbaga** | WebDAV сървър (PROPFIND/PROPPATCH/MKCOL/COPY/MOVE/LOCK) — Finder/Explorer/rclone монтиране | httpdbaga, xmlbaga | 4 |
| **smtpbaga** | SMTP клиент за покани/ресет на парола (pure TLS от std) | std/net | 6 |
| **searchbaga** | full-text индекс върху rocksbaga (v1: PG FTS е достатъчен) | rocksbaga | 6 |
| **wopibaga** | WOPI протокол за Collabora/OnlyOffice (по желание — имаме officebaga) | httpdbaga | 7 |
| **s3baga** | S3 datasource за blobs (по желание) | httpdbaga client | 7 |

Възможна дупка: **resize в imgbaga** за thumbnails — проверява се във фаза 1;
ако липсва, добавя се nearest/bilinear там (пакетът вече decode/encode PNG/JPEG).

## Фронтенд

Фронтендът **не е на Baga**. Продуктовият UI е **Next.js** в `frontend/`
(същият модел като bagabuch: браузърът говори само с Next, Next проксира
`/v1/*` към secp). `tplbaga` страниците в `secp/ui/` остават тънък fallback
за логин без Node.

### Езици (bg / en / de / ru) и проверка на правописа

- Речници: `frontend/lib/i18n.ts` + `i18n-{bg,en,de,ru}.ts` — плоски ключове,
  `{var}` подстановки, без външна библиотека. Дефолт: запазеният избор →
  браузърен `Accept-Language` → `bg`.
- `I18nProvider` държи `<html lang>` в синхрон (`bg-BG`/`en-US`/`de-DE`/`ru-RU`).
- **Проверката на правописа** идва от браузъра: `spellCheck` + `lang` на
  редактора и на `<html>`. Четирите езика имат вградени речници във всеки
  съвременен браузър — не са нужни добавки.

### Тема (светла / тъмна / системна)

- `frontend/lib/theme.ts` + `ThemeProvider`. Атрибутът `data-theme` се слага
  от inline скрипт **преди първото рисуване** → без бял блясък при тъмна тема.
- „Системна" следва `prefers-color-scheme` на живо.
- По практиките за комфорт на очите: фонът не е чист черен (#14171c), текстът
  не е чист бял (#e3e6ea) — по-нисък максимален контраст без „ореол"; тъмни
  сенки; `prefers-reduced-motion`; видим `:focus-visible`; по-големи цели при тъч.
- Менюто „тема + език" е в горния бар (и на login страницата).

```bash
# API. Стартира се от secp/, за да остане ./storage до изходния код.
cd app-product/7x7office/secp
export PATH="$(cd ../../.. && pwd):$PATH"
sandak build
PORT=8085 JWT_SECRET=dev-secret \
  PGHOST=127.0.0.1 PGPORT=5432 PGUSER=bagatest PGPASSWORD='pas+123' PGDATABASE=secp \
  SECP_ADMIN_EMAIL=admin@secp.local SECP_ADMIN_PASSWORD=admin123 \
  SECP_DATA_ROOT=./storage \
  ./target/secp

# UI — http://127.0.0.1:3010 , API през SECP_API_PROXY (по подразбиране :8085)
cd app-product/7x7office/frontend
npm install
npm run dev
```

Вход за локалния seed: `admin@secp.local` / `admin123`.

## Принципи (по BASE.md)

1. secp е **самостоятелно приложение** — собствени routes, models, миграции.
2. Новите пакети (`davbaga`, `smtpbaga`…) са **универсални** — без secp домейн в тях; по един репо/пакет, `sandak.toml`, path deps към `app-product/`.
3. Параметризирани заявки (`$1`) за потребителски вход; worker pool в production.
4. Всички blob пътища през `pathbaga`; никакъв `../../` в import-и.
