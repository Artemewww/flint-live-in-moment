/**
 * РЕПУТАЦИЯ УЧАСТНИКА — «что клуб знает про человека».
 *
 * Задача владельца (19.08): организатор должен ДО события понимать, кого он
 * впускает в круг. На Нароче человек говорил за спиной у других, и узнали об
 * этом случайно и постфактум. Одновременно есть обратная сторона: человек
 * пришёл курящим и бросил, не знал языка и выучил — это тоже надо видеть.
 *
 * Три принципа, на которых всё построено:
 *
 * 1. В БД лежат ФАКТЫ (сигналы), а не приговор. Уровень («надёжный», «риск»)
 *    считается здесь, из сигналов, с затуханием по времени. Удалили сигнал —
 *    уровень пересчитался. Вечных меток в базе нет, человек не «заклеймён».
 *
 * 2. Один аноним не рушит репутацию. Красный уровень включается, только если
 *    красные сигналы пришли от ДВУХ независимых людей или от организатора/
 *    костяка, который отвечает за свои слова. Иначе максимум «наблюдаем».
 *    Без этого правила система превращается в инструмент сведения счётов.
 *
 * 3. Видит только тот, кто ведёт события (костяк и организаторы). Участнику
 *    показываем ТОЛЬКО его плюсы и рост — красные флажки не показываем и в
 *    интерфейсе участника не отдаём (см. api/profile.ts, action=rep_self).
 *
 * ⚠️ Ответственность: это данные о живых людях. Исключение из клуба —
 * всегда решение человека (костяка), а не порог в формуле. Система показывает
 * основания и даёт их обсудить, но никого не «банит» автоматически.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
);

export type Polarity = -1 | 0 | 1;

export interface SignalDef {
  /** Как показываем организатору. */
  label: string;
  /** Коротко — для строки в списке. */
  short: string;
  polarity: Polarity;
  /** Вес сигнала: нарушение трезвости весит не столько же, сколько опоздание. */
  weight: number;
  emoji: string;
  /** Показывать ли этот пункт в анонимном опросе участников. */
  peer?: boolean;
}

/**
 * Справочник сигналов. Держим в коде, а не в БД: это стандарт клуба, он должен
 * ехать вместе с релизом и меняться через ревью, а не втихую в таблице.
 */
export const SIGNALS: Record<string, SignalDef> = {
  // ── Красные: то, что рушит круг ───────────────────────────────────────────
  gossip:       { label: 'Говорит за спиной, носит слухи', short: 'за спиной', polarity: -1, weight: 12, emoji: '🗣', peer: true },
  sabotage:     { label: 'Саботаж: рушит договорённости и настрой', short: 'саботаж', polarity: -1, weight: 16, emoji: '🧨', peer: true },
  disrespect:   { label: 'Неуважение, давление, харассмент', short: 'неуважение', polarity: -1, weight: 22, emoji: '⛔️', peer: true },
  sober_break:  { label: 'Нарушил трезвость', short: 'трезвость', polarity: -1, weight: 30, emoji: '🚫' },
  money_debt:   { label: 'Не вернул деньги / не внёс взнос', short: 'долг', polarity: -1, weight: 14, emoji: '💸', peer: true },
  damage:       { label: 'Испортил чужое и не возместил', short: 'не возместил', polarity: -1, weight: 12, emoji: '🧯', peer: true },
  program_break:{ label: 'Сорвал пункт программы, за который отвечал', short: 'сорвал пункт', polarity: -1, weight: 10, emoji: '📵', peer: true },
  buddy_fail:   { label: 'Бросил своего бади', short: 'бросил бади', polarity: -1, weight: 10, emoji: '🙈', peer: true },
  no_show:      { label: 'Не приехал без предупреждения', short: 'не приехал', polarity: -1, weight: 10, emoji: '👻' },
  late:         { label: 'Систематически опаздывает, держит круг', short: 'опоздания', polarity: -1, weight: 5, emoji: '⏰', peer: true },
  mess:         { label: 'Оставил за собой мусор / не убрал', short: 'не убрал', polarity: -1, weight: 6, emoji: '🗑', peer: true },

  // ── Зелёные: то, ради чего человека зовут снова ───────────────────────────
  peer_good:    { label: 'С ним хорошо в круге', short: 'хорош в круге', polarity: 1, weight: 6, emoji: '👍', peer: true },
  helped:       { label: 'Помогал другим, вывозил на себе', short: 'помогал', polarity: 1, weight: 8, emoji: '🤝', peer: true },
  role_done:    { label: 'Взял роль и довёл до конца', short: 'довёл роль', polarity: 1, weight: 9, emoji: '🎯' },
  calm_conflict:{ label: 'Погасил конфликт, удержал гармонию', short: 'погасил конфликт', polarity: 1, weight: 10, emoji: '🕊', peer: true },
  paid_on_time: { label: 'Платит вовремя, без напоминаний', short: 'платит вовремя', polarity: 1, weight: 5, emoji: '💚' },
  driver:       { label: 'Вёз людей на своей машине', short: 'вёз людей', polarity: 1, weight: 6, emoji: '🚗' },
  brought:      { label: 'Привёл в клуб хорошего человека', short: 'привёл своего', polarity: 1, weight: 5, emoji: '🌱' },
  staff_done:   { label: 'Отработал помощником организатора', short: 'помощник', polarity: 1, weight: 10, emoji: '🎖' },
  growth:       { label: 'Рост в клубе: перерос свою привычку', short: 'вырос', polarity: 1, weight: 10, emoji: '📈' },
  attended:     { label: 'Был на событии', short: 'был', polarity: 0, weight: 0, emoji: '📍' },
};

