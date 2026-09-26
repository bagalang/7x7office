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
редакция на офис файлове в Collabora (DOCX, XLSX, ODT, ODS, PPTX, PPT, ODP),
realtime събития по WebSocket и фонови задачи.

## От Cells микросервизи → към Baga модули

Cells v5 е микросервизна архитектура (Go + gRPC + NATS + MySQL + S3).
**secp е модулен монолит** по шаблона `apps/*` от BASE.md — един fmrbaga
процес с вътрешни модули, които огледално следват областите на Cells.
Приложението остава в един процес: няма отделни микросервизи и няма
разцепване на scheduler-а или метаданните.

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
                        │  data         datasources: локален FS    │
                        │              или s3baga (SECP_BLOB=s3)   │
                        │  office       преглед и индекс чрез     │
                        │              officebaga · pdfbaga ·      │
                        │              imgbaga · csvbaga · mdbaga  │
                        │              редакция: Collabora (WOPI)  │
                        │  share        публични линкове · cells   │
                        │  broker       activity · chat (chatbaga) │
                        │              · mail (smtpbaga – нов)     │
                        │  scheduler    queuebaga jobs: thumbnails,│
                        │              индексиране, изтичания      │
                        └──────┬───────────────────────┬───────────┘
                               ▼                       ▼
                     ormbaga → pgbaga → Postgres    локален FS
                     (или boilabaga → boilaDB)      или S3 (blobs)
