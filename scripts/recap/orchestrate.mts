/**
 * ОРКЕСТРАТОР ИТОГОВ СОБЫТИЯ — запускается GitHub Actions (.github/workflows/recap.yml)
 * по расписанию (раз в 2 часа) и по «пинку» из бота (кнопки организатора).
 *
 * Почему не Vercel: монтаж — это ffmpeg на минуты, а у функции Vercel 60 с и
 * нет ffmpeg; крон Vercel на бесплатном тарифе — раз в сутки. GitHub Actions
 * даёт всё это бесплатно.
 *
 * Жизненный цикл (состояние — app_config.recap:<eventId>):
 *   —        → collect   вечер последнего дня: в чат «скидывайте кадры»,
 *                        участникам — вопрос о согласии на кадры;
 *   collect  → review    следующий вечер: организатору сводка + «Смонтировать»;
 *   build    → preview   (кнопка) монтаж, ролик организатору на проверку;
 *   publish  → announced (кнопка) ролик в карточку события + рассылка клубу.
 * Кнопки обрабатывает api/telegram/webhook.ts (mc_*, rc_*, rr_*).
 *
 * Запуск руками:  npx tsx scripts/recap/orchestrate.mts [--event <id>] [--dry-run]
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  Consent, RecapState, lastDayOf, minskDate, recapSchedule, reelEligible, addDays,
} from '../../api/_lib/recap';

config({ path: '.env', quiet: true } as any);

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const ONLY = args.includes('--event') ? args[args.indexOf('--event') + 1] : (process.env.RECAP_EVENT_ID || '');
const FORCE = args.includes('--force'); // игнорировать расписание (для ручной проверки)

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const BOT = process.env.TELEGRAM_BOT_TOKEN || '';
const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || 'campsflint_bot';
const SITE = process.env.APP_URL || 'https://flint-live-in-moment.vercel.app';
const OWNER_ID = 377551019;
const ROOT = resolve(import.meta.dirname, '../..');
const MUSIC = ['leto-proshlo-gazuem', 'zhivi-v-momente', 'komanda-flint'];

const log = (...a: any[]) => console.log('[recap]', ...a);
const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function tg(method: string, payload: any): Promise<any> {
  if (DRY) { log('DRY', method, JSON.stringify(payload).slice(0, 220)); return { ok: true, result: {} }; }
  const r = await fetch(`https://api.telegram.org/bot${BOT}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) log('tg error', method, j.description);
  return j;
}

/** sendVideo файлом с диска (multipart): до 50 МБ у Bot API. */
async function tgVideoFile(chatId: number, path: string, caption: string, markup?: any): Promise<any> {
  if (DRY) { log('DRY sendVideo(file)', chatId, caption.slice(0, 80)); return { ok: true, result: { video: { file_id: 'DRY' } } }; }
  const fd = new FormData();
  fd.append('chat_id', String(chatId));
  fd.append('video', new Blob([readFileSync(path)], { type: 'video/mp4' }), 'recap.mp4');
  fd.append('caption', caption); fd.append('parse_mode', 'HTML');
  fd.append('supports_streaming', 'true'); fd.append('width', '1080'); fd.append('height', '1920');
  const thumb = path.replace(/\.mp4$/, '.jpg');
  if (existsSync(thumb)) fd.append('thumbnail', new Blob([readFileSync(thumb)], { type: 'image/jpeg' }), 'thumb.jpg');
  if (markup) fd.append('reply_markup', JSON.stringify(markup));
  const r = await fetch(`https://api.telegram.org/bot${BOT}/sendVideo`, { method: 'POST', body: fd });
  return r.json();
}

async function getState(evId: string): Promise<RecapState | null> {
  const { data } = await db.from('app_config').select('value').eq('key', `recap:${evId}`).maybeSingle();
  return (data as any)?.value || null;
}
async function setState(evId: string, st: RecapState) {
  st.updated_at = new Date().toISOString();
  if (DRY) { log('DRY state', evId, st.stage); return; }
  await db.from('app_config').upsert({ key: `recap:${evId}`, value: st }, { onConflict: 'key' });
}

