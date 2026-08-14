import { createClient } from '@supabase/supabase-js';
import * as crypto from 'crypto';

// Хелперы задублированы с api/events.ts НАМЕРЕННО: общий api/_lib/ роняет
// функции на Vercel в рантайме (FUNCTION_INVOCATION_FAILED — импорт соседнего
// файла не резолвится в собранной функции). Не выносить обратно.

/** Подпись Telegram WebApp initData → достоверный telegram_id. */
// Свежесть: без auth_date перехваченная initData годна вечно (replay). Окно 24ч.
const INITDATA_MAX_AGE_SEC = 24 * 60 * 60;

function verifyInitData(initData: string, botToken: string): { id: number; username?: string; first_name?: string } | null {
  if (!initData || !botToken) return null;
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');
    const dcs = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const expected = crypto.createHmac('sha256', secret).update(dcs).digest('hex');
    const a = Buffer.from(expected), b = Buffer.from(hash);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const authDate = Number(params.get('auth_date') || 0);
    if (!authDate || (Date.now() / 1000 - authDate) > INITDATA_MAX_AGE_SEC) return null;
    const u = JSON.parse(params.get('user') || '{}');
    return u && u.id ? u : null;
  } catch {
    return null;
  }
}

/** Стабильный отрицательный id из ника — для веб-заявок без Telegram. */
function idFromHandle(handle: string): number {
  let hash = 0;
  for (let i = 0; i < handle.length; i++) {
    hash = (hash * 31 + handle.charCodeAt(i)) | 0;
  }
  return -Math.abs(hash) - 1;
}

function escapeHtml(text: string): string {
  return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// In-memory rate limit. Без setInterval: serverless-инстансы замораживаются,
// таймеры бессмысленны — чистим просроченные ключи при каждом обращении.
const rlStore = new Map<string, { count: number; resetAt: number }>();
function isRateLimited(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  for (const [k, e] of rlStore) if (e.resetAt < now) rlStore.delete(k);
  const e = rlStore.get(key);
  if (!e) { rlStore.set(key, { count: 1, resetAt: now + windowMs }); return false; }
  if (e.count >= limit) return true;
  e.count++;
  return false;
}

function getClientIp(req: any): string {
  return (
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.headers['x-real-ip'] ||
    req.connection?.remoteAddress ||
    'unknown'
  );
}

/**
 * Регистрация на мероприятие.
 * 1) upsert участника в members (telegram_id — ВСЕГДА число: реальный id из
 *    Telegram initData, либо число из ника, либо стабильный отрицательный хеш
 *    ника — чтобы веб-заявки без Telegram тоже сохранялись и не конфликтовали
 *    с реальными Telegram-id);
 * 2) insert заявки в registrations по БЕЛОМУ СПИСКУ колонок (без лишних полей);
 * 3) доставка уведомления организатору в группу заявок (best-effort).
 */

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID || '-1003935660570';

/** Структурированный лог: одна JSON-строка на событие — greppable в Vercel. */
function slog(level: 'info' | 'warn' | 'error', msg: string, err?: any) {
  const line: any = { t: new Date().toISOString(), level, scope: 'register', msg };
  if (err !== undefined) line.err = err?.message || String(err);
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(JSON.stringify(line));
}

/** IP клиента за прокси Vercel. Дублируется по файлам (импорт из _lib роняет функции). */
function clientIp(req: any): string {
  const xf = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || String(req.headers?.['x-real-ip'] || '') || 'unknown';
}

/** Rate-limit на Supabase (кросс-инстанс). Бакет в bot_sessions под хеш-ключом. */
async function rateLimit(scope: string, ident: string, max: number, windowMs: number): Promise<{ allowed: boolean; retryAfter: number }> {
  try {
    const raw = `rl:${scope}:${ident}`;
    let h = 0;
    for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) | 0;
    const key = -Math.abs(h) - 100000;
    const now = Date.now();
    const { data } = await supabase.from('bot_sessions').select('context').eq('telegram_id', key).maybeSingle();
    const ctx: any = (data as any)?.context || {};
    const windowStart = Number(ctx.ws) || 0;
    let count = Number(ctx.n) || 0;
    if (now - windowStart > windowMs) {
      await supabase.from('bot_sessions').upsert(
        { telegram_id: key, state: 'ratelimit', context: { ws: now, n: 1 }, updated_at: new Date().toISOString() },
        { onConflict: 'telegram_id' }
      );
      return { allowed: true, retryAfter: 0 };
    }
    if (count >= max) return { allowed: false, retryAfter: Math.ceil((windowStart + windowMs - now) / 1000) };
    count += 1;
    await supabase.from('bot_sessions').upsert(
      { telegram_id: key, state: 'ratelimit', context: { ws: windowStart, n: count }, updated_at: new Date().toISOString() },
      { onConflict: 'telegram_id' }
    );
    return { allowed: true, retryAfter: 0 };
  } catch {
    return { allowed: true, retryAfter: 0 };
  }
}

