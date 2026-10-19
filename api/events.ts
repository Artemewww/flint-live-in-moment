import { createClient } from '@supabase/supabase-js';
import * as crypto from 'crypto';
import sharp from 'sharp';

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
/**
 * Афиши хранятся в базе как data:-URL (base64, ~100–300 КБ каждая). Раньше они
 * уходили в список событий целиком: ответ рос с каждым новым событием и
 * перекачивался при каждом обновлении ленты. Теперь в списке — ссылка на
 * прокси action=image (кэшируется браузером на сутки; v= сбрасывает кэш при
 * правке события). Обычные URL проходят как есть.
 */
function eventImageUrl(event: any, value: any, kind?: 'telegram'): string | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  if (!value.startsWith('data:')) return value;
  const v = encodeURIComponent(String(event.updated_at || ''));
  return `/api/events?action=image&id=${encodeURIComponent(String(event.id))}${kind ? `&kind=${kind}` : ''}&v=${v}`;
}

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
    image: eventImageUrl(event, event.image),
    telegramImage: eventImageUrl(event, event.telegram_image, 'telegram'),
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
  // Ссылка на самого себя в базе (старая порча) — редирект по кругу; берём
  // другое поле картинки, если оно настоящее.
  const isSelf = (v: any) => /^(https?:\/\/[^/]+)?\/api\/events\?action=image/.test(String(v || ''));
  const pick = (...vals: any[]) => vals.find((v) => v && !isSelf(v)) || '';
  const img = kind === 'telegram'
    ? pick((ev as any)?.telegram_image, (ev as any)?.image)
    : pick((ev as any)?.image, (ev as any)?.telegram_image);

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
  // SVG с нашего домена исполнял бы встроенные скрипты (stored XSS через
  // загрузку афиши). sandbox запрещает скрипты, nosniff — подмену типа.
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
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
  // Крупный файл из нашего бакета: не стримим, а отправляем браузеру прямо на
  // CDN. Файл не перезаходит через функцию — значит, работают Range-запросы
  // и перемотка, и снимается лимит на размер ответа. Ссылка отдаётся только
  // после проверки подписи И владения строкой (выше), поэтому это не открытый
  // редирект: подделать свой URL в galleries нельзя.
  if (isStorageMedia(fid)) {
    if (!evId) return res.status(403).end();
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    return res.status(302).setHeader('Location', fid).end();
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
    /**
     * Content-Type приходится УГАДЫВАТЬ, а не брать у Telegram.
     *
     * Telegram отдаёт файлы как application/octet-stream («не знаю, что это»).
     * Раньше мы это значение пробрасывали как есть, и фото уезжали в галерею с
     * чужим типом. На десктопе Chrome это незаметно, а в Telegram Mini App на
     * айфоне картинка просто не рисуется — пустой серый квадрат. Тип из ответа
     * берём только если он осмысленный (image/* или video/*), иначе смотрим
     * на расширение file_path.
     */
    const upstream = (fr.headers.get('content-type') || '').split(';')[0].trim();
    const byExt = /\.webm$/i.test(path) ? 'video/webm'
      : /\.mov$/i.test(path) ? 'video/quicktime'
        : /\.mp4$/i.test(path) ? 'video/mp4'
          : /\.webp$/i.test(path) ? 'image/webp'
            : 'image/jpeg';
    res.setHeader('Content-Type', /^(image|video)\//.test(upstream) ? upstream : byExt);
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    return res.status(200).send(buf);
  } catch {
    return res.status(502).end();
  }
}

/**
 * ОБЛОЖКА ВИДЕО. Раньше в сетке галереи видео рисовалось пустым тёмным
 * квадратом с треугольником: у <video> без poster нет кадра до play, а наш
 * прокси не отдаёт Range, поэтому браузер и не мог подтянуть первый кадр.
 *
 * Здесь обложка достаётся бесплатно из самого Telegram: у каждого залитого
 * видео есть thumbnail. Отдаём картинкой с суточным кэшем — на 20 плиток это
 * 20 запросов в день, а не 20 на каждый просмотр. Для файлов из Storage
 * обложка лежит рядом (.jpg) и отдаётся редиректом на CDN.
 */
