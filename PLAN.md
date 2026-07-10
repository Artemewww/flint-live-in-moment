# FLINT «Живи в моменте» — План доработки до финала

> Рабочий технический документ. Привязан к реальным файлам и полям БД.
> Статусы: ⬜ не начато · 🟨 в работе · ✅ готово.

---

## Состояние инфраструктуры

- ✅ **Миграция `supabase/migrations/2026-final.sql` применена** (проект `flint-live`,
  ref `lnaouwhywnppwnhijots`, 10.07.2026). Скрипт идемпотентный — можно перезапускать.
- ✅ Проверяется зондом: `GET /api/events?action=health` с `Authorization: Bearer <ADMIN_TOKEN>`
  → `{"migrationApplied": true, "checks": {...}}`. Тыкает каждую таблицу, колонку и RPC.
  **Запускать после любой правки схемы** — именно он вскрыл отсутствие `rides.seats_taken`.
- ⬜ **Задать `CRON_SECRET`** в Vercel Env — крон напоминаний (`api/cron/reminders.ts`)
  пока защищён только `ADMIN_TOKEN`.
- ⚠️ Функций сейчас **11 из 12**. Тринадцатая уронит деплой молча, а прод продолжит
  отдавать старую сборку (см. §9).

---

## 0. Архитектурные решения (приняты)

### 0.1. Один бот — serverless webhook. Папка `bot/` замораживается.

**Решение:** вся бот-логика живёт в `api/telegram/webhook.ts` (Vercel, `@campsflint_bot`).
Папка `bot/` (grammy, polling) — **замораживается как референс** (из неё заберём готовые
тексты/логику `approval.js`, `profile.js`), в прод не идёт.

**Почему выгоднее:**
- Один деплой (Vercel), один `env`, один источник правды. Нет отдельного always-on
  процесса на Contabo, который надо держать, платить, мониторить и рестартить.
- Serverless-вебхук уже в проде и работает (регистрация + опрос rt/rs/rf/rg).
- Сайт + API + бот — одна кодовая база, общие типы и хелперы.
- `bot/` не дописан (авторизация и состояния — сплошь `// TODO`), догонять его дороже,
  чем перенести 2–3 готовых куска в webhook.

**Цена решения:** serverless без памяти между запросами. Решаем гибридно (см. 0.2).

### 0.2. Состояние диалога бота — гибрид

- Простые линейные шаги (как сейчас опрос) — **stateless**, шаг закодирован в `callback_data`.
- Многошаговые сценарии с вводом текста (шлюз/онбординг, ввод чека, «написать
  организатору») — новая таблица **`bot_sessions`**: `telegram_id BIGINT PK,
  state TEXT, context JSONB, updated_at`. Хендлер `message:text` смотрит текущий `state`.

### 0.3. Хранилище картинок — Supabase Storage

Публичный бакет `event-images`. Загрузка через `api/admin/upload.ts` (принимает файл/base64
от админки, кладёт в бакет service-role-ключом, возвращает public URL). В `events.image`
хранится URL. Старые пути `/assets/images/*` продолжают работать.

---

## 1. Модель данных — единая миграция  ✅ файл создан

Файл **`supabase/migrations/2026-final.sql`** — выполнить в Supabase SQL Editor.
Всё идемпотентно (`if not exists`), безопасно повторять. Ниже — краткое содержание;
единственный источник правды — сам файл.

Помимо колонок из списка ниже он создаёт: `program_votes`, `interests`, `feedback`,
`tasks`, `polls`/`poll_votes`, а также RPC `award_points`, `book_ride_seat`
(атомарная бронь места) и `cancel_ride_seat`.

