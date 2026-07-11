import { createClient } from '@supabase/supabase-js';

/**
 * Вебхук Telegram-бота @campsflint_bot. Делает бота и сайт единым целым:
 *  - /start                → приветствие + кнопка Mini App + список открытых событий;
 *  - /start event_<id>      → карточка события с кнопкой «✅ Записаться»;
 *  - callback reg_<id>      → регистрация в один тап с РЕАЛЬНЫМ telegram_id
 *                            (сохраняется в ту же БД, что и заявки с сайта).
 *
 * ENV: TELEGRAM_BOT_TOKEN (обяз.), TELEGRAM_WEBHOOK_SECRET (опц., сверяется с
 * заголовком), SUPABASE_URL/SERVICE_ROLE_KEY, TELEGRAM_ADMIN_CHAT_ID.
 */

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';
const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID || '-1003935660570';
const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || 'campsflint_bot';
const supabase = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');

function tg(method: string, payload: unknown) {
  return fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => r.json());
}

function esc(s: any): string {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function siteUrl(req: any): string {
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'flint-live-in-moment.vercel.app';
  return `https://${host}`;
}

async function getEvent(id: string) {
  const { data } = await supabase.from('events').select('*').eq('id', id).single();
  return data;
}

const DOW_RU = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const MON_RU = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

/** Сколько дней осталось до даты (0 = сегодня). */
function daysUntil(date: string): number | null {
  if (!date) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(`${date}T00:00:00`);
  if (isNaN(d.getTime())) return null;
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

/** «через 5 дней», «завтра», «сегодня», «прошло». Человек должен сразу понимать срок. */
function whenPhrase(date: string): string {
  const n = daysUntil(date);
  if (n === null) return '';
  if (n < 0) return 'уже прошло';
  if (n === 0) return 'сегодня';
  if (n === 1) return 'завтра';
  if (n === 2) return 'послезавтра';
  const last = n % 10, tens = n % 100;
  const word = (tens >= 11 && tens <= 14) ? 'дней' : last === 1 ? 'день' : (last >= 2 && last <= 4) ? 'дня' : 'дней';
  return `через ${n} ${word}`;
}

/** «суббота, 18 июля» — день недели и дата явно, без догадок. */
function dayPhrase(date: string): string {
  if (!date) return '';
  const d = new Date(`${date}T00:00:00`);
  if (isNaN(d.getTime())) return '';
  return `${DOW_RU[d.getDay()]}, ${d.getDate()} ${MON_RU[d.getMonth()]}`;
}

/** Ссылка на построение маршрута: открывается в картах телефона. */
function routeUrl(ev: any): string | null {
  const lat = ev?.coordinates_lat, lng = ev?.coordinates_lng;
  if (lat && lng) return `https://yandex.ru/maps/?rtext=~${lat},${lng}&rtt=auto`;
  if (ev?.location) return `https://yandex.ru/maps/?text=${encodeURIComponent(ev.location)}`;
  return null;
}

function eventCard(ev: any): string {
  const aud = ev.entry_type === 'male' ? '👨 Только мужчины'
    : ev.entry_type === 'female' ? '👩 Только женщины' : '👥 Все';
  const when = whenPhrase(ev.date);
  const day = dayPhrase(ev.date);
  return (
    `<b>${esc(ev.title)}</b>\n\n` +
    // Сначала — когда и через сколько: это первое, что человек хочет знать.
    (day ? `🗓 ${esc(day)}${ev.time ? `, ${esc(ev.time)}` : ''}\n` : '') +
    (when ? `⏳ <b>${esc(when)}</b>\n` : '') +
    (ev.date_end && ev.date_end !== ev.date ? `📆 по ${esc(dayPhrase(ev.date_end))}\n` : '') +
    (ev.location ? `📍 ${esc(ev.location)}\n` : '') +
    (ev.price_label ? `💳 ${esc(ev.price_label)}\n` : '') +
    (ev.entry_threshold ? `🎫 ${esc(ev.entry_threshold)}\n` : '') +
    `${aud}\n` +
    (ev.description ? `\n${esc(String(ev.description).slice(0, 600))}` : '')
  );
}

/** Регистрация из бота с реальным telegram_id (from — Telegram-пользователь). */
async function registerFromBot(from: any, ev: any): Promise<'ok' | 'already' | 'error'> {
  try {
    const telegramId = from.id;
    await supabase
      .from('members')
      .upsert(
        { telegram_id: telegramId, username: from.username || null, first_name: from.first_name || null },
        { onConflict: 'telegram_id' }
      );
    try { await ensureRefCode(telegramId); } catch {}
    const { data: existing } = await supabase
      .from('registrations')
      .select('id')
      .eq('event_id', ev.id)
      .eq('telegram_id', telegramId)
      .maybeSingle();
    if (existing) return 'already';
    await supabase.from('registrations').insert({
      id: `reg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      event_id: ev.id,
      telegram_id: telegramId,
      name: from.first_name || from.username || 'Гость',
      source: 'telegram-bot',
      status: 'pending',
    });
    try { await supabase.rpc('increment_participants', { event_id: ev.id }); } catch {}
    if (ADMIN_CHAT_ID) {
      try {
        await tg('sendMessage', {
          chat_id: ADMIN_CHAT_ID,
          parse_mode: 'HTML',
          text:
            `🟢 <b>Заявка из бота</b>\n${esc(ev.title)}\n` +
            `${esc(from.first_name || '')} ${from.username ? '@' + esc(from.username) : ''} (id ${telegramId})`,
        });
      } catch {}
    }
    return 'ok';
  } catch {
    return 'error';
  }
}

async function updateReg(evId: string, tgId: any, patch: Record<string, unknown>) {
  await supabase.from('registrations').update(patch).eq('event_id', evId).eq('telegram_id', tgId);
}

/** Реф-система: выдать участнику личный ref_code (если ещё нет). */
async function ensureRefCode(tgId: number): Promise<string | null> {
  const { data } = await supabase.from('members').select('ref_code').eq('telegram_id', tgId).maybeSingle();
  if (data?.ref_code) return data.ref_code;
  for (let i = 0; i < 5; i++) {
    const c = Math.random().toString(36).slice(2, 9);
    const { error } = await supabase.from('members').update({ ref_code: c }).eq('telegram_id', tgId);
    if (!error) return c;
  }
  return null;
}

/**
 * Приглашение по цепочке: код действующего участника открывает двери сразу.
 * Приглашать может только тот, кто сам внутри (approved или костяк) — иначе
 * отклонённый мог бы наплодить себе «клуб» из своей же ссылки.
 * Возвращает true, если человек принят в клуб по этой ссылке.
 */
async function bindReferrer(from: any, code: string): Promise<boolean> {
  await supabase.from('members').upsert(
    { telegram_id: from.id, username: from.username || null, first_name: from.first_name || null },
    { onConflict: 'telegram_id' }
  );

  const { data: me } = await supabase.from('members').select('referred_by,status').eq('telegram_id', from.id).maybeSingle();
  if ((me as any)?.status === 'blocked') return false;
  // Уже внутри — ссылка ничего не меняет.
  if ((me as any)?.status === 'approved') return true;

  const { data: inv } = await supabase
    .from('members').select('telegram_id,status,is_core').eq('ref_code', code).maybeSingle();
  if (!inv || inv.telegram_id === from.id) return false;
  const inviterInside = (inv as any).status === 'approved' || (inv as any).is_core === true;
  if (!inviterInside) return false;

  const patch: Record<string, unknown> = { status: 'approved', approved_by: inv.telegram_id };
  if (!(me as any)?.referred_by) patch.referred_by = inv.telegram_id;
  await supabase.from('members').update(patch).eq('telegram_id', from.id);

  if (!(me as any)?.referred_by) {
    try { await supabase.from('referrals').insert({ ref_code: code, inviter_id: inv.telegram_id, invited_id: from.id }); } catch { /* аудит best-effort */ }
    // Пригласившему приятно знать, что ссылка сработала.
    try {
      await tg('sendMessage', {
        chat_id: inv.telegram_id, parse_mode: 'HTML',
        text: `🤝 По твоей ссылке пришёл <b>${esc(from.first_name || 'новый участник')}</b>. Баллы придут, когда он побывает на первом событии.`,
      });
    } catch { /* мог не начинать чат */ }
  }
  return true;
}
function kb(rows: any[]) { return { inline_keyboard: rows }; }
function foodNeeded(ev: any) { return ['active', 'male', 'mixed'].includes(ev?.type); }

/** Постоянное меню внизу чата — раньше у участника не было ни одной кнопки под рукой. */
function mainMenu() {
  return {
    keyboard: [
      [{ text: '📅 Ближайшие события' }, { text: '👤 Мой статус' }],
      [{ text: '🚗 Логистика и брони' }, { text: 'ℹ️ Помощь' }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

/**
 * Кнопки под карточкой события. Набор зависит от самого события:
 * интеллектуальному клубу не нужна логистика, бесплатному — оплата,
 * событию без координат — маршрут.
 */
function eventCardButtons(ev: any, openBtn: any): any[] {
  const rows: any[] = [[{ text: '✅ Записаться', callback_data: `reg_${ev.id}` }]];

  const route = routeUrl(ev);
  const nav: any[] = [];
  if (route) nav.push({ text: '🧭 Маршрут', url: route });
  if ((ev.program || []).length) nav.push({ text: '📋 Программа', callback_data: `prog_${ev.id}` });
  if (nav.length) rows.push(nav);

  if (ev.price_type === 'paid') rows.push([{ text: '💳 Оплата', callback_data: `pay_${ev.id}` }]);
  if (ev.type !== 'intellectual') rows.push([{ text: '🚗 Логистика и брони', callback_data: `logi_${ev.id}` }]);

  rows.push([
    { text: '❓ Спросить', callback_data: `ask_${ev.id}` },
    { text: '💡 Предложить', callback_data: `idea_${ev.id}` },
  ]);
  rows.push([{ text: '📤 Позвать друга', callback_data: `share_${ev.id}` }]);
  rows.push([openBtn]);
  return rows;
}

// --- Закрытый клуб ---
// Клуб закрытый по определению: попасть можно только по реф-ссылке участника.
// Раньше флаг был выключен по умолчанию, и зарегистрироваться мог кто угодно.
// Аварийно открыть двери: GATE_ENABLED=0.
function gateOn(): boolean { return process.env.GATE_ENABLED !== '0'; }
async function memberOf(tgId: number): Promise<{ status?: string; is_core?: boolean } | null> {
  const { data } = await supabase.from('members').select('status,is_core').eq('telegram_id', tgId).maybeSingle();
  return (data as any) || null;
}
async function isApproved(tgId: number): Promise<boolean> {
  const m = await memberOf(tgId);
  return !!m && (m.status === 'approved' || m.is_core === true);
}
async function isCore(tgId: number): Promise<boolean> {
  const m = await memberOf(tgId);
  return !!m && m.is_core === true;
}

/** Шаг «откуда узнал». Если человек пришёл по ссылке — реферер уже известен. */
async function askApplySource(tgId: number, chatId: number, context: any) {
  await setSession(tgId, 'apply_source', context);
  await tg('sendMessage', {
    chat_id: chatId, parse_mode: 'HTML',
    text: '🤝 Последний вопрос: <b>кто тебя пригласил или откуда ты о нас узнал?</b>\n\nНапиши имя или @ник участника — костяку важно понимать, кто за тебя ручается.',
    reply_markup: { remove_keyboard: true },
  });
}

/**
 * Заявка уходит костяку с полной карточкой: имя, телефон, ник, кто пригласил.
 * Раньше приходил только ник — принимать вслепую было нельзя.
 */
async function finishApplication(from: any, chatId: number, context: any) {
  const tgId = from.id;
  await clearSession(tgId);

  await supabase.from('members').update({
    status: 'pending_review',
    first_name: context.name || from.first_name || null,
    phone: context.phone || null,
    agreed_pd: true,
  }).eq('telegram_id', tgId);

  // Кто пригласил — если пришёл по реф-ссылке, знаем точно.
  const { data: me } = await supabase.from('members').select('referred_by').eq('telegram_id', tgId).maybeSingle();
  let inviter = '';
  if ((me as any)?.referred_by) {
    const { data: inv } = await supabase.from('members').select('first_name,username').eq('telegram_id', (me as any).referred_by).maybeSingle();
    inviter = inv ? `${(inv as any).first_name || ''} ${(inv as any).username ? '@' + (inv as any).username : ''}` : String((me as any).referred_by);
  }

  await tg('sendMessage', {
    chat_id: chatId, parse_mode: 'HTML',
    text:
      '✅ <b>Заявка отправлена</b>\n\n' +
      `Имя: ${esc(context.name || '')}\nТелефон: ${esc(context.phone || '')}\n\n` +
      'Костяк клуба рассмотрит её вручную — обычно в течение дня. Ответ придёт сюда.',
    reply_markup: { remove_keyboard: true },
  });

  if (ADMIN_CHAT_ID) {
    await tg('sendMessage', {
      chat_id: ADMIN_CHAT_ID, parse_mode: 'HTML',
      text:
        `🚪 <b>Заявка в клуб</b>\n\n` +
        `👤 ${esc(context.name || from.first_name || '')}\n` +
        `📞 <code>${esc(context.phone || '—')}</code>\n` +
        `✈️ ${from.username ? '@' + esc(from.username) : 'ника нет'} (id ${tgId})\n` +
        (inviter ? `🔗 Пригласил: ${esc(inviter)}\n` : '') +
        `💬 Откуда: ${esc(context.source || '—')}`,
      reply_markup: kb([
        [
          { text: '✅ Принять', callback_data: `approve_${tgId}` },
          { text: '❌ Отклонить', callback_data: `reject_${tgId}` },
        ],
        [{ text: '✍️ Написать заявителю', callback_data: `reply_${tgId}` }],
      ]),
    });
  }
}

/**
 * Профиль: баллы, приглашённые, посещённые события, реф-ссылка.
 * Раньше ссылку можно было только выделить пальцем — теперь есть кнопка
 * «Отправить другу», которая открывает нативный шеринг Telegram.
 */
async function handleProfileCommand(msg: any, chatId: number, openBtn: any) {
  const tgId = msg.from.id;
  await supabase.from('members').upsert(
    { telegram_id: tgId, username: msg.from.username || null, first_name: msg.from.first_name || null },
    { onConflict: 'telegram_id' }
  );
  const code = await ensureRefCode(tgId);
  const { data: me } = await supabase.from('members').select('points,status,is_core').eq('telegram_id', tgId).maybeSingle();
  const { count: invited } = await supabase.from('members').select('telegram_id', { count: 'exact', head: true }).eq('referred_by', tgId);
  const { count: visited } = await supabase.from('registrations').select('id', { count: 'exact', head: true }).eq('telegram_id', tgId).eq('attended', true);

  const link = code ? `https://t.me/${BOT_USERNAME}?start=ref_${code}` : null;
  const status = (me as any)?.is_core ? 'костяк клуба'
    : (me as any)?.status === 'approved' ? 'участник клуба'
    : (me as any)?.status === 'pending_review' ? 'заявка на рассмотрении'
    : 'новичок';

  const rows: any[] = [];
  if (link) {
    const invite = 'Это «Живи в моменте» — закрытый клуб трезвых событий. Заходи по моей ссылке.';
    rows.push([{ text: '📤 Отправить другу', url: `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(invite)}` }]);
  }
  rows.push([openBtn]);

  await tg('sendMessage', {
    chat_id: chatId, parse_mode: 'HTML',
    text:
      `👤 <b>${esc(msg.from.first_name || 'Профиль')}</b>\n\n` +
      `🏅 Баллы: <b>${(me as any)?.points || 0}</b>\n` +
      `🚪 Статус: ${esc(status)}\n` +
      `🤝 Пригласил: <b>${invited || 0}</b>\n` +
      `🎒 Событий посетил: <b>${visited || 0}</b>\n\n` +
      (link
        ? `🔗 Твоя реф-ссылка:\n<code>${esc(link)}</code>\n\n<i>Нажми на ссылку — скопируется. Или жми «Отправить другу». Баллы придут, когда друг впервые дойдёт до события.</i>`
        : '<i>Реф-ссылка недоступна.</i>'),
    reply_markup: kb(rows),
  });
}

// --- Сессии диалога (для пошагового ввода текста) ---
async function getSession(tgId: number): Promise<{ state: string; context: any } | null> {
  const { data } = await supabase.from('bot_sessions').select('state,context').eq('telegram_id', tgId).maybeSingle();
  return data ? { state: (data as any).state, context: (data as any).context || {} } : null;
}
async function setSession(tgId: number, state: string, context: any) {
  const { error } = await supabase.from('bot_sessions').upsert(
    { telegram_id: tgId, state, context, updated_at: new Date().toISOString() },
    { onConflict: 'telegram_id' }
  );
  // Если состояние не сохранилось, следующий шаг диалога молча провалится
  // в фолбэк «Нажми кнопку ниже» — так уже ломался ввод точки выезда.
  if (error) throw new Error(`bot_sessions upsert: ${error.message}`);
}
async function clearSession(tgId: number) {
  await supabase.from('bot_sessions').delete().eq('telegram_id', tgId);
}

// --- Машины (участник-driven логистика) ---
/** Карточка машины. Название события обязательно: у человека их может быть несколько. */
function rideLine(r: any, eventTitle?: string): string {
  const taken = r.seats_taken || 0;
  const free = Math.max(0, (r.seats_total || 0) - taken);
  const fuel = r.fuel_cost ? `⛽ ${r.fuel_cost} ₽/чел` : '⛽ бесплатно';
  return (eventTitle ? `📅 <b>${esc(eventTitle)}</b>\n\n` : '') +
    `🚗 <b>${esc(r.driver_name || 'Водитель')}</b>\n` +
    `📍 Выезд: ${esc(r.from_point || '—')}\n` +
    `🕐 Когда: ${esc(r.depart_text || '—')}\n` +
    `💺 Свободно ${free} из ${r.seats_total || 0}   ${fuel}`;
}

/** Маршрут до точки выезда водителя — открывается в картах телефона. */
function pointRouteUrl(fromPoint: string): string | null {
  const p = String(fromPoint || '').trim();
  if (!p) return null;
  return `https://yandex.ru/maps/?rtext=~${encodeURIComponent(p)}&rtt=auto`;
}

// --- Организация: чек-листы снаряжения и ролей (мультивыбор, stateless по registration) ---
const EQUIP = ['Вилка', 'Ложка', 'Спальник', 'Фонарик', 'Дождевик', 'Аптечка', 'Мешки для мусора', 'Антисептик', 'Туалетная бумага', 'Лопата', 'Запасное одеяло', 'Тетра-пакеты'];
const ROLES = ['Готовка', 'Костёр', 'Фото', 'Музыка', 'Аптечка', 'Логистика'];
function checklistKb(prefix: string, evId: string, items: string[], selected: string[]) {
  const sel = new Set(selected);
  const rows = items.map((it, i) => [{ text: `${sel.has(it) ? '✅' : '▫️'} ${it}`, callback_data: `${prefix}_${evId}_${i}` }]);
  rows.push([{ text: '⬅️ Назад', callback_data: `org_${evId}` }]);
  return { inline_keyboard: rows };
}

// --- Даты участия (для многодневных событий) ---
const RU_MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
function eventDays(ev: any): { date: string; label: string }[] {
  const start = ev?.date;
  const end = ev?.date_end || ev?.date;
  if (!start) return [];
  const out: { date: string; label: string }[] = [];
  const d = new Date(`${start}T00:00:00`);
  const endD = new Date(`${end}T00:00:00`);
  let guard = 0;
  while (d <= endD && guard < 31) {
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    out.push({ date: iso, label: `${d.getDate()} ${RU_MON[d.getMonth()]}` });
    d.setDate(d.getDate() + 1);
    guard++;
  }
  return out;
}
function isMultiDay(ev: any): boolean {
  return !!(ev?.date_end && ev.date_end !== ev.date);
}
function daysKb(evId: string, days: { date: string; label: string }[], selected: string[]) {
  const sel = new Set(selected);
  const rows = days.map((day, i) => [{ text: `${sel.has(day.date) ? '✅' : '▫️'} ${day.label}`, callback_data: `dt_${evId}_${i}` }]);
  rows.push([{ text: '➡️ Дальше', callback_data: `dtdone_${evId}` }]);
  return { inline_keyboard: rows };
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true, info: 'Flint bot webhook (@campsflint_bot)' });
  }
  if (WEBHOOK_SECRET && req.headers['x-telegram-bot-api-secret-token'] !== WEBHOOK_SECRET) {
    return res.status(401).json({ ok: false });
  }
  if (!BOT_TOKEN) return res.status(200).json({ ok: true, warning: 'TELEGRAM_BOT_TOKEN не задан' });

  try {
    const update = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const site = siteUrl(req);
    const openBtn = { text: '🗓 Открыть афишу', web_app: { url: site } };

    // Отметка живости: любой апдейт от человека = бот у него не заблокирован.
    // Без этого нельзя честно сказать, сколько участников реально получат рассылку.
    const actor = update.callback_query?.from || update.message?.from;
    if (actor?.id) {
      const base = { telegram_id: actor.id, username: actor.username || null, first_name: actor.first_name || null };
      const { error } = await supabase.from('members').upsert(
        { ...base, bot_active: true, last_seen_at: new Date().toISOString() },
        { onConflict: 'telegram_id' }
      );
      // До миграции колонок нет — тогда хотя бы обновим имя, не теряя апдейт целиком.
      if (error) await supabase.from('members').upsert(base, { onConflict: 'telegram_id' });
    }

    // Кнопки: запись + пошаговый умный опрос под событие.
    if (update.callback_query) {
      const cq = update.callback_query;
      const data = cq.data || '';
      const chatId = cq.message?.chat?.id;
      const msgId = cq.message?.message_id;
      const tgId = cq.from.id;

      /**
       * Клубный заслон на ВСЕ действия. Раньше стоял только на `reg_`, поэтому
       * непринятый человек мог открыть событие, занять место в машине и увидеть
       * логистику. Пропускаем лишь вступление, поддержку и модерацию костяка.
       */
      const OPEN_TO_ALL = /^(verify_start|verify_consent|verify_pd|support|approve_|reject_|payok_|payno_|reply_)/;
      if (gateOn() && !OPEN_TO_ALL.test(data) && !(await isApproved(tgId))) {
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Сначала нужно вступить в клуб', show_alert: true });
        await tg('sendMessage', {
          chat_id: chatId, parse_mode: 'HTML',
          text: '🔒 Это доступно участникам клуба.\n\nЕсли у тебя есть ссылка-приглашение — открой её. Если нет — подай заявку, костяк рассмотрит.',
          reply_markup: kb([[{ text: '✅ Подать заявку', callback_data: 'verify_start' }], [{ text: '💬 Поддержка', callback_data: 'support' }]]),
        });
        return res.status(200).json({ ok: true });
      }

      const payRow = (ev: any) => (ev?.price_type === 'paid' ? [{ text: '💳 Оплатить участие', callback_data: `pay_${ev.id}` }] : null);
      const finalKb = (ev: any) => {
        const rows: any[] = [];
        const p = payRow(ev);
        if (p) rows.push(p);
        if (ev && ev.type !== 'intellectual') {
          rows.push([{ text: '🚗 Логистика и брони', callback_data: `logi_${ev.id}` }]);
          rows.push([{ text: '📋 Организация (снаряжение, роли)', callback_data: `org_${ev.id}` }]);
        }
        rows.push([openBtn]);
        return kb(rows);
      };
      const finalConfirm = async (ev: any) => {
        const paid = ev?.price_type === 'paid';
        await tg('editMessageText', {
          chat_id: chatId, message_id: msgId, parse_mode: 'HTML',
          text: `✅ Готово! Ты записан(а) на «<b>${esc(ev?.title || 'событие')}</b>».` +
            (paid ? '\n\n💳 Осталось оплатить участие — кнопка ниже.' : '') +
            `\n\nДальше всё автоматически: детали, точная локация и напоминания придут сюда. Вопросы по событию — прямо в этот чат.`,
          reply_markup: finalKb(ev),
        });
      };
      const finishReg = async (ev: any, guests: number, children: number) => {
        const extras: string[] = [];
        if (guests > 0) extras.push(`+${guests} гост${guests === 1 ? 'ь' : 'я'}`);
        if (children > 0) extras.push(`+${children} ${children === 1 ? 'ребёнок' : 'детей'}`);
        await tg('editMessageText', {
          chat_id: chatId, message_id: msgId, parse_mode: 'HTML',
          text: `✅ Готово! Ты записан(а) на «<b>${esc(ev?.title || 'событие')}</b>»` +
            (extras.length ? ` (${extras.join(', ')}).\n<i>За гостей отвечаешь и оплачиваешь ты.</i>` : '.') +
            (ev?.price_type === 'paid' ? '\n\n💳 Осталось оплатить участие — кнопка ниже.' : '') +
            `\n\nСнаряжение и «чем буду полезен» — кнопка «📋 Организация». Вопросы — прямо сюда.`,
          reply_markup: finalKb(ev),
        });
      };
      const askFood = async (evId: string) => {
        await tg('editMessageText', {
          chat_id: chatId, message_id: msgId, parse_mode: 'HTML',
          text: '🍽 Твоё питание? (учтём в списке закупки)',
          reply_markup: kb([
            [{ text: '🍗 Всеядный', callback_data: `rf:${evId}:all` }],
            [{ text: '🥗 Вегетарианец', callback_data: `rf:${evId}:veg` }],
            [{ text: '🌱 Веган', callback_data: `rf:${evId}:vegan` }],
            [{ text: '🥡 Привезу своё — без общей еды', callback_data: `rf:${evId}:own` }],
          ]),
        });
      };
      const askGuest = async (evId: string) => {
        await tg('editMessageText', {
          chat_id: chatId, message_id: msgId, parse_mode: 'HTML',
          text: '👥 Берёшь кого-то с собой?\n<i>За гостя отвечаешь и оплачиваешь его долю ты. Он не проходит регистрацию отдельно.</i>',
          reply_markup: kb([
            [{ text: 'Я один', callback_data: `rg:${evId}:0` }],
            [{ text: '+1 гость', callback_data: `rg:${evId}:1` }],
            [{ text: '+2 гостя', callback_data: `rg:${evId}:2` }],
          ]),
        });
      };

      // Заявка в клуб, шаг 1: согласие на обработку персональных данных.
      if (data === 'verify_start' || data === 'verify_consent') {
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        await tg('editMessageText', {
          chat_id: chatId, message_id: msgId, parse_mode: 'HTML',
          text:
            '📋 <b>Шаг 1 из 3 — согласие на обработку данных</b>\n\n' +
            'Нам нужны имя, телефон и предпочтения, чтобы собрать логистику и закупку. ' +
            'Данные видит только костяк клуба, третьим лицам не передаём (законодательство РБ).',
          reply_markup: kb([[{ text: '✅ Согласен, продолжить', callback_data: 'verify_pd' }]]),
        });
        return res.status(200).json({ ok: true });
      }

      // Шаг 2: как зовут.
      if (data === 'verify_pd') {
        await supabase.from('members').update({ agreed_pd: true }).eq('telegram_id', tgId);
        await setSession(tgId, 'apply_name', {});
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        await tg('editMessageText', {
          chat_id: chatId, message_id: msgId, parse_mode: 'HTML',
          text: '👤 <b>Шаг 2 из 3 — знакомство</b>\n\nКак тебя зовут? Напиши имя и фамилию — костяк должен понимать, кого принимает.',
        });
        return res.status(200).json({ ok: true });
      }

      // Поддержка — доступна и до вступления в клуб.
      if (data === 'support') {
        await setSession(tgId, 'support_text', {});
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        await tg('sendMessage', {
          chat_id: chatId, parse_mode: 'HTML',
          text: '💬 <b>Поддержка</b>\n\nОпиши вопрос одним сообщением — передам организаторам. Ответ придёт сюда.',
        });
        return res.status(200).json({ ok: true });
      }

      // Костяк отвечает пользователю на заявку/поддержку/вопрос.
      if (data.startsWith('reply_')) {
        if (!(await isCore(cq.from.id))) {
          await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Отвечать может только костяк' });
          return res.status(200).json({ ok: true });
        }
        const targetId = Number(data.slice('reply_'.length));
        await setSession(cq.from.id, 'admin_reply', { targetId });
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `✍️ Напиши ответ следующим сообщением — доставлю пользователю (id ${targetId}).` });
        return res.status(200).json({ ok: true });
      }

      // Модерация заявки костяком.
      if (data.startsWith('approve_') || data.startsWith('reject_')) {
        if (!(await isCore(cq.from.id))) {
          await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Решать может только костяк клуба' });
          return res.status(200).json({ ok: true });
        }
        const approve = data.startsWith('approve_');
        const targetId = Number(data.split('_')[1]);
        await supabase.from('members').update({ status: approve ? 'approved' : 'blocked', approved_by: cq.from.id }).eq('telegram_id', targetId);
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: approve ? 'Принят ✅' : 'Отклонён' });
        await tg('editMessageText', {
          chat_id: chatId, message_id: msgId, parse_mode: 'HTML',
          text: `${approve ? '✅ Принят в клуб' : '❌ Отклонён'} (id ${targetId}) — решил ${esc(cq.from.first_name || 'костяк')}`,
        });
        try {
          if (approve) {
            // Сразу показываем события: «нажми /start» — лишний шаг и потеря человека.
            const { data: evs } = await supabase
              .from('events').select('id,title,date').eq('status', 'open').order('date', { ascending: true }).limit(6);
            const rows = (evs || []).map((e: any) => [{ text: `${e.title} · ${whenPhrase(e.date)}`, callback_data: `ev_${e.id}` }]);
            rows.push([openBtn as any]);
            await tg('sendMessage', {
              chat_id: targetId, parse_mode: 'HTML',
              text: '🎉 <b>Тебя приняли в клуб!</b>\n\nТеперь доступны все события: выбирай и записывайся в пару кликов.\nМеню всегда снизу.',
              reply_markup: rows.length > 1 ? kb(rows) : kb([[openBtn]]),
            });
            await tg('sendMessage', { chat_id: targetId, text: 'Меню 👇', reply_markup: mainMenu() });
          } else {
            await tg('sendMessage', {
              chat_id: targetId, parse_mode: 'HTML',
              text: '🚪 К сожалению, заявка в клуб отклонена.\n\nЕсли считаешь это ошибкой — напиши нам.',
              reply_markup: kb([[{ text: '💬 Написать в поддержку', callback_data: 'support' }]]),
            });
          }
        } catch { /* пользователь мог не начинать чат */ }
        return res.status(200).json({ ok: true });
      }

      // Оплата: показать реквизиты + кнопку «Я оплатил».
      if (data.startsWith('pay_')) {
        const ev = await getEvent(data.slice(4));
        if (!ev) { await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Событие не найдено' }); return res.status(200).json({ ok: true }); }
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        const pd = ev.payment_details || {};
        const lines = ['💳 <b>Оплата участия</b>', ''];
        if (ev.price_label) lines.push(esc(ev.price_label));
        if (pd.card) lines.push(`💳 Карта: <code>${esc(pd.card)}</code>`);
        if (pd.erip) lines.push(`🏦 ЕРИП: ${esc(pd.erip)}`);
        if (pd.method) lines.push(`ℹ️ ${esc(pd.method)}`);
        if (!pd.card && !pd.erip && !pd.method) lines.push('<i>Реквизиты уточняются у организатора.</i>');
        lines.push('', 'После перевода нажми кнопку ниже — организатор подтвердит.');
        await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: lines.join('\n'), reply_markup: kb([[{ text: '✅ Я оплатил', callback_data: `paid_${ev.id}` }], [openBtn]]) });
        return res.status(200).json({ ok: true });
      }

      // Пользователь заявил об оплате → модерация организатору.
      if (data.startsWith('paid_')) {
        const evId = data.slice(5);
        const ev = await getEvent(evId);
        await updateReg(evId, tgId, { payment_status: 'submitted', payment_submitted_at: new Date().toISOString() });
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Отправлено на проверку' });
        await tg('editMessageText', { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', text: '⏳ Оплата отправлена на проверку организатору. Как подтвердит — уведомим здесь.' });
        if (ADMIN_CHAT_ID) {
          await tg('sendMessage', {
            chat_id: ADMIN_CHAT_ID, parse_mode: 'HTML',
            text: `💰 <b>Оплата заявлена</b>\n${esc(ev?.title || evId)}\n${esc(cq.from.first_name || '')} ${cq.from.username ? '@' + esc(cq.from.username) : ''} (id ${tgId})`,
            reply_markup: kb([[
              { text: '✅ Подтвердить', callback_data: `payok_${evId}_${tgId}` },
              { text: '❌ Отклонить', callback_data: `payno_${evId}_${tgId}` },
            ]]),
          });
        }
        return res.status(200).json({ ok: true });
      }

      // Модерация оплаты: костяк или назначенный заместитель на это событие.
      if (data.startsWith('payok_') || data.startsWith('payno_')) {
        const ok = data.startsWith('payok_');
        const rest = data.slice(6);
        const idx = rest.lastIndexOf('_');
        const evId = rest.slice(0, idx);
        const targetId = Number(rest.slice(idx + 1));
        const evForAuth = await getEvent(evId);
        const canModerate = (await isCore(cq.from.id)) || (evForAuth && evForAuth.deputy_id === cq.from.id);
        if (!canModerate) { await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Подтверждать может только организатор' }); return res.status(200).json({ ok: true }); }
        await updateReg(evId, targetId, { payment_status: ok ? 'paid' : 'pending' });
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: ok ? 'Оплата подтверждена' : 'Отклонено' });
        await tg('editMessageText', { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', text: `${ok ? '✅ Оплата подтверждена' : '❌ Оплата отклонена'} (id ${targetId}) — ${esc(cq.from.first_name || 'организатор')}` });
        try {
          if (ok) {
            await tg('sendMessage', { chat_id: targetId, parse_mode: 'HTML', text: '✅ Твоя оплата подтверждена. Спасибо, ты в деле!' });
          } else {
            await tg('sendMessage', { chat_id: targetId, parse_mode: 'HTML', text: '❌ Оплата не подтверждена. Проверь перевод и попробуй снова.', reply_markup: kb([[{ text: '💳 Оплатить участие', callback_data: `pay_${evId}` }], [openBtn]]) });
          }
        } catch { /* пользователь мог не начинать чат */ }
        return res.status(200).json({ ok: true });
      }

      // Регистрация + старт опроса (после согласия ПД).
      // Опрос транспорта (общий шаг). Для многодневных — сначала выбор дат.
      const askTransport = async (ev: any) => {
        await tg('sendMessage', {
          chat_id: chatId, parse_mode: 'HTML',
          text: '🚗 Как добираешься?',
          reply_markup: kb([
            [{ text: '🚗 На авто — могу подвезти', callback_data: `rt:${ev.id}:car` }],
            [{ text: '🚗 Авто есть, но мест нет', callback_data: `rt:${ev.id}:carfull` }],
            [{ text: '🚶 Нужна попутка', callback_data: `rt:${ev.id}:seek` }],
            [{ text: 'Доберусь сам', callback_data: `rt:${ev.id}:self` }],
          ]),
        });
      };
      // Правила события перед записью — человек должен ознакомиться и принять.
      const askRules = async (ev: any) => {
        const lines = ['📜 <b>Правила события</b>', ''];
        if (ev.entry_threshold) lines.push(`🎫 <b>Порог входа:</b>\n${esc(ev.entry_threshold)}`, '');
        lines.push(
          '<b>Кодекс участника:</b>',
          '• 100% трезвость на встрече',
          '• уважение к другим и к месту',
          '• записался — предупреди заранее, если не сможешь',
          '• помогаем друг другу, а не потребляем',
          '',
          'Записываясь, ты соглашаешься с этим.',
        );
        await tg('sendMessage', {
          chat_id: chatId, parse_mode: 'HTML',
          text: lines.join('\n'),
          reply_markup: kb([[{ text: '✅ Принимаю правила, записаться', callback_data: `rules_${ev.id}` }]]),
        });
      };

      const beginReg = async (ev: any) => {
        const r = await registerFromBot(cq.from, ev);
        if (r === 'error') { await tg('sendMessage', { chat_id: chatId, text: 'Ошибка записи, попробуйте позже.' }); return; }
        if (ev.type === 'intellectual') {
          await tg('sendMessage', {
            chat_id: chatId, parse_mode: 'HTML',
            text: `✅ Ты записан(а) на «<b>${esc(ev.title)}</b>»!\n\nДетали и напоминания придут в бот. Вопросы — прямо сюда.`,
            reply_markup: finalKb(ev),
          });
          return;
        }
        // Многодневное — сначала выбор конкретных дней участия.
        if (isMultiDay(ev)) {
          const days = eventDays(ev);
          await updateReg(ev.id, tgId, { days: days.map((d) => d.date) }); // по умолчанию все дни
          await tg('sendMessage', {
            chat_id: chatId, parse_mode: 'HTML',
            text: `✅ Записал на «<b>${esc(ev.title)}</b>». В какие дни будешь? (по умолчанию — все, сними лишние)`,
            reply_markup: daysKb(ev.id, days, days.map((d) => d.date)),
          });
          return;
        }
        await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `✅ Записал тебя на «<b>${esc(ev.title)}</b>». Пара быстрых уточнений 👇` });
        await askTransport(ev);
      };

      // Старт записи с карточки события.
      if (data.startsWith('reg_')) {
        if (gateOn() && !(await isApproved(tgId))) {
          await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Сначала пройди верификацию — нажми /start' });
          return res.status(200).json({ ok: true });
        }
        const ev = await getEvent(data.slice(4));
        if (!ev) {
          await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Событие не найдено' });
          return res.status(200).json({ ok: true });
        }
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        // Явный первый шаг — согласие на обработку ПД (РБ), если ещё не давал.
        const mem = await memberOf(tgId) as any;
        const agreed = mem && mem.agreed_pd;
        if (!agreed) {
          await tg('sendMessage', {
            chat_id: chatId, parse_mode: 'HTML',
            text: '📋 <b>Согласие на обработку персональных данных</b>\n\nДля участия нужно согласие на обработку твоих персональных данных (имя, контакт, предпочтения) организаторами — в соответствии с законодательством РБ. Данные используются только для организации события.',
            reply_markup: kb([[{ text: '✅ Согласен, продолжить', callback_data: `pd_${ev.id}` }]]),
          });
          return res.status(200).json({ ok: true });
        }
        await askRules(ev);
        return res.status(200).json({ ok: true });
      }

      // Согласие ПД дано → показываем правила события.
      if (data.startsWith('pd_')) {
        const ev = await getEvent(data.slice(3));
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Спасибо!' });
        if (!ev) return res.status(200).json({ ok: true });
        await supabase.from('members').update({ agreed_pd: true }).eq('telegram_id', tgId);
        await tg('editMessageText', { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', text: '✅ Согласие получено.' });
        await askRules(ev);
        return res.status(200).json({ ok: true });
      }

      // Правила приняты → регистрируем.
      if (data.startsWith('rules_')) {
        const ev = await getEvent(data.slice('rules_'.length));
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        if (!ev) return res.status(200).json({ ok: true });
        await tg('editMessageText', { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', text: '✅ Правила приняты. Продолжаем запись 👇' });
        // Закрытое событие — сначала код доступа (проверяется на сервере).
        if (ev.is_public === false && ev.access_code) {
          await setSession(tgId, 'reg_code', { evId: ev.id });
          await tg('sendMessage', {
            chat_id: chatId, parse_mode: 'HTML',
            text: '🔒 Это <b>закрытое событие</b>. Введи <b>код доступа</b> из приглашения — одним сообщением:',
          });
          return res.status(200).json({ ok: true });
        }
        await beginReg(ev);
        return res.status(200).json({ ok: true });
      }

      // Шаги опроса (stateless: событие и ответ закодированы в callback_data).
      if (data.startsWith('rt:') || data.startsWith('rs:') || data.startsWith('rf:') || data.startsWith('rg:') || data.startsWith('rc:')) {
        const [action, evId, val] = data.split(':');
        const ev = await getEvent(evId);
        const title = ev ? ev.title : 'событие';
        await tg('answerCallbackQuery', { callback_query_id: cq.id });

        if (action === 'rt') {
          if (val === 'car') {
            await updateReg(evId, tgId, { has_transport: true, transport_details: 'Свой автомобиль' });
            await tg('editMessageText', {
              chat_id: chatId, message_id: msgId, parse_mode: 'HTML',
              text: '🚗 Сколько свободных мест можешь взять?',
              reply_markup: kb([[1, 2, 3, 4].map((n) => ({ text: String(n), callback_data: `rs:${evId}:${n}` }))]),
            });
          } else if (val === 'carfull') {
            // Авто есть, но без свободных мест (везёт вещи/заезжает по пути).
            await updateReg(evId, tgId, { has_transport: true, transport_seats: 0, transport_details: 'Авто без свободных мест' });
            if (foodNeeded(ev)) await askFood(evId); else await finalConfirm(ev);
          } else {
            await updateReg(evId, tgId, { has_transport: false, transport_details: val === 'seek' ? 'Ищет попутку' : null });
            if (foodNeeded(ev)) await askFood(evId); else await finalConfirm(ev);
          }
          return res.status(200).json({ ok: true });
        }
        if (action === 'rs') {
          await updateReg(evId, tgId, { has_transport: true, transport_seats: Number(val) });
          if (foodNeeded(ev)) await askFood(evId); else await finalConfirm(ev);
          return res.status(200).json({ ok: true });
        }
        if (action === 'rf') {
          if (val === 'own') {
            await updateReg(evId, tgId, { food_optout: true, dietary: null });
          } else {
            const diet = val === 'veg' ? 'vegetarian' : val === 'vegan' ? 'vegan' : 'all';
            await supabase.from('members').update({ dietary: diet }).eq('telegram_id', tgId);
            await updateReg(evId, tgId, { dietary: diet, food_optout: false });
          }
          await askGuest(evId);
          return res.status(200).json({ ok: true });
        }
        if (action === 'rg') {
          const guests = Number(val) || 0;
          await updateReg(evId, tgId, { guest_count: guests });
          // Семейные (mixed) — спросим про детей, чтобы учесть их в еде.
          if (ev?.type === 'mixed') {
            await tg('editMessageText', {
              chat_id: chatId, message_id: msgId, parse_mode: 'HTML',
              text: '👶 Дети с тобой? (учтём в еде — детская порция)',
              reply_markup: kb([[
                { text: 'Без детей', callback_data: `rc:${evId}:0` },
                { text: '1 ребёнок', callback_data: `rc:${evId}:1` },
                { text: '2+', callback_data: `rc:${evId}:2` },
              ]]),
            });
            return res.status(200).json({ ok: true });
          }
          await finishReg(ev, guests, 0);
          return res.status(200).json({ ok: true });
        }
        if (action === 'rc') {
          const children = Number(val) || 0;
          await updateReg(evId, tgId, { children_count: children });
          const { data: rr } = await supabase.from('registrations').select('guest_count').eq('event_id', evId).eq('telegram_id', tgId).maybeSingle();
          await finishReg(ev, (rr as any)?.guest_count || 0, children);
          return res.status(200).json({ ok: true });
        }
      }

      // === Выбор дат участия (многодневные) ===
      if (data.startsWith('dt_')) {
        const rest = data.slice(3);
        const idx = rest.lastIndexOf('_');
        const evId = rest.slice(0, idx);
        const i = Number(rest.slice(idx + 1));
        const ev = await getEvent(evId);
        const days = eventDays(ev);
        const day = days[i];
        if (!day) { await tg('answerCallbackQuery', { callback_query_id: cq.id }); return res.status(200).json({ ok: true }); }
        const { data: reg } = await supabase.from('registrations').select('days').eq('event_id', evId).eq('telegram_id', tgId).maybeSingle();
        let sel: string[] = ((reg as any)?.days) || [];
        sel = sel.includes(day.date) ? sel.filter((x) => x !== day.date) : [...sel, day.date];
        await updateReg(evId, tgId, { days: sel });
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        await tg('editMessageReplyMarkup', { chat_id: chatId, message_id: msgId, reply_markup: daysKb(evId, days, sel) });
        return res.status(200).json({ ok: true });
      }
      if (data.startsWith('dtdone_')) {
        const evId = data.slice('dtdone_'.length);
        const ev = await getEvent(evId);
        const { data: reg } = await supabase.from('registrations').select('days').eq('event_id', evId).eq('telegram_id', tgId).maybeSingle();
        const sel: string[] = ((reg as any)?.days) || [];
        if (sel.length === 0) { await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Выбери хотя бы один день' }); return res.status(200).json({ ok: true }); }
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        const labels = eventDays(ev).filter((d) => sel.includes(d.date)).map((d) => d.label).join(', ');
        await tg('editMessageText', { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', text: `📅 Дни участия: <b>${esc(labels)}</b>` });
        await askTransport(ev);
        return res.status(200).json({ ok: true });
      }

      // === Организация: снаряжение / роли (мультивыбор) ===
      if (data.startsWith('org_')) {
        const evId = data.slice('org_'.length);
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        await tg('sendMessage', {
          chat_id: chatId, parse_mode: 'HTML',
          text: '📋 <b>Организация</b>\nОтметь, что берёшь и чем можешь помочь — так всем проще подготовиться.',
          reply_markup: kb([
            [{ text: '🎒 Снаряжение', callback_data: `equip_${evId}` }],
            [{ text: '🙌 Чем буду полезен', callback_data: `role_${evId}` }],
          ]),
        });
        return res.status(200).json({ ok: true });
      }
      if (data.startsWith('equip_')) {
        const evId = data.slice('equip_'.length);
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        const { data: reg } = await supabase.from('registrations').select('equipment').eq('event_id', evId).eq('telegram_id', tgId).maybeSingle();
        await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: '🎒 Что берёшь с собой? Жми, чтобы отметить:', reply_markup: checklistKb('eqt', evId, EQUIP, ((reg as any)?.equipment) || []) });
        return res.status(200).json({ ok: true });
      }
      if (data.startsWith('role_')) {
        const evId = data.slice('role_'.length);
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        const { data: reg } = await supabase.from('registrations').select('roles').eq('event_id', evId).eq('telegram_id', tgId).maybeSingle();
        await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: '🙌 Чем можешь быть полезен? Жми, чтобы отметить:', reply_markup: checklistKb('rlt', evId, ROLES, ((reg as any)?.roles) || []) });
        return res.status(200).json({ ok: true });
      }
      // Тоггл пункта чек-листа (снаряжение eqt / роли rlt).
      if (data.startsWith('eqt_') || data.startsWith('rlt_')) {
        const isEquip = data.startsWith('eqt_');
        const rest = data.slice(4);
        const idx = rest.lastIndexOf('_');
        const evId = rest.slice(0, idx);
        const i = Number(rest.slice(idx + 1));
        const list = isEquip ? EQUIP : ROLES;
        const item = list[i];
        const col = isEquip ? 'equipment' : 'roles';
        const { data: reg } = await supabase.from('registrations').select(col).eq('event_id', evId).eq('telegram_id', tgId).maybeSingle();
        let sel: string[] = ((reg as any)?.[col]) || [];
        sel = sel.includes(item) ? sel.filter((x) => x !== item) : [...sel, item];
        await updateReg(evId, tgId, { [col]: sel });
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        await tg('editMessageReplyMarkup', { chat_id: chatId, message_id: msgId, reply_markup: checklistKb(isEquip ? 'eqt' : 'rlt', evId, list, sel) });
        return res.status(200).json({ ok: true });
      }

      // Карточка события из списка /start.
      if (data.startsWith('ev_')) {
        const ev = await getEvent(data.slice(3));
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        if (!ev) return res.status(200).json({ ok: true });
        await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: eventCard(ev), reply_markup: kb(eventCardButtons(ev, openBtn)) });
        return res.status(200).json({ ok: true });
      }

      // Программа события.
      if (data.startsWith('prog_')) {
        const ev = await getEvent(data.slice('prog_'.length));
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        const items: string[] = (ev?.program || []) as string[];
        if (!items.length) {
          await tg('sendMessage', { chat_id: chatId, text: 'Программа ещё готовится — пришлю, как появится.' });
          return res.status(200).json({ ok: true });
        }
        await tg('sendMessage', {
          chat_id: chatId, parse_mode: 'HTML',
          text: `📋 <b>Программа: ${esc(ev.title)}</b>\n\n` + items.map((p) => `• ${esc(p)}`).join('\n'),
        });
        return res.status(200).json({ ok: true });
      }

      // Вопрос организатору и идея по улучшению — свободный текст через сессию.
      if (data.startsWith('ask_') || data.startsWith('idea_')) {
        const isAsk = data.startsWith('ask_');
        const evId = data.slice(isAsk ? 4 : 5);
        await setSession(tgId, isAsk ? 'ask_text' : 'idea_text', { evId });
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        await tg('sendMessage', {
          chat_id: chatId, parse_mode: 'HTML',
          text: isAsk
            ? '❓ Напиши свой вопрос по событию — передам организатору, ответ придёт сюда.'
            : '💡 Что можно улучшить в этом событии? Напиши — организатор увидит.',
        });
        return res.status(200).json({ ok: true });
      }

      // «Позвать друга»: готовое сообщение с реф-ссылкой, кнопка «Поделиться».
      if (data.startsWith('share_')) {
        const ev = await getEvent(data.slice('share_'.length));
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        if (!ev) return res.status(200).json({ ok: true });
        const code = await ensureRefCode(tgId);
        // Ссылка на страницу-приглашение сайта: у неё og-разметка, поэтому
        // в Telegram и Viber друг увидит большую картинку события и описание.
        // Прямая t.me-ссылка превью не даёт.
        const link = `${site}/e/${ev.id}${code ? `?ref=${code}` : ''}`;
        const invite = `${ev.title} — ${dayPhrase(ev.date)} (${whenPhrase(ev.date)}). Идём вместе?`;
        const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(invite)}`;

        // Картинку прикладываем и в сам чат — чтобы приглашение можно было переслать.
        const photo = ev.image && !String(ev.image).startsWith('data:')
          ? String(ev.image)
          : `${site}/api/events?action=image&id=${encodeURIComponent(ev.id)}`;
        const caption =
          `📤 <b>Позови друга</b>\n\n${esc(invite)}\n\n` +
          `Твоя ссылка:\n<code>${esc(link)}</code>\n\n` +
          `<i>Нажми на ссылку — скопируется. Друг откроет её, увидит событие и попадёт в клуб по твоему приглашению.</i>`;
        const markup = kb([[{ text: '📤 Отправить другу', url: shareUrl }]]);

        const sentPhoto = ev.image
          ? await tg('sendPhoto', { chat_id: chatId, photo, parse_mode: 'HTML', caption, reply_markup: markup })
          : null;
        // Нет картинки или Telegram её не забрал — уходим на обычный текст.
        if (!sentPhoto || (sentPhoto as any).ok !== true) {
          await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: caption, reply_markup: markup });
        }
        return res.status(200).json({ ok: true });
      }

      // === Отзыв после события (приходит из крона: fb_ → звёзды → «придёшь снова» → коммент) ===
      if (data.startsWith('fb_')) {
        const evId = data.slice(3);
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        await tg('editMessageText', {
          chat_id: chatId, message_id: msgId, parse_mode: 'HTML',
          text: '⭐ Как оценишь событие?',
          reply_markup: kb([[1, 2, 3, 4, 5].map((n) => ({ text: '⭐'.repeat(n) || String(n), callback_data: `fbr_${evId}_${n}` }))]),
        });
        return res.status(200).json({ ok: true });
      }
      if (data.startsWith('fbr_')) {
        const rest = data.slice(4);
        const i = rest.lastIndexOf('_');
        const evId = rest.slice(0, i);
        const rating = Number(rest.slice(i + 1)) || 5;
        await supabase.from('feedback').upsert({ event_id: evId, telegram_id: tgId, rating }, { onConflict: 'event_id,telegram_id' });
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Записал' });
        await tg('editMessageText', {
          chat_id: chatId, message_id: msgId, parse_mode: 'HTML',
          text: `Оценка: ${'⭐'.repeat(rating)}\n\nПридёшь снова?`,
          reply_markup: kb([[
            { text: '👍 Да', callback_data: `fbw_${evId}_1` },
            { text: '👎 Нет', callback_data: `fbw_${evId}_0` },
          ]]),
        });
        return res.status(200).json({ ok: true });
      }
      if (data.startsWith('fbw_')) {
        const rest = data.slice(4);
        const i = rest.lastIndexOf('_');
        const evId = rest.slice(0, i);
        const again = rest.slice(i + 1) === '1';
        await supabase.from('feedback').update({ would_return: again }).eq('event_id', evId).eq('telegram_id', tgId);
        await setSession(tgId, 'fb_comment', { evId });
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        await tg('editMessageText', {
          chat_id: chatId, message_id: msgId, parse_mode: 'HTML',
          text: '✍️ Напиши пару слов — что зашло, что улучшить. Или пропусти.',
          reply_markup: kb([[{ text: 'Пропустить', callback_data: `fbskip_${evId}` }]]),
        });
        return res.status(200).json({ ok: true });
      }
      if (data.startsWith('fbskip_')) {
        await clearSession(tgId);
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Спасибо!' });
        await tg('editMessageText', { chat_id: chatId, message_id: msgId, text: '🙏 Спасибо за оценку!' });
        return res.status(200).json({ ok: true });
      }

      // === Логистика (участник-driven): меню ===
      if (data.startsWith('logi_')) {
        const evId = data.slice('logi_'.length);
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        await tg('sendMessage', {
          chat_id: chatId, parse_mode: 'HTML',
          text: '🚗 <b>Логистика и брони</b>\n\nЗдесь всё по инициативе участников: кто едет — сам предлагает места, кому нужно — ищет попутку.',
          reply_markup: kb([
            [{ text: '🚗 Еду на машине — предложить места', callback_data: `ridenew_${evId}` }],
            [{ text: '👀 Кто едет / занять место', callback_data: `rides_${evId}` }],
            [{ text: '🚶 Нужна попутка', callback_data: `rideseek_${evId}` }],
          ]),
        });
        return res.status(200).json({ ok: true });
      }

      // Водитель заявляет поездку — пошаговый ввод через сессию.
      if (data.startsWith('ridenew_')) {
        const evId = data.slice('ridenew_'.length);
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        await setSession(tgId, 'ride_point', { evId });
        await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: '📍 Откуда выезжаешь? Напиши точку сбора (напр. «м. Каменная Горка, стоянка»).' });
        return res.status(200).json({ ok: true });
      }
      // Кол-во мест (из сессии).
      if (data.startsWith('rseats_')) {
        const n = Number(data.split('_')[1]) || 0;
        const s = await getSession(tgId);
        if (!s || s.state !== 'ride_seats') { await tg('answerCallbackQuery', { callback_query_id: cq.id }); return res.status(200).json({ ok: true }); }
        await setSession(tgId, 'ride_fuel', { ...s.context, seats: n });
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        await tg('editMessageText', {
          chat_id: chatId, message_id: msgId, parse_mode: 'HTML',
          text: '⛽ Взнос на бензин с человека?',
          reply_markup: kb([[
            { text: 'Бесплатно', callback_data: 'rfuel_0' },
            { text: '5 ₽', callback_data: 'rfuel_5' },
            { text: '10 ₽', callback_data: 'rfuel_10' },
          ]]),
        });
        return res.status(200).json({ ok: true });
      }
      // Бензин → создать поездку.
      if (data.startsWith('rfuel_')) {
        const fuel = Number(data.split('_')[1]) || 0;
        const s = await getSession(tgId);
        if (!s || s.state !== 'ride_fuel') { await tg('answerCallbackQuery', { callback_query_id: cq.id }); return res.status(200).json({ ok: true }); }
        const { evId, from, depart, seats } = s.context;
        await supabase.from('rides').insert({
          event_id: evId, driver_id: tgId, driver_name: cq.from.first_name || cq.from.username || 'Водитель',
          from_point: from, depart_text: depart, seats_total: seats, fuel_cost: fuel,
        });
        await clearSession(tgId);
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Поездка добавлена!' });
        await tg('editMessageText', {
          chat_id: chatId, message_id: msgId, parse_mode: 'HTML',
          text: `✅ Готово! Твоя поездка добавлена:\n📍 ${esc(from)}  🕐 ${esc(depart)}\nМест: ${seats}  ⛽ ${fuel ? fuel + ' ₽/чел' : 'бесплатно'}\n\nУчастники увидят её в «Кто едет» и смогут занять место.`,
          reply_markup: kb([[openBtn]]),
        });
        // Уведомить тех, кто искал попутку.
        const { data: reqs } = await supabase.from('ride_requests').select('passenger_id').eq('event_id', evId).eq('active', true);
        for (const r of (reqs || [])) {
          try { await tg('sendMessage', { chat_id: (r as any).passenger_id, parse_mode: 'HTML', text: `🚗 Появилась машина на событие! ${esc(cq.from.first_name || 'Водитель')} едет из «${esc(from)}» (${esc(depart)}). Открой «Кто едет», чтобы занять место.`, reply_markup: kb([[{ text: '👀 Кто едет', callback_data: `rides_${evId}` }]]) }); } catch { /* no-op */ }
        }
        return res.status(200).json({ ok: true });
      }

      // Список машин + бронь места.
      if (data.startsWith('rides_')) {
        const evId = data.slice('rides_'.length);
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        const { data: rides } = await supabase.from('rides').select('*').eq('event_id', evId).eq('active', true).order('created_at');
        if (!rides || rides.length === 0) {
          await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: 'Пока никто не заявил машину. Будь первым — «🚗 Еду на машине», или оставь заявку «🚶 Нужна попутка».', reply_markup: kb([[{ text: '🚗 Еду на машине', callback_data: `ridenew_${evId}` }], [{ text: '🚶 Нужна попутка', callback_data: `rideseek_${evId}` }]]) });
          return res.status(200).json({ ok: true });
        }
        // Где я уже сижу — чтобы предложить «освободить», а не «занять».
        const { data: myBookings } = await supabase
          .from('ride_bookings').select('ride_id')
          .in('ride_id', rides.map((r: any) => r.id))
          .eq('passenger_id', tgId);
        const booked = new Set((myBookings || []).map((b: any) => b.ride_id));
        const evForRides = await getEvent(evId);
        for (const r of rides) {
          const taken = (r as any).seats_taken || 0;
          const free = Math.max(0, ((r as any).seats_total || 0) - taken);
          const mine = (r as any).driver_id === tgId;
          const rows: any[] = [];
          if (mine) rows.push([{ text: '❌ Отменить мою поездку', callback_data: `ridecancel_${(r as any).id}` }]);
          else if (booked.has((r as any).id)) rows.push([{ text: '❌ Освободить моё место', callback_data: `rideunbook_${(r as any).id}` }]);
          else if (free > 0) rows.push([{ text: `✅ Занять место (${free} своб.)`, callback_data: `ridebook_${(r as any).id}` }]);
          // Маршрут до точки выезда водителя, а не до самого события.
          const route = pointRouteUrl((r as any).from_point);
          if (route) rows.push([{ text: '🧭 Маршрут до точки выезда', url: route }]);
          await tg('sendMessage', {
            chat_id: chatId, parse_mode: 'HTML',
            text: rideLine(r, evForRides?.title),
            reply_markup: rows.length ? kb(rows) : undefined,
          });
        }
        return res.status(200).json({ ok: true });
      }

      // Бронь места в машине.
      if (data.startsWith('ridebook_')) {
        const rideId = Number(data.slice('ridebook_'.length));
        const { data: ride } = await supabase.from('rides').select('*').eq('id', rideId).maybeSingle();
        if (!ride || !(ride as any).active) { await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Поездка недоступна' }); return res.status(200).json({ ok: true }); }
        // Захват места атомарный (RPC), иначе двое одновременно сядут на одно место.
        const passengerName = cq.from.first_name || cq.from.username || 'Пассажир';
        const { data: outcome, error: rpcErr } = await supabase.rpc('book_ride_seat', {
          p_ride_id: rideId, p_passenger: tgId, p_name: passengerName,
        });
        if (rpcErr || outcome !== 'ok') {
          const why = outcome === 'dup' ? 'Ты уже в этой машине'
            : outcome === 'full' ? 'Мест уже нет'
            : outcome === 'gone' ? 'Поездка отменена'
            : 'Не получилось забронировать';
          await tg('answerCallbackQuery', { callback_query_id: cq.id, text: why });
          return res.status(200).json({ ok: true });
        }
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Место забронировано ✅' });

        // Контакты в обе стороны: Telegram у человека может быть закрыт настройками,
        // и тогда без телефона попутчики друг друга не найдут.
        const { data: driverInfo } = await supabase.from('members').select('phone,username,first_name').eq('telegram_id', (ride as any).driver_id).maybeSingle();
        const { data: paxInfo } = await supabase.from('members').select('phone').eq('telegram_id', tgId).maybeSingle();
        const route = pointRouteUrl((ride as any).from_point);
        const rows: any[] = [[{ text: '❌ Освободить место', callback_data: `rideunbook_${rideId}` }]];
        if (route) rows.unshift([{ text: '🧭 Маршрут до точки выезда', url: route }]);

        await tg('editMessageText', {
          chat_id: chatId, message_id: msgId, parse_mode: 'HTML',
          text:
            `✅ <b>Место твоё</b>\n\n` +
            `🚗 Водитель: ${esc((ride as any).driver_name || '')}` +
            ((driverInfo as any)?.username ? ` @${esc((driverInfo as any).username)}` : '') + '\n' +
            ((driverInfo as any)?.phone ? `📞 <code>${esc((driverInfo as any).phone)}</code>\n` : '') +
            `📍 Выезд: ${esc((ride as any).from_point)}\n🕐 Когда: ${esc((ride as any).depart_text)}`,
          reply_markup: kb(rows),
        });
        try {
          await tg('sendMessage', {
            chat_id: (ride as any).driver_id, parse_mode: 'HTML',
            text: `🧍 <b>К тебе в машину сел ${esc(cq.from.first_name || '')}</b>` +
              (cq.from.username ? ` @${esc(cq.from.username)}` : '') + '\n' +
              ((paxInfo as any)?.phone ? `📞 <code>${esc((paxInfo as any).phone)}</code>\n` : '') +
              `\nСобытие: ${esc((await getEvent((ride as any).event_id))?.title || '')}`,
          });
        } catch { /* no-op */ }
        return res.status(200).json({ ok: true });
      }

      // Пассажир освобождает своё место — водитель узнаёт.
      if (data.startsWith('rideunbook_')) {
        const rideId = Number(data.slice('rideunbook_'.length));
        const { data: outcome } = await supabase.rpc('cancel_ride_seat', { p_ride_id: rideId, p_passenger: tgId });
        if (outcome !== 'ok') { await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Ты не занимал здесь место' }); return res.status(200).json({ ok: true }); }
        const { data: ride } = await supabase.from('rides').select('driver_id').eq('id', rideId).maybeSingle();
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Место освобождено' });
        await tg('editMessageText', { chat_id: chatId, message_id: msgId, text: '❌ Ты освободил место. Оно снова доступно другим.' });
        if (ride) {
          try { await tg('sendMessage', { chat_id: (ride as any).driver_id, parse_mode: 'HTML', text: `🚗 ${esc(cq.from.first_name || 'Пассажир')} освободил место в твоей машине.` }); } catch { /* no-op */ }
        }
        return res.status(200).json({ ok: true });
      }

      // Отмена своей поездки — уведомить пассажиров.
      if (data.startsWith('ridecancel_')) {
        const rideId = Number(data.slice('ridecancel_'.length));
        const { data: ride } = await supabase.from('rides').select('*').eq('id', rideId).maybeSingle();
        if (!ride || (ride as any).driver_id !== tgId) { await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Это не твоя поездка' }); return res.status(200).json({ ok: true }); }
        await supabase.from('rides').update({ active: false }).eq('id', rideId);
        const { data: pax } = await supabase.from('ride_bookings').select('passenger_id').eq('ride_id', rideId);
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Поездка отменена' });
        await tg('editMessageText', { chat_id: chatId, message_id: msgId, text: '❌ Твоя поездка отменена. Пассажиры уведомлены.' });
        for (const p of (pax || [])) {
          try { await tg('sendMessage', { chat_id: (p as any).passenger_id, text: '⚠️ Водитель отменил поездку, на которую ты записался. Поищи другую машину в «Кто едет».' }); } catch { /* no-op */ }
        }
        return res.status(200).json({ ok: true });
      }

      // «Нужна попутка» — заявка + уведомление водителей.
      if (data.startsWith('rideseek_')) {
        const evId = data.slice('rideseek_'.length);
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        await supabase.from('ride_requests').upsert(
          { event_id: evId, passenger_id: tgId, passenger_name: cq.from.first_name || cq.from.username || 'Пассажир', active: true },
          { onConflict: 'event_id,passenger_id' }
        );
        await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: '🚶 Заявка «нужна попутка» принята. Как только кто-то заявит машину — пришлю сюда. Можешь и сам заглянуть в «Кто едет».', reply_markup: kb([[{ text: '👀 Кто едет', callback_data: `rides_${evId}` }]]) });
        const { data: drivers } = await supabase.from('rides').select('driver_id').eq('event_id', evId).eq('active', true);
        const uniq = [...new Set((drivers || []).map((d: any) => d.driver_id))];
        for (const did of uniq) {
          try { await tg('sendMessage', { chat_id: did, parse_mode: 'HTML', text: `🚶 ${esc(cq.from.first_name || 'Участник')} ищет попутку на событие. Если есть место — напиши ему или добавь мест.` }); } catch { /* no-op */ }
        }
        return res.status(200).json({ ok: true });
      }

      await tg('answerCallbackQuery', { callback_query_id: cq.id });
      return res.status(200).json({ ok: true });
    }

    const msg = update.message || update.edited_message;

    // Телефон, присланный кнопкой «Отправить мой номер» — это не текст.
    if (msg?.contact && msg.from?.id) {
      const sess = await getSession(msg.from.id);
      if (sess?.state === 'apply_phone') {
        await askApplySource(msg.from.id, msg.chat.id, { ...sess.context, phone: msg.contact.phone_number });
        return res.status(200).json({ ok: true });
      }
      // Контакт вне сценария — просто сохраняем телефон.
      await supabase.from('members').update({ phone: msg.contact.phone_number }).eq('telegram_id', msg.from.id);
      await tg('sendMessage', { chat_id: msg.chat.id, text: '✅ Телефон сохранён.', reply_markup: mainMenu() });
      return res.status(200).json({ ok: true });
    }
    if (msg && typeof msg.text === 'string') {
      const chatId = msg.chat.id;
      const text = msg.text.trim();

      // Пошаговый ввод (заявка поездки) — если активна сессия и это не команда.
      if (!text.startsWith('/')) {
        const sess = await getSession(msg.from.id);
        if (sess && sess.state === 'ride_point') {
          await setSession(msg.from.id, 'ride_depart', { ...sess.context, from: text.slice(0, 120) });
          await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: '🕐 Когда выезжаешь? Напиши дату и время (напр. «5 июля, 17:00»).' });
          return res.status(200).json({ ok: true });
        }
        if (sess && sess.state === 'ride_depart') {
          await setSession(msg.from.id, 'ride_seats', { ...sess.context, depart: text.slice(0, 80) });
          await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: '💺 Сколько свободных мест можешь взять?', reply_markup: kb([[1, 2, 3, 4].map((n) => ({ text: String(n), callback_data: `rseats_${n}` }))]) });
          return res.status(200).json({ ok: true });
        }
        if (sess && sess.state === 'fb_comment') {
          await supabase.from('feedback').update({ comment: text.slice(0, 2000) })
            .eq('event_id', sess.context.evId).eq('telegram_id', msg.from.id);
          await clearSession(msg.from.id);
          await tg('sendMessage', { chat_id: chatId, text: '🙏 Спасибо! Отзыв записан — организаторы его увидят.' });
          return res.status(200).json({ ok: true });
        }
        // ── Заявка в клуб: имя → телефон → откуда пришёл ──────────────────
        if (sess && sess.state === 'apply_name') {
          const name = text.slice(0, 80);
          await setSession(msg.from.id, 'apply_phone', { ...sess.context, name });
          await tg('sendMessage', {
            chat_id: chatId, parse_mode: 'HTML',
            text: `Приятно, <b>${esc(name)}</b>!\n\n📞 <b>Шаг 3 из 3 — контакт</b>\n\nОставь телефон: Telegram может быть закрыт настройками, и до тебя не дозвонятся по логистике.`,
            reply_markup: {
              keyboard: [[{ text: '📞 Отправить мой номер', request_contact: true }]],
              resize_keyboard: true, one_time_keyboard: true,
            },
          });
          return res.status(200).json({ ok: true });
        }
        if (sess && sess.state === 'apply_phone') {
          // Разрешаем и ручной ввод, если человек не хочет делиться контактом кнопкой.
          const phone = text.replace(/[^\d+]/g, '').slice(0, 20);
          if (phone.length < 7) {
            await tg('sendMessage', { chat_id: chatId, text: 'Не похоже на телефон. Напиши в формате +375XXXXXXXXX или нажми кнопку ниже.' });
            return res.status(200).json({ ok: true });
          }
          await askApplySource(msg.from.id, chatId, { ...sess.context, phone });
          return res.status(200).json({ ok: true });
        }
        if (sess && sess.state === 'apply_source') {
          await finishApplication(msg.from, chatId, { ...sess.context, source: text.slice(0, 200) });
          return res.status(200).json({ ok: true });
        }

        // ── Закрытое событие: ввод кода доступа → регистрация ─────────────
        if (sess && sess.state === 'reg_code') {
          const ev = await getEvent(sess.context.evId);
          if (!ev) {
            await clearSession(msg.from.id);
            await tg('sendMessage', { chat_id: chatId, text: 'Событие не найдено.' });
            return res.status(200).json({ ok: true });
          }
          const provided = text.trim().toLowerCase();
          const expected = String(ev.access_code || '').trim().toLowerCase();
          if (!expected || provided !== expected) {
            // Остаёмся в состоянии reg_code — можно попробовать снова.
            await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: '❌ Неверный код доступа. Проверь приглашение и введи код ещё раз.' });
            return res.status(200).json({ ok: true });
          }
          await clearSession(msg.from.id);
          const r = await registerFromBot(msg.from, ev);
          if (r === 'error') {
            await tg('sendMessage', { chat_id: chatId, text: 'Ошибка записи, попробуйте позже.' });
            return res.status(200).json({ ok: true });
          }
          if (r === 'already') {
            await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `Ты уже записан(а) на «<b>${esc(ev.title)}</b>».` });
            return res.status(200).json({ ok: true });
          }
          await tg('sendMessage', {
            chat_id: chatId, parse_mode: 'HTML',
            text: `✅ Код верный! Записал тебя на «<b>${esc(ev.title)}</b>».\n\nДетали и напоминания придут в бот.`,
          });
          return res.status(200).json({ ok: true });
        }

        // Обращение в поддержку.
        // Ответ костяка пользователю (после кнопки «✍️ Ответить»).
        if (sess && sess.state === 'admin_reply') {
          await clearSession(msg.from.id);
          const targetId = sess.context.targetId;
          try {
            await tg('sendMessage', {
              chat_id: targetId, parse_mode: 'HTML',
              text: `💬 <b>Ответ организатора:</b>\n\n${esc(text.slice(0, 2000))}`,
            });
            await tg('sendMessage', { chat_id: chatId, text: '✅ Ответ отправлен.' });
          } catch {
            await tg('sendMessage', { chat_id: chatId, text: '⚠️ Не удалось доставить — пользователь мог остановить бота.' });
          }
          return res.status(200).json({ ok: true });
        }

        if (sess && sess.state === 'support_text') {
          await clearSession(msg.from.id);
          if (ADMIN_CHAT_ID) {
            await tg('sendMessage', {
              chat_id: ADMIN_CHAT_ID, parse_mode: 'HTML',
              text: `💬 <b>Поддержка</b>\nОт: ${esc(msg.from.first_name || '')} ${msg.from.username ? '@' + esc(msg.from.username) : ''} (id ${msg.from.id})\n\n<i>${esc(text.slice(0, 1500))}</i>`,
              reply_markup: kb([[{ text: '✍️ Ответить', callback_data: `reply_${msg.from.id}` }]]),
            });
          }
          await tg('sendMessage', { chat_id: chatId, text: '✅ Отправил организаторам. Ответят сюда.' });
          return res.status(200).json({ ok: true });
        }

        // Вопрос организатору / идея по улучшению.
        if (sess && (sess.state === 'ask_text' || sess.state === 'idea_text')) {
          const isAsk = sess.state === 'ask_text';
          const ev = await getEvent(sess.context.evId);
          await clearSession(msg.from.id);
          const who = `${esc(msg.from.first_name || '')} ${msg.from.username ? '@' + esc(msg.from.username) : `(id ${msg.from.id})`}`;
          if (ADMIN_CHAT_ID) {
            await tg('sendMessage', {
              chat_id: ADMIN_CHAT_ID, parse_mode: 'HTML',
              text: `${isAsk ? '❓ <b>Вопрос по событию</b>' : '💡 <b>Идея по событию</b>'}\n` +
                `${esc(ev?.title || sess.context.evId)}\nОт: ${who}\n\n<i>${esc(text.slice(0, 1000))}</i>`,
              reply_markup: kb([[{ text: '✍️ Ответить', callback_data: `reply_${msg.from.id}` }]]),
            });
          }
          await tg('sendMessage', {
            chat_id: chatId,
            text: isAsk
              ? '✅ Вопрос отправлен организатору. Ответ придёт сюда.'
              : '✅ Спасибо! Идея передана организатору.',
          });
          return res.status(200).json({ ok: true });
        }

        // Постоянное меню внизу чата.
        if (text === '📅 Ближайшие события') {
          const { data: evs } = await supabase
            .from('events').select('id,title,date,status')
            .eq('status', 'open').order('date', { ascending: true }).limit(6);
          if (!evs || !evs.length) {
            await tg('sendMessage', { chat_id: chatId, text: 'Пока нет открытых событий. Загляни позже.' });
            return res.status(200).json({ ok: true });
          }
          const rows = evs.map((e: any) => [{ text: `${e.title} · ${whenPhrase(e.date)}`, callback_data: `ev_${e.id}` }]);
          rows.push([openBtn as any]);
          await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: '📅 <b>Ближайшие события</b>', reply_markup: kb(rows) });
          return res.status(200).json({ ok: true });
        }
        if (text === 'ℹ️ Помощь') {
          await tg('sendMessage', {
            chat_id: chatId, parse_mode: 'HTML',
            text:
              'ℹ️ <b>Как это работает</b>\n\n' +
              '1. Выбираешь событие → «Записаться».\n' +
              '2. Отвечаешь на пару вопросов — они нужны для закупки и логистики.\n' +
              '3. Дальше всё придёт сюда: точный адрес, программа, напоминания за 7/3/1 день.\n' +
              '4. Нужна машина или место в ней — «🚗 Логистика и брони».\n' +
              '5. После события бот попросит оценку — она влияет на следующие.\n\n' +
              'Вопрос по событию — кнопка «❓ Спросить» в его карточке.\n' +
              '/profile — баллы и твоя реф-ссылка.',
            reply_markup: kb([[{ text: '💬 Написать в поддержку', callback_data: 'support' }]]),
          });
          return res.status(200).json({ ok: true });
        }
        if (text === '👤 Мой статус') {
          await handleProfileCommand(msg, chatId, openBtn);
          return res.status(200).json({ ok: true });
        }
        if (text === '🚗 Логистика и брони') {
          const { data: myRegs } = await supabase
            .from('registrations').select('event_id').eq('telegram_id', msg.from.id).neq('status', 'cancelled');
          const ids = (myRegs || []).map((r: any) => r.event_id);
          if (!ids.length) {
            await tg('sendMessage', { chat_id: chatId, text: 'Сначала запишись на событие — потом появятся машины и брони.' });
            return res.status(200).json({ ok: true });
          }
          const { data: evs } = await supabase.from('events').select('id,title,date').in('id', ids).order('date');
          const rows = (evs || []).map((e: any) => [{ text: `🚗 ${e.title}`, callback_data: `logi_${e.id}` }]);
          await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: '🚗 Выбери событие:', reply_markup: kb(rows) });
          return res.status(200).json({ ok: true });
        }
      }

      if (text.startsWith('/start')) {
        // /start всегда обрывает недоделанный диалог. Иначе человек, начавший
        // заявку поездки и ушедший, потом получает «Когда выезжаешь?» на ровном месте.
        await clearSession(msg.from.id);

        let payload = text.split(' ')[1] || '';
        // Ссылка «позови друга» несёт и код, и событие: ref_<code>_ev_<eventId>.
        let invitedIn = false;
        let invitedBy = false;   // ссылка была, но пригласивший сам не в клубе
        if (payload.startsWith('ref_')) {
          const rest = payload.slice('ref_'.length);
          const sep = rest.indexOf('_ev_');
          const code = sep === -1 ? rest : rest.slice(0, sep);
          invitedBy = true;
          try { invitedIn = await bindReferrer(msg.from, code); } catch { /* реф — best-effort */ }
          payload = sep === -1 ? '' : `event_${rest.slice(sep + '_ev_'.length)}`;
          if (invitedIn) {
            await tg('sendMessage', {
              chat_id: chatId, parse_mode: 'HTML',
              text: '🎉 <b>Добро пожаловать в клуб!</b>\n\nТы пришёл по приглашению участника — двери открыты. Смотри события ниже.',
            });
          }
        }

        // Закрытый клуб. Каждый экран должен говорить, что делать дальше —
        // иначе человек упирается в «Доступ закрыт» и не понимает, куда жать.
        if (gateOn() && !(await isApproved(msg.from.id))) {
          await supabase.from('members').upsert(
            { telegram_id: msg.from.id, username: msg.from.username || null, first_name: msg.from.first_name || null },
            { onConflict: 'telegram_id' }
          );
          const m = await memberOf(msg.from.id);

          if (m?.status === 'pending_review') {
            await tg('sendMessage', {
              chat_id: chatId, parse_mode: 'HTML',
              text: '⏳ <b>Заявка на рассмотрении</b>\n\nКостяк клуба смотрит её вручную — обычно в течение дня.\nКак только одобрят, пришлю сюда события и открою запись.\n\nПока можно ничего не делать.',
              reply_markup: kb([[{ text: '💬 Написать в поддержку', callback_data: 'support' }]]),
            });
          } else if (m?.status === 'blocked') {
            await tg('sendMessage', {
              chat_id: chatId, parse_mode: 'HTML',
              text: '🚪 <b>Доступ закрыт</b>\n\nТвоя заявка была отклонена. Если это ошибка — напиши нам, разберёмся.',
              reply_markup: kb([[{ text: '💬 Написать в поддержку', callback_data: 'support' }]]),
            });
          } else if (invitedBy) {
            // Пришёл по ссылке, но пригласивший сам ещё не в клубе.
            await tg('sendMessage', {
              chat_id: chatId, parse_mode: 'HTML',
              text: '🔒 <b>«Живи в моменте» — закрытый клуб</b>\n\nСсылка, по которой ты пришёл, пока не действует: пригласивший сам ещё не принят.\n\nМожешь подать заявку — костяк рассмотрит.',
              reply_markup: kb([[{ text: '✅ Подать заявку', callback_data: 'verify_start' }]]),
            });
          } else {
            await tg('sendMessage', {
              chat_id: chatId, parse_mode: 'HTML',
              text:
                '🔒 <b>«Живи в моменте» — закрытый клуб</b>\n\n' +
                'Сюда попадают по приглашению участника. Если тебе давали ссылку — открой её ещё раз, она впустит сразу.\n\n' +
                'Ссылки нет? Подай заявку — костяк познакомится и решит.\n\n' +
                '<b>Что будет дальше:</b>\n' +
                '1️⃣ Согласие на обработку данных\n' +
                '2️⃣ Как тебя зовут и телефон для связи\n' +
                '3️⃣ Откуда ты о нас узнал\n' +
                '4️⃣ Ответ костяка — придёт сюда',
              reply_markup: kb([[{ text: '✅ Подать заявку', callback_data: 'verify_start' }]]),
            });
          }
          return res.status(200).json({ ok: true });
        }

        if (payload.startsWith('event_')) {
          const ev = await getEvent(payload.slice('event_'.length));
          if (ev) {
            await tg('sendMessage', {
              chat_id: chatId,
              parse_mode: 'HTML',
              text: eventCard(ev),
              reply_markup: kb(eventCardButtons(ev, openBtn)),
            });
            await tg('sendMessage', { chat_id: chatId, text: 'Меню всегда снизу 👇', reply_markup: mainMenu() });
            return res.status(200).json({ ok: true });
          }
        }
        // Приветствие + открытые события кнопками (со сроком до старта).
        const { data: evs } = await supabase
          .from('events')
          .select('id,title,status,date')
          .eq('status', 'open')
          .order('date', { ascending: true })
          .limit(6);
        const rows = (evs || []).map((e: any) => [
          { text: `✅ ${e.title} · ${whenPhrase(e.date)}`, callback_data: `ev_${e.id}` },
        ]);
        rows.push([openBtn as any]);
        await tg('sendMessage', {
          chat_id: chatId,
          parse_mode: 'HTML',
          text:
            '👋 Добро пожаловать в <b>«Живи в моменте»</b>!\n\n' +
            'Живая афиша трезвого сообщества. Выбери событие — покажу детали, дату и как добраться 👇',
          reply_markup: { inline_keyboard: rows },
        });
        await tg('sendMessage', { chat_id: chatId, text: 'Меню всегда снизу 👇', reply_markup: mainMenu() });
        return res.status(200).json({ ok: true });
      }

      // Профиль: баллы, реф-ссылка, счётчик приглашённых.
      if (text.startsWith('/profile')) {
        await handleProfileCommand(msg, chatId, openBtn);
        return res.status(200).json({ ok: true });
      }

      await tg('sendMessage', {
        chat_id: chatId,
        text: 'Не понял. Пользуйся кнопками меню внизу 👇',
        reply_markup: mainMenu(),
      });
      return res.status(200).json({ ok: true });
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(200).json({ ok: true, error: (err as Error).message });
  }
}