```

### Съответствие Cells → secp

| Cells v5 (`cells-5-dev/`) | secp модул | Baga пакети |
|---|---|---|
| `gateway/restv2` | REST API | fmrbaga, httpdbaga, jsonrpcbaga |
| `gateway/dav` | WebDAV gateway | **davbaga (нов)** ← httpdbaga + xmlbaga |
| `gateway/websocket` | events/нотификации | wsbaga |
| `gateway/wopi` | WOPI (Collabora/OnlyOffice) | wopibaga |
| `idm/user · role · policy` | idm | jwtbaga, otpbaga, oauthbaga, ormbaga |
| `idm/workspace · acl` | workspaces + ACL | ormbaga, pathbaga |
| `idm/share` | share links / cells | uuidbaga, jwtbaga |
| `data/tree · versions · meta` | tree + versions | ormbaga, chronobaga |
| `data/source` | datasources | локален FS или **s3baga** (`SECP_BLOB=s3`) |
| `data/search` | търсене | PG FTS чрез pgbaga → **searchbaga (нов)** |
| `broker/activity · chat · log` | activity + chat | chatbaga, wsbaga, logbaga |
| `broker/mailer` | поща | **smtpbaga (нов)** ← std TLS |
| `scheduler/jobs · tasks · timer` | scheduler | queuebaga, relbaga, ctxbaga |
| `common/crypto` | енкрипция | std/crypto (AES-GCM, X25519) |
| — | офис документи | индексът е `officebaga`; редакцията е Collabora през WOPI |

## Модулен монолит (архитектурно решение)

secp остава **един процес**. Модулите са граници в кода, не бъдещи сервизи.

**Правила, задължителни от Фаза 0:**

1. **Междумодулна комуникация само през функции** — `tree` не пише в
   таблиците на `idm`, а вика публичните функции на модула.
2. **Схема per модул** — всяка таблица има точно един собственик-модул
   (`idm_users`, `tree_nodes`, `share_links`…).
3. **Събитията са редове в базата** — activity и чатът се записват в процеса;
   WebSocket каналът ги чете оттам. Няма отделен брокер.
4. **Сесията е JWT** (jwtbaga) в същия процес.

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
| **wopibaga** | WOPI: CheckFileInfo, Get/Put, заключване (Collabora/OnlyOffice) | std | 7 |
| **s3baga** | S3 datasource за blobs (path-style SigV4, `SECP_BLOB=s3`) | std | 7 |

Възможна дупка: **resize в imgbaga** за thumbnails — проверява се във фаза 1;
ако липсва, добавя се nearest/bilinear там (пакетът вече decode/encode PNG/JPEG).

## Търсене (Фаза 6)

- Извличането на текст е при **запис** на файла (`tree/store.baga` → `tree/text.baga`):
  plain/md/csv/json/html/xml и Office (DOCX/XLSX/ODT/ODS) през officebaga. Таванът е
  `SECP_TEXT_MAX_KB` (1 MiB), за да не влиза огромен текст в базата.
- Текстът живее в отделна таблица `tree_text` (PK `node_id`, 1:1 с файл) — метаданните
  в `tree_nodes` остават тънки, а търсенето не пипа големия ред.
- `GET /v1/search?q=&limit=` търси с `ILIKE` по **име** и по **съдържание** и връща
  `in_text` (1 = съвпадението е в съдържанието). Избран е `ILIKE`, не PG `to_tsvector`,
  защото boilaDB не поддържа FTS — приложението работи и на двете среди (gaps G11).
  Файловете на други собственици не се виждат.
- `POST /v1/search/reindex` (само админ) нарежда фоново индексиране на файловете без
  запис в `tree_text` — нужно веднъж за файловете отпреди тази фаза.
- Фронтенд `/search`: търсене на живо (350 ms debounce), въпросът е в URL-а (`?q=`),
  за да е споделим; връзка в навигацията; 4 езика.

## Scheduler (Фаза 6)

Фоновите задачи са в `ops_jobs` — **персистентна** опашка, не queuebaga (тя пази в `/tmp`
и иска споделено състояние между нишки; gaps G12). `system/scheduler.baga` вдига един
ticker worker от `main`: на партиди взима `pending`, маркира `running`, изпълнява, маркира
`done`/`failed`. След 3 опита остава `failed` с причината. При старт задачите, останали
`running` от убит процес, се връщат на `pending` (gaps G13).

- Видове: `extract-text` (ползва се от reindex); `mail-send` (Фаза 6.3 — писмата
  минават през опашката, за да не чака заявката доставчик); `expire` е за Фаза 7.
- `SECP_SCHED_MS` (дефолт 5000) — `0` изключва scheduler-а (за тестове / `--check`).
- Всяка итерация отваря собствена DB връзка — връзките не се споделят между нишки.

Проверка: `SELECT kind, status, count(*) FROM ops_jobs GROUP BY kind, status;`

## Поща (Фаза 6.3)

Изпращането е през **`smtpbaga`** (универсален пакет, `app-product/smtpbaga/`).
Пощата е **изключена по подразбиране**: без `SMTP_HOST` приложението работи
нормално, а писмата просто не се пращат (важно за dev и тестове).

- `POST /v1/auth/forgot` `{email}` — винаги отговаря 200, независимо дали имейлът
  съществува. Така не може да се проверява кои имейли имат акаунт. Ако има, се
  нарежда писмо с линк `SECP_PUBLIC_URL/reset?token=…`.
- `POST /v1/auth/reset` `{token, password}` — сменя паролата. Токенът е **еднократен**
  (в базата се пази само `SHA-256` хешът), с TTL `SECP_RESET_TTL_MIN` (деф. 60 мин).
  Нов токен инвалидира предишните неизползвани.
- При създаване на потребител се нарежда welcome писмо. **Паролата не се праща по
  поща** — имейлът не е тайна връзка.

Променливи: `SMTP_HOST`, `SMTP_PORT` (деф. 465/587/25 според `SMTP_TLS`),
`SMTP_TLS` (`starttls` деф. | `tls` | `plain`), `SMTP_FROM`, `SMTP_USER`, `SMTP_PASS`,
`SMTP_HELO`, `SMTP_TIMEOUT_S`, `SECP_PUBLIC_URL`, `SECP_RESET_TTL_MIN`.
`SMTP_INSECURE=1` приема самоподписан сертификат — **само за dev**.

Проверка без реален доставчик: `secp/tools/mock_smtp.baga` слуша на `MOCK_SMTP_PORT`
и записва писмата в `MOCK_SMTP_OUT`:

```bash
# терминал 1
MOCK_SMTP_PORT=2525 MOCK_SMTP_OUT=/tmp/mail.txt ./target/mock_smtp
# терминал 2 (secp)
SMTP_HOST=127.0.0.1 SMTP_PORT=2525 SMTP_TLS=plain SMTP_FROM=no-reply@7x7.local …
```

UI: `/forgot` и `/reset` (двете с връзка от `/login`), 4 езика.

## Отчети (Фаза 6)

Админ вижда място и активност **по пространство**. Обикновен потребител получава 403.

- `GET /v1/reports/storage` — файлове, байтове, членове. Сумите са в `files` и `bytes`.
- `GET /v1/reports/activity` — брой събития по познат verb (същият списък като лентата).
- `?format=csv|xlsx|ods|html|pdf` сваля файла през `reportbaga`. Без format отговорът е JSON.
- `?lang=bg|en|de|ru` избира заглавието и имената на колоните. Непознат език е български.
- Колоната „лично" във файла е `1`/`0`. Verb-колоните носят машинното име (`created`, …).

UI: `/reports` в менюто на админа, 4 езика. PDF иска шрифта DejaVu на сървъра.

## Криптиране на blob-ове (Фаза 7)

Без `SECP_MASTER_KEY` файловете остават открит текст. С 64 hex знака
(32 байта) всеки нов запис е AES-GCM. Ключът на пространството се пази
увит в `data_keys`. ETag-ът си остава SHA-256 на съдържанието. Файл,
качен преди ключа, се чете от стария път.

## WOPI (Фаза 7)

Collabora или OnlyOffice викат secp като WOPI host.

- `GET /v1/wopi/token?path=` (с вход) дава `file_id`, `access_token` и `wopi_src`.
  Адресът ползва `SECP_PUBLIC_URL`, ако е зададен. Срок: `SECP_WOPI_TTL_MIN` (60).
- `GET /wopi/files/{id}` е CheckFileInfo. `GET/POST …/contents` са GetFile и PutFile.
- `POST /wopi/files/{id}` с `X-WOPI-Override: LOCK|UNLOCK|REFRESH_LOCK|GET_LOCK`.
  Чужд lock връща 409 и текущия `X-WOPI-Lock`. PutRelative още е 501.

Клик върху docx, odt, xlsx, ods, pptx, ppsx, ppt, odp, doc или xls
отваря `/office`: страницата взима токен и пуска Collabora в iframe.
Контейнерът е `collabora/code` на порт 9980 (`deploy/docker-compose.yml`).
`COLLABORA_URL` е адресът, от който UI сървърът чете `/hosting/discovery`.
Вграденият редактор остава само за txt, md и csv. Кликът не вика
`/v1/fs/preview` и `/v1/doc/load` за тези офис формати: те разгъват целия
файл в secp. `officebaga` остава за търсене и за преглед на текст.

## S3 за blob-ове (Фаза 7)

Без `SECP_BLOB` файловете стоят на локалния диск (`SECP_DATA_ROOT`).
`SECP_BLOB=s3` праща същите ключове към path-style S3:

- `S3_ENDPOINT` (например `http://127.0.0.1:9000`), `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`
- `S3_REGION` (ако липсва: `us-east-1`), `S3_TIMEOUT_S` (ако липсва: 30)
- ключ `blobs/<aa>/<bb>/<sha256>`; при `SECP_MASTER_KEY` — `blobs/w<id>/…/<sha256>`