function organizers(ev: any): number[] {
  return Array.from(new Set([Number(ev.deputy_id) || 0, OWNER_ID].filter(Boolean)));
}

async function participants(evId: string): Promise<number[]> {
  const { data } = await db.from('registrations').select('telegram_id,status').eq('event_id', evId)
    .in('status', ['pending', 'confirmed']);
  return Array.from(new Set((data || []).map((r: any) => Number(r.telegram_id)).filter((x) => x > 0)));
}

async function groupChats(evId: string): Promise<number[]> {
  const { data } = await db.from('event_groups').select('chat_id').eq('event_id', evId).eq('active', true);
  return (data || []).map((r: any) => Number(r.chat_id));
}

async function consents(evId: string, ids: number[]): Promise<Map<number, Consent>> {
  const out = new Map<number, Consent>();
  const { data: def } = await db.from('app_config').select('key,value').like('key', 'media_consent_default:%');
  for (const r of def || []) out.set(Number(String(r.key).split(':')[1]), (r as any).value?.choice);
  const { data } = await db.from('app_config').select('key,value').like('key', `media_consent:${evId}:%`);
  for (const r of data || []) out.set(Number(String(r.key).split(':').pop()), (r as any).value?.choice);
  return out;
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
function datesLabel(ev: any): string {
  const a = String(ev.date || ''), b = lastDayOf(ev);
  if (!a) return '';
  const [y, m1, d1] = a.split('-').map(Number);
  const [, m2, d2] = b.split('-').map(Number);
  if (a === b) return `${d1} ${MONTHS[m1 - 1]} ${y}`;
  return m1 === m2 ? `${d1}—${d2} ${MONTHS[m1 - 1]} ${y}` : `${d1} ${MONTHS[m1 - 1]} — ${d2} ${MONTHS[m2 - 1]} ${y}`;
}
const shortTitle = (ev: any) => String(ev.title || 'Событие').split(':')[0].trim();
const plural = (n: number, one: string, few: string, many: string) =>
  n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many;

// ── стадии ─────────────────────────────────────────────────────────────────

async function doCollect(ev: any) {
  const evId = ev.id;
  const title = shortTitle(ev);
  for (const chat of await groupChats(evId)) {
    await tg('sendMessage', {
      chat_id: chat, parse_mode: 'HTML',
      text: `🏁 <b>${esc(title)}</b> — финиш! Спасибо всем, это было мощно 🔥\n\n` +
        `📸 <b>Скидывайте сюда фото и видео</b> — до завтра 20:00. Я соберу всё в один ролик, и он придёт каждому.\n\n` +
        `<i>Можно пачкой, можно файлом без сжатия. Кружочки тоже идут в дело. Каждый принятый кадр отмечаю 🔥</i>`,
    });
  }
  const people = await participants(evId);
  const { data: defs } = await db.from('app_config').select('key').like('key', 'media_consent_default:%');
  const always = new Set((defs || []).map((r: any) => Number(String(r.key).split(':')[1])));
  for (const id of people) {
    // Уже ответил по этому событию или сказал «можно всегда» — не дёргаем.
    if (always.has(id) || await hasEventConsent(evId, id)) continue;
    await tg('sendMessage', {
      chat_id: id, parse_mode: 'HTML',
      text: `🎬 <b>${esc(title)}</b> позади — собираю общий ролик.\n\n` +
        `Скинь свои фото и видео в чат события (или прямо сюда). И один вопрос: <b>можно ли использовать кадры, где есть ты?</b>`,
      reply_markup: { inline_keyboard: [
        [{ text: '✅ Можно везде (и в соцсетях клуба)', callback_data: `mc_pub_${evId}` }],
        [{ text: '👥 Только внутри клуба', callback_data: `mc_club_${evId}` }],
        [{ text: '🙅 Без моих кадров', callback_data: `mc_no_${evId}` }],
        [{ text: '📸 Прислать фото/видео сюда', callback_data: `media_${evId}` }],
      ] },
    });
    await sleep(60);
  }
  const s = recapSchedule(lastDayOf(ev));
  await setState(evId, { stage: 'collect', collect_at: new Date().toISOString(), review_at: new Date(s.reviewAt).toISOString() });
  log('collect', evId, 'people', people.length);
}

async function hasEventConsent(evId: string, id: number) {
  const { data } = await db.from('app_config').select('key').eq('key', `media_consent:${evId}:${id}`).maybeSingle();
  return !!data;
}

async function eventMedia(evId: string) {
  const { data } = await db.from('event_media').select('id,telegram_id,file_id,media_type,created_at')
    .eq('event_id', evId).order('created_at');
  // Готовые ролики итогов в монтаж не берём — иначе ролик из ролика.
  return (data || []).filter((m: any) => !String(m.file_id).includes('/recaps/'));
}

async function doReview(ev: any) {
  const evId = ev.id;
  const media = await eventMedia(evId);
  const people = await participants(evId);
  const cons = await consents(evId, people);
  const photos = media.filter((m: any) => m.media_type !== 'video').length;
  const videos = media.length - photos;
  const authors = new Set(media.map((m: any) => Number(m.telegram_id))).size;
  const noIds = people.filter((id) => cons.get(id) === 'no');
  const clubIds = people.filter((id) => cons.get(id) === 'club');
  const { data: names } = await db.from('members').select('telegram_id,first_name,username').in('telegram_id', [...noIds, ...clubIds, 0]);
  const nm = (id: number) => { const m = (names || []).find((x: any) => Number(x.telegram_id) === id); return m?.username ? `@${m.username}` : (m?.first_name || String(id)); };
  const enough = media.length >= 4;
  const text = `🎬 <b>Итоги: ${esc(shortTitle(ev))}</b>\n\n` +
    `Собрано: <b>${photos}</b> фото и <b>${videos}</b> видео от <b>${authors}</b> ${plural(authors, 'человека', 'человек', 'человек')}.\n` +
    (noIds.length ? `🙅 Без своих кадров: ${esc(noIds.map(nm).join(', '))} — их файлы в ролик не попадут.\n` : '') +
    (clubIds.length ? `👥 Только внутри клуба: ${esc(clubIds.map(nm).join(', '))} — проверь перед постом в соцсети.\n` : '') +
    (enough
      ? `\nСмонтировать ролик? Бот сам выберет лучшие моменты и порежет под музыку — минут 5–10.`
      : `\nМатериала мало для ролика (нужно хотя бы 4 кадра). Подождём, пока досылают?`);
  const kb = enough
    ? [[{ text: '🎬 Смонтировать ролик', callback_data: `rc_build_${evId}` }],
       [{ text: '⏳ Подождать ещё сутки', callback_data: `rc_wait_${evId}` }, { text: '🚫 Без ролика', callback_data: `rc_skip_${evId}` }]]
    : [[{ text: '⏳ Подождать ещё сутки', callback_data: `rc_wait_${evId}` }, { text: '🚫 Без ролика', callback_data: `rc_skip_${evId}` }]];
  for (const id of organizers(ev)) await tg('sendMessage', { chat_id: id, parse_mode: 'HTML', text, reply_markup: { inline_keyboard: kb } });
  if (!enough) {
    for (const chat of await groupChats(evId)) {
      await tg('sendMessage', { chat_id: chat, parse_mode: 'HTML', text: `📸 Пока у меня ${media.length} ${plural(media.length, 'кадр', 'кадра', 'кадров')} с выезда — маловато для ролика. Скиньте, у кого что осталось 🙏` });
    }
  }
  await setState(evId, { ...(await getState(evId) || {}), stage: 'review' } as RecapState);
  log('review', evId, { photos, videos, authors });
}

async function download(fileId: string, dir: string, i: number, isVideo: boolean): Promise<string | null> {
  const ext = isVideo ? 'mp4' : 'jpg';
  const out = join(dir, `${String(i).padStart(3, '0')}.${ext}`);
  let url = fileId;
  if (!/^https:\/\//.test(fileId)) {
    const gf = await fetch(`https://api.telegram.org/bot${BOT}/getFile`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file_id: fileId }),
    }).then((r) => r.json()).catch(() => null);
    // Bot API отдаёт файлы до 20 МБ. Больше — пропускаем (организатор увидит в сводке).
    if (!gf?.ok || !gf.result?.file_path) return null;
    url = `https://api.telegram.org/file/bot${BOT}/${gf.result.file_path}`;
  }
  const r = await fetch(url);
  if (!r.ok) return null;
  writeFileSync(out, Buffer.from(await r.arrayBuffer()));
  return out;
}

