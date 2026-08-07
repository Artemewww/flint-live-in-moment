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
  // kind=telegram → вертикальная афиша (telegram_image) для шеринга; иначе обычная.
  // Афиши грузятся как data:-URL (base64) — Telegram их не тянет напрямую, поэтому
  // отдаём байтами через этот прокси (публичный URL). Фолбэк на обычную картинку.
  const kind = String(req.query.kind || '');
  const { data: ev } = await supabase.from('events').select('image,telegram_image').eq('id', id).maybeSingle();
  const img = (kind === 'telegram' ? ((ev as any)?.telegram_image || (ev as any)?.image) : (ev as any)?.image) || '';

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
/**
 * Прокси медиа из Telegram. Стримим содержимое сами: redirect на
 * file-URL Telegram недопустим — путь содержит токен бота.
 */
async function handleMedia(req: any, res: any) {
  const fid = String(req.query?.fid || '');
  if (!fid || !BOT_TOKEN) return res.status(400).end();
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
    const src = `/api/events?action=media&fid=${encodeURIComponent(m.file_id)}`;
    const isVideo = m.media_type === 'video';
    // Превью в сетке — тап открывает на весь экран (и фото, и видео).
    const inner = isVideo
      ? `<video src="${src}" preload="metadata" playsinline muted></video><span class="play">▶</span>`
      : `<img src="${src}" loading="lazy" alt="">`;
    return `<figure data-id="${m.id}">`
      + `<div class="thumb" onclick="openLb('${src}','${isVideo ? 'video' : 'photo'}')">${inner}</div>`
      + `<button class="vote" onclick="vote(this,'${m.id}')">❤️ <span>${m.votes}</span></button>`
      + `<button class="del" onclick="del(this,'${m.id}')" title="Удалить">🗑</button>`
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
<meta property="og:image:width" content="1280">
<meta property="og:image:height" content="720">
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
    if (req.query?.action === 'media') return await handleMedia(req, res);

    // Афиша — СТРОГО для зарегистрированных участников клуба. Раньше список
    // отдавался публично, а затем пускал по одному реф-коду — так не-член видел
    // всю систему, не пройдя этапы. Владелец: закрыть жёстко. Теперь доступ дают
    // только: (а) подписанный Telegram initData участника approved/core, либо
    // (б) админ-кука. Голого реф-кода НЕДОСТАТОЧНО — сначала вступление в боте.
    if ((process.env.GATE_ENABLED ?? '1') !== '0') {
      let allowed = isAdmin(req);
      const user = allowed ? null : verifyInitData(String(req.headers['x-telegram-init-data'] || ''), BOT_TOKEN);
      if (user) {
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
      const { data: regs } = await supabase
        .from('registrations').select('event_id, guest_count').neq('status', 'cancelled');
      const counts = new Map<string, number>();
      for (const r of regs || []) counts.set(r.event_id, (counts.get(r.event_id) || 0) + 1 + (Number((r as any).guest_count) || 0));
      const withCounts = (events || []).map((e: any) => ({ ...e, participants_count: counts.get(e.id) || 0 }));

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
          .from('members').select('status,is_core,prefs').eq('telegram_id', user.id).maybeSingle();
        // Правила обязательны и для голосования в галерее.
        if (!m || !(m.is_core === true || (m.status === 'approved' && !!m.prefs?.rules_accepted))) return res.status(403).json({ error: 'members_only' });
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
