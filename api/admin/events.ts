import { createClient } from '@supabase/supabase-js';
import * as crypto from 'crypto';


const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

/** Структурированный лог: одна JSON-строка на событие — greppable в Vercel. */
function slog(level: 'info' | 'warn' | 'error', msg: string, err?: any) {
  const line: any = { t: new Date().toISOString(), level, scope: 'admin/events', msg };
  if (err !== undefined) line.err = err?.message || String(err);
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(JSON.stringify(line));
}

/** IP клиента за прокси Vercel (первый в x-forwarded-for). */
function clientIp(req: any): string {
  const xf = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || String(req.headers?.['x-real-ip'] || '') || 'unknown';
}

/**
 * Rate-limit на Supabase (переживает несколько инстансов Vercel, в отличие от
 * in-memory). Бакет живёт в bot_sessions под отрицательным ключом-хешем — как
 * presence, без лишнего DDL. Возвращает { allowed, retryAfter } (сек).
 */
async function rateLimit(scope: string, ident: string, max: number, windowMs: number): Promise<{ allowed: boolean; retryAfter: number }> {
  try {
    const raw = `rl:${scope}:${ident}`;
    let h = 0;
    for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) | 0;
    const key = -Math.abs(h) - 100000; // отдельный диапазон от presence
    const now = Date.now();
    const { data } = await supabase.from('bot_sessions').select('context').eq('telegram_id', key).maybeSingle();
    const ctx: any = (data as any)?.context || {};
    const windowStart = Number(ctx.ws) || 0;
    let count = Number(ctx.n) || 0;
    if (now - windowStart > windowMs) {
      // Новое окно.
      await supabase.from('bot_sessions').upsert(
        { telegram_id: key, state: 'ratelimit', context: { ws: now, n: 1 }, updated_at: new Date().toISOString() },
        { onConflict: 'telegram_id' }
      );
      return { allowed: true, retryAfter: 0 };
    }
    if (count >= max) {
      return { allowed: false, retryAfter: Math.ceil((windowStart + windowMs - now) / 1000) };
    }
    count += 1;
    await supabase.from('bot_sessions').upsert(
      { telegram_id: key, state: 'ratelimit', context: { ws: windowStart, n: count }, updated_at: new Date().toISOString() },
      { onConflict: 'telegram_id' }
    );
    return { allowed: true, retryAfter: 0 };
  } catch {
    // При сбое стора не блокируем легитимных пользователей.
    return { allowed: true, retryAfter: 0 };
  }
}

