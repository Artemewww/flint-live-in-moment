/**
 * ДНИ РОЖДЕНИЯ — поздравление от FLINT и «открытка от клуба».
 *
 * Цель — не «ещё одна рассылка», а повод почувствовать, что ты здесь свой,
 * и захотеть увидеться вживую. Поэтому:
 *   10:00  имениннику — именной баннер (имя, как он себя назвал в клубе,
 *          аватарка) и тёплое пожелание, которое ИИ пишет под человека:
 *          сколько он с клубом, на скольких событиях был;
 *          тем, с кем он был на событиях за полгода, — одно сообщение
 *          «вы вместе были на …, поздравишь?» с кнопкой. Всему клубу НЕ пишем:
 *          чужой день рождения от бота — это спам, а «вы вместе были на бане» —
 *          нет. Если таких меньше трёх — добавляем костяк клуба;
 *   20:00  имениннику — «открытка от клуба»: все поздравления одним сообщением
 *          и приглашение отметить на ближайшей встрече.
 * Поздравления пишутся кнопками бота (bdw_ / bdp_ — api/telegram/webhook.ts),
 * копятся в app_config `bdwish:<tid>:<год>`, состояние — `bday:<tid>:<год>`.
 * Запуск — почасовой scripts/pulse.mts (GitHub Actions), как и кворум.
 */
import sharp from 'sharp';
import opentype from 'opentype.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Send = (method: string, payload: any) => Promise<any>;
const OWNER_ID = 377551019;
const SITE = process.env.APP_URL || 'https://flint-live-in-moment.vercel.app';
const LIME = '#E6FD3A';
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** «Сегодня» по Минску: YYYY-MM-DD. */
export const minskToday = (now = Date.now()) => new Date(now + 3 * 3600_000).toISOString().slice(0, 10);
export const minskHour = (now = Date.now()) => new Date(now + 3 * 3600_000).getUTCHours();

/** День рождения сегодня? 29 февраля в невисокосный год празднуем 28-го. */
export function isBirthday(bday: string, today: string): boolean {
  const md = String(bday || '').slice(5, 10);
  if (!/^\d{2}-\d{2}$/.test(md) || md === '00-00') return false;
  const t = today.slice(5, 10), y = Number(today.slice(0, 4));
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return md === t || (md === '02-29' && !leap && t === '02-28');
}

