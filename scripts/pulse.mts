/**
 * ПУЛЬС КЛУБА — почасовой прогон (.github/workflows/pulse.yml):
 *   • «состоится при N» — api/_lib/quorum.ts;
 *   • дни рождения — api/_lib/birthday.ts (10:00 поздравление, 20:00 открытка).
 * Крон Vercel у нас раз в сутки, а этим задачам нужны часы.
 *
 * Руками: npx tsx scripts/pulse.mts [--dry-run] [--only quorum|birthday] [--event <id>]
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { stepQuorum, quorumOf } from '../api/_lib/quorum';
import { stepBirthdays } from '../api/_lib/birthday';

config({ path: '.env', quiet: true } as any);
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1] : '';
const EVENT = args.includes('--event') ? args[args.indexOf('--event') + 1] : '';
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const BOT = process.env.TELEGRAM_BOT_TOKEN || '';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Отправка в Telegram; заблокировал бота — помечаем, чтобы больше ему не писать. */
async function api(method: string, payload: any) {
  const form = method.endsWith(':form');
  const m = method.replace(':form', '');
  if (DRY) { console.log('[pulse] DRY', m, form ? '(файл)' : JSON.stringify(payload).slice(0, 180)); return { ok: true }; }
  const r: any = await fetch(`https://api.telegram.org/bot${BOT}/${m}`, form
    ? { method: 'POST', body: payload }
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ disable_web_page_preview: true, ...payload }) },
  ).then((x) => x.json()).catch(() => ({}));
  const chat = form ? Number(payload.get('chat_id')) : Number(payload?.chat_id);
  if (!r?.ok && /blocked|deactivated/i.test(String(r?.description || ''))) {
    await db.from('members').update({ bot_active: false }).eq('telegram_id', chat);
  }
  await sleep(45);
  return r;
}
const send = (chatId: number, text: string, markup?: any) =>
  api('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...(markup ? { reply_markup: markup } : {}) });

async function quorum() {
  const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
  const in8 = new Date(Date.now() + 3 * 3600_000 + 8 * 86400_000).toISOString().slice(0, 10);
  const cols = 'id,title,date,time,location,status,deputy_id,logistics,price_label,price_amount';
  const { data: events } = EVENT
    ? await db.from('events').select(cols).eq('id', EVENT)
    : await db.from('events').select(cols).gte('date', today).lte('date', in8);
  for (const ev of (events || []).filter(quorumOf)) {
    try { console.log('[quorum]', ev.id, await stepQuorum(db, send, ev)); } catch (e) { console.log('[quorum] error', ev.id, e); }
  }
}

async function main() {
  if (!BOT) { console.log('нет TELEGRAM_BOT_TOKEN'); return; }
  if (ONLY !== 'birthday') await quorum();
  if (ONLY !== 'quorum' && !EVENT) {
    try { console.log('[birthday]', await stepBirthdays(db, api, BOT)); } catch (e) { console.log('[birthday] error', e); }
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
