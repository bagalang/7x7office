# secp

**Office платформа за споделяне на файлове (като Pydio Cells), написана на Baga.**
Част от [7x7office](../README.md) · План: [PLAN.md](../PLAN.md)

Модулен монолит по шаблона `apps/*` от [BASE.md](../../BASE.md):
`fmrbaga → httpdbaga · jwtbaga · ormbaga → pgbaga (Postgres) или boilaDB`.

## Статус: Фаза 3 — споделяне (линкове) + activity feed; Фаза 2 — готова

- миграции: `idm_users`, `idm_sessions`, `idm_resets`, `idm_workspaces`, `idm_workspace_members`, `tree_*`, `tree_acl`, `share_links`, `activity`, `ops_jobs` (Postgres + boila двойни сетове)
- вход: `POST /v1/auth/login` (JSON **или** форма) → JWT + HttpOnly cookie
- забравена парола: `POST /v1/auth/forgot` + `POST /v1/auth/reset` (токен с TTL, еднократен; писмо през scheduler-а)
- потребители (админ): `GET/POST /v1/users`; welcome писмо при създаване
- работни пространства: `GET/POST /v1/workspaces`, `PATCH/DELETE ?workspace_id=`;
  членове по имейл с роли `owner > editor > viewer` (личният се създава лениво,
  не се трие; последният owner е защитен)
- **файловете са в пространството, не в потребителя**: всички `/v1/fs/*`, `/v1/doc/*`
  и `/v1/search` приемат `?workspace_id=`; без него → личното пространство. Достъпът се
  резолвва през ролята (`tree/auth.baga`, нива read(1)/write(2)). Старите възли се
  връзват към личното пространство на собственика при boot (`tree/backfill.baga`).
  Изтриване на пространство маха цялото дърво — възли, версии, текст, blob-ове и
  одита (`tree/ws_cleanup.baga`).
- **ACL по възел**: `GET/POST/DELETE /v1/fs/acl` — изрични права за потребител/роля
  върху път, с наследяване към поддървото; най-специфичният ред печели
  (`tree/acl_roles.baga` — чист модул, тестван в `tests/acl_roles_test.baga`).
- **публични линкове**: `GET/POST/DELETE /v1/fs/share` (само owner/admin) + публично
  (без Bearer) `GET /s/{token}`, `POST /s/{token}/unlock` (парола → краткотраен JWT),
  `GET /s/{token}/view|download`, `PUT /s/{token}/upload`. Пази се само хешът на
  токена и на паролата (PBKDF2); срок, таван на свалянията, изтрит възел/пространство
  отнема линковете (`tree/share_roles.baga` — чист модул в `tests/share_roles_test.baga`).
- **activity feed**: `GET /v1/activity?limit=&path=&actor_id=` — append-only одит на
  пространството (кой какво е създал/променил/изтрил/споделил). Записва се от самите
  действия; `ts` е epoch секунди за PG/boila еднакво, `path` е денормализиран
  (`tree/activity_kinds.baga` — чист модул в `tests/activity_kinds_test.baga`).
- избор на пространство в UI (горна лента); при роля `viewer` действията за запис са скрити
- `POST /v1/auth/logout`, `GET /v1/me` (bearer)
- системни: `/health`, `/ready`, `/v1/meta`, `/openapi.json`, `/metrics`
- UI (Next): `/login`, `/` (файлове), `/search`, `/workspaces`, `/users`, `/edit`,
  `/share/<token>`; панели „Споделяне" (хора + линкове), „Версии" и „История" (activity)
- seed на админ при първо стартиране (`SECP_ADMIN_EMAIL` + `SECP_ADMIN_PASSWORD`)

## Структура

