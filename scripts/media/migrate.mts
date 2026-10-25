/**
 * ПЕРЕНОС МЕДИА СОБЫТИЙ ИЗ TELEGRAM В STORAGE — запускается в recap.yml
 * перед оркестратором (раз в 2 часа) и руками:
 *   npx tsx scripts/media/migrate.mts [--dry-run] [--event <id>]
 *
 * Почему: кадры, которые участники шлют боту, лежали в event_media как
 * Telegram file_id и отдавались через прокси-функцию. Отсюда пустые плитки
 * в «Истории»:
 *   • обложки видео не было ни у одного ролика — getFile не возвращает
 *     thumbnail, прокси обложек всегда отвечал 404;
 *   • прокси не умеет Range — на айфоне видео без Range не запускается;
 *   • файлы больше 20 МБ Bot API не отдаёт вовсе.
 * После переноса файл лежит на CDN Supabase (Range, кэш), рядом — обложка
 * .jpg (соглашение storagePosterOf в api/events.ts), а file_id становится
 * публичной ссылкой — прокси уже умеет такие отдавать редиректом.
 * Видео заодно ужимаются до 720p: телефонный клип 10–20 МБ → 2–4 МБ.
 * Файлы, которые Telegram не отдаёт, попадают в app_config.media_lost —
 * архив их не показывает, чтобы не было мёртвых плиток.
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

config({ path: '.env', quiet: true } as any);
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const ONLY = args.includes('--event') ? args[args.indexOf('--event') + 1] : '';
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const BOT = process.env.TELEGRAM_BOT_TOKEN || '';
const BUCKET = 'event-images';
const log = (...a: any[]) => console.log('[media]', ...a);

async function tgFile(fid: string): Promise<{ url?: string; error?: string }> {
  const g: any = await fetch(`https://api.telegram.org/bot${BOT}/getFile`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file_id: fid }),
  }).then((r) => r.json()).catch(() => null);
  if (!g?.ok || !g.result?.file_path) return { error: String(g?.description || 'getFile failed') };
  return { url: `https://api.telegram.org/file/bot${BOT}/${g.result.file_path}` };
}

const ff = (a: string[]) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...a], { stdio: ['ignore', 'ignore', 'pipe'] });

async function upload(path: string, file: string, type: string) {
  const { error } = await db.storage.from(BUCKET).upload(path, readFileSync(file), { contentType: type, upsert: true, cacheControl: '31536000' });
  if (error) throw new Error(error.message);
  return db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

async function main() {
  if (!BOT) { log('нет TELEGRAM_BOT_TOKEN — пропускаю'); return; }
  let q = db.from('event_media').select('id,event_id,file_id,media_type').not('file_id', 'like', 'https://%');
  if (ONLY) q = q.eq('event_id', ONLY);
  const { data: rows } = await q.limit(400);
  const { data: lostRow } = await db.from('app_config').select('value').eq('key', 'media_lost').maybeSingle();
  const lost: string[] = (() => { try { return JSON.parse((lostRow as any)?.value || '[]'); } catch { return []; } })();
  const todo = (rows || []).filter((r: any) => !lost.includes(String(r.id)));
  log('к переносу', todo.length);
  const dir = mkdtempSync(join(tmpdir(), 'media-'));
  let moved = 0;
  for (const r of todo as any[]) {
    const f = await tgFile(String(r.file_id));
    if (!f.url) {
      log('недоступен', r.id, f.error);
      if (/too big|invalid file_id|wrong file_id/i.test(f.error || '')) lost.push(String(r.id));
      continue;
    }
    const src = join(dir, 'src'); const isVideo = r.media_type === 'video';
    try {
      const res = await fetch(f.url);
      if (!res.ok) { log('скачать не вышло', r.id, res.status); continue; }
      writeFileSync(src, Buffer.from(await res.arrayBuffer()));
      const base = `media/${r.event_id}/${r.id}`;
      let url: string;
      if (isVideo) {
        const mp4 = join(dir, 'o.mp4'), jpg = join(dir, 'o.jpg');
        // 720p по короткой стороне, H.264 + faststart: играет везде, грузится быстро.
        ff(['-i', src, '-vf', "scale='if(gt(iw,ih),-2,min(720,iw))':'if(gt(iw,ih),min(720,ih),-2)',format=yuv420p",
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-maxrate', '3M', '-bufsize', '6M',
          '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', mp4]);
        // Обложка — не первый кадр (он часто смазан стартом съёмки), а ~1 с.
        try { ff(['-ss', '1', '-i', mp4, '-frames:v', '1', '-vf', 'scale=540:-2', '-q:v', '4', jpg]); }
        catch { ff(['-i', mp4, '-frames:v', '1', '-vf', 'scale=540:-2', '-q:v', '4', jpg]); }
        if (DRY) { log('DRY video', r.id); continue; }
        url = await upload(`${base}.mp4`, mp4, 'video/mp4');
        await upload(`${base}.jpg`, jpg, 'image/jpeg');
      } else {
        const jpg = join(dir, 'o.jpg');
        ff(['-i', src, '-vf', "scale='min(1600,iw)':-2", '-q:v', '3', jpg]);
        if (DRY) { log('DRY photo', r.id); continue; }
        url = await upload(`${base}.jpg`, jpg, 'image/jpeg');
      }
      const { error } = await db.from('event_media').update({ file_id: url }).eq('id', r.id);
      if (error) { log('update error', r.id, error.message); continue; }
      moved += 1;
    } catch (e: any) {
      log('ошибка', r.id, String(e?.stderr || e?.message || e).slice(0, 200));
    }
  }
  if (!DRY) await db.from('app_config').upsert({ key: 'media_lost', value: JSON.stringify([...new Set(lost)]) }, { onConflict: 'key' });
  rmSync(dir, { recursive: true, force: true });
  log('перенесено', moved, 'недоступно', lost.length);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
