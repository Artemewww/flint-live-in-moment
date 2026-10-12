import {
  addDays, gearAsk, gearStem, inMediaWindow, isAddressedToBot, minskAt, minskDate,
  recapSchedule, reelEligible, streakFrom, Consent,
} from '../recap';

describe('даты по Минску', () => {
  it('00:30 по Минску — уже новый день, хотя по UTC ещё вчера', () => {
    const t = Date.parse('2026-10-10T21:30:00Z'); // 00:30 11.10 в Минске
    expect(minskDate(t)).toBe('2026-10-11');
  });
  it('minskAt даёт UTC-момент минского часа', () => {
    expect(new Date(minskAt('2026-10-11', 18)).toISOString()).toBe('2026-10-11T15:00:00.000Z');
  });
  it('расписание итогов: вечер последнего дня и следующий вечер', () => {
    const s = recapSchedule('2026-10-11');
    expect(new Date(s.collectAt).toISOString()).toBe('2026-10-11T15:00:00.000Z');
    expect(new Date(s.reviewAt).toISOString()).toBe('2026-10-12T17:00:00.000Z');
  });
});

describe('окно сбора медиа', () => {
  const ev = { date: '2026-10-09', date_end: '2026-10-11' };
  const at = (d: string) => Date.parse(`${d}T09:00:00Z`);
  it('канун старта и неделя после конца — внутри', () => {
    expect(inMediaWindow(ev, at('2026-10-08'))).toBe(true);
    expect(inMediaWindow(ev, at('2026-10-18'))).toBe(true);
  });
  it('раньше и позже — снаружи', () => {
    expect(inMediaWindow(ev, at('2026-10-07'))).toBe(false);
    expect(inMediaWindow(ev, at('2026-10-19'))).toBe(false);
  });
  it('однодневное событие без date_end', () => {
    expect(inMediaWindow({ date: '2026-09-27' }, at('2026-09-27'))).toBe(true);
  });
});

describe('обращение к боту — живые сообщения из чатов', () => {
  it.each([
    'Бот найди плиз спальник',
    'Бот ты не справедливо зачитал очки, нужно снять их',
    'бот, во сколько выезд',
    '@campsflint_bot где сбор',
  ])('«%s» — боту', (t) => expect(isAddressedToBot(t)).toBe(true));
  it.each([
    'Получается я бот)))',
    'Работает ботинок?',
    'Ботаник с нами едет',
    'А ты где живешь?',
  ])('«%s» — не боту', (t) => expect(isAddressedToBot(t)).toBe(false));
  it('ответ на сообщение бота — ему', () => expect(isAddressedToBot('а точнее?', { replyToBot: true })).toBe(true));
});

describe('просьба найти вещь', () => {
  it.each([
    ['Бот найди плиз спальник', 'спальник'],
    ['было бы неплохо заиметь электро пилу... нужна электропила', 'электропила'],
    ['у кого есть триммер для трав', 'триммер'],
    ['Нужен коврик', 'коврик'],
  ])('«%s» → %s', (t, item) => expect(gearAsk(t)).toBe(item));
  it.each(['Нужна попутка до Минска', 'кто может взять с собой', 'Нужно место в машине'])(
    '«%s» — не про снаряжение', (t) => expect(gearAsk(t)).toBeNull());
  it('основа слова ловит формы', () => {
    expect('спальники'.startsWith(gearStem('спальник'))).toBe(true);
    expect('спальный мешок'.startsWith(gearStem('спальник'))).toBe(true);
  });
});

describe('согласие на кадры', () => {
  it('«без моих кадров» исключает все медиа автора, остальное проходит', () => {
    const media = [{ telegram_id: 1 }, { telegram_id: 2 }, { telegram_id: 3 }, { telegram_id: null }];
    const c = new Map<number, Consent>([[1, 'no'], [2, 'club']]);
    expect(reelEligible(media, c).map((m) => m.telegram_id)).toEqual([2, 3, null]);
  });
});

describe('серия подряд', () => {
  it('пропуск обрывает серию', () => {
    expect(streakFrom(['2026-10-01', '2026-10-02', '2026-10-04', '2026-10-05'], '2026-10-05')).toBe(2);
  });
  it('сегодня ещё не отметился — серия от вчера', () => {
    expect(streakFrom(['2026-10-03', '2026-10-04'], '2026-10-05')).toBe(2);
  });
  it('пусто', () => expect(streakFrom([], '2026-10-05')).toBe(0));
  it('addDays через границу месяца', () => expect(addDays('2026-10-31', 1)).toBe('2026-11-01'));
});