async function doBuild(ev: any, st: RecapState) {
  const evId = ev.id;
  await setState(evId, { ...st, stage: 'building' });
  const people = await participants(evId);
  const cons = await consents(evId, people);
  const media = reelEligible(await eventMedia(evId), cons);
  const dir = mkdtempSync(join(tmpdir(), 'recap-'));
  const items: any[] = [];
  let skipped = 0;
  for (const [i, m] of media.entries()) {
    const p = DRY ? null : await download(String(m.file_id), dir, i, m.media_type === 'video');
    if (!p) { skipped += 1; continue; }
    items.push({ path: p, kind: m.media_type === 'video' ? 'video' : 'photo', author: Number(m.telegram_id) });
  }
  log('downloaded', items.length, 'skipped', skipped);
  const seed = Number(st.seed) || 0;
  const authors = new Set(items.map((x) => x.author)).size;
  const nights = Math.max(0, Math.round((Date.parse(lastDayOf(ev)) - Date.parse(ev.date)) / 86400000));
  const stats = [`${Math.max(people.length, authors)} ${plural(Math.max(people.length, authors), 'человек', 'человека', 'человек')}`,
    `${items.length} ${plural(items.length, 'кадр', 'кадра', 'кадров')}`,
    nights ? `${nights} ${plural(nights, 'ночь', 'ночи', 'ночей')}` : ''].filter(Boolean).join(' · ');
  const out = join(dir, `recap-v${seed}.mp4`);
  const manifest = {
    title: shortTitle(ev), kicker: 'FLINT · ИТОГИ ВЫЕЗДА', dates: datesLabel(ev),
    music: join(ROOT, 'public/assets/music', `${MUSIC[seed % MUSIC.length]}.mp3`),
    seed, stats_line: stats, items, out,
  };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
  if (DRY) { log('DRY montage', items.length, 'items'); return; }
  let meta: any;
  try {
    const so = execFileSync('python3', [join(ROOT, 'tools/recap/montage.py'), join(dir, 'manifest.json')],
      { stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1 << 24 });
    meta = JSON.parse(String(so).trim().split('\n').pop() || '{}');
  } catch (e: any) {
    const tooLittle = String(e?.stderr || e?.message || '').includes('too_little_media');
    await setState(evId, { ...st, stage: tooLittle ? 'review' : 'failed', error: String(e?.message || e).slice(0, 300) });
    for (const id of organizers(ev)) {
      await tg('sendMessage', {
        chat_id: id, parse_mode: 'HTML',
        text: tooLittle ? '📸 Для ролика не хватило годных кадров (тёмные/смазанные/дубли). Попросите в чате ещё фото и видео.'
          : `⚠️ Монтаж не удался: <code>${esc(String(e?.message || e).slice(0, 200))}</code>`,
        reply_markup: { inline_keyboard: [[{ text: '🔁 Попробовать снова', callback_data: `rc_build_${evId}` }]] },
      });
    }
    return;
  }
  // В Storage — чтобы карточка события могла стримить с CDN (Range, перемотка).
  const base = `recaps/${evId}/v${seed}-${Date.now()}`;
  await db.storage.from('event-images').upload(`${base}.mp4`, readFileSync(out), { contentType: 'video/mp4', upsert: true, cacheControl: '31536000' });
  await db.storage.from('event-images').upload(`${base}.jpg`, readFileSync(out.replace(/\.mp4$/, '.jpg')), { contentType: 'image/jpeg', upsert: true, cacheControl: '31536000' });
  const url = db.storage.from('event-images').getPublicUrl(`${base}.mp4`).data.publicUrl;
  const caption = `🎬 <b>${esc(shortTitle(ev))}</b> — черновик ролика (${Math.round(meta.duration)} с)\n` +
    `${meta.clips} видео + ${meta.photos} фото из ${meta.candidates} кандидатов${skipped ? ` · ${skipped} файлов >20 МБ пропущено` : ''}.\n\n` +
    `Публикуем? Ролик встанет в карточку события и уйдёт участникам и всему клубу.`;
  const markup = { inline_keyboard: [
    [{ text: '✅ Опубликовать', callback_data: `rc_pub_${evId}` }],
    [{ text: '🔁 Другая версия', callback_data: `rc_redo_${evId}` }, { text: '🚫 Не публиковать', callback_data: `rc_skip_${evId}` }],
  ] };
  let fileIdTg = '';
  for (const id of organizers(ev)) {
    const sent = fileIdTg
      ? await tg('sendVideo', { chat_id: id, video: fileIdTg, caption, parse_mode: 'HTML', reply_markup: markup })
      : await tgVideoFile(id, out, caption, markup);
    fileIdTg = fileIdTg || sent?.result?.video?.file_id || '';
  }
  await setState(evId, {
    ...st, stage: 'preview', error: undefined,
    preview: { url, poster: url.replace(/\.mp4$/, '.jpg'), tg_file_id: fileIdTg, duration: meta.duration, clips: meta.clips, photos: meta.photos },
  });
  log('preview', evId, url);
}

