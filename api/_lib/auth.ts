import * as crypto from 'crypto';

/**
 * Админская авторизация. Файлы в api/, начинающиеся с «_», Vercel не считает
 * эндпоинтами — лимит в 12 функций не тратится.
 *
 * До этого пароль `flint-admin-2026` был захардкожен и в API, и во фронте,
 * то есть уезжал в публичный JS-бандл: любой мог открыть DevTools, забрать его
 * и получить полный доступ — рассылки, удаление событий, телефоны участников.
 *
 * Теперь:
 *  - секрет живёт только в env (ADMIN_TOKEN), фолбэка нет;
 *  - браузер получает подписанную httpOnly-куку и никогда не видит секрет;
 *  - заголовок Authorization остаётся для крона и служебных вызовов.
 */

const SECRET = process.env.ADMIN_TOKEN || '';
const COOKIE = 'flint_admin';
const TTL_MS = 12 * 60 * 60 * 1000;

/** Значение куки: <срок>.<подпись>. Подпись не даёт подделать срок. */
function sign(expiresAt: number): string {
  const mac = crypto.createHmac('sha256', SECRET).update(String(expiresAt)).digest('hex');
  return `${expiresAt}.${mac}`;
}

function verifyCookieValue(value: string): boolean {
  const [expRaw, mac] = String(value).split('.');
  const exp = Number(expRaw);
  if (!exp || !mac || Date.now() > exp) return false;
  const expected = crypto.createHmac('sha256', SECRET).update(String(exp)).digest('hex');
  // Сравнение постоянного времени — чтобы подпись нельзя было подобрать побайтово.
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function readCookie(req: any, name: string): string | null {
  const raw = req.headers?.cookie;
  if (!raw) return null;
  for (const part of String(raw).split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

/** Совпадает ли пароль с ADMIN_TOKEN. Пустой env = вход закрыт для всех. */
export function passwordMatches(password: string): boolean {
  if (!SECRET) return false;
  const a = Buffer.from(String(password || ''));
  const b = Buffer.from(SECRET);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Пускать ли этот запрос в админские эндпоинты. */
export function isAdmin(req: any): boolean {
  if (!SECRET) return false;

  const bearer = String(req.headers?.authorization || '').replace('Bearer ', '');
  if (bearer) {
    const a = Buffer.from(bearer);
    const b = Buffer.from(SECRET);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
  }

  const cookie = readCookie(req, COOKIE);
  return !!cookie && verifyCookieValue(cookie);
}

/** Заголовок Set-Cookie, выдающий сессию на 12 часов. */
export function sessionCookie(): string {
  const value = sign(Date.now() + TTL_MS);
  return `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${TTL_MS / 1000}`;
}

/** Заголовок Set-Cookie, гасящий сессию. */
export function clearCookie(): string {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

/** Единый ответ 401, чтобы не плодить формулировки. */
export function deny(res: any) {
  return res.status(401).json({ error: 'Unauthorized' });
}
