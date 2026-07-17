import { createClient } from '@supabase/supabase-js';
import { handleGroupMessage } from './group-handler';
import { parseEquipment, parseCoordinates, parseTime } from './ai-helpers';

/**
 * Вебхук Telegram-бота @campsflint_bot. Делает бота и сайт единым целым:
 *  - /start                → приветствие + кнопка Mini App + список открытых событий;
 *  - /start event_<id>      → карточка события с кнопкой «✅ Записаться»;
 *  - /events, /help          → те же экраны, что кнопки меню «События»/«Помощь»;
 *  - /profile                → баллы, реф-ссылка, приглашённые;
 *  - /diet, /preferences     → тип питания и предпочтения (сохраняются в members);
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

// ─── Голосования (polls/poll_votes) ──────────────────────────────────────
// Состояние храним в polls.options как объект { list, status, winner, topic,
// summary } — без миграции (колонка jsonb уже есть). poll_votes.choice = индекс.

/** Кто имеет право голосовать = зарегистрированные на событие с реальным TG id. */
async function pollEligible(evId: string): Promise<number[]> {
  const { data } = await supabase
    .from('registrations').select('telegram_id').eq('event_id', evId).neq('status', 'cancelled');
  return Array.from(new Set((data || [])
    .map((r: any) => Number(r.telegram_id)).filter((id: number) => Number.isFinite(id) && id > 0)));
}

/** Подсчёт голосов по вариантам + список проголосовавших. */
async function pollTally(pollId: number, optCount: number): Promise<{ counts: number[]; voters: number }> {
  const { data } = await supabase.from('poll_votes').select('choice,telegram_id').eq('poll_id', pollId);
  const counts = new Array(optCount).fill(0);
  const voters = new Set<number>();
  for (const v of data || []) {
    const c = Number((v as any).choice);
    if (c >= 0 && c < optCount) counts[c]++;
    voters.add(Number((v as any).telegram_id));
  }
  return { counts, voters: voters.size };
}

/** Клавиатура голосования: вариант + счётчик; кнопки закрытия для создателя. */
function pollKeyboard(pollId: number, list: string[], counts: number[], closed: boolean): any {
  const total = counts.reduce((s, c) => s + (c || 0), 0);
  const rows: any[] = list.map((opt, i) => [{
    // Вариант + голоса + доля: сразу видно расклад.
    text: `${closed ? '' : '🗳 '}${opt} · ${counts[i] || 0}${total ? ` (${Math.round((counts[i] || 0) / total * 100)}%)` : ''}`.slice(0, 62),
    callback_data: closed ? `pnoop_${pollId}` : `pv_${pollId}_${i}`,
  }]);
  if (!closed) {
    // Любой участник может предложить свой вариант — список пополнится, все переголосуют.
    rows.push([{ text: '➕ Добавить свой вариант', callback_data: `padd_${pollId}` }]);
    rows.push([{ text: '🔒 Закрыть и подвести итог', callback_data: `pclose_${pollId}` }]);
  }
  return { inline_keyboard: rows };
}

/** Разослать голосование всем, кто имеет право голоса. */
async function broadcastPoll(pollId: number, poll: any, evTitle: string) {
  const opts = poll.options || {};
  const list: string[] = opts.list || [];
  const eligible = await pollEligible(poll.event_id);
  const { counts } = await pollTally(pollId, list.length);
  const text =
    `🗳 <b>Голосование — «${esc(evTitle)}»</b>\n\n` +
    `<b>${esc(poll.question)}</b>\n` +
    (opts.summary ? `<i>${esc(opts.summary)}</i>\n` : '') +
    `\nГолосуют участники события (${eligible.length} чел). Решение — когда «за» наберёт больше половины.`;
  for (const id of eligible) {
    try { await tg('sendMessage', { chat_id: id, parse_mode: 'HTML', text, reply_markup: pollKeyboard(pollId, list, counts, false) }); } catch { /* заблокировал бота */ }
  }
}

/** «Заезжай за мной»: передаёт водителю точку пассажира с кнопками решения. */
async function sendPickupRequest(rideId: number, from: any, locText: string, lat?: number, lng?: number) {
  const { data: ride } = await supabase.from('rides').select('driver_id,driver_name,event_id').eq('id', rideId).maybeSingle();
  if (!ride) return false;
  const { data: paxInfo } = await supabase.from('members').select('phone').eq('telegram_id', from.id).maybeSingle();
  const mapUrl = lat != null && lng != null
    ? `https://yandex.ru/maps/?text=${lat},${lng}&z=16`
    : `https://yandex.ru/maps/?text=${encodeURIComponent(locText)}`;
  const rows = [
    [{ text: '🧭 Точка пассажира на карте', url: mapUrl }],
    [
      { text: '✅ Заеду', callback_data: `pickyes_${rideId}_${from.id}` },
      { text: '❌ Не смогу', callback_data: `pickno_${rideId}_${from.id}` },
    ],
  ];
  try {
    await tg('sendMessage', {
      chat_id: (ride as any).driver_id, parse_mode: 'HTML',
      text:
        `📍 <b>${esc(from.first_name || 'Пассажир')} просит заехать за ним</b>` +
        (from.username ? ` @${esc(from.username)}` : '') + '\n' +
        ((paxInfo as any)?.phone ? `📞 <code>${esc((paxInfo as any).phone)}</code>\n` : '') +
        `\nГде: ${esc(locText)}\n\nСможешь подхватить по пути?`,
      reply_markup: kb(rows),
    });
    return true;
  } catch { return false; }
}

/** Общий расход события: сохраняет в shopping.expenses и рассылает всем участникам
 *  чек с кнопкой отказа от позиции. Делится при финальном сплите по ртам (1 + гости). */
async function saveAndBroadcastExpense(evId: string, from: any, title: string, amount: number, photoFileId: string | null, shareIds?: number[], extraNote?: string) {
  const { data: evRow } = await supabase.from('events').select('title,shopping').eq('id', evId).maybeSingle();
  const shopping = (evRow as any)?.shopping || {};
  const expenses = Array.isArray(shopping.expenses) ? shopping.expenses : [];
  const expId = Date.now().toString(36);
  expenses.push({
    id: expId, title: title.slice(0, 120), amount: Math.round(amount * 100) / 100,
    by_id: from.id, by_name: from.first_name || from.username || 'Участник',
    photo: photoFileId, at: new Date().toISOString(), optout: [],
    // share_ids: делим только на выбранных; extra_note: незарегистрированные (текст).
    ...(shareIds && shareIds.length ? { share_ids: shareIds } : {}),
    ...(extraNote ? { extra_note: extraNote } : {}),
  });
  await supabase.from('events').update({ shopping: { ...shopping, expenses } }).eq('id', evId);

  const { data: regs } = await supabase
    .from('registrations').select('telegram_id').eq('event_id', evId).neq('status', 'cancelled');
  let ids = Array.from(new Set((regs || [])
    .map((r: any) => Number(r.telegram_id)).filter((id: number) => Number.isFinite(id) && id > 0 && id !== from.id)));
  if (shareIds && shareIds.length) ids = ids.filter((id) => shareIds.includes(id));

  const caption =
    `💸 <b>Общий расход — «${esc((evRow as any)?.title || 'событие')}»</b>\n\n` +
    `${esc(from.first_name || 'Участник')} купил(а): <b>${esc(title)}</b> — <b>${amount} BYN</b>\n\n` +
    `Разделим на всех при финальном сплите: доля = ты + твои гости (за гостей собираешь сам).\n` +
    `Не пользуешься этой позицией — откажись кнопкой.`;
  const markup = kb([[{ text: '🚫 Не скидываюсь на это', callback_data: `expout_${evId}_${expId}` }]]);
  for (const id of ids) {
    try {
      if (photoFileId) await tg('sendPhoto', { chat_id: id, photo: photoFileId, parse_mode: 'HTML', caption, reply_markup: markup });
      else await tg('sendMessage', { chat_id: id, parse_mode: 'HTML', text: caption, reply_markup: markup });
    } catch { /* участник мог заблокировать бота */ }
  }
  if (ADMIN_CHAT_ID) {
    try { await tg('sendMessage', { chat_id: ADMIN_CHAT_ID, parse_mode: 'HTML', text: `💸 Новый расход: «${esc(title)}» — ${amount} BYN (${esc(from.first_name || '')}, ${photoFileId ? 'с чеком' : 'без чека'}). Событие: ${esc((evRow as any)?.title || evId)}` }); } catch { /* no-op */ }
  }
  return ids.length;
}

/** Прямой вызов Gemini (REST): SDK живёт в api/ai.ts, в вебхук его не тащим. */
/** Гарантированный JSON от Gemini (responseMimeType) + повтор: текстовый
 *  вариант отвечал прозой и парс задач срабатывал через раз. */
async function geminiJSON(prompt: string): Promise<any | null> {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.API_KEY || '';
  if (!key) return null;
  const models = [process.env.GEMINI_MODEL, 'gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.0-flash'].filter(Boolean) as string[];
  const attempt = async (model: string): Promise<any | null> => {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 1200, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } },
      }),
    });
    const j: any = await r.json();
    const txt = (j?.candidates?.[0]?.content?.parts || []).map((p: any) => p?.text || '').join('').trim();
    if (!txt) return null;
    try { return JSON.parse(txt); } catch { const m = txt.match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null; }
  };
  for (const model of models) { try { const out = await attempt(model); if (out) return out; } catch { /* next */ } }
  return null;
}

async function geminiText(prompt: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.API_KEY || '';
  if (!key) return '';
  // У gemini-2.0-flash free-квота нулевая (limit: 0), у -latest — есть.
  const models = [process.env.GEMINI_MODEL, 'gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.0-flash'].filter(Boolean) as string[];
  const attempt = async (model: string, fast: boolean): Promise<string> => {
    const body: any = { contents: [{ parts: [{ text: prompt }] }] };
    // thinkingBudget:0 срезает «размышления» 2.5-моделей — иначе ответ идёт 30+ сек,
    // а вебхук должен уложиться в таймаут функции.
    if (fast) body.generationConfig = { maxOutputTokens: 1800, thinkingConfig: { thinkingBudget: 0 } };
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j: any = await r.json();
    const parts = j?.candidates?.[0]?.content?.parts || [];
    return parts.map((p: any) => p?.text || '').join('').trim();
  };
  for (const model of models) {
    try { const out = await attempt(model, true); if (out) return out; } catch { /* дальше */ }
  }
  for (const model of models.slice(0, 2)) {
    try { const out = await attempt(model, false); if (out) return out; } catch { /* дальше */ }
  }
  return '';
}

/**
 * ИИ-планировщик «Auto-Director»: намерение организатора → черновик
 * логистического сценария на реальных данных клуба (люди, машины, снаряжение).
 */
async function composePlan(intent: string): Promise<string> {
  const [{ data: people }, { data: regs }, { data: gear }, { data: evs }] = await Promise.all([
    supabase.from('members')
      .select('telegram_id,first_name,username,dietary,allergies,prefs,cooking_skills,points,is_core')
      .or('status.eq.approved,is_core.eq.true').limit(100),
    supabase.from('registrations')
      .select('telegram_id,event_id,has_transport,transport_seats').neq('status', 'cancelled').limit(300),
    supabase.from('gear_inventory').select('*').limit(100),
    supabase.from('events').select('id,title,date,type,max_participants').eq('status', 'open').limit(10),
  ]);

  // Машины: кто хоть раз отмечал транспорт при записи.
  const cars = new Map<number, number>();
  for (const r of regs || []) {
    if ((r as any).has_transport) cars.set((r as any).telegram_id, Math.max(cars.get((r as any).telegram_id) || 0, Number((r as any).transport_seats) || 0));
  }
  const roster = (people || []).map((p: any) => {
    const bits = [p.first_name || p.username || `id${p.telegram_id}`];
    if (p.is_core) bits.push('костяк');
    if (cars.has(p.telegram_id)) bits.push(`машина (${cars.get(p.telegram_id)} мест)`);
    if (p.dietary && p.dietary !== 'all') bits.push(p.dietary);
    if (p.allergies) bits.push(`аллергии: ${p.allergies}`);
    if (p.cooking_skills) bits.push(`готовит: ${p.cooking_skills}`);
    if (p.prefs?.fitness) bits.push(`уровень: ${p.prefs.fitness}`);
    if (p.prefs?.sleep) bits.push(`режим: ${p.prefs.sleep}`);
    if (p.points) bits.push(`${p.points} баллов`);
    return '- ' + bits.join(', ');
  }).join('\n');

  const prompt =
    'Ты — Auto-Director трезвого клуба «Живи в моменте» (Минск). Организатор просит спланировать событие.\n\n' +
    `ЗАПРОС ОРГАНИЗАТОРА: ${intent}\n\n` +
    `УЧАСТНИКИ КЛУБА:\n${roster || '- пока пусто'}\n\n` +
    `СНАРЯЖЕНИЕ КЛУБА: ${JSON.stringify(gear || []).slice(0, 800)}\n` +
    `ОТКРЫТЫЕ СОБЫТИЯ: ${(evs || []).map((e: any) => `${e.title} (${e.date})`).join('; ') || 'нет'}\n` +
    `СЕГОДНЯ: ${new Date().toISOString().slice(0, 10)}\n\n` +
    'Составь черновик сценария для организатора:\n' +
    '1. СОСТАВ И РОЛИ — кого позвать и почему (Водитель/Шеф/Навигатор/Аптечка), по реальным данным.\n' +
    '2. МАШИНЫ — рассадка по имеющимся машинам, кого не хватает.\n' +
    '3. ЧЕК-ЛИСТ — снаряжение и закупка с ответственными (учти питание и аллергии).\n' +
    '4. ТАЙМЛАЙН — сбор, дорога, активности, еда, возвращение.\n' +
    '5. ЛИЧНЫЕ СООБЩЕНИЯ — короткие черновики приглашений с конкретной ролью.\n\n' +
    'Пиши по-русски, тепло и конкретно. ЧИСТЫЙ ТЕКСТ без markdown и HTML. До 3500 символов.';

  return await geminiText(prompt);
}

/** Есть ли у участника активная запись на событие. */
async function hasActiveReg(eventId: string, tgId: number): Promise<boolean> {
  const { data } = await supabase
    .from('registrations').select('id')
    .eq('event_id', eventId).eq('telegram_id', tgId).neq('status', 'cancelled').maybeSingle();
  return !!data;
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

/** Точки «маршрута дня» события (мультиточечные события — спека в HANDOFF). */
function itineraryOf(ev: any): any[] {
  const it = ev?.logistics?.itinerary;
  return Array.isArray(it) ? it.filter((p: any) => p && p.title) : [];
}

/** Многоточечный маршрут в Яндекс.Картах по точкам с координатами. */
function itineraryRouteUrl(points: any[]): string | null {
  const coords = points
    .filter((p: any) => Number(p.lat) && Number(p.lng))
    .map((p: any) => `${p.lat},${p.lng}`);
  return coords.length >= 2 ? `https://yandex.ru/maps/?rtext=${coords.join('~')}&rtt=auto` : null;
}

/** Строка оплаты точки: за что платишь, а за что — нет. */
function payPhrase(p: any): string {
  const price = Number(p.price) ? ` (${Number(p.price)} BYN${p.priceNote ? ', ' + p.priceNote : ''})` : '';
  if (p.payment === 'host') return ` — за счёт организатора`;
  if (p.payment === 'split') return ` — делим поровну${price}`;
  if (p.payment === 'free') return ` — бесплатно`;
  return price ? ` — платишь сам${price}` : '';
}

function itineraryBlock(ev: any): string {
  const pts = itineraryOf(ev);
  if (!pts.length) return '';
  const lines = pts.map((p: any) =>
    `${p.time ? esc(p.time) + ' ' : ''}${esc(p.title)}${esc(payPhrase(p))}`);
  return `\n🧭 <b>Маршрут дня</b>\n${lines.join('\n')}\n`;
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
    // Программа — источник правды (обновляется голосованиями/правками);
    // старый «маршрут дня» показываем, только если программы нет.
    (((ev.program || []).length)
      ? `\n📋 <b>Программа</b>\n` + (ev.program as string[]).slice(0, 14).map((p: string) => `• ${esc(p)}`).join('\n') + '\n'
      : itineraryBlock(ev)) +
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

// Очередь ожидания: место освободилось → зовём первого в очереди на эту машину/палатку.
async function notifyWaitlist(rideId: number, kind: 'car' | 'tent') {
  const { data: next } = await supabase.from('ride_requests')
    .select('passenger_id').eq('ride_id', rideId).eq('active', true)
    .order('created_at', { ascending: true }).limit(1).maybeSingle();
  if (!next) return;
  // Снимаем его с очереди — свой шанс он получил (кто первый нажал, того и бронь).
  await supabase.from('ride_requests').update({ active: false })
    .eq('ride_id', rideId).eq('passenger_id', (next as any).passenger_id);
  const bookCb = kind === 'tent' ? `tbook_${rideId}` : `ridebook_${rideId}`;
  const where = kind === 'tent' ? 'в палатке' : 'в машине';
  try {
    await tg('sendMessage', {
      chat_id: (next as any).passenger_id, parse_mode: 'HTML',
      text: `🔔 <b>Освободилось место ${where}!</b>\nТы первый в очереди — успей занять. Кто первый нажал, того и бронь.`,
      reply_markup: kb([[{ text: '✅ Занять место', callback_data: bookCb }]]),
    });
  } catch { /* no-op */ }
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
/**
 * Флаги функций события. Админ включает/выключает в карточке события
 * (живут в events.notifications: feat_food/feat_rides/feat_tents, без DDL).
 * Флага нет — поведение по типу события, как раньше.
 */
function featureOn(ev: any, key: 'food' | 'rides' | 'tents'): boolean {
  const v = ev?.notifications?.[`feat_${key}`];
  if (typeof v === 'boolean') return v;
  if (key === 'food') return ['active', 'male', 'mixed'].includes(ev?.type);
  return ev?.type !== 'intellectual';
}
function foodNeeded(ev: any) { return featureOn(ev, 'food'); }

/**
 * Постоянное меню внизу чата. 4 пункта по UX-аудиту: меньше когнитивной
 * нагрузки, логистика переехала внутрь карточки события (кнопка там есть).
 * Старые тексты кнопок продолжаем понимать — клавиатура у людей кешируется.
 */
function mainMenu(admin = false) {
  // UX: 2×2, высокочастотное сверху. «Мои события» (мои брони/логистика) —
  // самое частое; «Все события» — обзор афиши; профиль/помощь — редкие.
  // Костяку — третий ряд с быстрым входом в панель организатора.
  const rows: any[] = [
    [{ text: '🗓 Мои события' }, { text: '📅 Все события' }],
    [{ text: '👤 Профиль' }, { text: '❓ Помощь' }],
  ];
  if (admin) rows.push([{ text: '⚙️ Панель организатора' }]);
  return {
    keyboard: rows,
    resize_keyboard: true,
    is_persistent: true,
  };
}

/** Приветствие + афиша открытых событий — /start и кнопка «Главная». */
async function sendWelcome(chatId: number, openBtn: any, isCoreUser = false) {
  const { data: evs } = await supabase
    .from('events')
    .select('id,title,status,date')
    .eq('status', 'open')
    .order('date', { ascending: true })
    .limit(6);
  const rows = (evs || []).map((e: any) => [
    { text: `✅ ${e.title} · ${whenPhrase(e.date)}`, callback_data: `ev_${e.id}` },
  ]);
  // Костяку — быстрый вход в панель организатора прямо с Главной (не в сайт-админку).
  if (isCoreUser) rows.push([{ text: '⚙️ Панель организатора', callback_data: 'admhome' }]);
  rows.push([openBtn as any]);
  await tg('sendMessage', {
    chat_id: chatId,
    parse_mode: 'HTML',
    text:
      '👋 Добро пожаловать в <b>«Живи в моменте»</b>!\n\n' +
      'Живая афиша трезвого сообщества. Выбери событие — покажу детали, дату и как добраться 👇',
    reply_markup: { inline_keyboard: rows },
  });
}

/** «Мои события» — записи участника с быстрой отменой. */
async function sendMyEvents(chatId: number, tgId: number, openBtn: any) {
  const { data: regs } = await supabase
    .from('registrations').select('event_id,status')
    .eq('telegram_id', tgId).neq('status', 'cancelled');
  const ids = (regs || []).map((r: any) => r.event_id);
  if (!ids.length) {
    await tg('sendMessage', {
      chat_id: chatId, parse_mode: 'HTML',
      text: '🗓 <b>Мои события</b>\n\nПока нет активных записей. Открой афишу и выбери, куда выбраться 👇',
      reply_markup: kb([[openBtn]]),
    });
    return;
  }
  const { data: evs } = await supabase.from('events').select('id,title,date').in('id', ids).order('date');
  const rows: any[] = [];
  for (const e of evs || []) {
    rows.push([{ text: `📌 ${e.title} · ${whenPhrase(e.date)}`, callback_data: `ev_${e.id}` }]);
    rows.push([{ text: '❌ Отменить запись', callback_data: `regcancel_${e.id}` }]);
  }
  rows.push([openBtn]);
  await tg('sendMessage', {
    chat_id: chatId, parse_mode: 'HTML',
    text: '🗓 <b>Мои события</b>\n\nНажми на событие — детали, логистика и вопросы там:',
    reply_markup: kb(rows),
  });
}

/** Экран «Ближайшие события» — кнопка меню и команда /events. */
async function sendEventsList(chatId: number, openBtn: any) {
  const { data: evs } = await supabase
    .from('events').select('id,title,date,status')
    .eq('status', 'open').order('date', { ascending: true }).limit(6);
  if (!evs || !evs.length) {
    await tg('sendMessage', { chat_id: chatId, text: 'Пока нет открытых событий. Загляни позже.' });
    return;
  }
  const rows = evs.map((e: any) => [{ text: `${e.title} · ${whenPhrase(e.date)}`, callback_data: `ev_${e.id}` }]);
  rows.push([openBtn as any]);
  await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: '📅 <b>Ближайшие события</b>', reply_markup: kb(rows) });
}

/** Экран «Помощь» — кнопка меню и команда /help. */
async function sendHelp(chatId: number) {
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
}

/** Команда /diet — тип питания (детали и аллергии уточняются при записи на событие). */
async function sendDietPrompt(chatId: number) {
  await tg('sendMessage', {
    chat_id: chatId, parse_mode: 'HTML',
    text: '🍽 <b>Твоё питание</b>\n\nУчтём в меню и списке закупки. Аллергии и детали уточняем при записи на каждое событие.',
    reply_markup: kb([
      [{ text: '🍗 Всеядный', callback_data: 'dietset:all' }],
      [{ text: '🥗 Вегетарианец', callback_data: 'dietset:veg' }],
      [{ text: '🌱 Веган', callback_data: 'dietset:vegan' }],
    ]),
  });
}

/** Команда /preferences — уровень активности, затем режим сна (callback prefset:). */
async function sendPreferencesPrompt(chatId: number) {
  await tg('sendMessage', {
    chat_id: chatId, parse_mode: 'HTML',
    text: '⚙️ <b>Предпочтения</b>\n\nТвой уровень активности — подберём события по силам.',
    reply_markup: kb([
      [{ text: '🌱 Начинающий', callback_data: 'prefset:fit:beginner' }],
      [{ text: '💪 Средний', callback_data: 'prefset:fit:medium' }],
      [{ text: '🏆 Продвинутый', callback_data: 'prefset:fit:advanced' }],
    ]),
  });
}

/**
 * Кнопки под карточкой события. Набор зависит от самого события:
 * интеллектуальному клубу не нужна логистика, бесплатному — оплата,
 * событию без координат — маршрут.
 */
function eventCardButtons(ev: any, openBtn: any, registered = false): any[] {
  // Незаписанному — только запись и базовая информация. Рабочие инструменты
  // (логистика/задачи/голосования/чат) открываются после регистрации.
  if (!registered) {
    const rows: any[] = [[{ text: '✅ Записаться', callback_data: `reg_${ev.id}` }]];
    const nav0: any[] = [];
    if ((ev.program || []).length) nav0.push({ text: '📋 Программа', callback_data: `prog_${ev.id}` });
    if (ev.logistics?.prep) nav0.push({ text: '🎒 Как готовиться', callback_data: `prep_${ev.id}` });
    if (nav0.length) rows.push(nav0);
    rows.push([{ text: '📤 Позвать', callback_data: `share_${ev.id}` }]);
    rows.push([openBtn]);
    return rows;
  }
  const rows: any[] = [[{ text: '✅ Ты записан', callback_data: `myreg_${ev.id}` }], [{ text: '📸 Фото и видео', callback_data: `media_${ev.id}` }]];
  // telegram_bot_url = инвайт-ссылка группового чата события (привязка: /link в группе).
  if (ev.telegram_bot_url) rows.push([{ text: '💬 Чат события', url: ev.telegram_bot_url }]);

  // Точки выезда и прибытия (из logistics) — верхний ряд
  const lg = ev?.logistics || {};
  const pointsRow: any[] = [];
  if (lg.assemblyPoint) {
    const coords = lg.assemblyPoint.match(/(-?\d+[.,]\d+)[,\s]+(-?\d+[.,]\d+)/);
    const mapUrl = coords ? `https://yandex.ru/maps/?text=${coords[1].replace(',', '.')},${coords[2].replace(',', '.')}` : null;
    pointsRow.push({ text: '🚩 Точка выезда', url: mapUrl || `https://yandex.ru/maps/?text=${encodeURIComponent(lg.assemblyPoint)}` });
  }
  if (lg.arrivalPoint) {
    const coords = lg.arrivalPoint.match(/(-?\d+[.,]\d+)[,\s]+(-?\d+[.,]\d+)/);
    const mapUrl = coords ? `https://yandex.ru/maps/?text=${coords[1].replace(',', '.')},${coords[2].replace(',', '.')}` : null;
    pointsRow.push({ text: '🏁 Точка прибытия', url: mapUrl || `https://yandex.ru/maps/?text=${encodeURIComponent(lg.arrivalPoint)}` });
  }
  if (lg.assemblyPoint || lg.arrivalPoint) {
    pointsRow.push({ text: '📍 Переслать точки', callback_data: `sharepoints_${ev.id}` });
    rows.push(pointsRow);
  }

  // Чат события, маршрут, программа
  const nav: any[] = [];
  const route = itineraryRouteUrl(itineraryOf(ev)) || routeUrl(ev);
  if (route) nav.push({ text: '🧭 Маршрут', url: route });
  if ((ev.program || []).length) nav.push({ text: '📋 Программа', callback_data: `prog_${ev.id}` });
  if (ev.logistics?.prep) nav.push({ text: '🎒 Как готовиться', callback_data: `prep_${ev.id}` });
  if (nav.length) rows.push(nav);

  // Статистика + логистика + оплата
  const logi: any[] = [];
  logi.push({ text: '📊 Кто', callback_data: `stats_${ev.id}` });
  if (featureOn(ev, 'rides') || featureOn(ev, 'tents')) logi.push({ text: '🚗 Лог', callback_data: `logi_${ev.id}` });
  if (ev.price_type === 'paid') logi.push({ text: '💳', callback_data: `pay_${ev.id}` });
  if (logi.length) rows.push(logi);

  // Голосования и задачи
  rows.push([
    { text: '🗳 Голосования', callback_data: `polls_${ev.id}` },
    { text: '📋 Задачи', callback_data: `tasks_${ev.id}` },
  ]);
  // Нижние кнопки: спрос/предложение + позвать
  rows.push([
    { text: '❓', callback_data: `ask_${ev.id}` },
    { text: '💡', callback_data: `idea_${ev.id}` },
    { text: '📤 Позвать', callback_data: `share_${ev.id}` },
  ]);
  rows.push([{ text: '❌ Отказаться от участия', callback_data: `regcancel_${ev.id}` }]);
  rows.push([openBtn]);
  return rows;
}

/**
 * Создание задачи из свободного текста (надиктовка с ошибками — ок):
 * ИИ даёт публичную формулировку БЕЗ контактов/адресов (их получит только
 * взявший), теги (авто/время) и при нехватке данных — один уточняющий вопрос.
 */
async function createTaskFlow(evId: string, from: any, chatId: number, rawText: string, allowClarify: boolean) {
  let cleanTitle = rawText.slice(0, 200);
  let needsCar = false;
  let targetTime = '';
  let clarify = '';
  try {
    const parsed = await geminiJSON(
      `Участник клуба надиктовал задачу (возможны ошибки распознавания, надо ПЕРЕПИСАТЬ грамотно): "${rawText}"\n\n` +
      `Верни JSON:\n` +
      `{"title":"публичная формулировка: перепиши грамотным русским, кратко (до 140 симв.), БЕЗ телефонов, БЕЗ точных адресов и имён контактов — их увидит только исполнитель",` +
      `"needs_car":true|false — true ТОЛЬКО если без автомобиля задачу физически не выполнить (крупный груз, далеко везти). Купить мелочь/зайти в магазин = false,` +
      `"time":"когда нужно, если указано, иначе пустая строка",` +
      `"clarify":"ОДИН уточняющий вопрос, только если критично не хватает данных исполнителю (куда доставить/когда), иначе пустая строка"}`
    );
    if (parsed && parsed.title) {
      cleanTitle = String(parsed.title).slice(0, 200);
      needsCar = !!parsed.needs_car;
      targetTime = String(parsed.time || '').slice(0, 80);
      clarify = String(parsed.clarify || '').slice(0, 200);
    }
  } catch { /* fallback: сырой текст */ }

  if (allowClarify && clarify) {
    await setSession(from.id, 'task_clarify', { evId, raw: rawText });
    await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `🤔 Уточни, чтобы исполнитель сразу всё понял:\n<b>${esc(clarify)}</b>\n\n<i>Ответь одним сообщением (или напиши «-», чтобы пропустить).</i>` });
    return;
  }

  // Предпросмотр: ИИ мог оформить неидеально — создатель подтверждает или правит.
  await setSession(from.id, 'task_preview', { evId, raw: rawText, title: cleanTitle, needsCar, targetTime });
  await tg('sendMessage', {
    chat_id: chatId, parse_mode: 'HTML',
    text: `👀 <b>Так разошлю задачу:</b>\n\n${esc(cleanTitle)}${targetTime ? `\n⏰ ${esc(targetTime)}` : ''}${needsCar ? '\n🚗 нужен автомобиль → уйдёт водителям' : ''}\n\n<i>Контакты/адреса из твоего текста получит только исполнитель.</i>`,
    reply_markup: kb([
      [{ text: `Кому: ${needsCar ? '🚗 только водителям' : '👥 всем участникам'} — сменить`, callback_data: 'tprev_aud' }],
      [
        { text: '✅ Отправить', callback_data: 'tprev_go' },
        { text: '✏️ Переписать', callback_data: 'tprev_redo' },
        { text: '❌ Отмена', callback_data: 'tprev_no' },
      ],
    ]),
  });
}

