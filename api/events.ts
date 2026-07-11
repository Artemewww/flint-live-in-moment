import { createClient } from '@supabase/supabase-js';
import * as crypto from 'crypto';


/**
 * Публичный роутер событий. Лимит Vercel Hobby — 12 функций, поэтому мелкие
 * действия висят на ?action=, а не отдельными файлами (см. PLAN.md §9).
 *
 *  GET                          → список событий (camelCase)
 *  POST { action:'vote' }       → голос за вариант программы
 *  POST { action:'interest' }   → сигнал «мне интересно» + пинг организаторам
 *  POST { action:'feedback' }   → отзыв после события (1–5 + коммент)
 *  POST (без action)            → upsert события, ТОЛЬКО с админ-токеном
 */

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID || '-1003935660570';
const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || 'campsflint_bot';



/** Подпись Telegram WebApp initData → достоверный telegram_id. */
function verifyInitData(initData: string): { id: number; username?: string; first_name?: string } | null {
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
    return u && u.id ? u : null;
  } catch {
    return null;
  }
}

function esc(s: any): string {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function notifyAdmins(text: string): Promise<boolean> {
  if (!BOT_TOKEN || !ADMIN_CHAT_ID) return false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: ADMIN_CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    return (await r.json()).ok === true;
  } catch {
    return false;
  }
}

// Маппинг snake_case -> camelCase для фронтенда.
// Дублируется в api/admin/events.ts: serverless не импортирует из ../src (PLAN.md §9).
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
    // Флаг «закрытое» — чтобы фронт показал поле кода. Сам access_code НЕ отдаём.
    isPublic: event.is_public !== false,
    lockedHint: event.locked_hint,
    program: event.program || [],
    notifications: event.notifications || {},
    programVoting: event.program_voting,
    createdAt: event.created_at,
    updatedAt: event.updated_at
  };
}

/** Голос за вариант программы. Один голос на человека, переголосование разрешено. */
async function handleVote(body: any, res: any) {
  const { eventId, option } = body;
  if (!eventId || !option) return res.status(400).json({ error: 'Missing eventId or option' });

  const user = verifyInitData(body.initData);
  if (!user) return res.status(200).json({ ok: false, delivered: false, message: 'Голосовать можно только из Telegram' });

  const { error } = await supabase
    .from('program_votes')
    .upsert({ event_id: eventId, telegram_id: user.id, option }, { onConflict: 'event_id,telegram_id' });

  if (error) return res.status(200).json({ ok: false, delivered: false, message: error.message });
  return res.status(200).json({ ok: true, delivered: true, message: 'Голос учтён' });
}

/** «Мне интересно» — копим спрос и сразу пингуем организаторов. */
async function handleInterest(body: any, res: any) {
  const { eventId, eventTitle } = body;
  if (!eventId) return res.status(400).json({ error: 'Missing eventId' });

  const user = verifyInitData(body.initData);
  const telegramId = user?.id ?? null;

  const { error } = await supabase.from('interests').upsert(
    { event_id: eventId, telegram_id: telegramId },
    { onConflict: 'event_id,telegram_id', ignoreDuplicates: true }
  );
  if (error) return res.status(200).json({ ok: false, delivered: false, message: error.message });

  const { count } = await supabase
    .from('interests')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', eventId);

  const who = user
    ? `${esc(user.first_name || '')} ${user.username ? '@' + esc(user.username) : ''}`
    : 'Гость с сайта';
  const delivered = await notifyAdmins(
    `👀 <b>Интерес к событию</b>\n${esc(eventTitle || eventId)}\n${who}\n\nВсего заинтересованных: <b>${count ?? '?'}</b>`
  );

  return res.status(200).json({ ok: true, delivered, count: count ?? 0 });
}

/** Отзыв после события. Один на человека, можно переписать. */
async function handleFeedback(body: any, res: any) {
  const { eventId, rating, wouldReturn, feedback } = body;
  if (!eventId || !rating) return res.status(400).json({ error: 'Missing eventId or rating' });

  const user = verifyInitData(body.initData);
  if (!user) return res.status(200).json({ ok: false, delivered: false, message: 'Отзыв можно оставить только из Telegram' });

  const { error } = await supabase.from('feedback').upsert(
    {
      event_id: eventId,
      telegram_id: user.id,
      rating: Math.max(1, Math.min(5, Number(rating))),
      would_return: wouldReturn === true,
      comment: String(feedback || '').slice(0, 2000) || null,
    },
    { onConflict: 'event_id,telegram_id' }
  );
  if (error) return res.status(200).json({ ok: false, delivered: false, message: error.message });

  const delivered = await notifyAdmins(
    `⭐ <b>Отзыв</b> ${'★'.repeat(Number(rating))}\n${esc(body.eventTitle || eventId)}\n` +
    `${esc(user.first_name || '')} ${user.username ? '@' + esc(user.username) : ''}\n` +
    `Придёт снова: ${wouldReturn ? 'да' : 'нет'}\n` +
    (feedback ? `\n<i>${esc(String(feedback).slice(0, 600))}</i>` : '')
  );

  return res.status(200).json({ ok: true, delivered });
}