async function handleMediaPoster(req: any, res: any) {
  const fid = String(req.query?.fid || '');
  const sig = String(req.query?.s || '');
  const evId = String(req.query?.id || '');
  const day = 'public, max-age=86400, s-maxage=86400';
  if (!fid || !BOT_TOKEN || !evId) return res.status(400).end();
  if (!mediaSigValid(fid, sig)) return res.status(403).end();
  if (!isStorageMedia(fid)) {
    const { data: owned } = await supabase
      .from('event_media').select('id').eq('event_id', evId).eq('file_id', fid).limit(1).maybeSingle();
    if (!owned) return res.status(403).end();
  }
  res.setHeader('Cache-Control', day);
  if (isStorageMedia(fid)) return res.status(302).setHeader('Location', storagePosterOf(fid)).end();
  try {
    const gf = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: fid }),
    }).then((r) => r.json());
    const thumbId = gf?.result?.thumbnail?.file_id;
    if (!thumbId) return res.status(404).end();
    const tf = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: thumbId }),
    }).then((r) => r.json());
    const path = tf?.result?.file_path;
    if (!path) return res.status(404).end();
    const fr = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${path}`);
    if (!fr.ok) return res.status(404).end();
    res.setHeader('Content-Type', 'image/jpeg');
    return res.status(200).send(Buffer.from(await fr.arrayBuffer()));
  } catch {
    return res.status(502).end();
  }
}

/**
 * АРХИВ МЕРОПРИЯТИЙ («История сообщества»).
 *
 * Раньше эта страница бралась из src/history.ts — жёстко вписанного списка из
 * пяти пунктов, который ничего не знал о базе. Отсюда и жалобы: события шли в
 * произвольном порядке (самое свежее оказывалось не сверху), Bison Race с его
 * сорока кадрами в архиве не было вообще, а «кто был» не показывался нигде.
 * Теперь архив = прошедшие события из той же таблицы, что и афиша, поэтому
 * он пополняется сам: организатор залил галерею — кадры появились здесь.
 *
 * Порядок — по убыванию даты, свежее сверху (DESC), и это решается в одном
 * запросе, а не сортировкой на клиенте.
 */
async function handleArchive(req: any, res: any) {
  const today = minskToday();
  const { data: events } = await supabase
    .from('events')
    .select('id,title,date,date_end,date_label,location,image,checklist')
    // Будущие события не должны съедать лимит архива, а черновики — попадать
    // в него вовсе (раньше прошедший draft видели все участники).
    .lte('date', today)
    .or('status.is.null,status.neq.draft')
    .order('date', { ascending: false })
    .limit(40);

  // Прошедшее = закончился последний день. Многодневный выезд не должен
  // выпадать из архива на своём втором дне (date, а не date_end).
  // …или организатор нажал «Завершить» (checklist.finished) — тогда сразу.
  const past = (events || []).filter((e: any) => e.checklist?.finished === true || (e.date_end || e.date) < today);
  if (!past.length) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ items: [] });
  }
  const ids = past.map((e: any) => e.id);

  // Один запрос на медиа всех событий и один на состав — вместо N+1 на каждое
  // прошедшее событие. На архиве их десятки, иначе функция упирается в лимит.
  const { data: media } = await supabase
    .from('event_media').select('id,event_id,file_id,media_type,votes')
    .in('event_id', ids)
    .order('votes', { ascending: false });
  const { data: regs } = await supabase
    .from('registrations').select('event_id,telegram_id,status,attended,name')
    .in('event_id', ids)
    .neq('status', 'cancelled');

  // Имена для «кто был» — из профиля, иначе из самой записи.
  const allTids = [...new Set((regs || []).map((r: any) => Number(r.telegram_id)).filter((n: number) => n > 0))];
  let nameById = new Map<number, string>();
  if (allTids.length) {
    const { data: mem } = await supabase.from('members').select('telegram_id,first_name,username').in('telegram_id', allTids);
    nameById = new Map((mem || []).map((m: any) => [Number(m.telegram_id), m.first_name || (m.username ? '@' + m.username : '')]));
  }
  const regName = new Map<number, string>((regs || []).map((r: any) => [Number(r.telegram_id), r.name || '']));

  const mediaByEvent = new Map<string, any[]>();
  for (const m of media || []) {
    const list = mediaByEvent.get(m.event_id) || [];
    list.push(m);
    mediaByEvent.set(m.event_id, list);
  }

  const items = past.map((e: any) => {
    const evId: string = e.id;
    const list = mediaByEvent.get(evId) || [];
    const videos = list.filter((m) => m.media_type === 'video').map((m) => ({
      id: m.id, src: mediaUrl(m.file_id, evId), poster: mediaPosterUrl(m.file_id, evId),
    }));
    const photos = list.filter((m) => m.media_type !== 'video').map((m) => ({ id: m.id, src: mediaUrl(m.file_id, evId) }));

    // «Кто был»: сперва отмеченные attended. Если отметок нет (старое событие,
    // кнопку не нажимали) — показываем тех, кто записан и не отменял запись,
    // иначе половина архива была бы с пустым составом.
    const forEvent = (regs || []).filter((r: any) => r.event_id === evId);
    const attended = forEvent.filter((r: any) => r.attended === true);
    const who = (attended.length ? attended : forEvent);
    const seen = new Set<number>();
    const attendees = who
      .map((r: any) => ({ tid: Number(r.telegram_id), name: nameById.get(Number(r.telegram_id)) || regName.get(Number(r.telegram_id)) || '' }))
      .filter((p: any) => {
        if (!(p.tid > 0) || seen.has(p.tid)) return false;
        seen.add(p.tid);
        return true;
      })
      .map((p: any) => ({ telegramId: p.tid, name: p.name, avatar: avatarUrl(p.tid) }));

    return {
      id: evId,
      title: e.title,
      date: e.date,
      dateEnd: e.date_end || null,
      dateLabel: e.date_label || e.date,
      location: e.location || '',
      // Обложка карточки: афиша события. Если её нет — первый кадр из галереи,
      // иначе карточка выходит пустой серой прямоугольником.
      cover: e.image ? `/api/events?action=image&id=${encodeURIComponent(evId)}` : (photos[0]?.src || videos[0]?.poster || ''),
      videos,
      photos,
      attendees,
      // По этим счётчикам на открытке рисуются бейджи «видео» и «фото».
      videoCount: videos.length,
      photoCount: photos.length,
      peopleCount: attendees.length,
    };
  });

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ items });
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
/**
 * Content-Type для картинки из Telegram.
 *
 * Telegram отдаёт файлы как application/octet-stream («не знаю, что это»), и
 * раньше это значение пробрасывалось как есть. На десктопе Chrome такой тип
 * для <img> безобиден, а в Telegram Mini App на айфоне картинка просто не
 * рисуется — пустой серый кружок. Поэтому доверяем ответу Telegram только
 * когда он осмысленный (image/*), иначе определяем тип по расширению.
 */
function imageContentType(upstream: string | null, filePath: string): string {
  const t = String(upstream || '').split(';')[0].trim();
  if (/^image\//i.test(t)) return t;
  if (/\.webp$/i.test(filePath)) return 'image/webp';
  return 'image/jpeg';
}

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

/* ── Крупные файлы в Supabase Storage ────────────────────────────────────
 *
 * Исторически в `event_media.file_id` лежит только Telegram file_id, и это
 * работает: участники шлют короткие клипы с телефона, прокси их стримит.
 * Но прокси — это Vercel-функция, и у неё два жёстких потолка:
 *   • лимит ответа (в коде стоит страховочный порог 8 МБ),
 *   • отсутствие Range-запросов — файл отдаётся целиком, перемотка не работает.
 *
 * Смонтированный ролик (100 с, 1080×1920) в оба потолка не влезает: 118 МБ.
 * Поэтому `file_id` теперь умеет быть публичной ссылкой на наш же бакет —
 * такие файлы отдаём 302-редиректом прямо на CDN Supabase, минуя функцию.
 * Ссылка остаётся подписанной и привязанной к событию: подпись проверяется,
 * владение строкой в event_media — тоже, произвольный чужой URL не отдаём.
 */

/** Префикс нашего ПУБЛИЧНОГО бакета. Всё, что не под ним, — не наше. */
const STORAGE_PREFIX = `${String(process.env.SUPABASE_URL || '').replace(/\/+$/, '')}/storage/v1/object/public/event-images/`;

/**
 * «Сегодня» по Минску (UTC+3 круглый год, без перехода на летнее время).
 * toISOString() даёт дату по UTC: с 00:00 до 03:00 по Минску это ещё вчера —
 * загрузка в первый день выезда получала not_started, а отметка челленджа
 * записывалась на прошлый день и рвала серию.
 */
function minskToday(): string {
  return new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function isStorageMedia(fid: string): boolean {
  return !!fid && fid.startsWith(STORAGE_PREFIX) && /^https:\/\//.test(fid) && !/[\s"'\\<>]/.test(fid);
}

/**
 * Обложка видео. Telegram умеет отдать свою превьюшку (thumbnail) бесплатно,
 * а для файлов в Storage обложка кладётся рядом по соглашению: тот же путь,
 * но с расширением .jpg. Соглашение вместо новой колонки — потому что DDL в
 * этом проекте применяется руками через Dashboard Supabase, и код обязан
 * работать и до, и после миграции.
 */
function storagePosterOf(fid: string): string {
  return fid.replace(/\.[a-z0-9]{2,5}$/i, '') + '.jpg';
}
function mediaPosterUrl(fid: string, eventId?: string): string {
  if (!fid || !BOT_TOKEN) return '';
  const owner = eventId ? `&id=${encodeURIComponent(eventId)}` : '';
  return `/api/events?action=media_poster&fid=${encodeURIComponent(fid)}&s=${mediaSig(fid)}${owner}`;
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
    // Telegram отдаёт аватарку как application/octet-stream; в Mini App на
    // айфоне такая картинка не рисуется. Тип определяем сами — см. imageContentType.
    res.setHeader('Content-Type', imageContentType(fr.headers.get('content-type'), path));
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
    // id события обязателен: по нему прокси проверяет, что файл принадлежит
    // именно этому выезду, иначе подписанная ссылка открывала бы чужое медиа.
    src: mediaUrl(m.file_id, evId),
    // У видео в сетке показываем обложку, а не пустой тёмный квадрат.
    ...(m.media_type === 'video' ? { poster: mediaPosterUrl(m.file_id, evId) } : {}),
  }));
  res.setHeader('Cache-Control', 'no-store');
  // Подписанная ссылка на HTML-галерею: без g= она отдаёт 403, а собрать
  // подпись на клиенте нельзя (секрет — токен бота).
  const galleryUrl = BOT_TOKEN ? `/api/events?action=gallery&id=${encodeURIComponent(evId)}&g=${gallerySig(evId)}` : null;
  return res.status(200).json({ items, galleryUrl });
}

/**
 * Подпись на страницу галереи события.
 *
 * Галерею открывает бот (web_app-кнопка), и это обычная HTML-страница: она не
 * умеет приложить заголовок с Telegram initData, поэтому клубной гейт к ней
 * неприменим. Вместо этого доступ подписывается ссылкой: подпись — HMAC от id
 * события, которую выдаёт сервер. Зная id события (он есть в любой пересылке),
 * страницу по чужой ссылке не открыть.
 */
function gallerySig(eventId: string): string {
  return crypto.createHmac('sha256', BOT_TOKEN).update(`gallery:${eventId}`).digest('hex').slice(0, 16);
}
function gallerySigValid(eventId: string, sig: string): boolean {
  if (!BOT_TOKEN || sig.length !== 16) return false;
  const a = Buffer.from(sig), b = Buffer.from(gallerySig(eventId));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Галерея события: мобильная страница с голосованием (открывается как Mini App из бота). */
async function handleGallery(req: any, res: any) {
  const evId = String(req.query?.id || '');
  const gsig = String(req.query?.g || '');
  if (!evId) return res.status(400).send('Missing id');
  // Без подписи галерея не отдаётся: раньше страница была полностью публичной,
  // и любой, угадавший id события, получал все фото и подписанные ссылки на них.
  if (!isAdmin(req) && !gallerySigValid(evId, gsig)) return res.status(403).send('Forbidden');
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
    // У видео рисуем обложку (thumbnail из Telegram или .jpg рядом с файлом
    // в Storage): раньше там был пустой чёрный квадрат с треугольником,
    // и галерея выглядела сломанной.
    const inner = isVideo
      ? `<img src="${escapeHtml(mediaPosterUrl(m.file_id, evId))}" loading="lazy" alt="" onerror="this.remove()">`
        + `<span class="play">▶</span>`
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

/**
 * БАННЕР ДЛЯ ШАРИНГА — 1200×630, горизонтальный.
 *
 * Зачем: все афиши клуба ВЕРТИКАЛЬНЫЕ (720×1280), а превью ссылки в Telegram
 * показывает квадрат. Вертикальный постер в квадрате обрезался так, что в
 * пересылке оставался кусок фотографии — баннер выглядел случайным.
 *
 * Что делает: берёт фото события и кадрирует под 1200×630
 * берёт кадр геометрическим центром — ровно то, что видно на афише,
 * кладёт тёмную вуаль слева и снизу, ставит логотип FLINT в левый верхний
 * угол. Если фото нет — собирает фирменный фон, чтобы баннер не был пустым.
 *
 * Текста на баннере НЕТ намеренно: SVG-текст в sharp рисуется системными
 * шрифтами, а на сервере их нет — надпись молча исчезла бы. Заголовок, дату и
 * место Telegram показывает рядом из og:title/og:description.
 */
async function handleShareImage(req: any, res: any) {
  const id = String(req.query?.id || '');
  if (!id) return res.status(400).end();
  const out = await buildShareBanner(id);
  if (!out) return res.status(404).end();
  res.setHeader('Content-Type', 'image/jpeg');
  // Баннер меняется только при смене фото события — кэшируем месяц.
  res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
  return res.status(200).send(out);
}

/**
 * Баннер 1200×630 для превью и приглашений. Отдельной функцией, чтобы
 * «Поделиться» брал его НАПРЯМУЮ, а не HTTP-запросом к самому себе: защита
 * Vercel от ботов отвечает такому запросу страницей-проверкой (403), и
 * приглашение уходило без картинки.
 */
async function buildShareBanner(id: string): Promise<Buffer | null> {
  if (!id) return null;
  const { data: ev } = await supabase
    .from('events').select('title,date,date_label,location,image,telegram_image').eq('id', id).maybeSingle();
  if (!ev) return null;

  const W = 1200, H = 630;
  /**
   * Готовая карточка шеринга (её рисует админка: фото + плашка с датой и
   * названием) — отдаём КАК ЕСТЬ. Раньше поверх неё клали ещё одно затемнение
   * и логотип, и пересланная афиша выходила вдвое темнее и с двумя логотипами.
   */
  const card = String((ev as any).telegram_image || '');
  if (card.startsWith(STORAGE_PREFIX)) {
    try {
      const r = await fetch(card);
      if (r.ok) return Buffer.from(await r.arrayBuffer());
    } catch { /* соберём из афиши ниже */ }
  }
  // Логотип FLINT — те же пути, что и LogoMain в src/components/VectorIcons.tsx,
  // чтобы баннер был ровно в стиле приложения.
  const LOGO = `<g transform="translate(56,44) scale(0.52)" fill="#E6FD3A">
    <path d="M298.968 88.0317V46.2721H282.499V36.5674H327.347V46.2721H310.878V88.0317H298.968Z"/>
    <path d="M264.368 36.5674H276.131V88.0317H266.353L240.694 56.7855V88.0317H228.931V36.5674H238.782L264.368 67.8136V36.5674Z"/>
    <path d="M204.807 88.0317V36.5674H216.717V88.0317H204.807Z"/>
    <path d="M160.436 88.0317V36.5674H172.346V78.327H198.152V88.0317H160.436Z"/>
    <path d="M152.373 46.125H125.391V59.7263H149.212V69.284H125.391V88.0317H113.481V36.5674H152.373V46.125Z"/>
    <path d="M6.16253 90.5462L0 74.2944L14.636 45.6601L16.947 28.6343L30.8127 18.5736L44.6784 0L50.8409 9.28679L68.5582 20.1214L76.2613 59.5903L80.8833 66.5554L83.1942 92.8679L74.7207 109.12L37.7455 116.085L4.6219 105.25L6.16253 90.5462Z"/>
    <path d="M19.8315 80.0155C21.1436 77.9019 22.6769 75.9415 24.0786 73.8933L44.9654 43.7988C46.248 41.9432 49.9629 36.2843 51.4682 34.9199L51.5702 34.8262C50.2877 37.9946 49.8978 41.1933 49.3601 44.5643L46.9246 59.0641C46.6653 60.5121 46.367 61.9645 46.1552 63.4203C47.2617 63.2248 48.3583 62.8554 49.4433 62.5508L60.0543 59.5153C61.1008 59.2162 62.159 58.9522 63.1984 58.6272C63.7357 58.4882 64.2846 58.3673 64.8145 58.2001C60.8749 64.1218 57.202 70.3298 53.2207 76.1731L39.3124 96.7016C38.2354 98.3151 36.5731 100.815 35.8117 102.542C35.8386 92.3086 38.6007 84.0047 39.6217 74.4123L22.6637 79.2193C21.737 79.474 20.72 79.6441 19.8315 80.0155Z" fill="#0B0B0B"/>
  </g>`;
  const overlay = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="l" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#000" stop-opacity="0.38"/>
        <stop offset="35%" stop-color="#000" stop-opacity="0"/>
        <stop offset="100%" stop-color="#000" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="b" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#000" stop-opacity="0"/>
        <stop offset="100%" stop-color="#000" stop-opacity="0.15"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#l)"/>
    <rect width="${W}" height="${H}" fill="url(#b)"/>
    ${LOGO}
    <rect x="0" y="${H - 10}" width="${W}" height="10" fill="#E6FD3A"/>
  </svg>`;

  let base: Buffer;
  // Сама афиша (не карточка с текстом) — затемнение только под логотип.
  const src = String((ev as any).image || (ev as any).telegram_image || '');
  const m = /^data:image\/[a-zA-Z+]+;base64,(.+)$/.exec(src);
  try {
    /**
     * Афиша из хранилища (https). Раньше баннер умел только data:-URL, и у
     * событий с картинкой в Storage превью выходило пустым тёмным фоном.
     * Тянем только с нашего Supabase — не открытый прокси на любой адрес.
     */
    if (!m && src.startsWith(STORAGE_PREFIX)) {
      const r = await fetch(src);
      if (!r.ok) throw new Error('storage ' + r.status);
      base = await sharp(Buffer.from(await r.arrayBuffer()))
        .rotate()
        .resize(W, H, { fit: 'cover', position: 'centre' })
        .toBuffer();
    } else {
    if (!m) throw new Error('нет фото');
    // Кадр — ГЕОМЕТРИЧЕСКИМ ЦЕНТРОМ, а не «по смыслу». Проверил на трёх афишах:
    // attention и entropy оба уезжали в небо и солнечные блики, и баннер
    // получался пустым куском веток. Центр даёт ровно то, что на афише: река,
    // поля, люди. Отступ сверху не берём — на вертикальных постерах он уводил
    // кадр в верхнюю треть с небом.
    base = await sharp(Buffer.from(m[1], 'base64'))
      .rotate()
      .resize(W, H, { fit: 'cover', position: 'centre' })
      .toBuffer();
    }
  } catch {
    // Фото нет или битое — фирменный фон, чтобы превью не было пустым.
    base = await sharp({
      create: { width: W, height: H, channels: 3, background: '#151515' },
    }).toBuffer();
  }

  // Сочнее: лёгкий подъём насыщенности и яркости — афиша не «тухнет» в превью.
  const out = await sharp(base)
    .modulate({ saturation: 1.18, brightness: 1.04 })
    .composite([{ input: Buffer.from(overlay), top: 0, left: 0 }])
    .jpeg({ quality: 86, progressive: true })
    .toBuffer();

  return out;
}

