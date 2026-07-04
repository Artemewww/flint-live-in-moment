import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Одноразовая авто-настройка бота @campsflint_bot под этот сайт.
 * Открой в браузере:  https://<домен>/api/telegram/setup?key=<TELEGRAM_WEBHOOK_SECRET>
 *
 * Делает за один вызов:
 *  1. setWebhook       → Telegram шлёт апдейты на /api/telegram/webhook;
 *  2. setChatMenuButton→ кнопка-меню бота открывает афишу как Mini App;
 *  3. setMyCommands    → команда /start.
 *
 * ENV: TELEGRAM_BOT_TOKEN (обязателен), TELEGRAM_WEBHOOK_SECRET (обязателен —
 * им же защищён вызов setup и подписан вебхук).
 */

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';

function siteUrl(req: VercelRequest): string {
  const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || '';
  return `https://${host}`;
}

async function tg(method: string, payload: unknown) {
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return r.json();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!BOT_TOKEN || !WEBHOOK_SECRET) {
    res.status(500).json({
      ok: false,
      error: 'Заданы не все переменные окружения: нужны TELEGRAM_BOT_TOKEN и TELEGRAM_WEBHOOK_SECRET.',
    });
    return;
  }
  if (req.query.key !== WEBHOOK_SECRET) {
    res.status(401).json({ ok: false, error: 'Неверный ключ (?key=…).' });
    return;
  }

  const site = siteUrl(req);
  const webhookUrl = `${site}/api/telegram/webhook`;

  const results: Record<string, unknown> = {};

  results.setWebhook = await tg('setWebhook', {
    url: webhookUrl,
    secret_token: WEBHOOK_SECRET,
    allowed_updates: ['message', 'edited_message'],
    drop_pending_updates: true,
  });

  results.setChatMenuButton = await tg('setChatMenuButton', {
    menu_button: {
      type: 'web_app',
      text: '🗓 Афиша',
      web_app: { url: site },
    },
  });

  results.setMyCommands = await tg('setMyCommands', {
    commands: [{ command: 'start', description: 'Открыть афишу событий' }],
  });

  const okAll = Object.values(results).every((r) => (r as { ok?: boolean }).ok);

  res.status(200).json({
    ok: okAll,
    site,
    webhookUrl,
    message: okAll
      ? '✅ Бот @campsflint_bot подключён к сайту: webhook + кнопка Mini App настроены.'
      : '⚠️ Часть шагов не прошла — см. подробности ниже.',
    results,
  });
}
