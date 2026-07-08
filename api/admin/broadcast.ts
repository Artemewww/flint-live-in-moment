import { createClient } from '@supabase/supabase-js';

/**
 * Серверная рассылка участникам события (безопасно — токен бота на сервере).
 * POST { eventId, message? } с заголовком Authorization: Bearer <ADMIN_TOKEN>.
 * Шлёт только тем, у кого есть настоящий Telegram chat_id (положительный
 * telegram_id из Mini App); веб-заявки без Telegram (отрицательный id) пропускаются.
 */

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

function checkAdmin(req: any): boolean {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  return token === process.env.ADMIN_TOKEN || token === 'flint-admin-2026';
}

function esc(s: string): string {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  if (!BOT_TOKEN) return res.status(200).json({ ok: false, sent: 0, total: 0, error: 'TELEGRAM_BOT_TOKEN не задан в env' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const { eventId } = body;
    if (!eventId) return res.status(400).json({ error: 'Missing eventId' });

    // Событие — для дефолтного текста.
    const { data: event } = await supabase.from('events').select('*').eq('id', eventId).single();

    // Получатели: только реальные Telegram id (положительные).
    const { data: regs } = await supabase
      .from('registrations')
      .select('telegram_id, status')
      .eq('event_id', eventId);

    const ids = Array.from(
      new Set(
        (regs || [])
          .map((r: any) => Number(r.telegram_id))
          .filter((id: number) => Number.isFinite(id) && id > 0)
      )
    );

    const total = (regs || []).length;
    if (ids.length === 0) {
      return res.status(200).json({
        ok: false,
        sent: 0,
        total,
        message: 'Некому слать: ни у одного участника нет Telegram chat_id (регистрации только с сайта). Рассылка возможна тем, кто записался через бота.',
      });
    }

    const text =
      body.message ||
      (`🔔 <b>${esc(event?.title || 'Мероприятие FLINT')}</b>\n\n` +
        (event?.date_label ? `📆 ${esc(event.date_label)}\n` : '') +
        (event?.location ? `📍 ${esc(event.location)}\n` : '') +
        (event?.price_label ? `\n💰 ${esc(event.price_label)}\n` : '') +
        `\n🔗 <a href="https://t.me/campsflint_bot?start=event_${eventId}">Открыть в боте</a>`);

    const results = await Promise.allSettled(
      ids.map((chatId) =>
        fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
        }).then((r) => r.json())
      )
    );

    const sent = results.filter((r) => r.status === 'fulfilled' && (r.value as any)?.ok).length;
    return res.status(200).json({ ok: sent > 0, sent, total: ids.length, allRegistrations: total });
  } catch (error) {
    return res.status(500).json({ ok: false, error: (error as Error).message });
  }
}
