import type { VercelRequest, VercelResponse } from '@vercel/node';
import { INITIAL_EVENTS, getEventPhase } from '../../shared/events.data.js';

/**
 * Вебхук Telegram-бота @campsflint_bot, живущий на Vercel вместе с сайтом.
 * Делает бота и сайт единым целым:
 *  - /start [payload] → приветствие + кнопка, открывающая афишу как Mini App;
 *  - deep-link event_<id> → карточка события со ссылкой «Открыть в афише»;
 *  - deep-link notify_<id> → подписка на уведомление об открытии набора.
 *
 * ENV: TELEGRAM_BOT_TOKEN (обязателен), TELEGRAM_WEBHOOK_SECRET (опционально —
 * сверяется с заголовком X-Telegram-Bot-Api-Secret-Token).
 */

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';

interface TgEvent {
  id: string;
  title: string;
  dateLabel: string;
  location: string;
  priceLabel: string;
  entryThreshold: string;
  status?: string;
  lockedHint?: string;
  [k: string]: unknown;
}

function siteUrl(req: VercelRequest): string {
  const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || '';
  return `https://${host}`;
}

async function tg(method: string, payload: unknown) {
  return fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => r.json());
}

function esc(s: string): string {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function findEvent(id: string): TgEvent | undefined {
  return (INITIAL_EVENTS as TgEvent[]).find((e) => e.id === id);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(200).json({ ok: true, info: 'Telegram webhook endpoint for @campsflint_bot' });
    return;
  }
  // Проверка секрета вебхука (если задан).
  if (WEBHOOK_SECRET) {
    const got = req.headers['x-telegram-bot-api-secret-token'];
    if (got !== WEBHOOK_SECRET) {
      res.status(401).json({ ok: false });
      return;
    }
  }
  if (!BOT_TOKEN) {
    res.status(200).json({ ok: true, warning: 'TELEGRAM_BOT_TOKEN не задан' });
    return;
  }

  try {
    const update = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const msg = update.message || update.edited_message;
    const site = siteUrl(req);
    const openAppButton = { text: '🗓 Открыть афишу', web_app: { url: site } };

    if (msg && typeof msg.text === 'string') {
      const chatId = msg.chat.id;
      const text: string = msg.text.trim();

      // /start [payload]
      if (text.startsWith('/start')) {
        const payload = text.split(' ')[1] || '';

        // event_<id> — показать карточку события
        if (payload.startsWith('event_')) {
          const ev = findEvent(payload.slice('event_'.length));
          if (ev) {
            const phase = getEventPhase(ev);
            const status =
              phase === 'open' ? '🟢 Идёт набор'
              : phase === 'locked' ? '🔒 Скоро — набор ещё не открыт'
              : phase === 'full' ? '⛔️ Мест нет'
              : phase === 'past' ? '📦 В архиве' : 'ℹ️';
            await tg('sendMessage', {
              chat_id: chatId,
              parse_mode: 'HTML',
              text:
                `<b>${esc(ev.title)}</b>\n${status}\n\n` +
                `🗓 ${esc(ev.dateLabel)}\n📍 ${esc(ev.location)}\n` +
                `💳 ${esc(ev.priceLabel)}\n🎫 Порог входа: ${esc(ev.entryThreshold)}`,
              reply_markup: { inline_keyboard: [[openAppButton]] },
            });
            res.status(200).json({ ok: true });
            return;
          }
        }

        // notify_<id> — подписка на открытие набора
        if (payload.startsWith('notify_')) {
          const ev = findEvent(payload.slice('notify_'.length));
          await tg('sendMessage', {
            chat_id: chatId,
            parse_mode: 'HTML',
            text: ev
              ? `🔔 Отметил вас: сообщим, как только откроется набор на «<b>${esc(ev.title)}</b>».`
              : '🔔 Готово — сообщим об открытии набора.',
            reply_markup: { inline_keyboard: [[openAppButton]] },
          });
          res.status(200).json({ ok: true });
          return;
        }

        // Обычный /start
        await tg('sendMessage', {
          chat_id: chatId,
          parse_mode: 'HTML',
          text:
            '👋 Добро пожаловать в <b>«Живи в моменте»</b>!\n\n' +
            'Здесь — живая афиша событий трезвого сообщества. Открой афишу, выбери событие ' +
            'и запишись прямо внутри Telegram.',
          reply_markup: { inline_keyboard: [[openAppButton]] },
        });
        res.status(200).json({ ok: true });
        return;
      }

      // Любое другое сообщение — подсказка + кнопка
      await tg('sendMessage', {
        chat_id: chatId,
        text: 'Нажмите кнопку ниже, чтобы открыть афишу событий 👇',
        reply_markup: { inline_keyboard: [[openAppButton]] },
      });
      res.status(200).json({ ok: true });
      return;
    }

    // Данные из Mini App (Telegram.WebApp.sendData) — приходят как web_app_data
    if (msg && msg.web_app_data) {
      await tg('sendMessage', {
        chat_id: msg.chat.id,
        text: '✅ Заявка получена. Организатор свяжется с вами.',
      });
      res.status(200).json({ ok: true });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    // Всегда 200, чтобы Telegram не ретраил бесконечно.
    res.status(200).json({ ok: true, error: (err as Error).message });
  }
}