function esc(s: any): string {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Краткое текстовое представление маршрута — для сравнения «было/стало». */
function itinerarySig(logistics: any): string {
  const it = Array.isArray(logistics?.itinerary) ? logistics.itinerary : [];
  return it.map((p: any) => `${p.time || ''}|${p.title || ''}|${p.payment || ''}|${p.price || ''}`).join('§');
}

/**
 * Уведомление записанных об изменениях события: сравниваем ключевые поля
 * (дата/время/локация/маршрут) старой и новой версии и шлём только при
 * реальном отличии, с кнопкой «✅ Понял(а)» (ack_ обрабатывается в вебхуке).
 */
async function notifyEventChanges(eventId: string, before: any, after: any): Promise<number> {
  if (!BOT_TOKEN || !before) return 0;
  const changes: string[] = [];
  if ((before.date || '') !== (after.date || '') || (before.date_end || '') !== (after.date_end || '')) {
    changes.push(`📆 Дата: <b>${esc(after.date_label || after.date)}</b>`);
  }
  if ((before.time || '') !== (after.time || '') || (before.time_end || '') !== (after.time_end || '')) {
    changes.push(`🕐 Время: <b>${esc(after.time || '—')}${after.time_end ? '–' + esc(after.time_end) : ''}</b>`);
  }
  if ((before.location || '') !== (after.location || '')) {
    changes.push(`📍 Место: <b>${esc(after.location)}</b>`);
  }
  // Координаты назначения: изменились → всем кликабельная ссылка на карту.
  if (String(before.coordinates_lat || '') !== String(after.coordinates_lat || '') || String(before.coordinates_lng || '') !== String(after.coordinates_lng || '')) {
    if (after.coordinates_lat && after.coordinates_lng) {
      changes.push(`🗺 Новые координаты: <a href="https://yandex.ru/maps/?text=${after.coordinates_lat},${after.coordinates_lng}">${esc(`${after.coordinates_lat}, ${after.coordinates_lng}`)}</a> (нажми — откроется карта)`);
    }
  }
  // Точка сбора колонны из логистики.
  const beforeAsm = String(before.logistics?.assemblyPoint || ''), afterAsm = String(after.logistics?.assemblyPoint || '');
  if (beforeAsm !== afterAsm && afterAsm) {
    changes.push(`🧭 Точка сбора: <b>${esc(afterAsm)}</b>${after.logistics?.departureTime ? ` · ${esc(after.logistics.departureTime)}` : ''}`);
  }
  if (itinerarySig(before.logistics) !== itinerarySig(after.logistics)) {
    changes.push('🧭 Обновлён маршрут дня — загляни в карточку события');
  }
  const progBefore = JSON.stringify(before.program || []);
  const progAfter = JSON.stringify(after.program || []);
  if (progBefore !== progAfter) {
    changes.push('📋 Обновлена программа события — посмотри, что нового');
  }
  if (!changes.length) return 0;

  const { data: regs } = await supabase
    .from('registrations').select('telegram_id').eq('event_id', eventId).neq('status', 'cancelled');
  const ids = Array.from(new Set((regs || [])
    .map((r: any) => Number(r.telegram_id)).filter((id: number) => Number.isFinite(id) && id > 0)));
  if (!ids.length) return 0;

  const text = `✏️ <b>Изменения в событии «${esc(after.title)}»</b>\n\n${changes.join('\n')}\n\nПроверь детали, чтобы не было сюрпризов.`;
  let sent = 0;
  await Promise.allSettled(ids.map((chatId) =>
    fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true,
        reply_markup: { inline_keyboard: [
          [{ text: '👀 Открыть событие', url: `https://t.me/campsflint_bot?start=event_${eventId}` }],
          [{ text: '✅ Понял(а)', callback_data: `ack_${eventId}` }],
        ] },
      }),
    }).then((r) => r.json()).then((j) => { if (j?.ok) sent++; })
  ));
  return sent;
}

// Маппинг snake_case -> camelCase для фронтенда
function mapEventToCamelCase(event: any) {
  if (!event) return null;
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    type: event.type,
    date: event.date,
    dateEnd: event.date_end,
    dateLabel: event.date_label,
    time: event.time,
    timeEnd: event.time_end,
    location: event.location,
    locationDetails: event.location_details,
    logistics: event.logistics || {},
    paymentDetails: event.payment_details || {},
    coordinates: {
      lat: event.coordinates_lat,
      lng: event.coordinates_lng
    },
    painPoint: event.pain_point,
    image: event.image,
    maxParticipants: event.max_participants,
    participantsCount: event.participants_count,
    telegramBotUrl: event.telegram_bot_url,
    priceType: event.price_type,
    priceLabel: event.price_label,
    priceAmount: event.price_amount,
    entryThreshold: event.entry_threshold,
    entryType: event.entry_type,
    houseQualities: event.house_qualities || [],
    status: event.status,
    statusReason: event.status_reason,
    decisionDeadline: event.decision_deadline,
    checklist: event.checklist || {},
    isPublic: event.is_public !== false,
    accessCode: event.access_code,
    deputyId: event.deputy_id,
    lockedHint: event.locked_hint,
    program: event.program || [],
    notifications: event.notifications || {},
    programVoting: event.program_voting,
    shopping: event.shopping || null,
    createdAt: event.created_at,
    updatedAt: event.updated_at
  };
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