Подписът е AWS SigV4. Тялото е двоично, включително нулев байт.
Virtual-hosted bucket, chunked отговор и multipart качване не влизат в 0.1.0.
rocksbaga и blob вътре в boilaDB остават за по-късно.

## Следа и таван (Фаза 7)

Всеки HTTP отговор носи `traceparent`. Ако заявката е дошла със валиден
header, отговорът е дете със същия trace id. 404 и 405 също.

- `SECP_OTEL_URL` (например `http://127.0.0.1:4318/v1/traces`) праща span-а
  като OTLP/JSON. Празен адрес не праща нищо. Грешка при пращане не проваля
  заявката. `SECP_OTEL_TIMEOUT_S` (ако липсва: 2).
- Tick-ът на scheduler-а праща span `secp.scheduler`, когато адресът е зададен.
- `SECP_BULKHEAD` е брой едновременни заявки (ако липсва: 64). `0` изключва
  тавана. Над него отговорът е 429 с `Retry-After: 1`.
- `/health`, `/ready`, `/readyz` и `/metrics` не взимат слот.
- Метриката е `secp_bulkhead_cap`.

WebSocket и S3 не препращат `traceparent`. Таванът не брои опити за парола
на публичен линк.

## Работни пространства и роли (Фаза 2)

Пространството е контейнер за файлове. Всеки получава **лично** при първо
отваряне на `/workspaces` (не се създава с миграция — старите потребители
просто го получават при първия поглед). Екипните се създават и се споделят.

| Роля | Може |
|---|---|
| `owner` | всичко, вкл. членове и триене на пространството |
| `editor` | чете и пише файлове |
| `viewer` | само чете |
| `admin` | като owner навсякъде (за да не може екипът да се заключи сам) |

Правила, наложени от сървъра (не само в UI-а):

- чуждият workspace дава **404**, не 403 — не се издава, че съществува;
- личният не се трие и не приема членове;
- **последният owner** не може да бъде премахнат или понижен;
- `owner` се дава само при добавяне (не с `PATCH`), за да не се направи втори
  собственик с два клика;