```sql
-- события: конец диапазона, платность, теги-качества, реквизиты, окно заезда
alter table events add column if not exists date_end text;
alter table events add column if not exists house_qualities jsonb default '[]';   -- ключи активных качеств
alter table events add column if not exists arrival_time text;                    -- реальное время старта
alter table events add column if not exists status_reason text;                   -- «под вопросом»: причина
alter table events add column if not exists decision_deadline text;               -- дедлайн решения
alter table events add column if not exists payment_details jsonb default '{}';   -- ЕРИП/карта/способ
alter table events add column if not exists rent_amount integer default 0;        -- аренда поляны (делится)
alter table events add column if not exists day_price integer default 0;          -- сбор за день
alter table events add column if not exists logistics jsonb default '{}';         -- собранный блок логистики
-- price_type ужимаем до free|paid (миграцию conscience->free делает код, см. фаза 1)

-- участники: закрытый клуб, рефералы, баллы, роли
alter table members add column if not exists status text default 'pending';       -- pending|approved|blocked
alter table members add column if not exists is_core boolean default false;       -- костяк/помощник
alter table members add column if not exists role text default 'member';          -- owner|admin|member
alter table members add column if not exists ref_code text;                       -- своя рефссылка
alter table members add column if not exists referred_by bigint;                  -- кто пригласил
alter table members add column if not exists points integer default 0;            -- баллы (за достижения)
alter table members add column if not exists agreed_pd boolean default false;     -- согласие на обработку ПД
alter table members add column if not exists approved_by bigint;
create unique index if not exists uniq_members_ref_code on members(ref_code);

-- регистрации: даты участия, оплата-модерация, дети, отказ от еды, контакт
alter table registrations add column if not exists days jsonb default '[]';       -- конкретные даты участия
alter table registrations add column if not exists guests jsonb default '[]';     -- гости/дети: [{name,type,dietary}]
alter table registrations add column if not exists children_count integer default 0;
alter table registrations add column if not exists food_optout boolean default false; -- «привезу своё»
alter table registrations add column if not exists payment_proof text;            -- чек/скрин
alter table registrations add column if not exists payment_submitted_at timestamptz;
alter table registrations add column if not exists contact_revealed boolean default false;
create unique index if not exists uniq_reg_event_member on registrations(event_id, telegram_id);

-- сессии диалога бота
create table if not exists bot_sessions (
  telegram_id bigint primary key,
  state text,
  context jsonb default '{}',
  updated_at timestamptz default now()
);

-- рефералы: аудит переходов и наград
create table if not exists referrals (
  id bigserial primary key,
  ref_code text,
  inviter_id bigint,
  invited_id bigint,
  event_id text,
  created_at timestamptz default now(),
  rewarded boolean default false
);

-- задачи/поручения (доска задач)
create table if not exists tasks (
  id bigserial primary key,
  event_id text references events(id) on delete cascade,
  title text, taken_by bigint, done boolean default false,
  created_by bigint, created_at timestamptz default now()
);

-- общий механизм опросов/голосований
create table if not exists polls (
  id bigserial primary key,
  event_id text, question text, options jsonb default '[]',
  deadline text, created_by bigint, created_at timestamptz default now()
);
create table if not exists poll_votes (
  poll_id bigint references polls(id) on delete cascade,
  telegram_id bigint, choice int, primary key(poll_id, telegram_id)
);

-- костяк-владелец
insert into members (telegram_id, username, first_name, is_core, status, role)
values (377551019,'Demarts','ARTDEMENTIEV.BY',true,'approved','owner')
on conflict (telegram_id) do update set is_core=true, status='approved', role='owner';
```

RPC-функции (добавить): `award_points(tg bigint, n int)`, `redeem_ref(code text, invited bigint)`.

---

## 2. Фаза 0 — Фундамент  ✅ (0.3 гейтинг + 0.4 .ics; миграция/бакет — на юзере)

Низкий риск, разблокирует остальное.

| # | Задача | Файлы |
|---|--------|-------|
| 0.1 | Выполнить миграцию из §1 | Supabase SQL Editor |
| 0.2 | Создать бакет `event-images` (public) | Supabase Storage |
| 0.3 | Доделать гейтинг локации (незакоммичено): обогатить locked-ветку общим районом, загейтить `locationDetails` на `isRegistered`, убрать неиспользуемую `authorized` | `src/components/EventDetailModal.tsx` |
| 0.4 | Кнопка «В календарь (.ics)» в карточке (data-URI из `date`+`arrivalTime`) | `EventDetailModal.tsx` |
| 0.5 | `npx tsc --noEmit && npm run build`, commit, push | — |

**Приёмка:** незарегистрированный видит только район + замок; зарегистрированный — карту и
детали; .ics скачивается и открывается в календаре.

---

## 3. Фаза 1 — Карточка события + Админка  ✅ (в проде)

Чистый фронт+API, максимум видимой пользы. Твой список п.1–2.

