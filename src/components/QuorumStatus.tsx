import type { CommunityEvent } from '../types';
import { quorumInfo, peopleWord } from '../quorum';

/**
 * СТАТУС «СОСТОИТСЯ ПРИ N» — баня от 10 человек и подобное.
 *
 * Без него человек видел «Занято мест: 7 из 15» и думал, что всё в порядке,
 * а баня срывалась: для старта нужно 10, и решать надо за 4 часа. Здесь
 * главное — сколько ещё не хватает и до какого времени: это и есть повод
 * записаться сейчас и позвать друга (гости идут в счёт).
 *
 * compact — строка для карточки в ленте; без него — блок в событии/на главной.
 */
export default function QuorumStatus({ event, compact }: { event: CommunityEvent; compact?: boolean }) {
  const q = quorumInfo(event);
  if (!q) return null;
  const late = !q.reached && Date.now() >= q.deadline;
  const pct = Math.min(100, Math.round((q.have / q.min) * 100));

  if (compact) {
    return (
      <div className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-mono font-bold ${q.reached ? 'bg-brand text-black' : 'bg-orange-500/15 text-orange-300 border border-orange-400/30'}`}>
        {q.reached ? `✓ Состоится · ${q.have}` : `${q.have} из ${q.min} · ещё ${q.left}`}
      </div>
    );
  }

  return (
    <div className={`rounded-2xl border p-3.5 ${q.reached ? 'border-brand/40 bg-brand/[0.07]' : 'border-orange-400/30 bg-orange-500/[0.07]'}`}>
      <div className="flex items-baseline justify-between gap-3">
        <div className={`font-display font-black uppercase text-[13px] tracking-tight ${q.reached ? 'text-brand' : 'text-orange-300'}`}>
          {q.reached ? '✓ Состоится' : late ? 'Решаем, проводим ли' : 'Ещё не собралась'}
        </div>
        <div className="font-mono text-xs text-white/80">
          <b className="text-white text-base">{q.have}</b> из {q.min}
        </div>
      </div>
      {/* Полоса до минимума: заполнилась — событие состоится */}
      <div className="mt-2 h-2 rounded-full bg-white/10 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${q.reached ? 'bg-brand' : 'bg-orange-400'}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-[11px] leading-snug text-white/70">
        {q.reached
          ? `Минимум ${q.min} набран — встречаемся. Передумал — отпишись заранее: на тебя рассчитывают.`
          : late
            ? `Не хватило ${q.left} ${peopleWord(q.left)} к сроку — организатор решает, проводим ли с теми, кто есть.`
            : <>Нужно минимум <b className="text-white">{q.min}</b>: ещё <b className="text-white">{q.left} {peopleWord(q.left)}</b> — и всё состоится. Решаем <b className="text-white">{q.deadlineLabel}</b>. Гости «+1» тоже в счёт.</>}
      </p>
    </div>
  );
}
