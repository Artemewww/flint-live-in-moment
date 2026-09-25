/**
 * БАДИ-ПАРЫ: чистая логика распределения (без БД).
 *
 * ⚠️ Эталон под тестами. Рантайм-копии этой функции ЗАДУБЛИРОВАНЫ дословно в
 * api/telegram/webhook.ts, api/register.ts и api/cron/reminders.ts, потому что
 * импорт из api/_lib/ роняет serverless-функции на Vercel в рантайме
 * (FUNCTION_INVOCATION_FAILED, локальные tsc/esbuild это НЕ ловят). Меняешь
 * алгоритм — правь все четыре места, тест здесь держит поведение.
 * Тот же приём, что с ratelimit.ts и verifyInitData.
 *
 * Зачем оно вообще: правило «у каждого на событии есть бади» участник
 * принимает на входе в клуб, а самих пар до сих пор не существовало — человек
 * брал обязательство, но не знал, за кого отвечает.
 *
 * Два принципа:
 *  1. Связки «липкие». Сложившаяся пара НЕ пересобирается, когда приходит
 *     новый человек. Иначе за день до выезда половина круга узнаёт, что их
 *     бади теперь другой — и ответственность превращается в формальность.
 *  2. Никого не бросаем одного. Нечётный последний подсаживается третьим в
 *     самую маленькую связку: тройка честнее, чем человек без напарника.
 */

/** Строка связки из БД: кто и в какой связке состоит. */
export interface BuddyRow {
  id: number;
  pairId: string;
}

export interface BuddyPlan {
  /** Итоговые связки: pair_id → участники (2 или 3 человека). */
  groups: Map<string, number[]>;
  /** Кому связку надо записать заново и объявить (состав изменился). */
  changed: Set<number>;
  /** Кого убрать из таблицы: снялся с события или остался без связки. */
  gone: number[];
}

/** Меньше пяти человек — пары не нужны: в таком круге все и так на виду. */
export const BUDDY_MIN = 5;

/**
 * @param active   telegram_id активных участников В ПОРЯДКЕ ЗАПИСИ
 * @param rows     текущее содержимое event_buddies для события
 * @param newPairId генератор ключа связки (в тестах — детерминированный)
 */
export function planBuddies(active: number[], rows: BuddyRow[], newPairId: () => string): BuddyPlan {
  if (active.length < BUDDY_MIN) {
    return { groups: new Map(), changed: new Set(), gone: rows.map((r) => r.id) };
  }

  // Что есть сейчас: связки из тех, кто ещё едет. Связка из одного — распалась.
  const activeSet = new Set(active);
  const before = new Map<string, number[]>();
  for (const r of rows) {
    if (!activeSet.has(r.id)) continue;
    before.set(r.pairId, [...(before.get(r.pairId) || []), r.id]);
  }
  const groups = new Map<string, number[]>();
  for (const [pid, mem] of before) if (mem.length >= 2) groups.set(pid, [...mem]);

  // Без пары: и новички, и те, у кого напарник снялся. Порядок — по записи.
  const placed = new Set<number>();
  for (const mem of groups.values()) for (const id of mem) placed.add(id);
  const queue = active.filter((id) => !placed.has(id));

  while (queue.length >= 2) {
    const a = queue.shift() as number;
    const b = queue.shift() as number;
    groups.set(newPairId(), [a, b]);
  }
  if (queue.length === 1) {
    let best: string | null = null;
    for (const [pid, mem] of groups) {
      if (mem.length >= 3) continue;
      if (best === null || mem.length < (groups.get(best) as number[]).length) best = pid;
    }
    if (best) groups.set(best, [...(groups.get(best) as number[]), queue[0]]);
  }

  const desired = new Map<number, string>();
  for (const [pid, mem] of groups) for (const id of mem) desired.set(id, pid);

  const gone = rows.map((r) => r.id).filter((id) => !desired.has(id));

  // Трогаем только изменившиеся связки, чтобы не сбрасывать notified_at тем,
  // у кого ничего не поменялось: повторное «твой бади — Ира» читается как сбой.
  const changed = new Set<number>();
  for (const [pid, mem] of groups) {
    const was = before.get(pid) || [];
    const same = was.length === mem.length && mem.every((id) => was.includes(id));
    if (!same) for (const id of mem) changed.add(id);
  }

  return { groups, changed, gone };
}
