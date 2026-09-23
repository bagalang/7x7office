# gaps.md — secp

Езикови/пакетни дупки, намерени по време на фазите. Форматът следва
конвенцията на останалите пакети (`app-product/*/gaps.md`).

## Фаза 0

| # | Дупка | Заобикаляне | Правилно решение |
|---|-------|-------------|------------------|
| G1 | `std/crypto` няма bcrypt/argon2 за пароли | `lib/pass.baga`: PBKDF2-HMAC-SHA256 върху `hmac_sha256_b` (итерации: `SECP_PASS_ITERS`, default 10000) | универсален пакет **passbaga** (PBKDF2 + по-късно argon2id), ползван от всички приложения |
| G2 | fmrbaga няма cookie helper-и (четене/писане) | ръчен `Set-Cookie` header + parse на `Cookie` в `ui/actions.baga` | `fmr_cookie_get(ctx, name)` / `fmr_set_cookie(resp, ...)` във fmrbaga |
| G3 | fmrbaga `act_require_auth` чете само `Authorization: Bearer` | UI ползва собствена cookie→JWT проверка (`ui_cookie_user`) | опционален cookie auth source в deps ( bearer \| cookie ) |
| G4 | `idm_sessions` съществува като таблица, но JWT е stateless — няма revocation | logout само чисти cookie-то | Фаза 2: token version / session record проверка в `fmr_before` |
