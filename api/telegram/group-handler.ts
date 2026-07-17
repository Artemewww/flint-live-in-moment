/**
 * ИИ-эксперт группового чата: молча копит историю, а отвечает только когда
 * беседа затихла (дебаунс-пауза) — один вдумчивый ответ вместо реплик на
 * каждое сообщение. Контекст: событие, участники, голосования, логистика,
 * задачи, расходы.
 */

import { createClient } from '@supabase/supabase-js';
import { aiJSON } from './ai-helpers';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

// Пауза тишины, после которой бот считает, что все высказались.
// Больше нельзя: у функции maxDuration 60с, нужен запас на анализ и ответ.
const PAUSE_MS = 40_000;
// Не отвечать чаще, чем раз в полторы минуты — эксперт, а не тамада.
const COOLDOWN_MS = 90_000;

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function saveMessage(chatId: number, msg: any, text: string) {
  await supabase.from('group_messages').upsert({
    chat_id: chatId,
    message_id: msg.message_id,
    telegram_id: msg.from.id,
    username: msg.from.username || null,
    first_name: msg.from.first_name || null,
    text: text.slice(0, 2000),
    replied_to: msg.reply_to_message?.message_id || null,
    created_at: new Date().toISOString(),
  }, { onConflict: 'chat_id,message_id' });
}

/** Привязка чата: event_groups, а если пусто — автопривязка по единственному
 *  открытому событию с настоящей инвайт-ссылкой группы (t.me/+…). */
async function resolveEventId(chatId: number, chatTitle?: string): Promise<string | null> {
  const { data: linked } = await supabase
    .from('event_groups').select('event_id').eq('chat_id', chatId).eq('active', true).maybeSingle();
  if (linked) return (linked as any).event_id;
  const { data: candidates } = await supabase
    .from('events').select('id,telegram_bot_url')
    .eq('status', 'open').ilike('telegram_bot_url', '%t.me/+%');
  if ((candidates || []).length === 1) {
    const evId = (candidates as any)[0].id;
    await linkGroupToEvent(chatId, evId, chatTitle);
    return evId;
  }
  return null;
}

async function logAction(chatId: number, eventId: string, type: string, trigger: string, response: string, data?: any) {
  await supabase.from('bot_group_actions').insert({
    chat_id: chatId,
    event_id: eventId,
    action_type: type,
    trigger_text: trigger.slice(0, 300),
    response_text: response.slice(0, 500),
    data: data || null,
  });
}

