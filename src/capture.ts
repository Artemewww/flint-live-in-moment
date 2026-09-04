/**
 * Загрузчик СМИ прямо из мини-апп. Файл читаем в base64 (стандартный
 * FileReader — работает везде, включая Telegram WebView). Фото/видео,
 * превышающие лимит Vercel (~4 МБ), пробуем сжать через <canvas>; если
 * canvas в среде недоступен — просто предупреждаем и грузим как есть.
 *
 * Логотип FLINT накладывается ПОВЕРХ медиа при просмотре (в карточке и
 * галерее) — это тот же визуал «логотип в уголочке», но стабильный, без
 * хрупкого canvas-экспорта в файл.
 */

export interface CompressedShot {
  data: string; // base64 (без префикса data:)
  mime: string; // image/jpeg | video/mp4
}

const MAX_BYTES = 4 * 1024 * 1024; // Vercel free лимит тела ~4.5 МБ

/** Читает любой файл в base64 полностью. */
async function fileToBase64(file: File): Promise<string> {
  const reader = new FileReader();
  const chunk = await new Promise<string>((res, rej) => {
    reader.onload = () => {
      const r = reader.result;
      if (typeof r === 'string') res(r.split(',')[1] ?? '');
      else if (r instanceof ArrayBuffer) {
        const bytes = new Uint8Array(r);
        let bin = '';
        const c = 0x8000;
        for (let i = 0; i < bytes.length; i += c) bin += String.fromCharCode(...Array.from(bytes.subarray(i, i + c)));
        res(btoa(bin));
      } else res('');
    };
    reader.onerror = () => rej(new Error('read'));
    reader.readAsDataURL(file); // → data:mime;base64,.... или ArrayBuffer
  });
  return chunk;
}

/** Сжимает фото через canvas; если среда без canvas — null. */
async function tryCompressPhoto(file: File): Promise<CompressedShot | null> {
  try {
    const Max = 1440;
    const url = URL.createObjectURL(file);
    const img = new Image();
    await new Promise<void>((ok, fail) => { img.onload = () => ok(); img.onerror = fail; img.src = url; });
    let w = img.width || 1000, h = img.height || 1000;
    const k = Math.min(1, Max / Math.max(w, h));
    w = Math.round(w * k); h = Math.round(h * k);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url);
    const data = await exportCanvas(canvas);
    return data ? { data, mime: 'image/jpeg' } : null;
  } catch {
    return null;
  }
}

/** Экспорт canvas в base64 JPEG; вернёт null, если среда не поддержала. */
async function exportCanvas(canvas: HTMLCanvasElement): Promise<string | null> {
  try {
    if (typeof canvas.toDataURL === 'function') {
      const dataUrl = canvas.toDataURL('image/jpeg', 0.74);
      if (dataUrl?.startsWith('data:image')) return dataUrl.split(',')[1] ?? null;
    }
  } catch { /* нет toDataURL */ }
  return null;
}

export class ShotTooLargeError extends Error {
  constructor(public size: number) { super('shot_too_large'); }
}

/** Фото: сжимаем; неудача — исходник (с проверкой лимита). */
export async function compressPhoto(file: File): Promise<CompressedShot> {
  const tried = await tryCompressPhoto(file);
  if (tried) return tried;
  if (file.size > MAX_BYTES) throw new ShotTooLargeError(file.size);
  return { data: await fileToBase64(file), mime: file.type || 'image/jpeg' };
}

/** Видео: не пережимаем, только лимит размера. */
export async function readVideo(file: File): Promise<CompressedShot> {
  if (file.size > MAX_BYTES) throw new ShotTooLargeError(file.size);
  return { data: await fileToBase64(file), mime: file.type || 'video/mp4' };
}