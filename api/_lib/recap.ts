/**
 * ИТОГИ СОБЫТИЯ: сбор медиа из чата, согласие на публикацию, ролик, рассылка.
 *
 * ⚠️ Эталон под тестами. Рантайм-копии выражений задублированы в
 * api/telegram/webhook.ts (импорт из api/_lib/ роняет serverless-функции на
 * Vercel, см. group-intent.ts). Оркестратор scripts/recap/orchestrate.mts
 * работает вне Vercel и импортирует этот файл напрямую.
 *
 * Откуда взялось: на Ислочи 2026 участники скидывали фото и видео в чат
 * события, а бот сохранял только ТЕКСТ — медиа из групп событий молча
 * пропадали. Ролик монтировали руками из папки, собранной по личкам.
 */

/** Минск — UTC+3 круглый год (без перехода на летнее время). */
export const MINSK_OFFSET_MS = 3 * 60 * 60 * 1000;

export function minskDate(now: number = Date.now()): string {
  return new Date(now + MINSK_OFFSET_MS).toISOString().slice(0, 10);
}

/** UTC-момент для «YYYY-MM-DD HH:00 по Минску». */
export function minskAt(day: string, hour: number): number {
  return Date.parse(`${day}T00:00:00Z`) + (hour * 60 * 60 * 1000) - MINSK_OFFSET_MS;
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Последний день события. */
export function lastDayOf(ev: { date?: string | null; date_end?: string | null }): string {
  const start = String(ev.date || '');
  const end = String(ev.date_end || '');
  return end && end > start ? end : start;
}

/**
 * Окно, когда медиа из чата события идут в его галерею: с кануна старта
 * (сборы, «заняли поляну») до недели после конца (люди досылают кадры).
 */
export function inMediaWindow(ev: { date?: string | null; date_end?: string | null }, now: number = Date.now()): boolean {
  if (!ev.date) return false;
  const today = minskDate(now);
  return today >= addDays(String(ev.date), -1) && today <= addDays(lastDayOf(ev), 7);
}

/**
 * Таймлайн итогов:
 *  • collect — вечер последнего дня (18:00): в чат «скидывайте кадры»,
 *    участникам — вопрос о согласии;
 *  • review  — следующий день 20:00: организатору сводка и кнопка «Монтировать».
 */
export function recapSchedule(lastDay: string): { collectAt: number; reviewAt: number } {
  return { collectAt: minskAt(lastDay, 18), reviewAt: minskAt(addDays(lastDay, 1), 20) };
}

export type RecapStage =
  | 'collect' | 'review' | 'build' | 'building' | 'preview' | 'publish' | 'announced' | 'skipped' | 'failed';

export interface RecapState {
  stage: RecapStage;
  collect_at?: string;
  review_at?: string;
  /** Номер версии монтажа: «другая версия» = новый seed отбора и порядка. */
  seed?: number;
  preview?: { url: string; poster?: string; tg_file_id?: string; duration?: number; clips?: number; photos?: number };
  error?: string;
  updated_at?: string;
}

/** Согласие на использование кадров. */
export type Consent = 'pub' | 'club' | 'no';
export const CONSENT_LABEL: Record<Consent, string> = {
  pub: '✅ Можно везде (и в соцсетях клуба)',
  club: '👥 Только внутри клуба',
  no: '🙅 Без моих кадров',
};

/**
 * Медиа для ролика: без авторов, сказавших «без моих кадров». Ролик живёт
 * внутри клуба, поэтому «только внутри клуба» в него проходит; для соцсетей
 * организатор получает отдельный список.
 */
export function reelEligible<T extends { telegram_id?: number | null }>(media: T[], consents: Map<number, Consent>): T[] {
  return media.filter((m) => consents.get(Number(m.telegram_id || 0)) !== 'no');
}

// ── Бот в чате ─────────────────────────────────────────────────────────────

/**
 * Обращение к боту по имени. Живой случай с Ислочи: «Бот найди плиз
 * спальник» — без «?» и без вопросительного слова в начале, и бот промолчал.
 * В челлендже: «Бот ты не справедливо зачитал очки» — «ты» помечало сообщение
 * как адресованное человеку, и жалоба ушла в пустоту.
 */
export const BOT_ADDRESS = /^\s*(@?campsflint_bot|бот(ик|яра)?|bot|флинт-?бот)(?![а-яёa-z0-9_])/i;

export function isAddressedToBot(text: string, opts: { replyToBot?: boolean; botUsername?: string } = {}): boolean {
  if (opts.replyToBot) return true;
  const t = String(text || '');
  if (BOT_ADDRESS.test(t)) return true;
  const u = (opts.botUsername || 'campsflint_bot').toLowerCase();
  return t.toLowerCase().includes(`@${u}`);
}

/**
 * Просьба найти вещь: «найди спальник», «нужна электропила», «у кого есть
 * триммер?». Возвращает саму вещь или null.
 */
const GEAR_ASK = /(?:найди(?:те)?|нужн[аоыы]?|нужен|ищу|ищем|где\s+взять|одолжи(?:те)?|у\s+кого\s+(?:есть|будет|найд[её]тся)|есть\s+у\s+кого|кто\s+(?:может\s+)?(?:взять|дать|одолжить))\s+(?:(?:плиз|пожалуйста|пж|мне|нам|кому-?нибудь|ли|бы|ещ[её]|тут|здесь)\s+)*([а-яёa-z][а-яёa-z-]*(?:\s+[а-яёa-z][а-яёa-z-]*){0,2})/i;
const GEAR_STOP = new Set(['что', 'кто', 'как', 'где', 'когда', 'место', 'места', 'машина', 'попутка', 'помощь', 'время', 'сегодня', 'завтра', 'ехать', 'взять', 'быть', 'чтобы', 'это', 'всё', 'все']);

export function gearAsk(text: string): string | null {
  const m = String(text || '').match(GEAR_ASK);
  if (!m) return null;
  // Вещь — слова до первого предлога: «триммер для трав» → «триммер».
  // Начинается с предлога («взять с собой») — значит, это не вещь.
  const words: string[] = [];
  for (const w of m[1].toLowerCase().split(/\s+/)) {
    if (/^(и|в|во|на|с|со|для|по|к|у|из|от|до|за|под|над|плиз|пж|пожалуйста)$/.test(w)) break;
    words.push(w);
  }
  const item = words.slice(0, 2).join(' ').replace(/[^а-яёa-z\s-]/gi, '').trim();
  if (item.length < 3 || GEAR_STOP.has(words[0])) return null;
  return item;
}

/** Основа слова для поиска в снаряжении: «спальники» → «спальн». */
export function gearStem(item: string): string {
  const w = String(item || '').toLowerCase().split(/\s+/).sort((a, b) => b.length - a.length)[0] || '';
  return w.length > 6 ? w.slice(0, w.length - 2) : w.slice(0, Math.max(3, w.length - 1));
}

// ── Челлендж ───────────────────────────────────────────────────────────────

/**
 * Серия ПОДРЯД. Раньше «День подряд» в ответе бота считал все отметки за
 * всё время: пропустил неделю — а бот пишет «7 дней подряд».
 * Сегодняшней отметки ещё может не быть — тогда серия считается от вчера.
 */
export function streakFrom(dates: Iterable<string>, today: string): number {
  const set = new Set(dates);
  let cursor = set.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (set.has(cursor) && n < 1000) { n += 1; cursor = addDays(cursor, -1); }
  return n;
}