/** Имя так, как человек представился клубу; без эмодзи и мусора. */
export function displayName(m: any): { first: string; last: string } {
  const clean = (s: any) => String(s || '').replace(/[^\p{L}\p{M}\s'’.-]/gu, '').replace(/^\.+|\.+$/g, '').replace(/\s+/g, ' ').trim();
  let first = clean(m?.first_name), last = clean(m?.last_name);
  if (!last && first.includes(' ')) { const [a, ...b] = first.split(' '); first = a; last = b.join(' '); }
  if (first.length < 2) first = clean(m?.username) || 'друг';
  const cap = (s: string) => s ? s[0].toUpperCase() + s.slice(1) : s;
  return { first: cap(first), last: cap(last) };
}

/**
 * Имя похоже на ник («ARTDEMENTIEV.BY», «ExSplote», «1»)? Тогда берём имя из
 * профиля Telegram — на открытке должно стоять «Артём», а не бренд или логин.
 */
export async function resolveName(m: any, botToken: string): Promise<any> {
  const raw = String(m?.first_name || '');
  const nicky = /[.@_\d]/.test(raw) || /^[A-Z]{8,}$/.test(raw.replace(/\s/g, '')) || displayName(m).first.length < 2;
  if (!nicky || !botToken) return m;
  try {
    const r: any = await fetch(`https://api.telegram.org/bot${botToken}/getChat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: m.telegram_id }),
    }).then((x) => x.json());
    const f = r?.result?.first_name, l = r?.result?.last_name;
    return f ? { ...m, first_name: f, last_name: m.last_name || l || '' } : m;
  } catch { return m; }
}

// ── баннер ──────────────────────────────────────────────────────────────────

let fonts: { title: any; label: any; body: any } | null = null;
async function loadFonts(db: any) {
  if (fonts) return fonts;
  const load = async (p: string) => {
    const { data, error } = await db.storage.from('club-tickets').download(p);
    if (error || !data) throw new Error(`шрифт ${p}: ${error?.message || 'нет'}`);
    return opentype.parse(await data.arrayBuffer());
  };
  const [title, label, body] = await Promise.all([load('_assets/title.otf'), load('_assets/label.otf'), load('_assets/medium.ttf')]);
  fonts = { title, label, body };
  return fonts;
}
const tw = (f: any, t: string, s: number, track = 0) => f.getAdvanceWidth(t, s) + Math.max(0, t.length - 1) * track;
const safe = (f: any, t: string) => [...t].filter((c) => c === ' ' || f.charToGlyph(c).index > 0).join('');
function text(f: any, t: string, x: number, y: number, s: number, fill: string, o: { mid?: boolean; track?: number } = {}) {
  t = safe(f, t); const track = o.track || 0;
  let cx = o.mid ? x - tw(f, t, s, track) / 2 : x;
  if (!track) return `<path d="${f.getPath(t, cx, y, s).toPathData(2)}" fill="${fill}"/>`;
  let d = ''; for (const ch of t) { d += f.getPath(ch, cx, y, s).toPathData(2); cx += f.getAdvanceWidth(ch, s) + track; }
  return `<path d="${d}" fill="${fill}"/>`;
}
const fit = (f: any, t: string, max: number, from: number, to: number, track = 0) => { let s = from; while (s > to && tw(f, t, s, track) > max) s -= 4; return s; };

/** Аватарка из Telegram (если человек её не скрыл) — кружком на баннере. */
async function avatar(botToken: string, tid: number): Promise<Buffer | null> {
  try {
    const ph: any = await fetch(`https://api.telegram.org/bot${botToken}/getUserProfilePhotos`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: tid, limit: 1 }),
    }).then((r) => r.json());
    const sizes: any[] = ph?.result?.photos?.[0] || [];
    const pick = sizes[sizes.length - 1];
    if (!pick?.file_id) return null;
    const gf: any = await fetch(`https://api.telegram.org/bot${botToken}/getFile`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file_id: pick.file_id }),
    }).then((r) => r.json());
    if (!gf?.result?.file_path) return null;
    const r = await fetch(`https://api.telegram.org/file/bot${botToken}/${gf.result.file_path}`);
    return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
  } catch { return null; }
}

/**
 * Именной баннер 1080×1350: чёрный фон, лаймовое имя крупно, аватарка в
 * лаймовом кольце, конфетти из фирменных «камней», знак клуба внизу.
 */
