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
  // ADMIN_SECRET — для крона/curl. Браузер и Mini App шлют СЕССИОННЫЙ токен
  // (тот же exp.mac, что в куке): в Mini App кука SameSite=Strict не доходит,
  // поэтому заголовок — единственный рабочий путь.
  if (bearer && (safeEq(bearer, ADMIN_SECRET) || validSession(bearer))) return true;
  const cookie = readCookie(req, ADMIN_COOKIE);
  return !!cookie && validSession(cookie);
}

function deny(res: any) {
  return res.status(401).json({ error: 'Unauthorized' });
}

/**
 * Цена строкой для приглашений. «Взнос отсутствует» врал, когда каждый
 * платит за себя на месте (баня во «Фристайле»). Зеркало priceTag из
 * src/types.ts — серверу клиентский модуль не импортировать.
 */
function costLineOf(ev: any): string {
  const lg = ev?.logistics || {};
  const est = Number(lg.costEstimate) > 0 ? Number(lg.costEstimate) : 0;
  // Пригласительные клуба: показываем и «рыночную» цену — в ней вся ценность.
  if (lg.costModel === 'club_invite') {
    const seats = Number(lg.clubSeats) > 0 ? Math.round(Number(lg.clubSeats)) : 0;
    const market = String(lg.marketPrice || '').trim();
    return `бесплатно по пригласительному клуба${seats ? ` (${seats} мест)` : ''}${market ? ` · обычный билет ${market}` : ''}`;
  }
  if (ev?.price_type === 'paid' && Number(ev?.price_amount) > 0) return `${ev.price_amount} BYN`;
  switch (lg.costModel) {
    case 'self': return est ? `≈${est} BYN, каждый платит за себя` : 'Каждый платит за себя';
    case 'pool': return est ? `≈${est} BYN, общий взнос` : 'Общий взнос';
    case 'food_share': return est ? `≈${est} BYN, еда вскладчину` : 'Еда вскладчину';
    case 'bring_own': return 'Каждый везёт своё';
  }
  if (ev?.price_type === 'paid') return String(ev?.price_label || 'Платно');
  return 'Бесплатно';
}

/**
 * Кнопки персонального приглашения: ответ в один тап. Каждое нажатие бот
 * пишет в event_invites — отсюда воронка в админке (кто открыл, кто что
 * ответил) и дожим «подумаю» через пару дней.
 */
function inviteMarkup(eventId: string) {
  return { inline_keyboard: [
    [{ text: '✅ Буду', callback_data: `inv_y_${eventId}` }, { text: '🤔 Подумаю', callback_data: `inv_m_${eventId}` }],
    [{ text: '❌ Не смогу', callback_data: `inv_n_${eventId}` }],
    [{ text: '👀 Подробнее о событии', callback_data: `inv_o_${eventId}` }],
  ] };
}

/** Строка «ценности» для приглашения: цена без клуба, места, спонсор. */
function valueLineOf(ev: any): string {
  const lg = ev?.logistics || {};
  if (lg.costModel !== 'club_invite') return '';
  const seats = Number(lg.clubSeats) > 0 ? Math.round(Number(lg.clubSeats)) : 0;
  const market = String(lg.marketPrice || '').trim();
  const sponsor = String(lg.clubSponsor || '').trim();
  // Имя спонсора — через тире, без склонения: «при поддержке Артём Дементьев»
  // резало глаз, а падеж по имени автоматически не угадать.
  return `💎 ${market ? `Билет стоит <b>${esc(market)}</b> → ` : ''}для тебя <b>бесплатно</b>\n` +
    `🎟 ${seats ? `${seats} именных пригласительных` : 'Пригласительные'} от клуба${sponsor ? ` · партнёр — ${esc(sponsor)}` : ''}\n`;
}

