/**
 * Карточка события для шеринга: 1200×630 (формат превью ссылок Telegram).
 * Фото события на фоне, логотип FLINT слева сверху, дата крупно фирменным
 * шрифтом (Montserrat 900) и название. Кладётся в telegram_image — её берут
 * и превью ссылки /e/<id> (og:image), и бот, когда присылает событие.
 *
 * Рисуем в браузере админа (canvas): на сервере Vercel нет ни шрифтов, ни
 * графической библиотеки, а тащить их ради одной картинки — лишний вес.
 */

const W = 1200, H = 630;
const BRAND = '#E6FD3A';
const RU_MON = ['ЯНВ', 'ФЕВ', 'МАР', 'АПР', 'МАЯ', 'ИЮН', 'ИЮЛ', 'АВГ', 'СЕН', 'ОКТ', 'НОЯ', 'ДЕК'];
const RU_DOW = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'];

// Логотип FLINT (тот же, что LogoMain в VectorIcons) — строкой, чтобы нарисовать на canvas.
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="328" height="117" viewBox="0 0 328 117" fill="none"><path d="M298.968 88.0317V46.2721H282.499V36.5674H327.347V46.2721H310.878V88.0317H298.968Z" fill="#E6FD3A"/><path d="M264.368 36.5674H276.131V88.0317H266.353L240.694 56.7855V88.0317H228.931V36.5674H238.782L264.368 67.8136V36.5674Z" fill="#E6FD3A"/><path d="M204.807 88.0317V36.5674H216.717V88.0317H204.807Z" fill="#E6FD3A"/><path d="M160.436 88.0317V36.5674H172.346V78.327H198.152V88.0317H160.436Z" fill="#E6FD3A"/><path d="M152.373 46.125H125.391V59.7263H149.212V69.284H125.391V88.0317H113.481V36.5674H152.373V46.125Z" fill="#E6FD3A"/><path d="M6.16253 90.5462L0 74.2944L14.636 45.6601L16.947 28.6343L30.8127 18.5736L44.6784 0L50.8409 9.28679L68.5582 20.1214L76.2613 59.5903L80.8833 66.5554L83.1942 92.8679L74.7207 109.12L37.7455 116.085L4.6219 105.25L6.16253 90.5462Z" fill="#E6FD3A"/><path d="M19.8315 80.0155C21.1436 77.9019 22.6769 75.9415 24.0786 73.8933L44.9654 43.7988C46.248 41.9432 49.9629 36.2843 51.4682 34.9199L51.5702 34.8262C50.2877 37.9946 49.8978 41.1933 49.3601 44.5643L46.9246 59.0641C46.6653 60.5121 46.367 61.9645 46.1552 63.4203C47.2617 63.2248 48.3583 62.8554 49.4433 62.5508L60.0543 59.5153C61.1008 59.2162 62.159 58.9522 63.1984 58.6272C63.7357 58.4882 64.2846 58.3673 64.8145 58.2001C60.8749 64.1218 57.202 70.3298 53.2207 76.1731L39.3124 96.7016C38.2354 98.3151 36.5731 100.815 35.8117 102.542C35.8386 92.3086 38.6007 84.0047 39.6217 74.4123L22.6637 79.2193C21.737 79.474 20.72 79.6441 19.8315 80.0155Z" fill="black"/></svg>`;

function loadImage(src: string, cors = true): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (cors && !src.startsWith('data:')) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image'));
    img.src = src;
  });
}

/** «3 ОКТ · СБ» или «3–5 ОКТ» — коротко и крупно, как на афише. */
export function shareDate(date?: string, dateEnd?: string): { big: string; small: string } {
  const d = date ? new Date(`${date}T12:00:00`) : null;
  if (!d || Number.isNaN(d.getTime())) return { big: '', small: '' };
  const e = dateEnd && dateEnd > (date || '') ? new Date(`${dateEnd}T12:00:00`) : null;
  if (e && !Number.isNaN(e.getTime())) {
    const same = e.getMonth() === d.getMonth();
    return {
      big: same ? `${d.getDate()}–${e.getDate()} ${RU_MON[d.getMonth()]}` : `${d.getDate()} ${RU_MON[d.getMonth()]} – ${e.getDate()} ${RU_MON[e.getMonth()]}`,
      small: `${RU_DOW[d.getDay()]}–${RU_DOW[e.getDay()]}`,
    };
  }
  return { big: `${d.getDate()} ${RU_MON[d.getMonth()]}`, small: RU_DOW[d.getDay()] };
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width <= maxW) { cur = next; continue; }
    if (cur) lines.push(cur);
    cur = w;
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  if (lines.length > maxLines) lines.length = maxLines;
  // Не влезло — многоточие в последней строке.
  const used = lines.join(' ').split(/\s+/).length;
  if (used < words.length && lines.length) {
    let last = lines[lines.length - 1];
    while (last && ctx.measureText(`${last}…`).width > maxW) last = last.slice(0, -1);
    lines[lines.length - 1] = `${last.trim()}…`;
  }
  return lines;
}

export async function renderShareCard(ev: { title: string; date?: string; dateEnd?: string; time?: string; location?: string; image?: string }): Promise<string> {
  // Фирменный шрифт должен успеть загрузиться, иначе canvas нарисует системный.
  try { await Promise.all([document.fonts.load('900 64px Montserrat'), document.fonts.load('700 28px Montserrat')]); } catch { /* нет FontFace API */ }

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas недоступен');

  // Фон: фото события (object-fit: cover) или фирменный градиент.
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#1d2412'); bg.addColorStop(1, '#0a0a0a');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  let photoOk = false;
  if (ev.image) {
    try {
      const img = await loadImage(ev.image);
      const k = Math.max(W / img.width, H / img.height);
      const w = img.width * k, h = img.height * k;
      ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
      ctx.getImageData(0, 0, 1, 1); // бросит, если картинка «испортила» canvas (CORS)
      photoOk = true;
    } catch {
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    }
  }
  // Затемнение: сверху — под логотип, снизу — под дату и название.
  const top = ctx.createLinearGradient(0, 0, 0, 200);
  top.addColorStop(0, 'rgba(0,0,0,0.65)'); top.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = top; ctx.fillRect(0, 0, W, 200);
  const bottom = ctx.createLinearGradient(0, H * 0.35, 0, H);
  bottom.addColorStop(0, 'rgba(0,0,0,0)'); bottom.addColorStop(1, `rgba(0,0,0,${photoOk ? 0.88 : 0.5})`);
  ctx.fillStyle = bottom; ctx.fillRect(0, H * 0.35, W, H * 0.65);

  // Логотип — левый верхний угол.
  try {
    const logo = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(LOGO_SVG)}`, false);
    const lh = 64, lw = (logo.width / logo.height) * lh;
    ctx.drawImage(logo, 56, 48, lw, lh);
  } catch { /* без логотипа карточка всё равно полезна */ }

  const pad = 56;
  // Название — до двух строк.
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 62px Montserrat, sans-serif';
  ctx.textBaseline = 'alphabetic';
  const titleLines = wrap(ctx, ev.title.toUpperCase(), W - pad * 2, 2);
  let y = H - pad;
  const place = [ev.location, ev.time].filter(Boolean).join(' · ');
  if (place) {
    ctx.font = '600 26px Montserrat, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(place.length > 70 ? `${place.slice(0, 69)}…` : place, pad, y);
    y -= 48;
  }
  ctx.font = '900 62px Montserrat, sans-serif';
  ctx.fillStyle = '#ffffff';
  for (let i = titleLines.length - 1; i >= 0; i--) { ctx.fillText(titleLines[i], pad, y); y -= 70; }

  // Дата — фирменной «плашкой» над названием.
  const dt = shareDate(ev.date, ev.dateEnd);
  if (dt.big) {
    ctx.font = '900 40px Montserrat, sans-serif';
    const bigW = ctx.measureText(dt.big).width;
    ctx.font = '700 22px Montserrat, sans-serif';
    const smallW = dt.small ? ctx.measureText(dt.small).width + 20 : 0;
    const bw = bigW + smallW + 40, bh = 64, by = y - bh + 14;
    ctx.fillStyle = BRAND;
    const r = 18;
    ctx.beginPath();
    ctx.moveTo(pad + r, by); ctx.arcTo(pad + bw, by, pad + bw, by + bh, r); ctx.arcTo(pad + bw, by + bh, pad, by + bh, r);
    ctx.arcTo(pad, by + bh, pad, by, r); ctx.arcTo(pad, by, pad + bw, by, r); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#000000';
    ctx.font = '900 40px Montserrat, sans-serif';
    ctx.fillText(dt.big, pad + 20, by + 46);
    if (dt.small) {
      ctx.font = '700 22px Montserrat, sans-serif';
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillText(dt.small, pad + 20 + bigW + 20, by + 44);
    }
  }

  return canvas.toDataURL('image/jpeg', 0.9);
}

/** Рисует карточку и кладёт в хранилище; возвращает публичную ссылку. */
export async function makeShareCard(ev: Parameters<typeof renderShareCard>[0]): Promise<string> {
  const dataUrl = await renderShareCard(ev);
  let token = '';
  try { token = localStorage.getItem('flint_admin_token') || ''; } catch { /* приватный режим */ }
  const r = await fetch('/api/admin/events?action=upload_image', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ dataUrl }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.url) throw new Error(j.error || `HTTP ${r.status}`);
  return j.url;
}
