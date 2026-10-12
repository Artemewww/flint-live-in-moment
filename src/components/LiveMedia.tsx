import React, { useEffect, useRef, useState } from 'react';
import { getInitData } from '../telegram';
import { Radio, RefreshCw } from 'lucide-react';

export interface MediaItem {
  id: string;
  media_type: 'photo' | 'video';
  votes: number;
  src: string;
  /** Обложка видео (thumbnail). Приходит с сервера; если её нет — рисуем видео. */
  poster?: string;
}

interface LiveMediaProps {
  /** Идентификатор события (в базе). */
  eventId: string;
  /** Интервал опроса в мс (по умолчанию 12 c — «быстро транслируется»). */
  pollMs?: number;
  /**
   * Событие идёт прямо сейчас. Только тогда лента «живая»: опрос и плашка LIVE.
   * Раньше поллинг шёл всегда, даже у прошедших выездов, — бесконечные запросы
   * и подпись LIVE на ролике полугодовой давности.
   */
  live?: boolean;
  /** Отдаёт загруженный список наверх — карточке не нужен второй такой же запрос. */
  onLoaded?: (items: MediaItem[], galleryUrl?: string | null) => void;
}

const MAX_SHOW = 20;

/**
 * Плитка видео. Раньше здесь стоял <video preload="metadata"> и он выглядел как
 * чёрный квадрат: кадр появляется только после play, а наш прокси не отдаёт
 * Range, поэтому подтянуть превью было нечем. Теперь рисуем обложку-картинку,
 * и если она не загрузилась (старые ролики без thumbnail) — откатываемся на
 * <video>, чтобы плитка не осталась пустой.
 */
function VideoTile({ item }: { item: MediaItem }) {
  const [coverFailed, setCoverFailed] = useState(false);
  if (item.poster && !coverFailed) {
    return <img src={item.poster} alt="" loading="lazy" className="w-full h-full object-cover" onError={() => setCoverFailed(true)} />;
  }
  return <video src={item.src} muted playsInline preload="metadata" className="w-full h-full object-cover" />;
}

/**
 * Живая лента фото/видео события. Тянет медиа через
 * /api/events?action=media_list&id=<id> — файлы отдаются прокси Telegram.
 * Каждый pollMs перечитывает и показывает самые свежие по голосам.
 * Это дешёвый и надёжный способ «стримить» без настроек Supabase Realtime:
 * участник шлёт фото в бота → оно сразу появляется на карточке события.
 */
export default function LiveMedia({ eventId, pollMs = 12000, live = true, onLoaded }: LiveMediaProps) {
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<MediaItem | null>(null);
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    let alive = true;
    let loadedOnce = false;
    const load = async () => {
      try {
        // Заголовок с initData обязателен: список медиа теперь под клубным гейтом.
    const r = await fetch(`/api/events?action=media_list&id=${encodeURIComponent(eventId)}`, { headers: { 'X-Telegram-Init-Data': getInitData() } });
        if (r.ok) {
          const j = await r.json();
          if (alive && Array.isArray(j?.items)) {
            loadedOnce = true;
            setItems(j.items.slice(0, MAX_SHOW));
            onLoadedRef.current?.(j.items, typeof j.galleryUrl === 'string' ? j.galleryUrl : null);
          }
        } else if (alive && !loadedOnce) {
          onLoadedRef.current?.([]); // счётчик в карточке не висит «…» вечно
        }
      } catch {
        // оффлайн — оставляем прошлое; при первой загрузке гасим «…» в счётчике
        if (alive && !loadedOnce) onLoadedRef.current?.([]);
      }
      if (alive) setLoading(false);
    };
    load();
    const t = live ? setInterval(load, pollMs) : undefined;
    return () => { alive = false; if (t) clearInterval(t); };
  }, [eventId, pollMs, live]);

  if (loading) {
    return (
      <div className="px-4 sm:px-6 mt-0.5">
        <div className="flex items-center gap-2 text-white/40 text-[10px] font-mono uppercase tracking-widest">
          <Radio className="w-4 h-4 text-brand/70 animate-pulse" /> {live ? 'Загружаем live…' : 'Загружаем фото и видео…'}
        </div>
      </div>
    );
  }

  if (!items || items.length === 0) return null;

  // У прошедшего события главный ролик — первый в списке видео — показываем
  // крупно, вертикальным плеером: ради него человек и открывает архивную карточку.
  const hero = !live ? items.find((m) => m.media_type === 'video') : undefined;
  const grid = hero ? items.filter((m) => m !== hero) : items;

  return (
    <div className="px-4 sm:px-6 mt-0.5 space-y-2" id={`live-media-${eventId}`}>
      {!live ? (
        <span className="block text-[10px] font-mono uppercase tracking-widest text-brand">
          Фото и видео с события
        </span>
      ) : (
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
      )}

      {hero && (
        <video
          src={hero.src}
          poster={hero.poster}
          controls
          playsInline
          preload="none"
          className="w-full max-h-[70vh] aspect-[9/16] object-cover rounded-xl bg-black border border-white/10"
        />
      )}

      <div className="grid grid-cols-4 gap-1.5">
        {grid.map((m) => (
          <button
            key={m.id}
            onClick={() => setOpen(m)}
            className="relative aspect-square rounded-lg overflow-hidden bg-black cursor-pointer border border-white/10 hover:border-brand/40 transition-all"
          >
            {m.media_type === 'video'
              ? <VideoTile item={m} />
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
            ? <video src={open.src} poster={open.poster} controls autoPlay playsInline className="max-w-full max-h-[85vh]" />
            : <img src={open.src} alt="" className="max-w-full max-h-[85vh]" />}
          <button
            type="button"
            onClick={() => setOpen(null)}
            className="absolute top-4 right-4 w-11 h-11 flex items-center justify-center text-white/70 hover:text-white text-2xl"
            aria-label="Закрыть"
          >✕</button>
        </div>
      )}
    </div>
  );
}