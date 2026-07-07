# Состояние проекта Flint Live in Moment

## Текущий статус
- **GitHub репозиторий**: https://github.com/Artemewww/flint-live-in-moment
- **Vercel деплой**: https://flint-live-in-moment.vercel.app
- **Последний коммит**: df4f83a (упрощенная админка)

## Архитектура
- **Frontend**: React + Vite + TypeScript
- **Backend**: Vercel Serverless Functions (api/ папка)
- **Данные**: public/events.json (статический JSON)

## Как обновлять мероприятия
1. Отредактировать `public/events.json`
2. Закоммитить и запушить на GitHub
3. Vercel автоматически пересоберет сайт

## Админка
- Кнопка "Админ" в навигации (скрыта, opacity 10%)
- Пароль: `flint-admin-2026`
- Сохраняет в localStorage (локально)

## Для Google Sheets интеграции (требуется настройка)
1. Создать Google таблицу
2. Добавить переменные в Vercel:
   - `GOOGLE_SHEET_ID`
   - `GOOGLE_SERVICE_ACCOUNT_CREDENTIALS`
   - `ADMIN_TOKEN`

## Telegram бот
- @campsflint_bot
- Токен хранится в Vercel Environment Variables

## Структура проекта
```
flint-live-in-moment/
├── src/           # React компоненты
├── public/        # Статические файлы (events.json)
├── api/           # Serverless функции
├── shared/        # Общие данные
└── package.json   # Зависимости
```

## Следующие шаги
1. Дождаться обновления Vercel (1-2 минуты)
2. Проверить работу сайта
3. При необходимости - настроить Google Sheets API