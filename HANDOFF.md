# FLINT: Live in Moment — Передача проекта

## 📍 Путь к проекту

```
/Users/artdementiev/Desktop/00_Проекты/flint-live-in-moment
```

**GitHub**: https://github.com/Artemewww/flint-live-in-moment

---

## 🚀 Инструкция для нового разработчика (Cloud Code)

### Шаг 1: Клонирование проекта
```bash
git clone https://github.com/Artemewww/flint-live-in-moment.git
cd flint-live-in-moment
```

### Шаг 2: Установка зависимостей
```bash
# Бот
cd bot && npm install && cd ..

# Веб-сайт + API
cd src && npm install && cd ..
```

### Шаг 3: Настройка переменных окружения
```bash
# Создать .env в корне проекта
cat > .env << 'EOF'
SUPABASE_URL=https://lnaouwhywnppwnhijots.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxuYW91d2h5d25wcHduaGlqb3RzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MzUwMzY1NCwiZXhwIjoyMDk5MDc5NjU0fQ.1fxhmyQTMJ5kZEkkV8N-q-SUtHHQ0dZ3KYsnoUH0wes
TELEGRAM_BOT_TOKEN=<получить у @BotFather>
ADMIN_TOKEN=<придумать секретный токен>
VERCEL_URL=https://flint-live-in-moment.vercel.app
GEMINI_API_KEY=<ключ Google Gemini>
EOF
```

### Шаг 4: Локальный запуск
```bash
# Только API (Vercel)
cd src && npm run dev

# Только бот (в другом терминале)
cd bot && npm start
```

---

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

---

## ⚠️ КРИТИЧЕСКИ ВАЖНО: Что нужно сделать СРОЧНО

### 1. Перезапустить бота на VPS (ОБЯЗАТЕЛЬНО)

Бот работает на VPS, код обновился, но бот не перезапущен. Без этого изменения не вступят в силу.

**Вариант A** (если есть доступ к VPS):
```bash
# Подключиться к VPS
ssh user@your-vps-ip

# Перейти в проект
cd /путь/до/flint-live-in-moment

# Обновить код
git pull origin main

# Перезапустить бота
bash scripts/deploy.sh
```

**Вариант B** (если команда `fletport`):
```bash
fletport
```

**Вариант C** (если pm2):
```bash
pm2 restart flint-bot
```

**Вариант D** (если systemctl):
```bash
systemctl restart flint-bot
```

### 2. Почистить битых пользователей в БД (ОБЯЗАТЕЛЬНО)

В админке появился "новичок" без имени. Нужно удалить всех пользователей с пустым `first_name` и статусом `pending_review`.

**Способ A**: Через Supabase Dashboard (рекомендуется)
1. Зайти в https://supabase.com/dashboard/project/lnaouwhywnppwnhijots
2. SQL Editor → выполнить:

```sql
-- Удалить битых пользователей
DELETE FROM members WHERE first_name IS NULL OR first_name = '' OR first_name = 'Пользователь';

-- Почистить связанные данные
DELETE FROM registrations WHERE telegram_id NOT IN (SELECT telegram_id FROM members);
DELETE FROM event_roles WHERE telegram_id NOT IN (SELECT telegram_id FROM members);
DELETE FROM points_log WHERE telegram_id NOT IN (SELECT telegram_id FROM members);
```

**Способ B**: Через Node.js скрипт
```bash
cd /Users/artdementiev/Desktop/00_Проекты/flint-live-in-moment
node -e "
require('dotenv').config({ path: require('path').join(__dirname, 'bot/.env') });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function clean() {
  const { data: broken } = await supabase.from('members').select('id,telegram_id').or('first_name.is.null,first_name.eq.\"\",first_name.eq.Пользователь');
  if (broken?.length > 0) {
    const ids = broken.map(b => b.id);
    await supabase.from('members').delete().in('id', ids);
    console.log('Удалено:', ids.length);
  }
}
clean();
"
```

---

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

---

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

---

## 🐛 Известные баги

1. **Бот не перезапущен** — код обновился, но бот на VPS старой версии
2. **Битые пользователи** — есть записей с пустым `first_name` в статусе `pending_review`
3. **Групповые чаты** — заглушка, не создаёт реальные чаты

---

## 📋 Чек-лист приёма

- [ ] Клонировать репозиторий
- [ ] Установить зависимости (`npm install`)
- [ ] Настроить `.env` с ключами
- [ ] Перезапустить бота на VPS
- [ ] Почистить битых пользователей в БД
- [ ] Протестировать `/start` в боте
- [ ] Протестировать `/events`, `/profile`, `/diet`, `/preferences`
- [ ] Проверить админку (логин/пароль)
- [ ] Проверить метрики в админке

---

## 📞 Контакты

- **GitHub**: https://github.com/Artemewww/flint-live-in-moment
- **Веб**: https://flint-live-in-moment.vercel.app
- **Бот**: @campsflint_bot
- **Supabase**: https://supabase.com/dashboard/project/lnaouwhywnppwnhijots

---

**Последнее обновление**: 14.07.2026, 21:41  
**Версия**: 1.0  
**Статус**: Готов к передаче