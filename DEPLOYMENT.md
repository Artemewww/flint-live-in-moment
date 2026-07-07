# Развертывание проекта Flint Live in Moment

## Обзор архитектуры

Проект состоит из трех частей:
1. **Frontend** (React + Vite) - деплоится на Vercel
2. **Backend API** (Vercel Serverless Functions) - деплоится вместе с frontend
3. **Telegram Bot** (Node.js) - деплоится на отдельный сервер

## Быстрый старт

### 1. Настройка Supabase (10 минут)

1. Создайте проект на https://supabase.com
2. Откройте SQL Editor и выполните `supabase/schema.sql`
3. Скопируйте `SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY` из Settings → API

### 2. Деплой Frontend на Vercel

1. Подключите репозиторий к Vercel
2. Добавьте переменные окружения:
   ```
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   ADMIN_TOKEN=flint-admin-2026
   TELEGRAM_BOT_TOKEN=7861573345:AAEoWtYZa_6rWJszayOQ-9pRjf1p5X2lM9A
   ```
3. Деплой произойдет автоматически

### 3. Настройка Telegram Bot

#### Вариант A: Vercel Cron (рекомендуется для простоты)

Создайте `vercel.json` в корне проекта:

```json
{
  "crons": [
    {
      "path": "/api/cron/notifications",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

Создайте `api/cron/notifications.ts`:

```typescript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

export default async function handler(req: any, res: any) {
  // Проверяем cron secret
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  try {
    // Получаем события, которые скоро начнутся
    const now = new Date();
    const in24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    
    const { data: events, error } = await supabase
      .from('events')
      .select('*')
      .gte('date', now.toISOString().split('T')[0])
      .lte('date', in24Hours.toISOString().split('T')[0]);
    
    if (error) throw error;
    
    // Отправляем уведомления
    for (const event of events) {
      // TODO: Получить зарегистрированных пользователей
      // TODO: Отправить уведомления через Telegram Bot API
      console.log(`Notification for event: ${event.title}`);
    }
    
    return res.status(200).json({ success: true, notified: events?.length || 0 });
  } catch (error) {
    console.error('Cron error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
```

Добавьте в Vercel переменную:
```
CRON_SECRET=your-random-secret-here
```

#### Вариант B: Отдельный сервер (для production)

```bash
# На сервере
cd /opt/flint-bot
git clone https://github.com/Artemewww/flint-live-in-moment.git
cd flint-live-in-moment/bot
npm install
cp .env.example .env
# Отредактируйте .env
pm2 start src/index.js --name flint-bot
pm2 startup
pm2 save
```

### 4. Настройка Telegram бота

1. Создайте бота через @BotFather
2. Получите токен
3. Добавьте в переменные окружения Vercel или в .env бота
4. Установите команды бота:
   ```
   /start - Главное меню
   /events - Ближайшие мероприятия
   /profile - Мой профиль
   /help - Помощь
   ```

### 5. Первый запуск

1. Откройте сайт: https://flint-live-in-moment.vercel.app
2. Откройте бота: @campsflint_bot
3. Нажмите /start в боте
4. Создайте мероприятие через админку (скрытая кнопка "Админ")
5. Протестируйте регистрацию

## Структура проекта

```
flint-live-in-moment/
├── src/                      # React frontend
│   ├── components/           # UI компоненты
│   ├── App.tsx              # Главный компонент
│   └── api.ts               # API клиент
├── public/
│   └── events.json          # Fallback данные
├── api/                      # Vercel Serverless Functions
│   ├── register.ts          # Регистрация
│   ├── events.ts            # События
│   ├── vote.ts              # Голосование
│   ├── interest.ts          # Интерес
│   ├── admin/
│   │   ├── events.ts        # Админка событий
│   │   └── registrations.ts # Админка заявок
│   └── cron/
│       └── notifications.ts # Уведомления
├── supabase/
│   └── schema.sql           # Схема БД
├── bot/                      # Telegram бот
│   ├── src/
│   │   ├── index.js         # Точка входа
│   │   ├── handlers/        # Обработчики
│   │   └── notifications.js # Уведомления
│   └── package.json
├── .env.example
├── vercel.json
└── package.json
```

## Переменные окружения

### Vercel (Frontend + API)
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
ADMIN_TOKEN=flint-admin-2026
TELEGRAM_BOT_TOKEN=7861573345:AAEoWtYZa_6rWJszayOQ-9pRjf1p5X2lM9A
CRON_SECRET=your-random-secret-here
```

### Bot (.env)
```
BOT_TOKEN=7861573345:AAEoWtYZa_6rWJszayOQ-9pRjf1p5X2lM9A
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
ADMIN_TOKEN=flint-admin-2026
ADMIN_CHAT_ID=123456789
WEB_APP_URL=https://flint-live-in-moment.vercel.app
```

## Проверка работоспособности

### Frontend
- [ ] Сайт открывается: https://flint-live-in-moment.vercel.app
- [ ] События загружаются из Supabase
- [ ] Регистрация работает
- [ ] Админка открывается (пароль: flint-admin-2026)
- [ ] Создание мероприятий работает

### Bot
- [ ] Бот отвечает на /start
- [ ] Показывает мероприятия через /events
- [ ] Регистрация проходит
- [ ] Уведомления отправляются

### API
- [ ] GET /api/events возвращает события
- [ ] POST /api/register создает заявку
- [ ] GET /api/admin/events работает с токеном
- [ ] Cron уведомлений работает

## Troubleshooting

**События не загружаются:**
- Проверьте SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY
- Убедитесь, что schema.sql выполнен
- Проверьте логи Vercel

**Бот не отвечает:**
- Проверьте BOT_TOKEN
- Убедитесь, что бот запущен
- Проверьте WEB_APP_URL

**Регистрация не работает:**
- Проверьте консоль браузера (F12)
- Проверьте логи Vercel
- Убедитесь, что Supabase настроен

## Следующие шаги

1. Настроить Supabase
2. Задеплоить на Vercel
3. Запустить бота на сервере
4. Протестировать все функции
5. Добавить реальные данные
6. Настроить мониторинг

## Поддержка

При возникновении проблем:
1. Проверьте логи Vercel
2. Проверьте логи бота
3. Проверьте консоль браузера
4. Убедитесь, что все переменные окружения настроены