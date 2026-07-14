# Архитектура проекта «Живи в моменте»

## 1. Обзор системы

**«Живи в моменте»** — интерактивная афиша и календарь мероприятий трезвого сообщества осознанного общения (Минск, Беларусь). Работает как веб-сайт и как **Telegram Mini App**, интегрированная с ботом [@campsflint_bot](https://t.me/campsflint_bot).

### Ключевые возможности

- 📅 **Календарь и каталог мероприятий** с фильтрами, архивом и детальными карточками событий
- 🔒 **Жизненный цикл события**: анонс «под замочком» → открытый набор → полный список → архив
- 🤖 **Связка с Telegram-ботом**: заявки с сайта уходят организатору, бот синхронизирует события с сайтом
- 📱 **Telegram Mini App**: внутри Telegram личность подтягивается автоматически, заявка подписывается и доставляется
- 🎭 **Закрытый клуб**: доступ по реферальным ссылкам, модерация новых участников костяком
- 🗳️ **Голосования за программу**: участники выбирают формат и активности до события
- ⭐ **Обратная связь**: рейтинги и отзывы после мероприятий
- 🚗 **Совместные поездки**: координация транспорта между участниками
- 🔔 **Напоминания**: автоматические уведомления за 7д, 3д, 1д, 3ч, 1ч до события

### Архитектурный подход

Система построена по **serverless-first** принципу с разделением на три независимых компонента:

1. **Frontend (Vite SPA)** — статический сайт с динамическим подключением к API
2. **Backend (Vercel Serverless Functions)** — REST API для событий, регистраций, админки
3. **Bot (Node.js long-polling)** — Telegram-бот на отдельном сервере для диалогов и уведомлений

Все компоненты работают с общей базой данных **Supabase (PostgreSQL)**, что обеспечивает единый источник правды и синхронизацию состояния между веб-интерфейсом и ботом.

## 2. Технологический стек

### Frontend
- **React 19** — UI-фреймворк
- **TypeScript** — типизация
- **Vite 6** — сборщик и dev-сервер
- **Tailwind CSS v4** — стилизация
- **Motion (Framer Motion)** — анимации
- **Lucide React** — иконки

### Backend
- **Vercel Serverless Functions** — хостинг API-эндпоинтов
- **@vercel/node** — рантайм для serverless
- **Node.js 22+** — среда выполнения

### База данных
- **Supabase** — managed PostgreSQL + Auth + Storage
- **@supabase/supabase-js** — клиент для взаимодействия с БД
- **service_role key** — обход RLS для серверных операций

### Telegram Bot
- **Grammy** (предположительно) или нативный Telegram Bot API
- **Node.js** — рантайм
- **PM2 / systemd** — процесс-менеджер на сервере
- **Long polling** — получение обновлений от Telegram

### Инфраструктура
- **Vercel** — хостинг фронтенда и serverless API
- **VPS/dedicated server** — хостинг Telegram-бота (постоянный процесс)
- **Supabase Cloud** — управляемая PostgreSQL база данных
- **GitHub** — контроль версий и CI/CD

### Дополнительные библиотеки
- **Google Generative AI** (@google/genai) — вероятно, для AI-ассистента или контента
- **Google Spreadsheet API** (google-spreadsheet) — интеграция с таблицами
- **dotenv** — управление переменными окружения
- **crypto** (Node.js встроенный) — подпись и верификация Telegram initData

## 3. Компоненты системы

### 3.1 Frontend (React SPA)

**Расположение**: `/src`

**Точка входа**: `src/main.tsx` → `src/App.tsx`

#### Ключевые компоненты UI

- **App.tsx** — корневой компонент, управление состоянием приложения
- **EventFeed.tsx** — лента мероприятий с фильтрацией
- **CalendarGrid.tsx** — календарная сетка
- **EventDetailModal.tsx** — детальная карточка события
- **RegistrationModal.tsx** — форма записи на мероприятие
- **VerificationModal.tsx** — верификация нового участника (кто пригласил в клуб)
- **AdminPanel.tsx** — панель администратора для управления событиями
- **BirthdayCalendar.tsx** — календарь дней рождения участников
- **UserStats.tsx** — статистика участника (посещения, достижения)
- **FeedbackModal.tsx** — форма обратной связи после события
- **ProgramVoting.tsx** — голосование за варианты программы
- **GateScreen.tsx** — экран-пропуск для закрытого клуба (проверка реф-ссылки)
- **EventPoster.tsx** — генератор постера события для шаринга

#### Доменные модули

- **types.ts** — типы данных (CommunityEvent, Registration, UserProfile)
- **data.ts** — INITIAL_EVENTS (fallback при недоступности API)
- **telegram.ts** — обёртка над Telegram Mini App SDK
- **api.ts** — клиент для взаимодействия с `/api/*` эндпоинтами
- **houseQualities.ts** — модель «качеств дома» (фундамент, стены, крыша = развитие личности)
- **geo.ts** — геоданные, расчёт расстояний от Минска
- **eventGuide.ts** — шаблоны и гайды по организации событий

#### Логика состояний событий

```typescript
EventPhase = 'past' | 'locked' | 'open' | 'full' | 'closed'
EventStatus = 'locked' | 'open' | 'closed'

getEventPhase(event, today):
  - past: дата прошла
  - closed: status='closed'
  - locked: status='locked' (анонс для костяка)
  - full: набор закрыт (participantsCount >= maxParticipants)
  - open: регистрация открыта
```

### 3.2 Backend (Vercel Serverless Functions)

**Расположение**: `/api`

#### Публичные эндпоинты

**`/api/events`** (GET)
- Список всех событий из Supabase
- Маппинг snake_case → camelCase для фронтенда
- Fallback на `/events.json` при недоступности БД

**`/api/events?action=vote`** (POST)
- Голосование за вариант программы события
- Верификация Telegram initData
- Upsert в `program_votes` (один голос на человека)

**`/api/events?action=interest`** (POST)
- Сигнал «мне интересно» на закрытое событие
- Копит спрос, пингует организаторов в Telegram

**`/api/events?action=feedback`** (POST)
- Отзыв после события (1–5 звёзд + комментарий)
- Один отзыв на человека, переписать можно

**`/api/events?action=image&id=<eventId>`** (GET)
- Отдаёт картинку события как бинарный файл
- Base64 data-URL из БД → PNG/JPEG для Open Graph

**`/api/events?action=og&id=<eventId>&ref=<code>`** (GET)
- Страница-приглашение с Open Graph разметкой
- Для красивых превью в Telegram/Viber при шаринге
- Автоматический редирект в бота через 1.2 секунды

**`/api/register`** (POST)
- Регистрация на мероприятие
- Upsert участника в `members`, insert заявки в `registrations`
- Проверка `access_code` для закрытых событий
- Верификация Telegram initData (если из Mini App)
- Реферальная система: фиксация пригласившего
- Уведомление организатору в Telegram (best-effort)

**`/api/my`** (POST, Telegram initData)
- Личные заявки участника из `registrations`
- Для синхронизации «Мои Участия» между веб и ботом

**`/api/club`** (POST, Telegram initData)
- Статус участника в закрытом клубе (pending/approved/blocked)
- Проверка is_core (костяк — не блокируется)

**`/api/ai`** (POST)
- Вероятно, AI-ассистент для подбора событий или генерации контента
- Использует @google/genai

#### Админские эндпоинты (Authorization: Bearer <ADMIN_TOKEN>)

**`/api/events?action=health`** (GET)
- Проверка применения миграции БД (все таблицы и RPC на месте)
- Зонд ЗАПИСИ: при включённом RLS select может молча вернуть пусто

**`/api/events`** (POST, admin)
- Создание/обновление события (upsert)

**`/api/admin/events`** (GET/POST)
- Полное управление событиями с админ-данными

**`/api/admin/registrations`** (GET/POST)
- Список заявок, модерация (подтверждение/отклонение)

**`/api/admin/broadcast`** (POST)
- Массовая рассылка уведомлений участникам

**`/api/cron/reminders`** (GET, admin)
- Крон-задача: отправка напоминаний за 7д/3д/1д/3ч/1ч
- Вызывается внешним планировщиком (Vercel Cron / crontab)

**`/api/telegram/webhook`** (POST)
- Webhook для получения обновлений от Telegram (альтернатива long polling)
- Не используется, бот работает через polling

**`/api/profile/onboard`** (POST, Telegram initData)
- Онбординг нового участника: мечты, интересы, навыки, цель развития

#### Авторизация админских эндпоинтов

```typescript
Authorization: Bearer <ADMIN_TOKEN>  // для curl, крона
Cookie: flint_admin=<exp>.<mac>      // для браузера (подписанная сессия)
```

### 3.3 Telegram Bot

**Расположение**: `/bot`

**Точка входа**: `bot/src/index.js`

#### Handlers (команды и диалоги)

- **start.js** — `/start`, приветствие, меню
- **events.js** — просмотр ближайших мероприятий, детали события
- **registration.js** — пошаговая регистрация на событие через диалог
- **profile.js** — личный профиль, статистика, достижения
- **admin.js** — админ-панель, модерация заявок, рассылка
- **approval.js** — модерация новых участников костяком (одобрить/заблокировать)

#### notifications.js

- Крон-задача внутри бота: проверка событий и отправка напоминаний
- Периоды: 7д, 3д, 1д, 3ч, 1ч до события
- Обновление `registrations.reminded_at` во избежание дублей
- Обработка 403 ошибок (бот заблокирован) → `members.bot_active = false`

#### Механизм диалогов

- **bot_sessions** — персистентное хранилище состояния диалога
- State machine: текущий шаг, контекст (eventId, вводимые данные)
- Позволяет переживать рестарты бота без потери прогресса

#### Интеграция с API

Бот **НЕ** дублирует бизнес-логику, а вызывает те же `/api/*` эндпоинты, что и фронтенд:
- `GET /api/events` — список событий
- `POST /api/register` — создание заявки
- `GET /api/admin/registrations` — модерация (для админов)

### 3.4 Shared Resources

**`/shared/events.data.js`** — общий источник данных событий (легаси, сейчас всё в БД)

**`/supabase/migrations/`** — SQL-миграции для создания схемы БД

**`/public/events.json`** — статический fallback при недоступности Supabase

## 4. Структура данных

### 4.1 Основные таблицы Supabase (PostgreSQL)

#### `events` — мероприятия

```sql
id                text PRIMARY KEY
title             text NOT NULL
description       text
type              text              -- 'male' | 'mixed' | 'intellectual' | 'active'
date              text NOT NULL     -- YYYY-MM-DD
date_end          text              -- для многодневных событий
date_label        text              -- человекочитаемая дата («15-17 июля»)
time              text
time_end          text
location          text NOT NULL
location_details  text
coordinates_lat   float
coordinates_lng   float
pain_point        text              -- «боль», которую решает событие
house_qualities   jsonb DEFAULT []  -- развивающие аспекты
image             text              -- data-URL или путь
max_participants  int DEFAULT 15
participants_count int DEFAULT 0
telegram_bot_url  text
price_type        text              -- 'free' | 'paid'
price_label       text
price_amount      int DEFAULT 0
entry_threshold   text              -- условие допуска
entry_type        text DEFAULT 'all' -- 'male' | 'female' | 'all'
status            text DEFAULT 'locked' -- 'locked' | 'open' | 'closed'
status_reason     text              -- пояснение статуса («под вопросом»)
decision_deadline text              -- дедлайн принятия решения об отмене
checklist         jsonb DEFAULT {}  -- готовность события
is_public         boolean DEFAULT true
access_code       text              -- код для закрытых событий
deputy_id         bigint            -- заместитель организатора
locked_hint       text              -- подсказка для locked-события
program           jsonb DEFAULT []  -- программа мероприятия
notifications     jsonb DEFAULT {}  -- настройки напоминаний
program_voting    jsonb             -- конфиг голосования за программу
logistics         jsonb DEFAULT {}  -- точка сбора, время отъезда, топливо
payment_details   jsonb DEFAULT {}  -- ERIP, карта, инструкции
created_at        timestamptz
updated_at        timestamptz
```

#### `members` — участники

```sql
telegram_id       bigint PRIMARY KEY
username          text
first_name        text
phone             text
birthday          text
category          text              -- 'male' | 'female'
dietary           text              -- 'omnivore' | 'vegetarian' | 'vegan'
status            text DEFAULT 'pending' -- 'pending' | 'pending_review' | 'approved' | 'blocked'
is_core           boolean DEFAULT false   -- костяк
role              text DEFAULT 'member'   -- 'owner' | 'admin' | 'member'
ref_code          text UNIQUE             -- персональный реф-код
referred_by       bigint                  -- кто пригласил
points            int DEFAULT 0           -- баллы за активность
agreed_pd         boolean DEFAULT false   -- согласие на обработку ПД
approved_by       bigint                  -- кто одобрил в клуб
bot_active        boolean DEFAULT true    -- не заблокировал бота
last_seen_at      timestamptz
prefs             jsonb DEFAULT {}        -- накопленные предпочтения
created_at        timestamptz
```

#### `registrations` — заявки на мероприятия

```sql
id                text PRIMARY KEY
event_id          text NOT NULL REFERENCES events(id)
telegram_id       bigint NOT NULL REFERENCES members(telegram_id)
name              text NOT NULL
phone             text
inviter           text              -- кто пригласил на событие
status            text DEFAULT 'pending' -- 'pending' | 'confirmed' | 'rejected' | 'cancelled'
payment_status    text DEFAULT 'pending' -- 'pending' | 'paid' | 'free' | 'refunded'
payment_amount    int DEFAULT 0
donation_amount   int DEFAULT 0
has_transport     boolean DEFAULT false
transport_details text
transport_seats   int DEFAULT 0
inventory         jsonb DEFAULT []
category          text              -- 'male' | 'female'
dietary           text
guest_count       int DEFAULT 0
equipment         jsonb DEFAULT []
roles             jsonb DEFAULT []  -- роли на событии (повар, водитель)
notes             text
source            text              -- 'website' | 'bot' | 'referral'
source_hint       text              -- «откуда узнал»
days              jsonb DEFAULT []  -- даты участия (для многодневных)
guests            jsonb DEFAULT []  -- список гостей
children_count    int DEFAULT 0
food_optout       boolean DEFAULT false
payment_proof     text              -- ссылка на скрин оплаты
payment_submitted_at timestamptz
contact_revealed  boolean DEFAULT false  -- контакт открыт организатору
attended          boolean DEFAULT false  -- факт явки
reminded_at       timestamptz            -- анти-дубль напоминаний
pay_reminded_at   timestamptz
registered_at     timestamptz DEFAULT now()
confirmed_at      timestamptz
cancelled_at      timestamptz
cancel_reason     text

UNIQUE (event_id, telegram_id) WHERE status <> 'cancelled'
```

#### `bot_sessions` — состояние диалогов бота

```sql
telegram_id       bigint PRIMARY KEY
state             text              -- текущий шаг диалога
context           jsonb DEFAULT {}  -- контекст (eventId, частичные данные)
updated_at        timestamptz DEFAULT now()
```

#### `referrals` — история приглашений

```sql
id                bigserial PRIMARY KEY
ref_code          text
inviter_id        bigint
invited_id        bigint
event_id          text
created_at        timestamptz DEFAULT now()
rewarded          boolean DEFAULT false
```

#### `program_votes` — голоса за программу

```sql
id                bigserial PRIMARY KEY
event_id          text NOT NULL REFERENCES events(id)
telegram_id       bigint
option            text NOT NULL
created_at        timestamptz DEFAULT now()

UNIQUE (event_id, telegram_id)
```

#### `interests` — «мне интересно»

```sql
id                bigserial PRIMARY KEY
event_id          text NOT NULL REFERENCES events(id)
telegram_id       bigint
created_at        timestamptz DEFAULT now()

UNIQUE (event_id, telegram_id)
```

#### `feedback` — отзывы

```sql
id                bigserial PRIMARY KEY
event_id          text NOT NULL REFERENCES events(id)
telegram_id       bigint
rating            int CHECK (rating BETWEEN 1 AND 5)
would_return      boolean
comment           text
created_at        timestamptz DEFAULT now()

UNIQUE (event_id, telegram_id)
```

#### `tasks` — задачи/поручения события

```sql
id                bigserial PRIMARY KEY
event_id          text REFERENCES events(id)
title             text
taken_by          bigint
done              boolean DEFAULT false
created_by        bigint
created_at        timestamptz DEFAULT now()
```

#### `rides` — совместные поездки

```sql
id                bigserial PRIMARY KEY
event_id          text REFERENCES events(id)
driver_id         bigint
route             text
departure_time    text
seats_total       int
seats_taken       int DEFAULT 0
active            boolean DEFAULT true
created_at        timestamptz DEFAULT now()
```

#### `ride_bookings` — брони мест

```sql
ride_id           bigint REFERENCES rides(id)
passenger_id      bigint
passenger_name    text
created_at        timestamptz DEFAULT now()

PRIMARY KEY (ride_id, passenger_id)
```

#### `polls` и `poll_votes` — общие голосования

```sql
-- polls
id                bigserial PRIMARY KEY
event_id          text REFERENCES events(id)
question          text
options           jsonb DEFAULT []
deadline          text
created_by        bigint
created_at        timestamptz DEFAULT now()

-- poll_votes
poll_id           bigint REFERENCES polls(id)
telegram_id       bigint
choice            int
created_at        timestamptz DEFAULT now()

PRIMARY KEY (poll_id, telegram_id)
```

### 4.2 RPC (хранимые процедуры)

**`award_points(tg bigint, n int)`**
- Начисление баллов участнику

**`book_ride_seat(p_ride_id bigint, p_passenger bigint, p_name text) → text`**
- Атомарная бронь места в машине
- Возвращает: 'ok' | 'full' | 'gone' | 'dup'

**`cancel_ride_seat(p_ride_id bigint, p_passenger bigint) → text`**
- Освобождение места
- Возвращает: 'ok' | 'none'

**`increment_participants(event_id text)`**
- Инкремент счётчика участников события (вызывается при создании заявки)

### 4.3 TypeScript типы (Frontend)

```typescript
type EventType = 'male' | 'mixed' | 'intellectual' | 'active'
type EventStatus = 'locked' | 'open' | 'closed'
type EventPhase = 'past' | 'locked' | 'open' | 'full' | 'closed'

interface CommunityEvent {
  id: string
  title: string
  description: string
  type: EventType
  date: string
  dateEnd?: string
  dateLabel: string
  time: string
  timeEnd: string
  location: string
  locationDetails?: string
  coordinates?: { lat: number; lng: number }
  painPoint: string
  houseQualities: HouseQuality[]
  image: string
  maxParticipants?: number
  participantsCount: number
  telegramBotUrl?: string
  priceType: 'free' | 'paid'
  priceLabel: string
  priceAmount: number
  entryThreshold: string
  entryType: 'male' | 'female' | 'all'
  needsOnboarding?: boolean
  status?: EventStatus
  statusReason?: string
  decisionDeadline?: string
  checklist?: Record<string, boolean>
  isPublic?: boolean
  accessCode?: string
  deputyId?: number
  lockedHint?: string
  program: string[]
  notifications: {
    reminder7d: boolean
    reminder3d: boolean
    reminder1d: boolean
    reminder3h: boolean
    reminder1h: boolean
  }
  programVoting?: {
    enabled: boolean
    deadline: string
    options: string[]
  }
  logistics?: {
    assemblyPoint?: string
    departureTime?: string
    fuelCost?: number
    returnInfo?: string
    notes?: string
  }
  paymentDetails?: {
    erip?: string
    card?: string
    method?: string
  }
}

interface Registration {
  id: string
  eventId: string
  telegram: string
  name: string
  phone?: string
  birthday?: string
  status: 'pending' | 'confirmed' | 'rejected' | 'cancelled'
  paymentStatus: 'pending' | 'paid' | 'free' | 'refunded'
  paymentAmount: number
  donationAmount: number
  inviter?: string
  hasTransport: boolean
  transportDetails?: string
  transportSeats: number
  inventory: string[]
  registeredAt: string
  confirmedAt?: string
  cancelledAt?: string
  cancelReason?: string
  notes?: string
  category?: 'male' | 'female'
  dietary?: 'omnivore' | 'vegetarian' | 'vegan'
  guestCount?: number
  equipment?: string[]
  roles?: string[]
  source?: string
  developmentGoal?: HouseQuality['key']
}

interface UserProfile {
  telegram: string
  name: string
  phone?: string
  birthday?: string
  achievements: Achievement[]
  totalEvents: number
  totalEventsAttended: number
  createdAt: string
  developmentGoal?: HouseQuality['key']
  developmentRequest?: string
  isProfileCompleted?: boolean
  dreams?: string
  interests?: string[]
  skills?: string[]
}
```

## 5. API и интеграции

### 5.1 Потоки данных

#### Регистрация на событие (веб → бот)

```
1. Пользователь открывает сайт в Telegram Mini App
2. Frontend проверяет window.Telegram.WebApp.initDataUnsafe
3. При записи на событие:
   - POST /api/register { eventId, name, telegram, initData, ... }
4. Backend:
   - Верифицирует initData (HMAC-SHA256 с BOT_TOKEN)
   - Upsert в members (telegram_id реальный из initData)
   - Insert в registrations
   - Отправляет уведомление в Telegram админу
5. Бот видит заявку в БД при следующей модерации
```

#### Синхронизация событий (бот → веб)

```
1. Организатор создаёт событие через /api/admin/events (админ-панель)
2. Event upsert в Supabase events
3. Frontend:
   - Периодически обновляет список через GET /api/events
   - Либо SSE/WebSocket (не реализовано, обновление по запросу)
4. Бот:
   - Запрашивает GET /api/events при команде /events
   - Отображает те же данные, что и веб
```

#### Напоминания

```
1. Cron (Vercel Cron или внешний планировщик):
   - Каждый час: GET /api/cron/reminders (с ADMIN_TOKEN)
2. API проверяет registrations + events:
   - За 7д, 3д, 1д, 3ч, 1ч до события
   - Фильтрует reminded_at (анти-дубль)
3. Отправка через Telegram Bot API:
   - https://api.telegram.org/bot<TOKEN>/sendMessage
   - Обработка 403 → members.bot_active = false
```

### 5.2 Внешние интеграции

#### Telegram Bot API

- **Авторизация**: `BOT_TOKEN` из @BotFather
- **Webhook vs Polling**: проект использует long polling (бот на VPS)
- **Mini App**: кнопка в меню бота ведёт на Vercel URL
- **initData verification**: HMAC с секретом `WebAppData` + BOT_TOKEN

#### Supabase

- **Connection**: `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
- **RLS**: Row Level Security включён, service_role обходит политики
- **Real-time**: не используется (polling из фронтенда)
- **Storage**: картинки событий хранятся как Base64 data-URL в `events.image`

#### Google Sheets (опционально)

- **Библиотека**: google-spreadsheet
- **Назначение**: экспорт заявок для оффлайн-работы организаторов
- **Авторизация**: Service Account credentials (не в репозитории)

#### Google Generative AI (опционально)

- **Библиотека**: @google/genai
- **Эндпоинт**: `/api/ai`
- **Назначение**: AI-ассистент для подбора событий, генерация описаний

### 5.3 Схема взаимодействия компонентов

```
┌─────────────────────────────────────────────────────────────┐
│                    Telegram Messenger                        │
│  ┌─────────────────┐              ┌───────────────────┐     │
│  │   Mini App      │◄─────────────┤   Bot (VPS)       │     │
│  │   (Vercel)      │              │   long-polling    │     │
│  └────────┬────────┘              └─────────┬─────────┘     │
└───────────┼──────────────────────────────────┼───────────────┘
            │                                  │
            │ HTTPS                            │ HTTPS
            ▼                                  ▼
   ┌────────────────────────────────────────────────────┐
   │             Vercel Serverless Functions            │
   │  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
   │  │ /events  │  │ /register│  │ /admin/* │        │
   │  └──────────┘  └──────────┘  └──────────┘        │
   └────────────────────┬───────────────────────────────┘
                        │
                        │ PostgreSQL protocol
                        ▼
            ┌───────────────────────┐
            │    Supabase Cloud     │
            │   (PostgreSQL + RLS)  │
            │                       │
            │  events, members,     │
            │  registrations, ...   │
            └───────────────────────┘
```

## 6. Безопасность

### 6.1 Аутентификация и авторизация

#### Telegram Mini App Authentication

**Механизм**: Telegram WebApp initData signature

```typescript
function verifyInitData(initData: string): User | null {
  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  params.delete('hash')
  
  // Сортировка параметров и формирование data_check_string
  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n')
  
  // Секретный ключ: HMAC-SHA256(BOT_TOKEN, "WebAppData")
  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(BOT_TOKEN)
    .digest()
  
  // Проверка подписи
  const calculatedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex')
  
  return calculatedHash === hash ? JSON.parse(params.get('user')) : null
}
```

**Защита от подделки**: только Telegram может сгенерировать корректную подпись (требуется BOT_TOKEN)

#### Админская авторизация

**Два механизма**:

1. **Bearer Token** (для API, curl, cron)
   ```
   Authorization: Bearer <ADMIN_TOKEN>
   ```

2. **Signed Cookie** (для браузера)
   ```
   Cookie: flint_admin=<timestamp>.<hmac>
   ```
   - HMAC предотвращает продление сессии вручную
   - Timestamp = время истечения (например, +7 дней)

**Безопасное сравнение**:
```typescript
function safeEq(a: string, b: string): boolean {
  const A = Buffer.from(a), B = Buffer.from(b)
  return A.length === B.length && crypto.timingSafeEqual(A, B)
}
```

### 6.2 Защита данных

#### Row Level Security (RLS) в Supabase

- **Включено на всех таблицах**
- **service_role key** обходит RLS (используется в API/боте)
- **anon key** был бы ограничен политиками (в проекте не используется)

**Важно**: код раньше работал с обычным ключом и RLS молча блокировал запись. Health check (`/api/events?action=health`) теперь проверяет **ЗАПИСЬ**, а не только чтение.

#### Защита от injection

**SQL Injection**: все запросы через Supabase клиент (параметризованные запросы)

**XSS**: 
- React автоматически экранирует JSX
- HTML в Telegram-уведомлениях: `esc()` функция
  ```typescript
  function esc(s: string): string {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  }
  ```

**Command Injection**: не критично (нет `exec()` с пользовательским вводом)

#### Закрытые события

- **Код доступа** (`access_code`) хранится **только** в БД
- Фронтенд получает флаг `isPublic: false`, но НЕ сам код
- Проверка кода — **только** на сервере в `/api/register`:
  ```typescript
  if (event.is_public === false && event.access_code) {
    if (body.accessCode !== event.access_code) {
      return res.status(403).json({ error: 'Неверный код доступа' })
    }
  }
  ```

#### Закрытый клуб (Gate)

- **Реферальная система**: первая регистрация фиксирует `referred_by`
- **Модерация костяком**: статус `pending` → `approved` | `blocked`
- **GateScreen**: без реф-ссылки афиша недоступна (проверка `localStorage.flint_gate_ok`)
- Аварийное открытие: `VITE_GATE_ENABLED=0` в env

### 6.3 Переменные окружения

**Критичные секреты** (никогда не коммитить):

```bash
# Telegram
TELEGRAM_BOT_TOKEN=<от @BotFather>
TELEGRAM_ADMIN_CHAT_ID=<ID группы для уведомлений>
TELEGRAM_BOT_USERNAME=campsflint_bot

# Supabase
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role или secret, НЕ anon>

# Админка
ADMIN_TOKEN=<случайная строка 32+ символа>

# Опционально
GOOGLE_SHEETS_CREDENTIALS=<JSON service account>
GOOGLE_AI_API_KEY=<ключ Gemini API>
```

**Где хранятся**:
- Vercel: Settings → Environment Variables
- VPS (бот): `/opt/flint-bot/.env` с правами 600
- Локально: `.env` (в `.gitignore`)

### 6.4 Риски и митигации

| Риск | Вероятность | Последствия | Митигация |
|------|-------------|-------------|-----------|
| Утечка BOT_TOKEN | Низкая | Контроль бота | Токен только в env, ротация через @BotFather |
| Утечка ADMIN_TOKEN | Низкая | Контроль админки | Случайная строка, не в коде, short-lived cookies |
| SQL Injection | Очень низкая | Доступ к БД | Supabase клиент (параметризация) |
| XSS в уведомлениях | Низкая | Фишинг | HTML-экранирование esc() |
| Подделка initData | Очень низкая | Спуфинг участника | HMAC-верификация с BOT_TOKEN |
| RLS обход | Низкая | Утечка данных | service_role только на сервере, никогда на клиенте |
| Брутфорс access_code | Средняя | Вход на закрытое событие | Коды не отдаются клиенту, проверка на сервере |
| DDoS на /api/* | Средняя | Недоступность | Vercel Rate Limiting (встроенный) |

## 7. Развёртывание

### 7.1 Окружения

| Компонент | Dev | Production |
|-----------|-----|------------|
| **Frontend** | `npm run dev` (localhost:3000) | Vercel (auto-deploy из main) |
| **Backend API** | Vercel Dev (`vercel dev`) | Vercel Serverless |
| **Bot** | `npm run dev` (локально) | PM2 на VPS |
| **БД** | Supabase (общая для всех окружений) | Supabase Production |

### 7.2 Frontend (Vercel)

#### Установка и запуск локально

```bash
cd /path/to/flint-live-in-moment
npm install
npm run dev        # http://localhost:3000
npm run build      # сборка в dist/
npm run lint       # проверка типов TypeScript
```

#### Деплой на Vercel

1. **Подключение репозитория**:
   ```bash
   vercel login
   vercel link
   ```

2. **Переменные окружения** (Vercel Dashboard → Settings → Environment Variables):
   ```
   VITE_GATE_ENABLED=1              # включить закрытый клуб
   TELEGRAM_BOT_TOKEN=...           # для serverless функций
   TELEGRAM_ADMIN_CHAT_ID=...
   SUPABASE_URL=...
   SUPABASE_SERVICE_ROLE_KEY=...
   ADMIN_TOKEN=...
   ```

3. **Автодеплой**:
   - Push в `main` → production деплой
   - Push в другие ветки → preview деплой

4. **Ручной деплой**:
   ```bash
   vercel --prod
   ```

#### Конфигурация (vercel.json)

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vite",
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/$1" },
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

### 7.3 Backend API (Vercel Serverless)

Деплоится вместе с фронтендом. Каждый файл `/api/*.ts` становится отдельной serverless-функцией.

**Лимиты Vercel Hobby**:
- Макс. 12 функций → используются `?action=` вместо отдельных файлов
- 10 секунд на выполнение
- 1024 МБ памяти

**Cron задачи** (vercel.json):
```json
{
  "crons": [{
    "path": "/api/cron/reminders",
    "schedule": "0 * * * *"
  }]
}
```

### 7.4 Telegram Bot (VPS)

#### Установка на сервере

```bash
# 1. Клонирование
cd /opt
git clone https://github.com/user/flint-live-in-moment.git flint-bot
cd flint-bot/bot

# 2. Установка зависимостей
npm install --production

# 3. Создание .env
cp .env.example .env
nano .env  # заполнить все переменные
chmod 600 .env

# 4. Проверка запуска
npm start
```

#### Развёртывание с PM2

```bash
# Установка PM2
npm install -g pm2

# Запуск бота
cd /opt/flint-bot/bot
pm2 start src/index.js --name flint-bot --log /var/log/flint-bot.log

# Автозапуск при старте системы
pm2 startup systemd
pm2 save

# Мониторинг
pm2 status
pm2 logs flint-bot
pm2 restart flint-bot

# Обновление
cd /opt/flint-bot
git pull
cd bot
npm install
pm2 restart flint-bot
```

#### Альтернатива: systemd

Создать `/etc/systemd/system/flint-bot.service`:

```ini
[Unit]
Description=FLINT Telegram Bot
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/flint-bot/bot
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=10
Environment="NODE_ENV=production"

[Install]
WantedBy=multi-user.target
```

Запуск:
```bash
sudo systemctl enable flint-bot
sudo systemctl start flint-bot
sudo systemctl status flint-bot
sudo journalctl -u flint-bot -f
```

### 7.5 База данных (Supabase)

#### Создание проекта

1. Регистрация на [supabase.com](https://supabase.com)
2. Создание нового проекта
3. Сохранение credentials:
   - Project URL → `SUPABASE_URL`
   - Settings → API → `service_role` key → `SUPABASE_SERVICE_ROLE_KEY`

#### Применение миграций

```sql
-- В Supabase Dashboard → SQL Editor
-- Скопировать и выполнить содержимое:
-- supabase/migrations/2026-final.sql
```

Проверка:
```bash
curl -H "Authorization: Bearer <ADMIN_TOKEN>" \
  https://your-site.vercel.app/api/events?action=health
```

Все checks должны вернуть `"ok"`.

#### Бэкапы

- **Автоматические**: Supabase делает ежедневные бэкапы (7 дней на Free, 30 на Pro)
- **Ручные**: Dashboard → Database → Backups → Create backup

#### Мониторинг

- Dashboard → Reports: запросы, ошибки, производительность
- Алерты при превышении лимитов (500 МБ на Free)

### 7.6 CI/CD Pipeline

```
┌──────────────┐
│ Git Push     │
│ → main       │
└──────┬───────┘
       │
       ▼
┌──────────────────────┐
│ GitHub Actions       │
│ (опционально)        │
│ - npm run lint       │
│ - npm run build      │
└──────┬───────────────┘
       │
       ▼
┌──────────────────────┐
│ Vercel Auto-Deploy   │
│ - Build frontend     │
│ - Bundle /api/*      │
│ - Deploy to CDN      │
└──────┬───────────────┘
       │
       ▼
┌──────────────────────┐
│ Production Live ✅   │
└──────────────────────┘
```

**Бот обновляется вручную** через `git pull` + `pm2 restart` на VPS.

### 7.7 Мониторинг и логи

#### Frontend

- **Vercel Dashboard** → Deployments → Logs
- **Runtime Logs**: автоматически на странице деплоя
- **Analytics**: Vercel Analytics (встроен)

#### Backend API

- **Vercel Functions** → Logs по каждой функции
- **Errors**: автоматическая группировка ошибок

#### Bot

- **PM2**:
  ```bash
  pm2 logs flint-bot
  pm2 monit
  ```
- **Systemd**:
  ```bash
  sudo journalctl -u flint-bot -f
  ```

#### База данных

- **Supabase Dashboard** → Logs
- **Slow queries**: Reports → Performance

### 7.8 Disaster Recovery

#### Откат деплоя (Vercel)

```bash
# Список деплоев
vercel ls

# Откат к предыдущему
vercel rollback <deployment-url>
```

Или через Dashboard → Deployments → Promote to Production.

#### Восстановление БД

```sql
-- Supabase Dashboard → Database → Backups
-- Выбрать бэкап → Restore

-- Или экспорт через pg_dump (для локального бэкапа):
pg_dump -h db.project.supabase.co -U postgres -d postgres > backup.sql
```

#### Восстановление бота

```bash
cd /opt/flint-bot
git log  # найти рабочий коммит
git reset --hard <commit-hash>
pm2 restart flint-bot
```

### 7.9 Масштабирование

#### Узкие места

1. **Vercel Serverless**: холодный старт ~500мс
   - Mitigation: Vercel Pro (больше инстансов, меньше холодных стартов)

2. **Supabase Free**: 500 МБ БД, 2 ГБ bandwidth
   - Mitigation: Supabase Pro ($25/мес) или миграция на managed PostgreSQL

3. **Бот на одном VPS**: один процесс, single point of failure
   - Mitigation: несколько VPS + load balancer (для >10k пользователей)

#### Горизонтальное масштабирование

- **Frontend/API**: автоматически (Vercel Edge Network)
- **БД**: Supabase автоматически масштабирует читающие реплики (Pro+)
- **Бот**: при >100k запросов/день переход на webhook + serverless обработка

---

## Дополнительные документы

- **README.md** — быстрый старт и установка
- **BOT_SETUP.md** — настройка Telegram-бота
- **DEPLOYMENT.md** — детальная инструкция по деплою
- **SUPABASE_SETUP.md** — настройка БД
- **GOOGLE_SHEETS_SETUP.md** — интеграция с таблицами
- **PLAN.md** — техническое планирование и решения
- **PROJECT_STATUS.md** — статус реализации фич
- **FINAL_REPORT.md** — итоговый отчёт о проекте
