import { createClient } from '@supabase/supabase-js';
import * as crypto from 'crypto';

// Хелперы задублированы с api/register.ts НАМЕРЕННО: общий api/_lib/ роняет
// функции на Vercel в рантайме (FUNCTION_INVOCATION_FAILED). Не выносить.

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

function escapeHtml(text: string): string {
  return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

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

/** Структурированный лог: одна JSON-строка на событие — greppable в Vercel. */
function slog(level: 'info' | 'warn' | 'error', msg: string, err?: any) {
  const line: any = { t: new Date().toISOString(), level, scope: 'events', msg };
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
    telegramImage: event.telegram_image || undefined,
    maxParticipants: event.max_participants,
    participantsCount: event.participants_count,
    // Состав события: имя/пол/костяк каждого записавшегося (см. сборку выше).
    participants: event.participants || [],
    // Моя машина на этом событии: водитель, попутчики, точка выезда.
    myRide: event.my_ride || null,
    // Мой бади (или двое — в нечётной связке): за кого я отвечаю на событии.
    myBuddies: event.my_buddies || [],
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
    // Кто отвечает за выезд: участник должен видеть это в карточке, а не
    // выяснять в переписке. Имя подставляется в обработчике списка.
    organizerId: event.deputy_id || null,
    organizerName: event.organizer_name || null,
    organizerAvatar: event.deputy_id ? avatarUrl(Number(event.deputy_id)) : '',
    organizerUsername: event.organizer_username || '',
    lockedHint: event.locked_hint,
    program: event.program || [],
    notifications: event.notifications || {},
    /**
     * Челлендж это или выезд. Флаг приходит явно, а не выводится на клиенте
     * из `notifications._format`: фронту нужно решение «рисовать пульсирующую
     * карточку марафона вместо обычной афиши», и оно должно быть в одном
     * месте, а не размазано по условиям в трёх компонентах.
     */
    isChallenge: (event.notifications || {})._format === 'challenge' || (event.notifications || {}).is_challenge === true,
    programVoting: event.program_voting,
    createdAt: event.created_at,
    updatedAt: event.updated_at
  };
}

/** Голос за вариант программы. Один голос на человека, переголосование разрешено. */
async function handleVote(body: any, res: any) {
  const { eventId, option } = body;
  if (!eventId || !option) return res.status(400).json({ error: 'Missing eventId or option' });

  const user = verifyInitData(body.initData, BOT_TOKEN);
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

  const user = verifyInitData(body.initData, BOT_TOKEN);
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
    ? `${escapeHtml(user.first_name || '')} ${user.username ? '@' + escapeHtml(user.username) : ''}`
    : 'Гость с сайта';
  const delivered = await notifyAdmins(
    `👀 <b>Интерес к событию</b>\n${escapeHtml(eventTitle || eventId)}\n${who}\n\nВсего заинтересованных: <b>${count ?? '?'}</b>`
  );

  return res.status(200).json({ ok: true, delivered, count: count ?? 0 });
}

/** Отзыв после события. Один на человека, можно переписать. */
async function handleFeedback(body: any, res: any) {
  const { eventId, rating, wouldReturn, feedback } = body;
  if (!eventId || !rating) return res.status(400).json({ error: 'Missing eventId or rating' });

  const user = verifyInitData(body.initData, BOT_TOKEN);
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
    `⭐ <b>Отзыв</b> ${'★'.repeat(Number(rating))}\n${escapeHtml(body.eventTitle || eventId)}\n` +
    `${escapeHtml(user.first_name || '')} ${user.username ? '@' + escapeHtml(user.username) : ''}\n` +
    `Придёт снова: ${wouldReturn ? 'да' : 'нет'}\n` +
    (feedback ? `\n<i>${escapeHtml(String(feedback).slice(0, 600))}</i>` : '')
  );

  return res.status(200).json({ ok: true, delivered });
}

/**
 * Проверка, что миграция 2026-final.sql применена: тыкаем каждую новую таблицу
 * и RPC. Читать схему посторонним незачем — поэтому под админ-токеном.
 * GET /api/events?action=health  (Authorization: Bearer <ADMIN_TOKEN>)
 *
 * ВАЖНО про пробы записи: раньше «якорное» событие создавалось с id='__probe__',
 * а строки — с telegram_id=-999999. Живые таблицы при этом всё равно
 * трогались (лишний insert+delete на каждый вызов), и если удаление не
 * проходило (RLS, таймаут, ошибка прав), в проде оставался мусор. Теперь все
 * служебные идентификаторы начинаются с `__probe` и удаляются ДО вставки —
 * так повторный вызов не может наткнуться на собственный хвост.
 */
