# secp

**Office платформа за споделяне на файлове (като Pydio Cells), написана на Baga.**
Част от [7x7office](../README.md) · План: [PLAN.md](../PLAN.md)

Модулен монолит по шаблона `apps/*` от [BASE.md](../../BASE.md):
`fmrbaga → httpdbaga · jwtbaga · ormbaga → pgbaga (Postgres) или boilaDB`.

## Статус: Фаза 0 — скелет

- миграции: `idm_users`, `idm_sessions` (Postgres + boila двойни сетове)
- вход: `POST /v1/auth/login` (JSON **или** форма) → JWT + HttpOnly cookie
- `POST /v1/auth/logout`, `GET /v1/me` (bearer)
- системни: `/health`, `/ready`, `/v1/meta`, `/openapi.json`, `/metrics`
- UI (tplbaga, SSR): `GET /login`, `GET /`
- seed на админ при първо стартиране (`SECP_ADMIN_EMAIL` + `SECP_ADMIN_PASSWORD`)

## Структура

```
secp/
  start.baga            entrypoint: migrate → seed admin → fmr_run
  routes.baga           route table + fmr_dispatch
  schema.baga           миграции (собственост на приложението)
  lib/pass.baga         PBKDF2-HMAC-SHA256 (gaps G1 → passbaga)
  idm/                  идентичности: users, auth
    user_model.baga     idm_users CRUD + authenticate
    auth_actions.baga   login / logout / me
  system/actions.baga   health/ready/meta/openapi/metrics
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
`SECP_ADMIN_*`, `SECP_PASS_ITERS`.