export async function birthdayBanner(db: any, botToken: string, m: any, today: string): Promise<Buffer> {
  const F = await loadFonts(db);
  const W = 1080, H = 1350, P = 80;
  const { first, last } = displayName(m);
  const parts: string[] = [];
  // конфетти — детерминированно от id, чтобы у каждого своё
  let seed = Number(m.telegram_id) % 2147483647 || 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 46; i++) {
    const x = rnd() * W, y = rnd() * 560, s = 8 + rnd() * 18, r = rnd() * 180;
    const c = rnd() < 0.55 ? LIME : rnd() < 0.5 ? '#FFFFFF' : '#5A5A5A';
    parts.push(`<rect x="${x.toFixed(0)}" y="${y.toFixed(0)}" width="${s.toFixed(0)}" height="${(s * 0.45).toFixed(0)}" rx="2" fill="${c}" opacity="${(0.35 + rnd() * 0.6).toFixed(2)}" transform="rotate(${r.toFixed(0)} ${x.toFixed(0)} ${y.toFixed(0)})"/>`);
  }
  // Аватарка — только настоящая. Нет фото в Telegram (или скрыто) — кружок не
  // рисуем вовсе: буква-заглушка выглядела как «не загрузилось».
  const av = await avatar(botToken, Number(m.telegram_id));
  const cy = 360; // центр аватарки
  if (av) parts.push(`<circle cx="${W / 2}" cy="${cy}" r="196" fill="none" stroke="${LIME}" stroke-width="10"/>`);
  let y = av ? 700 : 520;
  parts.push(text(F.label, 'С ДНЁМ РОЖДЕНИЯ,', W / 2, y, 44, 'rgba(255,255,255,0.75)', { mid: true, track: 6 }));
  const N = first.toUpperCase();
  const ns = fit(F.title, N, W - P * 2, av ? 220 : 260, 96);
  y += 40 + ns * 0.82;
  parts.push(text(F.title, N, W / 2, y, ns, LIME, { mid: true }));
  if (last) {
    const L = last.toUpperCase(); const ls = fit(F.title, L, W - P * 2, 84, 44);
    y += ls + 18; parts.push(text(F.title, L, W / 2, y, ls, '#FFFFFF', { mid: true }));
  }
  const [, mm, dd] = today.split('-').map(Number);
  y += 90;
  parts.push(`<rect x="${W / 2 - 210}" y="${y - 50}" width="420" height="72" rx="36" fill="${LIME}"/>`);
  parts.push(text(F.label, `${dd} ${MONTHS[mm - 1].toUpperCase()}`, W / 2, y, 32, '#0B0B0B', { mid: true, track: 4 }));
  parts.push(text(F.body, 'Живи в моменте. Мы рады, что ты с нами.', W / 2, H - 160, 30, 'rgba(255,255,255,0.75)', { mid: true }));
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs><radialGradient id="g" cx="50%" cy="28%" r="60%"><stop offset="0" stop-color="#2a3310"/><stop offset="1" stop-color="#0B0B0B"/></radialGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#g)"/>${parts.join('')}</svg>`;
  const layers: any[] = [{ input: Buffer.from(svg), top: 0, left: 0 }];
  if (av) {
    const D = 360;
    const mask = Buffer.from(`<svg width="${D}" height="${D}"><circle cx="${D / 2}" cy="${D / 2}" r="${D / 2}" fill="#fff"/></svg>`);
    const face = await sharp(av).resize(D, D, { fit: 'cover' }).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
    layers.push({ input: face, top: cy - D / 2, left: W / 2 - D / 2 });
  }
  try {
    const logo = await sharp(readFileSync(join(process.cwd(), 'tools/recap/assets/stack.png'))).resize({ height: 100 }).png().toBuffer();
    const meta = await sharp(logo).metadata();
    layers.push({ input: logo, top: H - 125, left: Math.round(W / 2 - (meta.width || 0) / 2) });
  } catch { /* без логотипа баннер всё равно годный */ }
  return sharp({ create: { width: W, height: H, channels: 3, background: '#0B0B0B' } }).composite(layers).jpeg({ quality: 90 }).toBuffer();
}

// ── тексты ─────────────────────────────────────────────────────────────────

/** Пожелание от ИИ под человека; не ответил — тёплый шаблон. */
export async function wishText(m: any, stats: { events: number; months: number; last?: string }): Promise<string> {
  const { first } = displayName(m);
  const fem = m.gender === 'female' || m.gender === 'f';
  const fallback = `${first}, с днём рождения! ${stats.events > 1 ? `Уже ${stats.events} ${stats.events < 5 ? 'встречи' : 'встреч'} вместе — и это только начало. ` : ''}` +
    `Пусть этот год будет про силу, ясную голову и людей, с которыми хочется расти. Рады, что ты с нами — ждём на ближайшей встрече.`;
  const key = process.env.GEMINI_API_KEY || '';
  if (!key) return fallback;
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 15_000);
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${key}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
      body: JSON.stringify({ contents: [{ parts: [{ text:
        `Напиши поздравление с днём рождения от клуба FLINT «Живи в моменте» участнику по имени ${first} (${fem ? 'женщина' : 'мужчина'}). ` +
        `Клуб — трезвое сообщество: выезды, баня, пробежки, форумы, рост в шести качествах личности. ` +
        `Факты: в клубе ${stats.months < 1 ? 'меньше месяца' : `${stats.months} мес.`}. ` +
        (stats.events > 0
          ? `Был${fem ? 'а' : ''} на ${stats.events} событиях клуба${stats.last ? `, последнее — «${stats.last}»` : ''}. `
          : 'На событиях пока не был — НЕ упоминай это, просто тепло позови на ближайшую встречу. ') +
        `Тон: на «ты», тепло, по-человечески, без пафоса, канцелярита, восклицательных знаков подряд и клише вроде «счастья, здоровья». ` +
        `Можно одно слово из: заряжайся, поток, стержень, эволюция, масштаб. 2–3 коротких предложения, до 300 символов, начни с имени. Без эмодзи. Верни только текст.` }] }] }),
    });
    clearTimeout(t);
    const j: any = await r.json();
    const out = String(j?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim().replace(/^["«]|["»]$/g, '');
    return out && out.length <= 420 ? out : fallback;
  } catch { return fallback; }
}