```
secp/
  start.baga            entrypoint: migrate → seed admin → ops_start → fmr_run
  routes.baga           route table + fmr_dispatch
  schema.baga           миграции (собственост на приложението)
  lib/pass.baga         PBKDF2-HMAC-SHA256 (gaps G1 → passbaga)
  lib/mail_welcome.baga welcome писмо при създаване на потребител
  idm/                  идентичности: users, workspaces, auth, поща
    user_model.baga     idm_users CRUD + authenticate
    ws_model.baga       idm_workspaces + членство (CRUD, достъп, JSON)
    ws_roles.baga       роли и нива (чист модул, тестван в tests/ws_roles_test.baga)
    ws_actions.baga     списък/създаване/преименуване/триене на пространства
    ws_members.baga     членове (само owner/админ; последният owner е защитен)
    auth_actions.baga   login / logout / me
    reset_model.baga    idm_resets: токени за смяна на парола
    reset_actions.baga  forgot / reset
    mail.baga           SMTP конфигурация от средата + изпращане
    mail_text.baga      текстовете на писмата (чист модул, без зависимости)
  tree/                 файлово дърво в пространство (Фаза 2 скоуп)
    auth.baga           резолвва workspace + ниво read(1)/write(2)
    model.baga          възли по workspace_id (owner_id е само одит)
    store.baga          mkdir -p / запис на файл
    versions.baga       версии; versions_files.baga — възстановяване и zip
    text.baga           текстов индекс; search.baga/search_actions.baga — търсене
    backfill.baga       boot: стари възли → личното пространство на собственика
    ws_cleanup.baga     триене на пространство маха дървото и blob-овете
    acl_roles.baga      права по възел: наследяване, най-специфичен печели (чист)
    acl_model.baga      tree_acl: CRUD + изчисляване на ефективно ниво
    acl_actions.baga    GET/POST/DELETE /v1/fs/acl
    share_roles.baga    линкове: поддърво, срок, таван, PBKDF2 парола (чист)
    share_model.baga    share_links: insert/find/revoke/GC
    share_actions.baga  owner API: GET/POST/DELETE /v1/fs/share
    share_open.baga     публичен API: /s/{token} (без Bearer)
    activity_kinds.baga  видове действия + тавани/странициране (чист)
    activity_model.baga  activity: append-only запис/списък/чистене
    activity_actions.baga GET /v1/activity (per workspace/path/actor)
    actions.baga docs.baga   API заяви (fs/* и doc/*)
  system/scheduler.baga фонови задачи (ops_jobs): extract-text, mail-send
  system/mail_jobs.baga mail-send: разчита payload и праща
  tools/mock_smtp.baga  dev SMTP сървър (пише писмата във файл)
  ui/                   SSR страници (tplbaga)
  sandak.toml
  gaps.md               езикови/пакетни дупки
```

Правила за границите на модулите (задължителни — виж
[README „Монолит → микросервизи"](../README.md)):

1. Таблица = точно един модул-собственик (`idm_users` се пипа само от `idm/`).
2. Междумодулни викания само през публични fn на модула, не през SQL към чужди таблици.
3. Събитията (от Фаза 3) минават през bus-абстракция, не през директни викания.

## Build & run

Изисква baga toolchain (`baga`, `sandak`) и Postgres (или boilaDB).

```bash
cd app-product/7x7office/secp
sandak build                       # → target/secp

cp .env.example .env               # попълни JWT_SECRET и PG*
export $(grep -v '^#' .env | xargs)  # или: set -a; . ./.env; set +a

./target/secp                      # migrate + seed + serve на :8080
```

Проверка:

```bash
curl localhost:8080/health
curl -X POST localhost:8080/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@secp.local","password":"admin123"}'
# браузър: http://localhost:8080/login
```

## Конфигурация

Виж [.env.example](.env.example). Ключови: `PORT`, `FMR_WORKERS`,
`JWT_SECRET`, `PG*` (или `ORM_BACKEND=boila` + `BOILA_*`),
`SECP_ADMIN_*`, `SECP_PASS_ITERS`, `SECP_SCHED_MS`.

Поща (Фаза 6.3) е **изключена без `SMTP_HOST`** — приложението работи
нормално. Когато е включена: `SMTP_PORT` (деф. 465/587/25 според
`SMTP_TLS`), `SMTP_TLS` (`starttls` | `tls` | `plain`), `SMTP_FROM`,
`SMTP_USER`, `SMTP_PASS`, `SECP_PUBLIC_URL` (за линковете в писмата),
`SECP_RESET_TTL_MIN` (деф. 60). `SMTP_INSECURE=1` приема самоподписан
сертификат — само за dev.

За тест без реален доставчик: `tools/mock_smtp.baga` (пише писмата във
файл). Виж [../README.md](../README.md), раздел „Поща".
