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

  const report = { eventReminders: 0, paymentReminders: 0, feedbackRequests: 0, menuBroadcasts: 0, pollsClosed: 0, autoRemindersSent: 0, errors: [] as string[] };

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

    for (const r of autoReminders || []) {
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

    // ── 3. Вчерашние события: просим отзыв + оценки блюд (один раз, по reminded_at) ─────
    const yesterday = dayOffset(-1);
    const { data: pastEvents } = await supabase
      .from('events')
      .select('id,title')
      .or(`date_end.eq.${yesterday},and(date.eq.${yesterday},date_end.is.null)`);

    for (const ev of pastEvents || []) {
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
              [{ text: '📸 Прислать фото/видео', callback_data: `media_${(ev as any).id}` }],
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
          // Баллы за участие — той же величины, что начисляет админка.
          try {
            const { data: m } = await supabase.from('members').select('points').eq('telegram_id', r.telegram_id).maybeSingle();
            await supabase.from('members').update({ points: ((m as any)?.points || 0) + 100 }).eq('telegram_id', r.telegram_id);
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

    // Чистка галерей: через 7 дней после события остаётся топ-5 по голосам
    // (is_keeper), остальные строки удаляются. Сами файлы живут в Telegram
    // у отправителей — «удаление» значит только уход из галереи.
    try {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const { data: oldEvents } = await supabase
        .from('events').select('id').lt('date', weekAgo).limit(50);
      for (const ev of oldEvents || []) {
        const { data: media } = await supabase
          .from('event_media').select('id,is_keeper')
          .eq('event_id', (ev as any).id)
          .order('votes', { ascending: false }).order('created_at', { ascending: true });
        if (!media || !media.length) continue;
        if (media.every((m: any) => m.is_keeper)) continue;
        const keep = media.slice(0, 5).map((m: any) => m.id);
        const drop = media.slice(5).map((m: any) => m.id);
        await supabase.from('event_media').update({ is_keeper: true }).in('id', keep);
        if (drop.length) await supabase.from('event_media').delete().in('id', drop);
        (report as any).galleriesCleaned = ((report as any).galleriesCleaned || 0) + 1;
      }
    } catch { /* чистка не должна ронять напоминания */ }

    return res.status(200).json({ ok: true, ...report });
  } catch (err) {
    return res.status(500).json({ ok: false, ...report, error: (err as Error).message });
  }
}