/**
 * Контекст личности — НЕ наказание, а то, что организатору полезно знать
 * заранее: с чем человек заходит. `state='past'` = перерос (бросил курить,
 * выучил язык) — и это автоматически становится плюсом «рост в клубе».
 */
export const TRAITS: Record<string, { label: string; emoji: string; past: string }> = {
  smoking:    { label: 'Курит',                    emoji: '🚬', past: 'Бросил курить в клубе' },
  vape:       { label: 'Вейп / никотин',           emoji: '💨', past: 'Отказался от вейпа' },
  alcohol:    { label: 'В прошлом алкоголь',       emoji: '🍺', past: 'Держит трезвость' },
  language:   { label: 'Языковой барьер',          emoji: '🗺', past: 'Выучил язык в клубе' },
  no_gear:    { label: 'Нет снаряжения',           emoji: '🎒', past: 'Собрал своё снаряжение' },
  no_exp:     { label: 'Нет походного опыта',      emoji: '🌿', past: 'Набрал опыт выездов' },
  no_license: { label: 'Без прав / без машины',    emoji: '🚙', past: 'Получил права' },
  health:     { label: 'Ограничение по здоровью',  emoji: '🩺', past: 'Ограничение снято' },
  shy:        { label: 'Тяжело входит в контакт',  emoji: '🫥', past: 'Раскрылся в круге' },
};

export type RepLevel = 'new' | 'green' | 'watch' | 'risk' | 'stop';

export const LEVEL_LABEL: Record<RepLevel, { text: string; emoji: string }> = {
  new:   { text: 'нет данных',  emoji: '⚪️' },
  green: { text: 'надёжный',    emoji: '🟢' },
  watch: { text: 'наблюдаем',   emoji: '🟡' },
  risk:  { text: 'риск',        emoji: '🟠' },
  stop:  { text: 'не допускать',emoji: '🔴' },
};

export interface RepRow {
  subject_id: number | string;
  author_id: number | string | null;
  event_id: number | string | null;
  kind: string;
  polarity: number;
  weight: number;
  source: string;
  note: string | null;
  created_at: string;
}

export interface TraitRow {
  subject_id: number | string;
  trait: string;
  state: string;
  note: string | null;
}

export interface RepSummary {
  score: number;
  level: RepLevel;
  /** Красные основания: что именно и сколько независимых источников. */
  reds: Array<{ kind: string; label: string; emoji: string; count: number; voices: number; last: string }>;
  greens: Array<{ kind: string; label: string; emoji: string; count: number }>;
  /** Активный контекст (курит, нет опыта). */
  traits: Array<{ trait: string; label: string; emoji: string }>;
  /** Что человек перерос — показываем и ему самому. */
  growth: Array<{ trait: string; label: string; emoji: string }>;
  /** Хватает ли подтверждений, чтобы красное считалось красным. */
  confirmed: boolean;
  signals: number;
}

