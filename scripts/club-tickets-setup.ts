/**
 * ПРИГЛАСИТЕЛЬНЫЕ КЛУБА — загрузка пачки билетов на событие.
 *
 * Механика (для любых будущих проектов с пригласительными):
 *   1. Организатор получает PDF-билеты (по одному файлу на билет) и кладёт их
 *      в папку.
 *   2. Этот скрипт кладёт их в приватное хранилище (Supabase Storage,
 *      бакет club-tickets) и заводит «пул» билетов события в app_config
 *      под ключом club_tickets:<eventId>. Каждому билету — свой номер в пуле
 *      и уникальный короткий код FL-XXXX (печатается на билете).
 *   3. Дальше всё в админке → событие → «🎟 Пригласительные»: выдать человеку
 *      или раздать всем записавшимся. При выдаче сервер впечатывает в низ
 *      билета имя, @ник, номер и код, и бот присылает файл человеку в личку.
 *      Человек может перезапросить файл (кнопка в боте, /ticket, карточка
 *      события в приложении) — другому пользователю чужой билет не отдаётся.
 *
 * Запуск:
 *   npx tsx scripts/club-tickets-setup.ts <eventId> "<папка с PDF>" [--meta meta.json] [--logo logo.png]
 *
 * meta.json (необязательно) — [{ file, number, series }] — номер/серия билета
 * для сверки на входе. Повторный запуск с той же папкой не плодит дубли и не
 * трогает уже выданные билеты.
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { randomBytes } from 'crypto';
import { homedir } from 'os';

config({ path: '.env', quiet: true } as any);
const s = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const BUCKET = 'club-tickets';

const [eventId, folder] = process.argv.slice(2);
const opt = (k: string) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : ''; };
if (!eventId || !folder) {
  console.error('Использование: npx tsx scripts/club-tickets-setup.ts <eventId> "<папка с PDF>" [--meta meta.json] [--logo logo.png]');
  process.exit(1);
}

async function put(path: string, body: Buffer, type: string) {
  const { error } = await s.storage.from(BUCKET).upload(path, body, { contentType: type, upsert: true });
  if (error) throw new Error(`${path}: ${error.message}`);
}

(async () => {
  const { data: ev } = await s.from('events').select('id,title').eq('id', eventId).maybeSingle();
  if (!ev) throw new Error(`Событие ${eventId} не найдено`);

  // Приватный бакет: билеты — это пропуск, наружу ссылкой не светим.
  const { data: buckets } = await s.storage.listBuckets();
  if (!(buckets || []).some((b) => b.name === BUCKET)) {
    const { error } = await s.storage.createBucket(BUCKET, { public: false });
    if (error) throw new Error(`Бакет: ${error.message}`);
    console.log(`Создан приватный бакет ${BUCKET}`);
  }

  // Общие ассеты штампа: шрифт с кириллицей и логотип. Один раз на все события.
  const fonts = join(homedir(), 'Library/Fonts');
  for (const [src, dst] of [['Manrope-ExtraBold.ttf', '_assets/bold.ttf'], ['Manrope-Medium.ttf', '_assets/medium.ttf']]) {
    if (existsSync(join(fonts, src))) await put(dst, readFileSync(join(fonts, src)), 'font/ttf');
  }
  const logo = opt('--logo');
  if (logo) await put('_assets/logo.png', readFileSync(logo), 'image/png');

  const meta: any[] = opt('--meta') ? JSON.parse(readFileSync(opt('--meta'), 'utf8')) : [];
  const files = readdirSync(folder).filter((f) => f.toLowerCase().endsWith('.pdf')).sort();
  if (!files.length) throw new Error('В папке нет PDF');

  const key = `club_tickets:${eventId}`;
  const { data: cur } = await s.from('app_config').select('value').eq('key', key).maybeSingle();
  const state = cur?.value ? JSON.parse(cur.value) : { eventId, tickets: [] as any[] };
  const used = new Set(state.tickets.map((t: any) => t.code));

  for (const f of files) {
    if (state.tickets.some((t: any) => t.file === f)) continue; // уже в пуле
    const path = `${eventId}/base/${f}`;
    await put(path, readFileSync(join(folder, f)), 'application/pdf');
    let code = '';
    do code = `FL-${randomBytes(2).toString('hex').toUpperCase()}`; while (used.has(code));
    used.add(code);
    const m = meta.find((x) => x.file === f) || {};
    state.tickets.push({ no: state.tickets.length + 1, file: f, base: path, number: m.number || '', series: m.series || '', code });
  }
  state.total = state.tickets.length;
  await s.from('app_config').upsert({ key, value: JSON.stringify(state) }, { onConflict: 'key' });
  console.log(`«${(ev as any).title}»: в пуле ${state.total} пригласительных`, state.tickets.map((t: any) => `${t.no}:${t.code}`).join(' '));
})().catch((e) => { console.error(e.message || e); process.exit(1); });
