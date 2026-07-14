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

async function send(chatId: number, text: string, replyMarkup?: unknown): Promise<boolean> {
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

  const report = { eventReminders: 0, paymentReminders: 0, feedbackRequests: 0, menuBroadcasts: 0, errors: [] as string[] };

  try {
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
        .select('id,title,date,date_label,location,price_type,notifications,status')
        .eq('date', target)
        .eq('status', 'open');

      for (const ev of events || []) {
        const notif = (ev as any).notifications || {};
        if (notif[h.flag] === false) continue;

        const { data: regs } = await supabase
          .from('registrations')
          .select('telegram_id,payment_status')
          .eq('event_id', (ev as any).id)
          .neq('status', 'cancelled');

        for (const r of realIds(regs || [])) {
          const chatId = Number(r.telegram_id);
          const ok = await send(
            chatId,
            `⏰ <b>${esc((ev as any).title)}</b> — ${h.label}!\n` +
              ((ev as any).date_label ? `🗓 ${esc((ev as any).date_label)}\n` : '') +
              ((ev as any).location ? `📍 ${esc((ev as any).location)}\n` : '') +
              `\nДо встречи. Если планы поменялись — напиши сюда.`
          );
          if (ok) report.eventReminders++;

          // Оплата ещё не заявлена — отдельным сообщением с кнопкой.
          const unpaid = (ev as any).price_type === 'paid'
            && r.payment_status !== 'paid'
            && r.payment_status !== 'submitted';
          if (unpaid) {
            const sent = await send(
              chatId,
              `💳 Напоминание: участие в «<b>${esc((ev as any).title)}</b>» ещё не оплачено.`,
              { inline_keyboard: [[{ text: '💳 Оплатить участие', callback_data: `pay_${(ev as any).id}` }]] }
            );
            if (sent) report.paymentReminders++;
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
              const sent = await send(chatId, fullMsg);
              if (sent) report.menuBroadcasts++;
            }
          }
        }
      }
    }

    // ── 3. Вчерашние события: просим отзыв (один раз, по reminded_at) ─────
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

      for (const r of realIds(regs || [])) {
        const ok = await send(
          Number(r.telegram_id),
          `🙏 Спасибо, что был(а) на «<b>${esc((ev as any).title)}</b>».\n\n` +
            `Оцени событие — это помогает делать следующее лучше.`,
          { inline_keyboard: [[{ text: '⭐ Оставить отзыв', callback_data: `fb_${(ev as any).id}` }]] }
        );
        if (ok) {
          report.feedbackRequests++;
          await supabase.from('registrations').update({ reminded_at: new Date().toISOString() }).eq('id', r.id);
        }
      }
    }

    return res.status(200).json({ ok: true, ...report });
  } catch (err) {
    return res.status(200).json({ ok: false, ...report, error: (err as Error).message });
  }
}
