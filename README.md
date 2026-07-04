# Живи в моменте — афиша событий + Telegram-бот

Интерактивная афиша и календарь мероприятий трезвого сообщества осознанного
общения (Минск, Беларусь). Работает как обычный сайт **и** как **Telegram
Mini App**, связанный с ботом [@LiveInMomentBot](https://t.me/LiveInMomentBot).

## Возможности

- 📅 Календарь и каталог мероприятий с фильтрами и архивом.
- 🔒 Жизненный цикл события: анонс «под замочком» → открытый набор → архив.
- 🤖 Связка с ботом: заявки с сайта уходят организатору в Telegram, а бот
  синхронизирует список событий с сайтом. См. [BOT_SETUP.md](./BOT_SETUP.md).
- 📱 Внутри Telegram сайт работает как Mini App: личность подтягивается
  автоматически, заявка подписывается и доставляется.

## Стек

Vite + React 19 + TypeScript + Tailwind v4 · Serverless-функции на Vercel.

## Запуск локально

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # продакшн-сборка в dist/
npm run lint       # проверка типов (tsc --noEmit)
```

## Структура

```
src/                 UI (React)
  data.ts            ← единый список мероприятий (источник правды)
  types.ts           типы + getEventPhase() (статусы событий)
  telegram.ts        обёртка над Telegram Mini App SDK
  api.ts             клиент /api/register
api/                 serverless-функции Vercel
  events.ts          GET  — список событий для бота
  register.ts        POST — заявка → в Telegram организатору
```

## Деплой на Vercel

Проект деплоится на Vercel как есть (Vite + `/api`). После деплоя задайте
переменные окружения `TELEGRAM_BOT_TOKEN` и `TELEGRAM_ADMIN_CHAT_ID`
и настройте кнопку Mini App у бота — подробности в [BOT_SETUP.md](./BOT_SETUP.md).
