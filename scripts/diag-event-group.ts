/**
 * ДИАГНОСТИКА ГРУППЫ СОБЫТИЯ — читает и печатает, ничего не меняет.
 *
 * Зачем: понять, что происходит в чате мероприятия, не передавая никому
 * service_role-ключ. Скрипт работает на машине владельца, берёт ключи из
 * локального .env (он в .gitignore) и печатает отчёт, который можно
 * показать кому угодно: телефоны участников в вывод НЕ попадают.
 *
 * Запуск:  npx tsx scripts/diag-event-group.ts bison
 *          npx tsx scripts/diag-event-group.ts "бизон" --messages=60
 *
 * Аргумент — кусок названия события (по умолчанию bison). Только SELECT'ы
 * и read-only методы Telegram API: getMe / getWebhookInfo / getChat.
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env' });
config({ path: '.env.local', override: true });

const db = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const BOT = process.env.TELEGRAM_BOT_TOKEN || '';

const args = process.argv.slice(2);
const term = (args.find((a) => !a.startsWith('--')) || 'bison').toLowerCase();
const msgLimit = Number((args.find((a) => a.startsWith('--messages=')) || '').split('=')[1]) || 40;

const line = (s = '') => console.log(s);
const head = (s: string) => { line(); line('═'.repeat(70)); line(s); line('═'.repeat(70)); };
const when = (t: any) => (t ? new Date(t).toLocaleString('ru-RU', { timeZone: 'Europe/Minsk' }) : '—');
const cut = (s: any, n = 200) => String(s ?? '').replace(/\s+/g, ' ').slice(0, n);

/** Telegram: только чтение. Ошибку не глотаем — она сама по себе диагноз. */
async function tg(method: string, payload: unknown = {}): Promise<any> {
  if (!BOT) return { ok: false, description: 'TELEGRAM_BOT_TOKEN не задан в .env' };
  try {
    const r = await fetch(`https://api.telegram.org/bot${BOT}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    return await r.json();
  } catch (e) {
    return { ok: false, description: (e as Error).message };
  }
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    line('❌ В .env нет SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — запускай из корня проекта.');
    process.exit(1);
  }

  head(`🔎 СОБЫТИЯ ПО ЗАПРОСУ «${term}»`);
  const { data: events, error: evErr } = await db
    .from('events').select('*').ilike('title', `%${term}%`).order('date', { ascending: false });
  if (evErr) { line(`❌ ${evErr.message}`); process.exit(1); }
  if (!events?.length) {
    line('Событий с таким названием нет. Последние 10 событий в базе:');
    const { data: any10 } = await db.from('events').select('id,title,date,status').order('date', { ascending: false }).limit(10);
    for (const e of any10 || []) line(`  • ${(e as any).date} · ${(e as any).status} · ${(e as any).title}  [id ${(e as any).id}]`);
    return;
  }

  for (const ev of events as any[]) {
    const lg = ev.logistics || {};
    head(`📅 ${ev.title}`);
    line(`id: ${ev.id}`);
    line(`дата: ${ev.date}${ev.date_end ? ` → ${ev.date_end}` : ''} · статус: ${ev.status} · тип входа: ${ev.entry_type || '—'}`);
    line(`место: ${ev.location || '—'}`);
    line(`сбор: ${lg.assemblyPoint || '— не назначен'}${lg.gatherTime ? ` в ${lg.gatherTime}` : ''}${lg.departureTime ? ` · выезд ${lg.departureTime}` : ''}`);
    line(`взнос: ${ev.price_label || ev.price_type || '—'}`);
    line(`организатор (deputy_id): ${ev.deputy_id || '— не назначен'}`);
    line(`ссылка на чат в карточке: ${ev.telegram_bot_url || '— нет'}`);
    line(`программа: ${(ev.program || []).length} пунктов`);

    // ── Привязка группы ──────────────────────────────────────────────────
    head('💬 ПРИВЯЗКА ЧАТА');
    const { data: groups } = await db.from('event_groups').select('*').eq('event_id', ev.id);
    if (!groups?.length) {
      line('❌ Чат НЕ привязан (event_groups пусто).');
      line('   → в группе: /link от костяка. Без привязки бот в чате не работает вообще.');
    }
    for (const g of (groups || []) as any[]) {
      line(`chat_id: ${g.chat_id} · активна: ${g.active ? 'да' : 'НЕТ'} · создана: ${when(g.created_at)}`);
      const chat = await tg('getChat', { chat_id: g.chat_id });
      if (chat?.ok) {
        line(`название чата: ${chat.result.title || '—'} · тип: ${chat.result.type}`);
      } else {
        line(`⚠️ getChat не ответил: ${chat?.description || 'нет токена'} (бота выкинули из группы?)`);
      }
      const cnt = await tg('getChatMemberCount', { chat_id: g.chat_id });
      if (cnt?.ok) line(`участников в чате: ${cnt.result}`);
      const me = await tg('getMe');
      if (me?.ok) {
        const mem = await tg('getChatMember', { chat_id: g.chat_id, user_id: me.result.id });
        if (mem?.ok) line(`бот в чате: ${mem.result.status}${mem.result.status === 'administrator' ? ' ✅' : ' ⚠️ (нужен админ)'}`);
      }
    }

    // ── Кто едет ─────────────────────────────────────────────────────────
    head('👥 КТО ЕДЕТ');
    const { data: regs } = await db
      .from('registrations')
      .select('telegram_id,name,status,has_transport,transport_seats,guest_count,dietary,roles,registered_at')
      .eq('event_id', ev.id).neq('status', 'cancelled').order('registered_at', { ascending: true });
    const guests = (regs || []).reduce((s, r: any) => s + (Number(r.guest_count) || 0), 0);
    line(`всего заявок: ${(regs || []).length}${guests ? ` (+${guests} гостей)` : ''}`);
    for (const r of (regs || []) as any[]) {
      line(`  • ${r.name || '—'} [id ${r.telegram_id}] · ${r.status}${r.has_transport ? ` · на машине (${r.transport_seats || 0} мест)` : ''}${r.guest_count ? ` · +${r.guest_count} гост.` : ''} · записался ${when(r.registered_at)}`);
    }
    const { data: cancelled } = await db
      .from('registrations').select('name,cancelled_at,cancel_reason')
      .eq('event_id', ev.id).eq('status', 'cancelled');
    if (cancelled?.length) {
      line(`\nснялись (${cancelled.length}):`);
      for (const c of cancelled as any[]) line(`  • ${c.name || '—'} · ${when(c.cancelled_at)}${c.cancel_reason ? ` · «${cut(c.cancel_reason, 80)}»` : ''}`);
    }

    // ── Машины ───────────────────────────────────────────────────────────
    head('🚗 МАШИНЫ И МЕСТА');
    const { data: rides } = await db.from('rides').select('*').eq('event_id', ev.id).eq('active', true);
    if (!rides?.length) line('машин не заявлено');
    for (const r of (rides || []) as any[]) {
      const free = Math.max(0, Number(r.seats_total || 0) - Number(r.seats_taken || 0));
      line(`  • [${r.kind}] ${r.driver_name || '—'} — свободно ${free} из ${r.seats_total || 0}${r.from_point ? ` · старт: ${cut(r.from_point, 60)}` : ''}`);
      const { data: bk } = await db.from('ride_bookings').select('passenger_name').eq('ride_id', r.id);
      if (bk?.length) line(`      пассажиры: ${(bk as any[]).map((b) => b.passenger_name || '—').join(', ')}`);
    }

    // ── Кто что везёт ────────────────────────────────────────────────────
    head('🎒 ЗАДАЧИ (кто что везёт)');
    const { data: tasks } = await db.from('tasks').select('title,taken_by,done,created_at').eq('event_id', ev.id);
    if (!tasks?.length) line('задач нет');
    for (const t of (tasks || []) as any[]) {
      line(`  • ${t.title}${t.taken_by ? ` — взял id ${t.taken_by}` : ' — НИКТО НЕ ВЗЯЛ'}${t.done ? ' ✅' : ''}`);
    }

    // ── Бади (если миграция уже накатана) ────────────────────────────────
    const { data: buddies, error: bErr } = await db
      .from('event_buddies').select('telegram_id,pair_id,notified_at').eq('event_id', ev.id);
    head('🤝 БАДИ-СВЯЗКИ');
    if (bErr) line(`таблицы event_buddies ещё нет (миграция 2026-09-25-buddy-pairs.sql не накатана)`);
    else if (!buddies?.length) line('связок нет (меньше 5 записавшихся или миграция накатана только что)');
    else {
      const byPair = new Map<string, any[]>();
      for (const b of buddies as any[]) byPair.set(b.pair_id, [...(byPair.get(b.pair_id) || []), b]);
      for (const [, mem] of byPair) line(`  • ${mem.map((m) => `id ${m.telegram_id}${m.notified_at ? '' : ' (не оповещён)'}`).join(' — ')}`);
    }

    // ── Переписка группы ─────────────────────────────────────────────────
    for (const g of (groups || []) as any[]) {
      head(`🗒 ПОСЛЕДНИЕ ${msgLimit} СООБЩЕНИЙ ЧАТА ${g.chat_id}`);
      const { data: msgs } = await db
        .from('group_messages').select('first_name,username,text,created_at')
        .eq('chat_id', g.chat_id).order('created_at', { ascending: false }).limit(msgLimit);
      if (!msgs?.length) {
        line('❌ В базе НЕТ сообщений этого чата.');
        line('   Почти наверняка включён Group Privacy: Telegram отдаёт боту только команды,');
        line('   обычная переписка до вебхука не доходит, вся автоматика в группе мертва.');
        line('   → @BotFather → /mybots → бот → Bot Settings → Group Privacy → Turn off,');
        line('     затем УДАЛИТЬ бота из группы и добавить заново.');
      }
      for (const m of ((msgs || []) as any[]).reverse()) {
        line(`[${when(m.created_at)}] ${m.first_name || m.username || '—'}: ${cut(m.text)}`);
      }

      head(`🤖 ЧТО БОТ ДЕЛАЛ В ЧАТЕ ${g.chat_id}`);
      const { data: acts } = await db
        .from('bot_group_actions').select('action_type,trigger_text,response_text,created_at')
        .eq('chat_id', g.chat_id).order('created_at', { ascending: false }).limit(20);
      if (!acts?.length) line('бот в этом чате не вмешивался ни разу');
      for (const a of ((acts || []) as any[]).reverse()) {
        line(`[${when(a.created_at)}] ${a.action_type}`);
        if (a.trigger_text) line(`    ← «${cut(a.trigger_text, 120)}»`);
        if (a.response_text) line(`    → «${cut(a.response_text, 120)}»`);
      }
    }
  }

  // ── Сбор на манишки ────────────────────────────────────────────────────
  head('💰 СБОР НА МАНИШКИ');
  const { data: fr, error: frErr } = await db.from('fundraisers').select('*').eq('slug', 'bison-manishki-160').maybeSingle();
  if (frErr) line(`таблицы fundraisers нет: ${frErr.message}`);
  else if (!fr) line('сбор bison-manishki-160 не найден — сидер не запускали');
  else {
    line(`«${(fr as any).title}» · статус: ${(fr as any).status} · цель: ${(fr as any).goal_amount} BYN · дедлайн: ${(fr as any).deadline}`);
    // Считается только подтверждённое: pending — это обещание, а не деньги.
    const { data: pledges } = await db.from('fundraiser_pledges').select('*').eq('fundraiser_id', (fr as any).id);
    const confirmed = (pledges || []).filter((p: any) => p.status === 'confirmed');
    const total = confirmed.reduce((s, p: any) => s + (Number(p.amount) || 0), 0);
    const promised = (pledges || []).filter((p: any) => p.status === 'pending').reduce((s, p: any) => s + (Number(p.amount) || 0), 0);
    const goal = Number((fr as any).goal_amount) || 0;
    line(`подтверждено: ${total} BYN от ${confirmed.length} чел.${total >= goal ? ' ✅ цель закрыта' : ` · не хватает ${goal - total} BYN`}`);
    if (promised) line(`обещано, но не подтверждено: ${promised} BYN — костяку надо подтвердить вклады в админке`);
    for (const p of (pledges || []) as any[]) {
      line(`  • id ${p.telegram_id} — ${p.amount} BYN · ${p.status}${p.note ? ` · «${cut(p.note, 80)}»` : ''} · ${when(p.created_at)}`);
    }
  }

  // ── Состояние бота ─────────────────────────────────────────────────────
  head('⚙️ БОТ И ВЕБХУК');
  const me = await tg('getMe');
  if (me?.ok) {
    line(`бот: @${me.result.username} (id ${me.result.id})`);
    line(`видит обычные сообщения групп: ${me.result.can_read_all_group_messages ? 'ДА ✅' : 'НЕТ ⚠️ — Group Privacy включён, автоматика в группах мертва'}`);
    line(`можно добавлять в группы: ${me.result.can_join_groups ? 'да' : 'НЕТ ⚠️'}`);
  } else line(`getMe: ${me?.description}`);
  const wh = await tg('getWebhookInfo');
  if (wh?.ok) {
    line(`webhook: ${wh.result.url || '— не установлен ⚠️'}`);
    line(`необработанных апдейтов: ${wh.result.pending_update_count}`);
    if (wh.result.last_error_message) line(`⚠️ последняя ошибка: ${wh.result.last_error_message} (${when(wh.result.last_error_date * 1000)})`);
  } else line(`getWebhookInfo: ${wh?.description}`);

  line();
  line('Готово. Вывод можно копировать целиком — телефонов участников в нём нет.');
}

main().catch((e) => { console.error('❌', e); process.exit(1); });