### 3.1. Загрузка картинок файлом (не ссылкой)
- `api/admin/upload.ts` — POST base64 → Supabase Storage → public URL.
- В `AdminPanel.tsx` (~стр. 1221) заменить `<input value={formData.image}>` на:
  дропзону/`<input type=file>` + превью + кнопка «Удалить». Загрузка с любого устройства.

### 3.2. Убрать «на совесть»
- Оставить только `free | paid`. В коде `conscience` → трактуем как `free`.
- Точки правки: `src/types.ts:45,189,196` · `EventDetailModal.tsx:22` ·
  `AdminPanel.tsx:225,1048,1281,1393` · `api/events.ts:93` · `api/admin/events.ts:107` ·
  `App.tsx:42`. `calculateDynamicPrice` упростить до двух веток.
- Селект в админке: только «Бесплатно» / «Платно (делится на всех)». Поле `rent_amount`.

### 3.3. 6 качеств манифеста — активные теги
- Источник качеств уже есть: `foundation/wall/roof/decor/heat/life`
  (Предназначение/Воля/Совесть/Творчество/Любовь/Счастье) — см. `VerificationModal.tsx`.
- Вынести в `src/houseQualities.ts` (единый список ключ→{name,part,emoji,description}).
- В форме создания (`AdminPanel.tsx`) — 6 кликабельных чипов; выбранные пишутся в
  `events.house_qualities` (массив ключей).
- В карточке (`EventDetailModal.tsx`) — активные качества «горят» (акцент+emoji),
  остальные не показываем. Заменяет нынешний серый текст.

### 3.4. Переделать блок «Машины / Как добраться»
- Убрать текстовое поле-простыню. Структурировать: точка сбора, время выезда, места,
  взнос на бензин — как поля. Хранить в `events.logistics` (jsonb). Полноценные брони
  машин/палаток — Фаза 4 (в боте), здесь только описательная часть карточки.

### 3.5. Автогенерация Программы и Порога входа кнопками
- Генератор уже есть частично (`src/eventGuide.ts` → `getEventGuide`). Расширить:
  по типу события + датам собирать черновик программы (массив пунктов) и порога входа.
- В админке: кнопка «⚡ Сгенерировать» → список пунктов, каждый: редактировать / удалить /
  ↑↓ / «＋ добавить пункт» / «🔄 перегенерировать». Результат в `events.program` (jsonb).
- Порог входа — аналогично, чипы-условия вместо строки `entry_threshold`.

**Приёмка:** создать событие целиком мышкой без ручного ввода URL картинки и без «совести»;
качества «горят»; программа сгенерирована и правится.

---

## 4. Фаза 2 — Закрытый клуб + рефералы + профиль  ✅ (шлюз за флагами, см. §10)

Ядро ценности. Требует Фазы 0. Твой список п.3, п.5.

### 4.1. Шлюз (сайт)
- Новый экран `src/components/GateScreen.tsx`: стильная страница «вход только по
  реф-ссылке». Без валидного `?ref=CODE` — доступа к афише нет.
- Логика в `App.tsx`: читать `ref` из URL/Telegram `start_param`; `api/gate.ts`
  проверяет `members.ref_code`; при успехе — «двери открываются», запись `referred_by`.

### 4.2. Бот: незнакомец не видит событий
- В `webhook.ts` `/start`: если `members.status != 'approved'` и нет валидного
  `start_param` реф-кода → показать экран верификации (согласие ПД → заявка костяку),
  НЕ показывать список событий.
- `/start ref_<code>` → привязать `referred_by`, отправить на онбординг.
- Одобрение: костяку кнопки «✅ Принять / ❌ Отклонить» (логика из `bot/handlers/approval.js`).

### 4.3. Профиль с реф-ссылкой
- Убрать поле «Никнейм» (не работает) — точки: `RegistrationModal.tsx`, `VerificationModal`.
- Профиль (Mini App + бот `/profile`): показать личную реф-ссылку
  `t.me/campsflint_bot?start=ref_<code>` + кнопка «Копировать» + «Сгенерировать новую»
  (`api/profile/refcode.ts`, ротация `ref_code`).
- Счётчик приглашённых из таблицы `referrals`.

**Приёмка:** новый юзер без ссылки упирается в шлюз; по ссылке проходит онбординг с
согласием ПД; в профиле есть работающая реф-ссылка.

---

## 5. Фаза 3 — Оплата + модерация + баллы  ✅ (кроме cron-напоминаний)

Твой список п.4, п.5 (баллы), финансы.

