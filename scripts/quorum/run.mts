/**
 * ПОЧАСОВОЙ АВТОМАТ «СОСТОИТСЯ ПРИ N» — .github/workflows/quorum.yml.
 * Логика — api/_lib/quorum.ts (stepQuorum). Крон Vercel у нас раз в сутки,
 * а дедлайн бани — «за 4 часа до старта», поэтому здесь, а не на Vercel.
 *
 * Руками: npx tsx scripts/quorum/run.mts [--dry-run] [--event <id>]
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { stepQuorum, quorumOf } from '../../api/_lib/quorum';

config({ path: '.env', quiet: true } as any);
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const ONLY = args.includes('--event') ? args[args.indexOf('--event') + 1] : '';
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const BOT = process.env.TELEGRAM_BOT_TOKEN || '';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function send(chatId: number, text: string, markup?: any) {
  if (DRY) { console.log('[quorum] DRY →', chatId, text.replace(/\n/g, ' ').slice(0, 140)); return; }
  const r = await fetch(`https://api.telegram.org/bot${BOT}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...(markup ? { reply_markup: markup } : {}) }),
  }).then((x) => x.json()).catch(() => ({}));
  // Заблокировал бота — помечаем, чтобы дальше ему не писать вообще.
  if (!r?.ok && /blocked|deactivated|403/i.test(String(r?.description || r?.error_code))) {
    await db.from('members').update({ bot_active: false }).eq('telegram_id', chatId);
  }
  await sleep(45);
}

async function main() {
  const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
  const in8 = new Date(Date.now() + 3 * 3600_000 + 8 * 86400_000).toISOString().slice(0, 10);
  let q = db.from('events').select('id,title,date,time,location,status,deputy_id,logistics,price_label,price_amount').gte('date', today).lte('date', in8);
  if (ONLY) q = db.from('events').select('id,title,date,time,location,status,deputy_id,logistics,price_label,price_amount').eq('id', ONLY);
  const { data: events } = await q;
  for (const ev of (events || []).filter(quorumOf)) {
    try { console.log('[quorum]', ev.id, await stepQuorum(db, send, ev)); }
    catch (e) { console.log('[quorum] error', ev.id, e); }
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
