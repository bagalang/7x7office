# Пускане

Локалният стек е в `deploy/docker-compose.yml`. Слуша на машината (`network_mode: host`). Портовете са отделни от bagabuch.

| Услуга | Адрес |
|---|---|
| Интерфейс | http://127.0.0.1:3010 |
| API | http://127.0.0.1:8085 |
| WebSocket | 8086 |
| boilaDB | 6585 |
| Collabora | http://127.0.0.1:9980 |
| Redis | 127.0.0.1:6385 |

Вход след първото пускане: `admin@secp.local` / `admin123`.

Redis е само в паметта (без RDB и AOF) и слуша на `127.0.0.1`. secp още не го вика. Заключването на офис файл остава в `wopi_locks` в boilaDB.

Събиране на `secp` и вдигане на контейнерите от корена на монорепото:

```bash
cd app-product/7x7office/secp
PATH="$PWD/../../../:$PATH" ../../../sandak build
cp target/secp ../deploy/secp-bin
docker compose -f ../deploy/docker-compose.yml up --build -d
```

`sandak.toml` има `rc = true`: бинарникът се събира с refcount памет. `BAGA_ALLOC_STATS` не стои в compose. Стойност `1` брои всяка алокация с backtrace и забавя процеса. Слага се само за дебъг сесия и после се маха.

Готовност: `GET http://127.0.0.1:8085/health` и `GET http://127.0.0.1:8085/ready`. Вторият проверява базата.

Интерфейсът говори само с Next. `/v1`, `/health` и `/ready` се препращат към API-то. WebSocket не минава през това препращане и ползва порт 8086.