/**
 * Хелперы приглашения (были отдельной функцией api/share.ts).
 *
 * На Hobby-плане Vercel жёсткий потолок — 12 serverless-функций на деплой,
 * а их уже было ровно 12. Ещё одна (`/api/share`) ломала деплой целиком,
 * поэтому приглашение живёт здесь, действием `action=share`.
 */
/** Месяцы по-русски — только для подписи в приглашении. */
const SHARE_MONTHS = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];

/** «12 октября» — разбираем для приглашения. */
function shareDayPhrase(iso: string): string {
  const d = iso ? new Date(`${iso}T12:00:00`) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${SHARE_MONTHS[d.getMonth()]}`;
}


/**
 * Приглашение: кладём в личку человека баннер + подпись со скрытой ссылкой.
 *
 * Зачем не системный диалог `t.me/share/url`: там текст идёт сверху, а
 * ссылка отдельной карточкой превью снизу — ровно наоборот, чем просили.
 * Плюс человек уходил в стороннее окно выбора чата. Здесь сообщение
 * получается правильным: обложка сверху, ссылка спрятана под словами
 * «Открыть и записаться», и пересылается обычным «переслать».
 */

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
 * «🎟 Свободно 5 из 8» — счётчик мест на момент отправки. Считаем живые
 * записи (без отменённых); лимита нет — строки нет.
 */
async function seatsLine(ev: any): Promise<string> {
  const cap = Number(ev?.max_participants) || 0;
  if (!cap) return '';
  const { count } = await supabase.from('registrations').select('id', { count: 'exact', head: true })
    .eq('event_id', ev.id).neq('status', 'cancelled');
  const left = Math.max(0, cap - (count || 0));
  return left > 0 ? `🎟 Свободно <b>${left} из ${cap}</b> мест` : `🎟 Мест нет — можно встать в лист ожидания`;
}

/** Первые 1–2 предложения описания, без обрыва посреди слова. */
function descTeaser(raw: any, max = 170): string {
  const t = String(raw || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const dot = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (dot > 60) return cut.slice(0, dot + 1);
  const sp = cut.lastIndexOf(' ');
  return `${cut.slice(0, sp > 60 ? sp : max).replace(/[,;:—–-]\s*$/, '')}…`;
}

async function handleShareInvite(body: any, req: any, res: any) {
  if (!BOT_TOKEN) return res.status(200).json({ ok: false, error: 'TELEGRAM_BOT_TOKEN не задан' });

  const user = verifyInitData(String(body.initData || ''), BOT_TOKEN);
  if (!user) return res.status(200).json({ ok: false, error: 'Нужен вход через Telegram' });

  const eventId = String(body.eventId || '').trim();
  if (!eventId) return res.status(400).json({ ok: false, error: 'eventId обязателен' });

  const { data: ev } = await supabase
    .from('events')
    .select('id,title,date,date_label,time,location,description,image,telegram_image,notifications,status,price_type,price_amount,price_label,logistics,max_participants')
    .eq('id', eventId).maybeSingle();
  if (!ev) return res.status(404).json({ ok: false, error: 'Событие не найдено' });

  // Реф-код пригласившего — без него пересланное приглашение ничего не приносит.
  let ref = '';
  const { data: m } = await supabase
    .from('members').select('ref_code,status,is_core').eq('telegram_id', user.id).maybeSingle();
  // Код не принятого участника не впускает — такую ссылку не раздаём.
  if (m?.ref_code && ((m as any).status === 'approved' || (m as any).is_core === true)) ref = String(m.ref_code);

  const host = req.headers['x-forwarded-host'] || req.headers.host || 'flint-live-in-moment.vercel.app';
  const site = `https://${host}`;
  const link = `${site}/e/${encodeURIComponent(eventId)}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`;

  const notifs = ((ev as any).notifications || {}) as Record<string, any>;
  const isChallenge = notifs._format === 'challenge' || notifs.is_challenge === true;

  // Дата — подписью события (там диапазон «16–18 октября»), а не только днём старта.
  const dateLine = String((ev as any).date_label || '').trim()
    || [shareDayPhrase(String((ev as any).date || '')), (ev as any).time || ''].filter(Boolean).join(', ');
  const seats = await seatsLine(ev);
  const lg = ((ev as any).logistics || {}) as any;

  const headline = isChallenge
    ? `Каждый день — одно движение для себя. 90 дней подряд.\n`
    : [
        dateLine && `📅 ${escapeHtml(dateLine)}`,
        (ev as any).location && `📍 ${escapeHtml(String((ev as any).location))}`,
        // Ценность: пригласительные клуба — одной строкой «было → стало».
        lg.costModel === 'club_invite'
          ? `💎 ${lg.marketPrice ? `Билет ${escapeHtml(String(lg.marketPrice))} → ` : ''}для клуба <b>бесплатно</b>`
          : `💰 ${escapeHtml(costLineOf(ev))}`,
        seats,
      ].filter(Boolean).join('\n') + '\n\n' + (descTeaser((ev as any).description) ? `${escapeHtml(descTeaser((ev as any).description))}\n` : '');

  const caption =
    `<b>${escapeHtml((ev as any).title)}</b>\n\n` +
    `${headline}\n` +
    `<a href="${escapeHtml(link)}">👉 Открыть и записаться</a>`;

  // Кнопка — на челлендже «Забронировать» звучит как «забронировать место в
  // поездке», а ехать некуда. Ссылка в кнопке — startapp, чтобы человек сразу
  // попал в приложение на карточку события, мимо бота.
  const markup = {
    inline_keyboard: [[{
      text: isChallenge ? '✅ Вступить в челлендж' : '✅ Забронировать место',
      url: `https://t.me/${BOT_USERNAME}?startapp=${encodeURIComponent(
        ref ? `ref_${ref}_ev_${eventId}` : `ev_${eventId}`
      )}`,
    }]],
  };

  try {
    // Баннер отдаём файлом: Telegram не всегда подтягивает картинку по
    // внешней HTTP-ссылке, и тогда сообщение уходило вообще без обложки.
    let sent = false;
    try {
      // Баннер собираем на месте: HTTP-запрос к самому себе режет защита
      // Vercel от ботов — приглашение уходило без картинки.
      const built = await buildShareBanner(eventId);
      if (built) {
        const buf = built;
        const form = new FormData();
        form.append('chat_id', String(user.id));
        form.append('photo', new Blob([buf], { type: 'image/jpeg' }), 'banner.jpg');
        form.append('caption', caption);
        form.append('parse_mode', 'HTML');
        form.append('reply_markup', JSON.stringify(markup));
        const fr = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
          method: 'POST', body: form,
        });
        const fj: any = await fr.json().catch(() => ({}));
        sent = !!fj?.ok;
        if (!sent) console.warn('[share] sendPhoto:', fj?.description || fr.status);
      }
    } catch (e: any) {
      console.warn('[share] banner fetch failed:', e?.message || e);
    }
    if (!sent) {
      const fr = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: user.id, parse_mode: 'HTML', text: caption,
          reply_markup: markup, disable_web_page_preview: true,
        }),
      });
      const fj: any = await fr.json().catch(() => ({}));
      if (!fj?.ok) throw new Error(fj?.description || 'Не получилось отправить');
    }
    return res.status(200).json({ ok: true });
  } catch (e: any) {
    return res.status(200).json({ ok: false, error: e?.message || 'Не получилось отправить' });
  }
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
  // Превью ссылки. Раньше сюда шла вертикальная афиша (720×1280), и Telegram
  // вписывал её в квадрат превью — пересылка выглядела случайным куском фото.
  // Теперь это горизонтальный баннер 1200×630 с логотипом (action=share_image),
  // который сам подбирает кадр. Ширину и высоту НЕ объявляем: картинка
  // горизонтальная, Telegram сам знает, как её вписать.
  const imageUrl = `${site}/api/events?action=share_image&id=${encodeURIComponent(id)}`;
  /**
   * ТОЧКА ВХОДА. Раньше здесь был `start=ref_...` / `start=event_...` и через
   * 1.2 секунды страница САМА кидала посетителя в бота. Это и была дыра:
   * ссылка /e/<id> публичная, поэтому любой человек из интернета попадал
   * в клубской сценарий мимо заявки, а страница при этом печатала
   * «Присоединяйся!» и обещала «Забронировать место» — будто клуб открытый.
   *
   * Теперь ссылка ведёт в ЗАЯВКУ и несёт id события, чтобы после одобрения
   * человек попал именно на этот выезд. Решение «член или нет» принимает бот:
   * он знает telegram_id, страница — нет.
   */
  /**
   * ССЫЛКА ВЕДЁТ ПРЯМО В МИНИ-ПРИЛОЖЕНИЕ.
   *
   * Раньше кнопка вела в БОТ (`?start=verify_ev_...`): человек видел белый
   * экран с кнопкой START, а не карточку события — то есть в превью у него
   * была картинка, дата и место, а по клику их не оказывалось.
   *
   * `?startapp=ev_<id>` открывает Mini App сразу на карточке события (её
   * читает App.tsx по `start_param`). Решение «член или нет» при этом не
   * обходится: не допущенному приложение показывает гейт и заявку, то есть
   * ровно то же, что показывал бот.
   *
   * Редирект делает JS, а не meta-refresh: краулер Telegram не выполняет
   * скрипты, и og-картинка с описанием в пересылке остаётся на месте.
   *
   * Если у бота в @BotFather НЕ настроен Direct Mini App, `?startapp=`
   * откроет просто страницу бота — это рабочий откат, хуже прежнего нет.
   *
   * Если в ссылке есть код пригласившего — сохраняем его: иначе теряется
   * атрибуция «кто позвал» (у Тимы referred_by оказался пустым именно так).
   */
  const startappParam = ref ? `ref_${ref}_ev_${id}` : `ev_${id}`;
  const miniAppUrl = `https://t.me/${BOT_USERNAME}?startapp=${encodeURIComponent(startappParam)}`;

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
<meta property="og:url" content="${escapeHtml(`${site}/e/${id}`)}">
<meta name="twitter:card" content="summary_large_image">
<!--
  Размеры картинки намеренно НЕ объявляем. Раньше здесь стояли жёсткие
  1200×630, но афиши вертикальные (720×1280): Telegram брал объявленные
  размеры и вписывал вертикальный постер в горизонтальную рамку превью —
  картинка доходила обрезанной. Без og:image:width/height потребитель сам
  читает размер из файла и вёрстывает его правильно.
