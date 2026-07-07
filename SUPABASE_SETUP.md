# Настройка Supabase для Flint Live in Moment

## Шаг 1: Создать проект Supabase

1. Зайдите на https://supabase.com
2. Создайте новый проект
3. Выберите регион (рекомендую: Europe West - Frankfurt)
4. Запомните пароль базы данных

## Шаг 2: Применить схему базы данных

1. Откройте Supabase проект
2. Перейдите в SQL Editor (левое меню)
3. Скопируйте содержимое файла `supabase/schema.sql`
4. Вставьте в SQL Editor и нажмите "Run"
5. Должны создаться таблицы: events, members, registrations

## Шаг 3: Получить ключи API

1. Перейдите в Settings → API
2. Скопируйте:
   - **Project URL** (SUPABASE_URL)
   - **anon public** ключ (не нужен для серверных функций)
   - **service_role** ключ (SUPABASE_SERVICE_ROLE_KEY) — ОБЯЗАТЕЛЬНО для serverless

## Шаг 4: Добавить переменные в Vercel

1. Откройте проект на Vercel
2. Settings → Environment Variables
3. Добавьте:

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
ADMIN_TOKEN=flint-admin-2026
TELEGRAM_BOT_TOKEN=7861573345:AAEoWtYZa_6rWJszayOQ-9pRjf1p5X2lM9A
```

4. Нажмите "Save"
5. Передеплойте проект (Deployments → Redeploy)

## Шаг 5: Импорт шаблонов мероприятий

1. После деплоя откройте: https://flint-live-in-moment.vercel.app/admin.html
2. Введите пароль: `flint-admin-2026`
3. Нажмите "Импорт шаблонов"
4. Шаблоны загрузятся в базу данных

## Шаг 6: Проверка

1. Откройте сайт: https://flint-live-in-moment.vercel.app
2. Должен показаться ближайшее мероприятие из базы
3. Попробуйте зарегистрироваться
4. Проверьте админку: участники должны появляться

## Структура базы данных

### events (мероприятия)
- id, title, description, type, date, time, location
- max_participants, participants_count (авто-счётчик)
- status: locked/open/closed
- price_type, price_label, price_amount
- program_voting (голосование за программу)

### members (участники)
- telegram_id (PRIMARY KEY)
- username, first_name, last_name, phone
- category (male/female), dietary

### registrations (заявки)
- id, event_id, telegram_id, name
- status (pending/confirmed/rejected/cancelled)
- payment_status, payment_amount
- has_transport, transport_details, transport_seats
- inventory, equipment, roles
- guest_count, inviter, source

## Автоматические функции

- `increment_participants(event_id)` — +1 к счётчику
- `decrement_participants(event_id)` — -1 от счётчика
- `get_event_stats(event_id)` — статистика по заявкам

## API Endpoints

- `POST /api/register` — регистрация на мероприятие
- `GET /api/events` — получить все мероприятия
- `POST /api/events` — создать/обновить мероприятие
- `POST /api/vote` — голосование за программу
- `POST /api/interest` — сигнал интереса

## Troubleshooting

**Ошибка "SUPABASE_URL not found":**
- Проверьте переменные окружения в Vercel
- Убедитесь, что нажали "Save" после добавления переменных

**Таблицы не создаются:**
- Проверьте SQL ошибки в Supabase SQL Editor
- Убедитесь, что выполнили schema.sql полностью

**Регистрация не работает:**
- Проверьте консоль браузера (F12)
- Проверьте логи Vercel (Deployments → Logs)
- Убедитесь, что SUPABASE_SERVICE_ROLE_KEY правильный