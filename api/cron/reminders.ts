import { createClient } from '@supabase/supabase-js';
import * as crypto from 'crypto';


/**
 * Ежедневный крон (Vercel Cron, см. vercel.json).
 *
 *  1. Напоминания о событии за 7/3/1 день — по флагам events.notifications.
 *  2. Напоминания об оплате тем, у кого payment_status ещё не 'paid'/'submitted'.
 *  3. Просьба оставить отзыв на следующий день после события.
 *
 * Vercel Hobby разрешает только суточный крон, поэтому напоминаний «за 3 часа»
 * здесь нет — они остаются ручной рассылкой из админки.
 *
 * Защита: Vercel шлёт заголовок Authorization: Bearer $CRON_SECRET.
 * Ручной вызов возможен с ADMIN_TOKEN — удобно проверить, не дожидаясь ночи.
 */

const supabase = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

function authorized(req: any): boolean {
  const token = String(req.headers.authorization || '').replace('Bearer ', '');
  if (process.env.CRON_SECRET && token === process.env.CRON_SECRET) return true;
  return isAdmin(req);
}

function esc(s: any): string {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Защита-в-глубину: забаненные (members.status='blocked') не должны получать
// НИ ОДНОГО автосообщения крона. Основной барьер — бан отменяет регистрации
// (d033626), но для legacy/гонок фильтруем централизованно на слое отправки:
// заполняется один раз в начале handler, короткозамыкает оба пути (tg/send).
let blockedIds = new Set<number>();

/**
 * Кто отключил себе категорию уведомлений (профиль → Настройки, пишется в
 * members.prefs.notify). Без этой проверки тумблеры в профиле были бы
 * декорацией. Отсутствие ключа = согласие, поэтому в set попадают только
 * явные `false`.
 */
type NotifyCategory = 'events' | 'payments' | 'logistics' | 'digest';
const mutedBy: Record<NotifyCategory, Set<number>> = {
  events: new Set(), payments: new Set(), logistics: new Set(), digest: new Set(),
};

/** Один проход по members: и блокировки, и настройки уведомлений. */
async function loadBlockedIds(): Promise<void> {
  for (const s of Object.values(mutedBy)) s.clear();
  try {
    const { data } = await supabase.from('members').select('telegram_id,status,prefs');
    blockedIds = new Set(
      (data || [])
        .filter((m: any) => m.status === 'blocked')
        .map((m: any) => Number(m.telegram_id))
        .filter((n: number) => Number.isFinite(n)),
    );
    for (const m of data || []) {
      const id = Number((m as any).telegram_id);
      if (!Number.isFinite(id)) continue;
      const notify = (m as any).prefs?.notify;
      if (!notify) continue;
      for (const cat of Object.keys(mutedBy) as NotifyCategory[]) {
        if (notify[cat] === false) mutedBy[cat].add(id);
      }
    }
  } catch { blockedIds = new Set(); }
}
/** Личное сообщение забаненному — не слать. Групповые (отрицательный chat_id) не трогаем. */
function isBlockedChat(chatId: unknown): boolean {
  const n = Number(chatId);
  return Number.isFinite(n) && n > 0 && blockedIds.has(n);
}
/** Отписан ли человек от этой категории. Групповые чаты и админ-чат — всегда нет. */
function isMuted(chatId: unknown, category?: NotifyCategory): boolean {
  if (!category) return false;
  const n = Number(chatId);
  return Number.isFinite(n) && n > 0 && mutedBy[category].has(n);
}

async function tg(method: string, payload: unknown) {
  try {
    if (method === 'sendMessage' && isBlockedChat((payload as any)?.chat_id)) return { ok: false, blocked: true };
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return await r.json();
  } catch {
    return { ok: false };
  }
}

async function send(chatId: number, text: string, replyMarkup?: unknown, category?: NotifyCategory): Promise<boolean> {
  if (isBlockedChat(chatId) || isMuted(chatId, category)) return false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: replyMarkup }),
    });
    return (await r.json()).ok === true;
  } catch {
    return false;
  }
}