/** Фактическое создание и рассылка задачи (после подтверждения предпросмотра). */
async function taskCommit(evId: string, from: any, chatId: number, rawText: string, cleanTitle: string, needsCar: boolean, targetTime: string) {
  const ev = await getEvent(evId);
  const { data: created } = await supabase
    .from('tasks').insert({ event_id: evId, title: cleanTitle, created_by: from.id, done: false }).select('id').single();
  if (!created) { await tg('sendMessage', { chat_id: chatId, text: 'Не удалось создать задачу.' }); return; }
  const taskId = (created as any).id;
  try {
    const logi = (ev as any)?.logistics || {};
    const taskRaw = { ...(logi.task_raw || {}), [String(taskId)]: rawText };
    await supabase.from('events').update({ logistics: { ...logi, task_raw: taskRaw } }).eq('id', evId);
  } catch { /* best-effort */ }
  const eligible = await pollEligible(evId);
  let targeted: number[] = eligible;
  if (needsCar) {
    const { data: regs } = await supabase
      .from('registrations').select('telegram_id').eq('event_id', evId).eq('has_transport', true).neq('status', 'cancelled');
    const drivers = new Set((regs || []).map((r: any) => Number(r.telegram_id)).filter(Boolean));
    if (drivers.size > 0) targeted = eligible.filter((id) => drivers.has(id));
  }
  const timeHint = targetTime ? `\n⏰ ${esc(targetTime)}` : '';
  const carHint = needsCar ? ' 🚗' : '';
  await tg('sendMessage', {
    chat_id: chatId, parse_mode: 'HTML',
    text: `✅ Задача поставлена${needsCar ? ' (нужен авто → разослана водителям)' : ' и разослана'}:\n<b>${esc(cleanTitle)}</b>${timeHint}\nКто возьмёт — придёт уведомление, детали и контакты получит только исполнитель.`,
  });
  await Promise.allSettled(targeted.filter((id) => id !== from.id).map((id) =>
    tg('sendMessage', {
      chat_id: id, parse_mode: 'HTML',
      text: `📋${carHint} <b>Задача — «${esc(ev?.title || 'событие')}»</b>\n\n${esc(cleanTitle)}${timeHint}\n\nОт: ${esc(from.first_name || 'участник')}. Можешь взять?`,
      reply_markup: kb([[{ text: '🙋 Беру в работу', callback_data: `taketask_${taskId}` }]]),
    })
  ));
}

/**
 * Догоняющий дайджест при /start: человек вернулся (мог блокировать бота) —
 * добиваем всё, на что он не отреагировал: пробелы анкеты, свободные задачи,
 * открытые голосования, где он не голосовал. Без спама: одно сообщение.
 */
async function sendCatchup(chatId: number, tgId: number) {
  try {
    const { data: regs } = await supabase
      .from('registrations')
      .select('event_id,dietary,equipment,roles,has_transport,status')
      .eq('telegram_id', tgId).neq('status', 'cancelled');
    if (!regs?.length) return;
    const { data: evs } = await supabase
      .from('events').select('id,title,date').eq('status', 'open')
      .in('id', regs.map((r: any) => r.event_id)).order('date').limit(3);
    for (const ev of evs || []) {
      const r: any = regs.find((x: any) => x.event_id === (ev as any).id);
      const gaps: string[] = [];
      if (r && (r.has_transport === null || r.has_transport === undefined)) gaps.push('🚗 транспорт');
      if (r && !r.dietary) gaps.push('🍽 питание');
      if (r && !r.equipment) gaps.push('🎒 снаряжение');
      const { data: freeTasks } = await supabase
        .from('tasks').select('id,title').eq('event_id', (ev as any).id).is('taken_by', null).eq('done', false).limit(5);
      const { data: pollsOpen } = await supabase
        .from('polls').select('id,question,options').eq('event_id', (ev as any).id).limit(5);
      const myVotes = new Set<number>();
      if (pollsOpen?.length) {
        const { data: pv } = await supabase.from('poll_votes').select('poll_id').eq('telegram_id', tgId).in('poll_id', pollsOpen.map((p: any) => p.id));
        for (const v of pv || []) myVotes.add(Number((v as any).poll_id));
      }
      const openUnvoted = (pollsOpen || []).filter((p: any) => (!p.options?.status || p.options.status === 'open') && !myVotes.has(Number(p.id)));
      if (!gaps.length && !(freeTasks || []).length && !openUnvoted.length) continue;
      const lines: string[] = [`⚡ <b>Пока тебя не было — «${esc((ev as any).title)}»</b>`];
      if (gaps.length) lines.push(`\n📋 Дозаполни анкету: ${gaps.join(', ')}`);
      if ((freeTasks || []).length) lines.push(`\n🆓 Свободные задачи:\n${(freeTasks || []).map((t: any) => `• ${esc(t.title)}`).join('\n')}`);
      if (openUnvoted.length) lines.push(`\n🗳 Ты ещё не голосовал:\n${openUnvoted.map((p: any) => `• ${esc(p.question)}`).join('\n')}`);
      const btns: any[][] = [];
      if (gaps.includes('🚗 транспорт')) btns.push([{ text: '🚗 Указать транспорт', callback_data: `trask_${(ev as any).id}` }]);
      if (gaps.length) btns.push([{ text: '📋 Заполнить анкету', callback_data: `org_${(ev as any).id}` }]);
      if ((freeTasks || []).length) btns.push([{ text: '📋 Открыть задачи', callback_data: `tasks_${(ev as any).id}` }]);
      if (openUnvoted.length) btns.push([{ text: '🗳 Голосования', callback_data: `polls_${(ev as any).id}` }]);
      await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: lines.join('\n'), reply_markup: btns.length ? kb(btns) : undefined });
    }
  } catch { /* дайджест — best-effort */ }
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
    ...(context.gender ? { gender: context.gender } : {}),
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
// Бонусные баллы за поощряемые действия (шаринг ресурсов клуба).
const POINTS_SHARE_CAR = 15;   // предложил машину с местами
const POINTS_SHARE_TENT = 12;  // предложил места в палатке

