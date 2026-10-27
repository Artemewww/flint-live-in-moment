/**
 * Вайб событий и подбор «что тебе сейчас нужно».
 * Модель — две оси (циркумплекс Рассела): энергия 1–5 и компания 1–5, плюс
 * тяга к новому. «Химии» — научпоп-рамка для выбора, не медицинское обещание:
 * бег — эндорфины/эндоканнабиноиды, новое и риск — дофамин/адреналин,
 * солнце днём — серотонин, тёплый круг — окситоцин, тишина — спокойствие.
 * Формула оценки — docs: исследование 27.10.2026 (Oura readiness, Strava, Spotify).
 */
import type { CommunityEvent } from './types';

export type Vibe = { key: string; energy: number; social: number; novelty: number; outdoor: boolean; boosts: string[] };
export type Prefs = { energy: number; social: number; novelty: number };
export type Weather = { tempMax: number; rainProb: number; wind: number; daylightH: number } | null;

const V: [string, RegExp, Omit<Vibe, 'key'>][] = [
  ['banya', /бан[яиюе]|сауна|парил/i, { energy: 2, social: 4, novelty: 0.3, outdoor: false, boosts: ['спокойствие', 'тёплый круг', 'бодрость после контраста'] }],
  ['dive', /прыжк|вышк|бассейн|ныря/i, { energy: 5, social: 3, novelty: 0.9, outdoor: false, boosts: ['адреналин', 'дофамин: смелость'] }],
  ['wake', /вейк|wake|сап\b|sup|каяк|серф/i, { energy: 5, social: 3, novelty: 0.9, outdoor: true, boosts: ['адреналин', 'солнце', 'дофамин'] }],
  ['run', /пробеж|бег|забег|марафон|race|марш|трейл/i, { energy: 4, social: 3, novelty: 0.3, outdoor: true, boosts: ['эндорфины', 'утренний свет'] }],
  ['tea', /чай|чаепит|настол|игр/i, { energy: 1, social: 3, novelty: 0.3, outdoor: false, boosts: ['спокойствие', 'тёплый круг'] }],
  ['cinema', /кино|фильм|кинопоказ/i, { energy: 1, social: 3, novelty: 0.4, outdoor: false, boosts: ['спокойствие', 'тёплый круг'] }],
  ['forum', /форум|expo|конференц|лекци|митап|\bai\b|дискусс/i, { energy: 3, social: 5, novelty: 0.7, outdoor: false, boosts: ['дофамин: новое', 'смыслы'] }],
  ['fire', /костёр|костер|звёзд|звезд|персеид/i, { energy: 2, social: 4, novelty: 0.4, outdoor: true, boosts: ['тёплый круг', 'спокойствие'] }],
  ['challenge', /челлендж|challenge|вызов|голодан/i, { energy: 3, social: 2, novelty: 0.4, outdoor: false, boosts: ['дофамин: прогресс', 'дисциплина'] }],
  ['river', /выезд|ислоч|нароч|поход|карьер|река|озер|природ|палатк/i, { energy: 3, social: 4, novelty: 0.5, outdoor: true, boosts: ['природа: стресс ↓', 'солнце', 'тёплый круг'] }],
];

export function vibeOf(e: Pick<CommunityEvent, 'title' | 'description'> & { logistics?: any }): Vibe {
  const own = (e as any).logistics?.vibe;
  const text = `${e.title || ''} ${e.description || ''}`;
  const hit = V.find(([, re]) => re.test(text));
  const base: Vibe = hit ? { key: hit[0], ...hit[2] } : { key: 'other', energy: 3, social: 3, novelty: 0.4, outdoor: false, boosts: ['поток'] };
  return own ? { ...base, ...own } : base;
}

/** Сегодняшнее состояние: 0 — без сил, 0.5 — норм, 1 — заряжен. */
export function readinessToday(): number | null {
  try {
    const v = JSON.parse(localStorage.getItem('flint:checkin') || 'null');
    return v && v.day === new Date().toISOString().slice(0, 10) ? v.r : null;
  } catch { return null; }
}
export function saveReadiness(r: number) {
  try { localStorage.setItem('flint:checkin', JSON.stringify({ day: new Date().toISOString().slice(0, 10), r })); } catch { /* приватный режим */ }
}
export function loadPrefs(): Prefs | null {
  try { return JSON.parse(localStorage.getItem('flint:vibe') || 'null'); } catch { return null; }
}
export function savePrefs(p: Prefs) {
  try { localStorage.setItem('flint:vibe', JSON.stringify(p)); } catch { /* приватный режим */ }
}

/** Прогноз Open-Meteo для Минска (бесплатно, без ключа) на дату события. */
const wxCache = new Map<string, Weather>();
export async function weatherFor(date: string): Promise<Weather> {
  if (wxCache.has(date)) return wxCache.get(date)!;
  try {
    const r = await fetch('https://api.open-meteo.com/v1/forecast?latitude=53.9&longitude=27.57&daily=temperature_2m_max,precipitation_probability_max,wind_speed_10m_max,daylight_duration&timezone=Europe%2FMinsk&forecast_days=16');
    const j = await r.json();
    const d = j.daily || {};
    (d.time || []).forEach((t: string, i: number) => wxCache.set(t, {
      tempMax: d.temperature_2m_max[i], rainProb: d.precipitation_probability_max[i] ?? 0,
      wind: (d.wind_speed_10m_max[i] ?? 0) / 3.6, daylightH: (d.daylight_duration[i] ?? 0) / 3600,
    }));
  } catch { /* без погоды — без поправки */ }
  return wxCache.get(date) ?? null;
}

/** Оценка события для человека (0…~1.3) и одна строка «почему». */
export function score(v: Vibe, p: Prefs, readiness: number | null, wx: Weather, startHour: number) {
  const r = readiness ?? 0.5;
  const target = Math.min(5, Math.max(1, p.energy + 2 * (r - 0.5)));
  const fitE = 1 - Math.abs(v.energy - target) / 4;
  const fitS = 1 - Math.abs(v.social - p.social) / 4;
  const fitN = 1 - Math.abs(v.novelty - p.novelty);
  let weather = 0;
  if (wx && v.outdoor) {
    if (wx.rainProb > 60 || wx.wind > 10 || wx.tempMax < -10) weather -= 0.4;
    else if (wx.tempMax >= 15 && wx.tempMax <= 25 && wx.rainProb < 30) weather += 0.3;
    if (wx.daylightH < 9 && startHour < 16) weather += 0.2; // зимой — добрать дневного света
  }
  if (startHour >= 21 && v.energy >= 4) weather -= 0.2; // поздно и бодро — против сна
  const total = 0.4 * fitE + 0.25 * fitS + 0.1 * fitN + weather;
  const why =
    r < 0.35 && v.energy <= 2 ? 'Сегодня мало сил — тут можно восстановиться, а не выжимать себя.'
    : r > 0.65 && v.energy >= 4 ? 'Ты заряжен — самое время выплеснуть энергию.'
    : wx && v.outdoor && wx.daylightH < 9 && startHour < 16 ? 'Короткий день — доберёшь солнца, пока светло.'
    : wx && v.outdoor && weather > 0 ? 'Погода как раз для улицы.'
    : fitS > 0.8 ? 'Компания как ты любишь.'
    : 'Близко к твоему ритму.';
  return { total, why };
}