/** Старое весит меньше: человек меняется, репутация не должна быть вечной. */
function decay(createdAt: string): number {
  const days = (Date.now() - new Date(createdAt).getTime()) / 86400000;
  if (days < 180) return 1;
  if (days < 365) return 0.6;
  if (days < 730) return 0.3;
  return 0.15;
}

/** Слово организатора весит больше анонимного голоса — он отвечает за него. */
function sourceWeight(source: string): number {
  if (source === 'core') return 2;
  if (source === 'organizer') return 1.6;
  if (source === 'ai') return 0.5; // сигнал из разбора чата — только повод посмотреть
  return 1;
}

/**
 * Сводка по человеку. `score` стартует с 70 («пока претензий нет»), сигналы
 * двигают его вверх и вниз.
 */
export function summarize(rows: RepRow[], traits: TraitRow[] = []): RepSummary {
  let score = 70;
  const redAgg = new Map<string, { count: number; voices: Set<string>; last: string }>();
  const greenAgg = new Map<string, number>();
  let confirmedRed = false;
  const redVoices = new Set<string>();

  for (const r of rows) {
    const def = SIGNALS[r.kind];
    const pol = (def?.polarity ?? Number(r.polarity) ?? 0) as number;
    const w = def?.weight ?? Number(r.weight) ?? 1;
    if (!pol || !w) continue;
    score += pol * w * decay(r.created_at) * sourceWeight(r.source);

    if (pol < 0) {
      const cur = redAgg.get(r.kind) || { count: 0, voices: new Set<string>(), last: r.created_at };
      cur.count += 1;
      cur.voices.add(String(r.author_id ?? 'system'));
      if (r.created_at > cur.last) cur.last = r.created_at;
      redAgg.set(r.kind, cur);
      if (r.author_id) redVoices.add(String(r.author_id));
      if (r.source === 'organizer' || r.source === 'core') confirmedRed = true;
    } else {
      greenAgg.set(r.kind, (greenAgg.get(r.kind) || 0) + 1);
    }
  }

  // Два независимых голоса — тоже подтверждение.
  if (redVoices.size >= 2) confirmedRed = true;

  score = Math.max(0, Math.min(100, Math.round(score)));

  let level: RepLevel;
  if (!rows.length) level = 'new';
  else if (score >= 75) level = 'green';
  else if (score >= 55) level = 'watch';
  else if (score >= 35) level = 'risk';
  else level = 'stop';

  // Неподтверждённое красное не опускает человека ниже «наблюдаем»: один
  // обиженный голос не должен закрывать человеку двери в клуб.
  if (!confirmedRed && (level === 'risk' || level === 'stop')) level = 'watch';

  const active = traits.filter((t) => t.state !== 'past');
  const past = traits.filter((t) => t.state === 'past');

  return {
    score,
    level,
    confirmed: confirmedRed,
    signals: rows.length,
    reds: [...redAgg.entries()]
      .map(([kind, v]) => ({
        kind,
        label: SIGNALS[kind]?.label || kind,
        emoji: SIGNALS[kind]?.emoji || '⚠️',
        count: v.count,
        voices: v.voices.size,
        last: v.last,
      }))
      .sort((a, b) => b.count - a.count),
    greens: [...greenAgg.entries()]
      .map(([kind, count]) => ({
        kind,
        label: SIGNALS[kind]?.label || kind,
        emoji: SIGNALS[kind]?.emoji || '✅',
        count,
      }))
      .sort((a, b) => b.count - a.count),
    traits: active.map((t) => ({
      trait: t.trait,
      label: TRAITS[t.trait]?.label || t.trait,
      emoji: TRAITS[t.trait]?.emoji || '•',
    })),
    growth: past.map((t) => ({
      trait: t.trait,
      label: TRAITS[t.trait]?.past || `Перерос: ${t.trait}`,
      emoji: '📈',
    })),
  };
}

