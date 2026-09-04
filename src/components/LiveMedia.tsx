import React, { useEffect, useState } from 'react';
import { Radio, RefreshCw } from 'lucide-react';

interface MediaItem {
  id: string;
  media_type: 'photo' | 'video';
  votes: number;
  src: string;
}

interface LiveMediaProps {
  /** Идентификатор события (в базе). */
  eventId: string;
  /** Интервал опроса в мс (по умолчанию 12 c — «быстро транслируется»). */
  pollMs?: number;
}

const MAX_SHOW = 20;

/**
 * Живая лента фото/видео события. Тянет медиа через
 * /api/events?action=media_list&id=<id> — файлы отдаются прокси Telegram.
 * Каждый pollMs перечитывает и показывает самые свежие по голосам.
 * Это дешёвый и надёжный способ «стримить» без настроек Supabase Realtime:
 * участник шлёт фото в бота → оно сразу появляется на карточке события.
 */
export default function LiveMedia({ eventId, pollMs = 12000 }: LiveMediaProps) {
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<MediaItem | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(`/api/events?action=media_list&id=${encodeURIComponent(eventId)}`);
        if (r.ok) {
          const j = await r.json();
          if (alive && Array.isArray(j?.items)) setItems(j.items.slice(0, MAX_SHOW));
        }
      } catch { /* оффлайн — оставляем прошлое */ }
      if (alive) setLoading(false);
    };
    load();
    const t = setInterval(load, pollMs);
    return () => { alive = false; clearInterval(t); };
  }, [eventId, pollMs]);

  if (loading) {
    return (
      <div className="px-4 sm:px-6 mt-0.5">
        <div className="flex items-center gap-2 text-white/40 text-[10px] font-mono uppercase tracking-widest">
          <Radio className="w-4 h-4 text-brand/70 animate-pulse" /> Загружаем live…
        </div>
      </div>
    );
  }

  if (!items || items.length === 0) return null;

  return (
    <div className="px-4 sm:px-6 mt-0.5 space-y-2" id={`live-media-${eventId}`}>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-brand">
          <Radio className="w-4 h-4 animate-pulse" />
          <span className="flex items-center gap-1.5">
            LIVE · фото с события
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-brand"></span>
            </span>
          </span>
        </span>
        <span className="text-white/35 text-[9px] font-mono flex items-center gap-1"><RefreshCw className="w-3 h-3" /> авто</span>
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        {items.map((m) => (
          <button
            key={m.id}
            onClick={() => setOpen(m)}
            className="relative aspect-square rounded-lg overflow-hidden bg-black cursor-pointer border border-white/10 hover:border-brand/40 transition-all"
          >
            {m.media_type === 'video'
              ? <video src={m.src} muted playsInline preload="metadata" className="w-full h-full object-cover" />
              : <img src={m.src} alt="" loading="lazy" className="w-full h-full object-cover" />}
            {m.media_type === 'video' && (
              <span className="absolute inset-0 flex items-center justify-center text-white/90 text-lg pointer-events-none">▶</span>
            )}
            {m.votes > 0 && (
              <span className="absolute bottom-0.5 right-1 text-[9px] font-mono text-white/80 shadow">{m.votes}❤️</span>
            )}
          </button>
        ))}
      </div>

      {open && (
        <div className="fixed inset-0 z-[60] bg-black/95 flex items-center justify-center" onClick={() => setOpen(null)}>
          {open.media_type === 'video'
            ? <video src={open.src} controls autoPlay playsInline className="max-w-full max-h-[85vh]" />
            : <img src={open.src} alt="" className="max-w-full max-h-[85vh]" />}
          <span className="absolute top-4 right-5 text-white/70 text-2xl cursor-pointer" aria-label="Закрыть">✕</span>
        </div>
      )}
    </div>
  );
}