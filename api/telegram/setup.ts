/**
 * Одноразовая настройка бота. Открыть в браузере:
 *   https://<домен>/api/telegram/setup?key=<TELEGRAM_WEBHOOK_SECRET>
 * Регистрирует вебхук на /api/telegram/webhook, включает кнопку меню Mini App.
 *
 * ENV: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET (он же ?key= и секрет вебхука).
 */

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

export default async function handler(req: any, res: any) {
  // Разрешаем запуск по секрету вебхука ИЛИ по админ-паролю (что удобнее).
  // Пустой key не должен совпасть с незаданным env — иначе эндпоинт открыт всем.
  const key = (req.query.key as string) || '';
  const okAdmin = !!ADMIN_TOKEN && key === ADMIN_TOKEN;
  const okHook = !!WEBHOOK_SECRET && key === WEBHOOK_SECRET;
  if (!okAdmin && !okHook) {
    return res.status(401).json({ ok: false, error: 'Неверный ?key= (укажите ADMIN_TOKEN или TELEGRAM_WEBHOOK_SECRET)' });
  }
  if (!BOT_TOKEN) return res.status(500).json({ ok: false, error: 'TELEGRAM_BOT_TOKEN не задан в env' });

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
    ...(WEBHOOK_SECRET ? { secret_token: WEBHOOK_SECRET } : {}),
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,
  });
  const menu = await api('setChatMenuButton', {
    menu_button: { type: 'web_app', text: 'Афиша', web_app: { url: site } },
  });
  const me = await api('getMe', {});

  res.status(200).json({ ok: true, webhookUrl, setWebhook, menu, bot: me.result });
}