const ADMIN_TTL_MS = 12 * 60 * 60 * 1000;

function passwordMatches(password: string): boolean {
  return !!ADMIN_SECRET && safeEq(String(password || ''), ADMIN_SECRET);
}

function sessionCookie(): string {
  const exp = Date.now() + ADMIN_TTL_MS;
  const mac = crypto.createHmac('sha256', ADMIN_SECRET).update(String(exp)).digest('hex');
  return `${ADMIN_COOKIE}=${encodeURIComponent(`${exp}.${mac}`)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${ADMIN_TTL_MS / 1000}`;
}

function clearCookie(): string {
  return `${ADMIN_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export default async function handler(req: any, res: any) {
  // Вход/выход админки. Пароль сверяется на сервере и обменивается на
  // подписанную httpOnly-куку — в браузер секрет не попадает.
  if (req.method === 'POST' && req.query?.action === 'login') {
    // Анти-брутфорс: не больше 8 попыток за 15 минут с одного IP.
    const rl = await rateLimit('login', clientIp(req), 8, 15 * 60 * 1000);
    if (!rl.allowed) {
      res.setHeader('Retry-After', String(rl.retryAfter));
      return res.status(429).json({ error: `Слишком много попыток. Попробуй через ${Math.ceil(rl.retryAfter / 60)} мин.` });
    }
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    if (!passwordMatches(body.password)) {
      return res.status(401).json({ error: 'Неверный пароль' });
    }
    // Успех — сбрасываем счётчик попыток этого IP.
    try {
      const raw = `rl:login:${clientIp(req)}`;
      let h = 0; for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) | 0;
      await supabase.from('bot_sessions').delete().eq('telegram_id', -Math.abs(h) - 100000);
    } catch { /* no-op */ }
    res.setHeader('Set-Cookie', sessionCookie());
    return res.status(200).json({ ok: true });
  }
  if (req.method === 'POST' && req.query?.action === 'logout') {
    res.setHeader('Set-Cookie', clearCookie());
    return res.status(200).json({ ok: true });
  }

  if (!isAdmin(req)) return deny(res);

  if (req.method === 'GET') {
    /**
     * Пульс присутствия: вкладка админки раз в ~20 сек отмечается и получает
     * список тех, кто онлайн. Онлайн = отметился за последние 60 сек.
     *
     * Живёт в bot_sessions, а не в отдельной таблице: это тоже эфемерная
     * сессия, а лишний DDL на прод-базе не нужен. Ключ — отрицательный хеш
     * id вкладки; настоящие telegram_id бота положительные, так что не пересечёмся.
     */
    if (req.query?.action === 'presence') {
      try {
        const id = String(req.query.id || '').slice(0, 64);
        const name = String(req.query.name || 'Админ').slice(0, 40);
        if (!id) return res.status(400).json({ error: 'Missing id' });

        let h = 0;
        for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
        const key = -Math.abs(h) - 1;

        await supabase.from('bot_sessions').upsert(
          { telegram_id: key, state: 'admin_presence', context: { name }, updated_at: new Date().toISOString() },
          { onConflict: 'telegram_id' }
        );

        const cutoff = new Date(Date.now() - 60_000).toISOString();
        const { data: online } = await supabase
          .from('bot_sessions')
          .select('telegram_id,context')
          .eq('state', 'admin_presence')
          .gte('updated_at', cutoff);

        // Подчищаем протухшие отметки, чтобы таблица не росла.
        await supabase
          .from('bot_sessions')
          .delete()
          .eq('state', 'admin_presence')
          .lt('updated_at', new Date(Date.now() - 3600_000).toISOString());

        const users = (online || []).map((r: any) => ({ id: String(r.telegram_id), name: r.context?.name || 'Админ' }));
        return res.status(200).json({ online: users.length, users });
      } catch (error) {
        return res.status(200).json({ online: 1, users: [], error: (error as Error).message });
      }
    }

    // Получить все события
    try {
      const { data: events, error } = await supabase
        .from('events')
        .select('*')
        .order('date', { ascending: true });

      if (error) {
        slog('error', 'Events error', error);
        return res.status(500).json({ error: 'Failed to fetch events' });
      }

      // Занятые места считаем из registrations — единый источник правды
      // с сайтом и ботом (колонка participants_count — легаси, расходилась).
      // Каждая регистрация = сам участник (1) + его гости (guest_count).
      const { data: regs } = await supabase
        .from('registrations').select('event_id, guest_count').neq('status', 'cancelled');
      const counts = new Map<string, number>();
      for (const r of regs || []) counts.set(r.event_id, (counts.get(r.event_id) || 0) + 1 + (Number((r as any).guest_count) || 0));

      const mappedEvents = (events || []).map((e: any) =>
        mapEventToCamelCase({ ...e, participants_count: counts.get(e.id) || 0 }));

      return res.status(200).json({ events: mappedEvents });
    } catch (error) {
      slog('error', 'Error', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  if (req.method === 'POST') {
    // Создать или обновить событие
    try {
      const body = req.body;

      // Отправка списка машин со свободными местами тем, кто без транспорта
      if (req.query?.action === 'rides_send') {
        const eventId = String(body.eventId || body.id || '');
        if (!eventId) return res.status(400).json({ error: 'Missing eventId' });

        const { data: rides } = await supabase
          .from('rides').select('*').eq('event_id', eventId).eq('active', true)
          .neq('kind', 'tent');
        const { data: regs } = await supabase
          .from('registrations').select('telegram_id,has_transport').eq('event_id', eventId).neq('status', 'cancelled');
        const { data: ev } = await supabase
          .from('events').select('title').eq('id', eventId).maybeSingle();

        const needsRide = (regs || []).filter((r: any) => !r.has_transport).map((r: any) => Number(r.telegram_id)).filter((id: number) => Number.isFinite(id) && id > 0);
        if (!needsRide.length) return res.status(200).json({ ok: true, sent: 0, message: 'Все участники имеют транспорт' });

        const availableRides = (rides || []).filter((r: any) => {
          const taken = r.seats_taken || 0;
          const total = r.seats_total || 0;
          return total > taken;
        });

        if (!availableRides.length) {
          return res.status(200).json({ ok: true, sent: 0, message: 'Нет машин со свободными местами' });
        }

        const ridesList = availableRides
          .map((r: any) => `🚗 <b>${esc(r.driver_name || 'Водитель')}</b>\n   📍 ${esc(r.from_point || '—')} · 🕐 ${esc(r.depart_text || '—')}\n   Мест: ${Math.max(0, (r.seats_total || 0) - (r.seats_taken || 0))} · ⛽ ${r.fuel_cost || 0} Br/чел`)
          .join('\n\n');

        const text = `🚗 <b>Список машин с местами на «${esc((ev as any)?.title || 'событие')}»</b>\n\n${ridesList}\n\nНажми кнопку ниже — займёшь место или встанешь в очередь.`;

        let sent = 0;
        if (BOT_TOKEN) {
          await Promise.allSettled(needsRide.map((chatId) =>
            fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true,
                reply_markup: { inline_keyboard: [[{ text: '👀 Занять место в машине', callback_data: `rides_${eventId}` }]] },
              }),
            }).then((r) => r.json()).then((j) => { if (j?.ok) sent++; })
          ));
        }
        return res.status(200).json({ ok: true, sent, total: needsRide.length, rides: availableRides.length });
      }

      // Отправка списка закупки на согласование участникам. Сохраняет список
      // (status=sent) и шлёт записанным с кнопкой «✅ Согласен» (бот: shopok_).
      if (req.query?.action === 'shopping_send') {
        const eventId = String(body.eventId || body.id || '');
        if (!eventId) return res.status(400).json({ error: 'Missing eventId' });
        const { data: ev } = await supabase
          .from('events').select('title,shopping').eq('id', eventId).maybeSingle();
        const shopping = body.shopping || (ev as any)?.shopping || {};
        const items = Array.isArray(shopping.items) ? shopping.items : [];
        if (!items.length) return res.status(400).json({ error: 'Список закупки пуст' });

        const nextShopping = { ...shopping, status: 'sent', approved_by: shopping.approved_by || [], sent_at: new Date().toISOString() };
        await supabase.from('events').update({ shopping: nextShopping }).eq('id', eventId);

        const { data: regs } = await supabase
          .from('registrations').select('telegram_id').eq('event_id', eventId).neq('status', 'cancelled');
        const ids = Array.from(new Set((regs || [])
          .map((r: any) => Number(r.telegram_id)).filter((id: number) => Number.isFinite(id) && id > 0)));

        const lines = items.slice(0, 40).map((it: any) => `• ${esc(it.item)}${it.qty ? ` — ${esc(it.qty)}` : ''}${it.note ? ` <i>(${esc(it.note)})</i>` : ''}`).join('\n');
        const est = Number(shopping.estimate) > 0 ? `\n\n💰 Примерная сумма: <b>${Number(shopping.estimate)} BYN</b>` : '';
        const text = `🛒 <b>Закупка на «${esc((ev as any)?.title || 'событие')}»</b>\n\nСогласуй список — потом выберем закупщика и разделим расходы поровну.\n\n${lines}${est}`;

        let sent = 0;
        if (BOT_TOKEN) {
          await Promise.allSettled(ids.map((chatId) =>
            fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true,
                reply_markup: { inline_keyboard: [
                  [{ text: '✅ Согласен с закупкой', callback_data: `shopok_${eventId}` }],
                  [{ text: '✏️ Есть замечания', callback_data: `shopno_${eventId}` }],
                ] },
              }),
            }).then((r) => r.json()).then((j) => { if (j?.ok) sent++; })
          ));
        }
        return res.status(200).json({ ok: true, sent, total: ids.length });
      }

      // Запуск закупки: шлём список ТОЛЬКО назначенному закупщику + кнопку «сделано».
      // Организатор запускает процесс сам, не дожидаясь крона.
      if (req.query?.action === 'shopping_launch') {
        const eventId = String(body.eventId || body.id || '');
        if (!eventId) return res.status(400).json({ error: 'Missing eventId' });
        const { data: ev } = await supabase
          .from('events').select('title,shopping').eq('id', eventId).maybeSingle();
        const shopping = body.shopping || (ev as any)?.shopping || {};
        const items = Array.isArray(shopping.items) ? shopping.items : [];
        if (!items.length) return res.status(400).json({ error: 'Список закупки пуст' });
        const buyerId = Number(shopping.buyer_id);
        if (!Number.isFinite(buyerId) || buyerId <= 0) return res.status(400).json({ error: 'Сначала выбери закупщика' });

        const nextShopping = { ...shopping, status: 'buying', launched_at: new Date().toISOString() };
        await supabase.from('events').update({ shopping: nextShopping }).eq('id', eventId);

        // Группируем по категориям — так закупщику удобнее в магазине.
        const byCat = new Map<string, any[]>();
        for (const it of items.slice(0, 60)) {
          const c = String(it.category || 'Прочее');
          if (!byCat.has(c)) byCat.set(c, []);
          byCat.get(c)!.push(it);
        }
        const listBlocks = Array.from(byCat.entries()).map(([cat, its]) =>
          `<b>${esc(cat)}</b>\n` + its.map((it: any) => `☐ ${esc(it.item)}${it.qty ? ` — ${esc(it.qty)}` : ''}${it.note ? ` <i>(${esc(it.note)})</i>` : ''}`).join('\n')
        ).join('\n\n');
        const est = Number(shopping.estimate) > 0 ? `\n\n💰 Ориентир по сумме: <b>${Number(shopping.estimate)} BYN</b> (потом разделим поровну)` : '';
        const text = `🛒 <b>Ты — закупщик на «${esc((ev as any)?.title || 'событие')}»!</b>\n\nВот список на общий котёл. Отметь галочками в магазине, а как закупишься — жми кнопку ниже.${est}\n\n${listBlocks}`;

        let sent = false;
        if (BOT_TOKEN) {
          await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: buyerId, text, parse_mode: 'HTML', disable_web_page_preview: true,
              reply_markup: { inline_keyboard: [[{ text: '✅ Закупка сделана', callback_data: `boughtok_${eventId}` }]] },
            }),
          }).then((r) => r.json()).then((j) => { sent = !!j?.ok; }).catch(() => {});
        }
        return res.status(200).json({ ok: true, sent });
      }

      // Финальный сплит расходов: доля по ртам (участник + его гости; за гостей
      // собирает пригласивший), отказы (optout) не платят за позицию. Каждому в
      // бот — его сумма и кому переводить; сводка — в админ-чат и в ответ API.
      if (req.query?.action === 'split_send') {
        const eventId = String(body.eventId || body.id || '');
        if (!eventId) return res.status(400).json({ error: 'Missing eventId' });
        const { data: ev } = await supabase
          .from('events').select('title,shopping').eq('id', eventId).maybeSingle();
        const expenses = Array.isArray((ev as any)?.shopping?.expenses) ? (ev as any).shopping.expenses : [];
        if (!expenses.length) return res.status(400).json({ error: 'Расходов пока нет' });

        const { data: regs } = await supabase
          .from('registrations').select('telegram_id,name,guest_count')
          .eq('event_id', eventId).neq('status', 'cancelled');
        const people = (regs || []).map((r: any) => ({
          id: Number(r.telegram_id), name: String(r.name || 'Участник'),
          mouths: 1 + (Number(r.guest_count) || 0), owed: 0, paid: 0,
        }));
        if (!people.length) return res.status(400).json({ error: 'Нет участников' });

        for (const ex of expenses) {
          const optout: number[] = Array.isArray(ex.optout) ? ex.optout.map(Number) : [];
          const share = people.filter((p) => !optout.includes(p.id));
          const mouths = share.reduce((s, p) => s + p.mouths, 0);
          if (!mouths) continue;
          for (const p of share) p.owed += (Number(ex.amount) || 0) * p.mouths / mouths;
          const payer = people.find((p) => p.id === Number(ex.by_id));
          if (payer) payer.paid += Number(ex.amount) || 0;
        }

        // Жадный матчинг должников и переплативших — минимум переводов.
        const round2 = (x: number) => Math.round(x * 100) / 100;
        const debtors = people.map((p) => ({ ...p, bal: round2(p.owed - p.paid) }));
        const owes = debtors.filter((p) => p.bal > 0.01).sort((a, b) => b.bal - a.bal).map((p) => ({ ...p }));
        const gets = debtors.filter((p) => p.bal < -0.01).sort((a, b) => a.bal - b.bal).map((p) => ({ ...p, bal: -p.bal }));
        const transfers: { from: number; fromName: string; to: number; toName: string; amount: number }[] = [];
        let i = 0, j = 0;
        while (i < owes.length && j < gets.length) {
          const pay = round2(Math.min(owes[i].bal, gets[j].bal));
          if (pay > 0.01) transfers.push({ from: owes[i].id, fromName: owes[i].name, to: gets[j].id, toName: gets[j].name, amount: pay });
          owes[i].bal = round2(owes[i].bal - pay); gets[j].bal = round2(gets[j].bal - pay);
          if (owes[i].bal <= 0.01) i++;
          if (gets[j].bal <= 0.01) j++;
        }

        const total = round2(expenses.reduce((s: number, x: any) => s + (Number(x.amount) || 0), 0));

        // Долги фиксируем в shopping.split: висят как pending, пока должник не
        // переведёт (payd_), а ПОЛУЧАТЕЛЬ не подтвердит получение (payc_).
        const trRecords = transfers.map((t, n) => ({
          id: `${Date.now().toString(36)}${n}`, from: t.from, from_name: t.fromName,
          to: t.to, to_name: t.toName, amount: t.amount, status: 'pending',
        }));
        const shopping0 = (ev as any)?.shopping || {};
        await supabase.from('events').update({
          shopping: { ...shopping0, split: { transfers: trRecords, total, sent_at: new Date().toISOString() } },
        }).eq('id', eventId);

        let sent = 0;
        if (BOT_TOKEN) {
          for (const p of debtors) {
            if (!(Number.isFinite(p.id) && p.id > 0)) continue;
            const my = trRecords.filter((t) => t.from === p.id);
            const toMe = trRecords.filter((t) => t.to === p.id);
            const lines = [
              `💰 <b>Итог по расходам — «${esc((ev as any)?.title || 'событие')}»</b>`,
              '',
              `Всего потрачено: <b>${total} BYN</b>.`,
              `Твоя доля: <b>${round2(p.owed)} BYN</b>${p.mouths > 1 ? ` (за тебя + ${p.mouths - 1} гост${p.mouths - 1 === 1 ? 'я' : 'ей'} — собери с них сам)` : ''}.`,
              p.paid > 0 ? `Ты уже потратил(а): <b>${round2(p.paid)} BYN</b>.` : '',
              ...my.map((t) => `➡️ Переведи <b>${t.amount} BYN</b> — ${esc(t.to_name)}`),
              ...toMe.map((t) => `⬅️ Тебе переведёт ${esc(t.from_name)}: <b>${t.amount} BYN</b> (подтверди, когда придёт)`),
              (!my.length && !toMe.length) ? '✅ Ты в расчёте — ничего переводить не нужно.' : '',
              my.length ? '\nКак переведёшь — жми кнопку, получатель подтвердит.' : '',
            ].filter(Boolean);
            // Кнопка «Я перевёл» на каждый долг должника.
            const buttons = my.map((t) => ([{ text: `✅ Я перевёл ${t.amount} BYN → ${t.to_name}`.slice(0, 60), callback_data: `payd_${eventId}_${t.id}` }]));
            try {
              const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: p.id, text: lines.join('\n'), parse_mode: 'HTML', reply_markup: buttons.length ? { inline_keyboard: buttons } : undefined }),
              }).then((x) => x.json());
              if (r?.ok) sent++;
            } catch { /* no-op */ }
          }
        }
        return res.status(200).json({
          ok: true, sent, total,
          split: debtors.map((p) => ({ name: p.name, mouths: p.mouths, owed: round2(p.owed), paid: round2(p.paid), balance: p.bal })),
          transfers: trRecords.map((t) => `${t.from_name} → ${t.to_name}: ${t.amount} BYN`),
        });
      }

      // Маппинг camelCase -> snake_case для Supabase
      const eventData = {
        id: body.id,
        title: body.title,
        description: body.description,
        type: body.type,
        date: body.date,
        date_label: body.dateLabel || body.date,
        time: body.time || null,
        time_end: body.timeEnd || null,
        location: body.location,
        location_details: body.locationDetails || null,
        coordinates_lat: body.coordinates?.lat || null,
        coordinates_lng: body.coordinates?.lng || null,
        pain_point: body.painPoint || null,
        image: body.image || null,
        max_participants: body.maxParticipants || 15,
        participants_count: body.participantsCount || 0,
        telegram_bot_url: body.telegramBotUrl || null,
        price_type: body.priceType === 'paid' ? 'paid' : 'free',
        price_label: body.priceLabel || null,
        price_amount: body.priceAmount || 0,
        entry_threshold: body.entryThreshold || null,
        entry_type: body.entryType || 'all',
        status: body.status || 'locked',
        locked_hint: body.lockedHint || null,
        program: body.program || [],
        notifications: body.notifications || {},
        program_voting: body.programVoting || null
      };
      // date_end / house_qualities шлём только если заданы (колонки могли отсутствовать до миграции).
      if (body.dateEnd) (eventData as any).date_end = body.dateEnd;
      if (body.houseQualities) (eventData as any).house_qualities = body.houseQualities;
      if (body.logistics) (eventData as any).logistics = body.logistics;
      if (body.paymentDetails) (eventData as any).payment_details = body.paymentDetails;
      if (body.checklist) (eventData as any).checklist = body.checklist;

      // Старая версия — чтобы после сохранения понять, что изменилось, и
      // уведомить записанных (только при реальном отличии ключевых полей).
      const { data: before } = await supabase
        .from('events').select('date,date_end,time,time_end,location,date_label,logistics,program')
        .eq('id', body.id).maybeSingle();

      const { data: event, error } = await supabase
        .from('events')
        .upsert(eventData, {
          onConflict: 'id'
        })
        .select()
        .single();

      if (error) {
        slog('error', 'Event save error', error);
        return res.status(500).json({ error: 'Failed to save event', details: error.message });
      }

      // Уведомляем об изменениях только при редактировании существующего
      // события (before есть). Ошибки рассылки не роняют сохранение.
      let notified = 0;
      try { if (before) notified = await notifyEventChanges(body.id, before, event); } catch { /* no-op */ }

      return res.status(200).json({ success: true, event: mapEventToCamelCase(event), notified });
    } catch (error) {
      slog('error', 'Error', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  if (req.method === 'PATCH') {
    // Точечное обновление события: жизненный цикл, чек-лист, публичность,
    // перенос дат, «под вопросом». Не трогает поля, которых нет в теле.
    try {
      const { eventId } = req.query;
      if (!eventId) return res.status(400).json({ error: 'Missing eventId' });

      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};

      // camelCase → snake_case только для явно переданных ключей.
      const FIELDS: Record<string, string> = {
        status: 'status',
        statusReason: 'status_reason',
        decisionDeadline: 'decision_deadline',
        checklist: 'checklist',
        isPublic: 'is_public',
        accessCode: 'access_code',
        deputyId: 'deputy_id',
        date: 'date',
        dateEnd: 'date_end',
        dateLabel: 'date_label',
        lockedHint: 'locked_hint',
        maxParticipants: 'max_participants',
        paymentDetails: 'payment_details',
        logistics: 'logistics',
        shopping: 'shopping',
      };

      const patch: Record<string, unknown> = {};
      for (const [camel, snake] of Object.entries(FIELDS)) {
        if (body[camel] !== undefined) patch[snake] = body[camel];
      }
      if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Nothing to update' });

      const { data: event, error } = await supabase
        .from('events')
        .update(patch)
        .eq('id', eventId)
        .select()
        .single();

      if (error) {
        slog('error', 'Event patch error', error);
        return res.status(500).json({ error: 'Failed to update event', details: error.message });
      }

      return res.status(200).json({ success: true, event: mapEventToCamelCase(event) });
    } catch (error) {
      slog('error', 'Error', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  if (req.method === 'DELETE') {
    // Удалить событие
    try {
      const { eventId } = req.query;

      if (!eventId) {
        return res.status(400).json({ error: 'Missing eventId' });
      }

      const { error } = await supabase
        .from('events')
        .delete()
        .eq('id', eventId);

      if (error) {
        slog('error', 'Event delete error', error);
        return res.status(500).json({ error: 'Failed to delete event' });
      }

      return res.status(200).json({ success: true });
    } catch (error) {
      slog('error', 'Error', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}