/** Сводки сразу по списку людей — для состава события одним запросом. */
export async function loadReputation(ids: Array<number | string>): Promise<Map<number, RepSummary>> {
  const uniq = [...new Set(ids.map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  const out = new Map<number, RepSummary>();
  if (!uniq.length) return out;

  const [{ data: rows }, { data: traits }] = await Promise.all([
    supabase.from('reputation_events').select('*').in('subject_id', uniq),
    supabase.from('member_traits').select('*').in('subject_id', uniq),
  ]);

  for (const id of uniq) {
    out.set(
      id,
      summarize(
        ((rows || []) as any[]).filter((r) => Number(r.subject_id) === id) as RepRow[],
        ((traits || []) as any[]).filter((t) => Number(t.subject_id) === id) as TraitRow[],
      ),
    );
  }
  return out;
}

/**
 * Записать сигнал. Повторная отправка того же сигнала тем же человеком на том
 * же событии не создаёт дубль (уникальный индекс) — молча считаем это успехом,
 * чтобы двойной тап в боте не выглядел ошибкой.
 */
export async function addSignal(input: {
  subjectId: number | string;
  kind: string;
  authorId?: number | string | null;
  eventId?: number | string | null;
  source?: 'peer' | 'organizer' | 'core' | 'system' | 'ai';
  note?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const def = SIGNALS[input.kind];
  if (!def) return { ok: false, error: 'unknown-signal' };
  if (Number(input.subjectId) === Number(input.authorId)) return { ok: false, error: 'self' };

  const { error } = await supabase.from('reputation_events').insert({
    subject_id: Number(input.subjectId),
    author_id: input.authorId ? Number(input.authorId) : null,
    event_id: input.eventId ? String(input.eventId) : null, // events.id — TEXT

    kind: input.kind,
    polarity: def.polarity,
    weight: def.weight,
    source: input.source || 'peer',
    note: input.note ? String(input.note).slice(0, 1000) : null,
  });
  if (error && !/duplicate key|23505/i.test(error.message)) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Отметить контекст личности. Перевод в 'past' = человек это перерос, и клуб
 * фиксирует рост отдельным зелёным сигналом: это ровно то, ради чего система и
 * нужна — видеть не только падения, но и то, как человек меняется.
 */
export async function setTrait(input: {
  subjectId: number | string;
  trait: string;
  state: 'active' | 'past';
  setBy?: number | string | null;
  note?: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!TRAITS[input.trait]) return { ok: false, error: 'unknown-trait' };
  const { error } = await supabase.from('member_traits').upsert(
    {
      subject_id: Number(input.subjectId),
      trait: input.trait,
      state: input.state,
      note: input.note ? String(input.note).slice(0, 300) : null,
      set_by: input.setBy ? Number(input.setBy) : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'subject_id,trait' },
  );
  if (error) return { ok: false, error: error.message };

  if (input.state === 'past') {
    await addSignal({
      subjectId: input.subjectId,
      kind: 'growth',
      authorId: input.setBy || null,
      source: 'organizer',
      note: TRAITS[input.trait].past,
    });
  }
  return { ok: true };
}

/** Строка для списка состава: 🟡 Игорь · 62 · за спиной ×2, опоздания. */
export function repLine(sum: RepSummary): string {
  const lv = LEVEL_LABEL[sum.level];
  if (sum.level === 'new') return `${lv.emoji} нет данных`;
  const bits: string[] = [`${lv.emoji} ${sum.score}`];
  const red = sum.reds.slice(0, 2).map((r) => `${SIGNALS[r.kind]?.short || r.kind}${r.count > 1 ? ` ×${r.count}` : ''}`);
  if (red.length) bits.push(`⚠️ ${red.join(', ')}`);
  const green = sum.greens.slice(0, 2).map((g) => SIGNALS[g.kind]?.short || g.kind);
  if (green.length) bits.push(green.join(', '));
  if (sum.traits.length) bits.push(sum.traits.map((t) => t.emoji).join(''));
  if (sum.growth.length) bits.push('📈');
  return bits.join(' · ');
}
