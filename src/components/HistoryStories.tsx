import { useState } from 'react';
import { motion } from 'motion/react';
import { X, Play, Calendar, MapPin, Images, Clapperboard, ChevronLeft, ChevronRight } from 'lucide-react';
import { HISTORY } from '../history';

interface HistoryStoriesProps {
  onClose: () => void;
}

/**
 * «История сообщества» — архив прошедших мероприятий открытками-обложками.
 * Каждая карточка: обложка-постер с датой/местом, кнопка play и значок фото —
 * по клику открывается полный просмотр видео (и галерея фото, если есть у события).
 */
export default function HistoryStories({ onClose }: HistoryStoriesProps) {
  // Индекс активного события: null — сетка, иначе полный просмотр.
  const [active, setActive] = useState<number | null>(null);
  const [view, setView] = useState<'video' | 'photos'>('video');
  const [photoIdx, setPhotoIdx] = useState(0);

  const item = active !== null ? HISTORY[active] : null;

  const go = (dir: 1 | -1) => {
    if (active === null) return;
    setActive((active + dir + HISTORY.length) % HISTORY.length);
    setView('video');
    setPhotoIdx(0);
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
        className="bg-[#121212] md:rounded-3xl w-full max-w-lg shadow-2xl relative z-10 md:border md:border-white/10 flex flex-col h-[100dvh] md:h-auto md:max-h-[90vh] text-white overflow-hidden"
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-30 p-2.5 rounded-full bg-black/60 border border-white/10 hover:border-brand/40 text-white/70 hover:text-[#E6FD3A] hover:scale-105 transition-all outline-none cursor-pointer"
          aria-label="Закрыть историю"
        >
          <X className="w-5 h-5" />
        </button>

        {/* ===== Полный просмотр события: видео ===== */}
        {item && view === 'video' && (
          <div className="absolute inset-0 z-20 flex flex-col" id="history-viewer">
            <div className="absolute top-16 left-4 z-30 flex items-center gap-2 right-14">
              <span className="text-2xl">{item.emoji}</span>
              <div>
                <div className="text-white font-display font-black text-sm uppercase tracking-tight">{item.title}</div>
                {item.caption && <div className="text-white/50 text-[10px] font-mono">{item.caption}</div>}
              </div>
            </div>

            {/* Видео */}
            <motion.video
              key={`${item.id}-video`}
              src={item.src}
              poster={item.poster}
              playsInline
              loop
              preload="auto"
              controls
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute inset-0 w-full h-full object-contain bg-black"
            />

            {/* Стрелки навигации по событиям */}
            <button onClick={() => go(-1)} className="absolute bottom-6 right-16 z-30 p-2.5 rounded-full bg-black/60 border border-white/10 text-white cursor-pointer hover:bg-black/80" aria-label="Предыдущее событие">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button onClick={() => go(1)} className="absolute bottom-6 right-4 z-30 p-2.5 rounded-full bg-black/60 border border-white/10 text-white cursor-pointer hover:bg-black/80" aria-label="Следующее событие">
              <ChevronRight className="w-5 h-5" />
            </button>

            {/* Переключение на фото, если есть */}
            {item.hasPhotos && (
              <button
                onClick={() => setView('photos')}
                className="absolute bottom-6 left-4 z-30 inline-flex items-center gap-1.5 p-2.5 rounded-full bg-black/60 border border-white/10 text-white cursor-pointer hover:bg-black/80"
                aria-label="Смотреть фото"
              >
                <Images className="w-5 h-5" />
              </button>
            )}
          </div>
        )}

        {/* ===== Полный просмотр события: фото ===== */}
        {item && view === 'photos' && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black" id="history-photos">
            <div className="absolute top-16 left-4 z-30 flex items-center gap-2 right-14">
              <span className="text-2xl">{item.emoji}</span>
              <div className="text-white font-display font-black text-sm uppercase tracking-tight">{item.title} — фото</div>
            </div>

            {item.photos && item.photos.length > 0 ? (
              <img
                key={`${item.id}-photo-${photoIdx}`}
                src={item.photos[photoIdx]}
                alt={`${item.title} фото`}
                className="w-full h-full object-contain"
              />
            ) : (
              <p className="text-white/50 text-xs">Фото скоро появятся</p>
            )}

            <div className="absolute bottom-6 left-4 z-30 flex items-center gap-2">
              <button
                onClick={() => setPhotoIdx((photoIdx - 1 + (item.photos?.length || 1)) % (item.photos?.length || 1))}
                className="p-2.5 rounded-full bg-black/60 border border-white/10 text-white cursor-pointer hover:bg-black/80"
                aria-label="Назад фото"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <span className="text-white/60 text-xs font-mono">
                {item.photos?.length ? `${photoIdx + 1} / ${item.photos.length}` : ''}
              </span>
              <button
                onClick={() => setPhotoIdx((photoIdx + 1) % (item.photos?.length || 1))}
                className="p-2.5 rounded-full bg-black/60 border border-white/10 text-white cursor-pointer hover:bg-black/80"
                aria-label="Вперёд фото"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>

            <button
              onClick={() => setView('video')}
              className="absolute bottom-6 right-4 z-30 inline-flex items-center gap-1.5 p-2.5 rounded-full bg-black/60 border border-white/10 text-white cursor-pointer hover:bg-black/80"
              aria-label="Смотреть видео"
            >
              <Play className="w-5 h-5" />
            </button>
          </div>
        )}
{/* ===== Сетка обложек-открыток ===== */}
        {active === null && (
          <div className="overflow-y-auto w-full flex-grow scrollbar-none p-4 sm:p-5 space-y-4">
            {/* Header */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Clapperboard className="w-5 h-5 text-brand" />
                <span className="text-[10px] uppercase font-mono font-bold tracking-widest text-brand">
                  История сообщества
                </span>
              </div>
              <h2 className="font-display font-black text-2xl uppercase tracking-tight text-white">
                Наши мероприятия
              </h2>
              <p className="text-white/60 text-xs font-sans">
                Прошедшие события FLINT — выбери, что посмотреть.
              </p>
            </div>

            {/* Открытки */}
            <div className="grid grid-cols-1 gap-4">
              {HISTORY.map((h, i) => (
                <button
                  key={h.id}
                  onClick={() => { setActive(i); setView('video'); setPhotoIdx(0); }}
                  className="relative w-full h-44 sm:h-52 overflow-hidden rounded-2xl text-left transition-transform cursor-pointer group shadow-lg shadow-black/40"
                  aria-label={`Открыть ${h.title}`}
                >
                  <img
                    src={h.poster || h.src}
                    alt={h.title}
                    className="absolute inset-0 w-full h-full object-cover brightness-[0.7] group-hover:brightness-[0.85] transition-all"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />

                  {/* Акцент-иконка темы */}
                  <span className="absolute top-3 left-3 text-xl drop-shadow">{h.emoji}</span>

                  {/* Кнопка play по центру */}
                  <span className="absolute inset-0 flex items-center justify-center">
                    <span className="w-16 h-16 flex items-center justify-center rounded-full bg-brand text-black shadow-xl shadow-brand/30 transition-transform group-hover:scale-110">
                      <Play className="w-7 h-7 ml-0.5" />
                    </span>
                  </span>

                  {/* Значок фото, если есть */}
                  {h.hasPhotos && (
                    <span className="absolute top-3 right-3 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-[10px] font-mono text-white/80 border border-white/10">
                      <Images className="w-3.5 h-3.5" /> фото
                    </span>
                  )}

                  {/* Подпись: дата, место, описание */}
                  <div className="absolute bottom-0 left-0 right-0 p-3">
                    {h.date && (
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] font-mono">
                        <span className="inline-flex items-center gap-1 text-brand">
                          <Calendar className="w-3 h-3" /> {h.date}
                        </span>
                        {h.place && (
                          <span className="inline-flex items-center gap-1 text-white/60">
                            <MapPin className="w-3 h-3" /> {h.place}
                          </span>
                        )}
                      </div>
                    )}
                    <div className="font-display font-black text-lg uppercase tracking-tight text-white leading-tight mt-0.5">
                      {h.title}
                    </div>
                    {h.caption && (
                      <div className="text-white/70 text-[11px] font-sans mt-0.5 truncate">{h.caption}</div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

      </motion.div>
    </div>
  );
}