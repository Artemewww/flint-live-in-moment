/**
 * Простой in-memory rate limiter для защиты от спама.
 * Для production лучше использовать Redis, но для малых нагрузок достаточно.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Флаг для ленивой инициализации очистки (только один таймер на все инстансы)
let cleanupScheduled = false;

// Ленивая инициализация очистки при первом использовании
function scheduleCleanup() {
  if (cleanupScheduled) return;
  cleanupScheduled = true;
  
  // Очистка старых записей каждые 5 минут
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store.entries()) {
      if (entry.resetAt < now) {
        store.delete(key);
      }
    }
  }, 5 * 60 * 1000);
}

/**
 * Проверяет rate limit для данного ключа.
 * 
 * @param key - уникальный идентификатор (IP, telegram_id, etc.)
 * @param limit - максимум запросов
 * @param windowMs - окно в миллисекундах
 * @returns true если лимит превышен, false если можно продолжать
 */
export function isRateLimited(key: string, limit: number, windowMs: number): boolean {
  // Запускаем очистку при первом использовании
  scheduleCleanup();
  
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || entry.resetAt < now) {
    // Первый запрос или окно истекло — сбрасываем счётчик
    store.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }

  if (entry.count >= limit) {
    // Лимит превышен
    return true;
  }

  // Увеличиваем счётчик
  entry.count++;
  return false;
}

/**
 * Получает информацию о текущем лимите.
 */
export function getRateLimitInfo(key: string): { count: number; resetAt: number } | null {
  const entry = store.get(key);
  if (!entry || entry.resetAt < Date.now()) return null;
  return { count: entry.count, resetAt: entry.resetAt };
}

/**
 * Извлекает IP-адрес из запроса (с учётом Vercel прокси).
 */
export function getClientIp(req: any): string {
  return (
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.headers['x-real-ip'] ||
    req.connection?.remoteAddress ||
    'unknown'
  );
}