// Колонки registrations, которые разрешено принимать из тела запроса.
// ⚠️ status/payment_status/payment_amount/donation_amount тут БЫТЬ НЕ ДОЛЖНЫ:
// эндпоинт публичный, и клиент мог бы сам подтвердить себе заявку и отметить
// оплату. Их ставит только админка (api/admin/registrations.ts) и бот.
const REG_FIELDS = [
  'has_transport', 'transport_details', 'transport_seats', 'has_license', 'inventory',
  'category', 'dietary', 'guest_count', 'equipment', 'roles', 'notes',
];

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Анти-спам регистраций: не больше 15 с одного IP за 10 минут.
  const rl = await rateLimit('register', clientIp(req), 15, 10 * 60 * 1000);
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfter));
    return res.status(429).json({ error: 'Слишком много запросов, попробуй позже.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const { eventId, eventTitle, name, telegram, phone, inviter, source, initData } = body;

    if (!eventId || !name || !telegram) {
      return res.status(400).json({ error: 'Missing required fields', delivered: false });
    }

    // Rate limiting: 5 заявок за 15 минут с одного IP (защита от спам-ботов).
    const clientIp = getClientIp(req);
    if (isRateLimited(`register:${clientIp}`, 5, 15 * 60 * 1000)) {
      return res.status(429).json({ 
        error: 'Слишком много заявок. Попробуйте позже.', 
        delivered: false 
      });
    }

    // Гейт закрытого события: без верного кода доступа заявку не принимаем.
    // Проверка ТОЛЬКО серверная — сам код на публичный фронт не отдаётся.
    const { data: evGate } = await supabase
      .from('events')
      .select('is_public, access_code, telegram_bot_url')
      .eq('id', eventId)
      .maybeSingle();
    if (evGate && evGate.is_public === false && evGate.access_code) {
      const provided = String(body.accessCode || '').trim().toLowerCase();
      const expected = String(evGate.access_code).trim().toLowerCase();
      if (!provided || provided !== expected) {
        return res.status(403).json({
          error: 'Неверный код доступа к закрытому событию',
          code: 'access_denied',
          delivered: false,
        });
      }
    }

    // Достоверная личность из Telegram (если заявка из Mini App).
    const verified = initData ? verifyInitData(initData, BOT_TOKEN) : null;

    // 🔒 ЖЕЛЕЗОБЕТОННЫЙ ГЕЙТ: на события клуба пускаем только
    //  (а) подтверждённого участника (verified initData → status approved/is_core), либо
    //  (б) новичка с ВАЛИДНЫМ реф-кодом действующего участника (фиксируем, кто привёл).
    // Свободный текст «имя друга» доступ НЕ даёт. Выключатель: GATE_ENABLED=0.
    const refCode = String(body.refCode || body.ref || '').trim();
    // Пригласивший (валидный участник) и статус самого заявителя нужны и ниже —
    // после успешной анкеты реф-новичка впускаем в клуб.
    let inviterId: number | null = null;
    if (refCode) {
      const { data: inv } = await supabase
        .from('members').select('telegram_id,status,is_core').eq('ref_code', refCode).maybeSingle();
      if (inv && ((inv as any).status === 'approved' || (inv as any).is_core)) inviterId = Number((inv as any).telegram_id);
    }
    let isMember = false;
    let myStatus: string | null = null;
    if (verified?.id) {
      const { data: me } = await supabase
        .from('members').select('status,is_core').eq('telegram_id', verified.id).maybeSingle();
      myStatus = ((me as any)?.status as string) || null;
      isMember = !!(me && ((me as any).status === 'approved' || (me as any).is_core));
    }
    if (process.env.GATE_ENABLED !== '0') {
      if (!isMember && !inviterId) {
        return res.status(403).json({
          error: 'Клуб закрытый: записаться на событие можно только участнику клуба или по личной ссылке-приглашению действующего участника. Открой афишу через бота по реф-ссылке.',
          code: 'not_member', delivered: false,
        });
      }
    }

    const handle = String(telegram).replace(/^@/, '').trim();
    const telegramId = verified?.id
      ? verified.id
      : /^\d+$/.test(handle)
        ? Number(handle)
        : idFromHandle(handle || name);
    const username = verified?.username || handle || null;

    // 1) Участник (upsert по telegram_id).
    const { data: member, error: memberError } = await supabase
      .from('members')
      .upsert(
        {
          telegram_id: telegramId,
          username,
          first_name: verified?.first_name || name,
          phone: phone || null,
          category: body.category || null,
          dietary: body.dietary || null,
        },
        { onConflict: 'telegram_id' }
      )
      .select()
      .single();

    if (memberError) {
      slog('error', 'Member error', memberError);
      return res.status(500).json({ error: 'Failed to create member', details: memberError.message, delivered: false });
    }

    // Реф-система (best-effort): личный ref_code + фиксация пригласившего (однократно).
    try {
      if (!(member as any).ref_code) {
        for (let i = 0; i < 5; i++) {
          const c = Math.random().toString(36).slice(2, 9);
          const { error } = await supabase.from('members').update({ ref_code: c }).eq('telegram_id', member.telegram_id);
          if (!error) break;
        }
      }
      if (body.refCode && !(member as any).referred_by) {
        const { data: inv } = await supabase.from('members').select('telegram_id').eq('ref_code', body.refCode).maybeSingle();
        if (inv && inv.telegram_id !== member.telegram_id) {
          await supabase.from('members').update({ referred_by: inv.telegram_id }).eq('telegram_id', member.telegram_id);
          await supabase.from('referrals').insert({ ref_code: body.refCode, inviter_id: inv.telegram_id, invited_id: member.telegram_id, event_id: eventId });
        }
      }
    } catch (e) { slog('error', 'referral bind skipped', e); }

    // Анкета пройдена целиком (правила клуба + программа + данные) — фиксируем
    // пол, согласие на ПД и, для реф-новичка, ВПУСКАЕМ в клуб. Раньше это делал
    // короткий онбординг в боте; теперь единственный путь — Mini App.
    // ⚠️ pending_review (ручная модерация) и blocked реф-ссылкой НЕ обходятся.
    // Не-член, пришедший по ссылке-приглашению на событие, БОЛЬШЕ НЕ впускается
    // автоматически (это был последний лаз мимо ручного одобрения). Он идёт на
    // рассмотрение костяком (pending_review) с кнопками — как обычная заявка.
    // ⚠️ Одобренных участников (isMember) это НЕ касается — их регистрация без
    // изменений. Меняется поведение ТОЛЬКО для новичков по ссылке.
    let newPendingViaRef = false;
    try {
      const patch: Record<string, unknown> = {};
      if (body.category === 'male' || body.category === 'female') patch.gender = body.category;
      if (body.agreedPd === true) patch.agreed_pd = true;
      const isNewByRef = verified?.id && inviterId && !isMember
        && myStatus !== 'blocked' && myStatus !== 'approved';
      if (isNewByRef) {
        if (myStatus !== 'pending_review') patch.status = 'pending_review';
        patch.referred_by = inviterId;   // фиксируем, кто пригласил (атрибуция)
        newPendingViaRef = true;
      }
      if (Object.keys(patch).length) {
        await supabase.from('members').update(patch).eq('telegram_id', member.telegram_id);
      }
    } catch (e) { slog('error', 'member profile patch skipped', e); }

    // 2) Анти-дубль: одна активная заявка на событие от одного человека.
    const { data: existingReg } = await supabase
      .from('registrations')
      .select('id')
      .eq('event_id', eventId)
      .eq('telegram_id', member.telegram_id)
      .neq('status', 'cancelled')
      .maybeSingle();
    if (existingReg) {
      return res.status(200).json({
        success: true,
        ok: true,
        alreadyRegistered: true,
        delivered: false,
        message: 'Вы уже записаны на это мероприятие.',
      });
    }

    // 3) Заявка (белый список колонок).
    const registration: Record<string, unknown> = {
      id: `reg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      event_id: eventId,
      telegram_id: member.telegram_id,
      name,
      phone: phone || null,
      inviter: inviter || null,
      source: source || 'website',
    };
    for (const f of REG_FIELDS) if (body[f] !== undefined) registration[f] = body[f];
    // «Откуда узнал о клубе» — свободный текст анкеты. Отдельной колонки в members
    // нет, поэтому кладём в заметку заявки: костяк видит это в карточке участника.
    if (body.sourceHint) {
      const hint = `Откуда узнал: ${String(body.sourceHint).slice(0, 300)}`;
      registration.notes = registration.notes ? `${registration.notes}\n${hint}` : hint;
    }

    const { data: created, error: regError } = await supabase
      .from('registrations')
      .insert(registration)
      .select()
      .single();

    if (regError) {
      slog('error', 'Registration error', regError);
      return res.status(500).json({ error: 'Failed to create registration', details: regError.message, delivered: false });
    }

    // Счётчик участников (не критично, если RPC нет).
    try { await supabase.rpc('increment_participants', { event_id: eventId }); } catch {}

    // Smart Hype: milestone-уведомления в чат при достижении порогов участников.
    // Запрашиваем актуальный счётчик и шлём сообщение ОДИН РАЗ при переходе
    // через 5 или 10 (т.е. только когда новый участник стал ровно пятым/десятым).
    if (BOT_TOKEN && ADMIN_CHAT_ID) {
      try {
        const { data: evData } = await supabase
          .from('events')
          .select('participants_count, title')
          .eq('id', eventId)
          .maybeSingle();
        const currentCount = Number((evData as any)?.participants_count ?? 0);
        const milestones: Record<number, string> = {
          5: `🎯 <b>Milestone: 5 участников</b> на «${escapeHtml(eventTitle || eventId)}»!\n\nПять человек уже едут — событие набирает силу. Самое время напомнить об оставшихся местах.`,
          10: `🔥 <b>Milestone: 10 участников</b> на «${escapeHtml(eventTitle || eventId)}»!\n\nДесять человек в круге — это уже мощная группа. Проверь логистику и транспорт.`,
        };
        const milestoneText = milestones[currentCount];
        if (milestoneText) {
          await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: ADMIN_CHAT_ID,
              text: milestoneText,
              parse_mode: 'HTML',
              disable_web_page_preview: true,
            }),
          });
        }
      } catch (e) { slog('warn', 'milestone notify skipped', e); }
    }

    // Водитель из регистрации → строка в rides, чтобы машина была ВИДНА везде:
    // бот «Кто едет», статистика события и админ-логистика читают таблицу rides.
    // Раньше has_transport оставался невидимым — rides создавал только бот-флоу
    // ridenew. Одна активная машина на человека на событие (повтор = правка).
    try {
      const seats = Number(body.transport_seats) || 0;
      // Машину заводим и когда свободных мест нет: раньше условие было
      // `seats > 0`, и человек, выбравший «на своём авто — мест нет», нигде не
      // числился водителем. Организатор не знал, сколько машин в колонне, сам
      // человек видел «машина не выбрана», а если пассажир отваливался —
      // освободившееся место предложить было некому.
      if (body.has_transport) {
        const { data: existing } = await supabase
          .from('rides').select('id,kind')
          .eq('event_id', eventId).eq('driver_id', member.telegram_id).eq('active', true);
        const car = (existing || []).find((r: any) => r.kind !== 'tent');
        const rideRow: Record<string, unknown> = {
          event_id: eventId,
          driver_id: member.telegram_id,
          driver_name: name || 'Водитель',
          from_point: body.transport_details || 'по договорённости',
          seats_total: seats,
          kind: 'car',
          active: true,
        };
        if (car) await supabase.from('rides').update(rideRow).eq('id', (car as any).id);
        else await supabase.from('rides').insert(rideRow);
      }
    } catch { /* синхронизация rides не критична для заявки */ }

    // 2b) Подтверждение в бот. Транспорт спрашиваем ТОЛЬКО если анкета его не
    // прислала: с единым флоу через Mini App человек уже выбрал способ добраться,
    // и повторный вопрос затирал его ответ.
    if (BOT_TOKEN && verified?.id) {
      const transportAnswered = body.has_transport !== undefined
        || (typeof body.transport_details === 'string' && body.transport_details.trim() !== '');
      /**
       * Ссылка на чат события — прямо в подтверждении записи.
       * Организатор вручную писал каждому «зайди в группу мероприятия», а
       * участники всё равно не находили («не вижу, как вступить в чат»).
       * Ссылка приходит сама в тот момент, когда человек только записался.
       */
      const chatUrl = String((evGate as any)?.telegram_bot_url || '').trim();
      // У половины событий в этом поле лежит ссылка на САМОГО бота
      // (t.me/campsflint_bot) — звать «в чат события» туда, где человек уже
      // стоит, нельзя. Чат = инвайт-ссылка (t.me/+…, /joinchat/) или публичная
      // группа; аккаунты ботов Telegram всегда заканчиваются на «bot».
      const chatOk = /^https:\/\/t\.me\/(\+|joinchat\/)/i.test(chatUrl)
        || (/^https:\/\/t\.me\/[A-Za-z0-9_]{4,}$/i.test(chatUrl) && !/bot$/i.test(chatUrl));
      const rows: any[][] = [];
      if (chatOk) rows.push([{ text: '💬 Войти в чат события', url: chatUrl }]);
      if (!transportAnswered) {
        rows.push(
          [{ text: '🚗 На своём авто — есть свободные места', callback_data: `rt:${eventId}:car` }],
          [{ text: '🚗 На своём авто — мест нет', callback_data: `rt:${eventId}:carfull` }],
          [{ text: '🙋 Нужна попутка — возьмите меня', callback_data: `rt:${eventId}:seek` }],
          [{ text: '🚶 Без авто, доберусь сам (пешком/транспортом)', callback_data: `rt:${eventId}:self` }],
        );
      }
      try {
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: verified.id, parse_mode: 'HTML',
            text: (transportAnswered
              ? `✅ Ты записан(а) на «<b>${escapeHtml(eventTitle || eventId)}</b>»!\n\nАнкета получена целиком — организаторы видят твою логистику и предпочтения. Детали события и напоминания придут сюда.`
              : `✅ Ты записан(а) на «<b>${escapeHtml(eventTitle || eventId)}</b>»!\n\nПара быстрых уточнений для организаторов — 🚗 как добираешься?`)
              + (chatOk ? `\n\n💬 Вся оперативная связь — в чате события. Заходи, там координация в день выезда.` : ''),
            ...(rows.length ? { reply_markup: { inline_keyboard: rows } } : {}),
          }),
        });
      } catch { /* анкета догонится кроном-доборщиком */ }
    }

    // 3) Уведомление костяку (best-effort, не роняет заявку).
    let delivered = false;
    if (BOT_TOKEN) {
      // Новичок по ссылке (pending_review) — костяк решает КНОПКАМИ, и шлём в
      // личку каждому костяку, а не только в групповой чат. Обычный участник,
      // записавшийся на событие, — простое инфо-уведомление в чат.
      let text: string;
      let replyMarkup: any = undefined;
      if (newPendingViaRef && verified?.id) {
        text =
          `🚪 <b>Новая заявка в клуб</b> (через запись на «${escapeHtml(eventTitle || eventId)}»)\n\n` +
          `👤 ${escapeHtml(name)}\n` +
          `✈️ ${escapeHtml(telegram)} (id ${verified.id})\n` +
          `📞 <code>${escapeHtml(phone || '—')}</code>\n` +
          `🔗 Пригласил: ${escapeHtml(inviter || '—')}\n\n` +
          `Решай кнопками — ответ придёт заявителю в бот.`;
        replyMarkup = { inline_keyboard: [
          [{ text: '✅ Принять', callback_data: `approve_${verified.id}` }, { text: '❌ Отклонить', callback_data: `reject_${verified.id}` }],
          [{ text: '✍️ Написать заявителю', callback_data: `reply_${verified.id}` }],
        ] };
      } else {
        text =
          `🟢 <b>Запись на событие</b>\n\n` +
          `<b>Событие:</b> ${escapeHtml(eventTitle || eventId)}\n` +
          `<b>Имя:</b> ${escapeHtml(name)}\n` +
          `<b>Telegram:</b> ${escapeHtml(telegram)}\n` +
          `<b>Телефон:</b> ${escapeHtml(phone || '—')}\n` +
          `<b>Верификация:</b> ${verified ? '✅ Telegram подтверждён' : 'веб-форма'}`;
      }
      // Получатели: групповой чат + личка костякам (для заявок с кнопками — чтобы
      // владелец точно увидел и решил). Обычные записи — тоже в чат.
      const recipients = new Set<string>();
      if (ADMIN_CHAT_ID) recipients.add(String(ADMIN_CHAT_ID));
      if (newPendingViaRef) {
        try {
          const { data: core } = await supabase.from('members').select('telegram_id').eq('is_core', true);
          for (const c of core || []) {
            const cid = Number((c as any).telegram_id);
            if (Number.isFinite(cid) && cid > 0) recipients.add(String(cid));
          }
        } catch { /* нет доступа — остаётся чат */ }
      }
      for (const chat of recipients) {
        try {
          const tg = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: replyMarkup }),
          });
          if ((await tg.json()).ok === true) delivered = true;
        } catch (e) { slog('error', 'Telegram notify failed', e); }
      }
    }

    return res.status(200).json({ success: true, ok: true, delivered, registration: created });
  } catch (error) {
    slog('error', 'Error', error);
    return res.status(500).json({ error: 'Internal server error', delivered: false });
  }
}
