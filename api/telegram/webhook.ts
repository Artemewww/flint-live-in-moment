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

function eventCard(ev: any): string {
  const aud = ev.entry_type === 'male' ? '👨 Только мужчины'
    : ev.entry_type === 'female' ? '👩 Только женщины' : '👥 Все';
  return (
    `<b>${esc(ev.title)}</b>\n\n` +
    (ev.date_label ? `🗓 ${esc(ev.date_label)}\n` : '') +
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
function kb(rows: any[]) { return { inline_keyboard: rows }; }
function foodNeeded(ev: any) { return ['active', 'male', 'mixed'].includes(ev?.type); }

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

    // Кнопки: запись + пошаговый умный опрос под событие.
    if (update.callback_query) {
      const cq = update.callback_query;
      const data = cq.data || '';
      const chatId = cq.message?.chat?.id;
      const msgId = cq.message?.message_id;
      const tgId = cq.from.id;

      const finalConfirm = async (title: string) => {
        await tg('editMessageText', {
          chat_id: chatId, message_id: msgId, parse_mode: 'HTML',
          text: `✅ Готово! Ты записан(а) на «<b>${esc(title)}</b>».\n\nДальше всё автоматически: детали, точная локация и напоминания придут сюда. Вопросы по событию — прямо в этот чат.`,
          reply_markup: kb([[openBtn]]),
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
          ]),
        });
      };

      // Старт записи с карточки события.
      if (data.startsWith('reg_')) {
        const ev = await getEvent(data.slice(4));
        if (!ev) {
          await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Событие не найдено' });
          return res.status(200).json({ ok: true });
        }
        const r = await registerFromBot(cq.from, ev);
        await tg('answerCallbackQuery', {
          callback_query_id: cq.id,
          text: r === 'already' ? 'Ты уже записан — уточним детали' : r === 'ok' ? 'Готово! Пара уточнений' : 'Ошибка, попробуйте позже',
        });
        if (r === 'error') return res.status(200).json({ ok: true });
        // Городские/интеллектуальные — без лишних вопросов.
        if (ev.type === 'intellectual') {
          await tg('sendMessage', {
            chat_id: chatId, parse_mode: 'HTML',
            text: `✅ Ты записан(а) на «<b>${esc(ev.title)}</b>»!\n\nДетали и напоминания придут в бот. Вопросы — прямо сюда.`,
            reply_markup: kb([[openBtn]]),
          });
          return res.status(200).json({ ok: true });
        }
        // Иначе — умный опрос под событие: транспорт → (места) → питание.
        await tg('sendMessage', {
          chat_id: chatId, parse_mode: 'HTML',
          text: `✅ Записал тебя на «<b>${esc(ev.title)}</b>». Пара быстрых уточнений 👇\n\n🚗 Как добираешься?`,
          reply_markup: kb([
            [{ text: '🚗 На авто — могу подвезти', callback_data: `rt:${ev.id}:car` }],
            [{ text: '🚗 Авто есть, но мест нет', callback_data: `rt:${ev.id}:carfull` }],
            [{ text: '🚶 Нужна попутка', callback_data: `rt:${ev.id}:seek` }],
            [{ text: 'Доберусь сам', callback_data: `rt:${ev.id}:self` }],
          ]),
        });
        return res.status(200).json({ ok: true });
      }

      // Шаги опроса (stateless: событие и ответ закодированы в callback_data).
      if (data.startsWith('rt:') || data.startsWith('rs:') || data.startsWith('rf:')) {
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
            if (foodNeeded(ev)) await askFood(evId); else await finalConfirm(title);
          } else {
            await updateReg(evId, tgId, { has_transport: false, transport_details: val === 'seek' ? 'Ищет попутку' : null });
            if (foodNeeded(ev)) await askFood(evId); else await finalConfirm(title);
          }
          return res.status(200).json({ ok: true });
        }
        if (action === 'rs') {
          await updateReg(evId, tgId, { has_transport: true, transport_seats: Number(val) });
          if (foodNeeded(ev)) await askFood(evId); else await finalConfirm(title);
          return res.status(200).json({ ok: true });
        }
        if (action === 'rf') {
          const diet = val === 'veg' ? 'vegetarian' : val === 'vegan' ? 'vegan' : 'all';
          await supabase.from('members').update({ dietary: diet }).eq('telegram_id', tgId);
          await updateReg(evId, tgId, { dietary: diet });
          await finalConfirm(title);
          return res.status(200).json({ ok: true });
        }
      }

      await tg('answerCallbackQuery', { callback_query_id: cq.id });
      return res.status(200).json({ ok: true });
    }

    const msg = update.message || update.edited_message;
    if (msg && typeof msg.text === 'string') {
      const chatId = msg.chat.id;
      const text = msg.text.trim();

      if (text.startsWith('/start')) {
        const payload = text.split(' ')[1] || '';
        if (payload.startsWith('event_')) {
          const ev = await getEvent(payload.slice('event_'.length));
          if (ev) {
            await tg('sendMessage', {
              chat_id: chatId,
              parse_mode: 'HTML',
              text: eventCard(ev),
              reply_markup: {
                inline_keyboard: [[{ text: '✅ Записаться', callback_data: `reg_${ev.id}` }], [openBtn]],
              },
            });
            return res.status(200).json({ ok: true });
          }
        }
        // Приветствие + открытые события кнопками.
        const { data: evs } = await supabase
          .from('events')
          .select('id,title,status')
          .eq('status', 'open')
          .order('date', { ascending: true })
          .limit(6);
        const rows = (evs || []).map((e: any) => [{ text: `✅ ${e.title}`, callback_data: `reg_${e.id}` }]);
        rows.push([openBtn as any]);
        await tg('sendMessage', {
          chat_id: chatId,
          parse_mode: 'HTML',
          text:
            '👋 Добро пожаловать в <b>«Живи в моменте»</b>!\n\n' +
            'Живая афиша трезвого сообщества. Открой афишу или запишись на ближайшее событие 👇',
          reply_markup: { inline_keyboard: rows },
        });
        return res.status(200).json({ ok: true });
      }

      await tg('sendMessage', {
        chat_id: chatId,
        text: 'Нажми кнопку ниже, чтобы открыть афишу 👇',
        reply_markup: { inline_keyboard: [[openBtn]] },
      });
      return res.status(200).json({ ok: true });
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(200).json({ ok: true, error: (err as Error).message });
  }
}
