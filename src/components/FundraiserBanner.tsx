import React, { useEffect, useRef, useState } from 'react';
import { ChevronRight, Heart } from 'lucide-react';
import Avatar from './Avatar';

type PublicFundraiser = {
  slug: string; title: string; summary: string; goalAmount: number; confirmedAmount: number;
  confirmedCount?: number; deadline?: string; imageUrl?: string; supporters?: { avatar?: string }[];
};

const dayMonth = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '');
};

/**
 * Сборы на главной — компактной строкой, а не плакатом на пол-экрана.
 * Большой баннер отодвигал афишу вниз, и первым человек видел просьбу о
 * деньгах, а не события. Теперь это карточка высотой ~100px: обложка,
 * название, прогресс и кто уже скинулся. Если сборов несколько — они
 * листаются вбок, следующая карточка выглядывает из-за края.
 */
function FundCard({ fund, onOpen, wide }: { fund: PublicFundraiser; onOpen: (slug: string) => void; wide: boolean }) {
  const pct = Math.min(100, Math.round((fund.confirmedAmount / Math.max(fund.goalAmount, 1)) * 100));
  return (
    <button
      type="button"
      onClick={() => onOpen(fund.slug)}
      className={`group relative flex shrink-0 snap-start items-center gap-3.5 overflow-hidden rounded-2xl border border-brand/25 bg-gradient-to-r from-brand/[.12] via-white/[.04] to-white/[.02] p-2.5 pr-3 text-left text-white transition hover:border-brand/50 ${wide ? 'w-full' : 'w-[86%] sm:w-[420px]'}`}
      aria-label={`Сбор: ${fund.title}`}
    >
      {/* Обложка квадратом; без картинки — фирменная плашка с сердцем. */}
      <span className="relative h-[76px] w-[76px] shrink-0 overflow-hidden rounded-xl bg-brand/15">
        {fund.imageUrl
          ? <img src={fund.imageUrl} alt="" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
          : <span className="flex h-full w-full items-center justify-center"><Heart className="h-7 w-7 text-brand" /></span>}
        <span className="absolute left-1 top-1 rounded-md bg-black/70 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-brand">сбор</span>
      </span>

      <span className="min-w-0 flex-1 space-y-1.5">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-black uppercase leading-tight">{fund.title}</span>
        </span>
        <span className="block h-1.5 overflow-hidden rounded-full bg-white/10">
          <span className="block h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
        </span>
        <span className="flex items-center justify-between gap-2">
          <span className="truncate text-[11px] text-white/60">
            <b className="text-white">{Math.round(fund.confirmedAmount)}</b> из {Math.round(fund.goalAmount)} BYN
            {fund.deadline && <> · до {dayMonth(fund.deadline)}</>}
          </span>
          {(fund.supporters?.length || 0) > 0 && (
            <span className="flex shrink-0 -space-x-1.5">
              {fund.supporters!.slice(0, 3).map((s, i) => (
                <span key={i} className="inline-flex"><Avatar name="•" src={s.avatar} size={18} className="ring-1 ring-[#111]" /></span>
              ))}
            </span>
          )}
        </span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-white/35 transition group-hover:translate-x-0.5 group-hover:text-brand" />
    </button>
  );
}

export default function FundraiserBanner({ onOpen }: { onOpen: (slug: string) => void }) {
  const [funds, setFunds] = useState<PublicFundraiser[]>([]);
  const [active, setActive] = useState(0);
  const track = useRef<HTMLDivElement>(null);
  useEffect(() => {
    fetch('/api/fundraisers?action=list')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j?.fundraisers?.length) return setFunds(j.fundraisers);
        // Старый бэкенд без action=list — берём один последний, как раньше.
        return fetch('/api/fundraisers').then((r) => (r.ok ? r.json() : null)).then((k) => k?.fundraiser && setFunds([k.fundraiser]));
      })
      .catch(() => {});
  }, []);
  if (!funds.length) return null;
  const many = funds.length > 1;
  const onScroll = () => {
    const el = track.current; if (!el) return;
    const card = el.firstElementChild as HTMLElement | null;
    if (card) setActive(Math.round(el.scrollLeft / (card.offsetWidth + 12)));
  };
  return (
    <section aria-label="Командные сборы" className="space-y-2">
      {many && (
        <div className="flex items-center justify-between px-0.5">
          <span className="font-mono text-[10px] uppercase tracking-[.18em] text-white/45">Собираем командой · {funds.length}</span>
          <span className="flex gap-1">
            {funds.map((_, i) => <span key={i} className={`h-1.5 rounded-full transition-all ${i === active ? 'w-4 bg-brand' : 'w-1.5 bg-white/20'}`} />)}
          </span>
        </div>
      )}
      <div
        ref={track}
        onScroll={onScroll}
        className={many ? '-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden' : ''}
      >
        {funds.map((f) => <React.Fragment key={f.slug}><FundCard fund={f} onOpen={onOpen} wide={!many} /></React.Fragment>)}
      </div>
    </section>
  );
}
