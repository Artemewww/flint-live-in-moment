import React, { useEffect, useState } from 'react';
import { getInitData } from '../telegram';

interface RecapItem {
  id: string;
  title: string;
  date: string;
  cover: string;
  videoCount: number;
  photoCount: number;
}

/**
 * «СВЕЖИЕ ИТОГИ» НА ГЛАВНОЙ — истории последних выездов, как в Instagram.
 *
 * Ролики и фото прошедших событий жили только в разделе «История», и туда
 * почти никто не заходил: на главной был лишь анонс будущего. А лучший повод
 * записаться на следующий выезд — увидеть, как прошёл прошлый. Тот же архив
 * (action=archive), без отдельного запроса на сервере.
 */
export default function RecentRecaps({ onOpen }: { onOpen: (id: string) => void }) {
  const [items, setItems] = useState<RecapItem[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/events?action=archive', { headers: { 'X-Telegram-Init-Data': getInitData() } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive) setItems(Array.isArray(j?.items) ? j.items : []); })
      .catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, []);

  // Пусто или не загрузилось — блок не занимает места на главной.
  const list = (items || []).filter((i) => i.cover || i.videoCount || i.photoCount).slice(0, 8);
  if (!list.length) return null;

  return (
    <section aria-label="Свежие итоги выездов" className="pt-3">
      <div className="mb-2 flex items-baseline justify-between px-1">
        <h2 className="font-mono text-[11px] font-bold uppercase tracking-widest text-white/60">Как это было</h2>
        <span className="text-[11px] text-white/40">ролики и фото выездов</span>
      </div>
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 scrollbar-none">
        {list.map((it) => (
          <button
            key={it.id}
            type="button"
            onClick={() => onOpen(it.id)}
            className="flex w-[72px] shrink-0 flex-col items-center gap-1.5 border-none bg-transparent p-0 cursor-pointer"
          >
            <span className={`relative rounded-full p-[2.5px] ${it.videoCount ? 'bg-brand' : 'bg-white/20'}`}>
              <span className="block h-[64px] w-[64px] overflow-hidden rounded-full border-2 border-black bg-white/10">
                {it.cover && <img src={it.cover} alt="" loading="lazy" className="h-full w-full object-cover" />}
              </span>
              {it.videoCount > 0 && (
                <span className="absolute -bottom-0.5 -right-0.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-black bg-brand text-[11px]">🎬</span>
              )}
            </span>
            <span className="line-clamp-2 w-full text-center text-[11px] leading-tight text-white/80">
              {it.title.split(':')[0]}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
