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

## Фаза 6 (търсене + scheduler)

| # | Дупка | Заобикаляне | Правилно решение |
|---|-------|-------------|------------------|
| G11 | няма преносим full-text: PG има `to_tsvector`, boilaDB — не | `ILIKE ... ESCAPE '\'` по име и по извлечен текст; работи и на двете среди | **searchbaga** (индекс върху rocksbaga) или PG GIN + `pg_trgm`; решението е в `tree/search.baga` и се сменя на едно място |
| G12 | `go_bg` worker-ите не могат да ползват DB връзката на главната нишка (връзките не са thread-safe) | scheduler-ът отваря собствена връзка на всеки tick; queuebaga изобщо не пази в DB | `ormbaga` пул с per-thread връзки (има `pool/`, но `fmr_open_db` не го ползва) |
| G13 | няма lease/visibility timeout в `ops_jobs` — убит процес оставя `running` завинаги | при старт `UPDATE ... SET status='pending' WHERE status='running'` | lease с `locked_until` + периодично освобождаване (моделът на Cells `scheduler`) |
| G14 | `orm_update_by_id` винаги бие по колона `id` — таблица с друг PK (напр. `tree_text.node_id`) не се обновява | изричен `UPDATE ... WHERE node_id = $2` в `tree/text.baga` | `orm_update_by_pk(db, table, pk_col, id, ...)` в ormbaga |
| G15 | „индексиран, но без текст" и „още не е индексиран" изглеждат еднакво (липсващ ред) → reindex нарежда файловете вечно | пишем ред и при празен текст (виж G14 — формата на записа е един и същ) | колона `status` в `tree_text` или `indexed_at` в `tree_nodes` |
| G16 | `concat` е строго 2-аргументен — `concat(a, b, c)` не се компилира | влагане: `concat(a, concat(b, c))`; за дълги съобщения — междинна `let` | вариадичен `concat` в std (или `str_builder`); дребно, но се набива на очи при логове |

## Фаза 6.3 (smtpbaga)

| # | Дупка | Заобикаляне | Правилно решение |
|---|-------|-------------|------------------|
| G17 | `str_split` дели само по първия символ на разделителя (`char_at(delim, 0)`) — `str_split(s, "\r\n")` оставя `\n` във всеки ред | делим на `"\n"` и махаме завършващ `\r` (`smtp_strip_cr` в `smtpbaga/src/message.baga`) | `str_split` да търси целия низ-разделител |
| G18 | `tls_conn_read_app` чете, докато връзката се затвори (писана за HTTP) — при SMTP блокира, защото сървърът чака следващата команда | собствен буфер в `smtpbaga/src/transport.baga`: един `tls_read_record` + изяждане на байт по байт | `tls_conn_read` с режим „един запис“ за line-протоколи |
| G19 | `std/bytes` работи с `Vec<i64>`, а builtin-ите (`base64_encode`, `tls_conn_write`) — с `bytes`; типовете не се смесват имплицитно | мост с `vec_from_bytes`/`bytes_of_str` на границата | `base64_encode` да приема и `bytes`, или `bytes` да е `Vec<i64>` изцяло |
| G20 | няма `gethostname()` в `std/os` — SMTP EHLO име не може да се вземе от средата | `cfg.helo` или `"localhost"` (mock сървърите го приемат) | `os_hostname()` в std; ползва се и от логовете |
| G21 | писмото не бива да съсипва заявката, която го предизвиква (създаване на потребител, forgot) — но и не може да се чака синхронно | нареждане в `ops_jobs` (`mail-send`) и `mail_try`/`mw_enqueue` гълтат грешката с `eprintln`; при `SMTP_HOST` липса пощата е изключена и приложението работи | outbox модел с ретрай политика и метрика „непратени писма" (reportbaga) |
| G22 | `idm_*` не бива да тегли `httpdbaga` само за `to_lower` (цикличност и тегло) | локален `mail_lower` в `idm/mail.baga` | `str_lower` в `std/str` (както `str_trim`) |
| G23 | TTL на reset токена се смята с `NOW() + INTERVAL` — работи в PG, но boilaDB няма `INTERVAL` | пощата/reset-ът се ползват при PG backend; за boila е нужно преизчисление в приложението | подаване на абсолютен `expires_at` от приложението (ISO низ) вместо `INTERVAL` |
| G24 | `chr(c)` за байт >127 дава невалиден символ, а `concat` спира на първия NUL — влагането на `chr()` в `concat` чупи всяка многоредова (UTF-8) буква | работя на ниво байтове: `Vec<i64>` → `bytes_from_vec` → `str_of_bytes` (виж `mail_lower` в `idm/mail.baga`) | `str_map_bytes`/`str_lower` в std; днес `httpdbaga.to_lower` има същия дефект |