/** Собрать весь контекст события для промпта эксперта. */
async function buildContext(eventId: string, chatId: number) {
  const [{ data: event }, { data: regs }, { data: polls }, { data: rides }, { data: tasks }, { data: hist }] = await Promise.all([
    supabase.from('events').select('title,date,time,location,program,logistics,shopping').eq('id', eventId).maybeSingle(),
    supabase.from('registrations').select('telegram_id,name,dietary,roles,guest_count,has_transport,status').eq('event_id', eventId).neq('status', 'cancelled'),
    supabase.from('polls').select('id,question,options').eq('event_id', eventId).order('id', { ascending: false }).limit(5),
    supabase.from('rides').select('kind,driver_name,from_point,seats_total,seats_taken,active').eq('event_id', eventId).eq('active', true),
    supabase.from('tasks').select('title,taker_name,done').eq('event_id', eventId).order('id', { ascending: false }).limit(12),
    supabase.from('group_messages').select('message_id,telegram_id,username,first_name,text').eq('chat_id', chatId).order('message_id', { ascending: false }).limit(30),
  ]);
  if (!event) return null;

  const lg: any = (event as any).logistics || {};
  const evBlock =
    `«${(event as any).title}» — ${(event as any).date}${(event as any).time ? ` ${(event as any).time}` : ''}, место: ${(event as any).location || '—'}.\n` +
    (lg.assemblyPoint ? `Точка сбора: ${lg.assemblyPoint}\n` : '') +
    `Программа:\n${(((event as any).program || []) as string[]).map((p) => `  ${p}`).join('\n') || '  —'}`;

  const people = (regs || []).map((r: any) => {
    const bits = [r.name || `id${r.telegram_id}`];
    if (r.status === 'pending') bits.push('не подтвердил участие');
    if (r.dietary) bits.push(`питание: ${r.dietary}`); else bits.push('питание не указано');
    if (r.roles) bits.push(`роль: ${String(r.roles).slice(0, 40)}`);
    if (r.guest_count) bits.push(`+${r.guest_count} гост.`);
    if (r.has_transport) bits.push('на своей машине');
    return `  • ${bits.join(', ')}`;
  }).join('\n');

  // Голосования с живыми цифрами — главное оружие против «неразберихи».
  const pollBlocks: string[] = [];
  for (const p of polls || []) {
    const o: any = (p as any).options || {};
    const list: string[] = o.list || [];
    const { data: votes } = await supabase.from('poll_votes').select('choice').eq('poll_id', (p as any).id);
    const counts = new Array(list.length).fill(0);
    for (const v of votes || []) { const c = Number((v as any).choice); if (c >= 0 && c < list.length) counts[c]++; }
    const st = o.status === 'decided' ? `РЕШЕНО: «${list[o.winner] || '—'}»` : o.status === 'expired' ? 'закрыто по времени' : 'ИДЁТ СЕЙЧАС';
    pollBlocks.push(`  • «${(p as any).question}» [${st}] ${list.map((opt, i) => `${opt}: ${counts[i]}`).join(' | ')}`);
  }

  const cars = (rides || []).filter((r: any) => r.kind !== 'tent');
  const tents = (rides || []).filter((r: any) => r.kind === 'tent');
  const rideBlock =
    cars.map((r: any) => `  🚗 ${r.driver_name || 'водитель'} из ${r.from_point || '—'}: свободно ${Math.max(0, (r.seats_total || 0) - (r.seats_taken || 0))} из ${r.seats_total || 0}`).join('\n') +
    (tents.length ? '\n' + tents.map((r: any) => `  ⛺ ${r.driver_name || ''}: мест ${Math.max(0, (r.seats_total || 0) - (r.seats_taken || 0))} из ${r.seats_total || 0}`).join('\n') : '');

  const taskBlock = (tasks || []).map((t: any) => `  ${t.done ? '✅' : '⬜'} ${t.title}${t.taker_name ? ` — ${t.taker_name}` : ''}`).join('\n');
  const expenses = Array.isArray((event as any).shopping?.expenses) ? (event as any).shopping.expenses : [];
  const expTotal = expenses.reduce((s: number, e: any) => s + (Number(e.amount) || 0), 0);

  const history = (hist || []).reverse()
    .map((m: any) => `${m.first_name || m.username || `id${m.telegram_id}`}: ${m.text}`).join('\n');

  return { evBlock, people, pollBlock: pollBlocks.join('\n') || '  — нет', rideBlock: rideBlock || '  — нет', taskBlock: taskBlock || '  — нет', expTotal, history, regs: regs || [] };
}

