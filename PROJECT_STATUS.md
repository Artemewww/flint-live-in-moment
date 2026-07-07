# Состояние проекта Flint Live in Moment

## Текущий статус
- **GitHub репозиторий**: https://github.com/Artemewww/flint-live-in-moment
- **Vercel деплой**: https://flint-live-in-moment.vercel.app
- **Последний коммит**: 5f9e005 (админские API endpoints)

## Архитектура
- **Frontend**: React + Vite + TypeScript
- **Backend**: Vercel Serverless Functions (api/ папка)
- **База данных**: Supabase (Postgres) - требуется настройка
- **Данные**: public/events.json (fallback, если Supabase не настроен)

## Что реализовано

### Frontend (React)
- ✅ Календарь мероприятий
- ✅ Лента событий с фильтрацией
- ✅ Детальная карточка мероприятия
- ✅ Расширенная регистрация (транспорт, инвентарь, категория, питание, гость, роли)
- ✅ Согласие на обработку персональных данных
- ✅ Кнопки "Один/С компанией"
- ✅ Яндекс.Карты + скрытие локации для неавторизованных
- ✅ Голосование за программу с дедлайном
- ✅ Дни рождения (только для авторизованных в Telegram)
- ✅ Бургер-меню для мобильных
- ✅ Геймификация: уровни, достижения, баллы
- ✅ Telegram бот интеграция (@campsflint_bot)
- ✅ Админ панель с полным управлением
- ✅ Шаблоны мероприятий
- ✅ Рассылка уведомлений через Telegram

### Backend (Vercel Serverless)
- ✅ POST /api/register - регистрация на мероприятие
- ✅ GET/POST /api/events - получение/создание событий
- ✅ POST /api/vote - голосование за программу
- ✅ POST /api/interest - сигнал интереса
- ✅ GET/POST/DELETE /api/admin/events - админка событий
- ✅ GET/DELETE/PATCH /api/admin/registrations - админка регистраций

### База данных (Supabase)
- ✅ Схема БД создана (supabase/schema.sql)
- ✅ Таблицы: events, members, registrations
- ✅ Автоматические функции: increment_participants, decrement_participants, get_event_stats
- ✅ Индексы для производительности

## Что нужно сделать

### Критично (чтобы заработала база):
1. **Создать проект Supabase** (см. SUPABASE_SETUP.md)
2. **Применить schema.sql** в Supabase SQL Editor
3. **Добавить переменные окружения в Vercel**:
   - SUPABASE_URL
   - SUPABASE_SERVICE_ROLE_KEY
   - ADMIN_TOKEN (уже есть: flint-admin-2026)
   - TELEGRAM_BOT_TOKEN (уже есть)
4. **Передеплоить на Vercel** (автоматически после push)

### Важно (Phase 2):
5. **Telegram бот** - пошаговая регистрация
6. **Система одобрения пользователей** (3 этапа)
7. **Личный кабинет** - история, редактирование профиля
8. **Отмена участия** с учётом оплаты

### Желательно:
9. Логистика (транспорт, палатки)
10. Питание и закупки
11. Уведомления (напоминания за 24ч/2ч)

## Как обновлять мероприятия

### Вариант 1: Через админку (рекомендуется)
1. Открыть https://flint-live-in-moment.vercel.app
2. Нажать скрытую кнопку "Админ" (opacity 10%)
3. Ввести пароль: `flint-admin-2026`
4. Создать/редактировать мероприятия

### Вариант 2: Через Supabase
1. Открыть Supabase проект
2. Table Editor → events
3. Редактировать/добавлять записи

### Вариант 3: Через JSON (fallback)
1. Отредактировать `public/events.json`
2. Закоммитить и запушить на GitHub
3. Vercel автоматически пересоберет сайт

## Структура проекта
```
flint-live-in-moment/
├── src/                    # React компоненты
│   ├── components/         # UI компоненты
│   ├── App.tsx            # Главный компонент
│   ├── api.ts             # API клиент
│   └── types.ts           # TypeScript типы
├── public/                 # Статические файлы
│   └── events.json        # Fallback данные
├── api/                    # Vercel Serverless Functions
│   ├── register.ts        # Регистрация
│   ├── events.ts          # События
│   ├── vote.ts            # Голосование
│   ├── interest.ts        # Интерес
│   └── admin/             # Админские endpoints
│       ├── events.ts
│       └── registrations.ts
├── supabase/              # Supabase конфигурация
│   └── schema.sql         # Схема БД
├── SUPABASE_SETUP.md      # Инструкция по настройке
└── package.json
```

## Переменные окружения

### Vercel Environment Variables
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
ADMIN_TOKEN=flint-admin-2026
TELEGRAM_BOT_TOKEN=7861573345:AAEoWtYZa_6rWJszayOQ-9pRjf1p5X2lM9A
```

## Следующие шаги
1. Настроить Supabase (см. SUPABASE_SETUP.md)
2. Добавить переменные окружения в Vercel
3. Дождаться автодеплоя
4. Протестировать регистрацию
5. Начать Phase 2 (Telegram бот)