/** Статистика приглашений события: воронка + список людей с ответами. */
async function inviteStats(eventId: string) {
  const { data: inv, error } = await supabase
    .from('event_invites')
    .select('telegram_id,sent_at,delivered,error,opened_at,answer,answered_at,reminded_at,remind_count')
    .eq('event_id', eventId).order('sent_at', { ascending: false });
  if (error) return { ok: false, needsMigration: /event_invites/i.test(error.message), error: error.message };
  const ids = (inv || []).map((r: any) => Number(r.telegram_id));
  const names = new Map<number, any>();
  const regs = new Map<number, string>();
  if (ids.length) {
    const { data: ms } = await supabase.from('members').select('telegram_id,first_name,username').in('telegram_id', ids);
    for (const m of ms || []) names.set(Number((m as any).telegram_id), m);
    const { data: rs } = await supabase.from('registrations').select('telegram_id,status').eq('event_id', eventId).in('telegram_id', ids);
    for (const r of rs || []) regs.set(Number((r as any).telegram_id), String((r as any).status || ''));
  }
  const people = (inv || []).map((r: any) => {
    const m = names.get(Number(r.telegram_id)) || {};
    const reg = regs.get(Number(r.telegram_id));
    return {
      telegramId: Number(r.telegram_id),
      name: m.first_name || (m.username ? '@' + m.username : `id${r.telegram_id}`),
      username: m.username || '',
      sentAt: r.sent_at, delivered: !!r.delivered, error: r.error || '',
      openedAt: r.opened_at, answer: r.answer || null, answeredAt: r.answered_at,
      remindedAt: r.reminded_at, remindCount: Number(r.remind_count) || 0,
      registered: !!reg && reg !== 'cancelled',
    };
  });
  const n = (f: (p: any) => boolean) => people.filter(f).length;
  return {
    ok: true,
    summary: {
      sent: people.length,
      delivered: n((p) => p.delivered),
      opened: n((p) => !!p.openedAt || !!p.answer),
      yes: n((p) => p.answer === 'yes'),
      maybe: n((p) => p.answer === 'maybe'),
      no: n((p) => p.answer === 'no'),
      silent: n((p) => p.delivered && !p.answer),
      registered: n((p) => p.registered),
    },
    people,
  };
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  // Статистика приглашений — GET, всё остальное — POST.
  if (req.method === 'GET' && req.query?.action === 'invite_stats') {
    if (!isAdmin(req)) return deny(res);
    const eventId = String(req.query?.eventId || '');
    if (!eventId) return res.status(400).json({ error: 'Missing eventId' });
    return res.status(200).json(await inviteStats(eventId));
  }
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
     * ДОЖИМ ПО ВОРОНКЕ вручную: «подумаю» и/или молчащим — ещё раз, с теми же
     * кнопками. Автоматически то же делает крон (api/cron/reminders.ts).
     */
    if (body.action === 'invite_remind') {
      const target: 'maybe' | 'silent' | 'both' = ['maybe', 'silent'].includes(body.target) ? body.target : 'both';
      const { data: inv, error } = await supabase.from('event_invites')
        .select('telegram_id,answer,delivered,remind_count').eq('event_id', eventId);
      if (error) return res.status(200).json({ ok: false, error: 'Нет таблицы event_invites — примени миграцию 2026-10-event-invites.sql' });
      const ids = (inv || []).filter((r: any) =>
        (target !== 'silent' && r.answer === 'maybe') || (target !== 'maybe' && !r.answer && r.delivered),
      ).map((r: any) => Number(r.telegram_id));
      let sent = 0;
      for (const id of ids) {
        const prev = (inv || []).find((r: any) => Number(r.telegram_id) === id) as any;
        const text = prev?.answer === 'maybe'
          ? `🤔 <b>Ты хотел подумать про «${esc(event?.title || 'событие')}»</b>\n\n` +
            (event?.date_label ? `📆 ${esc(event.date_label)}\n` : '') + valueLineOf(event) +
            `\nРешил? Ответь одной кнопкой — организатору важно понимать, сколько нас.`
          : `👋 <b>Напоминаю про «${esc(event?.title || 'событие')}»</b>\n\n` +
            (event?.date_label ? `📆 ${esc(event.date_label)}\n` : '') +
            (event?.location ? `📍 ${esc(event.location)}\n` : '') + valueLineOf(event) +
            `\nТы ещё не ответил. Будешь? Одна кнопка 👇`;
        try {
          const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: id, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: inviteMarkup(eventId) }),
          });
          const j = await r.json();
          if (j?.ok) {
            sent++;
            await supabase.from('event_invites').update({
              reminded_at: new Date().toISOString(), remind_count: (Number(prev?.remind_count) || 0) + 1,
              message_id: j.result?.message_id ?? null,
            }).eq('event_id', eventId).eq('telegram_id', id);
          }
        } catch { /* следующий */ }
      }
      return res.status(200).json({ ok: true, sent, total: ids.length });
    }

    /**
     * audience='all'    — всем одобрённым членам клуба (анонс нового события);
     * audience='picked' — ТОЛЬКО выбранным в админке (персональное приглашение
     *                     на новое событие: закрытый состав, мужское, по интересам);
     * по умолчанию      — записанным на это событие.
     */
    const toAll = body.audience === 'all';
    const toPicked = body.audience === 'picked';
    // Объявлено здесь, а не у текста ниже: от режима зависит выборка получателей.
    const rsvpMode = body.rsvp === true;
    let ids: number[];
    let total: number;
    /** Почему получателей меньше, чем людей в базе (для честного отчёта в админке). */
    let breakdown: { base: number; reach: number; notApproved: number; botOff: number; blocked: number } | null = null;
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
      // Берём ВСЮ базу, а не только approved: организатор видит «в базе 72,
      // ушло 40» и не понимает, куда делись остальные. Теперь возвращаем
      // разбор по причинам — кто не одобрен, кто отключил бота, кто в бане.
      const { data: members } = await supabase
        .from('members')
        .select('telegram_id, status, bot_active');
      const all = (members || []).filter((m: any) => Number(m.telegram_id) > 0);
      const approved = all.filter((m: any) => m.status === 'approved');
      ids = Array.from(new Set(
        approved
          .filter((m: any) => m.bot_active !== false)
          .map((m: any) => Number(m.telegram_id))
      ));
      breakdown = {
        base: all.length,
        reach: ids.length,
        notApproved: all.filter((m: any) => m.status !== 'approved' && m.status !== 'blocked').length,
        botOff: approved.filter((m: any) => m.bot_active === false).length,
        blocked: all.filter((m: any) => m.status === 'blocked').length,
      };
      total = ids.length;
    } else {
      /**
       * RSVP-рассылка уходит ВСЕМ записанным, включая status='cancelled'.
       *
       * Раньше здесь стоял безусловный .neq('status','cancelled'), и это ломало
       * сам смысл второго тура: кнопка «❌ Не смогу» в webhook (состояние
       * rsvp_reason) ставит именно 'cancelled'. То есть фильтр выбрасывал из
       * повторного опроса ровно тех, кто уже ответил и мог бы передумать —
       * передумать. На практике это значило: в админке «разослали всем», а у части
       * людей кнопки «Еду» не было никогда — они молча выпали из обсуждения.
       * У обычного анонса фильтр остаётся: звать отказавшегося незачем.
       */
      let rq = supabase.from('registrations').select('telegram_id, status').eq('event_id', eventId);
      if (!rsvpMode) rq = rq.neq('status', 'cancelled');
      const { data: regs } = await rq;
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
        breakdown,
        message: toPicked
          ? 'Никому не ушло: выбранные не одобрены в клубе или отключили бота.'
          : toAll
            ? 'В базе нет одобрённых членов с Telegram chat_id.'
            : 'Некому слать: ни у одного участника нет Telegram chat_id (регистрации только с сайта). Рассылка возможна тем, кто записался через бота.',
      });
    }

    // Счётчик мест на момент отправки — «осталось 5 из 8» подталкивает ответить сразу.
    const cap = Number(event?.max_participants) || 0;
    let seatsLine = '';
    if (cap) {
      const { count: taken } = await supabase.from('registrations').select('id', { count: 'exact', head: true })
        .eq('event_id', eventId).neq('status', 'cancelled');
      const left = Math.max(0, cap - (taken || 0));
      seatsLine = left > 0 ? `⏳ Свободно <b>${left} из ${cap}</b> — места за теми, кто ответит первым\n` : `⏳ Места закончились — ответь «Буду», поставлю в лист ожидания\n`;
    }
    const isClubInvite = (event?.logistics || {}).costModel === 'club_invite';
    const inviteText =
      `✉️ <b>Тебя приглашают: ${esc(event?.title || 'событие FLINT')}</b>\n\n` +
      (event?.date_label ? `📆 ${esc(event.date_label)}\n` : '') +
      (event?.location ? `📍 ${esc(event.location)}\n` : '') +
      // Для пригласительных цена — в строке ценности, иначе она дублировалась.
      (isClubInvite ? valueLineOf(event) : `💰 ${esc(costLineOf(event))}\n`) +
      seatsLine +
      `\nОтветь одной кнопкой 👇`;

    /**
     * Блок «кто уже подтвердил». Считается ОДИН раз до отправки и подставляется
     * в текст каждому: «уже едут 5 — Артём, Дима, …». Он отвечает на главный
     * вопрос RSVP-а («а я там один буду?») и заметно поднимает число нажатий
     * «Еду». Если подтвердивших нет — обратный стимул: «будь первым».
     */
    let socialLine = '';
    if (rsvpMode) {
      // ВНИМАНИЕ на имена колонок: в registrations есть только `name`,
      // а в members — `first_name`/`last_name`/`username`. Раньше здесь стояли
      // registrations.participant_name и members.name; обеих колонок в базе
      // нет, PostgREST отвечал 400, и блок молча превращался в «никто не
      // подтвердил» даже при трёх подтверждениях.
      const { data: confirmed } = await supabase
        .from('registrations')
        .select('telegram_id, name')
        .eq('event_id', eventId)
        .eq('status', 'confirmed');
      const cIds = [...new Set((confirmed || []).map((r: any) => Number(r.telegram_id)).filter((x: number) => x > 0))];
      const names: string[] = [];
      if (cIds.length) {
        const { data: mem } = await supabase
          .from('members').select('telegram_id, first_name, username').in('telegram_id', cIds);
        const byId = new Map<number, any>((mem || []).map((m: any) => [Number(m.telegram_id), m]));
        // Имена нужны живые, а не заглушки: в базе реально встречаются «🤷🏾‍♂️»
        // и прочая живопись в поле имени. Такое в список «кто уже едет» не
        // годится — счётчик-то покажем, а вот читать будет нечего.
        const letters = (s: string) => /\p{L}/u.test(s);
        for (const tid of cIds) {
          const reg: any = (confirmed || []).find((r: any) => Number(r.telegram_id) === tid);
          const m: any = byId.get(tid) || {};
          // Только имя без фамилии: «Артём, Дима, Катя» читаются в одну строку.
          const first = String(m.first_name || reg?.name || '').trim().split(/\s+/)[0] || '';
          if (first && letters(first)) {
            names.push(first[0].toUpperCase() + first.slice(1));
          } else if (m.username) {
            names.push('@' + m.username);
          }
        }
      }
      const shown = names.slice(0, 8);
      const tail = names.length > shown.length ? ` и ещё ${names.length - shown.length}` : '';
      socialLine = cIds.length
        ? `\n\n👥 Уже подтвердили участие: <b>${cIds.length}</b>${shown.length ? ` — ${esc(shown.join(', '))}${esc(tail)}` : ''}.\n⏳ Ждём твоего ответа.`
        : `\n\nПока никто не подтвердил — будь первым, кто ответит 👇`;
    }

    const text =
      body.message ||
      (toPicked
        ? inviteText
        : rsvpMode
          ? `✅ <b>Подтверждение участия — «${esc(event?.title || 'Мероприятие FLINT')}»</b>\n\n` +
            (event?.date_label ? `📆 ${esc(event.date_label)}\n` : '') +
            (event?.location ? `📍 ${esc(event.location)}\n` : '') +
            (event?.price_label ? `💰 ${esc(event.price_label)}\n` : '') +
            `\nПодтверди, что ты точно будешь — так организаторы посчитают места, закупку и транспорт.\n\nНажми одну кнопку 👇` +
            // Счётчик и имена подтвердивших. Приклеиваем только к СВОЕМУ тексту:
            // если организатор написал сообщение руками, не лезем в его слова.
            socialLine
          : `🔔 <b>${esc(event?.title || 'Мероприятие FLINT')}</b>\n\n` +
            (event?.date_label ? `📆 ${esc(event.date_label)}\n` : '') +
            (event?.location ? `📍 ${esc(event.location)}\n` : '') +
            `\n💰 ${esc(costLineOf(event))}\n` +
            `\n🔗 <a href="https://t.me/campsflint_bot?start=event_${eventId}">Открыть в боте</a>`);

    const site = `https://${req.headers['x-forwarded-host'] || req.headers.host || 'flint-live-in-moment.vercel.app'}`;

    /**
     * RSVP-режим: орг хочет точное число пришедших. Рассылаем ВСЕМ записанным
     * вопрос «Будешь или нет?» с кнопками ✅ Еду / ❌ Не смогу. Каждая кнопка
     * подтверждает/снимает участие в один тап (rsvpy_ → status='confirmed',
     * rsvpn_ → спрашивает причину и снимает). Это контрольный опрос: одного
     * запроса обычно достаточно, повтор — по кнопке в админке.
     */
    // Персональное приглашение — с ответом в один тап и учётом в воронке.
    // Если организатор написал свой текст, кнопки те же: статистика нужна всегда.
    const markup = toPicked
      ? inviteMarkup(String(eventId))
      : rsvpMode
        ? { inline_keyboard: [
            [{ text: '✅ Еду', callback_data: `rsvpy_${eventId}` }],
            [{ text: '❌ Не смогу', callback_data: `rsvpn_${eventId}` }],
            [{ text: '✍️ Ответить', callback_data: 'usreply' }],
          ] }
        : { inline_keyboard: [
            [{ text: '✅ Понял(а)', callback_data: `ack_${eventId}` }],
            [{ text: '✍️ Ответить', callback_data: 'usreply' }],
          ] };

    /**
     * Рассылка идёт КАРТИНОЙ, а не голым текстом. Раньше уходил только текст, и
     * сообщение «Будешь точно?» — самый важный вопрос по событию — выглядело
     * в чате как серый служебный текст без афиши, мимо которой невозможно
     * пролистать. Тот же приём, что в webhook.sendEventCard: афиша лежит в БД
     * как data-URL (Telegram её не тянет), поэтому отдаём байтами через
     * публичный прокси /api/events?action=image. Один URL на всю рассылку —
     * Telegram скачает картинку один раз, а не по разу на участника.
     */
    const hasImage = !!(event?.telegram_image || event?.image);
    // Картинка уже в Storage — отдаём её адрес напрямую: Telegram качает с
    // Supabase, мимо защиты Vercel от ботов, которая отвечала ему 403.
    const directImg = [event?.telegram_image, event?.image]
      .map((x: any) => String(x || ''))
      .find((x: string) => /^https:\/\/[^/]+\.supabase\.co\/storage\//.test(x)) || '';
    const photo = !hasImage ? ''
      : directImg || (`${site}/api/events?action=image&id=${encodeURIComponent(eventId)}` +
        (event?.telegram_image ? '&kind=telegram' : '') +
        `&t=${Date.now()}`);
    // У sendPhoto лимит подписи — 1024 символа, у sendMessage — 4096. Наш текст
    // короткий, но список имён может подпихнуть его через край.
    const caption = text.length > 1000 ? `${text.slice(0, 999)}…` : text;

    /** Один запрос в Telegram. photo → sendPhoto, иначе → sendMessage. */
    const call = (method: 'sendPhoto' | 'sendMessage', chatId: number, payload: any) =>
      fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
        .then((r) => r.json())
        .then((j) => ({ chatId, ok: j?.ok === true, code: j?.error_code, desc: j?.description, messageId: j?.result?.message_id ?? null }));

    const results = await Promise.allSettled(
      ids.map((chatId) =>
        (hasImage
          ? call('sendPhoto', chatId, {
              chat_id: chatId,
              photo,
              caption,
              parse_mode: 'HTML',
              disable_web_page_preview: true,
              // Подтверждение прочтения + возможность ответить на рассылку:
              // раньше вопрос по рассылке было некуда задать прямо из неё.
              reply_markup: markup,
            })
          // Страховка: если картинка не отдалась (удалена с CDN, битая афиша),
          // не теряем сам вопрос — отправляем его текстом.
          : Promise.resolve({ chatId, ok: false, code: 0, desc: 'no photo' })
        ).then((r) => (r.ok ? r : call('sendMessage', chatId, {
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          reply_markup: markup,
        })))
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

    /**
     * Учёт приглашений: строка на каждого получателя — дошло или нет и с
     * каким message_id. Таблицы может не быть до миграции — тогда рассылка
     * всё равно ушла, а админка подскажет применить SQL.
     */
    let tracking = false;
    if (toPicked) {
      const now = new Date().toISOString();
      const rows = ok.map((r) => ({
        event_id: String(eventId), telegram_id: r.value.chatId, invited_by: 'admin', sent_at: now,
        delivered: !!r.value.ok, error: r.value.ok ? null : String(r.value.desc || r.value.code || 'ошибка').slice(0, 200),
        message_id: r.value.messageId,
      }));
      if (rows.length) {
        const { error: trErr } = await supabase.from('event_invites').upsert(rows, { onConflict: 'event_id,telegram_id' });
        tracking = !trErr;
      }
    }

    return res.status(200).json({ ok: sent > 0, sent, total: ids.length, blocked: blocked.length, allRegistrations: total, breakdown, tracking });
  } catch (error) {
    return res.status(500).json({ ok: false, error: (error as Error).message });
  }
}
