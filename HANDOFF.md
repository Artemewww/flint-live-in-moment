# FLINT: Live in Moment — Передача проекта

> **⚡ ДЛЯ СЛЕДУЮЩЕГО ИИ-АГЕНТА: НАЧНИ С СЕКЦИИ «ПЕРЕДАЧА СЕССИИ» В КОНЦЕ ФАЙЛА.**
> Там актуальный статус (14.07.2026), что сделано, что осталось и как здесь работать.

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

### 1. Бот работает через webhook на Vercel — перезапуск VPS НЕ нужен

**Проверено 14.07.2026**: `getWebhookInfo` показывает, что у бота установлен webhook
`https://flint-live-in-moment.vercel.app/api/telegram/webhook` (код: `api/telegram/webhook.ts`),
очередь апдейтов пустая — бот живой и работает на актуальном коде из main
(Vercel автодеплоит каждый push).

VPS с polling-ботом (папка `bot/`, `scripts/deploy.sh`) — легаси-путь: пока установлен
webhook, polling через getUpdates заблокирован Telegram (ошибка 409). Если процесс
на VPS ещё крутится, его можно остановить (`pm2 stop flint-bot`), чтобы не жёг ресурсы.
Вернуться на polling: удалить webhook (`api/telegram/setup.ts` / deleteWebhook) и
запустить бота на VPS через `scripts/deploy.sh`.

### 2. Почистить битых пользователей в БД — УЖЕ СДЕЛАНО

**Проверено 14.07.2026**: в `members` (8 записей) нет пользователей с пустым именем
или именем «Пользователь», в `registrations` нет записей-сирот. Таблиц `event_roles`
и `points_log` в схеме БД не существует — SQL ниже оставлен на случай, если битые
пользователи появятся снова (строки про несуществующие таблицы пропускать).

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
Фактические таблицы (сверено с живой схемой 14.07.2026):
- `members` — участники (расширена: баллы, уровень, достижения, аллергии, предпочтения)
- `events`, `registrations` — события и заявки
- `event_menus`, `menu_votes` — меню и голосования по меню
- `event_changes`, `event_change_acknowledgments` — изменения событий
- `polls`, `poll_votes`, `program_votes` — опросы и голосования
- `payment_requests`, `payment_contributions` — оплаты
- `rides`, `ride_requests`, `ride_bookings` — попутки
- `gear_inventory`, `tasks`, `interests`, `referrals`, `feedback` — снаряжение, задачи, интересы, рефералы, фидбек
- `community_guidelines`, `guideline_acceptances`, `safety_memos` — правила и безопасность
- `bot_sessions` — сессии бота

⚠️ Таблиц `event_schedules`, `event_roles`, `event_chats`, `points_log`, `achievements` НЕТ —
баллы/уровни/достижения хранятся в колонках `members`.

### Telegram бот
- **Фреймворк**: Grammy
- **Хендлеры**: `bot/src/handlers/*.js`
- **Команды**: `/start`, `/events`, `/profile`, `/diet`, `/preferences`, `/help`
- **Webhook на Vercel** (`api/telegram/webhook.ts`) — polling на VPS отключён самим фактом установленного webhook

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

1. ~~Бот не перезапущен~~ — неактуально: бот работает через webhook на Vercel, код всегда из main
2. ~~Битые пользователи~~ — проверено 14.07.2026, БД чистая
3. **Групповые чаты** — заглушка, не создаёт реальные чаты

---

## 📋 Чек-лист приёма

- [ ] Клонировать репозиторий
- [ ] Установить зависимости (`npm install`)
- [ ] Настроить `.env` с ключами
- [x] ~~Перезапустить бота на VPS~~ — не нужно, бот на webhook (Vercel)
- [x] Почистить битых пользователей в БД — уже чисто (14.07.2026)
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

---

## 🔄 ПЕРЕДАЧА СЕССИИ (для следующего ИИ-агента, 14.07.2026 23:15)

### Как здесь работать
- Цикл: правка → `npx tsc --noEmit` → `npx esbuild api/<файл> --bundle --platform=node --outfile=/dev/null --external:@supabase/supabase-js` → `npm run build` (если трогал фронт) → commit → `git push origin main` → Vercel автодеплоит за ~60-80 сек.
- **Лимит Vercel: 12 Serverless Functions, занято 11.** Новые файлы в `api/` НЕ создавать — новые фичи добавлять action'ами в существующие (`api/profile.ts`, `api/telegram/webhook.ts`).
- Бот живёт в `api/telegram/webhook.ts` (webhook на Vercel). Папка `bot/` — ЛЕГАСИ (polling для VPS), не работает и не используется; код оттуда можно брать как референс.
- **Ловушка**: в webhook.ts секция кнопочного меню обёрнута в `if (!text.startsWith('/'))` — слэш-команды туда не доходят, их обработка ниже, рядом с `/profile`.
- Vercel Security Checkpoint режет curl к прод-домену. Тестовые апдейты боту слать `fetch`-ем из браузерной вкладки самого сайта (или проверять через побочные эффекты в Supabase REST).
- БД: DDL недоступен без Dashboard. Реальные таблицы — см. секцию «База данных» выше (обновлена по живой схеме). Таблиц `event_roles`, `points_log`, `event_chats`, `event_schedules`, `achievements` НЕ существует.

