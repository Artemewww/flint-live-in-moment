/**
 * Клиент для serverless-функций на Vercel.
 * Именно здесь сайт «встречается» с ботом: заявка с сайта уходит в Telegram.
 */
import { getInitData } from './telegram';

export interface RegisterPayload {
  eventId: string;
  eventTitle: string;
  name: string;
  telegram: string;
  phone?: string;
  inviter: string;
  /** Откуда пришла заявка. */
  source: 'website' | 'telegram-mini-app';
  /** Код доступа к закрытому событию (проверяется на сервере). */
  accessCode?: string;
  // Анкета участника. Имена в snake_case — это колонки registrations,
  // их принимает белый список REG_FIELDS в /api/register.
  has_transport?: boolean;
  transport_details?: string;
  transport_seats?: number;
  // Списочные колонки (jsonb) — только массив: строка порождала legacy-записи,
  // на которых падала админка (см. toList() в AdminPanel.tsx).
  inventory?: string[];
  category?: 'male' | 'female';
  dietary?: 'omnivore' | 'vegetarian' | 'vegan';
  guest_count?: number;
  equipment?: string[];
  roles?: string[];
  /** Согласие на обработку персональных данных (пишется в members.agreed_pd). */
  agreedPd?: boolean;
  /** «Откуда узнал о клубе» — свободный текст из анкеты. */
  sourceHint?: string;
}

export interface RegisterResult {
  ok: boolean;
  delivered: boolean; // доставлено ли реально в Telegram (зависит от настройки токена)
  message?: string;
  /** Машиночитаемая причина отказа, напр. 'access_denied'. */
  code?: string;
  /** Сервер уже видел эту заявку (анти-дубль) — новая запись не создана. */
  alreadyRegistered?: boolean;
}

/**
 * Отправляет заявку на вступление в закрытый клуб.
 * Без реф-кода — статус pending_review (ручная модерация костяком).
 * С валидным `refCode` внутри Telegram — впуск сразу (доверие пригласившего),
 * сервер отвечает `approved: true`.
 */
export async function submitClubApplication(payload: {
  firstName: string;
  lastName?: string;
  phone: string;
  sourceHint?: string;
  /** Реф-код пригласившего — снимает ручную модерацию. */
  refCode?: string;
}): Promise<RegisterResult & { code?: string; approved?: boolean }> {
  try {
    const res = await fetch('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'apply', ...payload, initData: getInitData() }),
    });
    if (!res.ok) return { ok: false, delivered: false, message: `HTTP ${res.status}` };
    return (await res.json()) as RegisterResult & { code?: string; approved?: boolean };
  } catch (err) {
    return { ok: false, delivered: false, message: (err as Error).message };
  }
}

/**
 * Сигнал спроса «Мне интересно» — уходит организаторам в группу заявок.
 * Так видно, какие мероприятия хотят и что пора запускать.
 */
export async function submitInterest(eventId: string, eventTitle: string): Promise<RegisterResult> {
  try {
    const res = await fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'interest', eventId, eventTitle, initData: getInitData() }),
    });
    if (!res.ok) return { ok: false, delivered: false, message: `HTTP ${res.status}` };
    const data = (await res.json()) as Partial<RegisterResult>;
    return { ok: true, delivered: Boolean(data.delivered), message: data.message };
  } catch (err) {
    return { ok: false, delivered: false, message: (err as Error).message };
  }
}

export async function submitRegistration(payload: RegisterPayload): Promise<RegisterResult> {
  try {
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, initData: getInitData(), refCode: (() => { try { return localStorage.getItem('flint_ref') || undefined; } catch { return undefined; } })() }),
    });

    if (!res.ok) {
      // Читаем тело, чтобы поднять причину отказа (напр. неверный код доступа).
      let body: any = {};
      try { body = await res.json(); } catch { /* пустое тело */ }
      return { ok: false, delivered: false, code: body.code, message: body.error || `HTTP ${res.status}` };
    }
    const data = (await res.json()) as Partial<RegisterResult>;
    return { ok: true, delivered: Boolean(data.delivered), message: data.message, alreadyRegistered: Boolean(data.alreadyRegistered) };
  } catch (err) {
    // Оффлайн / функция недоступна (напр. локальный `vite` без serverless).
    return { ok: false, delivered: false, message: (err as Error).message };
  }
}

/**
 * Отправляет голос за программу мероприятия. Голос сохраняется в program_votes
 * по проверенному Telegram-id, поэтому вне Mini App вернётся ok:false.
 */
export async function submitVote(eventId: string, option: string): Promise<RegisterResult> {
  try {
    const res = await fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'vote', eventId, option, initData: getInitData() }),
    });
    if (!res.ok) return { ok: false, delivered: false, message: `HTTP ${res.status}` };
    const data = (await res.json()) as Partial<RegisterResult>;
    return { ok: Boolean(data.ok), delivered: Boolean(data.delivered), message: data.message };
  } catch (err) {
    return { ok: false, delivered: false, message: (err as Error).message };
  }
}

/** Отзыв после события (1–5 + «придёшь снова» + коммент) → таблица feedback. */
export async function submitFeedback(payload: {
  eventId: string;
  eventTitle?: string;
  rating: number;
  wouldReturn: boolean;
  feedback: string;
}): Promise<RegisterResult> {
  try {
    const res = await fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'feedback', ...payload, initData: getInitData() }),
    });
    if (!res.ok) return { ok: false, delivered: false, message: `HTTP ${res.status}` };
    const data = (await res.json()) as Partial<RegisterResult>;
    return { ok: Boolean(data.ok), delivered: Boolean(data.delivered), message: data.message };
  } catch (err) {
    return { ok: false, delivered: false, message: (err as Error).message };
  }
}