/** Обработать сообщение группы: сохранить, дождаться паузы, ответить экспертно. */
export async function handleGroupMessage(msg: any, chatId: number) {
  if (!msg?.text || msg.text.startsWith('/') || !msg.from?.id) return;
  const text = String(msg.text).trim();
  if (text.length < 2) return;

  await saveMessage(chatId, msg, text);
  const eventId = await resolveEventId(chatId, msg.chat?.title);
  if (!eventId) return;

  // Дебаунс: ждём тишины. Если за паузу пришло новое сообщение — молчим,
  // ответит инвокация последнего сообщения (у неё будет полный контекст).
  await sleep(PAUSE_MS);
  const { data: newer } = await supabase
    .from('group_messages').select('message_id')
    .eq('chat_id', chatId).gt('message_id', msg.message_id).limit(1);
  if (newer && newer.length) return;

  // Кулдаун: недавно отвечали — не частим.
  const since = new Date(Date.now() - COOLDOWN_MS).toISOString();
  const { data: recentReply } = await supabase
    .from('bot_group_actions').select('id')
    .eq('chat_id', chatId).eq('action_type', 'expert_reply').gt('created_at', since).limit(1);
  if (recentReply && recentReply.length) return;

  const ctx = await buildContext(eventId, chatId);
  if (!ctx) return;

  const prompt =
    `Ты — Флинт, ИИ-эксперт клуба живого общения в групповом чате события. ` +
    `Ты независимый модератор: читаешь беседу и вмешиваешься ТОЛЬКО когда это реально полезно. Сейчас в чате пауза — все высказались.\n\n` +
    `СОБЫТИЕ:\n${ctx.evBlock}\n\n` +
    `УЧАСТНИКИ (${ctx.regs.length}):\n${ctx.people}\n\n` +
    `ГОЛОСОВАНИЯ (точные живые цифры — опирайся ТОЛЬКО на них):\n${ctx.pollBlock}\n\n` +
    `ЛОГИСТИКА:\n${ctx.rideBlock}\n\n` +
    `ЗАДАЧИ:\n${ctx.taskBlock}\n\n` +
    `РАСХОДЫ: итого ${Math.round(ctx.expTotal * 100) / 100} BYN\n\n` +
    `ПОСЛЕДНИЕ СООБЩЕНИЯ ЧАТА:\n${ctx.history}\n\n` +
    `Говори, если: есть вопрос без ответа; путаница или спор о фактах (особенно про голосования — разложи точные цифры и статус); ` +
    `людям не хватает данных, которые у тебя есть; кто-то вызвался что-то сделать (зафиксируй задачу); просят помощи. ` +
    `Если не хватает данных об участнике (питание, роль, подтверждение) и это уместно — задай ОДИН короткий вопрос.\n` +
    `Молчи, если: обычная болтовня; вопрос уже закрыт людьми; добавить нечего.\n\n` +
    `Верни ТОЛЬКО JSON:\n` +
    `{"speak": true|false, "reason": "почему", "reply": "ответ до 600 символов: дружелюбно, по делу, только факты из данных выше, без выдумок", ` +
    `"task": {"title": "что сделать", "assignee": "имя из чата"} или null}`;

  const verdict = await aiJSON(prompt, 900);
  if (!verdict || typeof verdict !== 'object') return;

  if (verdict.task && verdict.task.title) {
    // Взявшегося ищем по имени среди авторов последних сообщений.
    const assignee = String(verdict.task.assignee || '').toLowerCase();
    const { data: authors } = await supabase
      .from('group_messages').select('telegram_id,first_name,username')
      .eq('chat_id', chatId).order('message_id', { ascending: false }).limit(30);
    const match = (authors || []).find((a: any) =>
      assignee && ((a.first_name || '').toLowerCase().includes(assignee) || (a.username || '').toLowerCase() === assignee));
    await supabase.from('tasks').insert({
      event_id: eventId,
      title: String(verdict.task.title).slice(0, 150),
      taken_by: match ? (match as any).telegram_id : msg.from.id,
      taker_name: match ? ((match as any).first_name || (match as any).username || '') : (msg.from.first_name || ''),
      done: false,
    });
    await logAction(chatId, eventId, 'task_created', text, String(verdict.task.title), null);
  }

  if (verdict.speak && verdict.reply) {
    const reply = String(verdict.reply).slice(0, 900);
    await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `🤖 ${esc(reply)}` });
    await logAction(chatId, eventId, 'expert_reply', text, reply, { msg_id: msg.message_id, reason: verdict.reason || '' });
  } else {
    await logAction(chatId, eventId, 'silent', text.slice(0, 100), '', { reason: verdict.reason || '' });
  }
}

/** Привязать группу к событию (использует /link в webhook). */
export async function linkGroupToEvent(chatId: number, eventId: string, chatTitle?: string) {
  await supabase.from('event_groups').upsert({
    event_id: eventId,
    chat_id: chatId,
    chat_title: chatTitle || null,
    active: true,
  }, { onConflict: 'chat_id' });
}

// Библиотечный модуль: прямой HTTP-вызов не предусмотрен (без этого Vercel 500-ил).
export default async function handler(_req: any, res: any) {
  return res.status(404).json({ error: 'Not an endpoint' });
}