async function doPublish(ev: any, st: RecapState) {
  const evId = ev.id;
  const pv = st.preview!;
  if (!DRY) {
    // created_at = старт события: при равных голосах ролик стоит первым в ленте.
    await db.from('event_media').insert({
      event_id: evId, telegram_id: OWNER_ID, file_id: pv.url,
      file_unique_id: `storage:${pv.url.split('/event-images/')[1]}`, media_type: 'video', votes: 0, is_keeper: true,
      created_at: `${ev.date}T00:00:00+00:00`,
    });
  }
  const title = shortTitle(ev);
  const media = await eventMedia(evId);
  const people = await participants(evId);
  const video = pv.tg_file_id || pv.url;
  const appBtn = { text: '📸 Все кадры события', web_app: { url: `${SITE}/?ev=${encodeURIComponent(evId)}` } };

  // 1) Участникам — их собственный ролик + «который это выезд» + оценка.
  for (const id of people) {
    const { count } = await db.from('registrations').select('id', { count: 'exact', head: true })
      .eq('telegram_id', id).eq('status', 'confirmed');
    const n = Number(count || 0);
    await tg('sendVideo', {
      chat_id: id, video, parse_mode: 'HTML', supports_streaming: true,
      caption: `🔥 <b>${esc(title)}</b> — это было!\n\n${Math.round(pv.duration || 0)} секунд ваших эмоций: ${media.length} кадров от участников.` +
        (n > 1 ? `\n\nЭто твой <b>${n}-й</b> выезд с FLINT 💪` : `\n\nТвой первый выезд с FLINT — добро пожаловать в стаю 💪`) +
        `\n\nКак тебе выезд?`,
      reply_markup: { inline_keyboard: [
        [{ text: '🔥 Огонь', callback_data: `rr_fire_${evId}` }, { text: '👍 Хорошо', callback_data: `rr_ok_${evId}` }, { text: '🤔 Есть что улучшить', callback_data: `rr_meh_${evId}` }],
        [appBtn],
      ] },
    });
    await sleep(60);
  }

  // 2) Клубу — «пока тебя не было» + следующий выезд (FOMO работает лучше рассылки афиш).
  const today = minskDate();
  const { data: next } = await db.from('events').select('id,title,date').gt('date', today)
    .or('status.is.null,status.neq.draft').eq('is_public', true).order('date').limit(1).maybeSingle();
  const { data: members } = await db.from('members').select('telegram_id,bot_active').eq('status', 'approved');
  const others = (members || []).map((m: any) => Number(m.telegram_id))
    .filter((id) => id > 0 && !people.includes(id) && (members || []).find((m: any) => Number(m.telegram_id) === id)?.bot_active !== false);
  for (const id of others) {
    await tg('sendVideo', {
      chat_id: id, video, parse_mode: 'HTML', supports_streaming: true,
      caption: `🎬 <b>${esc(title)}</b> — как это было.\n\n${people.length} ${plural(people.length, 'человек', 'человека', 'человек')} из клуба, ${datesLabel(ev)}.` +
        (next ? `\n\nСледующий выезд — <b>${esc(shortTitle(next))}</b>, ${esc(datesLabel(next))}. Поедешь с нами?` : ''),
      reply_markup: { inline_keyboard: next
        ? [[{ text: '📝 Хочу на следующий', web_app: { url: `${SITE}/?ev=${encodeURIComponent((next as any).id)}` } }]]
        : [[appBtn]] },
    });
    await sleep(60);
  }

  // 3) В чат события — благодарность авторам кадров.
  const authorIds = Array.from(new Set(media.map((m: any) => Number(m.telegram_id)).filter((x) => x > 0 && x !== OWNER_ID)));
  const { data: an } = await db.from('members').select('telegram_id,first_name,username').in('telegram_id', [...authorIds, 0]);
  const thanks = (an || []).map((m: any) => (m.username ? `@${m.username}` : m.first_name)).filter(Boolean).join(', ');
  for (const chat of await groupChats(evId)) {
    await tg('sendVideo', {
      chat_id: chat, video, parse_mode: 'HTML', supports_streaming: true,
      caption: `🎬 <b>Ролик готов!</b> ${esc(title)}\n\n${thanks ? `Спасибо за кадры: ${esc(thanks)} 🙌\n\n` : ''}Он уже в карточке события в приложении.`,
    });
  }
  await setState(evId, { ...st, stage: 'announced' });
  log('announced', evId, 'participants', people.length, 'members', others.length);
}