## Фаза 2 (workspaces + роли)

| # | Дупка | Заобикаляне | Правилно решение |
|---|-------|-------------|------------------|
| G25 | `char_at` връща байт (int), не едносимволен низ — сравнение с `"a"`/`"z"` не се компилира | сравняваме с числа (97/122) и връщаме символ с `chr(c)`; за ASCII е коректно, но е нечетимо | `str_char_at(s, i) -> str` в std или `str_is_ascii_*` помощни; днес `csvbaga` също работи с байтове |
| G26 | `idm_workspace_members` не може да има `UNIQUE(workspace_id, user_id)` — boilaDB няма такъв constraint | проверката „вече член ли е" е в кода (`ws_member_row`); повторно добавяне сменя ролята вместо да прави втори ред | `UNIQUE` в схемата (PG може днес, двоен сет вече съществува); при boila — уникален индекс, ако/MSERT поддържа |
| G27 | `jdobj_str`/`jobj_str` **добавят** ключ, не заменят — подаване на `ws_to_json` (който вече слага `role`) към `jobj_str(o, "role", ...)` дава дублиран ключ и невалиден JSON за клиента | изнесен `ws_json_base` без `role`; ролята се слага точно веднъж (`ws_to_json` или `ws_to_json_role`) | `jobj_set_str` (замяна) в `fmrbaga/jsonx.baga` — сега всеки такъв случай се хваща чак в браузъра |
| G28 | boilaDB дава id с `MAX(id)+1`, значи изтрит workspace може да „преизползва" id | не разчитаме на id-то като дълготраен ключ навън (slug-ът е този, който влиза в URL-и); членствата се трият ръчно | `SERIAL`/`IDENTITY` и в boila, или отделен брояч, който не се връща назад |
| G29 | `orm_where_eq_str`/`orm_count_sql` нямат параметризиран вариант за две+ условия с `count` | `ws_owner_count` сглобява `orm_query_params_str` + `COUNT(*) AS count` и чете клетката (`orm_count_sql_params` липсва) | `orm_count_params(db, sql, vals)` в ormbaga |
| G30 | няма `str_is_digits` в std — валидирането на `?workspace_id=` стана с ръчен цикъл по байтове | локален цикъл в `ws_qid` | `str_is_digits(s) -> i64` в `std/str` |

## Фаза 2 (files → workspace скоуп)

