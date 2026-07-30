import { createClient } from '@supabase/supabase-js';
import * as crypto from 'crypto';


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

function esc(s: string): string {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── Админская авторизация ───────────────────────────────────────────────
// Дублируется по файлам сознательно: Vercel не включает в бандл функции
// модули из папок на «_», а импорт из ../src роняет FUNCTION_INVOCATION_FAILED
// (PLAN.md §9). Тот же приём, что с mapEventToCamelCase.
//
// Секрет живёт только в env. Раньше здесь был фолбэк на строку-пароль, и она
// уезжала в публичный JS-бандл вместе с фронтом.
const ADMIN_SECRET = process.env.ADMIN_TOKEN || '';
const ADMIN_COOKIE = 'flint_admin';

function safeEq(a: string, b: string): boolean {
  const A = Buffer.from(String(a)), B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
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

/** Кука вида <срок>.<подпись>: подпись не даёт продлить срок вручную. */
function validSession(value: string): boolean {
  const [expRaw, mac] = String(value).split('.');
  const exp = Number(expRaw);
  if (!exp || !mac || Date.now() > exp) return false;
  return safeEq(mac, crypto.createHmac('sha256', ADMIN_SECRET).update(String(exp)).digest('hex'));
}

/** Пускать ли запрос: заголовок (крон, curl) или подписанная кука (браузер). */
function isAdmin(req: any): boolean {
  if (!ADMIN_SECRET) return false;
  const bearer = String(req.headers?.authorization || '').replace('Bearer ', '');
  if (bearer && safeEq(bearer, ADMIN_SECRET)) return true;
  const cookie = readCookie(req, ADMIN_COOKIE);
  return !!cookie && validSession(cookie);
}

function deny(res: any) {
  return res.status(401).json({ error: 'Unauthorized' });
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!isAdmin(req)) return deny(res);
  if (!BOT_TOKEN) return res.status(200).json({ ok: false, sent: 0, total: 0, error: 'TELEGRAM_BOT_TOKEN не задан в env' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const { eventId } = body;
    if (!eventId) return res.status(400).json({ error: 'Missing eventId' });

    // Событие — для дефолтного текста.
    const { data: event } = await supabase.from('events').select('*').eq('id', eventId).single();

    /**
     * audience='all'    — всем одобрённым членам клуба (анонс нового события);
     * audience='picked' — ТОЛЬКО выбранным в админке (персональное приглашение
     *                     на новое событие: закрытый состав, мужское, по интересам);
     * по умолчанию      — записанным на это событие.
     */
    const toAll = body.audience === 'all';
    const toPicked = body.audience === 'picked';
    let ids: number[];
    let total: number;
    if (toPicked) {
      // Список приходит с клиента, поэтому пересекаем его с реальной базой:
      // шлём только одобренным, не заблокированным и не отключившим бота.
      const wanted = Array.from(new Set(
        (Array.isArray(body.telegramIds) ? body.telegramIds : [])
          .map((v: unknown) => Number(v))
          .filter((id: number) => Number.isFinite(id) && id > 0)
      ));
      if (!wanted.length) return res.status(400).json({ error: 'Не выбран ни один участник' });
      const { data: members } = await supabase
        .from('members')
        .select('telegram_id, status, bot_active')
        .in('telegram_id', wanted);
      ids = (members || [])
        .filter((m: any) => m.status === 'approved' && m.bot_active !== false)
        .map((m: any) => Number(m.telegram_id));
      total = wanted.length;
    } else if (toAll) {
      const { data: members } = await supabase
        .from('members')
        .select('telegram_id, status, bot_active')
        .eq('status', 'approved');
      ids = Array.from(new Set(
        (members || [])
          .filter((m: any) => m.bot_active !== false)
          .map((m: any) => Number(m.telegram_id))
          .filter((id: number) => Number.isFinite(id) && id > 0)
      ));
      total = ids.length;
    } else {
      const { data: regs } = await supabase
        .from('registrations')
        .select('telegram_id, status')
        .eq('event_id', eventId)
        .neq('status', 'cancelled');
      let evIds = Array.from(new Set(
        (regs || [])
          .map((r: any) => Number(r.telegram_id))
          .filter((id: number) => Number.isFinite(id) && id > 0)
      ));
      // Исключаем заблокированных членов — им не должно приходить ничего.
      if (evIds.length) {
        const { data: blk } = await supabase.from('members').select('telegram_id').eq('status', 'blocked').in('telegram_id', evIds);
        const blocked = new Set((blk || []).map((m: any) => Number(m.telegram_id)));
        evIds = evIds.filter((id) => !blocked.has(id));
      }
      ids = evIds;
      total = ids.length;
    }

    if (ids.length === 0) {
      return res.status(200).json({
        ok: false,
        sent: 0,
        total,
        message: toPicked
          ? 'Никому не ушло: выбранные не одобрены в клубе или отключили бота.'
          : toAll
            ? 'В базе нет одобрённых членов с Telegram chat_id.'
            : 'Некому слать: ни у одного участника нет Telegram chat_id (регистрации только с сайта). Рассылка возможна тем, кто записался через бота.',
      });
    }

    const inviteText =
      `✉️ <b>Тебя приглашают: ${esc(event?.title || 'событие FLINT')}</b>\n\n` +
      (event?.date_label ? `📆 ${esc(event.date_label)}\n` : '') +
      (event?.location ? `📍 ${esc(event.location)}\n` : '') +
      (event?.price_label ? `💰 ${esc(event.price_label)}\n` : '') +
      `\nОткрой карточку и запишись — место держим за тобой.`;

    const text =
      body.message ||
      (toPicked
        ? inviteText
        : `🔔 <b>${esc(event?.title || 'Мероприятие FLINT')}</b>\n\n` +
          (event?.date_label ? `📆 ${esc(event.date_label)}\n` : '') +
          (event?.location ? `📍 ${esc(event.location)}\n` : '') +
          (event?.price_label ? `\n💰 ${esc(event.price_label)}\n` : '') +
          `\n🔗 <a href="https://t.me/campsflint_bot?start=event_${eventId}">Открыть в боте</a>`);

    // Приглашение ведёт в Mini App сразу на карточку события (deep-link ?ev=),
    // потому что регистрация в клубе идёт ТОЛЬКО через Mini App, не через чат.
    const site = `https://${req.headers['x-forwarded-host'] || req.headers.host || 'flint-live-in-moment.vercel.app'}`;
    const markup = toPicked
      ? { inline_keyboard: [
          [{ text: '👀 Открыть и записаться', web_app: { url: `${site}/?ev=${encodeURIComponent(eventId)}` } }],
          [{ text: '✍️ Ответить', callback_data: 'usreply' }],
        ] }
      : { inline_keyboard: [
          [{ text: '✅ Понял(а)', callback_data: `ack_${eventId}` }],
          [{ text: '✍️ Ответить', callback_data: 'usreply' }],
        ] };

    const results = await Promise.allSettled(
      ids.map((chatId) =>
        fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            // Подтверждение прочтения + возможность ответить на рассылку:
            // раньше вопрос по рассылке было некуда задать прямо из неё.
            reply_markup: markup,
          }),
        })
          .then((r) => r.json())
          .then((j) => ({ chatId, ok: j?.ok === true, code: j?.error_code, desc: j?.description }))
      )
    );

    const ok = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any>[];
    const sent = ok.filter((r) => r.value.ok).length;

    // Кто заблокировал бота — помечаем, чтобы счётчик «активных» не врал.
    const blocked = ok
      .filter((r) => !r.value.ok && (r.value.code === 403 || /blocked|deactivated/i.test(String(r.value.desc || ''))))
      .map((r) => r.value.chatId);
    if (blocked.length) {
      await supabase.from('members').update({ bot_active: false }).in('telegram_id', blocked);
    }

    return res.status(200).json({ ok: sent > 0, sent, total: ids.length, blocked: blocked.length, allRegistrations: total });
  } catch (error) {
    return res.status(500).json({ ok: false, error: (error as Error).message });
  }
}
