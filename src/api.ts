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
}

export interface RegisterResult {
  ok: boolean;
  delivered: boolean; // доставлено ли реально в Telegram (зависит от настройки токена)
  message?: string;
}

/**
 * Отправляет заявку на сервер. Если бэкенд/токен ещё не настроен,
 * возвращает ok:true, delivered:false — форма на сайте всё равно
 * покажет успех (данные сохранятся локально), а организатор увидит
 * заявку в Telegram, как только будут заданы переменные окружения.
 */
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
      return { ok: false, delivered: false, message: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as Partial<RegisterResult>;
    return { ok: true, delivered: Boolean(data.delivered), message: data.message };
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