| # | Дупка | Заобикаляне | Правилно решение |
|---|-------|-------------|------------------|
| G31 | няма `UPDATE ... FROM`/`UPDATE ... SELECT` (PG) съответствие в boilaDB, затова backfill на `workspace_id` не може да е една заявка по `owner_id` | boot backfill минава ред по ред в приложението (`tree/backfill.baga`): вдига личното пространство на собственика, после `UPDATE ... WHERE id = $n` | масова миграция в диалект-независим вид (или поддръжка на `UPDATE ... FROM` в boila) |
| G32 | `DELETE` по условие, което зависи от JOIN („всички версии на възлите в това пространство"), не е налично преносимо | `tree_ws_purge` първо събира id-тата/хешовете с `SELECT`, после трие по списък (`tree/ws_cleanup.baga`) | `DELETE ... USING`/подзаявка в boila, или каскадно триене по FK |
| G33 | няма начин да се разбере дали даден ред е „стар" (преди миграция), освен по `workspace_id = 0` — а 0 е валиден „няма" само защото няма такова id | backfill проверява `IS NULL OR = 0` (`tree_backfill_left`) | изрична колона `backfilled_at` или миграционен маркер в служебна таблица |

## Фаза 2 (ACL по възли)

| # | Дупка | Заобикаляне | Правилно решение |
|---|-------|-------------|------------------|
| G34 | `WHERE (kind='user' AND subject_user_id=$1) OR (kind='role' AND subject_role=$2)` е OR по колони, който boilaDB не оптимизира и трудно верифицира; освен това субектът е полиморфен (user ИЛИ role), значи не е един FK | четат се всички редове на пространството и субектът се филтрира в кода (`tree_acl_subject_rows` + `acl_subject_matches`) | два отделни реда/таблици (user_acl, role_acl) или `subject_kind`+`subject_ref` с индекс; засега редовете на пространство са десетки |
| G35 | няма `UPDATE ... FROM` в boila (G31), затова преместването на ACL редове заедно с поддървото е ред по ред | `tree_acl_move_subtree` чете редовете и обновява `path` по id един по един (`tree/acl_model.baga`) | масов `UPDATE` с израз за префикс (или `path` като материализиран път с ltree) |
| G36 | „най-специфичният печели" изисква да се сравни дълбочината на пътя; няма `str_count`/split по байт в std, затова дълбочината се брои с ръчен цикъл по `/` | `acl_depth` брои сегментите с `char_at == 47` (`tree/acl_roles.baga`) | `path_depth(p)` в `pathbaga` — пътищата се ползват и за WebDAV (Фаза 4) |
| G37 | ACL проверката дърпа редовете на цялото пространство при ВСЯКА заявка (списък, stat, get) — O(редове) на файлова операция | засега приемливо (лични/малки екипни пространства); редовете са десетки | кеш на ефективното ниво в `FmrCtx` (или кеш по `(ws, uid, path)`) с инвалидиране при запис на ACL — това е „кешът" от плана |
| G38 | `tree_auth` има 7 полета и се конструира на 4 места с пълния набор — добавянето на поле чупи всеки `TreeAuth { ... }` | приема се засега (AddField compile error е безопасен: държи местата синхронни) | `TreeAuth` с `Default`/builder или по-малко полета (ролята може да се извлече от нивото) |
| G39 | всеки списък/stat прави отделна заявка за ACL редовете на цялото пространство, а `acl_effective` обхожда всички редове за всеки път — при 50 деца × 50 реда това са 2500 сравнения на заявка | приема се (малки пространства); проверката е в паметта, без нови заявки | същият кеш като G37 + предварително сортиране на редовете по дълбочина, за да се спре на първия приложим |
| G40 | `jobj_*` само добавя ключ (G27), затова „име на субекта" се сглобява с два варианта на `tree_acl_to_json` (`_named`) и всеки новоизчислен ключ трябва да се пази ръчно синхронен | `tree_acl_to_json_named` вика базовия вариант и добавя полетата | `jobj_set_*` в `fmrbaga/jsonx.baga`, после един builder с опционални полета |

## Фаза 3 (публични линкове)

| # | Дупка | Заобикаляне | Правилно решение |
|---|-------|-------------|------------------|
| G41 | публичните маршрути `/s/*` не минават през Bearer, но `FmrCtx` пак изисква `jwt_secret` за `pass_token`-а; маршрут без `public=1` би върнал 401 преди тялото | `fmr_route_meta(..., public=1)` за петте `/s/*` маршрута (`routes.baga`) | `public` в метаданните на маршрута, не в името на пътя; днес се помни на ръка при нов публичен маршрут |
| G42 | `downloads`/`max_downloads` и `expires_at` се пазят в epoch секунди (BIGINT), не `TIMESTAMPTZ` — конверсията е в клиента | `share_to_json`/`act_share_meta` връщат epoch; UI-ът прави `new Date(s * 1000)` | `TIMESTAMPTZ` в PG + ISO низ в JSON, когато boilaDB получи `NOW()` в заявка (G23) |
| G43 | таванът на свалянията се брои при download, но `view` на файл (съдържание в JSON) не се брои — линк с таван 1 може да се чете неограничено през API-то | приема се (таванът пази обема, не знанието); UI-ът сваля, не чете суровия JSON | броене и на `view` за файл или `max_views` отделно от `max_downloads` |
| G44 | `share_move_subtree` обновява пътищата ред по ред (няма `UPDATE ... FROM`, G31/G35) — голямо поддърво с много линкове прави N заявки | приема се (линковете рядко са стотици) | масов `UPDATE` с префикс, когато boilaDB го поддържа |
| G45 | `pass_token` е JWT със срок 24 ч (или до изтичане на линка) и се носи като `?pass=` — при споделяне на адреса след unlock той дава достъп без парола | приема се засега: токенът е краткотраен, но не е обвързан със сесия/устройство | `pass_token` в `HttpOnly` cookie или в `Authorization` хедър на клиента, с по-кратък TTL |
| G46 | няма ratelimit на `POST /s/{token}/unlock` — парола с 6 знака се подбира с неограничени опити | минимум 6 знака + PBKDF2 (бавно хеширане) е единствената защита | брояч на опитите per линк (в `share_links` или памет) с закъснение/заключване; при `logbaga` — лог на опитите |
