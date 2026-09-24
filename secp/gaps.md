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
| G5 | fmrbaga маршрутите нямат wildcard — няма `PUT /fs/*path` | пътят е `?path=` (percent-encoded от Next) | wildcard или catch-all във fmrbaga; WebDAV идва с davbaga |
| G6 | `write_file_bytes` връща `-1` без да вдигне `!IO`, така че `?` не вижда грешката; `mkdir` с водеща `/` върху относителен път пишеше в `/storage` | `data_mkdir_p` пази относителността и put проверява кода | `write_file_bytes` да вдига `!IO` при грешка |

## Фаза 5.5 (фронтенд: i18n + теми)

| # | Дупка | Заобикаляне | Правилно решение |
|---|-------|-------------|------------------|
| G7 | няма i18n библиотека в Next 16 без React Server Components routing (`app/[lang]`) | собствен `I18nProvider` с TS речници и localStorage — 0 зависимости | ако преводите пораснат: Crowdin върху JSON (моделът на Cells), речниците вече са изолирани в `lib/i18n-*.ts` |
| G8 | Next няма „тема без блясък" — `ThemeProvider` се монтира след първия paint | inline `<script>` в `<head>`, който слага `data-theme` от localStorage преди рисуване | Next `beforeInteractive` script или server-side cookie за темата |
| G9 | `no-img-element` lint warning за blob URL thumbnails | оставяме `<img>` (Next `<Image>` не работи с `blob:`) | `unoptimized` image wrapper или собствен thumbnail endpoint |
| G10 | `spellCheck` върху `contentEditable` не наследява надеждно `<html lang>` в Chrome | слагаме и `lang` на самия editor елемент | — (това е коректният начин) |
