# secp

**Office платформа за споделяне на файлове (като Pydio Cells), написана на Baga.**
Част от [7x7office](../README.md) · План: [PLAN.md](../PLAN.md)

Модулен монолит по шаблона `apps/*` от [BASE.md](../../BASE.md):
`fmrbaga → httpdbaga · jwtbaga · ormbaga → pgbaga (Postgres) или boilaDB`.

## Статус: Фаза 2 — workspaces + роли (почти готова)

- миграции: `idm_users`, `idm_sessions`, `idm_resets`, `idm_workspaces`, `idm_workspace_members`, `tree_*`, `ops_jobs` (Postgres + boila двойни сетове)
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
  Изтриване на пространство маха цялото дърво — възли, версии, текст и blob-ове
  (`tree/ws_cleanup.baga`).
- избор на пространство в UI (горна лента); при роля `viewer` действията за запис са скрити
- `POST /v1/auth/logout`, `GET /v1/me` (bearer)
- системни: `/health`, `/ready`, `/v1/meta`, `/openapi.json`, `/metrics`
- UI (tplbaga, SSR): `GET /login`, `GET /`
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