-->
<style>
 body{margin:0;background:#0b0b0b;color:#fff;font-family:system-ui,-apple-system,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
 .card{max-width:520px;width:100%;background:#141414;border:1px solid #262626;border-radius:24px;overflow:hidden}
 .card img{width:100%;display:block;aspect-ratio:16/9;object-fit:cover}
 .body{padding:24px}
 h1{font-size:24px;margin:0 0 8px}
 p{color:#a3a3a3;font-size:14px;line-height:1.6;margin:0 0 20px}
 a{display:block;text-align:center;background:#E6FD3A;color:#000;font-weight:800;padding:16px;border-radius:14px;text-decoration:none;font-size:15px}
 .gate{display:inline-flex;align-items:center;gap:6px;background:#E6FD3A;color:#000;font-weight:900;font-size:10px;letter-spacing:.14em;text-transform:uppercase;border-radius:999px;padding:5px 11px;margin-bottom:14px}
 .note{background:rgba(230,253,58,.06);border:1px solid rgba(230,253,58,.2);border-radius:14px;padding:14px 16px;margin:0 0 18px}
 .note b{display:block;color:#fff;margin-bottom:4px;font-size:14px}
 .note span{color:#a3a3a3;font-size:13px;line-height:1.55}
 .foot{color:#6b6b6b;font-size:11px;text-align:center;margin-top:16px;line-height:1.6}
</style>
</head><body>
<div class="card">
  ${(ev as any).image ? `<img src="${escapeHtml(imageUrl)}" alt="">` : ''}
  <div class="body">
    <span class="gate">Закрытый клуб</span>
    <h1>${escapeHtml((ev as any).title)}</h1>
    <div class="note">
      <b>${escapeHtml(dateLabel ? `📅 ${dateLabel}` : 'Приглашение в клуб')}</b>
      <span>Это закрытое сообщество. Если ты из клуба — откроется карточка события. Если нет — там же подаётся заявка: кодекс и короткое знакомство, 2–3 минуты.</span>
    </div>
    <a href="${escapeHtml(miniAppUrl)}" id="go">Открыть событие</a>
    <p class="hint">Откроется приложение FLINT. Решение принимает костяк клуба.</p>
    <div class="foot">Ты пришёл по приглашению на этот выезд.<br>После одобрения откроется именно он.</div>
  </div>
</div>
<script>
/**
 * Автопереход в Mini App.
 *
 * Страницу /e/<id> открывают из пересылки в Telegram — то есть человек уже
 * в мессенджере, и лишний экран между «захотел пойти» и «попадал в
 * приложение» просто отнимал решение. Кнопка под скриптом остаётся на
 * случай, если автопереход не сработал.
 */
(function () {
  var go = document.getElementById('go');
  if (!go) return;
  var ua = navigator.userAgent || '';
  // Вне Telegram редиректить незачем: там всё равно нужен гейт заявки,
  // а человек мог открыть ссылку с десктопа и ждал нормальную страницу.
  if (!/Telegram/i.test(ua) && !window.TelegramWebviewProxy) return;
  setTimeout(function () { location.replace(go.href); }, 350);
})();
</script>
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
  const today = minskToday();
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
    if (req.query?.action === 'share_image') return await handleShareImage(req, res);
    // Галерея события — HTML-страница, её открывает бот (web_app-кнопка), и
    // заголовков авторизации там нет. Поэтому доступ подписывается самой
    // ссылкой (gallerySig): зная id события, страницу не отдать.
    // Остальные медиа и состав — под гейтом, см. ниже.
    if (req.query?.action === 'gallery') return await handleGallery(req, res);
    if (req.query?.action === 'media') return await handleMedia(req, res);
    if (req.query?.action === 'media_poster') return await handleMediaPoster(req, res);
    if (req.query?.action === 'avatar') return await handleAvatar(req, res);
    // Поступки события: «кто что сделал». Организатор подтверждает — только
    // тогда эпизод идёт в репутацию и приносит баллы.
    if (req.query?.action === 'contributions') return await handleContributions(req, res);
    if (req.query?.action === 'contribution_review') return await handleContributionReview(req, res);
    // Чек-ины и истории челленджа — тоже под гейтом (см. ниже).

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
    // Дальше — только для участников клуба.
    //
    // Эти четыре экшена стояли ВЫШЕ гейта и были видны любому, кто угадает
    // id события в адресной строке: состав челленджа с именами и аватарками,
    // отметки подъёма, список медиа с уже подписанными ссылками на файлы.
    // Это и были открытые «каналы по ссылке». Теперь они под тем же гейтом,
    // что и афиша, а страница галереи — под подписью (gallerySig).
    if (req.query?.action === 'archive') return await handleArchive(req, res);
    if (req.query?.action === 'media_list') return await handleMediaList(req, res);
    if (req.query?.action === 'checkins') return await handleCheckins(req, res);
    if (req.query?.action === 'checkins_grouped') return await handleCheckinsGrouped(req, res);
    if (req.query?.action === 'stories') return await handleStories(req, res);
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

      /**
       * ПРИГЛАШЕНИЕ В СВОЙ ЧАТ — обложка сверху, ссылка зашита в текст.
       *
       * Отдельная функция `/api/share` не выжила: на Hobby-плане Vercel
       * максимум 12 serverless-функций на деплой, и лимит был выбран до
       * предела. Действие живёт здесь, в уже существующей `/api/events`.
       */
      if (action === 'share') {
        return await handleShareInvite(body, req, res);
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
          .eq('event_id', eventId).eq('telegram_id', user.id).in('status', ['pending', 'confirmed']).maybeSingle();
        if (!reg) return res.status(403).json({ error: 'not_registered' });

        // Период события: грузить можно только пока событие идёт / ещё не прошло.
        const { data: ev } = await supabase
          .from('events').select('date,date_end').eq('id', eventId).maybeSingle();
        if (ev) {
          const today = minskToday();
          const start = String(ev.date || today);
          const end = ev.date_end && String(ev.date_end) > start ? String(ev.date_end) : start;
          if (today < start) return res.status(403).json({ error: 'not_started' });
          if (today > end) return res.status(403).json({ error: 'finished' });
        } else {
          return res.status(404).json({ error: 'event_not_found' });
        }

        if (!/^(image\/(jpeg|png|webp)|video\/(mp4|quicktime|webm))$/.test(mime)) {
          return res.status(415).json({ error: 'bad_type' });
        }
        const isVideo = mime.startsWith('video/');
        // Vercel free: лимит ТЕЛА ~4.5 МБ, а файл едет в base64 (+33%), так что
        // реальный потолок видео ~3.3 МБ. Раньше стоял 4 МБ — недостижимый: такие
        // файлы падали 413 у Vercel ещё до этой проверки, без понятной ошибки.
        const maxBytes = isVideo ? 3 * 1024 * 1024 : 2 * 1024 * 1024;
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

      /**
       * В списке событий картинки отдаются ССЫЛКОЙ на прокси (action=image), а
       * не base64. Админка сохраняет событие целиком — и эта ссылка уезжала в
       * базу вместо картинки: прокси перенаправлял сам на себя, и обложка
       * пропадала везде (так сломалась афиша «Фристайла»). Ссылку на свой
       * прокси не пишем — в базе остаётся настоящая картинка.
       */
      for (const k of ['image', 'telegram_image']) {
        const v = String((eventData as any)[k] ?? '');
        if (/^(https?:\/\/[^/]+)?\/api\/events\?action=image/.test(v)) delete (eventData as any)[k];
      }
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