// ── автомат ────────────────────────────────────────────────────────────────

async function cfgGet(db: any, key: string): Promise<any> {
  const { data } = await db.from('app_config').select('value').eq('key', key).maybeSingle();
  const v = (data as any)?.value;
  try { return typeof v === 'string' ? JSON.parse(v) : v ?? null; } catch { return null; }
}
const cfgSet = (db: any, key: string, value: any) =>
  db.from('app_config').upsert({ key, value: JSON.stringify(value) }, { onConflict: 'key' });

/** С кем именинник был на событиях за полгода (кроме него самого). */
async function companions(db: any, tid: number): Promise<{ ids: number[]; together: Map<number, string> }> {
  const since = new Date(Date.now() - 180 * 86400_000).toISOString().slice(0, 10);
  const { data: mine } = await db.from('registrations').select('event_id').eq('telegram_id', tid).neq('status', 'cancelled');
  const evIds = [...new Set((mine || []).map((r: any) => r.event_id))];
  if (!evIds.length) return { ids: [], together: new Map() };
  const { data: evs } = await db.from('events').select('id,title,date').in('id', evIds).gte('date', since).order('date', { ascending: false });
  const recent = (evs || []).filter((e: any) => !/челлендж|challenge/i.test(e.title || ''));
  const title = new Map<string, string>(recent.map((e: any) => [e.id, String(e.title || '').split(/:| — | - /)[0].trim()]));
  if (!recent.length) return { ids: [], together: new Map() };
  const { data: regs } = await db.from('registrations').select('telegram_id,event_id').in('event_id', recent.map((e: any) => e.id)).neq('status', 'cancelled');
  const together = new Map<number, string>();
  for (const e of recent) for (const r of (regs || []).filter((x: any) => x.event_id === e.id)) {
    const id = Number(r.telegram_id);
    if (id > 0 && id !== tid && !together.has(id)) together.set(id, title.get(e.id) || 'событие');
  }
  return { ids: [...together.keys()], together };
}

