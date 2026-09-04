import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { X, Play, Clapperboard } from 'lucide-react';
import { HISTORY } from '../history';
import type { CommunityEvent } from '../types';

interface HistoryStoriesProps {
  /** События из афиши (для живой подгрузки их медиа в историю). */
  events?: CommunityEvent[];
  onClose: () => void;
}

/**
 * «История сообщества» — вертикальная лента видео в духе сторис/Reels.
 * Сверху — ряд превью-кружков (тайтлы), по клику открывается полный
 * вертикальный просмотр видео с возможностью листать стрелками.
 */
export default function HistoryStories({ events, onClose }: HistoryStoriesProps) {
  // Индекс активной истории: null — режим «ленты», иначе полный просмотр.
  const [active, setActive] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  /** Открытое live-медиа на весь экран. */
  const [openLive, setOpenLive] = useState<{ src: string; title: string; type: string } | null>(null);

  // Живая история: события, у которых в боте есть медиа (отсортированы по числу голосов).
  const [live, setLive] = useState<Array<{ title: string; src: string; votes: number; type: string }>>([]);
  useEffect(() => {
    if (!events || events.length === 0) return;
    let alive = true;
    const seen = new Set<string>();
    const out: Array<{ title: string; src: string; votes: number; type: string }> = [];
    const loadAll = () => Promise.all(events.map(async (ev) => {
      try {
        const r = await fetch(`/api/events?action=media_list&id=${encodeURIComponent(ev.id)}`);
        if (!r.ok) return;
        const j = await r.json();
        const items = Array.isArray(j?.items) ? j.items : [];
        for (const m of items.slice(0, 3)) {
          if (seen.has(m.id)) continue;
          seen.add(m.id);
          out.push({ title: ev.title, src: m.src, votes: m.votes, type: m.media_type });
        }
      } catch { /* нет сети — пропускаем */ }
    }));
    loadAll().then(() => { if (alive) setLive(out); });
    return () => { alive = false; };
  }, [events]);

  const go = (dir: 1 | -1) => {
    if (active === null) return;
    setPlaying(false);
    const next = (active + dir + HISTORY.length) % HISTORY.length;
    setActive(next);
    setMuted(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center md:p-4" id="history-stories-root">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={active === null ? onClose : () => setActive(null)}
        className="absolute inset-0 bg-black/90 backdrop-blur-md"
      />

      {/* Modal */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 30 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 30 }}
        transition={{ type: 'spring', damping: 25, stiffness: 350 }}
        className="bg-[#121212] md:rounded-3xl w-full max-w-md shadow-2xl relative z-10 md:border md:border-white/10 flex flex-col h-[100dvh] md:h-auto md:max-h-[90vh] text-white overflow-hidden"
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-30 p-2.5 rounded-full bg-black/60 border border-white/10 hover:border-brand/40 text-white/70 hover:text-[#E6FD3A] hover:scale-105 transition-all outline-none cursor-pointer"
          aria-label="Закрыть историю"
        >
          <X className="w-5 h-5" />
        </button>

        {/* ===== Фуллскрин-просмотр одной истории ===== */}
        {active !== null && (
          <div className="absolute inset-0 z-20 flex flex-col" id="history-viewer">
            <div className="absolute top-4 left-4 z-30 flex items-center gap-2">
              <span className="text-2xl">{HISTORY[active].emoji}</span>
              <div>
                <div className="text-white font-display font-black text-sm uppercase tracking-tight">{HISTORY[active].title}</div>
                {HISTORY[active].caption && (
                  <div className="text-white/50 text-[10px] font-mono">{HISTORY[active].caption}</div>
                )}
              </div>
            </div>

            {/* Видео */}
            <motion.video
              key={HISTORY[active].id}
              id="history-active-video"
              src={HISTORY[active].src}
              poster={HISTORY[active].poster}
              playsInline
              loop
              preload="auto"
              muted={muted}
              controls
              autoPlay={false}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onClick={(e) => {
                const v = e.target as HTMLVideoElement;
                if (v.paused) { void v.play(); } else { v.pause(); }
              }}
              className="absolute inset-0 w-full h-full object-contain bg-black cursor-pointer"
            />

            {/* Затемнение для читаемости UI поверх видео */}
            <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/70 to-transparent pointer-events-none" />

            {/* Mute toggle */}
            <button
              onClick={() => {
                const v = document.getElementById('history-active-video') as HTMLVideoElement | null;
                if (v) { v.muted = !v.muted; setMuted(v.muted); }
              }}
              className="absolute bottom-6 left-4 z-30 p-2.5 rounded-full bg-black/60 border border-white/10 text-white text-lg cursor-pointer hover:bg-black/80"
              aria-label={muted ? 'Включить звук' : 'Выключить звук'}
            >
              {muted ? '🔇' : '🔊'}
            </button>

            {/* Стрелки навигации */}
            <button onClick={() => go(-1)} className="absolute bottom-6 right-16 z-30 p-2.5 rounded-full bg-black/60 border border-white/10 text-white cursor-pointer hover:bg-black/80" aria-label="Предыдущая история">
              ‹
            </button>
            <button onClick={() => go(1)} className="absolute bottom-6 right-4 z-30 p-2.5 rounded-full bg-black/60 border border-white/10 text-white cursor-pointer hover:bg-black/80" aria-label="Следующая история">
              ›
            </button>
          </div>
        )}

        {/* ===== Лента-превью (режим по умолчанию) ===== */}
        {active === null && (
          <div className="overflow-y-auto w-full flex-grow scrollbar-none p-4 sm:p-6 space-y-6">
            {/* Header */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Clapperboard className="w-5 h-5 text-brand" />
                <span className="text-[10px] uppercase font-mono font-bold tracking-widest text-brand">
                  История сообщества
                </span>
              </div>
              <h2 className="font-display font-black text-2xl uppercase tracking-tight text-white">
                События на видео
              </h2>
              <p className="text-white/60 text-xs font-sans">
                Наши прошедшие выезды и встречи — одним движением по плей.
              </p>
            </div>

            {/* Ряд превью-историй */}
            <div className="flex gap-3 overflow-x-auto scrollbar-none py-1" id="history-preview-row">
              {HISTORY.map((h, i) => (
                <button
                  key={h.id}
                  onClick={() => { setActive(i); setPlaying(false); setMuted(false); }}
                  className="shrink-0 flex flex-col items-center gap-1.5 w-20"
                  aria-label={h.title}
                >
                  <span className="w-16 h-16 rounded-full flex items-center justify-center text-2xl bg-brand/10 border-2 border-brand/40 hover:bg-brand/25 transition-all cursor-pointer">
                    {h.emoji}
                  </span>
                  <span className="text-white/70 text-[9px] font-mono uppercase tracking-widest text-center w-full leading-tight truncate">
                    {h.title}
                  </span>
                </button>
              ))}
            </div>

            {/* Живая история: медиа событий, сданные участниками в бота.
                Появляются, как только организатор/участник отправил фото. */}
            {live.length > 0 && (
              <div className="space-y-2" id="history-live-block">
                <span className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-brand">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-brand"></span>
                  </span>
                  Свежие фото с событий
                </span>
                <div className="flex gap-2.5 overflow-x-auto scrollbar-none py-1">
                  {live.map((m) => (
                    <button
                      key={m.src}
                      onClick={() => setOpenLive({ ...m, src: m.src })}
                      className="shrink-0 w-24 h-32 rounded-xl overflow-hidden bg-black border border-white/10 hover:border-brand/40 transition-all cursor-pointer relative"
                      aria-label={m.title}
                    >
                      {m.type === 'video'
                        ? <video src={m.src} muted playsInline preload="metadata" className="w-full h-full object-cover" />
                        : <img src={m.src} alt="" loading="lazy" className="w-full h-full object-cover" />}
                      <span className="absolute inset-x-0 bottom-0 bg-black/75 text-left px-1.5 py-0.5 text-white/90 text-[8px] font-mono truncate">
                        {m.title}{m.votes > 0 ? ` · ${m.votes}❤️` : ''}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Карточка-подсказка */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4 flex items-start gap-3">
              <Play className="w-5 h-5 text-brand shrink-0" />
              <div>
                <p className="text-white text-xs font-bold">Как смотреть</p>
                <p className="text-white/50 text-[10px] mt-0.5">
                  Нажми на кружок выше — откроется полный просмотр.
                  Видео идёт без звука, пока не нажмёшь play, чтобы не мешать.
                </p>
              </div>
            </div>
          </div>
        )}

          {/* Лайтбокс для живых фото с событий */}
          {openLive && (
            <div className="fixed inset-0 z-[70] bg-black/95 flex items-center justify-center" onClick={() => setOpenLive(null)}>
              {openLive.type === 'video'
                ? <video src={openLive.src} controls autoPlay playsInline className="max-w-full max-h-[85vh]" />
                : <img src={openLive.src} alt={openLive.title} className="max-w-full max-h-[85vh]" />}
              <span className="absolute top-4 right-5 text-white/70 text-2xl cursor-pointer" aria-label="Закрыть">✕</span>
              <span className="absolute bottom-4 left-5 text-white/80 text-xs font-mono">{openLive.title}</span>
            </div>
          )}
      </motion.div>
    </div>
  );
}