const PROBE_EVENT_ID = '__probe_health__';
const PROBE_TG_ID = -999999999;
const PROBE_PREFIX = '__probe';

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
  const writeProbes: [string, Record<string, unknown>, Record<string, unknown>][] = [
    ['bot_sessions', { telegram_id: PROBE_TG_ID, state: 'probe' }, { telegram_id: PROBE_TG_ID }],
    ['program_votes', { event_id: PROBE_EVENT_ID, telegram_id: PROBE_TG_ID, option: 'p' }, { telegram_id: PROBE_TG_ID }],
    ['interests', { event_id: PROBE_EVENT_ID, telegram_id: PROBE_TG_ID }, { telegram_id: PROBE_TG_ID }],
    ['feedback', { event_id: PROBE_EVENT_ID, telegram_id: PROBE_TG_ID, rating: 5 }, { telegram_id: PROBE_TG_ID }],
  ];

  // Уборка хвостов ПЕРЕД пробами: если прошлый вызов упал между вставкой и
  // удалением, мусор снимается здесь, а не остаётся навсегда.
  try {
    await supabase.from('events').delete().eq('id', PROBE_EVENT_ID);
    for (const [table, , key] of writeProbes) await supabase.from(table).delete().match(key);
  } catch { /* таблицы может не быть — ниже это и выяснится */ }

  for (const [table, row, key] of writeProbes) {
    // program_votes/interests/feedback ссылаются на events(id) — сначала нужен якорь.
    const needsEvent = 'event_id' in row;
    if (needsEvent) {
      await supabase.from('events').delete().eq('id', PROBE_EVENT_ID);
      await supabase.from('events').upsert({ id: PROBE_EVENT_ID, title: `${PROBE_PREFIX} health`, date: '2000-01-01', location: PROBE_PREFIX });
    }

    const { error } = await supabase.from(table).insert(row);
    out[`${table}:WRITE`] = error ? `НЕ ПИШЕТСЯ: ${error.message}` : 'ok';
    if (!error) await supabase.from(table).delete().match(key);
    if (needsEvent) await supabase.from('events').delete().eq('id', PROBE_EVENT_ID);
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
  // kind=telegram → вертикальная афиша (telegram_image) для шеринга; иначе обычная.
  // Афиши грузятся как data:-URL (base64) — Telegram их не тянет напрямую, поэтому
  // отдаём байтами через этот прокси (публичный URL). Фолбэк на обычную картинку.
  const kind = String(req.query.kind || '');
  const { data: ev } = await supabase.from('events').select('image,telegram_image').eq('id', id).maybeSingle();
  const img = (kind === 'telegram' ? ((ev as any)?.telegram_image || (ev as any)?.image) : (ev as any)?.image) || '';

  const m = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(img);
  if (!m) {
    // Картинки нет или это обычный путь — отправляем туда. Редирект допускаем
    // ТОЛЬКО на свой относительный путь или https-адрес: иначе поле image из
    // админки превращало «картинку события» в открытый редирект на чужой сайт
    // (ссылка в og:image, фишинг с нашего домена).
    const safe = /^\/(?!\/)/.test(img) ? img : (/^https:\/\//i.test(img) ? img : '');
    if (safe) { res.setHeader('Location', safe); return res.status(302).end(); }
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
/**
 * Прокси медиа из Telegram. Стримим содержимое сами: redirect на
 * file-URL Telegram недопустим — путь содержит токен бота.
 *
 * ПОДПИСЬ ОБЯЗАТЕЛЬНА. Раньше отдавали любой file_id, который прислали в
 * `fid`, — и прокси превращался в открытый CDN на нашем боте: кто угодно мог
 * раздавать через клубный домен и клубный токен свои файлы (чужие фото,
 * пиратское видео), а лимиты функции тратились на чужой трафик. Ссылки в
 * галерее выдаёт сервер, значит он же их и подписывает; фронту ничего не
 * нужно — он получает готовый `src` из media_list/stories.
 */
async function handleMedia(req: any, res: any) {
  const fid = String(req.query?.fid || '');
  const sig = String(req.query?.s || '');
  const evId = String(req.query?.id || '');
  if (!fid || !BOT_TOKEN) return res.status(400).end();
  if (!mediaSigValid(fid, sig)) return res.status(403).end();
  /**
   * Медиа принадлежит событию. Без этой привязки подписанная ссылка на своё
   * видео (её видно в разметке галереи) открывала ЛЮБОЙ файл клуба: взял
   * чужой file_id из своей галереи — и смотришь состав/чеки другого выезда.
   * `id` приходит в ссылке бесплатно, а `file_id` события лежит в event_media.
   */
  if (evId) {
    const { data: owned } = await supabase
      .from('event_media').select('id').eq('event_id', evId).eq('file_id', fid).limit(1).maybeSingle();
    if (!owned) return res.status(403).end();
  }
  try {
    const gf = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: fid }),
    }).then((r) => r.json());
    const path = gf?.result?.file_path;
    if (!path) return res.status(404).end();
    const fr = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${path}`);
    if (!fr.ok) return res.status(404).end();
    const buf = Buffer.from(await fr.arrayBuffer());
    // Лимит ответа Vercel-функции — держим запас (фото Telegram сжимает до ~300КБ).
    if (buf.length > 8 * 1024 * 1024) return res.status(413).end();
    res.setHeader('Content-Type', fr.headers.get('content-type') || (path.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg'));
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    return res.status(200).send(buf);
  } catch {
    return res.status(502).end();
  }
}

/**
 * АВАТАРКИ УЧАСТНИКОВ.
 * Состав события был списком прямоугольных плашек с буквой — людей не
 * узнать в лицо. Фото берём у Telegram (getUserProfilePhotos): бот видит
 * аватарку, если человек не спрятал её настройками приватности.
 * Как и медиа — стримим через функцию: прямой URL файла содержит BOT TOKEN.
 * Ссылка подписана (s = HMAC от id), поэтому прокси отдаёт только тех, кого
 * сервер сам показал в составе, а не любой telegram_id по перебору.
 * Кэш — сутки на CDN Vercel: аватарки меняются редко, функция не дёргается.
 */
function avatarSig(id: number): string {
  return crypto.createHmac('sha256', BOT_TOKEN).update(`avatar:${id}`).digest('hex').slice(0, 16);
}
function avatarUrl(id: number): string {
  return id > 0 && BOT_TOKEN ? `/api/events?action=avatar&u=${id}&s=${avatarSig(id)}` : '';
}

/**
 * Подпись медиафайла Telegram (`file_id`). Тот же приём, что у аватарок:
 * file_id неугадываем сам по себе, но утекает в разметке галереи; подпись
 * закрывает прокси от использования как чужого файлохранилища.
 */
function mediaSig(fid: string): string {
  return crypto.createHmac('sha256', BOT_TOKEN).update(`media:${fid}`).digest('hex').slice(0, 16);
}
function mediaSigValid(fid: string, sig: string): boolean {
  if (!BOT_TOKEN || sig.length !== 16) return false;
  const a = Buffer.from(sig), b = Buffer.from(mediaSig(fid));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
/** Подписанная ссылка на прокси медиа — единая точка для всех вызовов.
 *  `eventId` добавляется, когда файл привязан к событию: прокси тогда ещё и
 *  сверяет, что file_id действительно принадлежит этому событию (см. handleMedia).
 *
 *  ВАЖНО: URL медиа собирается из `file_id` — то есть из данных, которые
 *  пришли от Telegram, но в общем случае форму не гарантируют (например,
 *  file_id от кнопки support/чека). В HTML его подставляют и в атрибут src,
 *  и в строку JS внутри onclick — сырые одинарные кавычки там ломают
 *  разметку и позволяют внедрить свой скрипт в публичную страницу галереи.
 *  Поэтому URL пропускаем через `mediaUrlSafe` (JS-контекст) или
 *  `escapeHtml` (HTML-контекст).
 */
function mediaUrl(fid: string, eventId?: string): string {
  if (!fid || !BOT_TOKEN) return '';
  const owner = eventId ? `&id=${encodeURIComponent(eventId)}` : '';
  return `/api/events?action=media&fid=${encodeURIComponent(fid)}&s=${mediaSig(fid)}${owner}`;
}

/** Тот же URL, но безопасный для подстановки в строку JS (onclick=…). */
function mediaUrlSafe(fid: string, eventId?: string): string {
  return mediaUrl(fid, eventId).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/</g, '\\x3c').replace(/\n/g, '');
}
async function handleAvatar(req: any, res: any) {
  const id = Number(req.query?.u || 0);
  const sig = String(req.query?.s || '');
  if (!id || !BOT_TOKEN || sig.length !== 16) return res.status(400).end();
  const a = Buffer.from(sig), b = Buffer.from(avatarSig(id));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(403).end();
  try {
    const ph = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getUserProfilePhotos`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: id, limit: 1 }),
    }).then((r) => r.json());
    const sizes: any[] = ph?.result?.photos?.[0] || [];
    // Нужен кружок ~40–64px: берём самый маленький размер не меньше 160px.
    const pick = sizes.find((x) => Number(x.width) >= 160) || sizes[sizes.length - 1];
    // Фото нет или скрыто — 404, фронт покажет букву. Кэшируем и отказ,
    // чтобы не спрашивать Telegram заново на каждом открытии карточки.
    if (!pick?.file_id) { res.setHeader('Cache-Control', 'public, s-maxage=21600, max-age=21600'); return res.status(404).end(); }
    const gf = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: pick.file_id }),
    }).then((r) => r.json());
    const path = gf?.result?.file_path;
    if (!path) return res.status(404).end();
    const fr = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${path}`);
    if (!fr.ok) return res.status(404).end();
    const buf = Buffer.from(await fr.arrayBuffer());
    res.setHeader('Content-Type', fr.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, s-maxage=86400, max-age=86400');
    return res.status(200).send(buf);
  } catch {
    return res.status(502).end();
  }
}

/**
 * JSON-список медиа события для встраивания в мини-приложение (История события).
 * GET /api/events?action=media_list&id=<eventId>
 * Возвращает { items: [{ id, media_type, src, votes }] }, где src — путь к прокси
 * /api/events?action=media&fid=..., который отдаёт сам файл из Telegram.
 */
async function handleMediaList(req: any, res: any) {
  const evId = String(req.query?.id || '');
  if (!evId) return res.status(400).json({ error: 'Missing id' });
  const { data: media, error } = await supabase
    .from('event_media').select('id,file_id,media_type,votes')
    .eq('event_id', evId)
    .order('votes', { ascending: false }).order('created_at', { ascending: true })
    .limit(200);
  if (error) return res.status(500).json({ error: error.message });
  const items = (media || []).map((m: any) => ({
    id: m.id,
    media_type: m.media_type === 'video' ? 'video' : 'photo',
    votes: m.votes || 0,
    src: mediaUrl(m.file_id),
  }));
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ items });
}

/** Галерея события: мобильная страница с голосованием (открывается как Mini App из бота). */
async function handleGallery(req: any, res: any) {
  const evId = String(req.query?.id || '');
  if (!evId) return res.status(400).send('Missing id');
  const { data: ev } = await supabase.from('events').select('title,date').eq('id', evId).maybeSingle();
  const { data: media } = await supabase
    .from('event_media').select('id,file_id,media_type,votes')
    .eq('event_id', evId)
    .order('votes', { ascending: false }).order('created_at', { ascending: true })
    .limit(300);
  const title = escapeHtml(ev?.title || 'Событие');
  const cards = (media || []).map((m: any) => {
    // Два представления одного URL: HTML-атрибут экранируем как HTML, строку
    // внутри onclick — как JS. Без этого кавычка в file_id ломает страницу.
    const src = escapeHtml(mediaUrl(m.file_id, evId));
    const srcJs = mediaUrlSafe(m.file_id, evId);
    const isVideo = m.media_type === 'video';
    // Превью в сетке — тап открывает на весь экран (и фото, и видео).
    const inner = isVideo
      ? `<video src="${src}" preload="metadata" playsinline muted></video><span class="play">▶</span>`
      : `<img src="${src}" loading="lazy" alt="">`;
    return `<figure data-id="${escapeHtml(String(m.id))}">`
      + `<div class="thumb" onclick="openLb('${srcJs}','${isVideo ? 'video' : 'photo'}')">${inner}</div>`
      + `<button class="vote" onclick="vote(this,'${escapeHtml(String(m.id))}')">❤️ <span>${Number(m.votes) || 0}</span></button>`
      + `<button class="del" onclick="del(this,'${escapeHtml(String(m.id))}')" title="Удалить">🗑</button>`
      + `</figure>`;
  }).join('');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(`<!doctype html><html lang="ru"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>📸 ${title}</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
  body{margin:0;background:#0d0f0c;color:#e8ffe0;font:15px/1.4 -apple-system,system-ui,sans-serif}
  header{padding:16px;position:sticky;top:0;background:#0d0f0ccc;backdrop-filter:blur(8px);z-index:2}
  h1{margin:0;font-size:17px} p{margin:4px 0 0;color:#9fb098;font-size:13px}
  .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:6px;padding:6px}
  @media(min-width:640px){.grid{grid-template-columns:repeat(3,1fr)}}
  figure{margin:0;position:relative;aspect-ratio:1;overflow:hidden;border-radius:12px;background:#1a1e17}
  .thumb{width:100%;height:100%;cursor:zoom-in}
  figure img,figure video{width:100%;height:100%;object-fit:cover;display:block}
  .play{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-size:26px;color:#fff;text-shadow:0 2px 8px #000;pointer-events:none}
  .vote{position:absolute;right:6px;bottom:6px;border:0;border-radius:20px;padding:5px 10px;background:#000a;color:#fff;font-size:13px;cursor:pointer}
  .vote.on{background:#e6fd3a;color:#000}
  .del{display:none;position:absolute;left:6px;top:6px;border:0;border-radius:20px;padding:5px 9px;background:#000a;color:#fff;font-size:13px;cursor:pointer}
  body.admin .del{display:block}
  .empty{padding:48px 24px;text-align:center;color:#9fb098}
  /* Лайтбокс на весь экран */
  #lb{display:none;position:fixed;inset:0;z-index:10;background:#000e;align-items:center;justify-content:center}
  #lb.on{display:flex}
  #lb img,#lb video{max-width:100vw;max-height:100vh;object-fit:contain}
  #lb .close{position:fixed;right:12px;top:12px;font-size:28px;color:#fff;background:#0006;border:0;border-radius:50%;width:44px;height:44px;cursor:pointer}
</style></head><body>
<header><h1>📸 ${title}</h1><p>Тапни кадр, чтобы открыть на весь экран. ❤️ — за лучшие: топ-5 останется в истории события.</p></header>
${cards ? `<div class="grid">${cards}</div>` : '<div class="empty">Пока пусто. Пришли боту фото с события — они появятся здесь.</div>'}
<div id="lb"><button class="close" onclick="closeLb()">✕</button><div id="lbc"></div></div>
<script>
var lb=document.getElementById('lb'), lbc=document.getElementById('lbc');
function openLb(src,type){
  lbc.innerHTML = type==='video'
    ? '<video src="'+src+'" controls autoplay playsinline></video>'
    : '<img src="'+src+'" alt="">';
  lb.classList.add('on');
}
function closeLb(){ lb.classList.remove('on'); lbc.innerHTML=''; }
lb.addEventListener('click', function(e){ if(e.target===lb) closeLb(); });

async function vote(btn, id){
  const initData = window.Telegram?.WebApp?.initData || '';
  if(!initData){ btn.textContent='Голос — из Telegram'; return; }
  btn.disabled = true;
  try{
    const r = await fetch('/api/events', {method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({action:'media_vote', mediaId:id, initData})});
    const j = await r.json();
    if(j.votes !== undefined){ btn.querySelector('span').textContent = j.votes; btn.classList.add('on'); }
  }catch(e){}
  btn.disabled = false;
}

async function del(btn, id){
  const initData = window.Telegram?.WebApp?.initData || '';
  if(!initData) return;
  if(!confirm('Удалить этот кадр из галереи? Действие необратимо.')) return;
  btn.disabled = true;
  try{
    const r = await fetch('/api/events', {method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({action:'media_delete', mediaId:id, initData})});
    if(r.ok){ const fig = btn.closest('figure'); if(fig) fig.remove(); }
    else { alert('Удалять кадры может только администратор.'); btn.disabled = false; }
  }catch(e){ btn.disabled = false; }
}

// Кнопки удаления показываем только ядру клуба (проверка по initData).
(async function(){
  const initData = window.Telegram?.WebApp?.initData || '';
  if(!initData) return;
  try{
    const r = await fetch('/api/events', {method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({action:'media_admin_check', initData})});
    const j = await r.json();
    if(j.admin) document.body.classList.add('admin');
  }catch(e){}
})();
window.Telegram?.WebApp?.expand?.();
</script></body></html>`);
}

async function handleOg(req: any, res: any) {
  const id = String(req.query.id || '');
  const ref = String(req.query.ref || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 32);

  const { data: ev } = await supabase
    .from('events').select('id,title,description,date,date_label,location,image,telegram_image').eq('id', id).maybeSingle();

  if (!ev) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(404).send('<!doctype html><meta charset="utf-8"><title>Событие не найдено</title><p>Событие не найдено.</p>');
  }

  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const site = `https://${host}`;
  // Превью ссылки: приоритет — вертикальная афиша (telegram_image), иначе обычная.
  const imageUrl = (ev as any).telegram_image
    ? `${site}/api/events?action=image&id=${encodeURIComponent(id)}&kind=telegram`
    : ((ev as any).image ? `${site}/api/events?action=image&id=${encodeURIComponent(id)}` : `${site}/assets/images/og-default.png`);
  const botUrl = `https://t.me/${BOT_USERNAME}?start=${ref ? `ref_${ref}_ev_${id}` : `event_${id}`}`;

  const title = `Живи в моменте: ${(ev as any).title}`;
  // Описание для превью: схлопываем пробелы/переносы и режем по границе слова,
  // иначе в OG-карточке текст рвётся посреди слова (была «каша» в пересылке).
  const dateLabel = String((ev as any).date_label || (ev as any).date || '');
  const rawDesc = String((ev as any).description || '').replace(/\s+/g, ' ').trim();
  let shortDesc = rawDesc.slice(0, 120);
  if (rawDesc.length > 120) {
    const sp = shortDesc.lastIndexOf(' ');
    if (sp > 40) shortDesc = shortDesc.slice(0, sp);
    shortDesc += '…';
  }
  const desc = `📅 ${dateLabel}${shortDesc ? ` — ${shortDesc}` : ''} Присоединяйся! 🏕`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  return res.status(200).send(`<!doctype html>
<html lang="ru"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(desc)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(desc)}">
<meta property="og:image" content="${escapeHtml(imageUrl)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="${escapeHtml(`${site}/e/${id}`)}">
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
  ${(ev as any).image ? `<img src="${escapeHtml(imageUrl)}" alt="">` : ''}
  <div class="body">
    <h1>${escapeHtml((ev as any).title)}</h1>
    <p>${escapeHtml(desc)}</p>
    <a href="${escapeHtml(botUrl)}">✅ Забронировать место</a>
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

/* ═════════════════ ПОСТУПКИ С СОБЫТИЙ («кто что сделал») ═══════════════════
 * Дублировано из api/_lib/contributions.ts НАМЕРЕННО: общий api/_lib/ роняет
 * функции на Vercel в рантайме (MODULE_NOT_FOUND, тот же фикс, что для
 * reputation/group-ban — см. комментарий в начале файла). Правь ОБА файла.
 *
 * Здесь только ПОДТВЕРЖДЕНИЕ и ОТКЛОНЕНИЕ: сам разбор переписки живёт в вебхуке,
 * потому что только он видит сообщения. Этот файл обслуживает админку.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Что может подтвердить организатор: ТОЛЬКО зелёные сигналы. */
const CONTRIB_KINDS: Record<string, { points: number; hint: string }> = {
  role_done:     { points: 10, hint: 'Взял роль и довёл до конца' },
  helped:        { points: 10, hint: 'Помог другим делом: вытащил, подвёз, починил, делился' },
  calm_conflict: { points: 12, hint: 'Погасил конфликт или разрулил сложную ситуацию' },
  staff_done:    { points: 12, hint: 'Отработал помощником организатора' },
  growth:        { points: 10, hint: 'Вышел за свой предел, справился с новым' },
  driver:        { points: 8,  hint: 'Вёз людей на своей машине' },
  brought:       { points: 8,  hint: 'Привёл в клуб нового человека' },
  paid_on_time:  { points: 6,  hint: 'Внёс взнос вовремя и без напоминаний' },
};

/**
 * ПОДТВЕРЖДЕНИЕ — единственное место, где поступок становится репутацией.
 * Сигнал пишем как «organizer»: он там был и отвечает за слово. Источник «ai»
 * весит в 3 раза меньше — ровно чтобы пометка парсера не значила ничего без
 * человека.
 */
async function confirmContribution(id: number, byId: number): Promise<{ ok: boolean; error?: string; points?: number; already?: boolean }> {
  const { data: row } = await supabase.from('event_contributions')
    .select('id,event_id,subject_id,kind,title,status,points_awarded').eq('id', id).maybeSingle();
  if (!row) return { ok: false, error: 'not-found' };
  const c = row as any;
  if (c.status === 'confirmed') return { ok: true, already: true, points: Number(c.points_awarded) || 0 };
  if (Number(c.subject_id) === Number(byId)) return { ok: false, error: 'self' };
  const def = CONTRIB_KINDS[c.kind];
  if (!def) return { ok: false, error: 'unknown-kind' };

  // Вес сигнала — те же значения, что в REP_SIGNALS вебхука и в reputation.ts.
  const weight = def.points >= 12 ? 10 : def.points >= 10 ? 9 : def.points >= 8 ? 6 : 5;
  const { error: sigErr } = await supabase.from('reputation_events').insert({
    subject_id: Number(c.subject_id), author_id: byId, event_id: String(c.event_id),
    kind: c.kind, polarity: 1, weight, source: 'organizer', note: String(c.title).slice(0, 1000),
  });
  if (sigErr && !/duplicate key|23505/i.test(sigErr.message)) return { ok: false, error: sigErr.message };

  // Баллы. Минимум 5: поступок не может весить меньше, чем просто приехать.
  const points = Math.max(5, Number(def.points) || 5);
  const { data: m } = await supabase.from('members').select('points').eq('telegram_id', Number(c.subject_id)).maybeSingle();
  if (m) {
    await supabase.from('members').update({ points: Number((m as any).points || 0) + points }).eq('telegram_id', Number(c.subject_id));
    try {
      await supabase.from('points_log').insert({
        telegram_id: Number(c.subject_id), event_id: c.event_id,
        reason: 'contribution', points, description: `Поступок на событии: ${c.title}`,
      });
    } catch { /* журнала может не быть до миграции */ }
  }

  await supabase.from('event_contributions').update({
    status: 'confirmed', reviewed_by: byId, reviewed_at: new Date().toISOString(), points_awarded: points,
  }).eq('id', id);

  return { ok: true, points };
}

/**
 * ОТКЛОНЕНИЕ. Строку НЕ удаляем: при следующем разборе тех же сообщений она
 * удержит эпизод от повторного появления, и организатора не спросят дважды.
 */
async function rejectContribution(id: number, byId: number): Promise<{ ok: boolean; error?: string }> {
  const { data: row } = await supabase.from('event_contributions').select('id,status').eq('id', id).maybeSingle();
  if (!row) return { ok: false, error: 'not-found' };
  if ((row as any).status === 'confirmed') return { ok: false, error: 'already-confirmed' };
  const { error } = await supabase.from('event_contributions')
    .update({ status: 'rejected', reviewed_by: byId, reviewed_at: new Date().toISOString() }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * ЧЕК-ИНЫ ЧЕЛЛЕНДЖА — «утро засчитано».
 *
 * GET ?action=checkins&id=<eventId>  → { days: [{ date, time, telegram_id }], me, streak, done_today }
 *
 * Почему отдельная ручка, а не колонка в events. Челлендж идёт 90 дней и
 * каждый день приносит по отметке на человека: в jsonb-флаге события это
 * превратилось бы в растущий на тысячи записей блоб, который нельзя ни
 * проиндексировать, ни посчитать. Отметки уже лежат в app_config строками
 * `challenge_checkin:<eventId>:<telegramId>:<YYYY-MM-DD>` — их пишет вебхук,
 * когда человек присылает видео-кружок в чат. Здесь мы их отдаём наружу.
 *
 * Приватность: отдаём ДНИ и ВРЕМЯ подъёма, но не имена всех участников.
 * Личная серия чужих людей — не предмет витрины; организатор смотрит полную
 * картину в админке, а участник видит свои отметки и общий счёт дней.
 */
async function handleCheckins(req: any, res: any) {
  const eventId = String(req.query?.id || '');
  if (!eventId) return res.status(400).json({ error: 'missing_id' });

  // Кто смотрит: без подписи Telegram отдаём только обезличенные дни
  // (для публичной карточки челленджа на главной).
  const user = verifyInitData(String(req.headers['x-telegram-init-data'] || ''), BOT_TOKEN);
  const viewerId = Number(user?.id) || 0;

  const { data: rows, error } = await supabase
    .from('app_config')
    .select('key,value')
    .ilike('key', `challenge_checkin:${eventId}:%`)
    .limit(20000);
  if (error) return res.status(200).json({ days: [], me: 0, streak: 0, done_today: false });

  /**
   * Один человек мог «отметиться» дважды за день, если перешлёт кружок
   * повторно, — ключ строки один и тот же, поэтому дублей в базе не бывает.
   * Разбираем ключ вручную: value у app_config — текст, не jsonb.
   */
  const days: Array<{ date: string; time?: string; telegram_id?: number }> = [];
  let mine = 0;
  for (const r of rows || []) {
    const parts = String((r as any).key).split(':');
    // challenge_checkin : <eventId> : <telegramId> : <YYYY-MM-DD>
    const tgId = Number(parts[2]);
    const date = String(parts[3] || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    let parsed: any = null;
    try { parsed = typeof (r as any).value === 'string' ? JSON.parse((r as any).value) : (r as any).value; } catch { parsed = null; }
    if (viewerId && tgId === viewerId) mine += 1;
    days.push({ date, time: parsed?.time || undefined, telegram_id: viewerId ? tgId : undefined });
  }

  // Дубли по дате (разные люди в один день) склеиваем: карточке нужен
  // календарь дней челленджа, а не список людей.
  const byDate = new Map<string, { date: string; time?: string; telegram_id?: number }>();
  for (const d of days.sort((a, b) => (a.date < b.date ? -1 : 1))) {
    if (!byDate.has(d.date)) byDate.set(d.date, d);
  }
  const uniqueDays = Array.from(byDate.values());

  // Серия считаем здесь, а не на клиенте: клиент мог сутки не открывать
  // приложение, и его локальный кэш покажет неверный стрик.
  const today = new Date().toISOString().slice(0, 10);
  const set = new Set(uniqueDays.map((d) => d.date));
  let streak = 0;
  const cursor = new Date(`${today}T00:00:00Z`);
  for (let i = 0; i < 400; i += 1) {
    const ymd = cursor.toISOString().slice(0, 10);
    if (!set.has(ymd)) break;
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  return res.status(200).json({
    days: uniqueDays,
    me: mine,
    streak,
    done_today: set.has(today),
  });
}

/**
 * ПРОГРЕСС ЧЕЛЛЕНДЖА ПО УЧАСТНИКАМ — для таблицы в карточке события.
 *
 * GET ?action=checkins_grouped&id=<eventId>
 *   → { participants: [{ telegram_id, name, avatar, days: [{date, time}] }] }
 *
 * Группирует чек-ины по telegram_id, подтягивает имя и аватар из members.
 * Приватность: участники видны всем, кто открыл событие (как «Кто уже едет»).
 * Аватары и кружки НЕ храним — только метаданные; видео лежит в Telegram.
 */
async function handleCheckinsGrouped(req: any, res: any) {
  const eventId = String(req.query?.id || '');
  if (!eventId) return res.status(400).json({ error: 'missing_id' });

  const { data: rows, error } = await supabase
    .from('app_config')
    .select('key,value')
    .ilike('key', `challenge_checkin:${eventId}:%`)
    .limit(20000);
  if (error) return res.status(200).json({ participants: [] });

  // Собираем дни по человеку: { tgId: [{date, time}] }
  const byUser = new Map<number, { date: string; time?: string }[]>();
  for (const r of rows || []) {
    const parts = String((r as any).key).split(':');
    const tgId = Number(parts[2]);
    const date = String(parts[3] || '');
    if (!tgId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    let parsed: any = null;
    try { parsed = typeof (r as any).value === 'string' ? JSON.parse((r as any).value) : (r as any).value; } catch { parsed = null; }
    if (!byUser.has(tgId)) byUser.set(tgId, []);
    byUser.get(tgId)!.push({ date, time: parsed?.time || undefined });
  }
  if (!byUser.size) return res.status(200).json({ participants: [] });

  // Имена одним запросом по telegram_id (в members: first_name/last_name/username).
  const ids = Array.from(byUser.keys());
  const { data: members } = await supabase
    .from('members')
    .select('telegram_id,first_name,last_name,username')
    .in('telegram_id', ids)
    .limit(500);
  const meta = new Map<number, { name: string }>();
  for (const m of members || []) {
    const full = [m.first_name, m.last_name].filter(Boolean).join(' ') || (m.username ? `@${m.username}` : '');
    meta.set(Number((m as any).telegram_id), { name: full || 'Участник' });
  }

  const participants = ids.map((tgId) => ({
    telegram_id: tgId,
    name: meta.get(tgId)?.name || 'Участник',
    // Аватарка — подписанный прокси на фото из Telegram. Без неё таблица
    // прогресса показывала пустые кружки с первой буквой, хотя Avatar её ждёт.
    avatar: avatarUrl(tgId),
    days: (byUser.get(tgId) || []).sort((a, b) => (a.date < b.date ? -1 : 1)),
  }));

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ participants });
}

/**
 * СТОРИС ЧЕЛЛЕНДЖА — лента кружков участников.
 *
 * GET ?action=stories&id=<eventId>
 *   → { stories: [{ telegram_id, name, avatar, date, time, file_id, type, text }] }
 *
 * Хранение: кружок лежит в Telegram (file_id), прокси /api/events?action=media&fid=
 * отдаёт файл. В Supabase — только метаданные, чтобы 92 × N участников
 * не забивали память. Текстовые отчёты без видео отдаются с text.
 */
async function handleStories(req: any, res: any) {
  const eventId = String(req.query?.id || '');
  if (!eventId) return res.status(400).json({ error: 'missing_id' });

  const { data: rows, error } = await supabase
    .from('app_config')
    .select('key,value')
    .ilike('key', `challenge_checkin:${eventId}:%`)
    .limit(20000);
  if (error) return res.status(200).json({ stories: [] });

  const items: Array<{ telegram_id: number; date: string; time?: string; file_id?: string; type?: string; text?: string }> = [];
  for (const r of rows || []) {
    const parts = String((r as any).key).split(':');
    const tgId = Number(parts[2]);
    const date = String(parts[3] || '');
    if (!tgId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    let parsed: any = null;
    try { parsed = typeof (r as any).value === 'string' ? JSON.parse((r as any).value) : (r as any).value; } catch { parsed = null; }
    items.push({
      telegram_id: tgId,
      date,
      time: parsed?.time || undefined,
      file_id: parsed?.file_id || undefined,
      type: parsed?.type || undefined,
      text: parsed?.text || undefined,
    });
  }
  if (!items.length) return res.status(200).json({ stories: [] });

  // Имена (в members: first_name/last_name/username).
  const ids = Array.from(new Set(items.map((i) => i.telegram_id)));
  const { data: members } = await supabase
    .from('members')
    .select('telegram_id,first_name,last_name,username')
    .in('telegram_id', ids)
    .limit(500);
  const meta = new Map<number, { name: string }>();
  for (const m of members || []) {
    const full = [m.first_name, m.last_name].filter(Boolean).join(' ') || (m.username ? `@${m.username}` : '');
    meta.set(Number((m as any).telegram_id), { name: full || 'Участник' });
  }

  const stories = items
    .map((i) => ({
      telegram_id: i.telegram_id,
      name: meta.get(i.telegram_id)?.name || 'Участник',
      // Сторис рисует кружки участников — без аватара там всегда буква.
      avatar: avatarUrl(i.telegram_id),
      date: i.date,
      time: i.time,
      file_id: i.file_id,
      // Готовая подписанная ссылка на прокси: подпись считает сервер, клиент
      // только подставляет её в <video src>. Без неё прокси отдаёт 403.
      media: i.file_id ? mediaUrl(i.file_id, eventId) : '',
      type: i.type,
      text: i.text,
    }))
    .sort((a, b) => (a.date < b.date ? 1 : -1)); // новые сверху

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ stories });
}

/**
 * ПОСТУПКИ СОБЫТИЯ — «кто что сделал».
 *
 * GET  ?action=contributions&id=<eventId>   → список эпизодов (pending + история)
 * POST ?action=contribution_review          → { contributionId, decision, initData }
 *
 * ПОДТВЕРЖДАЕТ ОРГАНИЗАТОР события (events.deputy_id), а не весь костяк: он там
 * был и отвечает за свои слова. Организаторов много, и дёргать каждого чужими
 * выездами нельзя. Костяк видит всё, но решает не он.
 *
 * Эпизод, найденный ИИ, до подтверждения НЕ влияет ни на репутацию, ни на баллы:
 * модель ошибается и льстит, а цена ошибки — репутация живого человека.
 */
async function handleContributions(req: any, res: any) {
  if (!isAdmin(req)) {
    const user = verifyInitData(String(req.headers['x-telegram-init-data'] || ''), BOT_TOKEN);
    if (!user) return deny(res);
    const eventId0 = String(req.query?.id || '');
    if (!eventId0) return res.status(400).json({ error: 'missing_id' });
    // Участник видит ТОЛЬКО свои подтверждённые поступки (лента в профиле).
    // Красное и чужие основания ему не показываем — как и решено в reputation.ts.
    const { data, error } = await supabase
      .from('event_contributions')
      .select('id,event_id,kind,title,quote,status,points_awarded,created_at')
      .eq('event_id', eventId0)
      .eq('subject_id', user.id)
      .eq('status', 'confirmed')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) return res.status(200).json({ items: [], scope: 'self' });
    return res.status(200).json({ items: data || [], scope: 'self' });
  }

  const eventId = String(req.query?.id || '');
  if (!eventId) return res.status(400).json({ error: 'missing_id' });
  const { data: rows, error: rowsErr } = await supabase
    .from('event_contributions')
    .select('*')
    .eq('event_id', eventId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (rowsErr) return res.status(200).json({ items: [], pending: 0 });
  const items = rows || [];

  // Имена подтягиваем одним запросом: в списке нужен человек, а не telegram_id.
  const ids = [...new Set(items.map((x: any) => Number(x.subject_id)).filter(Boolean))];
  const nameById = new Map<number, string>();
  if (ids.length) {
    const { data: mem } = await supabase
      .from('members').select('telegram_id,first_name,last_name,username').in('telegram_id', ids);
    for (const m of mem || []) {
      const full = [m.first_name, m.last_name].filter(Boolean).join(' ') || (m.username ? `@${m.username}` : '');
      if (full) nameById.set(Number((m as any).telegram_id), full);
    }
  }
  return res.status(200).json({
    items: items.map((x: any) => ({ ...x, subjectName: nameById.get(Number(x.subject_id)) || `ID ${x.subject_id}` })),
    pending: items.filter((x: any) => x.status === 'pending').length,
  });
}

async function handleContributionReview(req: any, res: any) {
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const id = Number(body.contributionId);
  const decision = String(body.decision || '');
  if (!id || !['confirm', 'reject'].includes(decision)) return res.status(400).json({ error: 'bad_request' });

  const { data: row } = await supabase
    .from('event_contributions').select('event_id').eq('id', id).maybeSingle();
  if (!row) return res.status(404).json({ error: 'not_found' });

  // Кто решает: организатор события с Telegram-подписью либо админ-панель.
  let byId = 0;
  if (isAdmin(req)) {
    // В админку заходит костяк — подставляем организатора события, чтобы в
    // истории было видно, что решение принято от его лица.
    const { data: ev } = await supabase.from('events').select('deputy_id').eq('id', (row as any).event_id).maybeSingle();
    byId = Number((ev as any)?.deputy_id || 0);
    if (!byId) return res.status(400).json({ error: 'event_has_no_organizer' });
  } else {
    const user = verifyInitData(String(body.initData || ''), BOT_TOKEN);
    if (!user) return deny(res);
    const { data: ev } = await supabase.from('events').select('deputy_id').eq('id', (row as any).event_id).maybeSingle();
    if (Number((ev as any)?.deputy_id || 0) !== Number(user.id)) {
      return res.status(403).json({ error: 'organizer_only' });
    }
    byId = Number(user.id);
  }

  const r = decision === 'confirm'
    ? await confirmContribution(id, byId)
    : await rejectContribution(id, byId);
  if (!r.ok) return res.status(400).json({ error: r.error || 'failed' });
  return res.status(200).json({ ok: true, points: (r as any).points || 0 });
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
    // Галерея события и прокси медиа (file_id неугадываем, голос — только участникам).
    if (req.query?.action === 'gallery') return await handleGallery(req, res);
    if (req.query?.action === 'media_list') return await handleMediaList(req, res);
    if (req.query?.action === 'media') return await handleMedia(req, res);
    if (req.query?.action === 'avatar') return await handleAvatar(req, res);
    // Поступки события: «кто что сделал». Организатор подтверждает — только
    // тогда эпизод идёт в репутацию и приносит баллы.
    if (req.query?.action === 'contributions') return await handleContributions(req, res);
    if (req.query?.action === 'contribution_review') return await handleContributionReview(req, res);
    // Чек-ины челленджа: дни и время подъёма. Публично — без имён.
    if (req.query?.action === 'checkins') return await handleCheckins(req, res);
    if (req.query?.action === 'checkins_grouped') return await handleCheckinsGrouped(req, res);
    if (req.query?.action === 'stories') return await handleStories(req, res);

    // Афиша — СТРОГО для зарегистрированных участников клуба. Раньше список
    // отдавался публично, а затем пускал по одному реф-коду — так не-член видел
    // всю систему, не пройдя этапы. Владелец: закрыть жёстко. Теперь доступ дают
    // только: (а) подписанный Telegram initData участника approved/core, либо
    // (б) админ-кука. Голого реф-кода НЕДОСТАТОЧНО — сначала вступление в боте.
    // Кто смотрит афишу — нужно, чтобы показать ЕГО машину и попутчиков.
    let viewerId = 0;
    if ((process.env.GATE_ENABLED ?? '1') !== '0') {
      let allowed = isAdmin(req);
      const user = allowed ? null : verifyInitData(String(req.headers['x-telegram-init-data'] || ''), BOT_TOKEN);
      if (user) {
        viewerId = Number(user.id) || 0;
        const { data: m } = await supabase
          .from('members').select('status,is_core').eq('telegram_id', user.id).maybeSingle();
        // Афишу видит любой принятый участник/костяк. Кодекс клуба НЕ требуем
        // здесь: раньше требовали prefs.rules_accepted, и одобренные кнопкой/
        // по реф-ссылке (у них кодекс не проставлен) упирались в «только для
        // участников» и не могли даже посмотреть события (баг 07.08, @iaevgen).
        // Принятие кодекса обязательно при ЗАПИСИ на событие (RegistrationGate),
        // где оно и уместно — там же пишется prefs.rules_accepted.
        allowed = !!m && (m.is_core === true || m.status === 'approved');
      }
      if (!allowed) return res.status(403).json({ error: 'members_only' });
    } else {
      const u = verifyInitData(String(req.headers['x-telegram-init-data'] || ''), BOT_TOKEN);
      viewerId = Number(u?.id) || 0;
    }
    try {
      const { data: events, error } = await supabase
        .from('events')
        .select('*')
        .order('date', { ascending: true });

      if (error) {
        slog('error', 'Events error', error);
        return res.status(500).json({ error: 'Failed to fetch events' });
      }

      // Единый источник правды по занятым местам — registrations, а не колонка
      // participants_count (её задавали руками и она расходилась с реальностью).
      // Каждая регистрация = сам участник (1) + его гости (guest_count).
      /**
       * Черновики (status='draft') на платформе не показываем: событие
       * появляется в афише только после одобрения костяком. Автор черновика
       * и костяк видят его, чтобы было что дорабатывать и что одобрять.
       */
      const { data: viewerRow } = viewerId
        ? await supabase.from('members').select('is_core,role').eq('telegram_id', viewerId).maybeSingle()
        : { data: null as any };
      const viewerIsCore = isAdmin(req) || (viewerRow as any)?.is_core === true || (viewerRow as any)?.role === 'owner';
      const visible = (events || []).filter((e: any) =>
        e.status !== 'draft' || viewerIsCore || Number(e.deputy_id) === viewerId);

      // Имя организатора — по одному запросу на всех, а не по событию.
      const orgIds = Array.from(new Set(visible.map((e: any) => Number(e.deputy_id)).filter((n: number) => Number.isFinite(n) && n > 0)));
      if (orgIds.length) {
        const { data: orgs } = await supabase
          .from('members').select('telegram_id,first_name,username').in('telegram_id', orgIds);
        const byId = new Map((orgs || []).map((m: any) => [Number(m.telegram_id), m.first_name || (m.username ? '@' + m.username : '')]));
        const userById = new Map((orgs || []).map((m: any) => [Number(m.telegram_id), m.username || '']));
        for (const e of visible as any[]) {
          if (e.deputy_id) {
            e.organizer_name = byId.get(Number(e.deputy_id)) || null;
            e.organizer_username = userById.get(Number(e.deputy_id)) || '';
          }
        }
      }

      const { data: regs } = await supabase
        .from('registrations').select('event_id, guest_count, telegram_id, name, equipment').neq('status', 'cancelled');
      const counts = new Map<string, number>();
      for (const r of regs || []) counts.set(r.event_id, (counts.get(r.event_id) || 0) + 1 + (Number((r as any).guest_count) || 0));

      /**
       * СОСТАВ события — «люди идут на людей». Раньше отдавали только цифру
       * «6 человек», и участники несколько раз писали: «а КТО вписался?
       * мужчины, женщины, семьи?» — без этого новому человеку непонятно,
       * его это круг или нет. Отдаём имя, пол и метку костяка: телефонов,
       * ников и прочих данных здесь нет, а сам эндпоинт закрыт клубным
       * гейтом выше — состав видят только принятые участники.
       */
      const memberIds = Array.from(new Set((regs || [])
        .map((r: any) => Number(r.telegram_id))
        .filter((id: number) => Number.isFinite(id) && id > 0)));
      const profile = new Map<number, { gender: string | null; isCore: boolean; firstName: string | null }>();
      if (memberIds.length) {
        const { data: mem } = await supabase
          .from('members').select('telegram_id, gender, is_core, first_name').in('telegram_id', memberIds);
        for (const m of mem || []) {
          profile.set(Number((m as any).telegram_id), {
            gender: (m as any).gender || null,
            isCore: (m as any).is_core === true,
            firstName: (m as any).first_name || null,
          });
        }
      }
      const roster = new Map<string, any[]>();
      for (const r of regs || []) {
        const p = profile.get(Number((r as any).telegram_id));
        const list = roster.get((r as any).event_id) || [];
        list.push({
          name: (r as any).name || p?.firstName || 'Участник',
          avatar: avatarUrl(Number((r as any).telegram_id)),
          // Что везёт на общее (из анкеты) — для блока «Кто что везёт».
          brings: Array.isArray((r as any).equipment) ? (r as any).equipment.map(String).slice(0, 12) : [],
          gender: p?.gender || null,
          isCore: p?.isCore || false,
          guests: Number((r as any).guest_count) || 0,
        });
        roster.set((r as any).event_id, list);
      }

      /**
       * «С кем я еду, где и во сколько выезд» — вопрос, который участники
       * задавали после записи чаще всего. Машина, попутчики и точка выезда
       * жили только в боте; на карточке события их не было.
       * Отдаём ТОЛЬКО свою машину: чужие брони — не наше дело.
       */
      const myRides = new Map<string, any>();
      const myEventIds = (regs || [])
        .filter((r: any) => Number(r.telegram_id) === viewerId)
        .map((r: any) => r.event_id);
      if (viewerId && myEventIds.length) {
        const { data: rides } = await supabase
          .from('rides')
          .select('id, event_id, driver_id, driver_name, seats_total, seats_taken, from_point, kind, active')
          .in('event_id', myEventIds)
          .eq('active', true);
        const rideIds = (rides || []).map((r: any) => r.id);
        const { data: books } = rideIds.length
          ? await supabase.from('ride_bookings').select('ride_id, passenger_id, passenger_name').in('ride_id', rideIds)
          : { data: [] as any[] };
        for (const ride of (rides || []) as any[]) {
          if (ride.kind === 'tent') continue;
          const pax = (books || []).filter((b: any) => b.ride_id === ride.id);
          const iDrive = Number(ride.driver_id) === viewerId;
          const iRide = pax.some((b: any) => Number(b.passenger_id) === viewerId);
          if (!iDrive && !iRide) continue;
          myRides.set(ride.event_id, {
            role: iDrive ? 'driver' : 'passenger',
            driverName: ride.driver_name || 'Водитель',
            fromPoint: ride.from_point || '',
            seatsTotal: Number(ride.seats_total) || 0,
            seatsTaken: Number(ride.seats_taken) || 0,
            // Имена попутчиков: с кем именно человек поедет в одной машине.
            passengers: pax.map((b: any) => b.passenger_name || 'Участник'),
          });
        }
        // Телефон водителя — только тем, кто реально едет в этой машине.
        const driverIds = Array.from(new Set((rides || [])
          .filter((r: any) => myRides.has(r.event_id) && myRides.get(r.event_id).role === 'passenger')
          .map((r: any) => Number(r.driver_id))));
        if (driverIds.length) {
          const { data: drv } = await supabase.from('members').select('telegram_id, phone, username').in('telegram_id', driverIds);
          const byId = new Map((drv || []).map((d: any) => [Number(d.telegram_id), d]));
          for (const [evId, info] of myRides) {
            const ride = (rides || []).find((r: any) => r.event_id === evId);
            const d = ride ? byId.get(Number((ride as any).driver_id)) : null;
            if (d) myRides.set(evId, { ...info, driverPhone: d.phone || '', driverUsername: d.username || '' });
          }
        }
      }

      /**
       * «За кого я отвечаю» — бади. Правило человек принял на входе в клуб, и
       * до сих пор оно жило только текстом: напарника было негде посмотреть.
       * Отдаём ТОЛЬКО свою связку — чужие пары на карточке не нужны, их видно
       * в боте («🤝 Бади»). Связки собирает api/register.ts и крон.
       */
      const myBuddies = new Map<string, Array<{ name: string; username: string; avatar?: string }>>();
      if (viewerId && myEventIds.length) {
        const { data: mineRows } = await supabase
          .from('event_buddies').select('event_id,pair_id')
          .in('event_id', myEventIds).eq('telegram_id', viewerId);
        const pairIds = (mineRows || []).map((r: any) => String(r.pair_id));
        if (pairIds.length) {
          const { data: mateRows } = await supabase
            .from('event_buddies').select('event_id,pair_id,telegram_id')
            .in('event_id', myEventIds).in('pair_id', pairIds).neq('telegram_id', viewerId);
          const mateIds = Array.from(new Set((mateRows || []).map((r: any) => Number(r.telegram_id))));
          const byId = new Map<number, { name: string; username: string; avatar: string }>();
          if (mateIds.length) {
            const { data: mm } = await supabase
              .from('members').select('telegram_id, first_name, username').in('telegram_id', mateIds);
            for (const m of mm || []) {
              byId.set(Number((m as any).telegram_id), {
                name: String((m as any).first_name || 'Участник'),
                username: String((m as any).username || ''),
                avatar: avatarUrl(Number((m as any).telegram_id)),
              });
            }
          }
          for (const r of (mateRows || []) as any[]) {
            const info = byId.get(Number(r.telegram_id)) || { name: 'Участник', username: '' };
            myBuddies.set(String(r.event_id), [...(myBuddies.get(String(r.event_id)) || []), info]);
          }
        }
      }

      const withCounts = visible.map((e: any) => ({
        ...e,
        participants_count: counts.get(e.id) || 0,
        participants: roster.get(e.id) || [],
        my_ride: myRides.get(e.id) || null,
        my_buddies: myBuddies.get(e.id) || [],
      }));

      return res.status(200).json({ events: withCounts.map(mapEventToCamelCase) });
    } catch (error) {
      slog('error', 'Error', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const action = body.action || req.query?.action;

      // Публичные записи (голос/интерес/отзыв/голос за медиа) — 30 действий/мин с IP.
      if (['vote', 'interest', 'feedback', 'media_vote'].includes(action)) {
        const rl = await rateLimit('pub', clientIp(req), 30, 60 * 1000);
        if (!rl.allowed) {
          res.setHeader('Retry-After', String(rl.retryAfter));
          return res.status(429).json({ error: 'Слишком часто. Подожди немного.' });
        }
      }

      // Голос за кадр в галерее: только участник клуба, один голос на файл.
      if (action === 'media_vote') {
        const user = verifyInitData(body.initData, BOT_TOKEN);
        if (!user) return res.status(401).json({ error: 'Unauthorized' });
        const { data: m } = await supabase
          .from('members').select('status,is_core').eq('telegram_id', user.id).maybeSingle();
        // Голосовать может любой принятый участник/костяк (кодекс не требуем —
        // он обязателен при записи на событие, см. фикс гейта афиши 07.08).
        if (!m || !(m.is_core === true || m.status === 'approved')) return res.status(403).json({ error: 'members_only' });
        const mediaId = String(body.mediaId || '');
        if (!mediaId) return res.status(400).json({ error: 'Missing mediaId' });
        await supabase.from('event_media_votes').upsert(
          { media_id: mediaId, telegram_id: user.id },
          { onConflict: 'media_id,telegram_id', ignoreDuplicates: true }
        );
        // votes — пересчёт, а не инкремент: идемпотентно при повторных тапах.
        const { count } = await supabase
          .from('event_media_votes').select('media_id', { count: 'exact', head: true })
          .eq('media_id', mediaId);
        await supabase.from('event_media').update({ votes: count || 0 }).eq('id', mediaId);
        return res.status(200).json({ ok: true, votes: count || 0 });
      }

      // Проверка «я админ?» для галереи: показываем кнопки удаления только
      // ядру клуба (is_core). Сам факт удаления всё равно перепроверяется на
      // сервере — клиентский флаг лишь прячет/показывает кнопку.
      if (action === 'media_admin_check') {
        const user = verifyInitData(body.initData, BOT_TOKEN);
        if (!user) return res.status(200).json({ admin: false });
        const { data: m } = await supabase
          .from('members').select('is_core').eq('telegram_id', user.id).maybeSingle();
        return res.status(200).json({ admin: !!(m && m.is_core) });
      }

      // Удаление кадра из галереи — только ядро клуба (админ). Голоса
      // удалятся каскадом (event_media_votes.media_id ON DELETE CASCADE).
      if (action === 'media_delete') {
        const user = verifyInitData(body.initData, BOT_TOKEN);
        if (!user) return res.status(401).json({ error: 'Unauthorized' });
        const { data: m } = await supabase
          .from('members').select('is_core').eq('telegram_id', user.id).maybeSingle();
        if (!m || !m.is_core) return res.status(403).json({ error: 'admins_only' });
        const mediaId = String(body.mediaId || '');
        if (!mediaId) return res.status(400).json({ error: 'Missing mediaId' });
        const { error } = await supabase.from('event_media').delete().eq('id', mediaId);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ ok: true });
      }

      // Загрузка фото/видео ПРЯМО ИЗ мини-приложения (не через бота): участник
      // в период события жмёт «📷 Фото / 🎥 Видео», файл (base64) уходит сюда,
      // сервер шлёт его в Telegram (получает file_id) и пишет в event_media.
      // Клиент уже сжал фото и наложил логотип; здесь — валидации + лимиты.
      if (action === 'media_upload') {
        const user = verifyInitData(body.initData, BOT_TOKEN);
        if (!user) return res.status(401).json({ error: 'Unauthorized' });

        const eventId = String(body.eventId || '');
        const mime = String(body.mime || '');
        const b64 = String(body.data || '');
        if (!eventId || !b64) return res.status(400).json({ error: 'Missing eventId or data' });

        // Только участник события может грузить (кто зарегистрировался и прошёл).
        const { data: reg } = await supabase
          .from('registrations').select('id,status')
          .eq('event_id', eventId).eq('telegram_id', user.id).neq('status', 'cancelled').maybeSingle();
        if (!reg) return res.status(403).json({ error: 'not_registered' });

        // Период события: грузить можно только пока событие идёт / ещё не прошло.
        const { data: ev } = await supabase
          .from('events').select('date,date_end').eq('id', eventId).maybeSingle();
        if (ev) {
          const today = new Date().toISOString().slice(0, 10);
          const start = String(ev.date || today);
          const end = ev.date_end && String(ev.date_end) > start ? String(ev.date_end) : start;
          if (today < start) return res.status(403).json({ error: 'not_started' });
          if (today > end) return res.status(403).json({ error: 'finished' });
        } else {
          return res.status(404).json({ error: 'event_not_found' });
        }

        const isVideo = mime.startsWith('video/');
        // Vercel free: лимит тела ~4.5 МБ; фото уже сжаты клиентом (~1-300КБ).
        const maxBytes = isVideo ? 4 * 1024 * 1024 : 2 * 1024 * 1024;
        const bytes = Buffer.from(b64, 'base64');
        if (bytes.length === 0) return res.status(400).json({ error: 'empty' });
        if (bytes.length > maxBytes) {
          if (isVideo) return res.status(413).json({ error: 'video_too_large' });
          return res.status(413).json({ error: 'too_large' });
        }

        // Отправляем в Telegram, получаем file_id. Для бесшовного иммитации
        // бота: caption с именем отправителя, чтобы модерации было по кому.
        const cap = `${user.first_name || ''} · мини-апп`.trim();
        const bodyForm = new FormData();
        bodyForm.append('chat_id', String(user.id)); // шлём самому себе — file_id глобальный
        bodyForm.append(
          isVideo ? 'video' : 'photo',
          new Blob([bytes], { type: mime }),
          isVideo ? 'clip.mp4' : 'shot.jpg'
        );
        // topic_id нет; шлём напрямую человеку в ЛС.
        bodyForm.append('caption', cap);
        const up = await fetch(
          `https://api.telegram.org/bot${BOT_TOKEN}/send${isVideo ? 'Video' : 'Photo'}`,
          { method: 'POST', body: bodyForm }
        ).then((r) => r.json());

        const fileId = up?.result?.photo
          ? up.result.photo[up.result.photo.length - 1].file_id
          : (up?.result?.video || up?.result?.document)?.file_id;
        const fileUnique = up?.result?.photo?.[up.result.photo.length - 1]?.file_unique_id
          ?? (up?.result?.video || up?.result?.document)?.file_unique_id;
        if (!fileId) return res.status(502).json({ error: 'tg_upload_failed' });

        const { error } = await supabase.from('event_media').insert({
          event_id: eventId,
          telegram_id: user.id,
          file_id: fileId,
          file_unique_id: fileUnique || `mini-${Date.now()}-${user.id}`,
          media_type: isVideo ? 'video' : 'photo',
        });
        if (error && !String(error.code).includes('23505')) {
          return res.status(500).json({ error: error.message });
        }
        return res.status(200).json({ ok: true });
      }

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
        slog('error', 'Event save error', error);
        return res.status(500).json({ error: 'Failed to save event', details: error.message });
      }

      return res.status(200).json({ success: true, event: mapEventToCamelCase(event) });
    } catch (error) {
      slog('error', 'Error', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
