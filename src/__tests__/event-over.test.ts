import { getEventPhase, isEventOver, CommunityEvent } from '../types';

/** Живой баг: «Завершить» в последний день — а событие висит в ленте до полуночи. */
describe('событие закончилось', () => {
  const ev = { date: '2026-10-09', dateEnd: '2026-10-11', checklist: {} } as unknown as CommunityEvent;
  it('в последний день без «Завершить» — ещё идёт', () => {
    expect(isEventOver(ev, '2026-10-11')).toBe(false);
  });
  it('нажали «Завершить» — уходит сразу, не дожидаясь даты', () => {
    const done = { ...ev, status: 'closed', checklist: { finished: true } } as unknown as CommunityEvent;
    expect(isEventOver(done, '2026-10-11')).toBe(true);
    expect(getEventPhase(done, '2026-10-11')).toBe('past');
  });
  it('«Приостановить набор» (closed без finished) — остаётся в ленте', () => {
    const paused = { ...ev, status: 'closed' } as unknown as CommunityEvent;
    expect(isEventOver(paused, '2026-10-10')).toBe(false);
  });
  it('после последнего дня — прошло', () => expect(isEventOver(ev, '2026-10-12')).toBe(true));
});
