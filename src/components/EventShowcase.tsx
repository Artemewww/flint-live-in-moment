import React, { useState } from 'react';
import { Check, ChevronDown, ChevronLeft, ChevronRight, Minus, X } from 'lucide-react';

/**
 * Обложка + фото места.
 * Раньше фото листались свайпом прямо по обложке — владелец: «человек не
 * поймёт, что так листать надо». Теперь обложка неподвижна, а под ней ряд
 * миниатюр: сразу видно, что фото несколько. Тап по миниатюре открывает
 * просмотр со стрелками «‹ ›» и счётчиком.
 */
export function HeroGallery({ images, title, children }: { images: string[]; title: string; children?: React.ReactNode }) {
  const [full, setFull] = useState<number | null>(null);
  const cover = images[0];
  const extra = images.slice(1);
  const go = (d: number) => setFull((i) => (i === null ? i : (i + d + images.length) % images.length));
  return (
    <>
      <div className="relative h-[42vh] min-h-[15rem] sm:h-80 w-full bg-black">
        {cover && (
          <img
            src={cover}
            alt={title}
            referrerPolicy="no-referrer"
            onClick={() => extra.length && setFull(0)}
            className={`h-full w-full object-cover brightness-[0.55] select-none ${extra.length ? 'cursor-zoom-in' : 'pointer-events-none'}`}
          />
        )}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#121212] via-[#121212]/30 to-black/50" />
        {/* Название и бейджи поверх фото не кликабельны — тап проходит к обложке. */}
        <div className="pointer-events-none absolute inset-0">{children}</div>
      </div>

      {extra.length > 0 && (
        <div className="px-4 pt-3 sm:px-6">
          <div className="flex items-center justify-between pb-2">
            <span className="text-[10px] font-mono uppercase tracking-widest text-white/45">📸 Фото места · {images.length}</span>
            <button type="button" onClick={() => setFull(0)} className="border-0 bg-transparent p-0 text-[11px] font-bold text-brand">Смотреть все</button>
          </div>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {images.map((src, i) => (
              <button key={src + i} type="button" onClick={() => setFull(i)}
                className="relative h-[72px] w-[72px] shrink-0 overflow-hidden rounded-xl border border-white/10 bg-white/5 p-0">
                <img src={src} alt={`${title} — фото ${i + 1}`} loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}

      {full !== null && (
        <div className="fixed inset-0 z-[120] flex flex-col bg-black" onClick={() => setFull(null)}>
          <div className="flex items-center justify-between p-4 text-white" onClick={(e) => e.stopPropagation()}>
            <span className="font-mono text-sm">{full + 1} / {images.length}</span>
            <button type="button" onClick={() => setFull(null)} className="rounded-full border-0 bg-white/10 p-2 text-white" aria-label="Закрыть"><X className="h-5 w-5" /></button>
          </div>
          <div className="relative flex flex-1 items-center justify-center p-2" onClick={(e) => e.stopPropagation()}>
            <img src={images[full]} alt="" className="max-h-full max-w-full rounded-lg object-contain" />
            {images.length > 1 && (
              <>
                <button type="button" onClick={() => go(-1)} aria-label="Предыдущее фото"
                  className="absolute left-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border-0 bg-white/15 text-white backdrop-blur"><ChevronLeft className="h-6 w-6" /></button>
                <button type="button" onClick={() => go(1)} aria-label="Следующее фото"
                  className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border-0 bg-white/15 text-white backdrop-blur"><ChevronRight className="h-6 w-6" /></button>
              </>
            )}
          </div>
          <div className="flex justify-center gap-1.5 overflow-x-auto p-3" onClick={(e) => e.stopPropagation()}>
            {images.map((src, i) => (
              <button key={src + i} type="button" onClick={() => setFull(i)}
                className={`h-12 w-12 shrink-0 overflow-hidden rounded-lg border-2 p-0 ${i === full ? 'border-brand' : 'border-transparent opacity-60'}`}>
                <img src={src} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}
    </>
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

/**
 * Яндекс-карта точки, куда едем — записавшимся (место сбора и точку выезда
 * видят только участники). Встроенная карта с меткой + кнопка «Маршрут»
 * в приложении Яндекс Карт. Нет координат — ищем по адресу.
 */
export function YandexMapBlock({ lat, lng, place }: { lat?: number; lng?: number; place?: string }) {
  const has = !!lat && !!lng;
  if (!has && !place) return null;
  const widget = has
    ? `https://yandex.ru/map-widget/v1/?ll=${lng},${lat}&z=14&pt=${lng},${lat},pm2rdm`
    : `https://yandex.ru/map-widget/v1/?text=${encodeURIComponent(place || '')}&z=13`;
  const open = has
    ? `https://yandex.ru/maps/?ll=${lng},${lat}&z=16&pt=${lng},${lat},pm2rdm`
    : `https://yandex.ru/maps/?text=${encodeURIComponent(place || '')}`;
  const route = has ? `https://yandex.ru/maps/?rtext=~${lat},${lng}&rtt=auto` : open;
  return (
    <div className="space-y-2">
      <span className="text-white/40 uppercase text-[9px] tracking-wider block">Куда едем</span>
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-black">
        <iframe src={widget} title="Яндекс Карта — место события" loading="lazy" className="block h-56 w-full border-0" allowFullScreen />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <a href={route} target="_blank" rel="noopener noreferrer" className="rounded-xl bg-brand py-2.5 text-center text-[11px] font-black uppercase text-black no-underline">🧭 Маршрут</a>
        <a href={open} target="_blank" rel="noopener noreferrer" className="rounded-xl border border-white/15 py-2.5 text-center text-[11px] font-bold uppercase text-white/80 no-underline">Открыть карту</a>
      </div>
      {place && <p className="text-[11px] text-white/50">{place}</p>}
    </div>
  );
}