export async function stepBirthdays(db: any, send: Send, botToken: string, now = Date.now()): Promise<string[]> {
  const today = minskToday(now), hour = minskHour(now), year = today.slice(0, 4);
  const log: string[] = [];
  const { data: members } = await db.from('members')
    .select('telegram_id,first_name,last_name,username,gender,birthday,status,is_core,bot_active,prefs,created_at')
    .not('birthday', 'is', null);
  const all = members || [];
  const heroes = all.filter((m: any) => (m.status === 'approved' || m.is_core) && m.status !== 'blocked' && isBirthday(m.birthday, today));
  for (const m of heroes) {
    const tid = Number(m.telegram_id);
    const sk = `bday:${tid}:${year}`;
    const st = (await cfgGet(db, sk)) || {};
    const named = await resolveName(m, botToken);
    const { first } = displayName(named);
    // Утро: поздравление + приглашение поздравить тем, кто был рядом.
    if (!st.greeted && hour >= 10) {
      // Только прошедшие события, где человек был: иначе ИИ «хвалит» за то, чего не было.
      const { data: regs } = await db.from('registrations').select('event_id,status').eq('telegram_id', tid).neq('status', 'cancelled');
      const { data: past } = (regs || []).length
        ? await db.from('events').select('id,title,date').in('id', (regs || []).map((r: any) => r.event_id)).lt('date', today).order('date', { ascending: false })
        : { data: [] as any[] };
      const real = (past || []).filter((e: any) => !/челлендж|challenge/i.test(e.title || ''));
      const months = Math.max(0, Math.round((now - Date.parse(m.created_at || new Date(now).toISOString())) / (30 * 86400_000)));
      const wish = await wishText(named, { events: real.length, months, last: real[0] ? String(real[0].title).split(/:| — | - /)[0].trim() : undefined });
      if (m.bot_active !== false) {
        try {
          const img = await birthdayBanner(db, botToken, named, today);
          const fd = new FormData();
          fd.append('chat_id', String(tid));
          fd.append('photo', new Blob([img], { type: 'image/jpeg' }), 'birthday.jpg');
          fd.append('caption', `🎂 <b>${esc(wish)}</b>\n\n— твой клуб FLINT`);
          fd.append('parse_mode', 'HTML');
          await send('sendPhoto:form', fd);
        } catch (e) {
          await send('sendMessage', { chat_id: tid, parse_mode: 'HTML', text: `🎂 <b>${esc(wish)}</b>\n\n— твой клуб FLINT` });
        }
      }
      // Кто поздравляет: были вместе за полгода; мало — добавляем костяк.
      const { ids, together } = await companions(db, tid);
      const core = all.filter((x: any) => x.is_core && Number(x.telegram_id) !== tid).map((x: any) => Number(x.telegram_id));
      const pool = [...new Set([...ids, ...(ids.length < 3 ? core : []), ...(tid !== OWNER_ID ? [OWNER_ID] : [])])];
      const byId = new Map(all.map((x: any) => [Number(x.telegram_id), x]));
      const asked: number[] = [];
      for (const id of pool.slice(0, 15)) {
        const x: any = byId.get(id);
        if (x && (x.bot_active === false || x.status === 'blocked' || x.prefs?.notify?.digest === false)) continue;
        const where = together.get(id);
        await send('sendMessage', {
          chat_id: id, parse_mode: 'HTML',
          text: `🎂 Сегодня <b>${esc(first)}</b> празднует день рождения${where ? ` — вы вместе были на «${esc(where)}»` : ''}.\n\n` +
            `Поздравишь? Вечером ${m.gender === 'female' ? 'она получит' : 'он получит'} открытку от клуба со всеми пожеланиями.`,
          reply_markup: { inline_keyboard: [
            [{ text: '🎉 С днём рождения!', callback_data: `bdp_1_${tid}` }],
            [{ text: '🔥 Расти и кайфуй — до встречи', callback_data: `bdp_2_${tid}` }],
            [{ text: '✍️ Написать своё', callback_data: `bdw_${tid}` }],
          ] },
        });
        asked.push(id);
      }
      await cfgSet(db, sk, { ...st, greeted: true, asked });
      log.push(`greet ${tid} asked ${asked.length}`);
    }
    // Вечер: открытка от клуба со всеми пожеланиями + приглашение на встречу.
    const st2 = (await cfgGet(db, sk)) || st;
    if (st2.greeted && !st2.card && hour >= 20) {
      const wishes: any[] = (await cfgGet(db, `bdwish:${tid}:${year}`)) || [];
      if (wishes.length && m.bot_active !== false) {
        const { data: next } = await db.from('events').select('id,title,date,date_label').gt('date', today)
          .or('status.is.null,status.neq.draft').eq('is_public', true).order('date').limit(1).maybeSingle();
        const lines = wishes.slice(0, 30).map((w: any) => `• <b>${esc(w.name)}</b>: ${esc(w.text)}`).join('\n');
        await send('sendMessage', {
          chat_id: tid, parse_mode: 'HTML',
          text: `💌 <b>Открытка от клуба</b>\n\nСегодня тебя поздравили ${wishes.length} ${wishes.length % 10 >= 2 && wishes.length % 10 <= 4 && (wishes.length % 100 < 10 || wishes.length % 100 >= 20) ? 'человека' : 'человек'}:\n\n${lines}` +
            (next ? `\n\nОтметим вживую? Ближайшая встреча — <b>${esc(String(next.title).split(':')[0])}</b>, ${esc(next.date_label || next.date)}.` : ''),
          ...(next ? { reply_markup: { inline_keyboard: [[{ text: '👀 Посмотреть встречу', web_app: { url: `${SITE}/?ev=${encodeURIComponent(next.id)}` } }]] } } : {}),
        });
      }
      await cfgSet(db, sk, { ...st2, card: true });
      log.push(`card ${tid} wishes ${wishes.length}`);
    }
  }
  return log;
}