- повторно добавяне на съществуващ член **сменя ролята** му, не прави втори ред.

```bash
GET    /v1/workspaces                          # моите (админ: всички)
POST   /v1/workspaces            {label, description}
PATCH  /v1/workspaces?workspace_id=  {label, description}
DELETE /v1/workspaces?workspace_id=
GET    /v1/workspaces/members?workspace_id=
POST   /v1/workspaces/members?workspace_id=  {email, role}
PATCH  /v1/workspaces/members?workspace_id=&member_id=  {role}
DELETE /v1/workspaces/members?workspace_id=&member_id=
```

UI: `/workspaces` (4 езика, светла/тъмна тема). Членовете се задават **по
имейл** — id-тата на boilaDB се дават с `MAX(id)+1` и не са стабилни за
външни хора, а имейлът е това, което админът вижда.

**Готово:** `tree_nodes` вече е с `workspace_id` (не `owner_id`); съществуващите
възли се връзват към личното пространство на собственика при boot
(`tree/backfill.baga`). Правата са по възел (ACL, `tree/acl_*.baga`), а не само
по пространство — файл може да е заключен за конкретен член с най-специфичното
правило по път.

## Публични линкове (Фаза 3)

Линк към файл или папка, който работи **без вход** — за „прати този файл на
човек без акаунт". Собственикът задава ниво, срок, таван на свалянията и
(по избор) парола.

| Поле | Значение |
|---|---|
| ниво 1 | четене и сваляне (за файл това е единственото) |
| ниво 2 | качване/замяна **в папката** (само за папки) |
| срок | часове (липсва → `SECP_SHARE_TTL_H`, деф. 168; `0` → без срок) |
| таван | `max_downloads` (0 → без таван) |
| парола | по избор, минимум 6 знака (PBKDF2) |

```bash
GET    /v1/fs/share?workspace_id=&path=       # линковете към пътя (ниво 3 върху пътя)
POST   /v1/fs/share                           # {path, level?, expires_h?, max_downloads?, password?}
DELETE /v1/fs/share?workspace_id=&share_id=   # отнемане (идемпотентно)

GET    /s/{token}                             # мета (не иска парола: „има парола")
POST   /s/{token}/unlock                      # {password} → краткотраен pass_token
GET    /s/{token}/view?path=&pass=            # списък (папка) или съдържание (файл)
GET    /s/{token}/download?path=&pass=        # файлът като attachment (брои сваляне)
PUT    /s/{token}/upload?path=&name=&pass=    # в папка (само ниво 2)
```

Решения, които си струва да се знаят:

- В базата се пази **само хешът** на токена (като reset токените). Изтекъл dump
  не дава достъп. Суровият токен се вижда само веднъж — при създаването.
- „няма такъв", „изтекъл" и „отнет" връщат **един и същ 404** — по кода не може
  да се проверява дали даден токен е съществувал.
- Паролата **не влиза в URL-а**: `unlock` връща JWT с claim `share` = id на
  линка, който се носи като `?pass=`. Иначе всеки рутер/лог би я виждал.
  Токенът важи само за своите линка и срок (проверено в теста).
- `path` винаги се проверява да е **вътре в поддървото** на линка; `../` се
  орязва и името при качване не приема `/` (иначе се пише извън папката).
- Изтрит възел/пространство отнема линковете си; преместване на поддърво
  мести пътищата им — линкът не „изтича" при преименуване на файла.
- Публичните маршрути са с `public=1` в метаданните на маршрута (fmrbaga), не
  по име на път.

UI: раздел „Линкове" в диалога „Споделяне" (създаване, еднократно показване +
копиране, отнемане) и публична страница `/share/<token>` (4 езика, светла/тъмна
тема) — парола, списък, преглед на текст, сваляне, качване. `next.config.ts`
проксира и `/s/*` към API-то.

Тестове: `tests/share_roles_test.baga` (чиста логика, в CI) и
`tools/ws_files_smoke.sh` (живият сървър: поддърво, `../`, нива, парола,
изолация на `pass_token`, таван, отнемане, изтрит възел).

## Activity feed (Фаза 3)

Одит на действията в пространството: кой какво е създал, променил, изтрил,
преместил, възстановил или споделил. Лентата се показва в горния бар (цялото
пространство) и като „История" в панела на файл (възелът + поддървото му).

```bash
GET /v1/activity?workspace_id=&limit=&path=&actor_id=
```

Решения, които си струва да се знаят:

- **Append-only**: изтрит възел не трие историята си (иначе „кой изтри файла"
  изчезва точно когато е най-нужно). Чисти се само с пространството.
