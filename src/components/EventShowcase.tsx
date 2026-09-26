import React, { useRef, useState } from 'react';
import { Check, ChevronDown, Minus, X } from 'lucide-react';

/**
 * Обложка-галерея: листается пальцем, счётчик «2/6», тап — на весь экран.
 * Одна обложка не отвечает на вопрос «как там будет»; пять живых кадров
 * места — отвечают. Без дополнительных фото ведёт себя как прежняя обложка.
 */
export function HeroGallery({ images, title, children }: { images: string[]; title: string; children?: React.ReactNode }) {
  const [idx, setIdx] = useState(0);
  const [full, setFull] = useState<number | null>(null);
  const track = useRef<HTMLDivElement>(null);
  const many = images.length > 1;
  const onScroll = () => {
    const el = track.current; if (!el) return;
    setIdx(Math.round(el.scrollLeft / Math.max(el.clientWidth, 1)));
  };
  return (
    <div className="relative h-[42vh] min-h-[15rem] sm:h-80 w-full bg-black">
      <div
        ref={track}
        onScroll={onScroll}
        className="flex h-full w-full snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {images.map((src, i) => (
          <img
            key={src + i}
            src={src}
            alt={i ? `${title} — фото ${i + 1}` : title}
            referrerPolicy="no-referrer"
            loading={i ? 'lazy' : 'eager'}
            onClick={() => many && setFull(i)}
            className={`h-full w-full shrink-0 snap-center object-cover brightness-[0.55] select-none ${many ? 'cursor-zoom-in' : 'pointer-events-none'}`}
          />
        ))}
      </div>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#121212] via-[#121212]/30 to-black/50" />
      {many && (
        <>
          <span className="pointer-events-none absolute left-4 top-4 rounded-full bg-black/60 px-2.5 py-1 font-mono text-[10px] font-bold text-white backdrop-blur">
            📸 {idx + 1}/{images.length}
          </span>
          <span className="pointer-events-none absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1">
            {images.map((_, i) => <span key={i} className={`h-1 rounded-full transition-all ${i === idx ? 'w-4 bg-white' : 'w-1 bg-white/40'}`} />)}
          </span>
        </>
      )}
      {/* Название и бейджи поверх фото не кликабельны — свайп проходит сквозь них. */}
      <div className="pointer-events-none absolute inset-0">{children}</div>

      {full !== null && (
        <div className="fixed inset-0 z-[120] flex flex-col bg-black" onClick={() => setFull(null)}>
          <div className="flex items-center justify-between p-4 text-white">
            <span className="font-mono text-xs">{full + 1} / {images.length}</span>
            <button type="button" onClick={() => setFull(null)} className="rounded-full border-0 bg-white/10 p-2 text-white" aria-label="Закрыть"><X className="h-5 w-5" /></button>
          </div>
          <div className="flex flex-1 snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            ref={(el) => { if (el && full !== null) el.scrollLeft = full * el.clientWidth; }}
            onClick={(e) => e.stopPropagation()}>
            {images.map((src, i) => (
              <div key={src + i} className="flex h-full w-full shrink-0 snap-center items-center justify-center p-2">
                <img src={src} alt="" className="max-h-full max-w-full rounded-lg object-contain" />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** «Что включено / не включено» — честные ожидания до записи. */
export function IncludedBlock({ included, notIncluded }: { included: string[]; notIncluded: string[] }) {
  const inc = included.filter(Boolean), not = notIncluded.filter(Boolean);
  if (!inc.length && !not.length) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {inc.length > 0 && (
        <div className="space-y-2 rounded-2xl border border-brand/15 bg-brand/[.04] p-4">
          <span className="block text-[10px] font-mono uppercase tracking-widest text-brand">Что включено</span>
          <ul className="space-y-1.5">
            {inc.map((x, i) => <li key={i} className="flex gap-2 text-sm text-white/85"><Check className="mt-0.5 h-4 w-4 shrink-0 text-brand" />{x}</li>)}
          </ul>
        </div>
      )}
      {not.length > 0 && (
        <div className="space-y-2 rounded-2xl border border-white/10 bg-white/[.03] p-4">
          <span className="block text-[10px] font-mono uppercase tracking-widest text-white/45">Не включено</span>
          <ul className="space-y-1.5">
            {not.map((x, i) => <li key={i} className="flex gap-2 text-sm text-white/65"><Minus className="mt-0.5 h-4 w-4 shrink-0 text-white/35" />{x}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Частые вопросы — раскрывающимся списком, чтобы не писать организатору одно и то же. */
export function FaqBlock({ faq }: { faq: { q: string; a: string }[] }) {
  const list = faq.filter((f) => f.q && f.a);
  const [open, setOpen] = useState<number | null>(null);
  if (!list.length) return null;
  return (
    <div className="space-y-2">
      <span className="block text-[10px] font-mono uppercase tracking-widest text-white/40">Частые вопросы</span>
      <div className="divide-y divide-white/5 overflow-hidden rounded-2xl border border-white/10 bg-white/[.03]">
        {list.map((f, i) => (
          <div key={i}>
            <button type="button" onClick={() => setOpen(open === i ? null : i)}
              className="flex w-full items-center justify-between gap-3 border-0 bg-transparent p-4 text-left text-sm font-bold text-white">
              {f.q}
              <ChevronDown className={`h-4 w-4 shrink-0 text-white/40 transition ${open === i ? 'rotate-180' : ''}`} />
            </button>
            {open === i && <p className="whitespace-pre-wrap px-4 pb-4 text-sm leading-6 text-white/70">{f.a}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Большая поездка: что спрашивают первым — документы, дорога, бюджет. */
export function TripBlock({ trip }: { trip?: { docs?: string; flights?: string; budget?: string } | null }) {
  const rows = [
    ['🛂', 'Документы', trip?.docs],
    ['✈️', 'Как добираемся', trip?.flights],
    ['💰', 'Бюджет на человека', trip?.budget],
  ].filter((r) => r[2]);
  if (!rows.length) return null;
  return (
    <div className="space-y-2 rounded-2xl border border-white/10 bg-white/[.03] p-4">
      <span className="block text-[10px] font-mono uppercase tracking-widest text-white/40">Поездка</span>
      {rows.map(([icon, label, text]) => (
        <div key={label} className="flex gap-3">
          <span className="text-lg leading-6">{icon}</span>
          <div className="min-w-0">
            <span className="block text-[11px] text-white/45">{label}</span>
            <span className="block text-sm text-white/85">{text}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
