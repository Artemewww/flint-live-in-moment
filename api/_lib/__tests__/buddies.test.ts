import { planBuddies, BUDDY_MIN, BuddyRow } from '../buddies';

/** Детерминированные ключи связок: p1, p2, p3… — чтобы сравнивать составы. */
function pairGen() {
  let n = 0;
  return () => `p${++n}`;
}

/** Состав связки человека: с кем он в паре. */
function matesOf(groups: Map<string, number[]>, id: number): number[] {
  for (const mem of groups.values()) if (mem.includes(id)) return mem.filter((x) => x !== id).sort();
  return [];
}

describe('planBuddies', () => {
  it('в маленьком круге пар не заводит — там все и так на виду', () => {
    const plan = planBuddies([1, 2, 3, 4], [], pairGen());
    expect(plan.groups.size).toBe(0);
    expect(plan.changed.size).toBe(0);
  });

  it('распускает связки, если круг опустел ниже порога', () => {
    const rows: BuddyRow[] = [
      { id: 1, pairId: 'p1' }, { id: 2, pairId: 'p1' },
      { id: 3, pairId: 'p2' }, { id: 4, pairId: 'p2' },
    ];
    const plan = planBuddies([1, 2, 3, 4], rows, pairGen());
    expect(plan.groups.size).toBe(0);
    expect(plan.gone.sort()).toEqual([1, 2, 3, 4]);
  });

  it('с порога собирает пары по порядку записи, нечётного берёт третьим', () => {
    const plan = planBuddies([1, 2, 3, 4, 5], [], pairGen());
    expect([...plan.groups.values()].map((m) => m.length).sort()).toEqual([2, 3]);
    // Каждый в какой-то связке, и никто не остался один.
    for (const id of [1, 2, 3, 4, 5]) expect(matesOf(plan.groups, id).length).toBeGreaterThan(0);
    expect(plan.changed.size).toBe(5);
    expect(BUDDY_MIN).toBe(5);
  });

  it('не пересобирает сложившиеся пары, когда приходит новый человек', () => {
    const rows: BuddyRow[] = [
      { id: 1, pairId: 'p1' }, { id: 2, pairId: 'p1' },
      { id: 3, pairId: 'p2' }, { id: 4, pairId: 'p2' },
      { id: 5, pairId: 'p1' },
    ];
    const plan = planBuddies([1, 2, 3, 4, 5, 6, 7], rows, pairGen());
    // У старых состав не поменялся — их не трогаем и повторно не объявляем.
    expect(matesOf(plan.groups, 3)).toEqual([4]);
    expect(plan.changed.has(3)).toBe(false);
    expect(plan.changed.has(4)).toBe(false);
    // Новые встали в пару друг с другом.
    expect(matesOf(plan.groups, 6)).toEqual([7]);
    expect(plan.changed.has(6)).toBe(true);
  });

  it('ушедшего убирает, а его бади отдаёт следующему записавшемуся', () => {
    const rows: BuddyRow[] = [
      { id: 1, pairId: 'p1' }, { id: 2, pairId: 'p1' },
      { id: 3, pairId: 'p2' }, { id: 4, pairId: 'p2' },
      { id: 5, pairId: 'p3' }, { id: 6, pairId: 'p3' },
    ];
    // Второй снялся, вместо него записался седьмой.
    const plan = planBuddies([1, 3, 4, 5, 6, 7], rows, pairGen());
    expect(plan.gone).toEqual([2]);
    expect(matesOf(plan.groups, 1)).toEqual([7]);
    expect(plan.changed.has(1)).toBe(true);
    expect(plan.changed.has(7)).toBe(true);
    // Чужие связки при этом не тронуты.
    expect(matesOf(plan.groups, 3)).toEqual([4]);
    expect(plan.changed.has(3)).toBe(false);
  });

  it('оставшегося без пары подсаживает третьим, а не бросает одного', () => {
    const rows: BuddyRow[] = [
      { id: 1, pairId: 'p1' }, { id: 2, pairId: 'p1' },
      { id: 3, pairId: 'p2' }, { id: 4, pairId: 'p2' },
      { id: 5, pairId: 'p3' }, { id: 6, pairId: 'p3' },
    ];
    // Шестой снялся — пятый остался один, замены нет.
    const plan = planBuddies([1, 2, 3, 4, 5], rows, pairGen());
    expect(plan.gone).toEqual([6]);
    expect(matesOf(plan.groups, 5).length).toBe(2);
    // Тем, к кому его подсадили, связку объявляем заново.
    const mates = matesOf(plan.groups, 5);
    for (const m of mates) expect(plan.changed.has(m)).toBe(true);
    expect([...plan.groups.values()].map((m) => m.length).sort()).toEqual([2, 3]);
  });

  it('никого не теряет и не дублирует при любом составе', () => {
    for (let n = BUDDY_MIN; n <= 21; n++) {
      const active = Array.from({ length: n }, (_, i) => i + 1);
      const plan = planBuddies(active, [], pairGen());
      const seen = [...plan.groups.values()].flat().sort((a, b) => a - b);
      expect(seen).toEqual(active);
      for (const mem of plan.groups.values()) {
        expect(mem.length).toBeGreaterThanOrEqual(2);
        expect(mem.length).toBeLessThanOrEqual(3);
      }
    }
  });

  it('повторный прогон без изменений ничего не объявляет заново', () => {
    const first = planBuddies([1, 2, 3, 4, 5, 6], [], pairGen());
    const rows: BuddyRow[] = [];
    for (const [pid, mem] of first.groups) for (const id of mem) rows.push({ id, pairId: pid });
    const second = planBuddies([1, 2, 3, 4, 5, 6], rows, pairGen());
    expect(second.changed.size).toBe(0);
    expect(second.gone).toEqual([]);
  });
});
