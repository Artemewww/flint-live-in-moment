import type { VercelRequest, VercelResponse } from '@vercel/node';
import * as crypto from 'crypto';

/**
 * Мост «сайт → бот»: заявка на участие, отправленная с сайта или из
 * Telegram Mini App, доставляется организатору прямо в Telegram.
 *
 * Переменные окружения (задаются в Vercel → Project → Settings → Env):
 *   TELEGRAM_BOT_TOKEN     — токен бота от @BotFather (обязателен для доставки).
 *   TELEGRAM_ADMIN_CHAT_ID — chat_id администратора или группы заявок.
 *
 * Если переменные не заданы, эндпоинт не падает: возвращает delivered:false,
 * а сайт показывает пользователю успех (данные сохранены локально).
 */

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
// chat_id группы заявок (не секрет). Env-переменная переопределяет значение.
// Текущая группа: «ARTDEMENTIEV.BY & Кемпс» (супергруппа).
const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID || '-1003935660570';

interface RegistrationBody {
  eventId?: string;
  eventTitle?: string;
  name?: string;
  telegram?: string;
  phone?: string;
  inviter?: string;
  source?: string;
  initData?: string;
}

/**
 * Проверка подписи Telegram WebApp initData (защита от подделки заявок
 * якобы «из Telegram»). Возвращает пользователя, если подпись валидна.
 */
function verifyTelegramInitData(initData: string, botToken: string): {
  valid: boolean;
  user?: { id: number; first_name?: string; username?: string };
} {
  if (!initData || !botToken) return { valid: false };
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return { valid: false };
    params.delete('hash');

    const dataCheckString = [...params.entries()]
      .map(([k, v]) => `${k}=${v}`)
      .sort()
      .join('\n');

    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const computed = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    if (computed !== hash) return { valid: false };

    const userRaw = params.get('user');
    const user = userRaw ? JSON.parse(userRaw) : undefined;
    return { valid: true, user };
  } catch {
    return { valid: false };
  }
}

function escapeHtml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const body: RegistrationBody =
    typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};

  const { eventId, eventTitle, name, telegram, phone, inviter, source, initData } = body;

  if (!eventId || !inviter) {
    res.status(400).json({ ok: false, error: 'eventId и inviter обязательны' });
    return;
  }

  // Проверяем подпись, если заявка пришла из Mini App.
  let verifiedNote = 'вне Telegram (веб-форма)';
  if (initData) {
    const check = verifyTelegramInitData(initData, BOT_TOKEN);
    if (check.valid && check.user) {
      const uname = check.user.username ? `@${check.user.username}` : `id ${check.user.id}`;
      verifiedNote = `✅ Telegram подтверждён (${escapeHtml(uname)})`;
    } else if (BOT_TOKEN) {
      verifiedNote = '⚠️ Подпись Telegram не прошла проверку';
    }
  }

  // Если бот не настроен — принимаем заявку, но не доставляем.
  if (!BOT_TOKEN || !ADMIN_CHAT_ID) {
    res.status(200).json({
      ok: true,
      delivered: false,
      message: 'Заявка принята. Доставка в Telegram включится после настройки токена бота.',
    });
    return;
  }

  const text =
    `🟢 <b>Новая заявка на участие</b>\n\n` +
    `<b>Событие:</b> ${escapeHtml(eventTitle || eventId)}\n` +
    `<b>Имя:</b> ${escapeHtml(name || '—')}\n` +
    `<b>Telegram:</b> ${escapeHtml(telegram || '—')}\n` +
    `<b>Телефон:</b> ${escapeHtml(phone || '—')}\n` +
    `<b>Пригласил:</b> ${escapeHtml(inviter)}\n` +
    `<b>Источник:</b> ${escapeHtml(source || 'website')}\n` +
    `<b>Верификация:</b> ${verifiedNote}\n` +
    `<b>Событие ID:</b> <code>${escapeHtml(eventId)}</code>`;

  try {
    const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: ADMIN_CHAT_ID,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    const tgData = await tgRes.json();

    if (!tgData.ok) {
      res.status(200).json({
        ok: true,
        delivered: false,
        message: `Telegram API: ${tgData.description || 'ошибка отправки'}`,
      });
      return;
    }

    res.status(200).json({ ok: true, delivered: true, message: 'Заявка доставлена организатору.' });
  } catch (err) {
    res.status(200).json({ ok: true, delivered: false, message: (err as Error).message });
  }
}