### 5.1. Трекинг оплаты (бот)
- Кнопка «💳 Оплатить» в статусе, пока `payment_status != 'paid'`.
- Юзер жмёт «✅ Я оплатил» → `payment_status='submitted'`, `payment_submitted_at=now`.

### 5.2. Модерация оплаты
- Организатору уведомление + «✅ Подтвердить / ❌ Отклонить».
- Подтвердил → `paid`. Отклонил → снова `pending`, у юзера опять горит «Оплатить».
- Реквизиты (`events.payment_details`: ЕРИП/карта/способ) — редактируются в админке.

### 5.3. Баллы только за достижения
- **Убрать** начисление за факт регистрации (найти и удалить).
- Начисление: прошёл мероприятие → админ подтвердил присутствие → `award_points`.
- Награды за рефералов: приглашённый прошёл первое событие → баллы рефереру (`referrals.rewarded`).
- Ответственность реферера: пометка в заявке приглашённого «пригласил @X».

### 5.4. Напоминания об оплате
- Cron (Vercel Cron → `api/cron/reminders.ts`) шлёт неоплатившим напоминание.

**Приёмка:** цикл оплатил→модерация→подтвердил/отклонил работает end-to-end; баллы
капают только после подтверждённого участия.

---

## 6. Фаза 4 — Регистрация 2.0 + логистика  ✅

Самая объёмная. Твои разделы «Регистрация» и «Логистика».

### 6.1. Регистрация 2.0 (бот + Mini App)
- **Шаг 0: согласие на обработку ПД (РБ)** — обязательный первый экран.
- Выбор **конкретных дат** участия (не число) → `registrations.days`.
- Категория М/Ж + ограничение аудитории (`entry_type`), для семейных — дети.
- Питание + **список продуктов по категориям на выбор** + **«привезу своё»** (`food_optout`).
- **+гости и дети** с индивидуальным питанием → `registrations.guests` (jsonb).
- Чек-лист снаряжения (мультивыбор + свой текст) → `equipment`.
- Роли «чем буду полезен» → `roles`.
- «Откуда узнал», «один/с компанией» — кнопки.
- Контакт раскрывается только при подтверждённой брони (`contact_revealed`).
- Отмена с учётом оплаты; принудительное удаление админом (уже есть частично).

### 6.2. Логистика (бот)
- Места в машине/палатке — кнопками, живой счётчик.
- Водитель: дата/время/точка выезда + взнос на бензин — видно попутчикам.
- Обратная дорога, SOS «нужна помощь с транспортом» + «🚗 Могу подвезти».
- Изменить/отменить бронь с уведомлением затронутых.
- Гейтинг логистики для незарегистрированных.
- Разделить кнопки «🚗 Логистика и бронь» и «📋 Организация» (снаряжение/задачи/опросы).

**Приёмка:** полная регистрация с согласием ПД, датами, гостями-детьми и отказом от еды;
брони машин/палаток кнопками с уведомлениями.

---

## 7. Фаза 5 — Программа / питание / погода  🟨

Готово:
- ✅ Голосование за программу **сохраняется** (`program_votes`), результаты видны в админке
  (вкладка «Обзор» → «Голоса за программу»). Раньше `api/vote.ts` был заглушкой с `console.log`.
- ✅ Автосписок закупки (ИИ, Gemini) с учётом веганов/вегетарианцев/детей —
  вкладка «Логистика» → «Список закупки».
- ✅ Распределение готовки/ролей — «Логистика» → «Кто на ролях» (из чек-листа бота).
- ✅ Общее снаряжение — «Логистика» → «Общее снаряжение».
- ✅ Погода (Open-Meteo, без ключа).
- ✅ Экспорт .ics.
- ✅ Напоминания за 7/3/1 день + напоминание об оплате — `api/cron/reminders.ts` (Vercel Cron, 09:00).

Осталось:
- ⬜ Общий механизм `polls`/`poll_votes` с дедлайном и таймером (таблицы созданы, UI нет).
- ⬜ Пост-сверка чеков: загрузил чек+сумму → делёж по головам → каждому доля с «Оплатил».
- ⬜ Меню-голосование, закупщик авто-выбором, SOS «мне плохо».
- ⬜ Игра «Искренность», спонтанные активности.

## 8. Фаза 6 — Роли / статистика / прочее  🟨

