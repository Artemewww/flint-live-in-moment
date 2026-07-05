import type { VercelRequest, VercelResponse } from '@vercel/node';
import * as crypto from 'crypto';

/**
 * Сигнал спроса: посетитель нажимает «Мне интересно» на мероприятии (особенно на
 * закрытом «под замочком»). Сигнал прилетает организаторам в группу заявок —
 * так видно, какие события хотят и что пора запускать/собирать.
 *
 * ENV: TELEGRAM_BOT_TOKEN, TELEGRAM_ADMIN_CHAT_ID (по умолчанию — группа заявок).
 */

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID || '-1003935660570';

function verifyName(initData: string): string | null {
  if (!initData || !BOT_TOKEN) return null;
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');
    const dcs = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    if (crypto.createHmac('sha256', secret).update(dcs).digest('hex') !== hash) return null;
    const u = JSON.parse(params.get('user') || '{}');
    return u.username ? `@${u.username}` : (u.first_name || `id${u.id}`);
  } catch {
    return null;
  }
}

function esc(s: string): string {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const { eventId, eventTitle, telegram, initData } = body;
  if (!eventId) return res.status(400).json({ ok: false, error: 'eventId обязателен' });

  const who = verifyName(initData) || telegram || 'Гость сайта';

  if (!BOT_TOKEN || !ADMIN_CHAT_ID) {
    return res.status(200).json({ ok: true, delivered: false });
  }

  const text =
    `🔵 <b>Спрос на мероприятие</b>\n\n` +
    `<b>${esc(eventTitle || eventId)}</b>\n` +
    `Хочет пойти: ${esc(who)}\n\n` +
    `<i>Чем больше «интересно» — тем выше приоритет запуска.</i>`;

  try {
    const tg = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: ADMIN_CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    }).then((r) => r.json());
    return res.status(200).json({ ok: true, delivered: Boolean(tg.ok) });
  } catch (err) {
    return res.status(200).json({ ok: true, delivered: false, message: (err as Error).message });
  }
}
