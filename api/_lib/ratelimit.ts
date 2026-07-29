/**
 * In-memory rate limiter для Vercel serverless.
 * Хранит счётчики в Map (сбрасывается при перезапуске функции).
 * Для production поверх Vercel Edge Config / Upstash Redis.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

/** Простой rate-limiter: не более `limit` запросов за `windowMs` миллисекунд. */
export function checkRateLimit(key: string, limit: number, windowMs: number): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now >= entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, resetAt: now + windowMs };
  }

  if (entry.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count += 1;
  return { allowed: true, remaining: limit - entry.count, resetAt: entry.resetAt };
}

/** Очистка просроченных записей (вызывать периодически). */
export function cleanExpired(): number {
  const now = Date.now();
  let cleaned = 0;
  for (const [key, entry] of store) {
    if (now >= entry.resetAt) {
      store.delete(key);
      cleaned++;
    }
  }
  return cleaned;
}

/** Сброс всех счётчиков (для тестов). */
export function resetStore(): void {
  store.clear();
}