- `ts` е **epoch секунди** (BIGINT), не `TIMESTAMPTZ` — PG и boilaDB еднакво
  (G23/G42). `path` е денормализиран, за да оцелее след преместване/изтриване.
- **Best-effort**: провал на записа не връща каченото/издаденото назад — одитът
  е спомагателен, не основен. Грешката се печата и действието продължава.
- Verb-овете са **машинни низове** (`created`, `member_added`, …), а преводът е
  на фронтенда по ключ `activity.verb_*`. Така нов език не пипа базата, а стари
  редове не „изчезват" при нов превод. Непознат verb не се показва.
- Иска ниво **read в пространството** (не на всеки ред): редът пази път, а не
  възел, и изричното право се мени с времето — историята не бива да „изчезва"
  ретроактивно. Затова е правило за цялото пространство (G51).
- Филтрите `path` и `actor_id` са **взаимно изключващи се** (пътят печели):
  v1 покрива „история на файл" и „какво е правил Иван" — комбинацията е рядко
  полезен ъгъл.
- `LEFT JOIN idm_users` в самата заявка — иначе списък от 50 реда прави 50
  допълнителни заявки за имейл.

Тестове: `tests/activity_kinds_test.baga` (чиста логика, в CI) и
`tools/ws_files_smoke.sh` (живият сървър: запис от всяко действие, филтър по
път без „изтичане" към съсед с общ префикс, актьорът в реда, не-член → 404,
триене на пространство изчиства и одита).

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

### WebDAV

Пространството се монтира на API порта, не през Next:

```bash
rclone copyto ./file.txt :webdav:inbox/file.txt \
  --webdav-url http://127.0.0.1:8085/dav/0 \
  --webdav-vendor other \
  --webdav-user admin@secp.local \
  --webdav-pass "$(rclone obscure 'admin123')"
```

`0` е личното пространство. За екипно се слага неговото id (`/dav/12`). Входът е Basic (имейл и парола) или `Authorization: Bearer`. Клас 2 е наличен: `LOCK`/`UNLOCK` (изключително заключване, `If`/`Lock-Token`; без токен писането е 423) и `PROPPATCH` (207 с 403 за всяко свойство — не се пазят). Пълният `If` с `Not` и или-списъци още не се оценява (G — виж `davbaga/gaps.md`). Жив тест: `secp/tools/dav_smoke.sh`.

### Realtime каналът (WS) — как се стига до него

`secp` отваря втори слушател за WebSocket (`SECP_WS_PORT`, по подразбиране
8086, `/ws`). Браузърът се удостоверява с Cookie-то `secp_token` — то е по
**хост**, не по порт, затова стига и до 8086.

- **Development:** `next dev` (3010) НЕ може да проксира WS upgrade
  (`rewrites()` връща 404 — Next проксира само HTTP). Затова каналът се
  отваря директно на 8086:
  ```bash
  NEXT_PUBLIC_WS_PORT=8086 npm run dev
  ```
  Клиентът (`lib/ws.ts`) сам сглобява `ws://<host>:<port>/ws`. Ако не се
  зададе, отива на same-origin `/ws` → 404 в dev (в production е правилното).
- **Production:** пред Next и secp стои едно прокси на 443/80 и подава
  `/ws` към `SECP_WS_PORT`. Тогава same-origin `/ws` работи без нищо друго:
  ```nginx
  location /ws {
    proxy_pass http://127.0.0.1:8086;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;  # map: upgrade
    proxy_read_timeout 1h;   # иначе по-дълъг живот без кадри се къса
  }
  ```
  Caddy го прави сам с `reverse_proxy 127.0.0.1:8086`.
- **Друг хост за канала:** `NEXT_PUBLIC_WS_URL=wss://ws.example.com` (тогава
  бисквитката няма да пътува, освен ако домейните не са под общ родител;
  като резервен вариант има `NEXT_PUBLIC_WS_TOKEN_IN_URL=1`, но токен в URL
  влиза в логовете на прокситата — ползва се само ако Cookie-то е невъзможно).

## Принципи (по BASE.md)

1. secp е **самостоятелно приложение** — собствени routes, models, миграции.
2. Новите пакети (`davbaga`, `smtpbaga`…) са **универсални** — без secp домейн в тях; по един репо/пакет, `sandak.toml`, path deps към `app-product/`.
3. Параметризирани заявки (`$1`) за потребителски вход; worker pool в production.
4. Всички blob пътища през `pathbaga`; никакъв `../../` в import-и.