### Сделано в сессии 14.07.2026 (все коммиты в main, задеплоено)
1. `e8cf75e` — **восстановлены потерянные API-экшены** `profile`/`apply` в `api/profile.ts` + `gate` возвращён к правильной семантике (blocked/pending, вход по реф-коду); фронт переключён с мёртвого `/api/club` на `/api/profile`. Проверено на проде.
2. `c312257` + `c0d4c45` — **команды бота** `/events` `/help` `/diet` `/preferences` (раньше «Не понял»). Хелперы: `sendEventsList`, `sendHelp`, `sendDietPrompt`, `sendPreferencesPrompt`. Callback'и `dietset:`/`prefset:` пишут в `members.dietary`/`members.prefs`. `setMyCommands` зарегистрирован. Владелец подтвердил скриншотом.
3. `69c2afa` — **групповые чаты событий**: костяк создаёт группу, добавляет бота админом, пишет `/link` → выбор события → инвайт-ссылка сохраняется в `events.telegram_bot_url` → кнопка «💬 Чат события» в карточке бота, после записи и в вебе (EventDetailModal). Бот в группах молчит (guard). Владелец проверил в реальной группе — работает.
4. `664f30d` — **новое меню бота по UX-аудиту**: 🏠 Главная / 🗓 Мои события / 👤 Профиль / ❓ Помощь. «Мои события» — записи с кнопкой отмены (`regcancel_`). Старые тексты кнопок работают. Хелперы: `sendWelcome`, `sendMyEvents`.
5. `d706529` — HANDOFF.md актуализирован (webhook вместо polling, реальная схема БД, чистка БД не нужна — уже чистая).

### Сделано 15.07.2026 (Этап 1 ТЗ — безопасность)
- `7e4e81a` — **афиша закрыта на сервере**: GET /api/events → 403 без подписанного initData участника (заголовок `X-Telegram-Init-Data`, status approved/is_core) или валидного `?ref=`. Фронт на 403 не фолбэчит, `public/events.json` обнулён (светил реальные события публично). Выключатель: `GATE_ENABLED=0`. Закоммичено наследие прошлой сессии: серверный логин админки (`admin/events?action=login`, httpOnly-кука), bot/→bot.legacy/, аудит-доки. Удалён дубль `api/admin/login.ts` → 10/12 функций.
- `3206f3b` — **⚠️ КРИТИЧЕСКИЙ УРОК: импорты из `api/_lib/` роняют функции на Vercel в рантайме** (FUNCTION_INVOCATION_FAILED; локальные tsc/esbuild НЕ ловят). Хелперы (verifyInitData/escapeHtml/rate-limit) намеренно задублированы инлайном в events.ts и register.ts — НЕ выносить в общие файлы. После пуша проверять прод fetch'ем из браузерной вкладки сайта.
- `1007eda` — таймер баннера: `% 65` → `% 60`.
- Проверено на проде: без авторизации 403, с реф-кодом 200 и афиша рендерится, register жив.

### Сделано 15.07.2026 (вечер)
- `d1b2698` — записанному в боте больше не предлагается «Записаться» (показывает «✅ Ты записан» + «❌ Отказаться»); участники везде считаются из registrations — админка/сайт/бот теперь показывают одно число (колонка participants_count — легаси, не использовать).

### ЗАДАЧА: Медиа-галерея события (СПРОЕКТИРОВАНА, НЕ РЕАЛИЗОВАНА)
Спека владельца: после события участники сдают фото/видео; общая галерея с голосованием; через 7 дней остаётся только топ, остальное удаляется; смотреть удобно с телефона; уложиться в лимиты (Supabase free: 500MB БД / 1GB Storage).