/**
 * Проверка, что миграция 2026-final.sql применена: тыкаем каждую новую таблицу
 * и RPC. Читать схему посторонним незачем — поэтому под админ-токеном.
 * GET /api/events?action=health  (Authorization: Bearer <ADMIN_TOKEN>)
 */
async function handleHealth(res: any) {
  const tables = ['program_votes', 'interests', 'feedback', 'tasks', 'polls', 'poll_votes', 'bot_sessions', 'referrals', 'rides', 'ride_bookings', 'ride_requests'];
  const out: Record<string, string> = {};

  for (const t of tables) {
    const { error } = await supabase.from(t).select('*', { count: 'exact', head: true });
    out[t] = error ? `ОТСУТСТВУЕТ: ${error.message}` : 'ok';
  }

  // Новые колонки: выборка несуществующей колонки возвращает ошибку.
  const columnProbes: [string, string][] = [
    ['events', 'checklist'],
    ['events', 'deputy_id'],
    ['events', 'status_reason'],
    ['events', 'is_public'],
    ['members', 'agreed_pd'],
    ['members', 'ref_code'],
    ['registrations', 'attended'],
    ['registrations', 'days'],
    ['registrations', 'reminded_at'],
  ];
  for (const [table, column] of columnProbes) {
    const { error } = await supabase.from(table).select(column).limit(1);
    out[`${table}.${column}`] = error ? `ОТСУТСТВУЕТ: ${error.message}` : 'ok';
  }

  // RPC: вызываем с заведомо несуществующей поездкой — интересен только факт,
  // что функция найдена (тогда вернётся 'gone', а не ошибка «не существует»).
  const { data: bookRes, error: bookErr } = await supabase.rpc('book_ride_seat', { p_ride_id: -1, p_passenger: -1, p_name: 'probe' });
  out['rpc:book_ride_seat'] = bookErr ? `ОТСУТСТВУЕТ: ${bookErr.message}` : `ok (вернул «${bookRes}»)`;

  const { error: cancelErr } = await supabase.rpc('cancel_ride_seat', { p_ride_id: -1, p_passenger: -1 });
  out['rpc:cancel_ride_seat'] = cancelErr ? `ОТСУТСТВУЕТ: ${cancelErr.message}` : 'ok';

  const { error: pointsErr } = await supabase.rpc('award_points', { tg: -1, n: 0 });
  out['rpc:award_points'] = pointsErr ? `ОТСУТСТВУЕТ: ${pointsErr.message}` : 'ok';

  // Одного чтения мало: при включённом RLS без политик select молча вернёт
  // пустой список (выглядит как «ok»), а insert упадёт. Данные теряются тихо.
  // Поэтому каждую таблицу, в которую бот и сайт ПИШУТ, проверяем записью.
  const PROBE = -999999;
  const writeProbes: [string, Record<string, unknown>, Record<string, unknown>][] = [
    ['bot_sessions', { telegram_id: PROBE, state: 'probe' }, { telegram_id: PROBE }],
    ['program_votes', { event_id: '__probe__', telegram_id: PROBE, option: 'p' }, { telegram_id: PROBE }],
    ['interests', { event_id: '__probe__', telegram_id: PROBE }, { telegram_id: PROBE }],
    ['feedback', { event_id: '__probe__', telegram_id: PROBE, rating: 5 }, { telegram_id: PROBE }],
  ];

  for (const [table, row, key] of writeProbes) {
    // program_votes/interests/feedback ссылаются на events(id) — сначала нужен якорь.
    const needsEvent = 'event_id' in row;
    if (needsEvent) await supabase.from('events').upsert({ id: '__probe__', title: 'probe', date: '2000-01-01', location: 'probe' });

    const { error } = await supabase.from(table).insert(row);
    out[`${table}:WRITE`] = error ? `НЕ ПИШЕТСЯ: ${error.message}` : 'ok';
    if (!error) await supabase.from(table).delete().match(key);
    if (needsEvent) await supabase.from('events').delete().eq('id', '__probe__');
  }

  const broken = Object.entries(out).filter(([, v]) => v !== 'ok' && !v.startsWith('ok'));
  return res.status(200).json({ migrationApplied: broken.length === 0, checks: out });
}

/**
 * Картинка события отдельным ресурсом. В БД она лежит как data-URL (Base64),
 * а Telegram/Viber в og:image принимают только настоящий URL.
 */
async function handleImage(req: any, res: any) {
  const id = String(req.query.id || '');
  const { data: ev } = await supabase.from('events').select('image').eq('id', id).maybeSingle();
  const img = (ev as any)?.image || '';

  const m = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(img);
  if (!m) {
    // Картинки нет или это обычный путь — отправляем туда.
    if (img) { res.setHeader('Location', img); return res.status(302).end(); }
    return res.status(404).end();
  }
  const buf = Buffer.from(m[2], 'base64');
  res.setHeader('Content-Type', m[1]);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  return res.status(200).send(buf);
}

