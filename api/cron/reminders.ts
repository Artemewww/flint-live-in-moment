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
        .select('id,title,date,date_label,location,price_type,notifications,status,logistics,shopping')
        .eq('date', target)
        .eq('status', 'open');

      for (const ev of events || []) {
        const notif = (ev as any).notifications || {};
        if (notif[h.flag] === false) continue;

        const { data: regs } = await supabase
          .from('registrations')
          .select('telegram_id,payment_status,dietary,equipment,roles,has_transport,guest_count')
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
              { inline_keyboard: buttons }
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
              await send(id, `🛒 Закупка на «<b>${esc((ev as any).title)}</b>» утверждена командой (${approved.length}/${all.length} за). Спасибо!`);
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
                ] }
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
            ]] }
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
              ] }
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
              { inline_keyboard: [[{ text: '💳 Оплатить участие', callback_data: `pay_${(ev as any).id}` }]] }
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
                { inline_keyboard: [[{ text: '👀 Занять место в машине', callback_data: `rides_${(ev as any).id}` }]] }
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
                // Памятка (правила места, безопасность) — если организатор её заполнил.
                ...((ev as any).logistics?.prep ? [[{ text: '🎒 Как готовиться', callback_data: `prep_${(ev as any).id}` }]] : []),
              ] }
            );
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
          route ? { inline_keyboard: [[{ text: '🧭 Маршрут в Яндексе', url: route }]] } : undefined
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
          }
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
          const rateOk = await send(chatId, rateMsg, { inline_keyboard: dishButtons });
          if (rateOk) report.feedbackRequests++;
        }

        // Помечаем, что отправили напоминание
        await supabase.from('registrations').update({ reminded_at: new Date().toISOString() }).eq('id', r.id);
      }
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
              });
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
    return res.status(200).json({ ok: false, ...report, error: (err as Error).message });
  }
}