function escH(v: string): string {
  return String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** YYYY-MM-DD со сдвигом на N дней от сегодня. */
function dayOffset(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Реальные Telegram-получатели: веб-заявки имеют отрицательный хеш вместо id. */
function realIds(regs: any[]): any[] {
  return regs.filter((r) => Number.isFinite(Number(r.telegram_id)) && Number(r.telegram_id) > 0);
}

/**
 * Челлендж это или выезд. Флаг лежит в events.notifications, а не в отдельной
 * колонке. Нужен, чтобы выключить для челленджа «вчерашние» напоминания:
 * это марафон дома, а не выезд, и просьба прислать фото оттуда неуместна.
 */
function isChallengeEvent(ev: any): boolean {
  const n = (ev && ev.notifications) || {};
  return n._format === 'challenge' || n.is_challenge === true;
}

/**
 * БАДИ-ПАРЫ (копия логики из api/telegram/webhook.ts — общий _lib роняет
 * функции на Vercel). Крон — страховка: связки достраиваются при каждой записи,
 * но если бот не смог доставить сообщение (человек ещё не открывал диалог) или
 * запись пришла мимо бота, пара всё равно будет собрана и объявлена здесь.
 * Модель — в supabase/migrations/2026-09-25-buddy-pairs.sql.
 */
const BUDDY_MIN = 5;

async function syncBuddies(evId: string): Promise<void> {
  const { data: regs } = await supabase
    .from('registrations').select('telegram_id,registered_at')
    .eq('event_id', evId).neq('status', 'cancelled')
    .order('registered_at', { ascending: true });
  const active = Array.from(new Set((regs || [])
    .map((r: any) => Number(r.telegram_id))
    .filter((id: number) => Number.isFinite(id) && id > 0)));

  const { data: rowsRaw, error: rowsErr } = await supabase
    .from('event_buddies').select('telegram_id,pair_id').eq('event_id', evId);
  // Таблицы ещё нет (миграция 2026-09-25-buddy-pairs.sql не накатана) — молча
  // выходим. Иначе пары посчитались бы, люди получили бы «твой бади — X», а
  // сохранить их было бы некуда: на следующей записи пары собрались бы заново
  // и участники получали бы новых бади при каждом чужом чихе.
  if (rowsErr) return;
  const rows = (rowsRaw || []).map((r: any) => ({ id: Number(r.telegram_id), pairId: String(r.pair_id) }));

  if (active.length < BUDDY_MIN) {
    if (rows.length) await supabase.from('event_buddies').delete().eq('event_id', evId);
    return;
  }

  const activeSet = new Set(active);
  const before = new Map<string, number[]>();
  for (const r of rows) {
    if (!activeSet.has(r.id)) continue;
    before.set(r.pairId, [...(before.get(r.pairId) || []), r.id]);
  }
  const groups = new Map<string, number[]>();
  for (const [pid, mem] of before) if (mem.length >= 2) groups.set(pid, [...mem]);

  const placed = new Set<number>();
  for (const mem of groups.values()) for (const id of mem) placed.add(id);
  const queue = active.filter((id) => !placed.has(id));

  while (queue.length >= 2) {
    const a = queue.shift() as number;
    const b = queue.shift() as number;
    groups.set(`p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, [a, b]);
  }
  if (queue.length === 1) {
    let best: string | null = null;
    for (const [pid, mem] of groups) {
      if (mem.length >= 3) continue;
      if (best === null || mem.length < (groups.get(best) as number[]).length) best = pid;
    }
    if (best) groups.set(best, [...(groups.get(best) as number[]), queue[0]]);
  }

  const desired = new Map<number, string>();
  for (const [pid, mem] of groups) for (const id of mem) desired.set(id, pid);

  const gone = rows.map((r) => r.id).filter((id) => !desired.has(id));
  if (gone.length) await supabase.from('event_buddies').delete().eq('event_id', evId).in('telegram_id', gone);

  const changed = new Set<number>();
  for (const [pid, mem] of groups) {
    const was = before.get(pid) || [];
    const same = was.length === mem.length && mem.every((id) => was.includes(id));
    if (!same) for (const id of mem) changed.add(id);
  }
  if (!changed.size) return;

  await supabase.from('event_buddies').upsert(
    [...changed].map((id) => ({
      event_id: evId, telegram_id: id, pair_id: desired.get(id) as string, notified_at: null,
    })),
    { onConflict: 'event_id,telegram_id' },
  );
}

/** Объявить связки тем, кому ещё не объявляли (notified_at IS NULL). Вернёт число доставленных. */
async function announcePendingBuddies(evId: string, evTitle: string): Promise<number> {
  const { data: rows } = await supabase
    .from('event_buddies').select('telegram_id,pair_id,notified_at').eq('event_id', evId);
  const pending = (rows || []).filter((r: any) => !r.notified_at);
  if (!pending.length) return 0;

  const groups = new Map<string, number[]>();
  for (const r of (rows || []) as any[]) {
    const pid = String(r.pair_id);
    groups.set(pid, [...(groups.get(pid) || []), Number(r.telegram_id)]);
  }
  const people = new Map<number, { name: string; username: string }>();
  const { data: mem } = await supabase
    .from('members').select('telegram_id,first_name,username')
    .in('telegram_id', (rows || []).map((r: any) => Number(r.telegram_id)));
  for (const m of mem || []) {
    people.set(Number((m as any).telegram_id), {
      name: String((m as any).first_name || 'Участник'),
      username: String((m as any).username || ''),
    });
  }

  const sent: number[] = [];
  for (const r of pending as any[]) {
    const me = Number(r.telegram_id);
    const mates = (groups.get(String(r.pair_id)) || []).filter((x) => x !== me);
    if (!mates.length) continue;
    const list = mates.map((id) => {
      const p = people.get(id);
      const name = esc(p?.name || 'Участник');
      return `🤝 ${p?.username ? `<a href="https://t.me/${esc(p.username)}">${name}</a>` : `<a href="tg://user?id=${id}">${name}</a>`}`;
    }).join('\n');
    const ok = await send(
      me,
      `🤝 <b>Твой бади на «${esc(evTitle)}»</b>\n\n${list}\n\n` +
        'Бади — напарник, который держит тебя в поле зрения от сбора до разъезда.\n\n' +
        '<b>Что это значит</b>\n' +
        '• Спишитесь до выезда — договоритесь, как встречаетесь.\n' +
        '• На событии держите друг друга в поле зрения.\n' +
        '• Пропал, заболел, стало плохо — ты первый, кто это заметит и скажет организатору.\n' +
        '• Бытовые и спорные вопросы решаете между собой, а не через организатора.\n\n' +
        '<i>Спрос с обоих: и с тебя, и с твоего бади.</i>',
      undefined, 'events',
    );
    if (ok) sent.push(me);
  }
  if (sent.length) {
    await supabase.from('event_buddies')
      .update({ notified_at: new Date().toISOString() })
      .eq('event_id', evId).in('telegram_id', sent);
  }
  return sent.length;
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
  if (!authorized(req)) return res.status(401).json({ error: 'Unauthorized' });
  if (!BOT_TOKEN) return res.status(200).json({ ok: false, error: 'TELEGRAM_BOT_TOKEN не задан' });

  // staleRemindersVoided — сколько просроченных напоминаний погашено за прогон.
  // Показываем отдельно: если счётчик растёт, значит события потом
  // меняются, а напоминания остаются — это стоит увидеть.
  const report = { eventReminders: 0, paymentReminders: 0, feedbackRequests: 0, menuBroadcasts: 0, pollsClosed: 0, autoRemindersSent: 0, staleRemindersVoided: 0, buddyPairs: 0, errors: [] as string[] };

  // Забаненных исключаем на слое отправки (защита-в-глубину для legacy).
  await loadBlockedIds();

  // ══════════════════════════════════════════════════════════════════════════
  // БЛОК A: Автонапоминания (каждые 15 мин, не ждём суточного крона)
  // ══════════════════════════════════════════════════════════════════════════
  try {
    const nowIso = new Date().toISOString();
    
    // 1. Отправить запланированные напоминания
    const { data: autoReminders } = await supabase
      .from('auto_reminders')
      .select('*')
      .lte('remind_at', nowIso)
      .eq('sent', false)
      .lt('attempts', 3)
      .limit(50);

    /**
     * Мёртвые напоминания — гасим, а не шлём.
     *
     * Живой жалобой владельца было: «вылетают задачи по Нарочи, которые я
     * давно закрыл». Так и работало: строка создаётся заранее, а отправляется
     * когда наступит remind_at. Если событие за это время перенесли, закрыли
     * или оно просто прошло — строка остаётся непрочитанной и срабатывает
     * позже, уже после выезда. Отправить её нельзя, но и оставлять нельзя:
     * она будет пытаться уйти ещё два раза.
     *
     * Поэтому сверяемся с событием и помечаем такие строки отправленными:
     * в отчёте они видны отдельным счётчиком, а не растворяются молча.
     */
    const staleIds: string[] = [];
    for (const r of autoReminders || []) {
      if (!r.event_id) continue;
      const { data: evRow } = await supabase
        .from('events').select('date,date_end,status').eq('id', r.event_id).maybeSingle();
      if (!evRow) { staleIds.push(String(r.id)); continue; }
      const end = String((evRow as any).date_end || (evRow as any).date || '');
      if (end && end < nowIso.slice(0, 10)) staleIds.push(String(r.id));
    }
    if (staleIds.length) {
      await supabase.from('auto_reminders').update({ sent: true, attempts: 3 }).in('id', staleIds);
      report.staleRemindersVoided = staleIds.length;
    }

    for (const r of autoReminders || []) {
      if (staleIds.includes(String(r.id))) continue;
      try {
        await tg('sendMessage', {
          chat_id: r.telegram_id,
          parse_mode: 'HTML',
          text: r.message,
        });
        
        await supabase
          .from('auto_reminders')
          .update({ sent: true, attempts: r.attempts + 1 })
          .eq('id', r.id);
        
        report.autoRemindersSent++;
      } catch {
        await supabase
          .from('auto_reminders')
          .update({ attempts: r.attempts + 1 })
          .eq('id', r.id);
      }
    }

    // 2. Создать напоминания для неподтверждённых пунктов (за 24ч до события)
    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
    const { data: upcomingEvents } = await supabase
      .from('events')
      .select('id,title,date')
      .eq('status', 'open')
      .eq('date', tomorrow);

    for (const ev of upcomingEvents || []) {
      // Техника безопасности
      try {
        const { data: unconfirmedSafety } = await supabase.rpc('get_unconfirmed_safety', {
          p_event_id: ev.id,
        });

        for (const u of unconfirmedSafety || []) {
          const exists = await supabase
            .from('auto_reminders')
            .select('id')
            .eq('event_id', ev.id)
            .eq('telegram_id', u.telegram_id)
            .eq('reminder_type', 'safety_confirm')
            .eq('sent', false)
            .maybeSingle();

          if (!exists.data) {
            await supabase.rpc('create_reminder', {
              p_event_id: ev.id,
              p_telegram_id: u.telegram_id,
              p_type: 'safety_confirm',
              p_message: `⚠️ <b>${esc(ev.title)}</b> — завтра!\n\nПодтверди, что ознакомился с <b>техникой безопасности</b>. Это важно для всех.\n\n/start → выбери событие → «✅ Правила безопасности»`,
              p_remind_at: new Date(Date.now() + 3600 * 1000).toISOString(),
            });
          }
        }
      } catch (e) { report.errors.push(`safety: ${(e as Error).message}`); }

      // Гости (кто указал guest_count > 0, но не детализировал)
      try {
        const { data: unclearGuests } = await supabase
          .from('registrations')
          .select('telegram_id,name,guest_count')
          .eq('event_id', ev.id)
          .eq('status', 'approved')
          .gt('guest_count', 0);

        for (const g of unclearGuests || []) {
          if (!g.telegram_id) continue;
          const { data: details } = await supabase
            .from('registrations')
            .select('guest_details')
            .eq('event_id', ev.id)
            .eq('telegram_id', g.telegram_id)
            .maybeSingle();

          if (!details?.guest_details || !details.guest_details.count) {
            const exists = await supabase
              .from('auto_reminders')
              .select('id')
              .eq('event_id', ev.id)
              .eq('telegram_id', g.telegram_id)
              .eq('reminder_type', 'guest_update')
              .eq('sent', false)
              .maybeSingle();

            if (!exists.data) {
              await supabase.rpc('create_reminder', {
                p_event_id: ev.id,
                p_telegram_id: g.telegram_id,
                p_type: 'guest_update',
                p_message: `👥 <b>${esc(ev.title)}</b> — завтра!\n\nТы указал гостей: <b>${g.guest_count} чел</b>. Уточни, сколько точно едет и как их зовут — это нужно для логистики.\n\n/start → событие → «Обновить гостей»`,
                p_remind_at: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
              });
            }
          }
        }
      } catch (e) { report.errors.push(`guests: ${(e as Error).message}`); }
    }
  } catch (e) { report.errors.push(`auto-reminders: ${(e as Error).message}`); }

  // ══════════════════════════════════════════════════════════════════════════
  // БЛОК B: Суточные напоминания (события, оплата, отзывы)
  // ══════════════════════════════════════════════════════════════════════════

  try {
    // ── 0. Авто-закрытие голосований с истёкшим дедлайном ─────────────────
    // Кворум закрывает опрос сразу (в вебхуке); это страховка от «висящих»
    // опросов без кворума — побеждает текущий лидер.
    try {
      const nowIso = new Date().toISOString();
      const { data: openPolls } = await supabase
        .from('polls').select('id,event_id,question,options,deadline').lt('deadline', nowIso).limit(50);
      for (const p of openPolls || []) {
        const opts: any = (p as any).options || {};
        if (opts.status && opts.status !== 'open') continue; // уже закрыт
        const list: string[] = opts.list || [];
        if (!list.length) continue;
        const { data: votes } = await supabase.from('poll_votes').select('choice').eq('poll_id', (p as any).id);
        const counts = new Array(list.length).fill(0);
        for (const v of votes || []) { const c = Number((v as any).choice); if (c >= 0 && c < list.length) counts[c]++; }
        let winIdx = 0;
        for (let i = 1; i < counts.length; i++) if (counts[i] > counts[winIdx]) winIdx = i;
        const hasVotes = counts.some((c) => c > 0);
        await supabase.from('polls').update({ options: { ...opts, status: 'expired', winner: hasVotes ? winIdx : null } }).eq('id', (p as any).id);
        // Оповещаем зарегистрированных на событие.
        const { data: regs } = await supabase
          .from('registrations').select('telegram_id').eq('event_id', (p as any).event_id).neq('status', 'cancelled');
        for (const r of realIds(regs || [])) {
          await send(Number(r.telegram_id),
            hasVotes
              ? `⌛ <b>Голосование завершено по времени</b>\n«${esc((p as any).question)}»\n\nЛидер: <b>${esc(list[winIdx])}</b> (${counts[winIdx]} голос(ов)).`
              : `⌛ Голосование «${esc((p as any).question)}» закрыто по времени — голосов не было.`,
            undefined, 'events');
        }
        report.pollsClosed++;
      }
    } catch (e) { report.errors.push(`polls: ${(e as Error).message}`); }

    // ── 1+2. Предстоящие события: 7 / 3 / 1 день ──────────────────────────
    const horizon = [
      { days: 7, flag: 'reminder7d', label: 'через неделю' },
      { days: 3, flag: 'reminder3d', label: 'через 3 дня' },
      { days: 1, flag: 'reminder1d', label: 'завтра' },
    ];

    for (const h of horizon) {
      const target = dayOffset(h.days);
      const { data: events } = await supabase
        .from('events')
        .select('id,title,date,date_end,date_label,location,price_type,notifications,status,logistics,shopping,coordinates_lat,coordinates_lng')
        .eq('date', target)
        .eq('status', 'open');

      for (const ev of events || []) {
        const notif = (ev as any).notifications || {};
        if (notif[h.flag] === false) continue;

        const { data: regs } = await supabase
          .from('registrations')
          .select('telegram_id,payment_status,dietary,equipment,roles,has_transport,guest_count,notes')
          .eq('event_id', (ev as any).id)
          .neq('status', 'cancelled');

        // За 3 дня: напомнить про неполную анкету
        if (h.days === 3) {
          // «Доборщик»: ловим каждого, кто бросил опрос на полпути — по КАЖДОМУ
          // незаполненному полю, включая транспорт (дырка: регистрация создаётся
          // до опроса, и человек мог не дойти до вопросов).
          const incomplete = (regs || []).filter((r: any) =>
            !r.dietary || !r.equipment || !r.roles || r.has_transport === null || r.has_transport === undefined);
          for (const r of realIds(incomplete)) {
            const gaps: string[] = [];
            if (r.has_transport === null || r.has_transport === undefined) gaps.push('🚗 Транспорт (как добираешься)');
            if (!r.dietary) gaps.push('🍽 Питание (веган/вегетарианец/всеядный)');
            if (!r.equipment) gaps.push('🎒 Снаряжение (что везёшь)');
            if (!r.roles) gaps.push('🙌 Роль (чем полезен)');
            const buttons: any[][] = [];
            if (r.has_transport === null || r.has_transport === undefined) buttons.push([{ text: '🚗 Указать транспорт', callback_data: `trask_${(ev as any).id}` }]);
            if (!r.dietary || !r.equipment || !r.roles) buttons.push([{ text: '📋 Заполнить остальное', callback_data: `org_${(ev as any).id}` }]);
            await send(
              Number(r.telegram_id),
              `📋 <b>Дополни профиль — «${esc((ev as any).title)}»</b>\n\n` +
                `До выезда 3 дня, а организаторам по тебе не хватает:\n${gaps.join('\n')}\n\n` +
                `Это 1 минута — жми кнопки ниже.`,
              { inline_keyboard: buttons }, 'logistics',
            );
          }
        }

        // Согласование закупки: пингуем неответивших; >50% «за» — автопринятие.
        const shopping = (ev as any).shopping || {};
        if ((h.days === 3 || h.days === 1) && shopping.status === 'sent' && Array.isArray(shopping.items) && shopping.items.length) {
          const approved: number[] = Array.isArray(shopping.approved_by) ? shopping.approved_by.map(Number) : [];
          const objected: number[] = Array.isArray(shopping.objections) ? shopping.objections.map((o: any) => Number(o.tg_id)) : [];
          const all = realIds(regs || []).map((r: any) => Number(r.telegram_id));
          if (all.length && approved.length > all.length / 2) {
            // Кворум собран — утверждаем и сообщаем всем.
            await supabase.from('events').update({ shopping: { ...shopping, status: 'approved', approved_at: new Date().toISOString() } }).eq('id', (ev as any).id);
            const adminChat = process.env.TELEGRAM_ADMIN_CHAT_ID || '-1003935660570';
            await send(Number(adminChat), `🛒 <b>Закупка утверждена</b> — «${esc((ev as any).title)}»\nЗа: ${approved.length} из ${all.length} (>50%). Можно запускать закупщика из админки.`);
            for (const id of all) {
              await send(id, `🛒 Закупка на «<b>${esc((ev as any).title)}</b>» утверждена командой (${approved.length}/${all.length} за). Спасибо!`, undefined, 'payments');
            }
          } else {
            // Кворума нет — пингуем только тех, кто ещё не ответил.
            const silent = all.filter((id) => !approved.includes(id) && !objected.includes(id));
            for (const id of silent) {
              await send(
                id,
                `🛒 <b>Согласуй закупку — «${esc((ev as any).title)}»</b>\n\nКоманда ждёт твой голос: закупаем, когда «за» больше половины. Займёт 10 секунд.`,
                { inline_keyboard: [
                  [{ text: '✅ Согласен с закупкой', callback_data: `shopok_${(ev as any).id}` }],
                  [{ text: '✏️ Есть замечания', callback_data: `shopno_${(ev as any).id}` }],
                ] }, 'payments',
              );
            }
          }
        }

        for (const r of realIds(regs || [])) {
          const chatId = Number(r.telegram_id);
          // Кнопки RSVP: подтверждение, что человек «живой» и едет. «Не смогу»
          // спросит причину и снимет с события (webhook: rsvpy_/rsvpn_).
          const ok = await send(
            chatId,
            `⏰ <b>${esc((ev as any).title)}</b> — ${h.label}!\n` +
              ((ev as any).date_label ? `🗓 ${esc((ev as any).date_label)}\n` : '') +
              ((ev as any).location ? `📍 ${esc((ev as any).location)}\n` : '') +
              `\nТы с нами? Подтверди — так мы знаем, на кого рассчитывать.`,
            { inline_keyboard: [[
              { text: '✅ Еду', callback_data: `rsvpy_${(ev as any).id}` },
              { text: '❌ Не смогу', callback_data: `rsvpn_${(ev as any).id}` },
            ]] }, 'events',
          );
          if (ok) report.eventReminders++;

          // Контроль гостей: у кого записаны +N гостей — просим подтвердить состав.
          // «Все со мной» / «Изменить число» / отмена уже покрыта кнопкой RSVP выше.
          const gc = Number(r.guest_count) || 0;
          if (gc > 0) {
            await send(
              chatId,
              `👥 <b>Подтверди состав на «${esc((ev as any).title)}»</b>\n\n` +
                `У тебя записано <b>+${gc}</b> ${gc === 1 ? 'гость' : 'гостя/гостей'} (кроме тебя).\n` +
                `Всё в силе? Если кто-то отпадёт — измени число, чтобы освободить места и не заказать лишнюю еду.`,
              { inline_keyboard: [
                [{ text: `✅ Да, все ${gc} со мной`, callback_data: `gconf_${(ev as any).id}` }],
                [{ text: '✏️ Изменить число', callback_data: `gedit_${(ev as any).id}` }],
              ] }, 'events',
            );
          }

          // Оплата ещё не заявлена — отдельным сообщением с кнопкой.
          const unpaid = (ev as any).price_type === 'paid'
            && r.payment_status !== 'paid'
            && r.payment_status !== 'submitted';
          if (unpaid) {
            const sent = await send(
              chatId,
              `💳 <b>Оплата участия — «${esc((ev as any).title)}»</b>\n\n` +
                `Твоё участие ещё не оплачено. Оплати заранее, чтобы место осталось за тобой — жми кнопку ниже.`,
              { inline_keyboard: [[{ text: '💳 Оплатить участие', callback_data: `pay_${(ev as any).id}` }]] }, 'payments',
            );
            if (sent) report.paymentReminders++;
          }

          // За 3 дня: проверяем логистику и напоминаем о машинах тем, у кого их нет
          if (h.days === 3 && !r.has_transport) {
            const { data: rides } = await supabase
              .from('rides')
              .select('id,driver_name,from_point,depart_text,seats_total,seats_taken')
              .eq('event_id', (ev as any).id)
              .eq('active', true)
              .neq('kind', 'tent');
            const availableRides = (rides || []).filter((ride: any) => (ride.seats_total || 0) > (ride.seats_taken || 0));
            if (availableRides.length > 0) {
              const ridesList = availableRides
                .map((ride: any) => `🚗 <b>${esc(ride.driver_name || 'Водитель')}</b> из «${esc(ride.from_point || '—')}» (${esc(ride.depart_text || '—')}) — ${Math.max(0, (ride.seats_total || 0) - (ride.seats_taken || 0))} мест`)
                .join('\n');
              await send(
                chatId,
                `🚗 <b>Список машин с местами на «${esc((ev as any).title)}»:</b>\n\n${ridesList}\n\nНажми кнопку ниже — займёшь место!`,
                { inline_keyboard: [[{ text: '👀 Занять место в машине', callback_data: `rides_${(ev as any).id}` }]] }, 'logistics',
              );
            }
          }
        }

        // За 1 день до события — чек-лист сборки + меню
        if (h.days === 1) {
          const { data: allRegs } = await supabase
            .from('registrations')
            .select('telegram_id')
            .eq('event_id', (ev as any).id)
            .neq('status', 'cancelled');

          for (const r of realIds(allRegs || [])) {
            await send(
              Number(r.telegram_id),
              `🎒 <b>Завтра выезд — «${esc((ev as any).title)}»!</b>\n` +
                ((ev as any).date_label ? `📅 ${esc((ev as any).date_label)}\n` : '') +
                ((ev as any).location ? `📍 ${esc((ev as any).location)}\n` : '') +
                `\n<b>Чек-лист сборки:</b>\n` +
                `☐ Паспорт / ID\n☐ Деньги (если взносы)\n☐ Телефон + зарядка / повербанк\n☐ Личные лекарства\n☐ Одежда по погоде\n☐ Средства гигиены\n☐ Фонарик\n☐ Снаряжение (палатка, спальник, коврик)\n\n` +
                `⏰ Точное время сбора — в чате события или у организатора.`,
              { inline_keyboard: [
                [{ text: '✅ Собираюсь', callback_data: `ack_${(ev as any).id}` }],
                // Полный чек-лист клуба (~120 пунктов) — короткий список выше
                // только для памяти, всё остальное там.
                [{ text: '🎒 Полный чек-лист для кемпинга', callback_data: 'chk_camp' }],
                // Памятка (правила места, безопасность) — если организатор её заполнил.
                ...((ev as any).logistics?.prep ? [[{ text: '🎒 Как готовиться', callback_data: `prep_${(ev as any).id}` }]] : []),
              ] }, 'events',
            );
          }
        }

        // За 1 день: у ночёвки все должны где-то спать. Мест (палатки + машины
        // с ночёвкой не считаем — только заявленные палатки) < людей → сигнал оргам.
        if (h.days === 1 && (ev as any).date_end && (ev as any).date_end !== (ev as any).date) {
          const { data: tents } = await supabase
            .from('rides').select('seats_total')
            .eq('event_id', (ev as any).id).eq('active', true).eq('kind', 'tent');
          const beds = (tents || []).reduce((s: number, t: any) => s + (Number(t.seats_total) || 0), 0);
          // «[без ночёвки]» в notes — не считаем спальное место (уезжают вечером).
          const sleepers = (regs || []).reduce((s: number, r: any) =>
            String(r.notes || '').includes('[без ночёвки]') ? s : s + 1 + (Number(r.guest_count) || 0), 0);
          if (sleepers > beds) {
            const adminChat = process.env.TELEGRAM_ADMIN_CHAT_ID || '-1003935660570';
            await send(Number(adminChat),
              `🛌 <b>Дефицит мест для сна — «${esc((ev as any).title)}»</b>\n\n` +
                `Людей (с гостями): <b>${sleepers}</b>, заявленных мест в палатках: <b>${beds}</b>.\n` +
                `Не хватает: <b>${sleepers - beds}</b>. Попроси участников заявить палатки («⛺ Своя палатка» в логистике) или продумай сон в машинах.`);
          }
        }

        // За 1 день: дальний выезд (>30 км от Минска) колонной — организатор
        // обязан задать точку и время сбора колонны. Не задал — пинг.
        if (h.days === 1) {
          const lat = Number((ev as any).coordinates_lat), lng = Number((ev as any).coordinates_lng);
          if (Number.isFinite(lat) && Number.isFinite(lng)) {
            const R = 6371, dLat = (lat - 53.9045) * Math.PI / 180, dLng = (lng - 27.5615) * Math.PI / 180;
            const a = Math.sin(dLat / 2) ** 2 + Math.cos(53.9045 * Math.PI / 180) * Math.cos(lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
            const distKm = 2 * R * Math.asin(Math.sqrt(a));
            const lg = (ev as any).logistics || {};
            if (distKm > 30 && !lg.assemblyPoint) {
              const adminChat = process.env.TELEGRAM_ADMIN_CHAT_ID || '-1003935660570';
              // ИИ предлагает точку сбора на выезде из Минска по направлению маршрута.
              let hint = '';
              try {
                const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
                if (key) {
                  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${key}`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      contents: [{ parts: [{ text: `Колонна машин выезжает из Минска к точке ${lat},${lng} («${(ev as any).location || ''}»). Предложи ОДНО удобное место сбора колонны на выезде из Минска по этому направлению (АЗС или парковка у МКАД, где легко встать 5+ машинам). Ответ одной строкой: название места и примерные координаты.` }] }],
                      generationConfig: { maxOutputTokens: 200, thinkingConfig: { thinkingBudget: 0 } },
                    }),
                  });
                  const j: any = await r.json();
                  hint = ((j?.candidates?.[0]?.content?.parts || []).map((p: any) => p?.text || '').join('') || '').trim().slice(0, 300);
                }
              } catch { /* подсказка — best-effort */ }
              await send(Number(adminChat),
                `🧭 <b>Нет точки сбора колонны — «${esc((ev as any).title)}»</b>\n\n` +
                  `Выезд дальний (~${Math.round(distKm)} км): задай в админке (Логистика) точку сбора на выезде из Минска (координаты) и время — встретимся, познакомимся и стартуем колонной.` +
                  (hint ? `\n\n💡 <b>Предложение Flint:</b> ${esc(hint)}\n<i>Проверь по карте перед публикацией.</i>` : ''));
            }
          }
        }

        // За 1 день до события — рассылаем меню + рецепты, если они есть.
        if (h.days === 1) {
          const { data: menu } = await supabase
            .from('event_menus')
            .select('day,meal_type,dish,cooking_notes')
            .eq('event_id', (ev as any).id)
            .order('day')
            .order('meal_type');

          if (menu && menu.length > 0) {
            const days = [...new Set(menu.map((m: any) => m.day))].sort();
            const mealLabels: Record<string, string> = { breakfast: 'Завтрак', lunch: 'Обед', dinner: 'Ужин', snack: 'Перекус' };

            // 1) Общее меню
            let menuMsg = `🍽 <b>Меню на завтра: ${esc((ev as any).title)}</b>\n\n`;
            for (const day of days) {
              menuMsg += `<b>День ${day}</b>\n`;
              const dayItems = menu.filter((m: any) => m.day === day);
              for (const item of dayItems) {
                menuMsg += `${mealLabels[item.meal_type] || item.meal_type}: ${esc(item.dish)}\n`;
                if (item.cooking_notes) menuMsg += `   ${esc(item.cooking_notes)}\n`;
              }
              menuMsg += '\n';
            }

            // 2) Рецепты для каждого блюда (ужин — самый важный)
            const dinnerItems = menu.filter((m: any) => m.meal_type === 'dinner');
            let recipesMsg = '';
            if (dinnerItems.length > 0) {
              recipesMsg = `👨‍🍳 <b>Рецепты на ужин:</b>\n\n`;
              for (const item of dinnerItems) {
                try {
                  const aiRes = await fetch(`${process.env.VERCEL_URL || 'http://localhost:3000'}/api/profile`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'recipe', dish: item.dish }),
                  });
                  const aiData = await aiRes.json();
                  if (aiData.ok && aiData.recipe) {
                    recipesMsg += `<b>${esc(item.dish)}</b>\n${esc(aiData.recipe)}\n\n`;
                  }
                } catch {}
              }
            }

            const fullMsg = menuMsg + (recipesMsg ? `\n${recipesMsg}` : '');

            for (const r of realIds(regs || [])) {
              const chatId = Number(r.telegram_id);
              const sent = await send(chatId, fullMsg, undefined, 'events');
              if (sent) report.menuBroadcasts++;
            }
          }
        }
      }
    }

    // ── 2b. Сегодняшние события с «маршрутом дня»: утренний таймлайн ──────
    // Одно сообщение в день события (cron дневной — второго раза не будет).
    const todayStr = dayOffset(0);
    const { data: todayEvents } = await supabase
      .from('events').select('id,title,logistics,status')
      .eq('date', todayStr).eq('status', 'open');
    for (const ev of todayEvents || []) {
      const pts = Array.isArray((ev as any).logistics?.itinerary)
        ? (ev as any).logistics.itinerary.filter((p: any) => p?.title) : [];
      if (!pts.length) continue;
      const lines = pts.map((p: any) => `${p.time ? esc(p.time) + ' — ' : ''}${esc(p.title)}`).join('\n');
      const coords = pts.filter((p: any) => Number(p.lat) && Number(p.lng)).map((p: any) => `${p.lat},${p.lng}`);
      const route = coords.length >= 2 ? `https://yandex.ru/maps/?rtext=${coords.join('~')}&rtt=auto` : null;
      const { data: dayRegs } = await supabase
        .from('registrations').select('telegram_id')
        .eq('event_id', (ev as any).id).neq('status', 'cancelled');
      for (const r of realIds(dayRegs || [])) {
        const ok = await send(
          Number(r.telegram_id),
          `🌅 <b>Сегодня — ${esc((ev as any).title)}!</b>\n\n🧭 <b>План дня</b>\n${lines}\n\nДо встречи!`,
          route ? { inline_keyboard: [[{ text: '🧭 Маршрут в Яндексе', url: route }]] } : undefined,
          'events',
        );
        if (ok) report.eventReminders++;
      }
    }

    // ── 2b. Бади-связки на ближайших событиях ───────────────────────────────
    // Страховка к синхронизации при записи: добираем тех, до кого сообщение не
    // дошло (не открывал диалог с ботом, заблокировал и разблокировал, запись
    // прошла мимо бота). Горизонт 8 дней — чтобы пара сложилась не в день выезда.
    try {
      const { data: soon } = await supabase
        .from('events').select('id,title')
        .eq('status', 'open')
        .gte('date', dayOffset(0))
        .lte('date', dayOffset(8));
      for (const ev of soon || []) {
        await syncBuddies((ev as any).id);
        report.buddyPairs += await announcePendingBuddies((ev as any).id, (ev as any).title || 'событие');
      }
    } catch (e) { report.errors.push(`buddies: ${(e as Error).message}`); }

    // ── 3. Вчерашние события: просим отзыв + оценки блюд (один раз, по reminded_at) ─────
    const yesterday = dayOffset(-1);
    const { data: pastEvents } = await supabase
      .from('events')
      .select('id,title,notifications')
      .or(`date_end.eq.${yesterday},and(date.eq.${yesterday},date_end.is.null)`);

    for (const ev of pastEvents || []) {
      /**
       * Челлендж пропускаем. Владелец жаловался: при открытии бота вылезало
       * «ты был(а) на событии — пришли фото», и это было про 90-дневный
       * челлендж, на котором все сидят дома. Просить там фотографии нечего.
       * Флаг челленджа лежит в events.notifications, а не в отдельной колонке.
       */
      if (isChallengeEvent(ev)) continue;
      const { data: regs } = await supabase
        .from('registrations')
        .select('id,telegram_id,reminded_at')
        .eq('event_id', (ev as any).id)
        .neq('status', 'cancelled')
        .is('reminded_at', null);

      // Получаем меню события для оценок
      const { data: menu } = await supabase
        .from('event_menus')
        .select('day,meal_type,dish')
        .eq('event_id', (ev as any).id)
        .order('day')
        .order('meal_type');

      const uniqueDishes = menu
        ? [...new Set(menu.map((m: any) => m.dish))]
        : [];

      for (const r of realIds(regs || [])) {
        const chatId = Number(r.telegram_id);

        // 1) Общий отзыв
        const ok = await send(
          chatId,
          `🙏 Спасибо, что был(а) на «<b>${esc((ev as any).title)}</b>».\n\n` +
            `Оцени событие — это помогает делать следующее лучше.`,
          {
            inline_keyboard: [
              [{ text: '⭐ Оставить отзыв', callback_data: `fb_${(ev as any).id}` }],
              // Сбор медиа в галерею события — обработчик media_ живёт в вебхуке.
              [{ text: '📸 Прислать фото — минимум 5 моментов', callback_data: `media_${(ev as any).id}` }],
              /**
               * Анонимный опрос круга — репутация участников. Спрашиваем ровно
               * здесь, на следующий день: пока свежо, но эмоции уже осели.
               * Человек, о котором отмечают, ничего не узнаёт — иначе честных
               * ответов не будет. Обработчик rep_ живёт в вебхуке.
               */
              [{ text: '🤝 Оценить круг (анонимно)', callback_data: `rep_${(ev as any).id}` }],
            ],
          },
          'digest',
        );
        if (ok) {
          report.feedbackRequests++;
        }

        // 2) Оценка блюд (если есть меню)
        if (uniqueDishes.length > 0) {
          const dishButtons = uniqueDishes.slice(0, 5).map((dish: string) => [
            { text: `⭐ ${dish}`, callback_data: `rate_${(ev as any).id}_${encodeURIComponent(dish)}` }
          ]);
          const rateMsg = `🍽 <b>Как тебе еда на «${esc((ev as any).title)}»?</b>\n\n` +
            `Оцени блюда, чтобы мы улучшали меню:`;
          const rateOk = await send(chatId, rateMsg, { inline_keyboard: dishButtons }, 'digest');
          if (rateOk) report.feedbackRequests++;
        }

        // Помечаем, что отправили напоминание
        await supabase.from('registrations').update({ reminded_at: new Date().toISOString() }).eq('id', r.id);
      }
    }

    /**
     * «Штурман»: одно сообщение костяку с тем, что реально требует решения.
     * Данных в системе хватает на все ответы — не хватало того, кто их
     * сопоставит. Организатор не помнит про кнопку сплита, про людей без
     * кодекса, про бесхозные задачи: после Нарочи расходы считали в чате
     * руками, явку не отметили, отзыв оставил один человек из восьми.
     * Пишем ТОЛЬКО пункты, требующие действия — пустую сводку не шлём.
     */
    try {
      const adminChat = Number(process.env.TELEGRAM_ADMIN_CHAT_ID || '-1003935660570');
      const today = new Date().toISOString().slice(0, 10);
      const lines: string[] = [];
      const buttons: any[][] = [];

      // 1. Кодекс: кто из одобренных не принимал правила.
      const { data: allMembers } = await supabase
        .from('members').select('telegram_id,prefs').eq('status', 'approved');
      const noRules = (allMembers || []).filter((m: any) => !m.prefs?.rules_accepted).length;
      if (noRules >= 3) lines.push(`📜 <b>${noRules}</b> одобренных не приняли правила — им закрыта запись. Панель → Аудитория → «Без правил».`);

      /**
       * Кто в клубе, но не сказал ЗАЧЕМ. Вопрос появился 19.08 — все, кого
       * приняли раньше, остались без ответа: костяк не знает мотива людей,
       * которых сам же и впустил. Одна кнопка досылает вопрос всем сразу.
       */
      const noWhy = (allMembers || []).filter((m: any) => !m.prefs?.join_reason).length;
      if (noWhy >= 3) {
        lines.push(`🤝 <b>${noWhy}</b> членов клуба не ответили, зачем им клуб, и не подтвердили ценности.`);
        buttons.push([{ text: `🤝 Спросить всех (${noWhy})`, callback_data: 'askwhy_all' }]);
      }

      // 2. Заявки, ждущие решения.
      const { data: pendingM } = await supabase.from('members').select('telegram_id').eq('status', 'pending');
      if ((pendingM || []).length) lines.push(`🚪 <b>${(pendingM || []).length}</b> заявок на вступление ждут ответа.`);

      const { data: liveEvents } = await supabase
        .from('events').select('id,title,date,date_end,shopping,max_participants,staff').gte('date', dayOffset(-30)).neq('status', 'cancelled');
      for (const ev of liveEvents || []) {
        const id = (ev as any).id;
        const title = esc((ev as any).title);
        const ended = String((ev as any).date_end || (ev as any).date) < today;
        const { data: regs } = await supabase
          .from('registrations').select('telegram_id,attended').eq('event_id', id).neq('status', 'cancelled');
        if (!(regs || []).length) continue;

        if (ended) {
          // 3. Расходы собраны, а деньги не поделены.
          const expenses = Array.isArray((ev as any).shopping?.expenses) ? (ev as any).shopping.expenses : [];
          const transfers = Array.isArray((ev as any).shopping?.split?.transfers) ? (ev as any).shopping.split.transfers : [];
          if (expenses.length && !transfers.length) {
            const sum = expenses.reduce((s: number, e: any) => s + (Number(e.amount) || 0), 0);
            lines.push(`💸 «${title}»: расходов на <b>${Math.round(sum)} BYN</b>, а сплит не разослан. Панель → событие → «Сплит».`);
          }
          // 4. Отзывы: меньше трети — есть смысл попросить ещё раз.
          const { data: fb } = await supabase.from('feedback').select('id').eq('event_id', id);
          if ((fb || []).length * 3 < (regs || []).length) {
            lines.push(`⭐ «${title}»: отзывов ${(fb || []).length} из ${(regs || []).length}. Стоит попросить ещё.`);
          }
        } else {
          /**
           * 4a. Помощники организатора («сержанты»). Правило клуба: круг
           * больше 10 человек один человек физически не удержит — нужны двое,
           * на которых перекличка, деньги и безопасность. Напоминаем ДО
           * события, пока назначить ещё есть кого.
           */
          const staff = Array.isArray((ev as any).staff) ? (ev as any).staff : [];
          if ((regs || []).length > 10 && staff.length < 2) {
            lines.push(`🎖 «${title}»: в составе <b>${(regs || []).length}</b> человек, а помощников назначено <b>${staff.length}</b> из 2. Один организатор такой круг не удержит.`);
            buttons.push([{ text: `🎖 Назначить помощников «${(ev as any).title}»`.slice(0, 58), callback_data: `staff_${id}` }]);
          }

          // 5. Бесхозные задачи перед событием.
          const { data: tk } = await supabase.from('tasks').select('id,taken_by,done').eq('event_id', id);
          const orphan = (tk || []).filter((t: any) => !t.taken_by && !t.done).length;
          if (orphan) {
            lines.push(`📋 «${title}»: <b>${orphan}</b> задач без ответственного.`);
            buttons.push([{ text: `📋 Кинуть задачи в чат «${(ev as any).title}»`.slice(0, 58), callback_data: `navtask_${id}` }]);
          }
          // 6. Логистика: безлошадные против свободных мест.
          const { data: rd } = await supabase
            .from('rides').select('driver_id,seats_total,seats_taken,kind').eq('event_id', id).eq('active', true);
          const cars = (rd || []).filter((r: any) => r.kind !== 'tent');
          const free = cars.reduce((s: number, r: any) => s + Math.max(0, (r.seats_total || 0) - (r.seats_taken || 0)), 0);
          const drivers = new Set(cars.map((r: any) => Number(r.driver_id)));
          const footless = (regs || []).filter((r: any) => !drivers.has(Number(r.telegram_id))).length;
          if (footless > free) lines.push(`🚗 «${title}»: без машины ${footless} чел., свободно мест ${free}. Не хватает <b>${footless - free}</b>.`);
        }
      }

      if (lines.length) {
        buttons.push([{ text: '🛠 Открыть панель', url: `${(process.env.SITE_URL || 'https://flint-live-in-moment.vercel.app').replace(/\/$/, '')}/admin` }]);
        await send(
          adminChat,
          `🧭 <b>Штурман: что требует решения</b>\n\n${lines.map((l) => `• ${l}`).join('\n\n')}`,
          { inline_keyboard: buttons },
          'digest',
        );
        report.feedbackRequests++;
      }
    } catch (e) {
      report.errors.push(`navigator: ${(e as Error).message}`);
    }

    /**
     * Явка после события: кто реально был.
     * После Нарочи из 8 участников не был отмечен ни один — значит ни баллов
     * за участие, ни истории посещений. Руками это никто не делает, поэтому
     * через сутки после конца события считаем, что были все, кто не отказался
     * и не пометился «не приеду», и начисляем баллы. Ошибку организатор
     * поправит в панели: attended там переключается вручную.
     */
    try {
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const { data: doneEvents } = await supabase
        .from('events').select('id,title,date,date_end')
        .lte('date', dayAgo).gte('date', new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
      for (const ev of doneEvents || []) {
        const ends = String((ev as any).date_end || (ev as any).date);
        if (ends > dayAgo) continue; // событие ещё идёт или кончилось меньше суток назад
        const { data: regs } = await supabase
          .from('registrations').select('id,telegram_id,attended,status')
          .eq('event_id', (ev as any).id).neq('status', 'cancelled');
        const pending = (regs || []).filter((r: any) => !r.attended && r.status !== 'declined');
        if (!pending.length) continue;
        for (const r of pending as any[]) {
          await supabase.from('registrations').update({ attended: true }).eq('id', r.id);
          // Баллы за участие — той же величины, что начисляет админка, и с
          // записью причины: иначе в рейтинге баллы «ни за что».
          try {
            const { data: m } = await supabase.from('members').select('points,referred_by').eq('telegram_id', r.telegram_id).maybeSingle();
            await supabase.from('members').update({ points: ((m as any)?.points || 0) + 100 }).eq('telegram_id', r.telegram_id);
            try {
              await supabase.from('points_log').insert({ telegram_id: r.telegram_id, event_id: (ev as any).id, reason: 'attend', points: 100, description: `Участие: ${(ev as any).title}` });
            } catch { /* журнал необязателен */ }
            // Первое посещение приглашённого — 150 баллов тому, кто привёл (как в админке).
            const inviter = Number((m as any)?.referred_by) || 0;
            if (inviter > 0) {
              const { count } = await supabase.from('registrations').select('id', { count: 'exact', head: true })
                .eq('telegram_id', r.telegram_id).eq('attended', true).neq('id', r.id);
              const { data: refRow } = await supabase.from('referrals').select('rewarded').eq('invited_id', r.telegram_id).eq('inviter_id', inviter).maybeSingle();
              if (!count && !(refRow as any)?.rewarded) {
                const { data: im } = await supabase.from('members').select('points').eq('telegram_id', inviter).maybeSingle();
                const { data: nm } = await supabase.from('members').select('first_name').eq('telegram_id', r.telegram_id).maybeSingle();
                await supabase.from('members').update({ points: ((im as any)?.points || 0) + 150 }).eq('telegram_id', inviter);
                await supabase.from('referrals').update({ rewarded: true }).eq('invited_id', r.telegram_id).eq('inviter_id', inviter);
                try {
                  await supabase.from('points_log').insert({ telegram_id: inviter, event_id: (ev as any).id, reason: 'referral', points: 150, description: `Привёл друга: ${(nm as any)?.first_name || 'новый участник'} побывал на первом событии` });
                } catch { /* журнал необязателен */ }
              }
            }
          } catch { /* колонки points может не быть */ }
        }
        const adminChat = Number(process.env.TELEGRAM_ADMIN_CHAT_ID || '-1003935660570');
        if (adminChat) {
          await send(
            adminChat,
            `📌 <b>${esc((ev as any).title)}</b>: отметил участие ${pending.length} чел. и начислил баллы.\n` +
              `Если кто-то не доехал — сними галочку «был» в панели.`,
            undefined,
            'digest',
          );
        }
      }
    } catch (e) {
      report.errors.push(`attendance: ${(e as Error).message}`);
    }

    // ── Подогрев: соц-доказательство при РЕАЛЬНОМ приросте участников ──────
    // Мировая практика «social proof», но без спама: шлём максимум раз в день
    // (крон суточный) и ТОЛЬКО когда людей реально стало больше. Базу (сколько
    // было в прошлый раз) держим в events.notifications._heatCount — без DDL.
    // Окно 2..30 дней: не пересекаемся с «завтра»-напоминанием и днём события,
    // и не дёргаем по слишком далёким событиям. Первый прогон — тихая база.
    try {
      const { data: growEvents } = await supabase
        .from('events')
        .select('id,title,notifications,max_participants,status,date')
        .eq('status', 'open')
        .gte('date', dayOffset(2))
        .lte('date', dayOffset(30));

      for (const ev of growEvents || []) {
        const { data: regs } = await supabase
          .from('registrations').select('telegram_id')
          .eq('event_id', (ev as any).id).neq('status', 'cancelled');
        const cur = (regs || []).length;
        const notif = (ev as any).notifications || {};
        const last = Number(notif._heatCount);

        if (Number.isFinite(last)) {
          const delta = cur - last;
          if (delta >= 1) {
            const cap = (ev as any).max_participants;
            const left = cap ? Math.max(0, cap - cur) : null;
            const capPhrase = left === null ? '' : left > 0 ? ` (осталось ${left} мест)` : ' — мест почти нет!';
            const msg =
              `🔥 <b>${esc((ev as any).title)}</b> набирает!\n\n` +
              `+${delta} ${delta === 1 ? 'человек присоединился' : 'человека присоединились'} — уже <b>${cur}</b> едет${capPhrase}.\n\n` +
              `Позови друга — с классной компанией всегда теплее. 📤`;
            for (const r of realIds(regs || [])) {
              const ok = await send(Number(r.telegram_id), msg, {
                inline_keyboard: [[{ text: '📤 Позвать друга', callback_data: `share_${(ev as any).id}` }]],
              }, 'events');
              if (ok) (report as any).heatPings = ((report as any).heatPings || 0) + 1;
            }
          }
        }
        // Обновляем базу всегда (и при оттоке — чтобы следующий прирост считался честно).
        await supabase.from('events')
          .update({ notifications: { ...notif, _heatCount: cur } })
          .eq('id', (ev as any).id);
      }
    } catch { /* подогрев не должен ронять остальные напоминания */ }

    /**
     * АВТО-ПЕРЕКЛИЧКА В ЧАТЕ СОБЫТИЯ — бот думает за организатора.
     * Раньше «кто едет?» кто-то должен был вспомнить и спросить руками
     * (/перекличка). Теперь бот сам, за 3 дня и за 1 день до события, пишет
     * в привязанный чат: кто записан, кто пишет в чате, но не отметился,
     * и кнопки «Еду / Думаю / Не еду». По одному разу на отметку
     * (events.logistics._rollcall), организатору — сводка в личку.
     */
    try {
      for (const days of [3, 1]) {
        const { data: evs } = await supabase
          .from('events').select('id,title,date,logistics,deputy_id,max_participants')
          .eq('date', dayOffset(days)).in('status', ['open', 'locked']);
        for (const ev of evs || []) {
          const lg: any = (ev as any).logistics || {};
          const done: Record<string, boolean> = lg._rollcall || {};
          if (done[`d${days}`]) continue;
          const { data: eg } = await supabase.from('event_groups').select('chat_id').eq('event_id', (ev as any).id).eq('active', true).maybeSingle();
          const chatId = Number((eg as any)?.chat_id || 0);
          const { data: regs } = await supabase.from('registrations').select('telegram_id,name,guest_count').eq('event_id', (ev as any).id).neq('status', 'cancelled');
          const regIds = new Set((regs || []).map((r: any) => Number(r.telegram_id)));
          const heads = (regs || []).reduce((n: number, r: any) => n + 1 + (Number(r.guest_count) || 0), 0);
          if (chatId) {
            const { data: talkers } = await supabase.from('group_messages').select('telegram_id,first_name,username').eq('chat_id', chatId).order('created_at', { ascending: false }).limit(300);
            const seen = new Map<number, string>();
            for (const t of talkers || []) {
              const id = Number((t as any).telegram_id);
              if (id > 0 && !regIds.has(id) && !seen.has(id)) seen.set(id, (t as any).first_name || (t as any).username || 'Участник');
            }
            const list = (regs || []).map((r: any, i: number) => `${i + 1}. ${esc(r.name || 'Участник')}${r.guest_count ? ` +${r.guest_count}` : ''}`).join('\n');
            await tg('sendMessage', {
              chat_id: chatId, parse_mode: 'HTML',
              text: `📋 <b>${days === 1 ? 'Завтра' : 'Через 3 дня'} — «${esc((ev as any).title)}»</b>\n\n` +
                (list ? `Едут (${heads}):\n${list}` : 'Пока никто не отметился.') +
                (seen.size ? `\n\n❓ ${[...seen.values()].slice(0, 15).map(esc).join(', ')} — вы с нами? Отметьтесь, чтобы попасть в машины, бади и список «кто что везёт».` : '') +
                `\n\nОтметься кнопкой 👇`,
              reply_markup: { inline_keyboard: [[
                { text: '✅ Еду', callback_data: `grpgo_${(ev as any).id}` },
                { text: '🤔 Думаю', callback_data: `grpmaybe_${(ev as any).id}` },
                { text: '❌ Не еду', callback_data: `grpno_${(ev as any).id}` },
              ]] },
            });
            report.eventReminders++;
          }
          // Организатору — короткая сводка: сколько едет, где провал.
          const org = Number((ev as any).deputy_id || 0);
          if (org > 0) {
            const cap = Number((ev as any).max_participants) || 0;
            await send(org,
              `🧭 <b>«${esc((ev as any).title)}» — ${days === 1 ? 'завтра' : 'через 3 дня'}</b>\n\n` +
              `Едут: <b>${heads}</b>${cap ? ` из ${cap}` : ''}.` +
              (chatId ? `\nВ чат события я отправил перекличку — отметки придут сами.` : `\n⚠️ У события нет чата, куда я могу писать: добавь меня в группу выезда — я привяжусь сам.`) +
              (cap && heads < Math.ceil(cap / 3) ? `\n\n📣 Мало людей — позови своих: ссылка в карточке события.` : ''),
              undefined, 'events');
          }
          await supabase.from('events').update({ logistics: { ...lg, _rollcall: { ...done, [`d${days}`]: true } } }).eq('id', (ev as any).id);
        }
      }
    } catch (e) { report.errors.push(`rollcall: ${(e as Error).message}`); }

    // Чистка галерей: через 7 дней после события остаётся топ-5 по голосам
    // (is_keeper), остальные строки удаляются. Сами файлы живут в Telegram
    // у отправителей — «удаление» значит только уход из галереи.
    try {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      // Неделя считается от КОНЦА события: многодневный выезд или челлендж не
      // должен обрезаться до топ-5, пока он ещё идёт. Свежие — первыми, чтобы
      // при >50 прошедших событиях выбор не был случайным.
      const { data: oldEvents } = await supabase
        .from('events').select('id,date,date_end').lt('date', weekAgo)
        .order('date', { ascending: false }).limit(50);
      for (const ev of (oldEvents || []).filter((e: any) => String(e.date_end || e.date) < weekAgo)) {
        const { data: media } = await supabase
          .from('event_media').select('id,is_keeper')
          .eq('event_id', (ev as any).id)
          .order('votes', { ascending: false }).order('created_at', { ascending: true });
        if (!media || !media.length) continue;
        // is_keeper уже отобранное (в т.ч. официальный ролик и фото клуба) не
        // трогаем никогда. Раньше топ-5 считался по всей галерее: стоило одному
        // участнику дозалить фото — официальные материалы с 0 голосов
        // проигрывали и удалялись. Топ-5 теперь выбирается только из новых.
        const fresh = media.filter((m: any) => !m.is_keeper);
        if (!fresh.length) continue;
        const keep = fresh.slice(0, 5).map((m: any) => m.id);
        const drop = fresh.slice(5).map((m: any) => m.id);
        await supabase.from('event_media').update({ is_keeper: true }).in('id', keep);
        if (drop.length) await supabase.from('event_media').delete().in('id', drop);
        (report as any).galleriesCleaned = ((report as any).galleriesCleaned || 0) + 1;
      }
    } catch { /* чистка не должна ронять напоминания */ }

    // ══════════════════════════════════════════════════════════════════════════
    // БЛОК C: Челлендж — «кто ещё не отметился сегодня»
    // ══════════════════════════════════════════════════════════════════════════
    /**
     * У челленджа провал виден не по цифре «сколько записалось», а по тишине:
     * человек пропустил утро — и молчит. Без этого блока о пропуске узнают
     * только тогда, когда серия уже разорвана, и мотивация потеряна.
     *
     * Пишем в ЧАТ челленджа, а не в личку каждому: это групповое дело, и
     * «вижу, что другие уже встали» работает сильнее персонального пинга.
     * Считаем чек-ины из app_config — там они и лежат (ключ
     * challenge_checkin:<eventId>:<telegramId>:<дата>).
     *
     * Расписание. На Vercel Hobby крон ходит РАЗ В СУТКИ — `0 6 * * *`,
     * то есть 06:00 UTC = 09:00 по Минску. Поэтому порог «не раньше 08:00
     * Минска» здесь не защита от повторного запуска, а страховка: если крон
     * случайно дёрнут вручную днём, пинг всё равно уйдёт (время уже прошло),
     * а если запустят ночью — не разбудим людей в 4 утра.
     * От повторов защищает отметка `_challengeNudge` ниже, а не время.
     */
    try {
      const CHALLENGE_HOUR = 8;
      const minskNow = new Date(Date.now() + 3 * 60 * 60 * 1000); // UTC+3
      const todayMinsk = minskNow.toISOString().slice(0, 10);
      const { data: challengeEvents } = await supabase
        .from('events')
        .select('id,title,date,date_end,notifications')
        .lte('date', todayMinsk)
        .gte('date_end', todayMinsk);
      for (const ev of challengeEvents || []) {
        const n = ((ev as any).notifications || {}) as Record<string, any>;
        if (n._format !== 'challenge' && n.is_challenge !== true) continue;
        // Один раз в сутки: отметку «уже напоминал» держим в том же jsonb,
        // что и остальные служебные поля события — без новой миграции.
        if (n._challengeNudge === todayMinsk) continue;
        // Утренний пинг имеет смысл только утром. Часы берём сдвинутые
        // (UTC+3), поэтому сравниваем с UTC-значением сдвинутой даты.
        if (minskNow.getUTCHours() < CHALLENGE_HOUR) continue;

        const { data: grp } = await supabase
          .from('event_groups').select('chat_id').eq('event_id', (ev as any).id).eq('active', true).maybeSingle();
        if (!grp) continue;

        // Кто отметился сегодня и кто записан — разница и есть «молчуны».
        const { data: checkRows } = await supabase
          .from('app_config').select('key')
          .ilike('key', `challenge_checkin:${(ev as any).id}:%:${todayMinsk}`);
        const doneIds = new Set((checkRows || []).map((r: any) => Number(String(r.key).split(':')[2])));
        const { data: regs } = await supabase
          .from('registrations').select('telegram_id')
          .eq('event_id', (ev as any).id).neq('status', 'cancelled');
        const silent = (regs || []).filter((r: any) => !doneIds.has(Number(r.telegram_id)));
        // Никто не отметился и никто не записан — писать некому.
        if (doneIds.size === 0 && silent.length === 0) continue;

        const dayNo = Math.max(1, Math.round(
          (new Date(todayMinsk).getTime() - new Date((ev as any).date).getTime()) / 86400000) + 1);
        await tg('sendMessage', {
          chat_id: Number((grp as any).chat_id), parse_mode: 'HTML',
          /**
           * Утренний пинг — это ТРИ слова и одна картинка в голове, а не
           * инструкция. Раньше здесь стояло «Сними видео-кружок и отправь
           * сюда»: человек, которому лень снимать видео, читал это и
           * откладывал на вечер, а вечером уже не откладывалось.
           * Теперь перечислены все три способа — выбрать можно любой, и
           * «просто сфоткать» перестаёт быть нарушением правил.
           */
          text: `🔥 <b>День ${dayNo}. Отметься.</b>\n\n` +
            (doneIds.size ? `Уже отметились: <b>${doneIds.size}</b>` : '') +
            (silent.length ? (doneIds.size ? ' · ' : '') + `ждём: <b>${silent.length}</b>` : '') +
            '\n\n<b>Кружок · фото · слово</b> — сюда. Бот засчитает день.' +
            '\n<i>3 дня тишины — 🟨, ещё день — 🟥 и выход из челленджа.</i>',
        });
        await supabase.from('events')
          .update({ notifications: { ...n, _challengeNudge: todayMinsk } })
          .eq('id', (ev as any).id);
        (report as any).challengeNudges = ((report as any).challengeNudges || 0) + 1;
      }
    } catch (e) { report.errors.push(`challenge: ${(e as Error).message}`); }

    /**
     * ЖЁЛТАЯ И КРАСНАЯ КАРТОЧКИ ЧЕЛЛЕНДЖА — «пассажиров» выводим.
     *
     * Записался, отметился раз-другой и дальше молча читает, как стараются
     * другие. Для группы это хуже, чем его отсутствие: «нас 7» на деле значит
     * «нас 4», и смотреть, как кто-то сдался без последствий, — разрешение
     * сдаться самому.
     *
     * Правило — как в 75 Hard, Duolingo и беговых клубах Strava: считаем не
     * общее число отметок, а ТИШИНУ ПОДРЯД, и перед выводом всегда есть
     * предупреждение с шансом вернуться:
     *   • 1–2 дня без отметки — ничего, бывает (серия просто обнуляется);
     *   • 3 дня подряд — 🟨 жёлтая карточка: фирменный баннер в чат + личка;
     *   • после карточки ещё день тишины — 🟥 красная: баннер, вывод из чата,
     *     запись снимается. Не бан: в новом сезоне можно зайти с первого дня.
     * Отметка — кружок, фото или СЛОВО (вебхук засчитывает и текст), поэтому
     * «заболел» или «в дороге» одним сообщением спасают серию от карточки.
     *
     * Не трогаем: организатора события, костяк и владельца. Новичку отсчёт
     * идёт с дня записи, а не со старта челленджа.
     *
     * Карточка хранится в app_config `challenge_warn:<eventId>:<tgId>` (дата):
     * отметился после неё — карточка снимается сама. Крон раз в сутки, поэтому
     * от жёлтой до красной ровно один день на исправление.
     */
    try {
      const WARN_AFTER_DAYS = 3;
      const SITE = (process.env.SITE_URL || 'https://flint-live-in-moment.vercel.app').replace(/\/$/, '');
      const DAY = 86400000;
      const minskNow = new Date(Date.now() + 3 * 60 * 60 * 1000);
      const todayMinsk = minskNow.toISOString().slice(0, 10);
      const dayDiff = (a: string, b: string) => Math.round((new Date(a).getTime() - new Date(b).getTime()) / DAY);
      const minskDate = (iso: string) => new Date(new Date(iso).getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const days = (k: number) => `${k} ${k % 10 === 1 && k % 100 !== 11 ? 'день' : [2, 3, 4].includes(k % 10) && ![12, 13, 14].includes(k % 100) ? 'дня' : 'дней'}`;
      const mention = (id: number, name: string) => `<a href="tg://user?id=${id}">${escH(name || 'Участник')}</a>`;

      const { data: challengeEvents } = await supabase
        .from('events')
        .select('id,title,date,date_end,status,deputy_id,notifications')
        .lte('date', todayMinsk)
        .gte('date_end', todayMinsk);
      for (const ev of (challengeEvents || []) as any[]) {
        if (!isChallengeEvent(ev) || ev.status === 'closed' || ev.status === 'cancelled') continue;
        const { data: grp } = await supabase
          .from('event_groups').select('chat_id').eq('event_id', ev.id).eq('active', true).maybeSingle();
        const chatId = grp ? Number((grp as any).chat_id) : 0;
        if (!chatId) continue;

        // Правила — один раз, закреплённым сообщением: карточка без
        // объявленного заранее правила выглядит произволом.
        const n = (ev.notifications || {}) as Record<string, any>;
        if (!n._challengeRules) {
          const r = await tg('sendMessage', {
            chat_id: chatId, parse_mode: 'HTML',
            text: `📜 <b>Правила челленджа FLINT</b>\n\n` +
              `1. Каждый день — отметка здесь: <b>кружок, фото или одно слово</b> о том, что сделал. Бот засчитывает день.\n` +
              `2. Пропустил день — бывает: серия обнулится, но ты в игре.\n` +
              `3. <b>${WARN_AFTER_DAYS} дня подряд</b> без отметки — 🟨 жёлтая карточка: предупреждение здесь и в личке.\n` +
              `4. Не отметился на следующий день после карточки — 🟥 красная: выбываешь, бот выводит из чата.\n` +
              `5. Заболел, в дороге — напиши об этом сюда одним словом. Это тоже отметка.\n` +
              `6. Молча наблюдать нельзя: челлендж держится на том, что все видят друг друга.\n\n` +
              `Выбывший может вернуться в новом сезоне — с первого дня.`,
          });
          if (r?.ok) await tg('pinChatMessage', { chat_id: chatId, message_id: r.result.message_id, disable_notification: true });
          await supabase.from('events')
            .update({ notifications: { ...n, _challengeRules: todayMinsk } })
            .eq('id', ev.id);
        }

        const { data: regs } = await supabase
          .from('registrations').select('id,telegram_id,name,registered_at')
          .eq('event_id', ev.id).neq('status', 'cancelled');
        const people = realIds(regs || []);
        if (!people.length) continue;

        const { data: checkRows } = await supabase
          .from('app_config').select('key').ilike('key', `challenge_checkin:${ev.id}:%`);
        const lastCheckin = new Map<number, string>();
        for (const r of checkRows || []) {
          const [, , id, d] = String((r as any).key).split(':');
          const uid = Number(id);
          if (d && (!lastCheckin.has(uid) || d > lastCheckin.get(uid)!)) lastCheckin.set(uid, d);
        }
        const { data: warnRows } = await supabase
          .from('app_config').select('key,value').ilike('key', `challenge_warn:${ev.id}:%`);
        const warnedOn = new Map<number, string>(
          (warnRows || []).map((r: any) => [Number(String(r.key).split(':')[2]), String(r.value)]));

        const ids = people.map((p: any) => Number(p.telegram_id));
        const { data: mems } = await supabase
          .from('members').select('telegram_id,is_core,role').in('telegram_id', ids);
        const immune = new Set<number>((mems || [])
          .filter((m: any) => m.is_core === true || m.role === 'owner')
          .map((m: any) => Number(m.telegram_id)));
        if (ev.deputy_id) immune.add(Number(ev.deputy_id));

        for (const p of people as any[]) {
          const uid = Number(p.telegram_id);
          if (immune.has(uid)) continue;
          const name = String(p.name || 'Участник').split(' ')[0];
          // Тишина = полные прошедшие дни после последней отметки. Не
          // отмечался ни разу — отсчёт с дня записи (или старта челленджа).
          const start = [ev.date, p.registered_at ? minskDate(p.registered_at) : ev.date].sort().pop()!;
          const lastActive = lastCheckin.get(uid) || new Date(new Date(start).getTime() - DAY).toISOString().slice(0, 10);
          const silent = Math.max(0, dayDiff(todayMinsk, lastActive) - 1);
          const warnKey = `challenge_warn:${ev.id}:${uid}`;
          const warned = warnedOn.get(uid);

          if (silent < WARN_AFTER_DAYS) {
            // Вернулся после карточки — снимаем её.
            if (warned) await supabase.from('app_config').delete().eq('key', warnKey);
            continue;
          }

          if (!warned) {
            await tg('sendPhoto', {
              chat_id: chatId, parse_mode: 'HTML',
              photo: `${SITE}/assets/challenge/warning.png`,
              caption: `🟨 ${mention(uid, name)}, <b>${days(silent)} без отметки.</b>\n\n` +
                `Отметься сегодня — кружок, фото или одно слово. Завтра утром без отметки — красная карточка и выход из челленджа.`,
            });
            await send(uid,
              `🟨 <b>Жёлтая карточка в челлендже «${escH(ev.title)}»</b>\n\n` +
              `${days(silent)} без отметки. Сегодня — последний день, чтобы вернуться: ` +
              `кружок, фото или одно слово в чат челленджа. Иначе завтра утром бот выведет тебя из чата.`);
            await supabase.from('app_config').upsert({ key: warnKey, value: todayMinsk }, { onConflict: 'key' });
            (report as any).challengeWarned = ((report as any).challengeWarned || 0) + 1;
            continue;
          }

          // Карточка уже была, и с того дня — ни одной отметки.
          if (warned >= todayMinsk) continue;
          // ban + unban = «вывести, но не запретить вход»: kick в Bot API
          // без разбана — это пожизненный бан в группе.
          const out = await tg('banChatMember', { chat_id: chatId, user_id: uid, revoke_messages: false });
          if (out?.ok) await tg('unbanChatMember', { chat_id: chatId, user_id: uid, only_if_banned: true });
          await tg('sendPhoto', {
            chat_id: chatId, parse_mode: 'HTML',
            photo: `${SITE}/assets/challenge/out.png`,
            caption: `🟥 ${mention(uid, name)} выбывает: ${days(silent)} тишины после жёлтой карточки.\n\n` +
              `Остальные — в игре. Отметка сегодня держит серию.`,
          });
          await send(uid,
            `🟥 <b>Ты выбыл из челленджа «${escH(ev.title)}»</b>\n\n` +
            `После жёлтой карточки отметки не было. Без обид — так работает правило для всех. ` +
            `Вернуться можно в новом сезоне, с первого дня.`);
          await supabase.from('registrations')
            .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancel_reason: 'challenge_inactive' })
            .eq('id', p.id);
          await supabase.from('app_config').delete().eq('key', warnKey);
          // Бот без права ограничивать участников молча не справится —
          // организатор должен узнать, что человека надо убрать руками.
          if (!out?.ok && ev.deputy_id) {
            await send(Number(ev.deputy_id),
              `⚠️ Не смог вывести ${escH(name)} из чата челленджа: ${escH(String(out?.description || 'нет прав'))}. ` +
              `Дай боту право «Блокировка пользователей» или убери вручную.`);
          }
          (report as any).challengeOut = ((report as any).challengeOut || 0) + 1;
        }
      }
    } catch (e) { report.errors.push(`challenge-cards: ${(e as Error).message}`); }

    // ══════════════════════════════════════════════════════════════════════════
    // БЛОК D: Авто-кик «молчаливых» из чата события
    // ══════════════════════════════════════════════════════════════════════════
    /**
     * В чат выезда попадают по пересланной ссылке: человек заходит, читает
     * локации и планы, но не отмечается и не пишет ни слова. Для организатора
     * это выглядит как «нас 40», хотя едет 12, и машины считаются по мёртвым
     * душам.
     *
     * Правило: если человек в чате события сидит больше часа, ни разу не
     * написал и не отмечен в составе — бота просит его выйти. Это НЕ бан:
     * `kickChatMember` (а не `banChatMember`) не запрещает вернуться, и по
     * той же ссылке человек зайдёт снова, как только реально соберётся.
     *
     * Защита от ошибок: костяк, организатор и все, кто хоть раз писал в чат,
     * не трогаются никогда. Отсчёт — 60 минут с момента появления в группе,
     * метку ставит вебхук на new_chat_members (Telegram историю не отдаёт).
     *
     * Точность вывода ограничена расписанием крона: на Hobby он ходит раз в
     * сутки (09:00 Минска), поэтому человек, зашедший вечером, будет выведен
     * следующим утром, а не через час. Для чата выезда это нормально —
     * «молчаливый» уходит до начала сбора людей, а не в момент чтения.
     */
    try {
      const KICK_AFTER_MS = 60 * 60 * 1000;
      const { data: activeGroups } = await supabase
        .from('event_groups').select('event_id,chat_id').eq('active', true);
      for (const grp of activeGroups || []) {
        const chatId = Number((grp as any).chat_id);
        const evId = String((grp as any).event_id);
        if (!Number.isFinite(chatId) || chatId >= 0) continue;

        const { data: ev } = await supabase
          .from('events').select('id,title,status,deputy_id').eq('id', evId).maybeSingle();
        // Кикаем только в живых событиях: после выезда группа доживает свою
        // жизнь, и выкидывать оттуда никого не нужно.
        if (!ev || (ev as any).status === 'closed') continue;

        const { data: regs } = await supabase
          .from('registrations').select('telegram_id')
          .eq('event_id', evId).neq('status', 'cancelled');
        const regIds = new Set((regs || []).map((r: any) => Number(r.telegram_id)));
        if ((ev as any).deputy_id) regIds.add(Number((ev as any).deputy_id));

        // Кто вообще писал в этом чате — тех не трогаем: человек может не
        // отметиться, но он живой в переписке, значит он с нами.
        const { data: talkers } = await supabase
          .from('group_messages').select('telegram_id').eq('chat_id', chatId).limit(2000);
        const talkerIds = new Set((talkers || []).map((t: any) => Number(t.telegram_id)));

        // Первое появление в чате пишем сами: Telegram историю участия не
        // отдаёт, поэтому метку времени ставит вебхук на new_chat_members.
        const sinceKey = `groupjoin:${chatId}`;
        const { data: joinRow } = await supabase.from('app_config').select('value').eq('key', sinceKey).maybeSingle();
        let joins: Record<string, number> = {};
        try { joins = joinRow ? JSON.parse(String((joinRow as any).value)) : {}; } catch { joins = {}; }

        const now = Date.now();
        const stale = Object.entries(joins).filter(([id, at]) =>
          now - Number(at) >= KICK_AFTER_MS
          && !regIds.has(Number(id))
          && !talkerIds.has(Number(id)));

        // Костяк проверяем одним запросом: он почти никогда не в списке записей.
        let coreIds = new Set<number>();
        if (stale.length) {
          const { data: mems } = await supabase
            .from('members').select('telegram_id,is_core,role')
            .in('telegram_id', stale.map(([id]) => Number(id)));
          coreIds = new Set((mems || [])
            .filter((m: any) => m.is_core === true || m.role === 'owner')
            .map((m: any) => Number(m.telegram_id)));
        }

        for (const [id] of stale) {
          const uid = Number(id);
          if (!Number.isFinite(uid)) { delete joins[id]; continue; }
          // Костяк и основателя из чата не выводим никогда.
          if (coreIds.has(uid)) { delete joins[id]; continue; }
          const kicked = await tg('kickChatMember', { chat_id: chatId, user_id: uid });
          if (kicked?.ok) (report as any).staleKicked = ((report as any).staleKicked || 0) + 1;
          // Метку снимаем в любом случае: вторую попытку в тот же день не
          // повторяем, иначе один неудачный кик превращается в спам-цикл.
          delete joins[id];
        }

        await supabase.from('app_config').upsert({ key: sinceKey, value: JSON.stringify(joins) });
      }
    } catch (e) { report.errors.push(`stale-kick: ${(e as Error).message}`); }

    /**
     * ФОТО-МИССИЯ в день события (первый день многодневного). Каждому
     * записанному: общее фото всей командой + минимум 5 ярких кадров прямо в
     * бот — это история клуба и материал для видео-итогов. Раз на событие.
     */
    try {
      const today = dayOffset(0);
      const { data: todayEvents } = await supabase.from('events').select('id,title,notifications,status').eq('date', today);
      for (const ev of (todayEvents || []) as any[]) {
        if (isChallengeEvent(ev) || ev.status === 'cancelled') continue;
        const flag = `photo_mission:${ev.id}`;
        const { data: done } = await supabase.from('app_config').select('key').eq('key', flag).maybeSingle();
        if (done) continue;
        const { data: regs } = await supabase.from('registrations').select('telegram_id').eq('event_id', ev.id).neq('status', 'cancelled');
        let n = 0;
        for (const r of realIds(regs || [])) {
          const ok = await send(Number(r.telegram_id),
            `📸 <b>Миссия дня — запечатлей моменты</b>\n\n` +
            `Сегодня «${escH(ev.title)}». Две просьбы от клуба:\n\n` +
            `1️⃣ <b>Общее фото</b> всей командой — найди организатора и соберите всех в кадр.\n` +
            `2️⃣ <b>Минимум 5 ярких кадров</b>: люди, эмоции, детали, атмосфера.\n\n` +
            `Присылай прямо сюда — всё уйдёт в историю клуба и в видео-итоги. За 5 кадров — <b>+20 баллов</b> ⭐`,
            { inline_keyboard: [[{ text: '📸 Отправить фото', callback_data: `media_${ev.id}` }]] });
          if (ok) n++;
        }
        await supabase.from('app_config').upsert({ key: flag, value: new Date().toISOString() }, { onConflict: 'key' });
        (report as any).photoMissions = ((report as any).photoMissions || 0) + n;
      }
    } catch (e) { report.errors.push(`photo-mission: ${(e as Error).message}`); }

    /**
     * «ТЫ ЕЩЁ НЕ В ЧАТЕ». Записался, но в группу события не вошёл — за неделю
     * до старта напоминаем кнопкой (раз в 2 дня, максимум 3 раза). Вход —
     * ссылка «с заявкой», бот одобряет записавшихся мгновенно.
     */
    try {
      const from = dayOffset(0), to = dayOffset(7);
      const { data: soon } = await supabase.from('events').select('id,title,date,telegram_bot_url,notifications').gte('date', from).lte('date', to);
      for (const ev of (soon || []) as any[]) {
        const link = String(ev.telegram_bot_url || '');
        if (isChallengeEvent(ev) || !/^https:\/\/t\.me\/(\+|joinchat\/)/.test(link)) continue;
        const { data: grp } = await supabase.from('event_groups').select('chat_id').eq('event_id', ev.id).eq('active', true).maybeSingle();
        if (!grp) continue;
        const key = `chat_nudge:${ev.id}`;
        const { data: st } = await supabase.from('app_config').select('value').eq('key', key).maybeSingle();
        const log: Record<string, { n: number; at: string }> = (() => { try { return JSON.parse((st as any)?.value || '{}'); } catch { return {}; } })();
        const { data: regs } = await supabase.from('registrations').select('telegram_id').eq('event_id', ev.id).neq('status', 'cancelled');
        let n = 0;
        for (const r of realIds(regs || [])) {
          const uid = String(r.telegram_id);
          const prev = log[uid];
          if (prev && (prev.n >= 3 || Date.parse(prev.at) > Date.now() - 2 * 864e5)) continue;
          const cm = await tg('getChatMember', { chat_id: (grp as any).chat_id, user_id: Number(uid) });
          const status = cm?.result?.status;
          if (status && !['left', 'kicked'].includes(status)) continue; // уже в чате
          const ok = await send(Number(uid),
            `💬 <b>Ты ещё не в чате «${escH(ev.title)}»</b>\n\nТам машины, точка сбора и всё оперативное. Нажми кнопку и «Вступить» — бот впустит сразу.`,
            { inline_keyboard: [[{ text: '💬 Войти в чат события', url: link }]] });
          if (ok) { n++; log[uid] = { n: (prev?.n || 0) + 1, at: new Date().toISOString() }; }
        }
        await supabase.from('app_config').upsert({ key, value: JSON.stringify(log) }, { onConflict: 'key' });
        (report as any).chatNudges = ((report as any).chatNudges || 0) + n;
      }
    } catch (e) { report.errors.push(`chat-nudge: ${(e as Error).message}`); }

    /**
     * ВОРОНКА ПРИГЛАШЕНИЙ — дожим.
     *   • «🤔 Подумаю» → через 2 суток напоминаем, максимум 2 раза;
     *   • молчит (дошло, но ни одной кнопки) → через 2 суток один раз.
     * Только будущие события: звать на прошедшее бессмысленно. Повтор не
     * чаще раза в сутки — reminded_at. Кнопки те же, что в приглашении.
     */
    try {
      const day = 864e5;
      const cutoff = new Date(Date.now() - 2 * day).toISOString();
      const { data: inv, error: invErr } = await supabase.from('event_invites')
        .select('event_id,telegram_id,answer,answered_at,sent_at,delivered,reminded_at,remind_count')
        .or('answer.eq.maybe,answer.is.null').lt('remind_count', 2).limit(500);
      if (!invErr && inv?.length) {
        const due = (inv as any[]).filter((r) => {
          if (r.reminded_at && Date.parse(r.reminded_at) > Date.now() - day) return false;
          if (r.answer === 'maybe') return (r.answered_at || '') < cutoff;
          return r.delivered && (Number(r.remind_count) || 0) < 1 && (r.sent_at || '') < cutoff;
        });
        const evIds = [...new Set(due.map((r) => String(r.event_id)))];
        const { data: evs } = evIds.length
          ? await supabase.from('events').select('id,title,date,date_label,location,status,logistics').in('id', evIds)
          : { data: [] as any[] };
        const today = dayOffset(0);
        const evMap = new Map<string, any>((evs || []).filter((e: any) => String(e.date || '') >= today && e.status !== 'closed').map((e: any) => [String(e.id), e]));
        let sentN = 0;
        for (const r of due) {
          const ev = evMap.get(String(r.event_id));
          if (!ev) continue;
          const lg = ev.logistics || {};
          const value = lg.costModel === 'club_invite'
            ? `\n💎 ${lg.marketPrice ? `Билет стоит ${escH(String(lg.marketPrice))} — ` : ''}для тебя бесплатно${Number(lg.clubSeats) > 0 ? `, но мест всего ${Math.round(Number(lg.clubSeats))}` : ''}.\n`
            : '';
          const text = r.answer === 'maybe'
            ? `🤔 <b>Ты хотел подумать про «${escH(ev.title)}»</b>\n\n${ev.date_label ? `📆 ${escH(ev.date_label)}\n` : ''}${value}\nРешил? Ответь одной кнопкой 👇`
            : `👋 <b>Напоминаю про «${escH(ev.title)}»</b>\n\n${ev.date_label ? `📆 ${escH(ev.date_label)}\n` : ''}${ev.location ? `📍 ${escH(ev.location)}\n` : ''}${value}\nТы ещё не ответил. Будешь? 👇`;
          const markup = { inline_keyboard: [
            [{ text: '✅ Буду', callback_data: `inv_y_${ev.id}` }, { text: '🤔 Подумаю', callback_data: `inv_m_${ev.id}` }],
            [{ text: '❌ Не смогу', callback_data: `inv_n_${ev.id}` }],
            [{ text: '👀 Подробнее о событии', callback_data: `inv_o_${ev.id}` }],
          ] };
          if (await send(Number(r.telegram_id), text, markup)) {
            sentN++;
            await supabase.from('event_invites').update({
              reminded_at: new Date().toISOString(), remind_count: (Number(r.remind_count) || 0) + 1,
            }).eq('event_id', r.event_id).eq('telegram_id', r.telegram_id);
          }
        }
        (report as any).inviteNudges = sentN;
      }
    } catch (e) { report.errors.push(`invite-funnel: ${(e as Error).message}`); }

    return res.status(200).json({ ok: true, ...report });
  } catch (err) {
    return res.status(500).json({ ok: false, ...report, error: (err as Error).message });
  }
}
