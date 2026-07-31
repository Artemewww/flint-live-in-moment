# 📋 Задачи для следующей модели

> **Контекст**: Проект flint-live-in-moment — Telegram Mini App для регистрации на события.  
> Код: TypeScript + React + Supabase + Vercel Serverless Functions.  
> Проведены улучшения безопасности и архитектуры (см. IMPROVEMENTS.md).

---

## ✅ Сделано на сессии 31.07.2026

### 1. Исправлена кнопка "Вступить через бот" (не перенаправляла)
**Файл**: `src/App.tsx` (строка ~639)
**Проблема**: Ссылка `https://t.me/campsflint_bot` вела на бота без deep-link параметра. Пользователь попадал в бота, но не понимал что делать дальше.
**Решение**: Добавлен параметр `?start=apply` — теперь бот сразу открывает анкету вступления.

### 2. Исправлена аудитория клуба (не работала)
**Файлы**: `src/components/AdminPanel.tsx`, `api/admin/events.ts`
**Проблема**: При входе через Telegram (`handleTelegramLogin`) токен сессии не сохранялся в `localStorage`. Функция `adminFetch` не могла аутентифицировать запросы к `/api/admin/registrations?action=members` — сервер возвращал 401.
**Решение**: 
- В `handleTelegramLogin` добавлено сохранение `j.token` в `localStorage` (ключ `flint_admin_token`)
- В `handleWebTelegramLogin` добавлено сохранение `j.token` в `localStorage`
- Сервер `weblogin_check` теперь возвращает `token` в ответе (раньше только ставил куку)

### 3. Исправлена переписка (не работала)
**Файлы**: те же, что и для аудитории
**Проблема**: Та же — отсутствие токена в `localStorage` → `adminFetch` → 401.
**Решение**: То же — токен теперь сохраняется при любом способе входа.

### 4. Исправлен инвентарь (не отображался)
**Файлы**: те же, что и для аудитории
**Проблема**: Та же — отсутствие токена в `localStorage` → `adminFetch` → 401.
**Решение**: То же — токен теперь сохраняется при любом способе входа.

---

## 🔥 Критичные задачи (остались)

### 1. Убрать хардкод-пароль из фронтенда
**Файл**: `src/admin/AdminLayout.tsx` (если существует) или проверить `AdminPanel.tsx`
**Проблема**: Пароль админки может храниться в коде, виден в публичном бандле.
**Что делать**: Проверить, что пароль проверяется только на сервере через `/api/admin/events?action=login`.

### 2. Добавить rate-limiting к `/api/admin/login`
**Файл**: `api/admin/events.ts`
**Что делать**: Rate-limiting уже реализован в `login` и `login_telegram` (3 и 8 попыток соответственно). Проверить работу.

---

## ⚠️ Важные задачи

### 3. Применить rate-limiting к публичным действиям
**Файлы**: `api/events.ts` (actions: vote, interest, feedback)
**Что делать**: Rate-limiting уже частично реализован. Проверить и дополнить.

### 4. Структурированное логирование
**Цель**: Заменить разрозненные `console.log()` на единый формат.
**Создать**: `api/_lib/logger.ts`
**Статус**: Не сделано.

### 5. Проверить работу на staging
**Команды**:
```bash
cd /Users/artdementiev/Desktop/00_Проекты/flint-live-in-moment
vercel --prod
```

---

## 💡 Желательные задачи

### 6. Unit-тесты для utils
**Файл**: `api/_lib/telegram.test.ts`
**Статус**: Не сделано.

### 7. Мониторинг ошибок (Sentry / Vercel Analytics)
**Статус**: Не сделано.

---

## 📁 Структура изменённых файлов (сессия 31.07.2026)

```
api/admin/
├── events.ts            # ✅ weblogin_check возвращает token
src/components/
├── AdminPanel.tsx       # ✅ handleTelegramLogin сохраняет token
│                        # ✅ handleWebTelegramLogin сохраняет token
src/
├── App.tsx              # ✅ Кнопка "Вступить через бот" → ?start=apply
TODO_NEXT.md             # ✅ Этот файл (обновлён)
```

---

## 🚨 Известные риски

1. **In-memory rate limiter** не работает при нескольких инстансах Vercel Functions  
   → Для масштабирования переписать на **Redis** или **Vercel KV**

2. **Пароль админки** всё ещё в `.env` на Vercel  
   → Ротация через UI: Settings → Environment Variables

3. **Отсутствие логов в production**  
   → Подключить Sentry или настроить Vercel Log Drains

4. **Таблица `club_assets`** может отсутствовать в БД  
   → Накатить миграцию `supabase/migrations/2026-club-assets.sql`

5. **Таблица `support_messages`** может отсутствовать в БД  
   → Накатить миграцию `supabase/migrations/2026-support-messages.sql`

---

## ✅ Чеклист готовности к деплою

- [x] Фронтенд сохраняет токен при входе через Telegram
- [x] Сервер `weblogin_check` возвращает токен
- [x] Кнопка "Вступить через бот" ведёт на `?start=apply`
- [ ] Все тесты проходят (`npm test`)
- [ ] Проверен staging (`vercel --prod`)
- [ ] `ADMIN_TOKEN` установлен в Vercel Environment Variables
- [ ] Миграции `club_assets` и `support_messages` накатаны в Supabase

---

## 📞 Вопросы?

Читай `IMPROVEMENTS.md` для полного контекста.  
Если застрял — проверь логи: `vercel logs` или в Vercel Dashboard.

**Удачи!** 🚀