Готово:
- ✅ Заместитель на событие (`events.deputy_id`) — назначается в админке, может
  подтверждать оплату в боте наравне с костяком.
- ✅ Перенос дат («Настройки» → «Перенести даты») с уведомлением участников.
- ✅ «Мероприятие под вопросом» (`status_reason` + `decision_deadline`) — видно и в
  админке, и участнику в карточке события.
- ✅ Обратная связь 1–5 + коммент: бот просит на следующий день после события
  (`fb_*` колбэки), сайт пишет через `/api/events?action=feedback`, админ видит
  на вкладке «Участники» → «Отзывы» со средней оценкой.
- ✅ Явка (`registrations.attended`) — баллы капают только за неё, не за регистрацию.
- ✅ Закрытые события по кодовому слову (`is_public` + `access_code`) — поля и админка.
- ✅ Жизненный цикл события: Стартовать / Приостановить / Завершить / Отменить.
- ✅ Важное объявление всем + рассылка координат.
- ✅ Чек-лист готовности события (`events.checklist`) с сохранением.
- ✅ Спрос «Мне интересно» (`interests`) — считается и показывается админу.

Осталось:
- ⬜ Гейтинг закрытого события по `access_code` на входе (поля есть, проверка не встроена).
- ⬜ Глобальные помощники админа (`members.role='admin'`).
- ⬜ «✅ Понял(а)» на рассылках, «💡 Идея для бота», «Написать организатору», FAQ/возражения.
- ⬜ Сводная статистика по всем событиям (сейчас — только по одному).

---

## 10. Флаги закрытого клуба (Фаза 2)

Шлюз выключен по умолчанию — прод работает как раньше. Чтобы включить:
- **Сайт:** Vercel env `VITE_GATE_ENABLED=1` → Redeploy. Без валидной реф-ссылки/кода
  посетитель видит экран-шлюз.
- **Бот:** Vercel env `GATE_ENABLED=1`. Незнакомец по /start проходит согласие ПД +
  заявку костяку (кнопки «Принять/Отклонить» приходят в группу; решать может только
  участник с `is_core=true`).
- **Реф-ссылки:** `https://t.me/campsflint_bot?start=ref_<code>`. Код у каждого в личном
  кабинете (Mini App → Прогресс → Твоя реф-ссылка). Можно опц. задать
  `TELEGRAM_BOT_USERNAME` (по умолчанию `campsflint_bot`).
- **Важно перед включением:** владельцу (377551019) нужен `is_core=true` (в миграции есть)
  и открыть профиль в боте, чтобы сгенерировать свой ref_code — иначе первую ссылку
  выдать некому.

## 9. Грабли (не наступать — из прод-опыта)

- **⚠️ Vercel Hobby: максимум 12 serverless-функций на деплой.** Каждый файл в `api/**/*.ts` =
  функция. Превышение → деплой падает молча, прод отдаёт ПОСЛЕДНЮЮ удачную сборку (легко принять
  за «изменения не появились»). Локальный esbuild/tsc лимит НЕ ловит. Проверять статус деплоя
  (GitHub Deployments API / Vercel). Новые эндпоинты добавлять через `?action=` в существующие
  роутеры, а не новыми файлами. **Текущий счётчик — 11 из 12** (один слот в запасе).
  Примеры сложенных роутеров: `api/club.ts` = gate+profile;
  `api/events.ts` = список + vote + interest + feedback + upsert.

- **Tailwind v4:** `z-55/z-60` невалидны → `z-[60]/z-[70]`. `backdrop-blur` создаёт
  containing-block для `position:fixed` (ломало мобильное меню).
- **Serverless не импортирует `../src/*.ts`** → `FUNCTION_INVOCATION_FAILED`. Логика
  дублируется по разные стороны границы (напр. `mapEventToCamelCase`).
- `members.telegram_id` = BIGINT; веб-ники → отрицательный хеш; рассылка/`api/my`
  работают только с реальными (положительными) id.
- Vercel Security Checkpoint (403) блокирует curl из среды ассистента к `*.vercel.app`
  (не к `api.telegram.org`). Бот проверять через Telegram API напрямую.
- Билд-проверка: `npx tsc --noEmit && npm run build`; для api —
  `npx esbuild api/<f>.ts --bundle --platform=node --format=esm --outdir=/tmp/x`.
- `.env.example` содержит протухший токен (id 7861573345, 401). Реальный (id 8697211974)
  только на Vercel.