// ── главный цикл ───────────────────────────────────────────────────────────

async function main() {
  const today = minskDate();
  let q = db.from('events').select('id,title,date,date_end,deputy_id,notifications,status,checklist')
    .gte('date', addDays(today, -21)).lte('date', today);
  if (ONLY) q = db.from('events').select('id,title,date,date_end,deputy_id,notifications,status,checklist').eq('id', ONLY);
  const { data: events } = await q;
  const now = Date.now();
  for (const ev of events || []) {
    const n: any = (ev as any).notifications || {};
    if (n._format === 'challenge' || n.is_challenge === true || (ev as any).status === 'draft') continue;
    const last = lastDayOf(ev as any);
    if (last < addDays(today, -14) && !ONLY) continue; // старое — не трогаем
    const st = await getState((ev as any).id);
    const sched = recapSchedule(last);
    try {
      if (!st) {
        // «Завершить» в админке — сигнал, что всё: собираем кадры сразу, не ждём 18:00.
        if (now >= sched.collectAt || FORCE || (ev as any).checklist?.finished === true) await doCollect(ev);
      } else if (st.stage === 'collect') {
        if (now >= Date.parse(st.review_at || '') || FORCE) await doReview(ev);
      } else if (st.stage === 'build') {
        await doBuild(ev, st);
      } else if (st.stage === 'publish' && st.preview?.url) {
        await doPublish(ev, st);
      } else if (st.stage === 'building' && now - Date.parse(st.updated_at || '') > 60 * 60 * 1000) {
        await setState((ev as any).id, { ...st, stage: 'build' }); // упавший прогон — повторим
      }
    } catch (e) {
      log('error', (ev as any).id, e);
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