**Принятые проектные решения** (SQL-миграция готова: `supabase/migrations/20260715_event_media.sql` — владелец должен вставить её в Supabase Dashboard → SQL Editor, DDL из кода недоступен):
1. **Файлы храним В TELEGRAM (file_id), не в Supabase** — ноль затрат на хранилище, в БД только метаданные (~200 байт/файл). Таблицы: `event_media` (file_id, file_unique_id для дедупа, votes, is_keeper), `event_media_votes` (PK media_id+telegram_id — один голос).
2. **Сбор**: после события cron-рассылка «Как прошло?» получает кнопку «📸 Прислать фото/видео» → bot_sessions state `media_upload_<eventId>` → webhook принимает message.photo / message.video при активной сессии, пишет file_id. Лимиты: 30 файлов/чел/событие, 300/событие.
3. **Галерея**: веб-страница `GET /api/events?action=gallery&id=<eventId>` (HTML как og-страница, мобайл-фёрст, лениво грузит фото). Фото отдаются через `action=media&fid=` — функция СТРИМИТ содержимое через getFile. ⚠️ НЕ делать redirect на telegram file URL — путь файла содержит BOT TOKEN. Видео на веб не стримить (лимит ответа ~4.5MB) — показывать превью и deep-link в бота.
4. **Голос**: тап по фото в галерее → POST `action=media_vote` c initData (только участники клуба); votes инкрементится, upsert в event_media_votes.
5. **Чистка**: в `api/cron/reminders.ts` (cron уже настроен, 9:00 daily): для событий с date+7дн < сегодня — пометить топ-5 по votes `is_keeper=true`, удалить остальные строки (файлы у людей в Telegram остаются). Топ-5, не топ-3 — метаданные бесплатны, а истории события 5 кадров лучше.

### СЛЕДУЮЩАЯ ЗАДАЧА: ИИ-планировщик «Auto-Director» (НЕ НАЧАТ)
Спецификация от владельца — MVP:
- **Команда `/plan <текст>` в личке бота, только для костяка** (`isCore`). Пример: «Нужно выбраться на скалы в следующие выходные, человек 10».
- **Context Fetch**: members (first_name, dietary, allergies, prefs jsonb, cooking_skills, points), registrations с `has_transport`/`transport_seats` (машины!), gear_inventory (пока пустая), открытые events.
- **Составление сценария через Gemini**: ключ `GEMINI_API_KEY` в env; в `api/ai.ts` есть паттерн вызова (SDK `@google/genai`, ранжирование flash-моделей). Для webhook проще прямой REST: `POST https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent?key=...`.
- **Выход**: черновик сценария организатору — состав, распределение по машинам, роли (Driver/Chef/Navigator/Аптечка), чек-лист снаряжения, таймлайн, черновики персональных сообщений участникам. Plain text (НЕ HTML — ИИ ломает парсер), чанковать по 3800 символов (лимит Telegram 4096).
- **V2 (потом)**: авторассылка персональных задач после «Утвердить», интеграция с админкой, ресурсные матрицы по gear_inventory.
- Таймаут Vercel-функции ~10 сек — использовать flash-модель, промпт компактный.

### ЗАДАЧА: Инвентарь и шаринг снаряжения (ВИДЕНИЕ ВЛАДЕЛЬЦА, не начато)
Спека от 15.07.2026 (голосом): профиль ресурсов участника живёт в БД между событиями:
1. **Постоянный инвентарь** — машина (мест), велосипед (тип), палатка и т.д. Один раз указал — база помнит; на новом событии человек лишь подтверждает «еду на машине / без машины» (сломалась → отменяет и ищет попутку). Данные уже частично есть: rides, registrations.has_transport, gear_inventory (пустая).
2. **+1 участники** — «еду с женой/ребёнком (возраст!), у неё тоже велосипед» — незарегистрированные спутники с их снаряжением учитываются в ресурсах события.
3. **Шаринг**: если на событии кому-то не хватает (велосипед/палатка), а у едущего участника ресурс числится свободным — бот сам предлагает владельцу поделиться.
4. **Бонусы**: за шаринг — баллы (members.points). Придумать шкалу и другие поощряемые действия.
Частично закрыто 15.07: дубли машин/палаток невозможны (одна активная на человека на событие, повтор = корректировка), «Отменить поездку» уже был (ridecancel_).

### Остальной бэклог (из UX-аудита владельца, по приоритету)
- Бейджи уведомлений и подтверждения действий (undo) в боте.
- Экспорт события в календарь (ics уже есть в вебе — `buildIcsDataUri` в EventDetailModal, добавить в бота).
- AI-рекомендации событий по интересам; наглядное голосование за программу.
- Спойлеры для длинных текстов бота, кастомные эмодзи.
- Хардкод-токен админки во фронте (`AdminPanel.tsx`, `flint-admin-2026`) — известная дыра, вынести на сервер.

### Доступы
Все ключи — в `.env` в корне проекта (не в git). Supabase project: `lnaouwhywnppwnhijots`. Бот: @campsflint_bot. Vercel: artemewww/flint-live-in-moment. Костяк в БД: telegram_id 377551019.

**Последнее обновление**: 14.07.2026, 23:15  
**Версия**: 2.0  
**Статус**: Передан, бэклог описан выше