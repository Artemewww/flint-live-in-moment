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

    const inviteText =
      `✉️ <b>Тебя приглашают: ${esc(event?.title || 'событие FLINT')}</b>\n\n` +
      (event?.date_label ? `📆 ${esc(event.date_label)}\n` : '') +
      (event?.location ? `📍 ${esc(event.location)}\n` : '') +
      (event?.price_label ? `💰 ${esc(event.price_label)}\n` : '') +
      `\nОткрой карточку и запишись — место держим за тобой.`;

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
            (event?.price_label ? `\n💰 ${esc(event.price_label)}\n` : '') +
            `\n🔗 <a href="https://t.me/campsflint_bot?start=event_${eventId}">Открыть в боте</a>`);

    const site = `https://${req.headers['x-forwarded-host'] || req.headers.host || 'flint-live-in-moment.vercel.app'}`;

    /**
     * RSVP-режим: орг хочет точное число пришедших. Рассылаем ВСЕМ записанным
     * вопрос «Будешь или нет?» с кнопками ✅ Еду / ❌ Не смогу. Каждая кнопка
     * подтверждает/снимает участие в один тап (rsvpy_ → status='confirmed',
     * rsvpn_ → спрашивает причину и снимает). Это контрольный опрос: одного
     * запроса обычно достаточно, повтор — по кнопке в админке.
     */
    const markup = toPicked
      ? { inline_keyboard: [
          [{ text: '👀 Открыть и записаться', web_app: { url: `${site}/?ev=${encodeURIComponent(eventId)}` } }],
          [{ text: '✍️ Ответить', callback_data: 'usreply' }],
        ] }
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
    const photo = hasImage
      ? `${site}/api/events?action=image&id=${encodeURIComponent(eventId)}` +
        (event?.telegram_image ? '&kind=telegram' : '') +
        `&t=${Date.now()}`
      : '';
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
        .then((j) => ({ chatId, ok: j?.ok === true, code: j?.error_code, desc: j?.description }));

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

    return res.status(200).json({ ok: sent > 0, sent, total: ids.length, blocked: blocked.length, allRegistrations: total, breakdown });
  } catch (error) {
    return res.status(500).json({ ok: false, error: (error as Error).message });
  }
}
