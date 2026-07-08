/**
 * Одноразовая настройка бота. Открыть в браузере:
 *   https://<домен>/api/telegram/setup?key=<TELEGRAM_WEBHOOK_SECRET>
 * Регистрирует вебхук на /api/telegram/webhook, включает кнопку меню Mini App.
 *
 * ENV: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET (он же ?key= и секрет вебхука).
 */

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';

export default async function handler(req: any, res: any) {
  if (!WEBHOOK_SECRET || (req.query.key || '') !== WEBHOOK_SECRET) {
    return res.status(401).json({ ok: false, error: 'Неверный ?key= (должен совпадать с TELEGRAM_WEBHOOK_SECRET, и он должен быть задан в env)' });
  }
  if (!BOT_TOKEN) return res.status(500).json({ ok: false, error: 'TELEGRAM_BOT_TOKEN не задан' });

  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const site = `https://${host}`;
  const webhookUrl = `${site}/api/telegram/webhook`;

  const api = (m: string, p: unknown) =>
    fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${m}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
    }).then((r) => r.json());

  const setWebhook = await api('setWebhook', {
    url: webhookUrl,
    secret_token: WEBHOOK_SECRET,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,
  });
  const menu = await api('setChatMenuButton', {
    menu_button: { type: 'web_app', text: 'Афиша', web_app: { url: site } },
  });
  const me = await api('getMe', {});

  res.status(200).json({ ok: true, webhookUrl, setWebhook, menu, bot: me.result });
}
