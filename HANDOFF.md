# FLINT: Live in Moment — Передача проекта

## 📍 Путь к проекту

```
/Users/artdementiev/Desktop/00_Проекты/flint-live-in-moment
```

## 🚀 Быстрый старт

### 1. Клонирование
```bash
git clone https://github.com/Artemewww/flint-live-in-moment.git
cd flint-live-in-moment
```

### 2. Установка зависимостей
```bash
# Бот
cd bot && npm install && cd ..

# Веб-сайт + API
cd src && npm install && cd ..
```

### 3. Настройка переменных окружения
```bash
# Корень проекта
cp .env.example .env  # если есть пример
# Или создать .env вручную:
# SUPABASE_URL=https://lnaouwhywnppwnhijots.supabase.co
# SUPABASE_SERVICE_ROLE_KEY=<ключ из bot/.env>
# TELEGRAM_BOT_TOKEN=<токен бота>
# ADMIN_TOKEN=<секретный токен админки>
# VERCEL_URL=<url на vercel>
```

### 4. Локальный запуск
```bash
# Только API (Vercel)
cd src && npm run dev

# Только бот
cd bot && npm start
```

## 📦 Что уже работает

### ✅ Задеплоено на Vercel
- **Сайт**: https://flint-live-in-moment.vercel.app
- **API**: 10 Serverless Functions (лимит 12)
- **Админка**: логин/пароль, CRUD событий, управление участниками
- **Бот**: @campsflint_bot (работает на VPS)

### ✅ Реализованные функции
1. **Регистрация** — через бота или сайт, реферальные ссылки
2. **Питание** — анкета `/diet`, меню, ИИ-генерация, авторассылка
3. **Предпочтения** — `/preferences` (активности, сон, здоровье)
4. **Роли** — выбор ролей на событие (водитель, повар, медик и т.д.)
5. **Расписание** — ИИ-генерация с учётом погоды (Open-Meteo)
6. **Геймификация** — баллы, уровни, достижения
7. **Метрики** — конверсия, явка, средний чек
8. **Групповые чаты** — БД готова, создание через заглушку
9. **Логистика** — Smart Pooling (машины, палатки)
10. **Авторассылки** — меню за 1 день, напоминания

### ✅ Исправлено
- Онбординг: `/start` → проверка статуса → только одобренным открывается меню
- Меню 4 кнопки: 🏠 Афиша / 📅 Мои события / 👤 Профиль / ❓ Помощь
- Middleware проверки статуса для всех команд
- Удалены дублирующие функции `api/club.ts` и `api/my.ts` → объединены в `api/profile.ts`

## 🔧 Архитектура

### Serverless Functions (10/12)
1. `api/register.ts` — регистрация
2. `api/events.ts` — афиша для участников
3. `api/admin/events.ts` — CRUD событий, логин/логаут
4. `api/admin/registrations.ts` — заявки, участники, баллы
5. `api/admin/broadcast.ts` — рассылка в Telegram
6. `api/telegram/webhook.ts` — webhook для бота
7. `api/telegram/setup.ts` — установка webhook
8. `api/ai.ts` — ИИ-генерация (Gemini)
9. `api/profile.ts` — **универсальный** (питание, предпочтения, роли, чаты, погода, расписание, метрики)
10. `api/cron/reminders.ts` — автоматические напоминания

### База данных (Supabase)
- `members` — участники (расширена: баллы, уровень, достижения, аллергии, предпочтения)
- `events` — события
- `registrations` — заявки
- `event_menus` — меню
- `event_schedules` — расписание
- `event_roles` — роли участников
- `event_chats` — групповые чаты
- `points_log` — журнал баллов
- `achievements` — достижения

### Telegram бот
- **Фреймворк**: Grammy
- **Хендлеры**: `bot/src/handlers/*.js`
- **Команды**: `/start`, `/events`, `/profile`, `/diet`, `/preferences`, `/help`
- **Polling** (не webhook) — работает на VPS

## ⚠️ Что нужно доделать

### Критично (срочно)
1. **Перезапустить бота на VPS** — код обновился, но бот не перезапущен
   ```bash
   cd /путь/до/flint-live-in-moment && git pull origin main && bash scripts/deploy.sh
   ```
   Или команда `fletport` (если это pm2/systemctl)

2. **Почистить битых пользователей** — в админке появился "новичок" без имени
   - Выполнить SQL в Supabase:
   ```sql
   DELETE FROM members WHERE first_name IS NULL OR first_name = '' OR first_name = 'Пользователь';
   DELETE FROM registrations WHERE telegram_id NOT IN (SELECT telegram_id FROM members);
   DELETE FROM event_roles WHERE telegram_id NOT IN (SELECT telegram_id FROM members);
   DELETE FROM points_log WHERE telegram_id NOT IN (SELECT telegram_id FROM members);
   ```

### Важно (ближайшие релизы)
3. **Реальные групповые чаты** — сейчас заглушка, нужно создавать через Telegram API
4. **ИИ-планировщик** — полная автоматизация программы, меню, логистики
5. **Продвинутая логистика** — пешие маршруты, интеграция с картами
6. **Управление сном** — тихие/активные часы, размещение по палаткам

### Желательно
7. **Автоматическое распределение ролей** — ИИ предлагает оптимальное распределение
8. **Геймификация 2.0** — челленджи, уровни, награды
9. **Внешние интеграции** — бронирование, оплата, страховка
10. **Webhook для бота** — вместо polling (снижает нагрузку)

## 🛠 Технические детали

### Vercel
- **План**: Hobby (максимум 12 Serverless Functions)
- **Использовано**: 10/12
- **Запас**: 2 функции
- **Автодеплой**: при пуше в `main`

### VPS (бот)
- **Деплой**: `scripts/deploy.sh`
- **Процесс**: pm2 / systemctl / docker / node
- **Логи**: `bot/bot.log`

### Supabase
- **URL**: https://lnaouwhywnppwnhijots.supabase.co
- **Ключ**: в `.env` (не коммитить!)
- **Миграции**: `supabase/migrations/`

## 📝 Правила разработки

### Serverless Functions
- **МАКСИМУМ 12** — не создавать новые без согласования
- **Все новые фичи** → в существующие файлы (`api/profile.ts`, `api/admin/*.ts`)

### База данных
- **Все изменения** → через миграции в `supabase/migrations/`
- **Никаких** ALTER TABLE в коде

### Код
- **TypeScript** для API
- **JavaScript** для бота
- **Коммиты** → `git push origin main`
- **Тестирование** → перед коммитом

## 🐛 Известные баги

1. **Бот не перезапущен** — код обновился, но бот на VPS старой версии
2. **Битые пользователи** — есть записей с пустым `first_name` в статусе `pending_review`
3. **Групповые чаты** — заглушка, не создаёт реальные чаты

## 📞 Контакты

- **GitHub**: https://github.com/Artemewww/flint-live-in-moment
- **Веб**: https://flint-live-in-moment.vercel.app
- **Бот**: @campsflint_bot

## 🎯 Приоритеты

1. Перезапустить бота на VPS
2. Почистить битых пользователей
3. Протестировать все команды бота
4. Реализовать реальные групповые чаты
5. ИИ-планировщик

---

**Последнее обновление**: 14.07.2026, 21:40  
**Версия**: 1.0  
**Статус**: Передача проекта