/** Начисляет баллы через RPC и возвращает новый баланс (0 при ошибке). */
async function awardPoints(tgId: number, n: number): Promise<number> {
  try {
    await supabase.rpc('award_points', { tg: tgId, n });
    const { data } = await supabase.from('members').select('points').eq('telegram_id', tgId).maybeSingle();
    return Number((data as any)?.points) || 0;
  } catch { return 0; }
}

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
  const fuel = r.fuel_cost ? `⛽ ${r.fuel_cost} Br/чел` : '⛽ бесплатно';
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
  // Telegram присылает secret-token только если webhook был зарегистрирован с ним.
  // Если секрет в env и в Telegram рассинхронизировались, не роняем весь поток
  // апдейтов 401-кой: лучше принять запрос и восстановить работу бота, чем
  // терять /start и callback-кнопки до ручной перепривязки webhook.
  if (WEBHOOK_SECRET && req.headers['x-telegram-bot-api-secret-token'] !== WEBHOOK_SECRET) {
    console.warn('[telegram:webhook] secret token mismatch; accepting update to avoid delivery breakage');
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
      const OPEN_TO_ALL = /^(verify_start|verify_consent|verify_pd|applyg_|support|approve_|reject_|payok_|payno_|reply_)/;
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
        if (ev?.telegram_bot_url) rows.push([{ text: '💬 Чат события', url: ev.telegram_bot_url }]);
        const p = payRow(ev);
        if (p) rows.push(p);
        if (ev && (featureOn(ev, 'rides') || featureOn(ev, 'tents'))) {
          rows.push([{ text: '🚗 Логистика и брони', callback_data: `logi_${ev.id}` }]);
        }
        if (ev && ev.type !== 'intellectual') {
          rows.push([{ text: '📋 Организация (снаряжение, роли)', callback_data: `org_${ev.id}` }]);
        }
        if (ev) rows.push([{ text: '❌ Отказаться от участия', callback_data: `regcancel_${ev.id}` }]);
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
            [
              { text: 'Я один', callback_data: `rg:${evId}:0` },
              { text: '+1', callback_data: `rg:${evId}:1` },
              { text: '+2', callback_data: `rg:${evId}:2` },
              { text: '+3', callback_data: `rg:${evId}:3` },
            ],
            [{ text: '✏️ Другое число', callback_data: `rgx_${evId}` }],
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

      // Пол в конце заявки → завершаем подачу.
      if (data.startsWith('applyg_')) {
        const gender = data.slice('applyg_'.length) === 'female' ? 'female' : 'male';
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        try { await tg('editMessageReplyMarkup', { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [] } }); } catch { /* no-op */ }
        const s = await getSession(tgId);
        await finishApplication(cq.from, chatId, { ...(s?.context || {}), gender });
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

      // /diet: сохранить тип питания в профиль (детали и аллергии — при записи на событие).
      if (data.startsWith('dietset:')) {
        const val = data.split(':')[1];
        const diet = val === 'veg' ? 'vegetarian' : val === 'vegan' ? 'vegan' : 'all';
        await supabase.from('members').update({ dietary: diet }).eq('telegram_id', tgId);
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Сохранено' });
        const label = val === 'veg' ? '🥗 Вегетарианец' : val === 'vegan' ? '🌱 Веган' : '🍗 Всеядный';
        await tg('editMessageText', {
          chat_id: chatId, message_id: msgId, parse_mode: 'HTML',
          text: `🍽 Питание сохранено: <b>${label}</b>\n\nАллергии и детали уточним при записи на событие. Изменить — /diet`,
        });
        return res.status(200).json({ ok: true });
      }

      // /preferences: уровень активности → режим сна, копим в members.prefs (jsonb).
      if (data.startsWith('prefset:')) {
        const [, kind, val] = data.split(':');
        const { data: m } = await supabase.from('members').select('prefs').eq('telegram_id', tgId).maybeSingle();
        const prefs = { ...((m?.prefs as any) || {}), [kind === 'fit' ? 'fitness' : 'sleep']: val };
        await supabase.from('members').update({ prefs }).eq('telegram_id', tgId);
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Сохранено' });
        if (kind === 'fit') {
          await tg('editMessageText', {
            chat_id: chatId, message_id: msgId, parse_mode: 'HTML',
            text: '😴 <b>Твой режим?</b>\n\nПоможет планировать подъёмы и программу.',
            reply_markup: kb([
              [{ text: '🌅 Жаворонок (рано встаю)', callback_data: 'prefset:sleep:morning' }],
              [{ text: '🦉 Сова (поздно ложусь)', callback_data: 'prefset:sleep:night' }],
              [{ text: '⚖️ Средний режим', callback_data: 'prefset:sleep:normal' }],
            ]),
          });
        } else {
          await tg('editMessageText', {
            chat_id: chatId, message_id: msgId, parse_mode: 'HTML',
            text: '✅ <b>Предпочтения сохранены</b>\n\nУчтём при подборе и планировании событий. Изменить — /preferences',
          });
        }
        return res.status(200).json({ ok: true });
      }

      // /link в группе: костяк привязывает групповой чат к событию.
      // Инвайт-ссылка сохраняется в events.telegram_bot_url и попадает в карточку.
      if (data.startsWith('bindchat_')) {
        if (!(await isCore(tgId))) {
          await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Только для костяка клуба' });
          return res.status(200).json({ ok: true });
        }
        const evId = data.slice('bindchat_'.length);
        const ev = await getEvent(evId);
        if (!ev) {
          await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Событие не найдено' });
          return res.status(200).json({ ok: true });
        }
        // Ссылку может создать только бот-админ группы. Пробуем именную,
        // затем общую; если обе не вышли — говорим, каких прав не хватает.
        let link = '';
        const r1 = await tg('createChatInviteLink', { chat_id: chatId, name: String(ev.title || '').slice(0, 32) });
        link = r1?.result?.invite_link || '';
        if (!link) {
          const r2 = await tg('exportChatInviteLink', { chat_id: chatId });
          link = typeof r2?.result === 'string' ? r2.result : '';
        }
        if (!link) {
          await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Нужны права админа' });
          await tg('editMessageText', {
            chat_id: chatId, message_id: msgId, parse_mode: 'HTML',
            text: '⚠️ Не удалось создать инвайт-ссылку.\n\nСделай бота <b>администратором группы</b> (право «Пригласительные ссылки») и отправь /link ещё раз.',
          });
          return res.status(200).json({ ok: true });
        }
        await supabase.from('events').update({ telegram_bot_url: link }).eq('id', evId);
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Чат привязан' });
        await tg('editMessageText', {
          chat_id: chatId, message_id: msgId, parse_mode: 'HTML',
          text: `✅ Чат привязан к событию «<b>${esc(ev.title)}</b>».\n\nКнопка «💬 Чат события» появилась в карточке и в подтверждении записи.`,
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
            // Показать web-кнопку «Афиша» только принятым участникам.
            try { await tg('setChatMenuButton', { chat_id: targetId, menu_button: { type: 'web_app', text: 'Афиша', web_app: { url: site } } }); } catch { /* no-op */ }
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
            [{ text: '🚗 На своём авто — есть свободные места', callback_data: `rt:${ev.id}:car` }],
            [{ text: '🚗 На своём авто — мест нет', callback_data: `rt:${ev.id}:carfull` }],
            [{ text: '🙋 Нужна попутка — возьмите меня', callback_data: `rt:${ev.id}:seek` }],
            [{ text: '🚶 Без авто, доберусь сам (пешком/транспортом)', callback_data: `rt:${ev.id}:self` }],
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

      // Пропуск марки авто: ставим нейтральное описание и продолжаем опрос.
      if (data.startsWith('carskip_')) {
        const evId = data.slice('carskip_'.length);
        const ev = await getEvent(evId);
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        await clearSession(tgId);
        const { data: rr } = await supabase.from('registrations').select('transport_details').eq('event_id', evId).eq('telegram_id', tgId).neq('status', 'cancelled').maybeSingle();
        if (!(rr as any)?.transport_details) await updateReg(evId, tgId, { transport_details: 'Свой автомобиль' });
        if (foodNeeded(ev)) {
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
        } else {
          await tg('editMessageText', {
            chat_id: chatId, message_id: msgId, parse_mode: 'HTML',
            text: `✅ Готово! Ты записан(а) на «<b>${esc(ev?.title || 'событие')}</b>». Детали придут сюда.`,
            reply_markup: kb(eventCardButtons(ev, openBtn, true)),
          });
        }
        return res.status(200).json({ ok: true });
      }

      // Переспрос транспорта (из крон-напоминания, если поле осталось пустым).
      if (data.startsWith('trask_')) {
        const evId = data.slice('trask_'.length);
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        await tg('sendMessage', {
          chat_id: chatId, parse_mode: 'HTML',
          text: '🚗 Как добираешься?',
          reply_markup: kb([
            [{ text: '🚗 На своём авто — есть свободные места', callback_data: `rt:${evId}:car` }],
            [{ text: '🚗 На своём авто — мест нет', callback_data: `rt:${evId}:carfull` }],
            [{ text: '🙋 Нужна попутка — возьмите меня', callback_data: `rt:${evId}:seek` }],
            [{ text: '🚶 Без авто, доберусь сам (пешком/транспортом)', callback_data: `rt:${evId}:self` }],
          ]),
        });
        return res.status(200).json({ ok: true });
      }

      // ── Доска задач (tasks): поставил → всем прилетело → «Беру» → «Сделано» ──
      if (data.startsWith('tasks_')) {
        const evId = data.slice('tasks_'.length);
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        // Гейт: задачи — только для записанных на событие (и костяка).
        const eligT = await pollEligible(evId);
        const coreT = await isCore(tgId);
        if (!eligT.includes(tgId) && !coreT) {
          await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: '📋 Задачи доступны участникам события. Сначала запишись 👇', reply_markup: kb([[{ text: '✅ Записаться', callback_data: `reg_${evId}` }]]) });
          return res.status(200).json({ ok: true });
        }
        const { data: tasks } = await supabase
          .from('tasks').select('id,title,taken_by,done,created_by').eq('event_id', evId).order('id', { ascending: false }).limit(15);
        const rows: any[] = [];
        for (const t of tasks || []) {
          const takenT = (t as any).taken_by;
          // Видимость: свободные — всем; в работе — взявшему/автору/костяку; сделанные — костяку.
          if ((t as any).done && !coreT) continue;
          if (takenT && !(Number(takenT) === tgId || Number((t as any).created_by) === tgId || coreT)) continue;
          const st = (t as any).done ? '✅' : takenT ? '🙋' : '🆕';
          rows.push([{ text: `${st} ${(t as any).title}`.slice(0, 60), callback_data: `taskshow_${(t as any).id}` }]);
        }
        rows.push([{ text: '➕ Поставить задачу', callback_data: `tasknew_${evId}` }]);
        await tg('sendMessage', {
          chat_id: chatId, parse_mode: 'HTML',
          text: (tasks || []).length ? '📋 <b>Задачи события</b>\n🆕 свободна · 🙋 в работе · ✅ сделана' : '📋 <b>Задач пока нет</b>\nПоставь задачу (напр. «забрать проектор») — прилетит всем, кто-то возьмёт.',
          reply_markup: kb(rows),
        });
        return res.status(200).json({ ok: true });
      }
      if (data.startsWith('tasknew_')) {
        const evId = data.slice('tasknew_'.length);
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        const elig = await pollEligible(evId);
        if (!elig.includes(tgId) && !(await isCore(tgId))) { await tg('sendMessage', { chat_id: chatId, text: 'Ставить задачи могут участники события.' }); return res.status(200).json({ ok: true }); }
        await setSession(tgId, 'task_create', { evId });
        await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: '📋 Опиши задачу одной строкой — что нужно сделать.\n<i>Например: «Забрать экран у Марины, ул. Сурганова 5, до пятницы» или «Арендовать колонку».</i>' });
        return res.status(200).json({ ok: true });
      }
      if (data.startsWith('taskshow_')) {
        const taskId = Number(data.slice('taskshow_'.length));
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        const { data: t } = await supabase.from('tasks').select('*').eq('id', taskId).maybeSingle();
        if (!t) return res.status(200).json({ ok: true });
        const takenBy = (t as any).taken_by;
        const rows: any[] = [];
        if ((t as any).done) { /* закрыта */ }
        else if (!takenBy) rows.push([{ text: '🙋 Беру в работу', callback_data: `taketask_${taskId}` }]);
        else if (Number(takenBy) === tgId) rows.push([{ text: '✅ Сделано', callback_data: `donetask_${taskId}` }]);
        if (Number((t as any).created_by) === tgId && !(t as any).done) rows.push([{ text: '🗑 Снять задачу', callback_data: `taskdel_${taskId}` }]);
        let who = '';
        if (takenBy) { const { data: m } = await supabase.from('members').select('first_name,username').eq('telegram_id', takenBy).maybeSingle(); who = (m as any)?.first_name || (m as any)?.username || `id ${takenBy}`; }
        await tg('sendMessage', {
          chat_id: chatId, parse_mode: 'HTML',
          text: `📋 <b>${esc((t as any).title)}</b>\n\nСтатус: ${(t as any).done ? '✅ сделана' : takenBy ? `🙋 в работе (${esc(who)})` : '🆕 свободна'}`,
          reply_markup: rows.length ? kb(rows) : undefined,
        });
        return res.status(200).json({ ok: true });
      }
      // Предпросмотр задачи: отправить / переписать / отмена (черновик в сессии).
      if (data === 'tprev_aud') {
        const sessA = await getSession(tgId);
        if (!sessA || sessA.state !== 'task_preview') { await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Черновик устарел' }); return res.status(200).json({ ok: true }); }
        const nc = !sessA.context?.needsCar;
        await setSession(tgId, 'task_preview', { ...sessA.context, needsCar: nc });
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: nc ? 'Только водителям' : 'Всем участникам' });
        try {
          await tg('editMessageReplyMarkup', { chat_id: chatId, message_id: msgId, reply_markup: kb([
            [{ text: `Кому: ${nc ? '🚗 только водителям' : '👥 всем участникам'} — сменить`, callback_data: 'tprev_aud' }],
            [
              { text: '✅ Отправить', callback_data: 'tprev_go' },
              { text: '✏️ Переписать', callback_data: 'tprev_redo' },
              { text: '❌ Отмена', callback_data: 'tprev_no' },
            ],
          ]) });
        } catch { /* no-op */ }
        return res.status(200).json({ ok: true });
      }
      if (data === 'tprev_go' || data === 'tprev_redo' || data === 'tprev_no') {
        const sessP = await getSession(tgId);
        if (!sessP || sessP.state !== 'task_preview') { await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Черновик устарел — создай задачу заново' }); return res.status(200).json({ ok: true }); }
        const { evId, raw, title, needsCar, targetTime } = sessP.context || {};
        await clearSession(tgId);
        try { await tg('editMessageReplyMarkup', { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [] } }); } catch { /* no-op */ }
        if (data === 'tprev_no') { await tg('sendMessage', { chat_id: chatId, text: 'Ок, задачу не отправляю.' }); return res.status(200).json({ ok: true }); }
        if (data === 'tprev_redo') {
          await setSession(tgId, 'task_create', { evId });
          await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: '✏️ Напиши задачу заново (можно подробнее — я переоформлю).' });
          return res.status(200).json({ ok: true });
        }
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Отправляю…' });
        await taskCommit(evId, cq.from, chatId, String(raw || ''), String(title || ''), !!needsCar, String(targetTime || ''));
        return res.status(200).json({ ok: true });
      }

      if (data.startsWith('taketask_')) {
        const taskId = Number(data.slice('taketask_'.length));
        const { data: t } = await supabase.from('tasks').select('*').eq('id', taskId).maybeSingle();
        if (!t || (t as any).done) { await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Задача недоступна' }); return res.status(200).json({ ok: true }); }
        if ((t as any).taken_by) { await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Уже взяли' }); return res.status(200).json({ ok: true }); }
        await supabase.from('tasks').update({ taken_by: tgId }).eq('id', taskId);
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Взял в работу ✅' });
        
        // Кнопка «в календарь»: генерируем .ics-ссылку для добавления в календарь телефона.
        const taskTitle = esc((t as any).title || '').replace(/<[^>]*>/g, '');
        const calUrl = `https://www.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(taskTitle)}&details=${encodeURIComponent('Задача из Flint')}`;
        
        try { 
          await tg('editMessageReplyMarkup', { 
            chat_id: chatId, 
            message_id: msgId, 
            reply_markup: { 
              inline_keyboard: [
                [{ text: '✅ Сделано', callback_data: `donetask_${taskId}` }],
                [{ text: '📅 В календарь', url: calUrl }],
                [{ text: '↩️ Не смогу — верните в поиск', callback_data: `droptask_${taskId}` }]
              ] 
            } 
          }); 
        } catch { /* no-op */ }
        
        // Взявшему — полные детали (контакты/адрес из сырого текста): до взятия они скрыты.
        try {
          const { data: evT } = await supabase.from('events').select('logistics').eq('id', (t as any).event_id).maybeSingle();
          const raw = (evT as any)?.logistics?.task_raw?.[String(taskId)];
          if (raw && String(raw).trim() !== String((t as any).title).trim()) {
            await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `📇 <b>Детали задачи (контакты/адрес)</b>:\n${esc(String(raw))}\n\nНе сможешь — жми «↩️ Не смогу», найдём другого.`, reply_markup: kb([[{ text: '↩️ Не смогу', callback_data: `droptask_${taskId}` }]]) });
          }
        } catch { /* no-op */ }
        // Ставивший задачу — под контроль: узнаёт, кто взял.
        if ((t as any).created_by && Number((t as any).created_by) !== tgId) {
          try { await tg('sendMessage', { chat_id: (t as any).created_by, parse_mode: 'HTML', text: `🙋 <b>${esc(cq.from.first_name || 'Участник')}</b> взял задачу: «${esc((t as any).title)}». Отчитается, когда сделает.` }); } catch { /* no-op */ }
        }
        return res.status(200).json({ ok: true });
      }
      // Отказ взявшего: задача снова свободна → мгновенная перерассылка всем.
      if (data.startsWith('droptask_')) {
        const taskId = Number(data.slice('droptask_'.length));
        const { data: t } = await supabase.from('tasks').select('*').eq('id', taskId).maybeSingle();
        if (!t || (t as any).done) { await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Задача недоступна' }); return res.status(200).json({ ok: true }); }
        if (Number((t as any).taken_by) !== tgId) { await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Отказаться может тот, кто взял' }); return res.status(200).json({ ok: true }); }
        await supabase.from('tasks').update({ taken_by: null }).eq('id', taskId);
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Ок, задача снова в поиске' });
        try { await tg('editMessageReplyMarkup', { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [] } }); } catch { /* no-op */ }
        if ((t as any).created_by && Number((t as any).created_by) !== tgId) {
          try { await tg('sendMessage', { chat_id: (t as any).created_by, parse_mode: 'HTML', text: `↩️ ${esc(cq.from.first_name || 'Участник')} не сможет выполнить «${esc((t as any).title)}» — ищу нового исполнителя.` }); } catch { /* no-op */ }
        }
        const eligD = await pollEligible((t as any).event_id);
        await Promise.allSettled(eligD.filter((id) => id !== tgId).map((id) =>
          tg('sendMessage', { chat_id: id, parse_mode: 'HTML', text: `📋 <b>Задача снова свободна</b>: «${esc((t as any).title)}»\nИсполнитель отпал — выручай, если можешь!`, reply_markup: kb([[{ text: '🙋 Беру в работу', callback_data: `taketask_${taskId}` }]]) })
        ));
        return res.status(200).json({ ok: true });
      }
      if (data.startsWith('donetask_')) {
        const taskId = Number(data.slice('donetask_'.length));
        const { data: t } = await supabase.from('tasks').select('*').eq('id', taskId).maybeSingle();
        if (!t) { await tg('answerCallbackQuery', { callback_query_id: cq.id }); return res.status(200).json({ ok: true }); }
        if (Number((t as any).taken_by) !== tgId) { await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Отчитывается тот, кто взял' }); return res.status(200).json({ ok: true }); }
        // Не закрываем сразу: работу принимает тот, кто ставил задачу.
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Отправил на приёмку ✅' });
        try { await tg('editMessageReplyMarkup', { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [] } }); } catch { /* no-op */ }
        if ((t as any).created_by && Number((t as any).created_by) !== tgId) {
          await tg('sendMessage', { chat_id: chatId, text: '📨 Отправил постановщику на приёмку — он подтвердит или попросит доделать.' });
          try {
            await tg('sendMessage', {
              chat_id: (t as any).created_by, parse_mode: 'HTML',
              text: `📥 <b>${esc(cq.from.first_name || 'Исполнитель')}</b> отчитался по задаче: «${esc((t as any).title)}». Принять работу?`,
              reply_markup: kb([[
                { text: '✅ Принять', callback_data: `tacc_${taskId}` },
                { text: '🔁 Доделать', callback_data: `tfix_${taskId}` },
              ], [
                { text: '↩️ Вернуть в поиск', callback_data: `tfree_${taskId}` },
              ]]),
            });
          } catch { /* no-op */ }
        } else {
          // Свою же задачу закрываем сразу.
          await supabase.from('tasks').update({ done: true }).eq('id', taskId);
          await tg('sendMessage', { chat_id: chatId, text: '✅ Задача закрыта.' });
        }
        return res.status(200).json({ ok: true });
      }
      // Приёмка работ: только постановщик.
      if (data.startsWith('tacc_') || data.startsWith('tfix_') || data.startsWith('tfree_')) {
        const taskId = Number(data.slice(5));
        const { data: t } = await supabase.from('tasks').select('*').eq('id', taskId).maybeSingle();
        if (!t) { await tg('answerCallbackQuery', { callback_query_id: cq.id }); return res.status(200).json({ ok: true }); }
        if (Number((t as any).created_by) !== tgId && !(await isCore(tgId))) { await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Принимает постановщик задачи' }); return res.status(200).json({ ok: true }); }
        try { await tg('editMessageReplyMarkup', { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [] } }); } catch { /* no-op */ }
        const worker = Number((t as any).taken_by);
        if (data.startsWith('tacc_')) {
          await supabase.from('tasks').update({ done: true }).eq('id', taskId);
          await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Принято ✅' });
          if (worker) { try { await tg('sendMessage', { chat_id: worker, parse_mode: 'HTML', text: `🎉 Работа принята: «${esc((t as any).title)}». Спасибо!` }); } catch { /* no-op */ } }
        } else if (data.startsWith('tfix_')) {
          await tg('answerCallbackQuery', { callback_query_id: cq.id });
          await setSession(tgId, 'task_fix', { taskId });
          await tg('sendMessage', { chat_id: chatId, text: '🔁 Напиши, что именно доделать — передам исполнителю.' });
        } else {
          await supabase.from('tasks').update({ taken_by: null }).eq('id', taskId);
          await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Вернул в поиск' });
          if (worker) { try { await tg('sendMessage', { chat_id: worker, parse_mode: 'HTML', text: `↩️ Постановщик вернул задачу «${esc((t as any).title)}» в общий поиск.` }); } catch { /* no-op */ } }
          const eligF = await pollEligible((t as any).event_id);
          await Promise.allSettled(eligF.filter((id) => id !== tgId).map((id) =>
            tg('sendMessage', { chat_id: id, parse_mode: 'HTML', text: `📋 <b>Задача снова свободна</b>: «${esc((t as any).title)}»\nСтатус: не доделана предыдущим исполнителем — постановщик уточнит детали. Возьмёшь?`, reply_markup: kb([[{ text: '🙋 Беру в работу', callback_data: `taketask_${taskId}` }]]) })
          ));
        }
        return res.status(200).json({ ok: true });
      }
      if (data.startsWith('taskdel_')) {
        const taskId = Number(data.slice('taskdel_'.length));
        const { data: t } = await supabase.from('tasks').select('created_by').eq('id', taskId).maybeSingle();
        if (t && (Number((t as any).created_by) === tgId || await isCore(tgId))) {
          await supabase.from('tasks').delete().eq('id', taskId);
          await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Задача снята' });
          try { await tg('editMessageReplyMarkup', { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [] } }); } catch { /* no-op */ }
        } else { await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Снять может автор задачи' }); }
        return res.status(200).json({ ok: true });
      }

      // Список голосований события + кнопка предложить своё.
      if (data.startsWith('polls_')) {
        const evId = data.slice('polls_'.length);
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        const { data: polls } = await supabase
          .from('polls').select('id,question,options').eq('event_id', evId).order('id', { ascending: false }).limit(10);
        const rows: any[] = [];
        for (const p of polls || []) {
          const opts = (p as any).options || {};
          const st = opts.status === 'decided' ? '✅' : opts.status === 'expired' ? '⌛' : '🗳';
          rows.push([{ text: `${st} ${(p as any).question}`.slice(0, 60), callback_data: `pshow_${(p as any).id}` }]);
        }
        rows.push([{ text: '➕ Предложить голосование', callback_data: `pollnew_${evId}` }]);
        await tg('sendMessage', {
          chat_id: chatId, parse_mode: 'HTML',
          text: rows.length > 1 ? '🗳 <b>Голосования события</b>\nВыбери, чтобы посмотреть, или предложи своё:' : '🗳 <b>Голосований пока нет</b>\nПредложи первое — я сам оформлю его в вопрос с вариантами.',
          reply_markup: kb(rows),
        });
        return res.status(200).json({ ok: true });
      }
      // Предложить голосование: свободный текст → ИИ оформит.
      if (data.startsWith('pollnew_')) {
        const evId = data.slice('pollnew_'.length);
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        // Право предлагать — у зарегистрированных на событие.
        const elig = await pollEligible(evId);
        if (!elig.includes(tgId) && !(await isCore(tgId))) {
          await tg('sendMessage', { chat_id: chatId, text: 'Предлагать голосование могут участники события. Сначала запишись 🙌' });
          return res.status(200).json({ ok: true });
        }
        await setSession(tgId, 'poll_create', { evId });
        await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: '🗳 Напиши свободно, что предлагаешь и по поводу чего голосуем.\n<i>Например: «Предлагаю кино ночью у костра — у меня есть проектор и экран. Смотрим?»</i>' });
        return res.status(200).json({ ok: true });
      }
      // Показать голосование (свежие цифры).
      if (data.startsWith('pshow_')) {
        const pollId = Number(data.slice('pshow_'.length));
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        const { data: poll } = await supabase.from('polls').select('*').eq('id', pollId).maybeSingle();
        if (!poll) return res.status(200).json({ ok: true });
        const opts = (poll as any).options || {};
        const list: string[] = opts.list || [];
        const { counts } = await pollTally(pollId, list.length);
        const closed = opts.status === 'decided' || opts.status === 'expired';
        const ev = await getEvent((poll as any).event_id);
        await tg('sendMessage', {
          chat_id: chatId, parse_mode: 'HTML',
          text: `🗳 <b>${esc((poll as any).question)}</b>\n${opts.summary ? `<i>${esc(opts.summary)}</i>\n` : ''}${closed && opts.winner != null ? `\n✅ Решено: <b>${esc(list[opts.winner] || '')}</b>` : ''}`,
          reply_markup: pollKeyboard(pollId, list, counts, closed),
        });
        return res.status(200).json({ ok: true });
      }
      if (data.startsWith('pnoop_')) { await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Голосование завершено' }); return res.status(200).json({ ok: true }); }
      // Добавить свой вариант в открытое голосование (Иван предлагает ещё фильм).
      if (data.startsWith('padd_')) {
        const pollId = Number(data.slice('padd_'.length));
        const { data: poll } = await supabase.from('polls').select('event_id,options').eq('id', pollId).maybeSingle();
        if (!poll) { await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Голосование не найдено' }); return res.status(200).json({ ok: true }); }
        const opts = (poll as any).options || {};
        if (opts.status && opts.status !== 'open') { await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Голосование уже завершено' }); return res.status(200).json({ ok: true }); }
        const elig = await pollEligible((poll as any).event_id);
        if (!elig.includes(tgId) && !(await isCore(tgId))) { await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Добавлять могут участники события' }); return res.status(200).json({ ok: true }); }
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        await setSession(tgId, 'poll_addopt', { pollId });
        await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: '➕ Напиши свой вариант одной строкой — добавлю в голосование, и участники смогут за него проголосовать.\n<i>Например: «Фильм Начало»</i>' });
        return res.status(200).json({ ok: true });
      }
      // Обновить программу под решение голосования (одним тапом, ИИ).
      if (data.startsWith('pprog_')) {
        const pollId = Number(data.slice('pprog_'.length));
        if (!(await isCore(tgId))) { await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Только для костяка клуба' }); return res.status(200).json({ ok: true }); }
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Обновляю программу…' });
        const { data: poll } = await supabase.from('polls').select('*').eq('id', pollId).maybeSingle();
        if (!poll) return res.status(200).json({ ok: true });
        const opts = (poll as any).options || {};
        const list: string[] = opts.list || [];
        const winner = opts.winner != null ? list[opts.winner] : null;
        const ev = await getEvent((poll as any).event_id);
        if (!ev || !winner) { await tg('sendMessage', { chat_id: chatId, text: 'Нет решения для обновления программы.' }); return res.status(200).json({ ok: true }); }
        try {
          const r = await fetch(`${site}/api/ai`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.ADMIN_TOKEN || ''}` },
            body: JSON.stringify({
              task: 'program', event: ev, people: ev.max_participants,
              current: ev.program || [],
              instruction: `Участники проголосовали: «${(poll as any).question}» → решение «${winner}». Впиши это в программу события в нужный день/время (если это активность — добавь пунктом с временем), сохранив остальные пункты. Не ломай существующее.`,
            }),
          });
          const j = await r.json();
          if (Array.isArray(j.program) && j.program.length) {
            await supabase.from('events').update({ program: j.program }).eq('id', (poll as any).event_id);
            // Рассылаем обновление зарегистрированным.
            const elig = await pollEligible((poll as any).event_id);
            for (const id of elig) {
              try { await tg('sendMessage', { chat_id: id, parse_mode: 'HTML', text: `📋 <b>Программа обновлена</b> по итогам голосования «${esc(winner)}»:\n\n${j.program.map((s: string) => `• ${esc(s)}`).join('\n')}` }); } catch { /* no-op */ }
            }
            await tg('sendMessage', { chat_id: chatId, text: '✅ Программа обновлена и разослана участникам.' });
          } else {
            await tg('sendMessage', { chat_id: chatId, text: 'ИИ не смог обновить программу, поправь вручную в админке.' });
          }
        } catch { await tg('sendMessage', { chat_id: chatId, text: 'Ошибка обновления программы.' }); }
        return res.status(200).json({ ok: true });
      }
      // Голос за вариант.
      if (data.startsWith('pv_')) {
        const rest = data.slice('pv_'.length);
        const us = rest.lastIndexOf('_');
        const pollId = Number(rest.slice(0, us));
        const choice = Number(rest.slice(us + 1));
        const { data: poll } = await supabase.from('polls').select('*').eq('id', pollId).maybeSingle();
        if (!poll) { await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Голосование не найдено' }); return res.status(200).json({ ok: true }); }
        const opts = (poll as any).options || {};
        const list: string[] = opts.list || [];
        if (opts.status === 'decided' || opts.status === 'expired') { await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Голосование уже завершено' }); return res.status(200).json({ ok: true }); }
        const eligible = await pollEligible((poll as any).event_id);
        if (!eligible.includes(tgId)) { await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Голосуют только участники события' }); return res.status(200).json({ ok: true }); }
        await supabase.from('poll_votes').upsert({ poll_id: pollId, telegram_id: tgId, choice }, { onConflict: 'poll_id,telegram_id' });
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: `Голос за «${list[choice] || ''}» учтён ✅` });
        const { counts } = await pollTally(pollId, list.length);
        // Автопринятие: вариант набрал больше половины имеющих право голоса.
        const winIdx = counts.findIndex((c) => c > eligible.length / 2);
        if (winIdx >= 0) {
          await supabase.from('polls').update({ options: { ...opts, status: 'decided', winner: winIdx } }).eq('id', pollId);
          const ev = await getEvent((poll as any).event_id);
          for (const id of eligible) {
            try {
              await tg('sendMessage', { chat_id: id, parse_mode: 'HTML', text: `✅ <b>Решено!</b> «${esc((poll as any).question)}»\n\nПобедил вариант: <b>${esc(list[winIdx])}</b> (${counts[winIdx]} из ${eligible.length}).` });
            } catch { /* no-op */ }
          }
          if (ADMIN_CHAT_ID) await tg('sendMessage', { chat_id: ADMIN_CHAT_ID, parse_mode: 'HTML', text: `🗳 Голосование закрыто по кворуму: «${esc((poll as any).question)}» → <b>${esc(list[winIdx])}</b>.`, reply_markup: kb([[{ text: '🔄 Обновить программу под решение', callback_data: `pprog_${pollId}` }], [{ text: '↩️ Возобновить голосование', callback_data: `preopen_${pollId}` }]]) });
        } else {
          try { await tg('editMessageReplyMarkup', { chat_id: chatId, message_id: msgId, reply_markup: pollKeyboard(pollId, list, counts, false) }); } catch { /* no-op */ }
        }
        return res.status(200).json({ ok: true });
      }
      // Закрыть голосование вручную (создатель или костяк) — побеждает лидер.
      if (data.startsWith('pclose_')) {
        const pollId = Number(data.slice('pclose_'.length));
        const { data: poll } = await supabase.from('polls').select('*').eq('id', pollId).maybeSingle();
        if (!poll) { await tg('answerCallbackQuery', { callback_query_id: cq.id }); return res.status(200).json({ ok: true }); }
        if (Number((poll as any).created_by) !== tgId && !(await isCore(tgId))) {
          await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Закрыть может автор голосования или костяк' });
          return res.status(200).json({ ok: true });
        }
        const opts = (poll as any).options || {};
        const list: string[] = opts.list || [];
        const { counts } = await pollTally(pollId, list.length);
        let winIdx = 0;
        for (let i = 1; i < counts.length; i++) if (counts[i] > counts[winIdx]) winIdx = i;
        await supabase.from('polls').update({ options: { ...opts, status: 'decided', winner: winIdx } }).eq('id', pollId);
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Голосование закрыто' });
        const eligible = await pollEligible((poll as any).event_id);
        for (const id of eligible) {
          try { await tg('sendMessage', { chat_id: id, parse_mode: 'HTML', text: `✅ <b>Итог голосования</b> «${esc((poll as any).question)}»\n\nПобедил: <b>${esc(list[winIdx] || '—')}</b> (${counts[winIdx] || 0} из ${eligible.length}).` }); } catch { /* no-op */ }
        }
        // Костяку — одним тапом обновить программу под решение (или переоткрыть,
        // если закрыли поспешно и итог не тот).
        if (ADMIN_CHAT_ID && counts[winIdx] > 0) {
          try { await tg('sendMessage', { chat_id: ADMIN_CHAT_ID, parse_mode: 'HTML', text: `🗳 Итог: «${esc((poll as any).question)}» → <b>${esc(list[winIdx])}</b>.`, reply_markup: kb([[{ text: '🔄 Обновить программу под решение', callback_data: `pprog_${pollId}` }], [{ text: '↩️ Возобновить голосование', callback_data: `preopen_${pollId}` }]]) }); } catch { /* no-op */ }
        }
        return res.status(200).json({ ok: true });
      }
      // Возобновить закрытое голосование: сброс итога и голосов, свежая рассылка.
      // Спасает, когда закрыли поспешно или решение изменилось.
      if (data.startsWith('preopen_')) {
        const pollId = Number(data.slice('preopen_'.length));
        const { data: poll } = await supabase.from('polls').select('*').eq('id', pollId).maybeSingle();
        if (!poll) { await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Голосование не найдено' }); return res.status(200).json({ ok: true }); }
        if (Number((poll as any).created_by) !== tgId && !(await isCore(tgId))) {
          await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Возобновить может автор голосования или костяк' });
          return res.status(200).json({ ok: true });
        }
        const opts = (poll as any).options || {};
        if (!opts.status || opts.status === 'open') { await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Голосование и так открыто' }); return res.status(200).json({ ok: true }); }
        // Голоса чистим: переоткрытие = переголосование с чистого листа.
        await supabase.from('poll_votes').delete().eq('poll_id', pollId);
        const deadline = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
        await supabase.from('polls').update({ options: { ...opts, status: 'open', winner: null }, deadline }).eq('id', pollId);
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Голосование возобновлено' });
        const ev = await getEvent((poll as any).event_id);
        const eligible = await pollEligible((poll as any).event_id);
        for (const id of eligible) {
          try { await tg('sendMessage', { chat_id: id, parse_mode: 'HTML', text: `↩️ <b>Голосование возобновлено</b> — прежний итог отменён, голосуем заново:` }); } catch { /* no-op */ }
        }
        await broadcastPoll(pollId, { event_id: (poll as any).event_id, question: (poll as any).question, options: { ...opts, status: 'open', winner: null } }, ev?.title || 'событие');
        await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `↩️ Голосование «${esc((poll as any).question)}» возобновлено: голоса сброшены, участники получили свежую рассылку. Дедлайн — через 24 часа.` });
        return res.status(200).json({ ok: true });
      }

      // Просмотр расходов — доступен любому участнику (не только админу).
      if (data.startsWith('expview_')) {
        const evId = data.slice('expview_'.length);
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        const { data: evRow } = await supabase.from('events').select('title,shopping').eq('id', evId).maybeSingle();
        const expenses = Array.isArray((evRow as any)?.shopping?.expenses) ? (evRow as any).shopping.expenses : [];
        if (!expenses.length) { await tg('sendMessage', { chat_id: chatId, text: '💸 Расходов пока нет. Добавь свой — «💸 Добавить расход».' }); return res.status(200).json({ ok: true }); }
        const total = expenses.reduce((s: number, e: any) => s + (Number(e.amount) || 0), 0);
        const lines = expenses.map((e: any) => `• ${esc(e.title)} — <b>${e.amount} BYN</b> (${esc(e.by_name || '')}${e.photo ? ', с чеком' : ''})`).join('\n');
        await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `📊 <b>Расходы — «${esc((evRow as any)?.title || '')}»</b>\n\n${lines}\n\nИтого: <b>${Math.round(total * 100) / 100} BYN</b>\n\nДоли посчитаем при подведении итогов — каждый платит за себя и своих гостей.` });
        return res.status(200).json({ ok: true });
      }
      // Мои гости: логистика — выбрать водителя, чтобы забрать гостя по пути.
      if (data.startsWith('gpick_')) {
        const evId = data.slice('gpick_'.length);
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        const { data: cars } = await supabase
          .from('rides').select('id,driver_name,from_point,depart_text,seats_total,seats_taken')
          .eq('event_id', evId).eq('active', true).neq('kind', 'tent');
        const rows: any[] = (cars || []).map((c: any) => [{ text: `🚗 ${c.driver_name || 'Водитель'} · ${c.from_point || '—'} · ${c.depart_text || ''}`.slice(0, 60), callback_data: `gpickr_${c.id}` }]);
        if (!rows.length) {
          await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: '🚗 Пока никто не заявил машину. Как появятся — вернись сюда, попросишь забрать гостя. За гостей отвечаешь ты: рассади их и договорись по посадке.' });
          return res.status(200).json({ ok: true });
        }
        rows.unshift([{ text: '🚗 Посадить гостя в машину', callback_data: `gseat_${evId}` }]);
        await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: '👥 <b>Логистика гостей</b>\nПосади гостя в машину (займёт место) или попроси водителя забрать его по пути. За гостей отвечаешь ты.', reply_markup: kb(rows) });
        return res.status(200).json({ ok: true });
      }
      // Рассадка гостей: показать машины со свободными местами + уже посаженных.
      if (data.startsWith('gseat_')) {
        const evId = data.slice('gseat_'.length);
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        const { data: myReg } = await supabase.from('registrations').select('guest_count').eq('event_id', evId).eq('telegram_id', tgId).neq('status', 'cancelled').maybeSingle();
        const gc = Number((myReg as any)?.guest_count) || 0;
        if (!gc) { await tg('sendMessage', { chat_id: chatId, text: 'У тебя нет записанных гостей.' }); return res.status(200).json({ ok: true }); }
        const { data: cars } = await supabase.from('rides').select('id,driver_name,from_point,depart_text,seats_total,seats_taken').eq('event_id', evId).eq('active', true).neq('kind', 'tent');
        const carIds = (cars || []).map((c: any) => c.id);
        // Мои гости: синтетические id -(tgId*1000 + k), k=1..gc.
        const lo = -(tgId * 1000 + gc), hi = -(tgId * 1000 + 1);
        const { data: mine } = carIds.length
          ? await supabase.from('ride_bookings').select('ride_id,passenger_id,passenger_name').in('ride_id', carIds).gte('passenger_id', lo).lte('passenger_id', hi)
          : { data: [] as any[] };
        const seatedK = new Set((mine || []).map((b: any) => -Number(b.passenger_id) - tgId * 1000));
        const lines: string[] = (mine || []).map((b: any) => {
          const car = (cars || []).find((c: any) => c.id === b.ride_id);
          return `• ${esc(b.passenger_name || 'Гость')} → 🚗 ${esc(car?.driver_name || '')}`;
        });
        const rows: any[] = (cars || []).filter((c: any) => (c.seats_total || 0) > (c.seats_taken || 0))
          .map((c: any) => [{ text: `🚗 ${c.driver_name || 'Водитель'} — ${Math.max(0, (c.seats_total || 0) - (c.seats_taken || 0))} мест`.slice(0, 60), callback_data: `gseatr_${c.id}` }]);
        // Кнопки снять гостя с места.
        for (const b of mine || []) rows.push([{ text: `❌ Снять ${(b.passenger_name || 'гостя')}`.slice(0, 55), callback_data: `gunseat_${b.ride_id}_${-Number(b.passenger_id) - tgId * 1000}` }]);
        const remain = gc - seatedK.size;
        await tg('sendMessage', {
          chat_id: chatId, parse_mode: 'HTML',
          text: `🚗 <b>Рассадка гостей</b> (${seatedK.size}/${gc} посажено)\n${lines.length ? lines.join('\n') + '\n' : ''}${remain > 0 ? `\nОсталось рассадить: <b>${remain}</b>. Выбери машину:` : '\n✅ Все гости рассажены.'}`,
          reply_markup: rows.length ? kb(rows) : undefined,
        });
        return res.status(200).json({ ok: true });
      }
      // Посадить следующего нерассаженного гостя в выбранную машину.
      if (data.startsWith('gseatr_')) {
        const rideId = Number(data.slice('gseatr_'.length));
        const { data: ride } = await supabase.from('rides').select('event_id,driver_id,driver_name').eq('id', rideId).maybeSingle();
        if (!ride) { await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Машина не найдена' }); return res.status(200).json({ ok: true }); }
        const evId = (ride as any).event_id;
        const { data: myReg } = await supabase.from('registrations').select('guest_count').eq('event_id', evId).eq('telegram_id', tgId).neq('status', 'cancelled').maybeSingle();
        const gc = Number((myReg as any)?.guest_count) || 0;
        const { data: cars } = await supabase.from('rides').select('id').eq('event_id', evId);
        const carIds = (cars || []).map((c: any) => c.id);
        const lo = -(tgId * 1000 + gc), hi = -(tgId * 1000 + 1);
        const { data: mine } = await supabase.from('ride_bookings').select('passenger_id').in('ride_id', carIds).gte('passenger_id', lo).lte('passenger_id', hi);
        const seatedK = new Set((mine || []).map((b: any) => -Number(b.passenger_id) - tgId * 1000));
        let k = 0; for (let i = 1; i <= gc; i++) if (!seatedK.has(i)) { k = i; break; }
        if (!k) { await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Все гости уже рассажены' }); return res.status(200).json({ ok: true }); }
        const guestPid = -(tgId * 1000 + k);
        const name = `Гость ${k} (${cq.from.first_name || 'отв.'})`;
        const { data: outcome } = await supabase.rpc('book_ride_seat', { p_ride_id: rideId, p_passenger: guestPid, p_name: name });
        if (outcome !== 'ok') { await tg('answerCallbackQuery', { callback_query_id: cq.id, text: outcome === 'full' ? 'Мест нет' : 'Не вышло' }); return res.status(200).json({ ok: true }); }
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: `Гость посажен к ${(ride as any).driver_name || 'водителю'} ✅` });
        try { await tg('sendMessage', { chat_id: (ride as any).driver_id, parse_mode: 'HTML', text: `👥 ${esc(cq.from.first_name || 'Участник')} посадил своего гостя в твою машину (${esc(name)}). За гостя отвечает он${cq.from.username ? ` @${esc(cq.from.username)}` : ''}.` }); } catch { /* no-op */ }
        await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `✅ Посадил <b>${esc(name)}</b> к ${esc((ride as any).driver_name || 'водителю')}. Открой «🚗 Посадить гостя» ещё раз для следующего.` });
        return res.status(200).json({ ok: true });
      }
      // Снять гостя с места.
      if (data.startsWith('gunseat_')) {
        const rest = data.slice('gunseat_'.length);
        const us = rest.indexOf('_');
        const rideId = Number(rest.slice(0, us));
        const k = Number(rest.slice(us + 1));
        const guestPid = -(tgId * 1000 + k);
        const { data: outcome } = await supabase.rpc('cancel_ride_seat', { p_ride_id: rideId, p_passenger: guestPid });
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: outcome === 'ok' ? 'Гость снят с места' : 'Не найдено' });
        const { data: ride } = await supabase.from('rides').select('driver_id').eq('id', rideId).maybeSingle();
        if (ride && outcome === 'ok') { try { await tg('sendMessage', { chat_id: (ride as any).driver_id, text: `👥 ${cq.from.first_name || 'Участник'} снял своего гостя с места в твоей машине.` }); } catch { /* no-op */ } }
        return res.status(200).json({ ok: true });
      }
      if (data.startsWith('gpickr_')) {
        const rideId = Number(data.slice('gpickr_'.length));
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        await setSession(tgId, 'guest_pickup', { rideId });
        await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: '👥 Напиши одной строкой: <b>имя гостя, откуда забрать (адрес или координаты), во сколько</b>.\n<i>Например: «Гость Дима, ул. Притыцкого 101, 08:30» или пришли геопозицию отдельным сообщением после.</i>' });
        return res.status(200).json({ ok: true });
      }
      if (data.startsWith('gpyes_') || data.startsWith('gpno_')) {
        const yes = data.startsWith('gpyes_');
        const rest = data.slice(yes ? 6 : 5);
        const us = rest.indexOf('_');
        const respId = Number(rest.slice(0, us));
        const rideId = Number(rest.slice(us + 1));
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: yes ? 'Передал ответственному ✅' : 'Передал ответственному' });
        try { await tg('editMessageReplyMarkup', { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [] } }); } catch { /* no-op */ }
        const { data: ride } = await supabase.from('rides').select('driver_name,from_point,depart_text').eq('id', rideId).maybeSingle();
        try {
          await tg('sendMessage', { chat_id: respId, parse_mode: 'HTML', text: yes
            ? `✅ <b>${esc((ride as any)?.driver_name || 'Водитель')} заберёт твоего гостя!</b> Скинь гостю контакт водителя и точное время. Ответственность за посадку — на тебе.`
            : `😔 ${esc((ride as any)?.driver_name || 'Водитель')} не сможет забрать гостя. Выбери другого водителя в «👥 Мои гости» или организуй иначе.` });
        } catch { /* no-op */ }
        return res.status(200).json({ ok: true });
      }

      // Добавить общий расход (чек): «Мясо 45.50» → фото чека → рассылка всем.
      if (data.startsWith('expadd_')) {
        const evId = data.slice('expadd_'.length);
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        // Проверяем, есть ли у пользователя сохранённые платёжные предпочтения
        const { data: memPrefs } = await supabase.from('members').select('prefs').eq('telegram_id', tgId).maybeSingle();
        const paymentPrefs = (memPrefs as any)?.prefs?.payment;
        if (paymentPrefs && paymentPrefs.method) {
          // Уже есть — сразу переходим к вводу расхода
          await setSession(tgId, 'exp_add', { evId, payment: paymentPrefs });
          await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: '💸 Что купил(а) и на какую сумму? Напиши одной строкой: название и сумма в BYN.\n<i>Например: «Мясо 45.50» или «Угли и розжиг 18»</i>' });
        } else {
          // Спрашиваем способ оплаты в первый раз
          await setSession(tgId, 'exp_payment_method', { evId });
          await tg('sendMessage', {
            chat_id: chatId, parse_mode: 'HTML',
            text: '💳 <b>Как тебе удобнее получать деньги?</b>\n\nВыбери способ — я запомню и буду предлагать его в следующих расходах. Потом можно изменить в /profile.',
            reply_markup: kb([
              [{ text: '💵 Наличные', callback_data: 'paymethod_cash' }],
              [{ text: '💳 На карту', callback_data: 'paymethod_card' }],
            ]),
          });
        }
        return res.status(200).json({ ok: true });
      }

      // Выбор способа оплаты: наличные
      if (data === 'paymethod_cash') {
        const sess = await getSession(tgId);
        if (!sess || sess.state !== 'exp_payment_method') { await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Черновик устарел' }); return res.status(200).json({ ok: true }); }
        const evId = sess.context?.evId;
        // Сохраняем в prefs
        await supabase.from('members').update({
          prefs: { payment: { method: 'cash' } }
        }).eq('telegram_id', tgId);
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Запомнил: наличные' });
        await setSession(tgId, 'exp_add', { evId, payment: { method: 'cash' } });
        await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: '💸 Что купил(а) и на какую сумму? Напиши одной строкой: название и сумма в BYN.\n<i>Например: «Мясо 45.50» или «Угли и розжиг 18»</i>' });
        return res.status(200).json({ ok: true });
      }

      // Выбор способа оплаты: на карту → просим реквизиты
      if (data === 'paymethod_card') {
        const sess = await getSession(tgId);
        if (!sess || sess.state !== 'exp_payment_method') { await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Черновик устарел' }); return res.status(200).json({ ok: true }); }
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        await setSession(tgId, 'paymethod_card_details', { evId: sess.context?.evId });
        await tg('sendMessage', {
          chat_id: chatId, parse_mode: 'HTML',
          text: '💳 <b>Куда переводить?</b>\n\nНапиши реквизиты одной строкой:\n• <b>Номер телефона</b> (Альфа-Банк, например +375291234567)\n• Или <b>номер карты</b>\n• Или <b>лицевой счёт</b>\n\n<i>Пример: +375291234567 (Альфа-Банк)</i>',
        });
        return res.status(200).json({ ok: true });
      }

      // Расход (несколько позиций): делим на всех / на выбранных
      if (data === 'expallmulti' || data === 'exppickmulti') {
        const sessM = await getSession(tgId);
        if (!sessM || sessM.state !== 'exp_multi_split') { await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Черновик устарел' }); return res.status(200).json({ ok: true }); }
        const ctxM: any = sessM.context || {};
        const evId = ctxM.evId;
        const items = ctxM.items || [];
        if (data === 'expallmulti') {
          // Запоминаем выбор "на всех" для этого пользователя на этом событии
          try {
            const { data: evRow } = await supabase.from('events').select('shopping').eq('id', evId).maybeSingle();
            const shopping = (evRow as any)?.shopping || {};
            const defaults = shopping.split_defaults || {};
            defaults[String(tgId)] = 'all';
            await supabase.from('events').update({ shopping: { ...shopping, split_defaults: defaults } }).eq('id', evId);
          } catch { /* no-op */ }
          await clearSession(tgId);
          await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Рассылаю…' });
          for (const item of items) {
            await saveAndBroadcastExpense(evId, cq.from, item.title, item.amount, null);
          }
          const summary = items.map((i: any) => `• ${esc(i.title)} — <b>${i.amount} BYN</b>`).join('\n');
          const total = items.reduce((s: number, i: any) => s + i.amount, 0);
          await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `✅ <b>${items.length} позиций сохранены и разосланы:</b>\n\n${summary}\n\nИтого: <b>${total} BYN</b>\n\nДоли посчитаем при подведении итогов — каждый платит за себя и своих гостей.` });
          return res.status(200).json({ ok: true });
        }
        if (data === 'exppickmulti') {
          // Показываем чекбоксы для выбора людей
          const { data: regsE } = await supabase
            .from('registrations').select('telegram_id,name').eq('event_id', evId).neq('status', 'cancelled');
          const rowsE: any[] = (regsE || [])
            .filter((r: any) => Number(r.telegram_id) > 0)
            .slice(0, 20)
            .map((r: any) => [{ text: `⬜ ${r.name || r.telegram_id}`.slice(0, 40), callback_data: `exptgmulti_${r.telegram_id}` }]);
          rowsE.push([{ text: `✅ Готово (0)`, callback_data: 'expdonemulti' }]);
          await tg('answerCallbackQuery', { callback_query_id: cq.id });
          try { await tg('editMessageReplyMarkup', { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: rowsE } }); }
          catch {
            await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: '☑️ Отметь, кто скидывается:', reply_markup: { inline_keyboard: rowsE } });
          }
          return res.status(200).json({ ok: true });
        }
      }

      // Выбор людей для нескольких расходов (чекбоксы)
      if (data.startsWith('exptgmulti_') || data === 'expdonemulti') {
        const sessM = await getSession(tgId);
        if (!sessM || sessM.state !== 'exp_multi_split') { await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Черновик устарел' }); return res.status(200).json({ ok: true }); }
        const ctxM: any = sessM.context || {};
        const evId = ctxM.evId;
        const items = ctxM.items || [];
        let picked: number[] = (ctxM.picked || []).map(Number);
        if (data.startsWith('exptgmulti_')) {
          const id = Number(data.slice('exptgmulti_'.length));
          picked = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
          await setSession(tgId, 'exp_multi_split', { ...ctxM, picked });
          const { data: regsE } = await supabase
            .from('registrations').select('telegram_id,name').eq('event_id', evId).neq('status', 'cancelled');
          const rowsE: any[] = (regsE || [])
            .filter((r: any) => Number(r.telegram_id) > 0)
            .slice(0, 20)
            .map((r: any) => [{ text: `${picked.includes(Number(r.telegram_id)) ? '☑️' : '⬜'} ${r.name || r.telegram_id}`.slice(0, 40), callback_data: `exptgmulti_${r.telegram_id}` }]);
          rowsE.push([{ text: `✅ Готово (${picked.length})`, callback_data: 'expdonemulti' }]);
          await tg('answerCallbackQuery', { callback_query_id: cq.id });
          try { await tg('editMessageReplyMarkup', { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: rowsE } }); } catch { /* no-op */ }
          return res.status(200).json({ ok: true });
        }
        if (data === 'expdonemulti') {
          await clearSession(tgId);
          await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Рассылаю…' });
          for (const item of items) {
            await saveAndBroadcastExpense(evId, cq.from, item.title, item.amount, null, picked.length ? picked : undefined);
          }
          const summary = items.map((i: any) => `• ${esc(i.title)} — <b>${i.amount} BYN</b>`).join('\n');
          const total = items.reduce((s: number, i: any) => s + i.amount, 0);
          await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `✅ <b>${items.length} позиций сохранены и разосланы:</b>\n\n${summary}\n\nИтого: <b>${total} BYN</b>\n\nДоли посчитаем при подведении итогов — каждый платит за себя и своих гостей.` });
          return res.status(200).json({ ok: true });
        }
      }

      // Расход (одна позиция): делим на всех / на выбранных (чекбоксы по зарегистрированным).
      if (data === 'expall' || data === 'exppick' || data === 'expdone' || data === 'expext' || data.startsWith('exptg_')) {
        const sessE = await getSession(tgId);
        if (!sessE || sessE.state !== 'exp_split_pick') { await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Черновик расхода устарел' }); return res.status(200).json({ ok: true }); }
        const ctxE: any = sessE.context || {};
        if (data === 'expall' || data === 'expdone') {
          await clearSession(tgId);
          await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Рассылаю…' });
          const share = data === 'expdone' ? (ctxE.picked || []).map(Number) : undefined;
          const sent = await saveAndBroadcastExpense(ctxE.evId, cq.from, String(ctxE.title || 'Покупка'), Number(ctxE.amount) || 0, ctxE.photo || null, share, ctxE.extra || '');
          await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `✅ Расход разослан (${sent} чел.${ctxE.extra ? `, + вне списка: ${esc(ctxE.extra)}` : ''}). Доли — при финальном сплите.` });
          return res.status(200).json({ ok: true });
        }
        if (data === 'expext') {
          await setSession(tgId, 'exp_extra', ctxE);
          await tg('answerCallbackQuery', { callback_query_id: cq.id });
          await tg('sendMessage', { chat_id: chatId, text: '➕ Впиши через запятую, кто ещё скидывается (незарегистрированные, напр. «Дима — гость Андрея, Оля»).' });
          return res.status(200).json({ ok: true });
        }
        // exppick / exptg_: чекбокс-список зарегистрированных.
        let picked: number[] = (ctxE.picked || []).map(Number);
        if (data.startsWith('exptg_')) {
          const id = Number(data.slice('exptg_'.length));
          picked = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
          await setSession(tgId, 'exp_split_pick', { ...ctxE, picked });
        }
        const { data: regsE } = await supabase
          .from('registrations').select('telegram_id,name').eq('event_id', ctxE.evId).neq('status', 'cancelled');
        const rowsE: any[] = (regsE || [])
          .filter((r: any) => Number(r.telegram_id) > 0)
          .slice(0, 20)
          .map((r: any) => [{ text: `${picked.includes(Number(r.telegram_id)) ? '☑️' : '⬜'} ${r.name || r.telegram_id}`.slice(0, 40), callback_data: `exptg_${r.telegram_id}` }]);
        rowsE.push([{ text: '➕ Вписать вне списка', callback_data: 'expext' }]);
        rowsE.push([{ text: `✅ Готово (${picked.length})`, callback_data: 'expdone' }]);
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        try { await tg('editMessageReplyMarkup', { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: rowsE } }); }
        catch {
          await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: '☑️ Отметь, кто скидывается:', reply_markup: { inline_keyboard: rowsE } });
        }
        return res.status(200).json({ ok: true });
      }

      // Отказ от конкретной позиции расхода — не делим её на этого участника.
      if (data.startsWith('expout_')) {
        const rest = data.slice('expout_'.length);
        const us = rest.lastIndexOf('_');
        const evId = rest.slice(0, us);
        const expId = rest.slice(us + 1);
        try {
          const { data: evRow } = await supabase.from('events').select('shopping').eq('id', evId).maybeSingle();
          const shopping = (evRow as any)?.shopping || {};
          const expenses = Array.isArray(shopping.expenses) ? shopping.expenses : [];
          const exp = expenses.find((x: any) => String(x.id) === expId);
          if (exp) {
            const optout = Array.isArray(exp.optout) ? exp.optout : [];
            if (!optout.includes(tgId)) exp.optout = [...optout, tgId];
            await supabase.from('events').update({ shopping: { ...shopping, expenses } }).eq('id', evId);
            await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Ок, эту позицию на тебя не делим' });
            if (ADMIN_CHAT_ID) {
              await tg('sendMessage', { chat_id: ADMIN_CHAT_ID, parse_mode: 'HTML', text: `🚫 ${esc(cq.from.first_name || 'Участник')} отказался скидываться: «${esc(exp.title || '')}» (${exp.amount} BYN)` });
            }
          } else {
            await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Позиция не найдена' });
          }
        } catch { await tg('answerCallbackQuery', { callback_query_id: cq.id }); }
        return res.status(200).json({ ok: true });
      }

      // Панель организатора (все adm*-кнопки — только для костяка).
      if (data === 'admhome' || data === 'admmeetgo' || data === 'admproggo' || data.startsWith('admprog_') || data.startsWith('adm_') || data.startsWith('admsplit_') || data.startsWith('admdebt_') || data.startsWith('admping_') || data.startsWith('admpolls_') || data.startsWith('admreact_') || data.startsWith('admnudge_') || data.startsWith('admmeet_') || data.startsWith('admmeetman_')) {
        if (!(await isCore(tgId))) {
          await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Только для костяка клуба' });
          return res.status(200).json({ ok: true });
        }
        // Вход в панель с Главной: показываем список событий (как /admin).
        if (data === 'admhome') {
          await tg('answerCallbackQuery', { callback_query_id: cq.id });
          const { data: evs } = await supabase.from('events').select('id,title,date').eq('status', 'open').order('date').limit(8);
          if (!evs?.length) { await tg('sendMessage', { chat_id: chatId, text: 'Открытых событий нет.' }); return res.status(200).json({ ok: true }); }
          await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: '⚙️ <b>Панель организатора</b>\nВыбери событие:', reply_markup: kb(evs.map((e: any) => [{ text: `${e.title} · ${e.date}`, callback_data: `adm_${e.id}` }])) });
          return res.status(200).json({ ok: true });
        }
        if (data.startsWith('adm_')) {
          const evId = data.slice('adm_'.length);
          await tg('answerCallbackQuery', { callback_query_id: cq.id });
          await tg('sendMessage', {
            chat_id: chatId, parse_mode: 'HTML',
            text: '⚙️ <b>Что сделать?</b>',
            reply_markup: kb([
              [{ text: '💰 Разослать сплит расходов', callback_data: `admsplit_${evId}` }],
              [{ text: '💸 Должники (статусы)', callback_data: `admdebt_${evId}` }],
              [{ text: '🚩 Точка выезда', callback_data: `admmeet_${evId}` }],
              [{ text: '🏁 Точка прибытия', callback_data: `admarrival_${evId}` }],
              [{ text: '📋 Перегенерить программу → всем', callback_data: `admprog_${evId}` }],
              [{ text: '🗳 Статистика голосований', callback_data: `admpolls_${evId}` }],
              [{ text: '📊 Реакции на рассылку', callback_data: `admreact_${evId}` }],
              [{ text: '📋 Пингануть незаполнивших', callback_data: `admping_${evId}` }],
            ]),
          });
          return res.status(200).json({ ok: true });
        }
        if (data.startsWith('admsplit_')) {
          const evId = data.slice('admsplit_'.length);
          await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Считаю…' });
          // Переиспользуем admin API (там вся математика сплита) через Bearer.
          try {
            const r = await fetch(`${site}/api/admin/events?action=split_send`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.ADMIN_TOKEN || ''}` },
              body: JSON.stringify({ eventId: evId }),
            });
            const j = await r.json();
            await tg('sendMessage', {
              chat_id: chatId, parse_mode: 'HTML',
              text: j.ok
                ? `✅ Сплит разослан ${j.sent} участникам.\nВсего: <b>${j.total} BYN</b>\n\n${(j.transfers || []).map((s: string) => `• ${esc(s)}`).join('\n') || 'Переводы не нужны — все в расчёте.'}`
                : `⚠️ ${esc(j.error || 'Ошибка')}`,
            });
          } catch { await tg('sendMessage', { chat_id: chatId, text: 'Ошибка запуска сплита, попробуй из админки.' }); }
          return res.status(200).json({ ok: true });
        }
        if (data.startsWith('admdebt_')) {
          const evId = data.slice('admdebt_'.length);
          await tg('answerCallbackQuery', { callback_query_id: cq.id });
          const { data: evRow } = await supabase.from('events').select('title,shopping').eq('id', evId).maybeSingle();
          const trs: any[] = (evRow as any)?.shopping?.split?.transfers || [];
          const lines = trs.map((t: any) =>
            `${t.status === 'confirmed' ? '✅' : t.status === 'sent' ? '🔵' : '🟡'} ${esc(t.from_name)} → ${esc(t.to_name)}: <b>${t.amount} BYN</b> — ${t.status === 'confirmed' ? 'закрыт' : t.status === 'sent' ? 'ждёт подтверждения получателя' : 'висит'}`);
          await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: lines.length ? `💸 <b>Долги — «${esc((evRow as any)?.title || '')}»</b>\n\n${lines.join('\n')}` : 'Сплит ещё не рассылался — долгов нет.' });
          return res.status(200).json({ ok: true });
        }
        // Реакции на рассылку: кто подтвердил (confirmed), кто молчит, кто недоступен.
        if (data.startsWith('admreact_')) {
          const evId = data.slice('admreact_'.length);
          await tg('answerCallbackQuery', { callback_query_id: cq.id });
          const { data: regs } = await supabase
            .from('registrations').select('telegram_id,name,status').eq('event_id', evId).neq('status', 'cancelled');
          const real = (regs || []).filter((r: any) => Number(r.telegram_id) > 0);
          const ids = real.map((r: any) => Number(r.telegram_id));
          const { data: mem } = ids.length ? await supabase.from('members').select('telegram_id,bot_active').in('telegram_id', ids) : { data: [] as any[] };
          const activeMap = new Map((mem || []).map((m: any) => [Number(m.telegram_id), m.bot_active !== false]));
          const confirmed = real.filter((r: any) => r.status === 'confirmed');
          const silent = real.filter((r: any) => r.status !== 'confirmed');
          const blocked = real.filter((r: any) => activeMap.get(Number(r.telegram_id)) === false);
          const silentList = silent.map((r: any) => `• ${esc(r.name || r.telegram_id)}${activeMap.get(Number(r.telegram_id)) === false ? ' 🚫(бот заблокирован)' : ''}`).join('\n');
          await tg('sendMessage', {
            chat_id: chatId, parse_mode: 'HTML',
            text: `📊 <b>Реакции на рассылку</b>\n\n✅ Подтвердили (нажали «Еду»): <b>${confirmed.length}</b>\n🔕 Молчат: <b>${silent.length}</b>\n🚫 Бот заблокирован: <b>${blocked.length}</b>\n\n${silent.length ? `<b>Молчат:</b>\n${silentList}` : 'Все отреагировали 🔥'}`,
            reply_markup: silent.some((r: any) => activeMap.get(Number(r.telegram_id)) !== false) ? kb([[{ text: '🔔 Напомнить молчунам', callback_data: `admnudge_${evId}` }]]) : undefined,
          });
          return res.status(200).json({ ok: true });
        }
        // Повторный пинг молчунам (кто не подтвердил и бот не заблокирован).
        if (data.startsWith('admnudge_')) {
          const evId = data.slice('admnudge_'.length);
          await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Напоминаю…' });
          const { data: evRow } = await supabase.from('events').select('title').eq('id', evId).maybeSingle();
          const { data: regs } = await supabase.from('registrations').select('telegram_id,status').eq('event_id', evId).neq('status', 'cancelled');
          let n = 0;
          for (const r of (regs || []).filter((x: any) => Number(x.telegram_id) > 0 && x.status !== 'confirmed')) {
            try {
              await tg('sendMessage', {
                chat_id: Number(r.telegram_id), parse_mode: 'HTML',
                text: `⏰ Напоминание по «<b>${esc((evRow as any)?.title || '')}</b>»: подтверди участие, чтобы мы на тебя рассчитывали.`,
                reply_markup: kb([[{ text: '✅ Еду', callback_data: `rsvpy_${evId}` }, { text: '❌ Не смогу', callback_data: `rsvpn_${evId}` }]]),
              });
              n++;
            } catch { /* заблокирован */ }
          }
          await tg('sendMessage', { chat_id: chatId, text: `✅ Напомнил ${n} участникам.` });
          return res.status(200).json({ ok: true });
        }

        // Перегенерация программы (итог дня: голосования/изменения) → превью → всем.
        if (data.startsWith('admprog_')) {
          const evId = data.slice('admprog_'.length);
          await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Генерирую…' });
          const ev = await getEvent(evId);
          // Решённые голосования дня — вписываем в программу.
          const { data: polls } = await supabase.from('polls').select('question,options').eq('event_id', evId);
          const decided = (polls || []).filter((p: any) => p.options?.status === 'decided' && p.options?.winner != null)
            .map((p: any) => `«${p.question}» → ${p.options.list?.[p.options.winner]}`).join('; ');
          const lg = (ev as any)?.logistics || {};
          const parsed = await geminiJSON(
            `Обнови программу события «${(ev as any)?.title}» (${(ev as any)?.date_label || (ev as any)?.date}${(ev as any)?.date_end ? ` — ${(ev as any)?.date_end}` : ''}, старт ${(ev as any)?.time || ''}).\n` +
            `ТЕКУЩАЯ ПРОГРАММА:\n${(((ev as any)?.program || []) as string[]).map((p: string, i: number) => `${i + 1}. ${p}`).join('\n')}\n` +
            (decided ? `РЕШЕНИЯ ГОЛОСОВАНИЙ (обязательно впиши): ${decided}\n` : '') +
            (lg.assemblyPoint ? `ТОЧКА СБОРА КОЛОННЫ (впиши первым пунктом с координатами): ${lg.assemblyPoint}${lg.departureTime ? `, сбор ${lg.departureTime}` : ''}\n` : '') +
            `Формат каждого пункта: «ДД месяц, ЧЧ:ММ — что делаем — отв. Имя (если был назначен, сохрани)». Сохрани существующие пункты и ответственных, впиши новое.\n` +
            `Верни JSON: {"program":["пункт", ...]}`
          );
          const prog: string[] = Array.isArray(parsed?.program) ? parsed.program.slice(0, 40).map((x: any) => String(x).slice(0, 300)) : [];
          if (!prog.length) { await tg('sendMessage', { chat_id: chatId, text: 'Не получилось сгенерировать — поправь в админке.' }); return res.status(200).json({ ok: true }); }
          await setSession(tgId, 'admprog_draft', { evId, prog });
          await tg('sendMessage', {
            chat_id: chatId, parse_mode: 'HTML',
            text: `📋 <b>Новая программа:</b>\n\n${prog.map((p) => `• ${esc(p)}`).join('\n')}\n\n<i>Сохранить и разослать всем участникам?</i>`,
            reply_markup: kb([[{ text: '✅ Сохранить и разослать', callback_data: 'admproggo' }]]),
          });
          return res.status(200).json({ ok: true });
        }
        if (data === 'admproggo') {
          const sessP = await getSession(tgId);
          if (!sessP || sessP.state !== 'admprog_draft') { await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Черновик устарел' }); return res.status(200).json({ ok: true }); }
          const { evId, prog } = sessP.context || {};
          await clearSession(tgId);
          await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Рассылаю…' });
          await supabase.from('events').update({ program: prog }).eq('id', evId);
          const ev3 = await getEvent(evId);
          const elig = await pollEligible(evId);
          await Promise.allSettled(elig.map((id) =>
            tg('sendMessage', { chat_id: id, parse_mode: 'HTML', text: `📋 <b>Обновлённая программа — «${esc((ev3 as any)?.title)}»</b>\n\n${(prog as string[]).map((p) => `• ${esc(p)}`).join('\n')}` })
          ));
          await tg('sendMessage', { chat_id: chatId, text: `✅ Программа сохранена (и на сайте) и разослана ${elig.length} участникам.` });
          return res.status(200).json({ ok: true });
        }

        // Точка сбора колонны: ИИ предлагает место+время → орг одобряет → всем.
        if (data.startsWith('admmeet_')) {
          const evId = data.slice('admmeet_'.length);
          await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Думаю…' });
          const ev = await getEvent(evId);
          const lat = Number((ev as any)?.coordinates_lat), lng = Number((ev as any)?.coordinates_lng);
          const parsed = await geminiJSON(
            `Колонна машин клуба выезжает из Минска на событие «${(ev as any)?.title}» (${(ev as any)?.date_label || (ev as any)?.date}, старт программы ${(ev as any)?.time || 'утром'}; точка назначения: ${Number.isFinite(lat) ? `${lat},${lng}` : (ev as any)?.location}).\n` +
            `Предложи ОДНО удобное место сбора колонны на выезде из Минска по этому направлению (АЗС/парковка у МКАД, где встанут 5+ машин) и время сбора (чтобы успеть к старту, дорога ~1.5-2ч, +15 мин на знакомство).\n` +
            `Верни JSON: {"point":"название места коротко","coords":"lat, lng","when":"время сбора, напр. 08:00","note":"одна строка почему тут удобно"}`
          );
          if (!parsed?.point) {
            await tg('sendMessage', {
              chat_id: chatId, parse_mode: 'HTML',
              text: '🤖 Не смог предложить точку сам. Задай свою — я разошлю всем с кликабельной картой.',
              reply_markup: kb([[{ text: '✏️ Задать точку (текстом)', callback_data: `admmeetman_${evId}` }]]),
            });
            return res.status(200).json({ ok: true });
          }
          const draft = `🧭 <b>Сбор колонны — «${esc((ev as any)?.title)}»</b>\n\n📍 ${esc(parsed.point)}\n🗺 <code>${esc(parsed.coords || '')}</code>\n🕐 Сбор в <b>${esc(parsed.when || '')}</b>\n${parsed.note ? `<i>${esc(parsed.note)}</i>\n` : ''}\nВстречаемся, знакомимся — и стартуем колонной!`;
          await setSession(tgId, 'admmeet_draft', { evId, draft, point: parsed.point, coords: parsed.coords, when: parsed.when });
          await tg('sendMessage', {
            chat_id: chatId, parse_mode: 'HTML',
            text: `${draft}\n\n<i>Проверь по карте. Разослать всем участникам?</i>`,
            reply_markup: kb([[{ text: '✅ Разослать всем', callback_data: 'admmeetgo' }], [{ text: '✏️ Своя точка (текстом)', callback_data: `admmeetman_${evId}` }]]),
          });
          return res.status(200).json({ ok: true });
        }
        if (data === 'admmeetgo') {
          const sessM = await getSession(tgId);
          if (!sessM || sessM.state !== 'admmeet_draft') { await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Черновик устарел' }); return res.status(200).json({ ok: true }); }
          const { evId, draft, point, coords, when } = sessM.context || {};
          await clearSession(tgId);
          await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Рассылаю…' });
          try {
            const ev2 = await getEvent(evId);
            const lg = (ev2 as any)?.logistics || {};
            await supabase.from('events').update({ logistics: { ...lg, assemblyPoint: `${point} (${coords})`, departureTime: when } }).eq('id', evId);
          } catch { /* no-op */ }
          const elig = await pollEligible(evId);
          const mapBtn = coords ? [[{ text: '🗺 Точка на карте', url: `https://yandex.ru/maps/?text=${encodeURIComponent(String(coords))}` }]] : [];
          await Promise.allSettled(elig.map((id) =>
            tg('sendMessage', { chat_id: id, parse_mode: 'HTML', text: draft, reply_markup: mapBtn.length ? kb(mapBtn) : undefined })
          ));
          await tg('sendMessage', { chat_id: chatId, text: `✅ Разослал ${elig.length} участникам и сохранил в логистику события.` });
          return res.status(200).json({ ok: true });
        }
        if (data.startsWith('admmeetman_')) {
          const evId = data.slice('admmeetman_'.length);
          await tg('answerCallbackQuery', { callback_query_id: cq.id });
          await setSession(tgId, 'admmeet_manual', { evId });
          await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: '✏️ Напиши одной строкой: место, координаты, ДАТА и ВРЕМЯ сбора.\n<i>Например: «Сбор колонны, 53.823241, 27.531874, 18 июля в 10:00»</i>' });
          return res.status(200).json({ ok: true });
        }

        // Точка прибытия: организатор задаёт текстом → сохраняем в logistics.arrivalPoint
        if (data.startsWith('admarrival_')) {
          const evId = data.slice('admarrival_'.length);
          await tg('answerCallbackQuery', { callback_query_id: cq.id });
          await setSession(tgId, 'admarrival_manual', { evId });
          await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: '🏁 <b>Точка прибытия</b>\n\nНапиши одной строкой: место и координаты.\n<i>Например: «Голубые озёра, стоянка у воды, 52.123456, 27.123456»</i>\n\nКоординаты можно взять в Яндекс.Картах: зажми точку → скопируй.' });
          return res.status(200).json({ ok: true });
        }

        // Статистика голосований события: явка и расклад по каждому опросу.
        if (data.startsWith('admpolls_')) {
          const evId = data.slice('admpolls_'.length);
          await tg('answerCallbackQuery', { callback_query_id: cq.id });
          const eligible = await pollEligible(evId);
          const { data: polls } = await supabase
            .from('polls').select('id,question,options').eq('event_id', evId).order('id', { ascending: false }).limit(20);
          if (!polls?.length) { await tg('sendMessage', { chat_id: chatId, text: 'Голосований по этому событию ещё нет.' }); return res.status(200).json({ ok: true }); }
          const blocks: string[] = [];
          const reopenRows: any[][] = [];
          for (const p of polls) {
            const o: any = (p as any).options || {};
            const list: string[] = o.list || [];
            const { counts, voters } = await pollTally((p as any).id, list.length);
            const st = o.status === 'decided' ? '✅ решено' : o.status === 'expired' ? '⌛ по времени' : '🗳 идёт';
            const lead = list.length ? list.map((opt, i) => `   ${o.winner === i ? '🏆' : '•'} ${esc(opt)}: ${counts[i] || 0}`).join('\n') : '';
            blocks.push(`<b>${esc((p as any).question)}</b> — ${st}\n   Явка: ${voters}/${eligible.length}\n${lead}`);
            // Закрытые можно переоткрыть одним тапом (если итог закрыли поспешно).
            if (o.status === 'decided' || o.status === 'expired') {
              reopenRows.push([{ text: `↩️ Возобновить: ${(p as any).question}`.slice(0, 62), callback_data: `preopen_${(p as any).id}` }]);
            }
          }
          await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `🗳 <b>Голосования события</b> (право голоса: ${eligible.length} чел)\n\n${blocks.join('\n\n')}`, ...(reopenRows.length ? { reply_markup: kb(reopenRows.slice(0, 6)) } : {}) });
          return res.status(200).json({ ok: true });
        }

        // admping_: доборщик вручную — пингуем только тех, у кого есть пробелы.
        const evId = data.slice('admping_'.length);
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Пингую…' });
        const { data: evRow } = await supabase.from('events').select('title').eq('id', evId).maybeSingle();
        const { data: regs } = await supabase
          .from('registrations').select('telegram_id,dietary,equipment,roles,has_transport')
          .eq('event_id', evId).neq('status', 'cancelled');
        let pinged = 0;
        for (const r of (regs || []).filter((x: any) => Number(x.telegram_id) > 0)) {
          const gaps: string[] = [];
          if (r.has_transport === null || r.has_transport === undefined) gaps.push('🚗 Транспорт');
          if (!r.dietary) gaps.push('🍽 Питание');
          if (!r.equipment) gaps.push('🎒 Снаряжение');
          if (!r.roles) gaps.push('🙌 Роль');
          if (!gaps.length) continue;
          const buttons: any[][] = [];
          if (gaps.includes('🚗 Транспорт')) buttons.push([{ text: '🚗 Указать транспорт', callback_data: `trask_${evId}` }]);
          buttons.push([{ text: '📋 Заполнить остальное', callback_data: `org_${evId}` }]);
          try {
            await tg('sendMessage', {
              chat_id: Number(r.telegram_id), parse_mode: 'HTML',
              text: `📋 <b>Организаторам не хватает данных — «${esc((evRow as any)?.title || '')}»</b>\n\nЗаполни, пожалуйста:\n${gaps.join('\n')}\n\nЭто минута — жми кнопки.`,
              reply_markup: kb(buttons),
            });
            pinged++;
          } catch { /* заблокировал бота */ }
        }
        await tg('sendMessage', { chat_id: chatId, text: pinged ? `✅ Пинганул ${pinged} участников с пробелами в анкете.` : '✅ У всех анкеты полные — пинговать некого.' });
        return res.status(200).json({ ok: true });
      }

      // «Заезжай за мной»: пассажир шлёт свою точку, водитель решает.
      if (data.startsWith('pickme_')) {
        const rideId = Number(data.slice('pickme_'.length));
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        await setSession(tgId, 'pickup_loc', { rideId });
        await tg('sendMessage', {
          chat_id: chatId, parse_mode: 'HTML',
          text: '📍 Пришли свою геопозицию (скрепка → «Геопозиция») или напиши адрес/координаты текстом — передам водителю, он решит, сможет ли заехать.',
        });
        return res.status(200).json({ ok: true });
      }
      if (data.startsWith('pickyes_') || data.startsWith('pickno_')) {
        const yes = data.startsWith('pickyes_');
        const rest = data.slice(yes ? 8 : 7);
        const us = rest.indexOf('_');
        const rideId = Number(rest.slice(0, us));
        const paxId = Number(rest.slice(us + 1));
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: yes ? 'Передал пассажиру ✅' : 'Передал пассажиру' });
        try { await tg('editMessageReplyMarkup', { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [] } }); } catch { /* no-op */ }
        const { data: ride } = await supabase.from('rides').select('from_point,depart_text,driver_name').eq('id', rideId).maybeSingle();
        try {
          await tg('sendMessage', {
            chat_id: paxId, parse_mode: 'HTML',
            text: yes
              ? `✅ <b>${esc((ride as any)?.driver_name || 'Водитель')} заедет за тобой!</b>\nДержи телефон под рукой — он напишет/позвонит по времени.`
              : `😔 ${esc((ride as any)?.driver_name || 'Водитель')} не сможет заехать. Добирайся до точки выезда сам: 📍 ${esc((ride as any)?.from_point || '—')} · 🕐 ${esc((ride as any)?.depart_text || '—')}.\nЕсли никак — жми 🆘 SOS в логистике события.`,
          });
        } catch { /* no-op */ }
        return res.status(200).json({ ok: true });
      }

      // Сплит-долг: должник говорит «перевёл» → получатель должен подтвердить.
      if (data.startsWith('payd_') || data.startsWith('payc_') || data.startsWith('payx_')) {
        const kind = data.slice(0, 4); // payd | payc | payx
        const rest = data.slice(5);
        const us = rest.lastIndexOf('_');
        const evId = rest.slice(0, us);
        const trId = rest.slice(us + 1);
        const { data: evRow } = await supabase.from('events').select('title,shopping').eq('id', evId).maybeSingle();
        const shopping = (evRow as any)?.shopping || {};
        const split = shopping.split || {};
        const transfers: any[] = Array.isArray(split.transfers) ? split.transfers : [];
        const t = transfers.find((x: any) => String(x.id) === trId);
        if (!t) { await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Перевод не найден' }); return res.status(200).json({ ok: true }); }
        const saveSplit = () => supabase.from('events').update({ shopping: { ...shopping, split: { ...split, transfers } } }).eq('id', evId);

        if (kind === 'payd') {
          // Только сам должник может отметить перевод.
          if (Number(t.from) !== tgId) { await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Это не твой долг' }); return res.status(200).json({ ok: true }); }
          // Просим скриншот перевода вместо простого нажатия.
          await setSession(tgId, 'pay_proof', { evId, trId, from_name: t.from_name, to_name: t.to_name, amount: t.amount });
          await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Пришли скриншот перевода' });
          await tg('sendMessage', {
            chat_id: chatId, parse_mode: 'HTML',
            text: '📸 <b>Пришли скриншот перевода</b> (фото или скриншот из банка/приложения).\n\n' +
              `Перевод: <b>${t.amount} BYN</b>\n` +
              `Кому: <b>${esc(t.to_name)}</b>\n` +
              `Событие: ${esc((evRow as any)?.title || '')}\n\n` +
              'Получатель увидит твой скриншот и подтвердит получение.',
          });
          return res.status(200).json({ ok: true });
        }
        // Подтверждение/отклонение — только получатель.
        if (Number(t.to) !== tgId) { await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Подтверждает получатель перевода' }); return res.status(200).json({ ok: true }); }
        if (kind === 'payc') {
          t.status = 'confirmed'; t.confirmed_at = new Date().toISOString();
          await saveSplit();
          await tg('answerCallbackQuery', { callback_query_id: cq.id, text: '✅ Долг закрыт' });
          try { await tg('editMessageReplyMarkup', { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [] } }); } catch { /* no-op */ }
          try { await tg('sendMessage', { chat_id: Number(t.from), parse_mode: 'HTML', text: `✅ ${esc(t.to_name)} подтвердил получение <b>${t.amount} BYN</b> — долг закрыт, спасибо!` }); } catch { /* no-op */ }
        } else {
          t.status = 'pending'; delete t.sent_at;
          await saveSplit();
          await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Вернул долг в ожидание' });
          try { await tg('sendMessage', { chat_id: Number(t.from), parse_mode: 'HTML', text: `⚠️ ${esc(t.to_name)} не видит перевод <b>${t.amount} BYN</b>. Проверь реквизиты и попробуй ещё раз — долг снова в ожидании.` }); } catch { /* no-op */ }
        }
        return res.status(200).json({ ok: true });
      }

      // «Другое число» гостей при регистрации — просим ввести число текстом.
      if (data.startsWith('rgx_')) {
        const evId = data.slice('rgx_'.length);
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        await setSession(tgId, 'reg_guest', { evId });
        await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: '👥 Сколько человек берёшь с собой (кроме тебя)? Напиши число.\n<i>Например: 5. За гостей отвечаешь и оплачиваешь ты.</i>' });
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
            await updateReg(evId, tgId, { has_transport: true, transport_seats: 0 });
            await setSession(tgId, 'reg_car', { evId });
            await tg('editMessageText', {
              chat_id: chatId, message_id: msgId, parse_mode: 'HTML',
              text: '🚗 Понял, без свободных мест. Напиши марку и цвет авто — чтобы тебя узнали на точке сбора.\n<i>Например: «VW Passat, серый»</i>',
              reply_markup: kb([[{ text: 'Пропустить', callback_data: `carskip_${evId}` }]]),
            });
          } else {
            await updateReg(evId, tgId, { has_transport: false, transport_details: val === 'seek' ? 'Ищет попутку' : null });
            if (foodNeeded(ev)) await askFood(evId); else await finalConfirm(ev);
          }
          return res.status(200).json({ ok: true });
        }
        if (action === 'rs') {
          await updateReg(evId, tgId, { has_transport: true, transport_seats: Number(val) });
          // Марка и цвет авто — чтобы на точке сбора люди знали, какую машину искать.
          await setSession(tgId, 'reg_car', { evId });
          await tg('editMessageText', {
            chat_id: chatId, message_id: msgId, parse_mode: 'HTML',
            text: `🚗 Мест: <b>${Number(val)}</b>. Напиши марку и цвет авто — так попутчики найдут тебя на точке сбора.\n<i>Например: «Kia Rio, белая»</i>`,
            reply_markup: kb([[{ text: 'Пропустить', callback_data: `carskip_${evId}` }]]),
          });
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
        // Ночёвка: важна для палаток и подсчёта спальных мест («Яна и Саша без ночёвки»).
        await tg('sendMessage', {
          chat_id: chatId, parse_mode: 'HTML',
          text: '🌙 Ночуешь в лагере?',
          reply_markup: kb([
            [{ text: '⛺ Да, с ночёвкой', callback_data: `ovny_${evId}` }],
            [{ text: '🚗 Без ночёвки (уеду вечером)', callback_data: `ovnn_${evId}` }],
          ]),
        });
        return res.status(200).json({ ok: true });
      }
      // Ответ про ночёвку → дальше обычная цепочка (транспорт…).
      if (data.startsWith('ovny_') || data.startsWith('ovnn_')) {
        const overnight = data.startsWith('ovny_');
        const evId = data.slice(5);
        const ev = await getEvent(evId);
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        // Маркер в notes: без миграции; крон сна и админка читают его.
        try {
          const { data: rr } = await supabase.from('registrations').select('notes').eq('event_id', evId).eq('telegram_id', tgId).neq('status', 'cancelled').maybeSingle();
          const base = String((rr as any)?.notes || '').replace(/\s*\[без ночёвки\]/g, '').trim();
          await updateReg(evId, tgId, { notes: overnight ? (base || null) : `${base ? base + ' ' : ''}[без ночёвки]` });
        } catch { /* no-op */ }
        try { await tg('editMessageText', { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', text: overnight ? '⛺ Ночуешь в лагере — учтём в местах для сна.' : '🚗 Без ночёвки — спальное место не считаем.' }); } catch { /* no-op */ }
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
        const { data: myGear } = await supabase.from('member_equipment').select('item,quantity').eq('telegram_id', tgId).limit(20);
        const myList = (myGear || []).map((g: any) => `${g.item}${g.quantity > 1 ? ` x${g.quantity}` : ''}`);
        await tg('sendMessage', { 
          chat_id: chatId, 
          parse_mode: 'HTML', 
          text: `🎒 <b>Снаряжение</b>\n\nБазовый чек-лист + своё снаряжение${myList.length ? `:\n${myList.map((i: string) => `✓ ${esc(i)}`).join('\n')}` : ' (пока пусто)'}\n\nОтметь базовое ниже или добавь своё текстом:`, 
          reply_markup: kb([
            ...checklistKb('eqt', evId, EQUIP, ((reg as any)?.equipment) || []).inline_keyboard,
            [{ text: '➕ Добавить своё снаряжение', callback_data: `geadd_${evId}` }],
            [{ text: '⬅️ Назад', callback_data: `org_${evId}` }]
          ])
        });
        return res.status(200).json({ ok: true });
      }
      // Добавить своё снаряжение свободным текстом → ИИ парсит
      if (data.startsWith('geadd_')) {
        const evId = data.slice('geadd_'.length);
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        await setSession(tgId, 'gear_add', { evId });
        await tg('sendMessage', { 
          chat_id: chatId, 
          parse_mode: 'HTML', 
          text: '➕ <b>Своё снаряжение</b>\n\nНапиши свободно что берёшь — система сама распарсит и добавит в твой инвентарь.\n\n<i>Например: «2 стула, стол складной, проектор, скатерть, мангал»</i>\n\nМожно с ошибками — ИИ поймёт.' 
        });
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
        // Гейтинг: закрытое событие требует кода доступа
        if (ev.is_public === false && ev.access_code) {
          const registered = await hasActiveReg(ev.id, tgId);
          if (!registered) {
            await setSession(tgId, 'access_code_check', { eventId: ev.id });
            await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `🔒 <b>${esc(ev.title)}</b>\n\nЭто закрытое событие. Введи код доступа (одно слово без пробелов).` });
            return res.status(200).json({ ok: true });
          }
        }
        const registered = await hasActiveReg(ev.id, tgId);
        await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: eventCard(ev), reply_markup: kb(eventCardButtons(ev, openBtn, registered)) });
        return res.status(200).json({ ok: true });
      }

      // «✅ Ты записан» — просто подсказка, ничего не ломаем.
      if (data.startsWith('myreg_')) {
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Ты в списке! Отказаться — кнопкой ниже.' });
        return res.status(200).json({ ok: true });
      }

      // «📸 Фото и видео» — сбор медиа в галерею + ссылка на просмотр.
      if (data.startsWith('media_')) {
        const evId = data.slice('media_'.length);
        await setSession(tgId, 'media_upload', { eventId: evId });
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        await tg('sendMessage', {
          chat_id: chatId, parse_mode: 'HTML',
          text:
            '📸 <b>Галерея события</b>\n\n' +
            'Пришли сюда фото или видео с события (до 30 файлов) — они попадут в общую галерею.\n' +
            'Там же голосуем ❤️ за лучшие кадры: топ-5 останется в истории события, остальное удалится через 7 дней.\n\n' +
            'Закончил — жми /start.',
          reply_markup: kb([[{ text: '🖼 Открыть галерею', web_app: { url: `${site}/api/events?action=gallery&id=${encodeURIComponent(evId)}` } }]]),
        });
        return res.status(200).json({ ok: true });
      }

      // Подтверждение прочтения рассылки: тап «✅ Понял(а)».
      if (data.startsWith('ack_')) {
        const evId = data.slice('ack_'.length);
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Спасибо, отметил! ✅' });
        // Убираем кнопку — визуальное подтверждение и защита от повторов.
        if (msgId) {
          try { await tg('editMessageReplyMarkup', { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [] } }); } catch {}
        }
        // Отмечаем костяку в группе, кто подтвердил прочтение.
        if (ADMIN_CHAT_ID) {
          const ev = await getEvent(evId);
          const who = `${esc(cq.from.first_name || '')}${cq.from.username ? ' @' + esc(cq.from.username) : ''} (id ${tgId})`;
          try {
            await tg('sendMessage', {
              chat_id: ADMIN_CHAT_ID, parse_mode: 'HTML',
              text: `✅ <b>Прочитано</b> · ${esc(ev?.title || evId)}\n${who}`,
              disable_web_page_preview: true,
            });
          } catch {}
        }
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

      // Памятка участнику (logistics.prep): подготовка, правила места, безопасность.
      if (data.startsWith('prep_')) {
        const ev = await getEvent(data.slice('prep_'.length));
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        const prep = String(ev?.logistics?.prep || '').trim();
        if (!prep) {
          await tg('sendMessage', { chat_id: chatId, text: 'Памятка ещё готовится — пришлю, как появится.' });
          return res.status(200).json({ ok: true });
        }
        // Telegram режет сообщения на 4096 символов — шлём кусками по границе строки.
        const header = `🎒 <b>Как готовиться: ${esc(ev.title)}</b>\n\n`;
        let rest = esc(prep);
        let first = true;
        while (rest.length) {
          const budget = 3800 - (first ? header.length : 0);
          let chunk = rest.slice(0, budget);
          if (rest.length > budget) {
            const nl = chunk.lastIndexOf('\n');
            if (nl > budget * 0.5) chunk = chunk.slice(0, nl);
          }
          await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: (first ? header : '') + chunk });
          rest = rest.slice(chunk.length);
          first = false;
        }
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

      // «Переслать точки»: отправляем точки выезда и прибытия отдельными venue-сообщениями
      if (data.startsWith('sharepoints_')) {
        const evId = data.slice('sharepoints_'.length);
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        const ev = await getEvent(evId);
        const lg = ev?.logistics || {};
        let sent = 0;
        if (lg.assemblyPoint) {
          const coords = lg.assemblyPoint.match(/(-?\d+[.,]\d+)[,\s]+(-?\d+[.,]\d+)/);
          if (coords) {
            await tg('sendVenue', { chat_id: chatId, latitude: parseFloat(coords[1].replace(',', '.')), longitude: parseFloat(coords[2].replace(',', '.')), title: '🚩 Точка выезда', address: lg.assemblyPoint });
            sent++;
          } else {
            await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `🚩 <b>Точка выезда</b>\n${esc(lg.assemblyPoint)}` });
            sent++;
          }
        }
        if (lg.arrivalPoint) {
          const coords = lg.arrivalPoint.match(/(-?\d+[.,]\d+)[,\s]+(-?\d+[.,]\d+)/);
          if (coords) {
            await tg('sendVenue', { chat_id: chatId, latitude: parseFloat(coords[1].replace(',', '.')), longitude: parseFloat(coords[2].replace(',', '.')), title: '🏁 Точка прибытия', address: lg.arrivalPoint });
            sent++;
          } else {
            await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `🏁 <b>Точка прибытия</b>\n${esc(lg.arrivalPoint)}` });
            sent++;
          }
        }
        if (!sent) await tg('sendMessage', { chat_id: chatId, text: 'Точки ещё не заданы. Организатор может задать их в панели.' });
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
        // Карточка-приглашение: заголовок с эмодзи, дата, локация, короткое описание,
        // и заметная кнопка «Забронировать место» (url-кнопка переживает пересылку).
        const dateLine = `${dayPhrase(ev.date)}${ev.time ? `, ${esc(ev.time)}` : ''}`;
        const rawDesc = ev.description ? String(ev.description).replace(/\s+/g, ' ').trim() : '';
        const shortDesc = rawDesc ? rawDesc.slice(0, 160) + (rawDesc.length > 160 ? '…' : '') : '';
        const caption =
          `🎉 <b>${esc(ev.title)} — идём вместе!</b>\n\n` +
          `📅 ${esc(dateLine)}\n` +
          (ev.location ? `📍 ${esc(ev.location)}\n` : '') +
          (ev.price_label ? `💳 ${esc(ev.price_label)}\n` : '') +
          (shortDesc ? `\n${esc(shortDesc)}\n` : '') +
          `\n<i>Жми «Забронировать место» — откроется событие, друг попадёт в клуб по твоему приглашению.</i>\n\n` +
          `Ссылка (можно переслать вручную):\n<code>${esc(link)}</code>`;
        const markup = kb([
          [{ text: '✅ Забронировать место', url: link }],
          [{ text: '📤 Отправить другу', url: shareUrl }],
        ]);

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
      // Живая статистика события: едет / машины / палатки / М-Ж. Видна всем.
      if (data.startsWith('stats_')) {
        const evId = data.slice('stats_'.length);
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        const ev = await getEvent(evId);

        const { data: regs } = await supabase
          .from('registrations').select('telegram_id,guest_count')
          .eq('event_id', evId).neq('status', 'cancelled');
        const people = (regs || []).length;
        const guests = (regs || []).reduce((s: number, r: any) => s + (Number(r.guest_count) || 0), 0);
        const total = people + guests;

        const { data: cars } = await supabase
          .from('rides').select('seats_total,seats_taken')
          .eq('event_id', evId).eq('active', true).eq('kind', 'car');
        const carCount = (cars || []).length;
        const carSeats = (cars || []).reduce((s: number, c: any) => s + (Number(c.seats_total) || 0), 0);
        const carFree = (cars || []).reduce((s: number, c: any) => s + Math.max(0, (Number(c.seats_total) || 0) - (Number(c.seats_taken) || 0)), 0);

        const { data: tents } = await supabase
          .from('rides').select('seats_total,seats_taken')
          .eq('event_id', evId).eq('active', true).eq('kind', 'tent');
        const tentCount = (tents || []).length;
        const tentFree = (tents || []).reduce((s: number, t: any) => s + Math.max(0, (Number(t.seats_total) || 0) - (Number(t.seats_taken) || 0)), 0);

        // М/Ж: у одногендерного события — из entry_type; у смешанного —
        // по members.gender (колонка может ещё не быть — тогда мягко пропускаем).
        let genderLine = '';
        if (ev?.entry_type === 'male') genderLine = '👨 Только мужчины\n';
        else if (ev?.entry_type === 'female') genderLine = '👩 Только женщины\n';
        else {
          try {
            const ids = (regs || []).map((r: any) => Number(r.telegram_id)).filter((n: number) => n > 0);
            if (ids.length) {
              const { data: mem } = await supabase.from('members').select('gender').in('telegram_id', ids);
              const male = (mem || []).filter((m: any) => m.gender === 'male').length;
              const female = (mem || []).filter((m: any) => m.gender === 'female').length;
              if (male || female) {
                const unknown = people - male - female;
                genderLine = `👨 ${male} · 👩 ${female}${unknown > 0 ? ` · ❔ ${unknown}` : ''}\n`;
              }
            }
          } catch { /* колонка gender ещё не создана — пропускаем */ }
        }

        const cap = ev?.max_participants ? ` из ${ev.max_participants}` : '';
        let txt = `📊 <b>${esc(ev?.title || 'Событие')}</b>\n\n`;
        txt += `👥 Едет: <b>${total}</b>${cap}${guests ? ` (${people} + ${guests} гост${guests === 1 ? 'ь' : 'ей'})` : ''}\n`;
        txt += genderLine;
        if (carCount) txt += `🚗 Машин: <b>${carCount}</b> · свободно ${carFree} из ${carSeats} мест\n`;
        else if (featureOn(ev, 'rides')) txt += `🚗 Машин пока нет — предложи свою в логистике\n`;
        if (tentCount) txt += `⛺ Палаток: <b>${tentCount}</b> · свободно ${tentFree} мест\n`;
        txt += `\nЗовём ещё людей — вместе теплее. 📤`;

        await tg('sendMessage', {
          chat_id: chatId, parse_mode: 'HTML', text: txt,
          reply_markup: kb([[{ text: '📤 Позвать друга', callback_data: `share_${evId}` }]]),
        });
        return res.status(200).json({ ok: true });
      }

      if (data.startsWith('logi_')) {
        const evId = data.slice('logi_'.length);
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        // Секции — по включённым у события функциям (машины/палатки).
        const logiEv = await getEvent(evId);
        const rows: any[] = [];
        if (featureOn(logiEv, 'rides')) {
          rows.push([{ text: '🚗 Еду на машине — предложить места', callback_data: `ridenew_${evId}` }]);
          rows.push([{ text: '👀 Кто едет / занять место', callback_data: `rides_${evId}` }]);
          rows.push([{ text: '🚶 Нужна попутка', callback_data: `rideseek_${evId}` }]);
          rows.push([{ text: '🆘 SOS — нужна помощь', callback_data: `sos_${evId}` }]);
        }
        if (featureOn(logiEv, 'tents')) {
          rows.push([{ text: '⛺ Своя палатка — предложить места', callback_data: `tentnew_${evId}` }]);
          rows.push([{ text: '🛌 Места в палатках', callback_data: `tents_${evId}` }]);
        }
        // Общие расходы: любой участник фиксирует покупку с чеком — видно всем,
        // делится на всех по ртам (участник + его гости) при финальном сплите.
        rows.push([
          { text: '💸 Добавить расход', callback_data: `expadd_${evId}` },
          { text: '📊 Расходы', callback_data: `expview_${evId}` },
        ]);
        // Если у участника записаны гости — даём рассадить/забрать их.
        {
          const { data: myReg } = await supabase.from('registrations').select('guest_count').eq('event_id', evId).eq('telegram_id', tgId).neq('status', 'cancelled').maybeSingle();
          if (Number((myReg as any)?.guest_count) > 0) rows.push([{ text: '👥 Мои гости — логистика', callback_data: `gpick_${evId}` }]);
        }
        if (!rows.length) {
          await tg('sendMessage', { chat_id: chatId, text: 'Для этого события логистика не нужна — организатор всё продумал.' });
          return res.status(200).json({ ok: true });
        }
        await tg('sendMessage', {
          chat_id: chatId, parse_mode: 'HTML',
          text: '🚗 <b>Логистика и брони</b>\n\nЗдесь всё по инициативе участников: кто едет — сам предлагает места, кому нужно — ищет попутку.',
          reply_markup: kb(rows),
        });
        return res.status(200).json({ ok: true });
      }

      // Водитель заявляет поездку — пошаговый ввод через сессию.
      if (data.startsWith('ridenew_')) {
        const evId = data.slice('ridenew_'.length);
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        await setSession(tgId, 'ride_point', { evId });
        await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: '📍 <b>Откуда выезжаешь?</b>\nЛучше всего — <b>координаты цифрами</b>, чтобы попутчикам построился точный маршрут.\n\n<i>Где взять: Яндекс.Карты → зажми точку на карте → скопируй координаты (напр. «53.905, 27.559»). Или пришли геопозицию 📎. Можно и словами: «м. Каменная Горка, стоянка».</i>' });
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
            { text: 'Без взноса', callback_data: 'rfuel_0' },
            { text: '5 Br', callback_data: 'rfuel_5' },
            { text: '10 Br', callback_data: 'rfuel_10' },
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
        // Одна активная машина на водителя на событие: повторный заход —
        // это корректировка (места/время/точка), а не вторая машина.
        const { data: myRides } = await supabase
          .from('rides').select('id,kind').eq('event_id', evId).eq('driver_id', tgId).eq('active', true);
        const existing = (myRides || []).find((r: any) => r.kind !== 'tent');
        const rideData = {
          event_id: evId, driver_id: tgId, driver_name: cq.from.first_name || cq.from.username || 'Водитель',
          from_point: from, depart_text: depart, seats_total: seats, fuel_cost: fuel,
        };
        let carBonus = 0;
        if (existing) {
          await supabase.from('rides').update(rideData).eq('id', (existing as any).id);
        } else {
          await supabase.from('rides').insert(rideData);
          carBonus = await awardPoints(tgId, POINTS_SHARE_CAR); // баллы только за новую машину
        }
        await clearSession(tgId);
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: existing ? 'Поездка обновлена!' : 'Поездка добавлена!' });
        await tg('editMessageText', {
          chat_id: chatId, message_id: msgId, parse_mode: 'HTML',
          text: `✅ ${existing ? 'Твоя поездка обновлена' : 'Готово! Твоя поездка добавлена'}:\n📍 ${esc(from)}  🕐 ${esc(depart)}\nМест: ${seats}  ⛽ ${fuel ? fuel + ' Br/чел' : 'бесплатно'}\n\nУчастники увидят её в «Кто едет» и смогут занять место.`
            + (carBonus ? `\n\n🏅 <b>+${POINTS_SHARE_CAR} баллов</b> за то, что везёшь других! Всего: ${carBonus}.` : ''),
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
        const { data: allActive } = await supabase.from('rides').select('*').eq('event_id', evId).eq('active', true).order('created_at');
        // Палатки (kind='tent') живут в той же таблице — в список машин их не пускаем.
        const rides = (allActive || []).filter((r: any) => r.kind !== 'tent');
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
          else rows.push([{ text: '🕐 Встать в очередь (мест нет)', callback_data: `rwait_${(r as any).id}` }]);
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
        const rows: any[] = [
          // Не может добраться до точки сбора сам — попросит водителя заехать.
          [{ text: '📍 Не доберусь сам — заезжай за мной', callback_data: `pickme_${rideId}` }],
          [{ text: '❌ Освободить место', callback_data: `rideunbook_${rideId}` }],
        ];
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
        await notifyWaitlist(rideId, 'car');
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

      // Отмена своего участия в событии — снять заявку и освободить место.
      if (data.startsWith('regcancel_')) {
        const evId = data.slice('regcancel_'.length);
        const { data: reg } = await supabase
          .from('registrations').select('id')
          .eq('event_id', evId).eq('telegram_id', tgId).neq('status', 'cancelled').maybeSingle();
        if (!reg) { await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Активной записи нет' }); return res.status(200).json({ ok: true }); }
        await supabase.from('registrations').update({ status: 'cancelled' }).eq('id', (reg as any).id);
        // Счётчик мест НЕ трогаем: participantsCount теперь везде считается
        // из registrations (единый источник правды), колонка — легаси.
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Участие отменено' });
        await tg('editMessageText', { chat_id: chatId, message_id: msgId, text: '❌ Ты отменил(а) участие. Место освободилось для других. Захочешь вернуться — открой событие заново.' });
        return res.status(200).json({ ok: true });
      }

      // RSVP «✅ Еду» из напоминания — подтверждаем, что человек с нами.
      if (data.startsWith('rsvpy_')) {
        const evId = data.slice('rsvpy_'.length);
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: '🔥 Отлично, ждём тебя!' });
        // Реакция на рассылку = подтверждение участия: админка видит confirmed.
        try { await updateReg(evId, tgId, { status: 'confirmed' }); } catch { /* no-op */ }
        try { await tg('editMessageReplyMarkup', { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [] } }); } catch { /* no-op */ }
        await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: '🔥 Супер, ты в деле! До встречи. Если что-то поменяется — открой событие и нажми «Отказаться».' });
        return res.status(200).json({ ok: true });
      }

      // RSVP «❌ Не смогу» — спрашиваем причину, снятие с события — после ответа.
      if (data.startsWith('rsvpn_')) {
        const evId = data.slice('rsvpn_'.length);
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        try { await tg('editMessageReplyMarkup', { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [] } }); } catch { /* no-op */ }
        await setSession(tgId, 'rsvp_reason', { evId });
        await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: '😔 Жаль! Напиши пару слов — почему не сможешь? Это поможет организаторам. После ответа сниму тебя с события и освобожу место.' });
        return res.status(200).json({ ok: true });
      }

      // Контроль гостей: «✅ Все со мной» — состав подтверждён, ничего не меняем.
      if (data.startsWith('gconf_')) {
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: '✅ Состав подтверждён, спасибо!' });
        try { await tg('editMessageReplyMarkup', { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [] } }); } catch { /* no-op */ }
        await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: '🔥 Отлично, ждём всю компанию! Если что-то поменяется — открой событие в боте.' });
        return res.status(200).json({ ok: true });
      }

      // Контроль гостей: «✏️ Изменить число» — просим новое число текстом.
      if (data.startsWith('gedit_')) {
        const evId = data.slice('gedit_'.length);
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        try { await tg('editMessageReplyMarkup', { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [] } }); } catch { /* no-op */ }
        const { data: rr } = await supabase.from('registrations').select('guest_count').eq('event_id', evId).eq('telegram_id', tgId).neq('status', 'cancelled').maybeSingle();
        await setSession(tgId, 'guest_edit', { evId, from: Number((rr as any)?.guest_count) || 0 });
        await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: '👥 Сколько человек будет с тобой (кроме тебя)? Напиши число.\n<i>0 — еду один. Например: 3</i>' });
        return res.status(200).json({ ok: true });
      }

      // Согласие с закупкой — копим approved_by в events.shopping.
      if (data.startsWith('shopok_')) {
        const evId = data.slice('shopok_'.length);
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: '✅ Спасибо, учли твоё согласие!' });
        try {
          const { data: ev } = await supabase.from('events').select('shopping').eq('id', evId).maybeSingle();
          const shopping = (ev as any)?.shopping || {};
          const approved = Array.isArray(shopping.approved_by) ? shopping.approved_by : [];
          if (!approved.includes(tgId)) {
            const nextApproved = [...approved, tgId];
            // Кворум >50% участников — утверждаем сразу, не дожидаясь крона.
            const { data: regsAll } = await supabase
              .from('registrations').select('telegram_id').eq('event_id', evId).neq('status', 'cancelled');
            const total = (regsAll || []).filter((r: any) => Number(r.telegram_id) > 0).length;
            const quorum = total > 0 && nextApproved.length > total / 2 && shopping.status === 'sent';
            await supabase.from('events').update({
              shopping: { ...shopping, approved_by: nextApproved, ...(quorum ? { status: 'approved', approved_at: new Date().toISOString() } : {}) },
            }).eq('id', evId);
            if (quorum && ADMIN_CHAT_ID) {
              const { data: evRow } = await supabase.from('events').select('title').eq('id', evId).maybeSingle();
              await tg('sendMessage', { chat_id: ADMIN_CHAT_ID, parse_mode: 'HTML', text: `🛒 <b>Закупка утверждена</b> — «${esc((evRow as any)?.title || evId)}»\nЗа: ${nextApproved.length} из ${total} (>50%). Можно запускать закупщика из админки.` });
            }
          }
        } catch { /* no-op */ }
        try { await tg('editMessageReplyMarkup', { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [] } }); } catch { /* no-op */ }
        return res.status(200).json({ ok: true });
      }

      // «✏️ Есть замечания» к закупке — собираем корректировку текстом.
      if (data.startsWith('shopno_')) {
        const evId = data.slice('shopno_'.length);
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        await setSession(tgId, 'shop_feedback', { evId });
        await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: '✏️ Напиши, что поменять в закупке: чего не хватает, что лишнее, твои предпочтения по еде. Организаторы учтут и пришлют обновлённый список.' });
        return res.status(200).json({ ok: true });
      }

      // Закупщик отметил «Закупка сделана» — фиксируем статус и пингуем оргов.
      if (data.startsWith('boughtok_')) {
        const evId = data.slice('boughtok_'.length);
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: '✅ Огонь, спасибо! Отметил.' });
        try {
          const { data: ev } = await supabase.from('events').select('title,shopping').eq('id', evId).maybeSingle();
          const shopping = (ev as any)?.shopping || {};
          await supabase.from('events').update({ shopping: { ...shopping, status: 'bought', bought_at: new Date().toISOString() } }).eq('id', evId);
          const who = `${esc(cq.from.first_name || '')} ${cq.from.username ? '@' + esc(cq.from.username) : ''}`;
          if (ADMIN_CHAT_ID) {
            await tg('sendMessage', { chat_id: ADMIN_CHAT_ID, parse_mode: 'HTML', text: `✅ <b>Закупка выполнена</b>\n${esc((ev as any)?.title || evId)}\nЗакупщик: ${who}\n\nОсталось разделить расходы поровну между участниками.` });
          }
        } catch { /* no-op */ }
        try { await tg('editMessageReplyMarkup', { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [] } }); } catch { /* no-op */ }
        await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: '🙌 Спасибо, что взял закупку на себя! Организаторы разделят расходы поровну. Чеки/сумму можешь скинуть прямо сюда.' });
        return res.status(200).json({ ok: true });
      }

      // «✅ Понял(а)» под рассылкой — благодарим и убираем кнопку (без спиннера).
      if (data.startsWith('ack_')) {
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: '✅ Принято, спасибо!' });
        try { await tg('editMessageReplyMarkup', { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [] } }); } catch { /* no-op */ }
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

      // SOS: участник нужна срочная помощь с логистикой во время события
      if (data.startsWith('sos_')) {
        const evId = data.slice('sos_'.length);
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: '🆘 Сигнал отправлен организаторам' });
        const { data: ev } = await supabase.from('events').select('deputy_id').eq('id', evId).maybeSingle();
        const orgId = (ev as any)?.deputy_id || 377551019;
        try {
          await tg('sendMessage', {
            chat_id: orgId, parse_mode: 'HTML',
            text: `🆘 <b>SOS от участника!</b>\n${esc(cq.from.first_name || 'Участник')} (ID: ${tgId}) нужна помощь с логистикой на событии.\n\nМожешь написать ему или показать список машин со свободными местами.`,
          });
        } catch { /* no-op */ }
        await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: '🆘 Организаторы уведомлены. Они свяжутся с тобой. Попробуй также «👀 Кто едет» сам.', reply_markup: kb([[{ text: '👀 Кто едет', callback_data: `rides_${evId}` }]]) });
        return res.status(200).json({ ok: true });
      }

      // Встать в очередь на конкретную машину/палатку, когда мест нет.
      if (data.startsWith('rwait_')) {
        const rideId = Number(data.slice('rwait_'.length));
        const { data: ride } = await supabase.from('rides').select('event_id,active').eq('id', rideId).maybeSingle();
        if (!ride || !(ride as any).active) { await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Недоступно' }); return res.status(200).json({ ok: true }); }
        await supabase.from('ride_requests').upsert(
          { event_id: (ride as any).event_id, ride_id: rideId, passenger_id: tgId, passenger_name: cq.from.first_name || cq.from.username || 'Участник', active: true },
          { onConflict: 'event_id,passenger_id' }
        );
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Ты в очереди — позову, как освободится место' });
        return res.status(200).json({ ok: true });
      }

      // ===== ПАЛАТКИ: места как в машине (kind='tent' в rides, брони через те же RPC) =====
      // Предложить палатку → выбор числа мест.
      if (data.startsWith('tentnew_')) {
        const evId = data.slice('tentnew_'.length);
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        await tg('sendMessage', {
          chat_id: chatId, parse_mode: 'HTML',
          text: '⛺ <b>Своя палатка</b>\n\nСколько свободных спальных мест готов отдать?',
          reply_markup: kb([[
            { text: '1', callback_data: `tspots_1_${evId}` },
            { text: '2', callback_data: `tspots_2_${evId}` },
            { text: '3', callback_data: `tspots_3_${evId}` },
            { text: '4', callback_data: `tspots_4_${evId}` },
          ]]),
        });
        return res.status(200).json({ ok: true });
      }
      // Число мест выбрано → правило подселения.
      if (data.startsWith('tspots_')) {
        const p = data.slice('tspots_'.length).split('_');
        const n = Number(p[0]) || 0;
        const evId = p.slice(1).join('_');
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        await tg('editMessageText', {
          chat_id: chatId, message_id: msgId, parse_mode: 'HTML',
          text: `⛺ ${n} мест. Кого можно подселять?`,
          reply_markup: kb([[
            { text: '👥 Любых', callback_data: `tmake_${n}_any_${evId}` },
            { text: '♂ Только М', callback_data: `tmake_${n}_male_${evId}` },
            { text: '♀ Только Ж', callback_data: `tmake_${n}_female_${evId}` },
          ]]),
        });
        return res.status(200).json({ ok: true });
      }
      // Создать палатку.
      if (data.startsWith('tmake_')) {
        const p = data.slice('tmake_'.length).split('_');
        const n = Number(p[0]) || 0;
        const gender = p[1] || 'any';
        const evId = p.slice(2).join('_');
        // Одна активная палатка на хозяина на событие — повтор = корректировка.
        const { data: myTents } = await supabase
          .from('rides').select('id,kind').eq('event_id', evId).eq('driver_id', tgId).eq('active', true);
        const myTent = (myTents || []).find((r: any) => r.kind === 'tent');
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: myTent ? 'Палатка обновлена!' : 'Палатка добавлена!' });
        const tentData = {
          event_id: evId, driver_id: tgId, driver_name: cq.from.first_name || cq.from.username || 'Хозяин',
          from_point: `Палатка ${cq.from.first_name || ''}`.trim(), seats_total: n, kind: 'tent', gender_rule: gender,
        };
        const { error } = myTent
          ? await supabase.from('rides').update(tentData).eq('id', (myTent as any).id)
          : await supabase.from('rides').insert(tentData);
        if (error) {
          await tg('editMessageText', { chat_id: chatId, message_id: msgId, text: '⚠️ Не удалось добавить палатку. Возможно, ещё не применена миграция палаток (2026-tents-booking.sql).' });
          return res.status(200).json({ ok: true });
        }
        const tentBonus = myTent ? 0 : await awardPoints(tgId, POINTS_SHARE_TENT); // баллы только за новую палатку
        const grLabel = gender === 'male' ? 'только М' : gender === 'female' ? 'только Ж' : 'любые';
        await tg('editMessageText', {
          chat_id: chatId, message_id: msgId, parse_mode: 'HTML',
          text: `✅ Палатка добавлена: ${n} мест · подселение — ${grLabel}.\n\nУчастники увидят её в «🛌 Места в палатках» и смогут занять место.`
            + (tentBonus ? `\n\n🏅 <b>+${POINTS_SHARE_TENT} баллов</b> за то, что делишься палаткой! Всего: ${tentBonus}.` : ''),
        });
        return res.status(200).json({ ok: true });
      }
      // Список палаток + занять место.
      if (data.startsWith('tents_')) {
        const evId = data.slice('tents_'.length);
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
        const { data: allActive } = await supabase.from('rides').select('*').eq('event_id', evId).eq('active', true).order('created_at');
        const tents = (allActive || []).filter((r: any) => r.kind === 'tent');
        if (tents.length === 0) {
          await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: 'Пока никто не предложил палатку. Есть своя со свободными местами? Нажми «⛺ Своя палатка».', reply_markup: kb([[{ text: '⛺ Своя палатка', callback_data: `tentnew_${evId}` }]]) });
          return res.status(200).json({ ok: true });
        }
        const { data: myB } = await supabase.from('ride_bookings').select('ride_id').in('ride_id', tents.map((r: any) => r.id)).eq('passenger_id', tgId);
        const booked = new Set((myB || []).map((b: any) => b.ride_id));
        for (const t of tents) {
          const taken = (t as any).seats_taken || 0;
          const free = Math.max(0, ((t as any).seats_total || 0) - taken);
          const gr = (t as any).gender_rule === 'male' ? '♂ только М' : (t as any).gender_rule === 'female' ? '♀ только Ж' : '👥 любые';
          const mine = (t as any).driver_id === tgId;
          const rows: any[] = [];
          if (mine) rows.push([{ text: '❌ Убрать мою палатку', callback_data: `tentcancel_${(t as any).id}` }]);
          else if (booked.has((t as any).id)) rows.push([{ text: '❌ Освободить моё место', callback_data: `tunbook_${(t as any).id}` }]);
          else if (free > 0) rows.push([{ text: `✅ Занять место (${free} своб.)`, callback_data: `tbook_${(t as any).id}` }]);
          else rows.push([{ text: '🕐 Встать в очередь (мест нет)', callback_data: `rwait_${(t as any).id}` }]);
          await tg('sendMessage', {
            chat_id: chatId, parse_mode: 'HTML',
            text: `⛺ <b>Палатка ${esc((t as any).driver_name || '')}</b>\n💺 Свободно ${free} из ${(t as any).seats_total || 0} · подселение ${gr}`,
            reply_markup: rows.length ? kb(rows) : undefined,
          });
        }
        return res.status(200).json({ ok: true });
      }
      // Занять место в палатке (с проверкой правила подселения по категории заявки).
      if (data.startsWith('tbook_')) {
        const rideId = Number(data.slice('tbook_'.length));
        const { data: tent } = await supabase.from('rides').select('*').eq('id', rideId).maybeSingle();
        if (!tent || !(tent as any).active) { await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Палатка недоступна' }); return res.status(200).json({ ok: true }); }
        const gr = (tent as any).gender_rule || 'any';
        if (gr === 'male' || gr === 'female') {
          const { data: myReg } = await supabase.from('registrations').select('category').eq('event_id', (tent as any).event_id).eq('telegram_id', tgId).maybeSingle();
          const cat = (myReg as any)?.category;
          if (cat && cat !== gr) {
            await tg('answerCallbackQuery', { callback_query_id: cq.id, text: gr === 'male' ? 'Палатка только для мужчин' : 'Палатка только для женщин' });
            return res.status(200).json({ ok: true });
          }
        }
        const name = cq.from.first_name || cq.from.username || 'Гость';
        const { data: outcome } = await supabase.rpc('book_ride_seat', { p_ride_id: rideId, p_passenger: tgId, p_name: name });
        if (outcome !== 'ok') {
          const why = outcome === 'dup' ? 'Ты уже в этой палатке' : outcome === 'full' ? 'Мест уже нет' : outcome === 'gone' ? 'Палатка убрана' : 'Не получилось';
          await tg('answerCallbackQuery', { callback_query_id: cq.id, text: why });
          return res.status(200).json({ ok: true });
        }
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Место в палатке твоё ✅' });
        await tg('editMessageText', {
          chat_id: chatId, message_id: msgId, parse_mode: 'HTML',
          text: `✅ <b>Место в палатке «${esc((tent as any).driver_name || '')}» твоё.</b>\n\nХозяин уведомлён — он подскажет детали ночёвки.`,
          reply_markup: kb([[{ text: '❌ Освободить место', callback_data: `tunbook_${rideId}` }]]),
        });
        try {
          const { data: paxInfo } = await supabase.from('members').select('phone').eq('telegram_id', tgId).maybeSingle();
          await tg('sendMessage', {
            chat_id: (tent as any).driver_id, parse_mode: 'HTML',
            text: `⛺ <b>К тебе в палатку заселился ${esc(cq.from.first_name || '')}</b>${cq.from.username ? ` @${esc(cq.from.username)}` : ''}\n${(paxInfo as any)?.phone ? `📞 <code>${esc((paxInfo as any).phone)}</code>` : ''}`,
          });
        } catch { /* no-op */ }
        return res.status(200).json({ ok: true });
      }
      // Освободить место в палатке.
      if (data.startsWith('tunbook_')) {
        const rideId = Number(data.slice('tunbook_'.length));
        const { data: outcome } = await supabase.rpc('cancel_ride_seat', { p_ride_id: rideId, p_passenger: tgId });
        if (outcome !== 'ok') { await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Ты не занимал здесь место' }); return res.status(200).json({ ok: true }); }
        const { data: tent } = await supabase.from('rides').select('driver_id').eq('id', rideId).maybeSingle();
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Место освобождено' });
        await tg('editMessageText', { chat_id: chatId, message_id: msgId, text: '❌ Ты освободил место в палатке. Оно снова доступно.' });
        if (tent) { try { await tg('sendMessage', { chat_id: (tent as any).driver_id, parse_mode: 'HTML', text: `⛺ ${esc(cq.from.first_name || 'Участник')} освободил место в твоей палатке.` }); } catch { /* no-op */ } }
        await notifyWaitlist(rideId, 'tent');
        return res.status(200).json({ ok: true });
      }
      // Убрать свою палатку — уведомить заселившихся.
      if (data.startsWith('tentcancel_')) {
        const rideId = Number(data.slice('tentcancel_'.length));
        const { data: tent } = await supabase.from('rides').select('*').eq('id', rideId).maybeSingle();
        if (!tent || (tent as any).driver_id !== tgId) { await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Это не твоя палатка' }); return res.status(200).json({ ok: true }); }
        await supabase.from('rides').update({ active: false }).eq('id', rideId);
        const { data: pax } = await supabase.from('ride_bookings').select('passenger_id').eq('ride_id', rideId);
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Палатка убрана' });
        await tg('editMessageText', { chat_id: chatId, message_id: msgId, text: '❌ Твоя палатка убрана. Заселившиеся уведомлены.' });
        for (const p of (pax || [])) { try { await tg('sendMessage', { chat_id: (p as any).passenger_id, text: '⚠️ Хозяин убрал палатку, в которую ты заселился. Поищи место в «🛌 Места в палатках».' }); } catch { /* no-op */ } }
        return res.status(200).json({ ok: true });
      }

      await tg('answerCallbackQuery', { callback_query_id: cq.id });
      return res.status(200).json({ ok: true });
    }

    const msg = update.message || update.edited_message;

    // Фото/видео в сессии сбора медиа — в галерею события.
    // Файл остаётся в Telegram (file_id), в БД только метаданные.
    // Геопозиция пассажира для «заезжай за мной».
    if (msg?.from?.id && msg.location && msg.chat?.type === 'private') {
      const sessL = await getSession(msg.from.id);
      if (sessL?.state === 'pickup_loc' && sessL.context?.rideId) {
        await clearSession(msg.from.id);
        const { latitude, longitude } = msg.location;
        const ok = await sendPickupRequest(Number(sessL.context.rideId), msg.from, `${latitude}, ${longitude}`, latitude, longitude);
        await tg('sendMessage', { chat_id: msg.chat.id, text: ok ? '✅ Передал водителю твою точку — он ответит, сможет ли заехать.' : 'Не получилось передать водителю, напиши ему напрямую.' });
        return res.status(200).json({ ok: true });
      }
      // Геопозиция гостя (ответственный прислал точку, где забрать гостя).
      if (sessL?.state === 'guest_pickup' && sessL.context?.rideId) {
        await clearSession(msg.from.id);
        const { latitude, longitude } = msg.location;
        const rideId = Number(sessL.context.rideId);
        const { data: ride } = await supabase.from('rides').select('driver_id,driver_name').eq('id', rideId).maybeSingle();
        let ok = false;
        if (ride) {
          try {
            await tg('sendMessage', {
              chat_id: (ride as any).driver_id, parse_mode: 'HTML',
              text: `👥 <b>${esc(msg.from.first_name || 'Участник')} просит забрать своего гостя</b> по этой точке. За гостя отвечает он${msg.from.username ? ` @${esc(msg.from.username)}` : ''}. Сможешь подхватить?`,
              reply_markup: kb([
                [{ text: '🧭 Точка на карте', url: `https://yandex.ru/maps/?text=${latitude},${longitude}&z=16` }],
                [{ text: '✅ Заеду за гостем', callback_data: `gpyes_${msg.from.id}_${rideId}` }, { text: '❌ Не смогу', callback_data: `gpno_${msg.from.id}_${rideId}` }],
              ]),
            });
            ok = true;
          } catch { /* no-op */ }
        }
        await tg('sendMessage', { chat_id: msg.chat.id, text: ok ? '✅ Отправил точку водителю. Как ответит — сообщу.' : 'Не получилось связаться с водителем.' });
        return res.status(200).json({ ok: true });
      }
    }

    if (msg?.from?.id && (msg.photo || msg.video) && msg.chat?.type === 'private') {
      const sess = await getSession(msg.from.id);
      // Фото чека для общего расхода — сохраняем file_id и рассылаем всем.
      if (sess?.state === 'exp_photo' && sess.context?.evId && msg.photo) {
        const { evId, title, amount } = sess.context;
        const ph = Array.isArray(msg.photo) ? msg.photo[msg.photo.length - 1] : null;
        // Не рассылаем сразу: даём выбрать, на кого делить (все / выбранные).
        await setSession(msg.from.id, 'exp_split_pick', { evId, title, amount, photo: ph?.file_id || null, picked: [] });
        await tg('sendMessage', {
          chat_id: msg.chat.id, parse_mode: 'HTML',
          text: `💸 <b>${esc(String(title))}</b> — <b>${amount} BYN</b>, чек есть.\nНа кого делим?`,
          reply_markup: kb([[{ text: '👥 На всех участников', callback_data: 'expall' }], [{ text: '☑️ Выбрать людей', callback_data: 'exppick' }]]),
        });
        return res.status(200).json({ ok: true });
      }
      // Подтверждение перевода скриншотом: сохраняем фото и показываем получателю.
      if (sess?.state === 'pay_proof' && sess.context?.evId && msg.photo) {
        const { evId, trId, from_name, to_name, amount } = sess.context;
        const ph = Array.isArray(msg.photo) ? msg.photo[msg.photo.length - 1] : null;
        const fileId = ph?.file_id || null;
        await clearSession(msg.from.id);
        // Обновляем статус перевода на "sent" и сохраняем фото.
        try {
          const { data: evRow } = await supabase.from('events').select('shopping').eq('id', evId).maybeSingle();
          const shopping = (evRow as any)?.shopping || {};
          const split = shopping.split || {};
          const transfers: any[] = Array.isArray(split.transfers) ? split.transfers : [];
          const t = transfers.find((x: any) => String(x.id) === trId);
          if (t) {
            t.status = 'sent';
            t.sent_at = new Date().toISOString();
            t.proof_photo = fileId;
            await supabase.from('events').update({ shopping: { ...shopping, split: { ...split, transfers } } }).eq('id', evId);
          }
        } catch { /* no-op */ }
        await tg('answerCallbackQuery', { callback_query_id: '', text: 'Скриншот отправлен' });
        await tg('sendMessage', {
          chat_id: msg.chat.id, parse_mode: 'HTML',
          text: `✅ <b>Скриншот перевода отправлен</b> ${esc(to_name)} на проверку.\n\nПеревод: <b>${amount} BYN</b>\nСобытие: ${esc((await getEvent(evId))?.title || evId)}\n\nПолучатель подтвердит получение.`,
        });
        // Отправляем получателю скриншот с кнопками подтверждения.
        try {
          const { data: evRow2 } = await supabase.from('events').select('title,shopping').eq('id', evId).maybeSingle();
          const shopping2 = (evRow2 as any)?.shopping || {};
          const split2 = shopping2.split || {};
          const transfers2: any[] = Array.isArray(split2.transfers) ? split2.transfers : [];
          const t2 = transfers2.find((x: any) => String(x.id) === trId);
          if (t2) {
            const caption =
              `💸 <b>${esc(from_name)}</b> отправил(а) тебе <b>${amount} BYN</b> (событие «${esc((evRow2 as any)?.title || '')}»).\n\n` +
              `Проверь скриншот и подтверди получение.`;
            const markup = kb([[
              { text: '✅ Получил', callback_data: `payc_${evId}_${trId}` },
              { text: '❌ Не получал', callback_data: `payx_${evId}_${trId}` },
            ]]);
            if (fileId) await tg('sendPhoto', { chat_id: Number(t2.to), photo: fileId, parse_mode: 'HTML', caption, reply_markup: markup });
            else await tg('sendMessage', { chat_id: Number(t2.to), parse_mode: 'HTML', text: caption, reply_markup: markup });
          }
        } catch { /* получатель мог не открыть бота */ }
        return res.status(200).json({ ok: true });
      }
      if (sess?.state === 'media_upload' && sess.context?.eventId) {
        const evId = String(sess.context.eventId);
        const src = msg.video || (Array.isArray(msg.photo) ? msg.photo[msg.photo.length - 1] : null);
        if (src?.file_id) {
          const { count } = await supabase
            .from('event_media').select('id', { count: 'exact', head: true })
            .eq('event_id', evId).eq('telegram_id', msg.from.id);
          if ((count || 0) >= 30) {
            await tg('sendMessage', { chat_id: msg.chat.id, text: 'Лимит 30 файлов на человека — этого хватит для галереи 🙌' });
            return res.status(200).json({ ok: true });
          }
          const { error } = await supabase.from('event_media').insert({
            event_id: evId,
            telegram_id: msg.from.id,
            file_id: src.file_id,
            file_unique_id: src.file_unique_id,
            media_type: msg.video ? 'video' : 'photo',
          });
          // 23505 = дубликат (unique event_id+file_unique_id) — не ошибка.
          if (error && !String(error.code) .includes('23505')) {
            await tg('sendMessage', { chat_id: msg.chat.id, text: 'Не получилось сохранить, попробуй ещё раз.' });
          } else {
            await tg('sendMessage', {
              chat_id: msg.chat.id,
              text: error ? 'Это фото уже в галерее 😉' : `✅ В галерее! (${(count || 0) + 1}/30) Шли ещё или жми /start, когда закончишь.`,
            });
          }
        }
        return res.status(200).json({ ok: true });
      }
    }

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

      // Групповые чаты: ИИ-менеджер анализирует переписку и помогает с организацией.
      if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
        const gcmd = text.split(' ')[0].split('@')[0];
        
        // /link — привязка чата к событию (только костяк)
        if (gcmd === '/link') {
          if (!(await isCore(msg.from.id))) {
            await tg('sendMessage', { chat_id: chatId, text: 'Привязывать чат к событию может только костяк клуба.' });
            return res.status(200).json({ ok: true });
          }
          const { data: evs } = await supabase
            .from('events').select('id,title,date')
            .eq('status', 'open').order('date', { ascending: true }).limit(6);
          if (!evs || !evs.length) {
            await tg('sendMessage', { chat_id: chatId, text: 'Нет открытых событий для привязки.' });
            return res.status(200).json({ ok: true });
          }
          const rows = evs.map((e: any) => [{ text: `${e.title} · ${whenPhrase(e.date)}`, callback_data: `bindchat_${e.id}` }]);
          await tg('sendMessage', {
            chat_id: chatId, parse_mode: 'HTML',
            text: '💬 <b>Привязка чата к событию</b>\n\nВыбери событие — в его карточке появится кнопка «Чат события» с инвайт-ссылкой сюда:',
            reply_markup: kb(rows),
          });
          return res.status(200).json({ ok: true });
        }

        // ИИ-менеджер: анализ переписки → автоматические действия
        // Определяем событие по чату (берём из events.telegram_bot_url)
        const chatLink = `https://t.me/${(msg.chat as any).username || ''}`;
        const { data: linkedEvent } = chatLink
          ? await supabase.from('events').select('id,title,date').ilike('telegram_bot_url', `%${chatLink}%`).maybeSingle()
          : { data: null };
        
        // Сохраняем историю сообщений для обучения (только участники события)
        if (linkedEvent && msg.from?.id) {
          const { data: isParticipant } = await supabase
            .from('registrations')
            .select('id')
            .eq('event_id', (linkedEvent as any).id)
            .eq('telegram_id', msg.from.id)
            .neq('status', 'cancelled')
            .maybeSingle();
          
          if (isParticipant) {
            try {
              await supabase.from('group_chat_history').insert({
                event_id: (linkedEvent as any).id,
                chat_id: String(chatId),
                telegram_id: msg.from.id,
                username: msg.from.username || null,
                first_name: msg.from.first_name || null,
                message_text: text.slice(0, 2000),
                message_id: msg.message_id,
              });
            } catch { /* дубли по message_id — норм */ }
          }
        }

        // Триггеры для автоматических действий ИИ
        // 1. Кто-то предлагает что-то взять/привезти → задача
        const offerPattern = /\b(я\s+(возьму|привезу|могу\s+взять|беру)|у\s+меня\s+есть)\b/i;
        if (linkedEvent && offerPattern.test(text) && text.length > 15) {
          // Извлекаем предмет через ИИ
          try {
            const aiResp = await geminiText(
              `Сообщение участника: "${text}"\n\nОн предлагает что-то взять/привезти. Извлеки ПРЕДМЕТ (что именно) и верни ТОЛЬКО его название (до 100 символов), без пояснений.\nЕсли не понял — верни пустую строку.`
            );
            const item = aiResp.trim().slice(0, 100);
            if (item && item.length > 3) {
              // Создаём задачу автоматом и сразу берём на участника
              const { data: created } = await supabase
                .from('tasks')
                .insert({
                  event_id: (linkedEvent as any).id,
                  title: `${item} (${msg.from.first_name || 'участник'})`,
                  created_by: msg.from.id,
                  taken_by: msg.from.id,
                  done: false,
                })
                .select('id')
                .single();
              
              if (created) {
                await tg('sendMessage', {
                  chat_id: chatId,
                  parse_mode: 'HTML',
                  text: `✅ Отлично! Записал задачу: <b>${esc(item)}</b> — ${esc(msg.from.first_name || 'участник')} берёт.`,
                });
              }
            }
          } catch { /* ИИ недоступен — пропускаем */ }
        }

        // 2. Вопрос про логистику (машина, места, доехать) → подсказка с кнопкой
        const logisticsPattern = /\b(машин|мест|доехать|довезти|подвезти|попутка|как\s+добраться)\b/i;
        if (linkedEvent && logisticsPattern.test(text)) {
          const { data: rides } = await supabase
            .from('rides')
            .select('driver_name,from_point,seats_total,seats_taken')
            .eq('event_id', (linkedEvent as any).id)
            .eq('active', true)
            .neq('kind', 'tent');
          
          const freeSeats = (rides || []).reduce((s: number, r: any) => s + Math.max(0, (r.seats_total || 0) - (r.seats_taken || 0)), 0);
          
          if (freeSeats > 0) {
            await tg('sendMessage', {
              chat_id: chatId,
              parse_mode: 'HTML',
              text: `🚗 Есть ${freeSeats} своб. ${freeSeats === 1 ? 'место' : 'мест'} в машинах. Открой бота → Логистика и бронируй 👇`,
              reply_markup: kb([[{ text: '🚗 Логистика и брони', callback_data: `logi_${(linkedEvent as any).id}` }]]),
            });
          }
        }

        // 3. Обсуждение времени/места сбора → предложение голосования
        const votingPattern = /\b(когда\s+(выезжаем|собираемся|встречаемся)|во\s+сколько|где\s+сбор|какое\s+время)\b/i;
        if (linkedEvent && votingPattern.test(text) && text.includes('?')) {
          // Только если нет активных голосований по этой теме
          const { count } = await supabase
            .from('polls')
            .select('id', { count: 'exact', head: true })
            .eq('event_id', (linkedEvent as any).id)
            .or('options->>status.eq.open,options->>status.is.null');
          
          if ((count || 0) === 0) {
            await tg('sendMessage', {
              chat_id: chatId,
              parse_mode: 'HTML',
              text: `🗳 Вижу вопрос про время/место. Хотите запустить голосование? Откройте бота → событие → 🗳 Голосования → Предложить своё.`,
            });
          }
        }

        // 4. Жалоба на проблему/нехватку чего-то → SOS организатору
        const problemPattern = /\b(проблема|беда|не\s+хватает|забыли|потеряли|сломалось)\b/i;
        if (linkedEvent && problemPattern.test(text)) {
          const { data: ev } = await supabase.from('events').select('deputy_id').eq('id', (linkedEvent as any).id).maybeSingle();
          const orgId = (ev as any)?.deputy_id || 377551019;
          
          try {
            await tg('sendMessage', {
              chat_id: orgId,
              parse_mode: 'HTML',
              text: `⚠️ <b>Возможная проблема в чате</b>\n${esc((linkedEvent as any).title)}\n\n${esc(msg.from.first_name || 'Участник')}: "${esc(text.slice(0, 200))}"\n\nСтоит заглянуть в чат.`,
            });
          } catch { /* no-op */ }
        }

        // 5. Обучение: сохраняем паттерны решений для будущих событий
        if (linkedEvent && text.length > 20) {
          // ИИ извлекает действие + результат из переписки
          const { data: recent } = await supabase
            .from('group_chat_history')
            .select('message_text,first_name')
            .eq('event_id', (linkedEvent as any).id)
            .order('created_at', { ascending: false })
            .limit(10);
          
          const context = (recent || [])
            .reverse()
            .map((m: any) => `${m.first_name}: ${m.message_text}`)
            .join('\n');
          
          // Каждые N сообщений анализируем контекст и сохраняем паттерн
          if (recent && recent.length >= 8 && Math.random() < 0.1) {
            try {
              const pattern = await geminiText(
                `Контекст переписки группы:\n${context}\n\nИзвлеки ПАТТЕРН РЕШЕНИЯ проблемы/организации (если есть):\n` +
                `{"problem":"проблема","solution":"решение","category":"логистика|закупка|снаряжение|программа"}\n` +
                `Если паттерна нет — верни пустую строку. Только JSON, без пояснений.`
              );
              
              const match = pattern.match(/\{.*\}/s);
              if (match) {
                const parsed = JSON.parse(match[0]);
                if (parsed.problem && parsed.solution) {
                  await supabase.from('learned_patterns').insert({
                    event_id: (linkedEvent as any).id,
                    category: parsed.category || 'other',
                    problem: String(parsed.problem).slice(0, 300),
                    solution: String(parsed.solution).slice(0, 500),
                    context_snippet: context.slice(0, 1000),
                  });
                }
              }
            } catch { /* обучение best-effort */ }
          }
        }

        return res.status(200).json({ ok: true });
      }

        // Пошаговый ввод (заявка поездки) — если активна сессия и это не команда.
      if (!text.startsWith('/')) {
        const sess = await getSession(msg.from.id);
        // Ввод реквизитов карты
        if (sess && sess.state === 'paymethod_card_details') {
          const evId = sess.context?.evId;
          const details = String(text).trim().slice(0, 200);
          if (!details || details.length < 5) {
            await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: 'Слишком коротко. Напиши номер телефона, карты или счёта.\n<i>Например: +375291234567 (Альфа-Банк)</i>' });
            return res.status(200).json({ ok: true });
          }
          // Сохраняем в prefs
          await supabase.from('members').update({
            prefs: { payment: { method: 'card', details } }
          }).eq('telegram_id', msg.from.id);
          await clearSession(msg.from.id);
          await setSession(msg.from.id, 'exp_add', { evId, payment: { method: 'card', details } });
          await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `💳 Запомнил реквизиты: <b>${esc(details)}</b>\n\n💸 Что купил(а) и на какую сумму? Напиши одной строкой: название и сумма в BYN.\n<i>Например: «Мясо 45.50» или «Угли и розжиг 18»</i>` });
          return res.status(200).json({ ok: true });
        }
        if (sess && sess.state === 'ride_point') {
          await setSession(msg.from.id, 'ride_depart', { ...sess.context, from: text.slice(0, 120) });
          // Подставляем дату события — чтобы не лезть в календарь.
          const evD = await getEvent(sess.context?.evId);
          const dayLbl = evD ? (evD.date_label || dayPhrase(evD.date)) : '';
          const example = evD ? `${dayPhrase(evD.date)}, 08:00` : '18 июля, 08:00';
          await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `🕐 <b>Когда выезжаешь?</b>${dayLbl ? `\nСобытие: <b>${esc(dayLbl)}</b>${evD?.time ? `, старт в ${esc(evD.time)}` : ''}.` : ''}\nНапиши дату и время выезда — напр. «${esc(example)}».` });
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
          // Ещё один шаг — пол (для статистики М/Ж и расселения по палаткам).
          await setSession(msg.from.id, 'apply_gender', { ...sess.context, source: text.slice(0, 200) });
          await tg('sendMessage', {
            chat_id: chatId, parse_mode: 'HTML',
            text: 'И совсем последнее — укажи пол. Нужно для логистики (расселение по палаткам) и статистики события.',
            reply_markup: kb([[
              { text: '👨 Мужской', callback_data: 'applyg_male' },
              { text: '👩 Женский', callback_data: 'applyg_female' },
            ]]),
          });
          return res.status(200).json({ ok: true });
        }

        // ── Гейтинг закрытого события: ввод кода для просмотра ───────────────
        if (sess && sess.state === 'access_code_check') {
          const ev = await getEvent(sess.context.eventId);
          if (!ev) {
            await clearSession(msg.from.id);
            await tg('sendMessage', { chat_id: chatId, text: 'Событие не найдено.' });
            return res.status(200).json({ ok: true });
          }
          const provided = text.trim().toLowerCase();
          const expected = String(ev.access_code || '').trim().toLowerCase();
          if (!expected || provided !== expected) {
            await tg('sendMessage', { chat_id: chatId, text: '❌ Неверный код. Попробуй снова (одно слово без пробелов).' });
            return res.status(200).json({ ok: true });
          }
          // Код верный — показываем карточку
          await clearSession(msg.from.id);
          const registered = await hasActiveReg(ev.id, msg.from.id);
          await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: eventCard(ev), reply_markup: kb(eventCardButtons(ev, openBtn, registered)) });
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

        // Причина отказа из RSVP-напоминания: снимаем с события + пингуем оргов.
        if (sess && sess.state === 'rsvp_reason') {
          const evId = sess.context?.evId;
          const ev = await getEvent(evId);
          await clearSession(msg.from.id);
          const { data: reg } = await supabase
            .from('registrations').select('id')
            .eq('event_id', evId).eq('telegram_id', msg.from.id).neq('status', 'cancelled').maybeSingle();
          if (reg) {
            await supabase.from('registrations').update({ status: 'cancelled' }).eq('id', (reg as any).id);
          }
          const who = `${esc(msg.from.first_name || '')} ${msg.from.username ? '@' + esc(msg.from.username) : `(id ${msg.from.id})`}`;
          if (ADMIN_CHAT_ID) {
            await tg('sendMessage', {
              chat_id: ADMIN_CHAT_ID, parse_mode: 'HTML',
              text: `🚫 <b>Снялся с события</b>\n${esc(ev?.title || evId)}\nКто: ${who}\n\nПричина: <i>${esc(text.slice(0, 800))}</i>`,
            });
          }
          await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: '✅ Понял, снял тебя с события — место освободилось для других. Спасибо, что предупредил(а)! Захочешь вернуться — открой событие заново.' });
          return res.status(200).json({ ok: true });
        }

        // Контроль гостей: пришло новое число гостей (из кнопки «Изменить число»).
        if (sess && sess.state === 'guest_edit') {
          const evId = sess.context?.evId;
          const from = Number(sess.context?.from) || 0;
          const ev = await getEvent(evId);
          const to = Math.max(0, Math.min(50, parseInt(String(text).replace(/[^\d]/g, ''), 10) || 0));
          await updateReg(evId, msg.from.id, { guest_count: to });
          if (to < from) {
            // Стало меньше — спросим причину и запомним дельту для оргов.
            await setSession(msg.from.id, 'guest_reason', { evId, from, to });
            await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `Обновил: с тобой теперь <b>+${to}</b> вместо +${from}. Напиши пару слов — почему меньше? (или «-», если без причины). Это поможет организаторам с закупкой и логистикой.` });
          } else {
            await clearSession(msg.from.id);
            const who = `${esc(msg.from.first_name || '')} ${msg.from.username ? '@' + esc(msg.from.username) : `(id ${msg.from.id})`}`;
            if (ADMIN_CHAT_ID && to !== from) {
              await tg('sendMessage', { chat_id: ADMIN_CHAT_ID, parse_mode: 'HTML', text: `👥 <b>Изменил число гостей</b>\n${esc(ev?.title || evId)}\nКто: ${who}\nБыло +${from} → стало <b>+${to}</b>` });
            }
            await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: to > 0 ? `✅ Готово! С тобой будет <b>+${to}</b>. За гостей отвечаешь и оплачиваешь ты.` : '✅ Готово, отметил что едешь один.' });
          }
          return res.status(200).json({ ok: true });
        }

        // Причина, почему гостей стало меньше — пингуем оргов.
        if (sess && sess.state === 'guest_reason') {
          const { evId, from, to } = sess.context || {};
          const ev = await getEvent(evId);
          await clearSession(msg.from.id);
          const who = `${esc(msg.from.first_name || '')} ${msg.from.username ? '@' + esc(msg.from.username) : `(id ${msg.from.id})`}`;
          const reason = String(text).trim() === '-' ? '—' : esc(String(text).slice(0, 600));
          if (ADMIN_CHAT_ID) {
            await tg('sendMessage', { chat_id: ADMIN_CHAT_ID, parse_mode: 'HTML', text: `👥 <b>Убавил гостей</b>\n${esc(ev?.title || evId)}\nКто: ${who}\nБыло +${from} → стало <b>+${to}</b>\nПричина: <i>${reason}</i>` });
          }
          await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: '✅ Спасибо, учли! Места освободились для других.' });
          return res.status(200).json({ ok: true });
        }

        // Ответственный описал гостя и точку → шлём запрос выбранному водителю.
        if (sess && sess.state === 'guest_pickup') {
          const rideId = Number(sess.context?.rideId);
          await clearSession(msg.from.id);
          const info = String(text).trim().slice(0, 300);
          const { data: ride } = await supabase.from('rides').select('driver_id,driver_name,from_point,depart_text').eq('id', rideId).maybeSingle();
          if (!ride) { await tg('sendMessage', { chat_id: chatId, text: 'Машина не найдена, выбери заново в «👥 Мои гости».' }); return res.status(200).json({ ok: true }); }
          const m = info.match(/(-?\d+[.,]\d+)[,;\s]+(-?\d+[.,]\d+)/);
          const mapUrl = m ? `https://yandex.ru/maps/?text=${m[1].replace(',', '.')},${m[2].replace(',', '.')}&z=16` : `https://yandex.ru/maps/?text=${encodeURIComponent(info)}`;
          let ok = false;
          try {
            await tg('sendMessage', {
              chat_id: (ride as any).driver_id, parse_mode: 'HTML',
              text: `👥 <b>${esc(msg.from.first_name || 'Участник')} просит забрать своего гостя по пути</b>\n\n${esc(info)}\n\nЗа гостя отвечает ${esc(msg.from.first_name || 'участник')}${msg.from.username ? ` @${esc(msg.from.username)}` : ''}. Сможешь подхватить?`,
              reply_markup: kb([
                [{ text: '🧭 Точка на карте', url: mapUrl }],
                [{ text: '✅ Заеду за гостем', callback_data: `gpyes_${msg.from.id}_${rideId}` }, { text: '❌ Не смогу', callback_data: `gpno_${msg.from.id}_${rideId}` }],
              ]),
            });
            ok = true;
          } catch { /* водитель мог не открыть бота */ }
          await tg('sendMessage', { chat_id: chatId, text: ok ? '✅ Отправил запрос водителю. Как ответит — сообщу. Гостю передай, что за посадку отвечаешь ты.' : 'Не получилось связаться с водителем, напиши ему напрямую.' });
          return res.status(200).json({ ok: true });
        }

        // Адрес текстом для «заезжай за мной».
        if (sess && sess.state === 'pickup_loc') {
          const rideId = Number(sess.context?.rideId);
          await clearSession(msg.from.id);
          const locText = String(text).trim().slice(0, 200);
          // Координаты в тексте («53.9, 27.5») — распарсим для точной ссылки на карту.
          const m = locText.match(/^(-?\d+(?:[.,]\d+)?)[,;\s]+(-?\d+(?:[.,]\d+)?)$/);
          const ok = await sendPickupRequest(rideId, msg.from, locText,
            m ? parseFloat(m[1].replace(',', '.')) : undefined,
            m ? parseFloat(m[2].replace(',', '.')) : undefined);
          await tg('sendMessage', { chat_id: chatId, text: ok ? '✅ Передал водителю твою точку — он ответит, сможет ли заехать.' : 'Не получилось передать водителю, напиши ему напрямую.' });
          return res.status(200).json({ ok: true });
        }

        // Постановка задачи: ИИ причёсывает + умная рассылка тем, кто может помочь.
        if (sess && sess.state === 'task_create') {
          const evId = sess.context?.evId;
          await clearSession(msg.from.id);
          const rawText = String(text).trim().slice(0, 800);
          if (!rawText) { await tg('sendMessage', { chat_id: chatId, text: 'Пустая задача — опиши, что нужно сделать.' }); return res.status(200).json({ ok: true }); }
          await createTaskFlow(evId, msg.from, chatId, rawText, true);
          return res.status(200).json({ ok: true });
        }

        // Организатор задал точку прибытия вручную → сохраняем в logistics.arrivalPoint
        if (sess && sess.state === 'admarrival_manual') {
          const evId = sess.context?.evId;
          await clearSession(msg.from.id);
          const ev = await getEvent(evId);
          const raw = String(text).trim().slice(0, 300);
          try {
            const lg = (ev as any)?.logistics || {};
            await supabase.from('events').update({ logistics: { ...lg, arrivalPoint: raw } }).eq('id', evId);
          } catch { /* no-op */ }
          const elig = await pollEligible(evId);
          const coords = raw.match(/(-?\d+[.,]\d+)[,\s]+(-?\d+[.,]\d+)/);
          const mapUrl = coords ? `https://yandex.ru/maps/?text=${coords[1].replace(',', '.')},${coords[2].replace(',', '.')}` : null;
          const msgText = `🏁 <b>Точка прибытия задана</b>\n\n${esc(raw)}\n\nТочка появилась в карточке события. Участники увидят её при следующем открытии.`;
          await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: msgText, reply_markup: mapUrl ? kb([[{ text: '🗺 Открыть на карте', url: mapUrl }]]) : undefined });
          return res.status(200).json({ ok: true });
        }

        // Организатор задал точку сбора вручную → рассылаем всем.
        if (sess && sess.state === 'admmeet_manual') {
          const evId = sess.context?.evId;
          await clearSession(msg.from.id);
          const ev = await getEvent(evId);
          const raw = String(text).trim().slice(0, 300);
          const m = raw.match(/(-?\d+[.,]\d+)[,;\s]+(-?\d+[.,]\d+)/);
          const coords = m ? `${m[1].replace(',', '.')}, ${m[2].replace(',', '.')}` : '';
          // Состав на точке: сколько людей (с гостями) и какие машины (модель/цвет).
          const [{ data: regsA }, { data: ridesA }] = await Promise.all([
            supabase.from('registrations').select('guest_count').eq('event_id', evId).neq('status', 'cancelled'),
            supabase.from('rides').select('driver_name,from_point,seats_total').eq('event_id', evId).eq('active', true).neq('kind', 'tent'),
          ]);
          const headA = (regsA || []).reduce((n: number, r: any) => n + 1 + (Number(r.guest_count) || 0), 0);
          const carsA = (ridesA || []).map((c: any) => `🚗 ${esc(c.driver_name || 'Водитель')}${c.from_point && !/\d+[.,]\d+/.test(c.from_point) ? ` (${esc(c.from_point)})` : ''}`).join('\n');
          const draft = `🧭 <b>Сбор колонны — «${esc((ev as any)?.title)}»</b>\n\n${esc(raw)}\n\n👥 Нас едет: <b>${headA}</b> (с гостями)\n${carsA ? `Машины:\n${carsA}\n` : ''}\nВстречаемся, знакомимся — и стартуем колонной!`;
          try {
            const lg = (ev as any)?.logistics || {};
            await supabase.from('events').update({ logistics: { ...lg, assemblyPoint: raw } }).eq('id', evId);
          } catch { /* no-op */ }
          const elig = await pollEligible(evId);
          const mapBtn = coords ? [[{ text: '🗺 Точка на карте', url: `https://yandex.ru/maps/?text=${encodeURIComponent(coords)}` }]] : [];
          await Promise.allSettled(elig.map((id) =>
            tg('sendMessage', { chat_id: id, parse_mode: 'HTML', text: draft, reply_markup: mapBtn.length ? kb(mapBtn) : undefined })
          ));
          await tg('sendMessage', { chat_id: chatId, text: `✅ Разослал ${elig.length} участникам и сохранил в логистику.` });
          return res.status(200).json({ ok: true });
        }

        // Постановщик описал, что доделать → передаём исполнителю.
        if (sess && sess.state === 'task_fix') {
          const taskId = Number(sess.context?.taskId);
          await clearSession(msg.from.id);
          const { data: t } = await supabase.from('tasks').select('*').eq('id', taskId).maybeSingle();
          const worker = Number((t as any)?.taken_by);
          if (t && worker) {
            try {
              await tg('sendMessage', {
                chat_id: worker, parse_mode: 'HTML',
                text: `🔁 <b>Нужно доделать</b> по задаче «${esc((t as any).title)}»:\n${esc(String(text).slice(0, 500))}\n\nКак закончишь — жми «Сделано».`,
                reply_markup: kb([[{ text: '✅ Сделано', callback_data: `donetask_${taskId}` }, { text: '↩️ Не смогу', callback_data: `droptask_${taskId}` }]]),
              });
            } catch { /* no-op */ }
            await tg('sendMessage', { chat_id: chatId, text: '📨 Передал исполнителю.' });
          } else {
            await tg('sendMessage', { chat_id: chatId, text: 'Исполнителя нет — задача уже в поиске.' });
          }
          return res.status(200).json({ ok: true });
        }

        // Ответ на уточняющий вопрос ИИ → создаём задачу с полными данными.
        if (sess && sess.state === 'task_clarify') {
          const { evId, raw } = sess.context || {};
          await clearSession(msg.from.id);
          const extra = String(text).trim();
          const full = extra && extra !== '-' ? `${raw}\nУточнение: ${extra}` : String(raw || '');
          await createTaskFlow(evId, msg.from, chatId, full.slice(0, 1000), false);
          return res.status(200).json({ ok: true });
        }

        // Свободный ввод снаряжения → ИИ парсит в структурированный список.
        if (sess && sess.state === 'gear_add') {
          const evId = sess.context?.evId;
          await clearSession(msg.from.id);
          const rawText = String(text).trim().slice(0, 500);
          if (!rawText) { 
            await tg('sendMessage', { chat_id: chatId, text: 'Пустой текст — напиши что берёшь с собой.' }); 
            return res.status(200).json({ ok: true }); 
          }
          
          await tg('sendMessage', { chat_id: chatId, text: '🤖 Обрабатываю список снаряжения...' });
          
          // ИИ парсит свободный текст в структурированный список с количеством.
          let items: Array<{item: string; quantity: number; category?: string}> = [];
          try {
            // geminiJSON: гарантированный JSON (текстовый вариант отвечал прозой через раз).
            const parsed = await geminiJSON(
              `Текст участника о снаряжении (надиктовка, возможны ошибки): "${rawText}"\n\n` +
              `Извлеки предметы. Верни JSON: {"items":[{"item":"название в ед. числе","quantity":число (указано «2 стула» → 2, иначе 1),"category":"палатка|посуда|инструмент|одежда|прочее"}]}`
            );
            const arr = Array.isArray(parsed) ? parsed : parsed?.items;
            if (Array.isArray(arr)) items = arr.slice(0, 20);
          } catch { 
            // Фолбэк: простой парсинг запятыми
            items = rawText.split(/[,;\n]+/).slice(0, 20).map(s => {
              const m = s.trim().match(/^(\d+)\s+(.+)$/);
              return m 
                ? { item: m[2].trim(), quantity: parseInt(m[1], 10), category: 'прочее' }
                : { item: s.trim(), quantity: 1, category: 'прочее' };
            }).filter(i => i.item.length > 0);
          }
          
          if (items.length === 0) {
            await tg('sendMessage', { chat_id: chatId, text: '🤔 Не смог распознать предметы. Попробуй написать списком через запятую или с новой строки.' });
            return res.status(200).json({ ok: true });
          }
          
          // Сохраняем в БД снаряжение участника
          for (const it of items) {
            try {
              // Upsert: если предмет уже есть — обновляем количество
              await supabase.from('member_equipment').upsert(
                { 
                  telegram_id: msg.from.id, 
                  item: it.item.slice(0, 100), 
                  quantity: Math.max(1, Math.min(99, it.quantity || 1)),
                  category: it.category || 'прочее',
                  updated_at: new Date().toISOString()
                },
                { onConflict: 'telegram_id,item' }
              );
            } catch { /* пропускаем дубли */ }
          }
          
          const summary = items.map(i => `✓ ${esc(i.item)}${i.quantity > 1 ? ` x${i.quantity}` : ''}`).join('\n');
          await tg('sendMessage', { 
            chat_id: chatId, 
            parse_mode: 'HTML', 
            text: `✅ <b>Снаряжение добавлено в твой инвентарь:</b>\n\n${summary}\n\nТеперь оно будет показываться при регистрации на события. Редактировать можно в «🎒 Снаряжение».`,
            reply_markup: kb([[{ text: '⬅️ Назад к событию', callback_data: `org_${evId}` }]])
          });
          return res.status(200).json({ ok: true });
        }

        // Добавление варианта в открытое голосование → оповещаем участников.
        if (sess && sess.state === 'poll_addopt') {
          const pollId = Number(sess.context?.pollId);
          await clearSession(msg.from.id);
          const { data: poll } = await supabase.from('polls').select('*').eq('id', pollId).maybeSingle();
          if (!poll) { await tg('sendMessage', { chat_id: chatId, text: 'Голосование не найдено.' }); return res.status(200).json({ ok: true }); }
          const opts = (poll as any).options || {};
          if (opts.status && opts.status !== 'open') { await tg('sendMessage', { chat_id: chatId, text: 'Голосование уже завершено.' }); return res.status(200).json({ ok: true }); }
          const list: string[] = Array.isArray(opts.list) ? opts.list : [];
          const newOpt = String(text).trim().slice(0, 100);
          if (!newOpt) { await tg('sendMessage', { chat_id: chatId, text: 'Пустой вариант — напиши текст.' }); return res.status(200).json({ ok: true }); }
          if (list.length >= 10) { await tg('sendMessage', { chat_id: chatId, text: 'Уже 10 вариантов — больше не добавить.' }); return res.status(200).json({ ok: true }); }
          if (list.some((o) => o.toLowerCase() === newOpt.toLowerCase())) { await tg('sendMessage', { chat_id: chatId, text: 'Такой вариант уже есть.' }); return res.status(200).json({ ok: true }); }
          // Append сохраняет индексы существующих голосов (choice = позиция).
          const nextList = [...list, newOpt];
          await supabase.from('polls').update({ options: { ...opts, list: nextList } }).eq('id', pollId);
          const ev = await getEvent((poll as any).event_id);
          const { counts } = await pollTally(pollId, nextList.length);
          const eligible = await pollEligible((poll as any).event_id);
          await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `✅ Добавил вариант «${esc(newOpt)}» — разослал участникам.` });
          for (const id of eligible) {
            try {
              await tg('sendMessage', {
                chat_id: id, parse_mode: 'HTML',
                text: `➕ <b>${esc(msg.from.first_name || 'Участник')} добавил вариант</b> в голосование «${esc((poll as any).question)}»:\n<b>${esc(newOpt)}</b>\n\nПосмотри расклад и переголосуй, если хочешь:`,
                reply_markup: pollKeyboard(pollId, nextList, counts, false),
              });
            } catch { /* no-op */ }
          }
          return res.status(200).json({ ok: true });
        }

        // Предложение голосования: свободный текст → ИИ оформляет → рассылка.
        if (sess && sess.state === 'poll_create') {
          const evId = sess.context?.evId;
          await clearSession(msg.from.id);
          const ev = await getEvent(evId);
          await tg('sendMessage', { chat_id: chatId, text: '🤖 Оформляю голосование…' });
          let poll: any = null;
          try {
            const r = await fetch(`${site}/api/ai`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.ADMIN_TOKEN || ''}` },
              body: JSON.stringify({ task: 'poll', event: ev, text }),
            });
            poll = await r.json();
          } catch { /* сеть */ }
          if (!poll || poll.error || !Array.isArray(poll.options)) {
            await tg('sendMessage', { chat_id: chatId, text: 'Не получилось оформить голосование, попробуй сформулировать иначе.' });
            return res.status(200).json({ ok: true });
          }
          const optionsObj = { list: poll.options, status: 'open', winner: null, topic: poll.topic || '', summary: poll.summary || '' };
          const deadline = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
          const { data: created, error } = await supabase
            .from('polls').insert({ event_id: evId, question: poll.question, options: optionsObj, deadline, created_by: msg.from.id })
            .select('id').single();
          if (error || !created) {
            await tg('sendMessage', { chat_id: chatId, text: 'Не удалось сохранить голосование.' });
            return res.status(200).json({ ok: true });
          }
          await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `✅ Голосование создано и разослано участникам:\n\n<b>${esc(poll.question)}</b>\n${(poll.options as string[]).map((o) => `• ${esc(o)}`).join('\n')}` });
          await broadcastPoll((created as any).id, { event_id: evId, question: poll.question, options: optionsObj }, ev?.title || 'событие');
          return res.status(200).json({ ok: true });
        }

        // Незарегистрированные плательщики (текстом) → возвращаемся к чекбоксам.
        if (sess && sess.state === 'exp_extra') {
          const ctxX: any = sess.context || {};
          await setSession(msg.from.id, 'exp_split_pick', { ...ctxX, extra: String(text).trim().slice(0, 200) });
          await tg('sendMessage', {
            chat_id: chatId, parse_mode: 'HTML',
            text: `➕ Записал вне списка: <i>${esc(String(text).trim().slice(0, 200))}</i>\nЖми «✅ Готово» в сообщении выше (или «На всех»).`,
            reply_markup: kb([[{ text: '👥 На всех', callback_data: 'expall' }, { text: '✅ Готово (выбранные)', callback_data: 'expdone' }]]),
          });
          return res.status(200).json({ ok: true });
        }

        // Общий расход, шаг 1: парсим текст → [{title, amount}]
        if (sess && sess.state === 'exp_add') {
          const evId = sess.context?.evId;
          const raw = String(text).trim();
          // Сначала пробуем ИИ — он лучше всего разбирает свободный текст
          let items: Array<{title: string; amount: number}> = [];
          try {
            const { parseExpenseAI } = await import('./ai-helpers');
            const aiItems = await parseExpenseAI(raw);
            if (aiItems && aiItems.length > 0) {
              items = aiItems;
            }
          } catch { /* ИИ недоступен — fallback на regex */ }
          // Если ИИ не сработал — пробуем простой regex
          if (items.length === 0) {
            const regex = /([A-Za-zА-Яа-яЁё0-9\s\-]+?)\s*[—-]\s*(\d+(?:[.,]\d{1,2})?)\s*(?:br|byn?|byr?|бел(?:орусских)?\s*руб(?:лей)?|руб\.?|р\.?)?/gi;
            let match;
            while ((match = regex.exec(raw)) !== null) {
              const title = match[1].trim();
              const amount = parseFloat(match[2].replace(',', '.'));
              if (title && amount > 0 && /[a-zA-Zа-яё]/i.test(title) && title.length > 1) {
                items.push({ title: title.slice(0, 50), amount });
              }
            }
          }
          // Если нашли хотя бы одну позицию
          if (items.length > 0) {
            if (items.length === 1) {
              // Одна позиция — обычный флоу с фото чека
              await setSession(msg.from.id, 'exp_photo', { evId, title: items[0].title, amount: items[0].amount });
              await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `💸 <b>${esc(items[0].title)}</b> — <b>${items[0].amount} BYN</b>.\n\nПришли фото чека или скрин переписки с ценой — его увидят все.\nНет чека — напиши «без чека».` });
              return res.status(200).json({ ok: true });
            }
            // Несколько позиций — сначала спрашиваем "на кого делить"
            const summary = items.map(i => `• ${esc(i.title)} — <b>${i.amount} BYN</b>`).join('\n');
            const total = items.reduce((s: number, i: any) => s + i.amount, 0);
            // Проверяем, есть ли сохранённый выбор для этого пользователя на этом событии
            const { data: evRow } = await supabase.from('events').select('shopping').eq('id', evId).maybeSingle();
            const shopping = (evRow as any)?.shopping || {};
            const defaults = shopping.split_defaults || {};
            const savedChoice = defaults[String(msg.from.id)];
            if (savedChoice === 'all') {
              // Сохраняем все сразу на всех
              for (const item of items) {
                await saveAndBroadcastExpense(evId, msg.from, item.title, item.amount, null);
              }
              await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `✅ <b>${items.length} позиций сохранены и разосланы:</b>\n\n${summary}\n\nИтого: <b>${total} BYN</b>\n\nДоли посчитаем при подведении итогов — каждый платит за себя и своих гостей.` });
              return res.status(200).json({ ok: true });
            }
            // Спрашиваем — и запоминаем выбор
            await setSession(msg.from.id, 'exp_multi_split', { evId, items, picked: [] });
            await tg('sendMessage', {
              chat_id: chatId, parse_mode: 'HTML',
              text: `💸 <b>${items.length} позиций на общую сумму ${total} BYN</b>\n\n${summary}\n\nНа кого делим?`,
              reply_markup: kb([
                [{ text: '👥 На всех участников', callback_data: 'expallmulti' }],
                [{ text: '☑️ Выбрать людей', callback_data: 'exppickmulti' }],
              ]),
            });
            return res.status(200).json({ ok: true });
          }
          // Ничего не нашли — показываем примеры
          await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: 'Не разобрал 🙈\n\n<b>Формат:</b> <i>название — сумма</i>\n\nПримеры:\n• Мясо — 80 BYN\n• Маршмелоу — 18 BYN\n• Огурцы 1 кг — 5 BYN\n• Угли — 18 бел руб\n\nМожно несколько позиций в одном сообщении:\n• Мясо — 80, маршмелоу — 18, огурцы — 5 BYN' });
          return res.status(200).json({ ok: true });
        }

        // Общий расход, шаг 2 текстом: «без чека» — публикуем без фото.
        if (sess && sess.state === 'exp_photo') {
          const { evId, title, amount } = sess.context || {};
          if (/без\s*чека|нет|скип|skip|^-$/i.test(String(text).trim())) {
            await setSession(msg.from.id, 'exp_split_pick', { evId, title, amount, photo: null, picked: [] });
            await tg('sendMessage', {
              chat_id: chatId, parse_mode: 'HTML',
              text: `💸 <b>${esc(String(title))}</b> — <b>${amount} BYN</b> (без чека).\nНа кого делим?`,
              reply_markup: kb([[{ text: '👥 На всех участников', callback_data: 'expall' }], [{ text: '☑️ Выбрать людей', callback_data: 'exppick' }]]),
            });
          } else {
            await tg('sendMessage', { chat_id: chatId, text: 'Пришли фото чека (или напиши «без чека»).' });
          }
          return res.status(200).json({ ok: true });
        }

        // Замечание к закупке: копим в shopping.objections + пингуем оргов.
        if (sess && sess.state === 'shop_feedback') {
          const evId = sess.context?.evId;
          await clearSession(msg.from.id);
          const ev = await getEvent(evId);
          const note = String(text).slice(0, 600);
          try {
            const shopping = (ev as any)?.shopping || {};
            const objections = Array.isArray(shopping.objections) ? shopping.objections : [];
            objections.push({ tg_id: msg.from.id, name: msg.from.first_name || msg.from.username || '', text: note, at: new Date().toISOString() });
            await supabase.from('events').update({ shopping: { ...shopping, objections } }).eq('id', evId);
          } catch { /* best-effort */ }
          const who = `${esc(msg.from.first_name || '')} ${msg.from.username ? '@' + esc(msg.from.username) : `(id ${msg.from.id})`}`;
          if (ADMIN_CHAT_ID) {
            await tg('sendMessage', { chat_id: ADMIN_CHAT_ID, parse_mode: 'HTML', text: `✏️ <b>Замечание к закупке</b>\n${esc(ev?.title || evId)}\nКто: ${who}\n\n<i>${esc(note)}</i>` });
          }
          await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: '✅ Передал организаторам! Учтём и пришлём обновлённый список на согласование.' });
          return res.status(200).json({ ok: true });
        }

        // Марка и цвет авто при регистрации: сохраняем и продолжаем опрос.
        if (sess && sess.state === 'reg_car') {
          const evId = sess.context?.evId;
          const ev = await getEvent(evId);
          await clearSession(msg.from.id);
          const car = String(text).trim().slice(0, 120);
          if (car && car !== '-') await updateReg(evId, msg.from.id, { transport_details: car });
          if (foodNeeded(ev)) {
            await tg('sendMessage', {
              chat_id: chatId, parse_mode: 'HTML',
              text: `🚗 Записал: <b>${esc(car || 'авто')}</b>. Дальше — 🍽 твоё питание? (учтём в закупке)`,
              reply_markup: kb([
                [{ text: '🍗 Всеядный', callback_data: `rf:${evId}:all` }],
                [{ text: '🥗 Вегетарианец', callback_data: `rf:${evId}:veg` }],
                [{ text: '🌱 Веган', callback_data: `rf:${evId}:vegan` }],
                [{ text: '🥡 Привезу своё — без общей еды', callback_data: `rf:${evId}:own` }],
              ]),
            });
          } else {
            await tg('sendMessage', {
              chat_id: chatId, parse_mode: 'HTML',
              text: `✅ Готово! Авто: <b>${esc(car || '—')}</b>. Ты записан(а) на «<b>${esc(ev?.title || 'событие')}</b>».`,
              reply_markup: kb(eventCardButtons(ev, openBtn, true)),
            });
          }
          return res.status(200).json({ ok: true });
        }

        // «Другое число» гостей при регистрации: сохраняем и продолжаем опрос.
        if (sess && sess.state === 'reg_guest') {
          const evId = sess.context?.evId;
          const ev = await getEvent(evId);
          const n = Math.max(0, Math.min(50, parseInt(String(text).replace(/[^\d]/g, ''), 10) || 0));
          await updateReg(evId, msg.from.id, { guest_count: n });
          // Семейные события — уточним детей (учёт в еде). Иначе завершаем.
          // Детей соберёт callback rc:, он читает guest_count из БД — сессию чистим.
          await clearSession(msg.from.id);
          if (ev?.type === 'mixed') {
            await tg('sendMessage', {
              chat_id: chatId, parse_mode: 'HTML',
              text: `Принял: с тобой <b>+${n}</b>. 👶 Дети с тобой? (учтём в еде — детская порция)`,
              reply_markup: kb([[
                { text: 'Без детей', callback_data: `rc:${evId}:0` },
                { text: '1 ребёнок', callback_data: `rc:${evId}:1` },
                { text: '2+', callback_data: `rc:${evId}:2` },
              ]]),
            });
          } else {
            await tg('sendMessage', {
              chat_id: chatId, parse_mode: 'HTML',
              text: `✅ Готово! Ты записан(а)${n > 0 ? ` (+${n} гост${n === 1 ? 'ь' : 'я'})` : ''} на «<b>${esc(ev?.title || 'событие')}</b>».` +
                (n > 0 ? '\n<i>За гостей отвечаешь и оплачиваешь ты.</i>' : '') +
                '\n\nЛогистика, снаряжение и оплата — кнопки ниже.',
              reply_markup: kb(eventCardButtons(ev, openBtn, true)),
            });
          }
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

        // Постоянное меню внизу чата (новая структура по UX-аудиту).
        // Старые тексты кнопок тоже понимаем — клавиатура у людей кешируется.
        if (text === '⚙️ Панель организатора') {
          if (!(await isCore(msg.from.id))) { await tg('sendMessage', { chat_id: chatId, text: 'Только для костяка клуба.' }); return res.status(200).json({ ok: true }); }
          const { data: evsA } = await supabase.from('events').select('id,title,date').eq('status', 'open').order('date').limit(8);
          await tg('sendMessage', {
            chat_id: chatId, parse_mode: 'HTML',
            text: '⚙️ <b>Панель организатора</b>\nВыбери событие:',
            reply_markup: kb((evsA || []).map((e: any) => [{ text: `${e.title} · ${e.date}`, callback_data: `adm_${e.id}` }])),
          });
          return res.status(200).json({ ok: true });
        }
        if (text === '🏠 Главная') {
          await sendWelcome(chatId, openBtn, await isCore(msg.from.id));
          return res.status(200).json({ ok: true });
        }
        if (text === '🗓 Мои события') {
          await sendMyEvents(chatId, msg.from.id, openBtn);
          return res.status(200).json({ ok: true });
        }
        if (text === '📅 Все события' || text === '📅 Ближайшие события') {
          await sendEventsList(chatId, openBtn);
          return res.status(200).json({ ok: true });
        }
        if (text === 'ℹ️ Помощь' || text === '❓ Помощь') {
          await sendHelp(chatId);
          return res.status(200).json({ ok: true });
        }
        if (text === '👤 Мой статус' || text === '👤 Профиль') {
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
        // Кнопка «Афиша» (web_app) — только участникам клуба; остальным прячем,
        // чтобы не было обхода заявки через мини-апп.
        try {
          const approvedNow = await isApproved(msg.from.id);
          await tg('setChatMenuButton', approvedNow
            ? { chat_id: chatId, menu_button: { type: 'web_app', text: 'Афиша', web_app: { url: site } } }
            : { chat_id: chatId, menu_button: { type: 'default' } });
        } catch { /* no-op */ }
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
            const registered = await hasActiveReg(ev.id, msg.from.id);
            await tg('sendMessage', {
              chat_id: chatId,
              parse_mode: 'HTML',
              text: eventCard(ev),
              reply_markup: kb(eventCardButtons(ev, openBtn, registered)),
            });
            await tg('sendMessage', { chat_id: chatId, text: 'Меню всегда снизу 👇', reply_markup: mainMenu(await isCore(msg.from.id)) });
            return res.status(200).json({ ok: true });
          }
        }
        // Приветствие + открытые события кнопками (со сроком до старта).
        await sendWelcome(chatId, openBtn, await isCore(msg.from.id));
        await tg('sendMessage', { chat_id: chatId, text: 'Меню всегда снизу 👇', reply_markup: mainMenu(await isCore(msg.from.id)) });
        // Догоняем вернувшегося: анкета/задачи/голосования, где нет его реакции.
        await sendCatchup(chatId, msg.from.id);
        return res.status(200).json({ ok: true });
      }

      // Слэш-команды из меню бота. Кнопочные тексты обрабатываются выше —
      // они не начинаются с '/', поэтому сюда не доходят.
      const cmd = text.split(' ')[0].split('@')[0];

      // Профиль: баллы, реф-ссылка, счётчик приглашённых.
      if (cmd === '/profile') {
        await handleProfileCommand(msg, chatId, openBtn);
        return res.status(200).json({ ok: true });
      }
      if (cmd === '/events') {
        await sendEventsList(chatId, openBtn);
        return res.status(200).json({ ok: true });
      }
      if (cmd === '/help') {
        await sendHelp(chatId);
        return res.status(200).json({ ok: true });
      }
      // Панель организатора в боте: сплит, должники, пинг незаполнивших.
      if (cmd === '/admin') {
        if (!(await isCore(msg.from.id))) {
          await tg('sendMessage', { chat_id: chatId, text: 'Эта команда — только для костяка клуба.' });
          return res.status(200).json({ ok: true });
        }
        const { data: evs } = await supabase
          .from('events').select('id,title,date').eq('status', 'open').order('date').limit(8);
        if (!evs?.length) {
          await tg('sendMessage', { chat_id: chatId, text: 'Открытых событий нет.' });
          return res.status(200).json({ ok: true });
        }
        await tg('sendMessage', {
          chat_id: chatId, parse_mode: 'HTML',
          text: '⚙️ <b>Панель организатора</b>\nВыбери событие:',
          reply_markup: kb(evs.map((e: any) => [{ text: `${e.title} · ${e.date}`, callback_data: `adm_${e.id}` }])),
        });
        return res.status(200).json({ ok: true });
      }
      if (cmd === '/diet') {
        await sendDietPrompt(chatId);
        return res.status(200).json({ ok: true });
      }
      if (cmd === '/preferences') {
        await sendPreferencesPrompt(chatId);
        return res.status(200).json({ ok: true });
      }
      // ИИ-планировщик: /plan <что хотим> — только костяк.
      if (cmd === '/plan') {
        if (!(await isCore(msg.from.id))) {
          await tg('sendMessage', { chat_id: chatId, text: 'Планировщик доступен только костяку клуба.' });
          return res.status(200).json({ ok: true });
        }
        const intent = text.slice(cmd.length).trim();
        if (!intent) {
          await tg('sendMessage', {
            chat_id: chatId, parse_mode: 'HTML',
            text: '🤖 <b>ИИ-планировщик</b>\n\nОпиши намерение — соберу сценарий по реальным данным клуба (люди, машины, питание, снаряжение).\n\nПример:\n<code>/plan скалы в следующие выходные, человек 10</code>',
          });
          return res.status(200).json({ ok: true });
        }
        await tg('sendMessage', { chat_id: chatId, text: '🤖 Собираю данные клуба и думаю над сценарием… (~15 сек)' });
        const plan = await composePlan(intent);
        if (!plan) {
          await tg('sendMessage', { chat_id: chatId, text: 'ИИ сейчас недоступен — попробуй ещё раз через минуту.' });
          return res.status(200).json({ ok: true });
        }
        // Telegram-лимит 4096 на сообщение — режем по абзацам.
        let rest = plan;
        while (rest.length) {
          let cut = rest.length <= 3800 ? rest.length : rest.lastIndexOf('\n', 3800);
          if (cut <= 0) cut = 3800;
          await tg('sendMessage', { chat_id: chatId, text: rest.slice(0, cut) });
          rest = rest.slice(cut).trimStart();
        }
        return res.status(200).json({ ok: true });
      }

      // ⚡ ИИ-консьерж Flint: свободный вопрос → ответ из живых данных события.
      // Закрывает «я как попугай»: сколько машин/мест, когда выезд, что по
      // программе — бот отвечает сам, организатора не дёргают.
      try {
        const { data: myRegs } = await supabase
          .from('registrations').select('event_id').eq('telegram_id', msg.from.id).neq('status', 'cancelled');
        const myEvIds = (myRegs || []).map((r: any) => r.event_id);
        const { data: evs } = await supabase
          .from('events').select('*').eq('status', 'open').order('date').limit(5);
        const ev = (evs || []).find((e: any) => myEvIds.includes(e.id)) || (evs || [])[0];
        if (ev && text.length > 3) {
          const [{ data: regs }, { data: rides }, { data: evTasks }] = await Promise.all([
            supabase.from('registrations').select('name,guest_count,notes,has_transport').eq('event_id', (ev as any).id).neq('status', 'cancelled'),
            supabase.from('rides').select('driver_name,from_point,depart_text,seats_total,seats_taken,kind').eq('event_id', (ev as any).id).eq('active', true),
            supabase.from('tasks').select('title,taken_by,done').eq('event_id', (ev as any).id).limit(10),
          ]);
          const people = (regs || []).length;
          const guests = (regs || []).reduce((s: number, r: any) => s + (Number(r.guest_count) || 0), 0);
          const cars = (rides || []).filter((r: any) => r.kind !== 'tent');
          const tents = (rides || []).filter((r: any) => r.kind === 'tent');
          const freeSeats = cars.reduce((s: number, c: any) => s + Math.max(0, (c.seats_total || 0) - (c.seats_taken || 0)), 0);
          const ctx =
            `Событие: ${(ev as any).title}, ${(ev as any).date_label || (ev as any).date}${(ev as any).time ? `, старт ${(ev as any).time}` : ''}. Локация: ${(ev as any).location || '—'}.\n` +
            `Участников: ${people} (+${guests} гостей). Машины (${cars.length}): ${cars.map((c: any) => `${c.driver_name} из ${c.from_point}, ${c.depart_text}, свободно ${Math.max(0, (c.seats_total || 0) - (c.seats_taken || 0))}`).join('; ') || 'нет'}. Свободных мест всего: ${freeSeats}. Палатки: ${tents.length}.\n` +
            `Программа: ${(((ev as any).program || []) as string[]).slice(0, 12).join('; ') || '—'}.\n` +
            `Задачи: ${(evTasks || []).map((t: any) => `${t.title} (${t.done ? 'сделана' : t.taken_by ? 'в работе' : 'свободна'})`).join('; ') || 'нет'}.`;
          const ans = await geminiText(
            `Ты — Flint, умный помощник закрытого клуба «Живи в моменте» (Минск, 100% трезвость). Отвечай кратко (до 500 символов), дружелюбно, по-русски, ТОЛЬКО на основе данных ниже. Если ответа в данных нет — скажи, где посмотреть в боте (кнопки: Логистика, Программа, Голосования, Задачи, Расходы) или предложи спросить организатора кнопкой ❓ в событии.\n\nДАННЫЕ:\n${ctx}\n\nВОПРОС УЧАСТНИКА: «${text.slice(0, 300)}»`
          );
          if (ans && ans.trim()) {
            await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `⚡ ${esc(ans.trim().slice(0, 900))}`, reply_markup: mainMenu() });
            return res.status(200).json({ ok: true });
          }
        }
      } catch { /* фолбэк ниже */ }

      await tg('sendMessage', {
        chat_id: chatId,
        text: 'Не понял 🙈 Спроси меня о событии своими словами — отвечу. Или пользуйся кнопками меню 👇',
        reply_markup: mainMenu(),
      });
      return res.status(200).json({ ok: true });
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(200).json({ ok: true, error: (err as Error).message });
  }
}
