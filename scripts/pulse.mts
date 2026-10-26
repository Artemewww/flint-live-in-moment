/**
 * ПУЛЬС КЛУБА — почасовой прогон (.github/workflows/pulse.yml):
 *   • «состоится при N» — api/_lib/quorum.ts;
 *   • дни рождения — api/_lib/birthday.ts (10:00 поздравление, 20:00 открытка);
 *   • взаимопомощь — вечерний дайджест новых просьб (после 19:00, раз в сутки).
 * Крон Vercel у нас раз в сутки, а этим задачам нужны часы.
 *
 * Руками: npx tsx scripts/pulse.mts [--dry-run] [--only quorum|birthday|help] [--event <id>]
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
const real = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
/**
 * В --dry-run состояние (app_config) не пишем: иначе «посмотреть, кому уйдёт»
 * помечало именинника поздравленным, и настоящий прогон уже ничего не слал.
 */
const db: any = DRY
  ? new Proxy(real, { get: (t: any, k) => k === 'from'
      ? (tbl: string) => { const q = t.from(tbl); return tbl === 'app_config' || tbl === 'members' ? Object.assign(Object.create(q), { upsert: async () => ({}), update: () => ({ eq: async () => ({}) }) }) : q; }
      : t[k] })
  : real;
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

const escH = (v: string) => String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Взаимопомощь: новые просьбы клуба одним сообщением вечером. Мгновенных
 * рассылок нет (бота не блокируют), отписка — кнопкой «Не присылать».
 */
async function helpDigest() {
  const minsk = new Date(Date.now() + 3 * 3600_000);
  const day = minsk.toISOString().slice(0, 10);
  if (minsk.getUTCHours() < 19) return 'рано';
  const { data: mark } = await db.from('app_config').select('value').eq('key', 'help_digest_day').maybeSingle();
  if (mark?.value === day) return 'уже было сегодня';
  const { data: rows } = await db.from('app_config').select('key,value').like('key', 'help:%');
  const fresh = (rows || []).map((r: any) => { try { return JSON.parse(r.value); } catch { return null; } })
    .filter((h: any) => h && h.status === 'open' && !h.digested && h.expiresAt > Date.now());
  await db.from('app_config').upsert({ key: 'help_digest_day', value: day }, { onConflict: 'key' });
  if (!fresh.length) return 'новых нет';
  const SITE = (process.env.SITE_URL || 'https://flint-live-in-moment.vercel.app').replace(/\/$/, '');
  const lines = fresh.slice(0, 6).map((h: any) => `• <b>${escH(h.authorName)}</b>: ${escH(String(h.text).slice(0, 120))}`).join('\n');
  const authors = new Set(fresh.map((h: any) => String(h.authorId)));
  const { data: mem } = await db.from('members').select('telegram_id,prefs,bot_active').eq('status', 'approved');
  let sent = 0;
  for (const m of mem || []) {
    const id = Number(m.telegram_id);
    if (!(id > 0) || m.bot_active === false || authors.has(String(id)) || m.prefs?.help_digest === false) continue;
    const r: any = await send(id, `🤝 <b>Клубу нужна помощь</b>\n\n${lines}\n\nМожешь помочь — нажми «Могу помочь» в приложении, автор получит твой контакт.`,
      { inline_keyboard: [[{ text: 'Открыть взаимопомощь', web_app: { url: `${SITE}/?help=1` } }], [{ text: 'Не присылать такое', callback_data: 'helpoff' }]] });
    if (r?.ok) sent++;
  }
  for (const h of fresh) await db.from('app_config').update({ value: JSON.stringify({ ...h, digested: true }) }).eq('key', `help:${h.id}`);
  return `просьб ${fresh.length}, отправлено ${sent}`;
}

async function main() {
  if (!BOT) { console.log('нет TELEGRAM_BOT_TOKEN'); return; }
  if (!ONLY || ONLY === 'quorum') await quorum();
  if ((!ONLY || ONLY === 'birthday') && !EVENT) {
    try { console.log('[birthday]', await stepBirthdays(db, api, BOT)); } catch (e) { console.log('[birthday] error', e); }
  }
  if ((!ONLY || ONLY === 'help') && !EVENT) {
    try { console.log('[help]', await helpDigest()); } catch (e) { console.log('[help] error', e); }
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
