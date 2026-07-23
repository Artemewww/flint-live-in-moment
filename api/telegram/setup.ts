/**
 * Одноразовая настройка бота. Открыть в браузере:
 *   https://<домен>/api/telegram/setup?key=<ADMIN_TOKEN или TELEGRAM_WEBHOOK_SECRET>
 * Регистрирует вебхук на /api/telegram/webhook (С СЕКРЕТОМ) + кнопку Mini App.
 *
 * ⚠️ Секрет вебхука должен совпадать с тем, что проверяет webhook.ts (fail-closed):
 * берём его из env TELEGRAM_WEBHOOK_SECRET, а если не задан — из БД
 * (bot_sessions, строка telegram_id=0, state='webhook_secret'). Иначе повторный
 * запуск setup снял бы секрет и бот начал бы отвергать ВСЕ апдейты (401).
 *
 * ENV: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET (опц.), SUPABASE_URL/KEY.
 */

import { createClient } from '@supabase/supabase-js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const supabase = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');

/** Тот же источник секрета, что и в webhook.ts: env, иначе строка в БД. */
async function resolveSecret(): Promise<string> {
  if (WEBHOOK_SECRET) return WEBHOOK_SECRET;
  try {
    const { data } = await supabase.from('bot_sessions').select('context').eq('telegram_id', 0).eq('state', 'webhook_secret').maybeSingle();
    return ((data as any)?.context?.value) || '';
  } catch { return ''; }
}

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
  const secret = await resolveSecret();

  const api = (m: string, p: unknown) =>
    fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${m}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
    }).then((r) => r.json());

  const setWebhook = await api('setWebhook', {
    url: webhookUrl,
    ...(secret ? { secret_token: secret } : {}),
    allowed_updates: ['message', 'callback_query'],
    // НЕ дропаем ожидающие апдейты на случайном повторном запуске.
    drop_pending_updates: false,
  });
  const menu = await api('setChatMenuButton', {
    menu_button: { type: 'web_app', text: 'Афиша', web_app: { url: site } },
  });
  const me = await api('getMe', {});

  res.status(200).json({ ok: true, webhookUrl, secretRegistered: !!secret, setWebhook, menu, bot: me.result });
}