/**
 * Страница-приглашение с og-разметкой: /e/<id>?ref=<code>.
 * Именно её видит друг в Telegram/Viber — с большой картинкой, названием,
 * датой и описанием. Кнопка ведёт в бота, реф-код сохраняется.
 */
async function handleOg(req: any, res: any) {
  const id = String(req.query.id || '');
  const ref = String(req.query.ref || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 32);

  const { data: ev } = await supabase
    .from('events').select('id,title,description,date,date_label,location,image').eq('id', id).maybeSingle();

  if (!ev) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(404).send('<!doctype html><meta charset="utf-8"><title>Событие не найдено</title><p>Событие не найдено.</p>');
  }

  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const site = `https://${host}`;
  const imageUrl = (ev as any).image ? `${site}/api/events?action=image&id=${encodeURIComponent(id)}` : `${site}/assets/images/og-default.png`;
  const botUrl = `https://t.me/${BOT_USERNAME}?start=${ref ? `ref_${ref}_ev_${id}` : `event_${id}`}`;

  const title = `${(ev as any).title} — Живи в моменте`;
  const desc = [((ev as any).date_label || (ev as any).date), (ev as any).location]
    .filter(Boolean).join(' · ') + (((ev as any).description) ? ` — ${String((ev as any).description).slice(0, 160)}` : '');

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  return res.status(200).send(`<!doctype html>
<html lang="ru"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(imageUrl)}">
<meta property="og:image:width" content="1280">
<meta property="og:image:height" content="720">
<meta property="og:url" content="${esc(`${site}/e/${id}`)}">
<meta name="twitter:card" content="summary_large_image">
<style>
 body{margin:0;background:#0b0b0b;color:#fff;font-family:system-ui,-apple-system,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
 .card{max-width:520px;width:100%;background:#141414;border:1px solid #262626;border-radius:24px;overflow:hidden}
 .card img{width:100%;display:block;aspect-ratio:16/9;object-fit:cover}
 .body{padding:24px}
 h1{font-size:24px;margin:0 0 8px}
 p{color:#a3a3a3;font-size:14px;line-height:1.6;margin:0 0 20px}
 a{display:block;text-align:center;background:#E6FD3A;color:#000;font-weight:700;padding:16px;border-radius:14px;text-decoration:none}
</style>
</head><body>
<div class="card">
  ${(ev as any).image ? `<img src="${esc(imageUrl)}" alt="">` : ''}
  <div class="body">
    <h1>${esc((ev as any).title)}</h1>
    <p>${esc(desc)}</p>
    <a href="${esc(botUrl)}">Открыть в Telegram</a>
  </div>
</div>
<script>setTimeout(function(){location.href=${JSON.stringify(botUrl)}},1200)</script>
</body></html>`);
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method === 'GET') {
    if (req.query?.action === 'health') {
      if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
      return await handleHealth(res);
    }
    // Публичные: превью-страница приглашения и картинка события.
    if (req.query?.action === 'og') return await handleOg(req, res);
    if (req.query?.action === 'image') return await handleImage(req, res);
    try {
      const { data: events, error } = await supabase
        .from('events')
        .select('*')
        .order('date', { ascending: true });

      if (error) {
        console.error('Events error:', error);
        return res.status(500).json({ error: 'Failed to fetch events' });
      }

      return res.status(200).json({ events: (events || []).map(mapEventToCamelCase) });
    } catch (error) {
      console.error('Error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const action = body.action || req.query?.action;

      if (action === 'vote') return await handleVote(body, res);
      if (action === 'interest') return await handleInterest(body, res);
      if (action === 'feedback') return await handleFeedback(body, res);

      // Запись события — только для админа. Раньше эндпоинт был открыт всем.
      if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });

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
      // Колонки из поздних миграций шлём только если заданы.
      if (body.dateEnd) (eventData as any).date_end = body.dateEnd;
      if (body.houseQualities) (eventData as any).house_qualities = body.houseQualities;
      if (body.logistics) (eventData as any).logistics = body.logistics;
      if (body.paymentDetails) (eventData as any).payment_details = body.paymentDetails;
      if (body.checklist) (eventData as any).checklist = body.checklist;
      if (body.statusReason !== undefined) (eventData as any).status_reason = body.statusReason;
      if (body.decisionDeadline !== undefined) (eventData as any).decision_deadline = body.decisionDeadline;

      const { data: event, error } = await supabase
        .from('events')
        .upsert(eventData, { onConflict: 'id' })
        .select()
        .single();

      if (error) {
        console.error('Event save error:', error);
        return res.status(500).json({ error: 'Failed to save event', details: error.message });
      }

      return res.status(200).json({ success: true, event: mapEventToCamelCase(event) });
    } catch (error) {
      console.error('Error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
