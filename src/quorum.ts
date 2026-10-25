/**
 * Время старта и «состоится при N» на фронте. Логика совпадает с
 * api/_lib/quorum.ts (бот и почасовой автомат) — правь оба.
 */
import type { CommunityEvent } from './types';

/**
 * Старт события в мс — по МИНСКУ (UTC+3), а не по часам телефона.
 * Раньше таймер на главной считал до «${date}T19:00» в часовом поясе
 * устройства: время события игнорировалось, и баня в 15:00 показывала
 * отсчёт до 19:00 (а у человека в другом поясе — ещё дальше от правды).
 */
export function eventStartMs(ev: Pick<CommunityEvent, 'date' | 'time'>): number {
  const d = String(ev.date || '').slice(0, 10);
  const t = String(ev.time || '').match(/(\d{1,2})[:.](\d{2})/);
  const hh = String(t?.[1] || '10').padStart(2, '0'), mm = t?.[2] || '00';
  return Date.parse(`${d}T${hh}:${mm}:00+03:00`);
}

export interface QuorumInfo {
  min: number;
  /** Сколько нас сейчас (записи + гости). */
  have: number;
  left: number;
  reached: boolean;
  /** Когда решаем, состоится ли (мс). */
  deadline: number;
  /** «сегодня в 15:00» / «завтра в 11:00» / «27 октября в 15:00». */
  deadlineLabel: string;
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export function whenLabel(ms: number, now = Date.now()): string {
  const m = new Date(ms + 3 * 3600_000), n = new Date(now + 3 * 3600_000);
  const hm = `${String(m.getUTCHours()).padStart(2, '0')}:${String(m.getUTCMinutes()).padStart(2, '0')}`;
  const day = (x: Date) => Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
  const diff = Math.round((day(m) - day(n)) / 86400_000);
  return `${diff === 0 ? 'сегодня' : diff === 1 ? 'завтра' : `${m.getUTCDate()} ${MONTHS[m.getUTCMonth()]}`} в ${hm}`;
}

/** Кворум события или null. `have` — участники с гостями (participantsCount). */
export function quorumInfo(ev: CommunityEvent, now = Date.now()): QuorumInfo | null {
  const q: any = (ev as any).logistics?.quorum;
  const min = Math.round(Number(q?.min) || 0);
  if (min < 2) return null;
  const hours = Math.max(1, Math.min(72, Math.round(Number(q?.hours) || 4)));
  const deadline = eventStartMs(ev) - hours * 3600_000;
  const have = Math.max(0, Number(ev.participantsCount) || 0);
  return { min, have, left: Math.max(0, min - have), reached: have >= min, deadline, deadlineLabel: whenLabel(deadline, now) };
}

export const peopleWord = (n: number) =>
  n % 10 === 1 && n % 100 !== 11 ? 'человек' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'человека' : 'человек';
