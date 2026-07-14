# 📋 Задачи для следующей модели

> **Контекст**: Проект flint-live-in-moment — Telegram Mini App для регистрации на события.  
> Код: TypeScript + React + Supabase + Vercel Serverless Functions.  
> Проведены улучшения безопасности и архитектуры (см. IMPROVEMENTS.md).

---

## 🔥 Критичные задачи

### 1. Убрать хардкод-пароль из фронтенда

**Файл**: `src/admin/AdminLayout.tsx`

**Проблема**: Пароль админки хранится в коде (`password === "строка"`), виден в публичном бандле.

**Что делать**:
```typescript
// Было:
if (password === "hardcoded_password") { ... }

// Должно быть:
const response = await fetch('/api/admin/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include', // чтобы кука сохранилась
  body: JSON.stringify({ password })
});

if (response.ok) {
  const { expiresAt } = await response.json();
  setIsAuthenticated(true);
}
```

**Результат**: Пароль проверяется только на сервере, фронтенд получает подписанную куку.

---

### 2. Добавить rate-limiting к `/api/admin/login`

**Файл**: `api/admin/login.ts`

**Что делать**:
```typescript
import { isRateLimited, getClientIp } from './_lib/ratelimit';

// В начале handler():
const clientIp = getClientIp(req);
if (isRateLimited(`admin-login:${clientIp}`, 3, 60 * 60 * 1000)) {
  return res.status(429).json({ 
    error: 'Слишком много попыток входа. Попробуйте через час.' 
  });
}
```

**Результат**: Защита от брутфорса (3 попытки в час).

---

## ⚠️ Важные задачи

### 3. Применить rate-limiting к публичным действиям

**Файлы**: `api/events.ts` (actions: vote, interest, feedback)

**Что делать**:
```typescript
// В handleVote(), handleInterest(), handleFeedback():
const clientIp = getClientIp(req);
if (isRateLimited(`vote:${clientIp}`, 10, 60 * 60 * 1000)) {
  return res.status(429).json({ error: 'Слишком много запросов' });
}
```

**Лимиты**:
- `vote`: 10 голосов/час
- `interest`: 5 кликов/час
- `feedback`: 3 отзыва/час

---

### 4. Структурированное логирование

**Цель**: Заменить разрозненные `console.log()` на единый формат.

**Создать**: `api/_lib/logger.ts`

```typescript
export function log(level: 'INFO' | 'WARN' | 'ERROR', message: string, meta?: any) {
  const timestamp = new Date().toISOString();
  console.log(JSON.stringify({ timestamp, level, message, ...meta }));
}

// Использование:
log('INFO', 'Registration created', { userId: 123, eventId: 'camp-summer' });
log('ERROR', 'Database error', { error: err.message });
```

**Применить в**: `api/register.ts`, `api/events.ts`, `api/telegram/webhook.ts`.

---

### 5. Проверить работу на staging

**Команды**:

```bash
# 1. Проверить, что легаси-код не импортируется
cd /Users/artdementiev/Desktop/00_Проекты/flint-live-in-moment
grep -r "from.*bot/" api/ src/

# 2. Задеплоить на Vercel
vercel --prod

# 3. Проверить rate-limiting
for i in {1..6}; do
  curl -X POST https://your-domain.vercel.app/api/register \
    -H "Content-Type: application/json" \
    -d '{"eventId":"test","name":"Test","telegram":"@test"}' \
    -w "\n%{http_code}\n"
done
# Ожидаем: 200 200 200 200 200 429

# 4. Проверить админ-вход
curl -X POST https://your-domain.vercel.app/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"password":"wrong"}' \
  -w "\nTime: %{time_total}s\n"
# Ожидаем: 401 через ~1 секунду (задержка против брутфорса)
```

---

## 💡 Желательные задачи

### 6. Unit-тесты для utils

**Файл**: `api/_lib/telegram.test.ts`

```typescript
import { verifyInitData, idFromHandle, escapeHtml } from './telegram';

describe('verifyInitData', () => {
  it('should reject invalid signature', () => {
    const result = verifyInitData('hash=fake&user={}', 'BOT_TOKEN');
    expect(result).toBeNull();
  });
});

describe('idFromHandle', () => {
  it('should generate stable negative ID', () => {
    const id1 = idFromHandle('testuser');
    const id2 = idFromHandle('testuser');
    expect(id1).toBe(id2);
    expect(id1).toBeLessThan(0);
  });
});
```

**Запуск**: `npm test` (настроить Jest/Vitest в `package.json`).

---

### 7. Мониторинг ошибок

**Цель**: Отслеживать баги в production.

**Варианты**:
- **Sentry**: `npm install @sentry/node`, добавить в `api/*.ts`
- **LogRocket**: для записи сессий пользователей
- **Vercel Analytics**: встроенный дашборд

**Пример** (Sentry):
```typescript
import * as Sentry from '@sentry/node';

Sentry.init({ dsn: process.env.SENTRY_DSN });

try {
  // ваш код
} catch (error) {
  Sentry.captureException(error);
  throw error;
}
```

---

## 📁 Структура изменённых файлов

```
api/
├── _lib/               # Новые общие модули
│   ├── telegram.ts     # ✅ Утилиты Telegram API
│   ├── ratelimit.ts    # ✅ Rate limiting
│   └── logger.ts       # TODO: создать
├── admin/
│   └── login.ts        # ✅ Серверный вход в админку
├── register.ts         # ✅ Обновлён (utils + rate-limit)
└── events.ts           # ✅ Обновлён (utils)

bot.legacy/             # ✅ Архив устаревшего кода
└── README_LEGACY.md

IMPROVEMENTS.md         # ✅ Полная документация улучшений
TODO_NEXT.md            # ✅ Этот файл
```

---

## 🚨 Известные риски

1. **In-memory rate limiter** не работает при нескольких инстансах Vercel Functions  
   → Для масштабирования переписать на **Redis** или **Vercel KV**

2. **Пароль админки** всё ещё в `.env` на Vercel  
   → Ротация через UI: Settings → Environment Variables

3. **Отсутствие логов в production**  
   → Подключить Sentry или настроить Vercel Log Drains

---

## ✅ Чеклист готовности к деплою

- [ ] Фронтенд (`src/admin/AdminLayout.tsx`) использует `/api/admin/login`
- [ ] Rate-limiting добавлен в `/api/admin/login` и `/api/events`
- [ ] Все тесты проходят (`npm test`)
- [ ] Проверен staging (`vercel --prod`)
- [ ] `ADMIN_TOKEN` установлен в Vercel Environment Variables
- [ ] `bot.legacy/` не импортируется нигде в коде

---

## 📞 Вопросы?

Читай `IMPROVEMENTS.md` для полного контекста.  
Если застрял — проверь логи: `vercel logs` или в Vercel Dashboard.

**Удачи!** 🚀
