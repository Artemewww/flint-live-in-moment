import { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { X, Play, Calendar, MapPin, Images, Clapperboard, ChevronLeft, ChevronRight, Users } from 'lucide-react';
import { getInitData } from '../telegram';
import { LEGACY_VIDEOS } from '../history';
import Avatar from './Avatar';

interface HistoryItem {
  id: string;
  title: string;
  date: string;
  dateEnd: string | null;
  dateLabel: string;
  location: string;
  cover: string;
  videos: { id: string; src: string; poster: string }[];
  photos: { id: string; src: string }[];
  attendees: { telegramId: number; name: string; avatar: string }[];
  videoCount: number;
  photoCount: number;
  peopleCount: number;
}

interface HistoryStoriesProps {
  onClose: () => void;
}

/** Сколько фото показываем в просмотре: дальше всё равно лента вниз. */
const MAX_PHOTOS = 24;

/**
 * «История сообщества» — АРХИВ ПРОШЕДШИХ МЕРОПРИЯТИЙ ИЗ БАЗЫ.
 *
 * Раньше страница рисовалась по жёсткому списку из src/history.ts — пять
 * пунктов, вписанных руками. Отсюда три жалобы, которые тут и закрываются:
 *
 *  1) ПОРЯДОК. Список не был отсортирован вообще, и «Live in Moment» с датой
 *     «2026» стоял последним. Теперь сортировку делает сервер (date DESC):
 *     самое свежее всегда сверху, и руками его не сдвинуть.
 *  2) СОСТАВ. Bison Race с его галереей в хардкоде не было вообще. Теперь
 *     архив = прошедшие события из той же таблицы, что и афиша: залил
 *     галерею — кадры появились здесь сами.
 *  3) ОБЛОЖКИ. У видео не было превью (тёмный квадрат), а фото были и вовсе
 *     недоступны. Сервер отдаёт готовый poster у каждого ролика, внизу —
 *     сетка фотографий события.
 *
 * Плюс «кружки» — аватарки тех, кто был: событие видно не строкой, а составом.
 */
export default function HistoryStories({ onClose }: HistoryStoriesProps) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // Индекс активного события: null — сетка, иначе полный просмотр.
  const [active, setActive] = useState<number | null>(null);
  /**
   * Три уровня внутри события. Раньше их было два, и ролик открывался сразу на
   * весь экран: он перекрывал шапку, а крестик выкидывал сразу на главную.
   * Теперь сетка → видео → крупный кадр, и назад идём по одному шагу.
   */
  const [view, setView] = useState<'grid' | 'video' | 'photos'>('grid');
  const [videoIdx, setVideoIdx] = useState(0);
  const [photoIdx, setPhotoIdx] = useState<number | null>(null);
  // Подробный список «кто был» — по тапу на кружки.
  const [peopleOpen, setPeopleOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch('/api/events?action=archive', { headers: { 'X-Telegram-Init-Data': getInitData() } })
      .then((r) => (r.ok ? r.json() : Promise.reject(String(r.status))))
      .then((j) => { if (alive) setItems(Array.isArray(j?.items) ? j.items : []); })
      .catch(() => { if (alive) setFailed(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const item = active !== null ? items[active] ?? null : null;

  const go = useCallback((dir: 1 | -1) => {
    if (active === null) return;
    setActive((active + dir + items.length) % items.length);
    setView('grid');
    setVideoIdx(0);
    setPhotoIdx(null);
    setPeopleOpen(false);
  }, [active, items.length]);

  /** Назад к сетке открыток (из просмотра события). */
  const back = () => { setActive(null); setPhotoIdx(null); setVideoIdx(0); setView('grid'); setPeopleOpen(false); };

  /**
   * Крестик идёт НА ОДИН ШАГ НАЗАД, а не сразу закрывает архив.
   * Раньше любой тап по нему отправлял человека на главную: зашёл в историю,
   * посмотрел ролик, закрыл — и пропала сетка открыток вместе с позицией.
   */
  const stepBack = () => {
    if (photoIdx !== null) { setPhotoIdx(null); return; }
    if (peopleOpen) { setPeopleOpen(false); return; }
    if (view !== 'grid') { setView('grid'); return; }
    if (active !== null) { back(); return; }
    onClose();
  };
  const video = item?.videos[videoIdx] || null;

  /**
   * Видео для просмотра с учётом роликов, лежащих файлом в /public (LEGACY_VIDEOS).
   * Сервер их не знает — они никогда не заливались в галерею события. Подставляем
   * только если у события нет своего видео, чтобы свежая загрузка не дублировалась.
   */
  const legacy = item && item.videos.length === 0 ? LEGACY_VIDEOS[item.id] : undefined;
  const activeVideo = video || (legacy ? { id: `legacy-${item!.id}`, src: legacy.src, poster: legacy.poster } : null);
  const videoTotal = item ? item.videos.length + (legacy ? 1 : 0) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center md:p-4" id="history-stories-root">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={active === null ? onClose : back}
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
        {/* Close Button — идёт НА ОДИН ШАГ НАЗАД, а не закрывает архив */}
        <button
          onClick={stepBack}
          className="absolute top-4 right-4 z-40 p-2.5 rounded-full bg-black/70 backdrop-blur border border-white/15 hover:border-brand/40 text-white/80 hover:text-[#E6FD3A] hover:scale-105 transition-all outline-none cursor-pointer"
          aria-label="Назад"
        >
          <X className="w-5 h-5" />
        </button>

        {/* ===== Полный просмотр события ===== */}
        {item && (
          <div className="absolute inset-0 z-20 flex flex-col" id="history-viewer">
            {/**
             * ШАПКА СВЕРХУ. Раньше блок «были · N» висел внизу и перекрывал и
             * ролик, и фотографии. Теперь он наверху, над названием, на
             * полупрозрачной подложке-градиенте: белый текст на светлых кадрах
             * видео иначе не читался.
             */}
            <div className="absolute inset-x-0 top-0 z-30 bg-gradient-to-b from-black/95 via-black/65 to-transparent px-4 pt-4 pb-10">
              <div className="pr-11 min-w-0">
                <div className="text-white font-display font-black text-sm uppercase tracking-tight leading-tight truncate">
                  {item.title}
                </div>
                {item.dateLabel && <div className="text-brand/80 text-[10px] font-mono mt-0.5">{item.dateLabel}</div>}
              </div>
              {item.attendees.length > 0 && (
                <button
                  onClick={() => setPeopleOpen(true)}
                  className="mt-2.5 flex items-center gap-2 max-w-full cursor-pointer group"
                  aria-label={`Кто был на событии — ${item.peopleCount}`}
                >
                  <span className="flex -space-x-2 shrink-0">
                    {item.attendees.slice(0, 6).map((a) => (
                      <span key={a.telegramId} className="w-6 h-6 rounded-full ring-2 ring-black/70 overflow-hidden bg-white/10 flex items-center justify-center">
                        {a.avatar
                          ? <img src={a.avatar} alt="" loading="lazy" className="w-full h-full object-cover" />
                          : <Avatar name={a.name} size={24} />}
                      </span>
                    ))}
                    {item.attendees.length > 6 && (
                      <span className="w-6 h-6 rounded-full ring-2 ring-black/70 bg-black/85 text-white/80 text-[8px] font-mono flex items-center justify-center">
                        +{item.attendees.length - 6}
                      </span>
                    )}
                  </span>
                  <span className="text-[10px] font-mono text-white/60 group-hover:text-brand transition-colors truncate">
                    Были · {item.peopleCount} — состав
                  </span>
                </button>
              )}
            </div>

            {/* ===== Сетка: видео и фото плитками (как лента Instagram) =====
                 Раньше ролик открывался сразу на весь экран и занимал всю
                 высоту, не оставляя места ни шапке, ни выбору. Теперь сначала
                 сетка: тап по ролику — и он открывается. */}
            {view === 'grid' && (
              <div className="absolute inset-0 overflow-y-auto scrollbar-none bg-black px-3 pt-32 pb-20">
                {videoTotal > 0 && (
                  <>
                    <div className="text-[10px] font-mono uppercase tracking-widest text-white/40 mb-2">Видео</div>
                    <div className="grid grid-cols-2 gap-2 mb-6">
                      {(legacy && item.videos.length === 0
                        ? [{ id: `legacy-${item.id}`, src: legacy.src, poster: legacy.poster }]
                        : item.videos
                      ).map((v) => (
                        <button
                          key={v.id}
                          onClick={() => { setVideoIdx(Math.max(0, item.videos.findIndex((x) => x.id === v.id))); setView('video'); }}
                          className="relative aspect-[3/4] rounded-xl overflow-hidden bg-white/5 cursor-pointer group"
                          aria-label="Открыть видео"
                        >
                          {v.poster
                            ? <img src={v.poster} alt="" loading="lazy" className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity" />
                            : <video src={v.src} muted playsInline preload="metadata" className="w-full h-full object-cover" />}
                          <span className="absolute inset-0 flex items-center justify-center">
                            <span className="w-11 h-11 rounded-full bg-black/60 backdrop-blur border border-white/20 flex items-center justify-center text-white">
                              <Play className="w-5 h-5 ml-0.5" />
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {item.photos.length > 0 && (
                  <>
                    <div className="text-[10px] font-mono uppercase tracking-widest text-white/40 mb-2">Фото</div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {item.photos.slice(0, MAX_PHOTOS).map((p, i) => (
                        <button
                          key={p.id}
                          onClick={() => setPhotoIdx(i)}
                          className="aspect-square overflow-hidden rounded-lg bg-white/5 cursor-pointer"
                          aria-label={`Фото ${i + 1}`}
                        >
                          <img src={p.src} alt="" loading="lazy" className="w-full h-full object-cover" />
                        </button>
                      ))}
                    </div>
                    {item.photos.length > MAX_PHOTOS && (
                      <div className="text-center text-white/40 text-[10px] font-mono mt-3">
                        показаны первые {MAX_PHOTOS} из {item.photos.length}
                      </div>
                    )}
                  </>
                )}
                {videoTotal === 0 && item.photos.length === 0 && item.cover && (
                  <img src={item.cover} alt={item.title} className="w-full rounded-xl opacity-80" />
                )}
                {videoTotal === 0 && item.photos.length === 0 && !item.cover && (
                  <div className="text-white/40 text-xs font-mono py-10 text-center">
                    По этому событию пока нет ни видео, ни фотографий.
                  </div>
                )}
              </div>
            )}

            {view === 'video' && activeVideo && (
              <>
                <motion.video
                  key={activeVideo.id}
                  src={activeVideo.src}
                  poster={activeVideo.poster}
                  playsInline
                  controls
                  autoPlay
                  preload="metadata"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="absolute inset-0 w-full h-full object-contain bg-black"
                />
                {/* Кнопка «назад к сетке» прямо на ролике */}
                <button
                  onClick={() => setView('grid')}
                  className="absolute bottom-5 left-1/2 -translate-x-1/2 z-30 px-4 py-2 rounded-full bg-black/70 backdrop-blur border border-white/15 text-white/85 text-[10px] font-mono font-bold tracking-widest hover:bg-white/15 transition-colors cursor-pointer"
                >
                  ← К СЕТКЕ
                </button>
              </>
            )}

            {/* Ни видео, ни фото — показываем обложку, а не пустоту */}
            {view === 'grid' && videoTotal === 0 && item.photos.length === 0 && item.cover && (
              <img src={item.cover} alt={item.title} className="absolute inset-0 w-full h-full object-cover opacity-60" />
            )}

            {/* Крупный кадр поверх всего */}
            {photoIdx !== null && item.photos[photoIdx] && (
              <button
                onClick={() => setPhotoIdx(null)}
                className="absolute inset-0 z-40 flex items-center justify-center bg-black/95 cursor-pointer"
                aria-label="Закрыть кадр"
              >
                <img src={item.photos[photoIdx].src} alt="" className="max-w-full max-h-full object-contain" />
              </button>
            )}

            {/* Ни видео, ни фото — показываем обложку, а не пустоту */}
            {view === 'grid' && videoTotal === 0 && item.photos.length === 0 && item.cover && (
              <img src={item.cover} alt={item.title} className="absolute inset-0 w-full h-full object-cover opacity-60" />
            )}

            {/* Подробный состав — по тапу на кружки в шапке */}
            {peopleOpen && (
              <button
                onClick={() => setPeopleOpen(false)}
                className="absolute inset-0 z-40 bg-black/80 backdrop-blur-sm cursor-pointer"
                aria-label="Закрыть состав"
              />
            )}
            {peopleOpen && (
              <div className="absolute inset-x-3 bottom-3 z-50 bg-[#171717] border border-white/12 rounded-2xl p-4 max-h-[60vh] overflow-y-auto scrollbar-none">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-brand flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5" /> Были · {item.peopleCount}
                  </div>
                  <button
                    onClick={() => setPeopleOpen(false)}
                    className="p-1.5 rounded-full bg-white/10 text-white/70 hover:text-white transition-colors cursor-pointer"
                    aria-label="Закрыть"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {item.attendees.map((a) => (
                    <div key={a.telegramId} className="flex items-center gap-2 bg-white/5 rounded-xl px-2 py-1.5 min-w-0">
                      {a.avatar
                        ? <img src={a.avatar} alt="" loading="lazy" className="w-8 h-8 rounded-full object-cover shrink-0" />
                        : <Avatar name={a.name} size={32} />}
                      <span className="text-xs text-white/85 truncate">{a.name || 'Участник'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Стрелки навигации по событиям */}
            {items.length > 1 && (
              <>
                <button
                  onClick={() => go(-1)}
                  className="absolute bottom-6 left-4 z-30 p-2.5 rounded-full bg-black/70 backdrop-blur border border-white/15 text-white cursor-pointer hover:bg-black/90"
                  aria-label="Предыдущее событие"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button
                  onClick={() => go(1)}
                  className="absolute bottom-6 right-4 z-30 p-2.5 rounded-full bg-black/70 backdrop-blur border border-white/15 text-white cursor-pointer hover:bg-black/90"
                  aria-label="Следующее событие"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </>
            )}
          </div>
        )}

        {/* ===== Сетка открыток ===== */}
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

            {/* Открытки: свежайшая первой — порядок гарантирует сервер (date DESC) */}
            <div className="grid grid-cols-1 gap-4">
              {loading && (
                <div className="text-white/50 text-xs font-mono py-8 text-center">Загружаю историю…</div>
              )}
              {!loading && failed && (
                <div className="text-white/50 text-xs font-mono py-8 text-center">
                  Не удалось загрузить архив. Открой приложение ещё раз.
                </div>
              )}
              {!loading && !failed && items.length === 0 && (
                <div className="text-white/50 text-xs font-mono py-8 text-center">
                  Здесь появятся прошедшие события клуба.
                </div>
              )}
              {items.map((h, i) => (
                <button
                  key={h.id}
                  onClick={() => { setActive(i); setView('grid'); setVideoIdx(0); setPhotoIdx(null); setPeopleOpen(false); }}
                  className="relative w-full h-44 sm:h-52 overflow-hidden rounded-2xl text-left transition-transform cursor-pointer group shadow-lg shadow-black/40"
                  aria-label={`Открыть ${h.title}`}
                >
                  {h.cover ? (
                    <img
                      src={h.cover}
                      alt={h.title}
                      loading="lazy"
                      className="absolute inset-0 w-full h-full object-cover brightness-[0.7] group-hover:brightness-[0.85] transition-all"
                    />
                  ) : (
                    <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-black/60" />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />

                  {/* Кнопка play — только если ролик действительно есть */}
                  {(h.videoCount > 0 || LEGACY_VIDEOS[h.id]) && (
                    <span className="absolute inset-0 flex items-center justify-center">
                      <span className="w-16 h-16 flex items-center justify-center rounded-full bg-brand text-black shadow-xl shadow-brand/30 transition-transform group-hover:scale-110">
                        <Play className="w-7 h-7 ml-0.5" />
                      </span>
                    </span>
                  )}

                  {/* Счётчики: что вообще можно посмотреть у этого события */}
                  <span className="absolute top-3 right-3 flex flex-col items-end gap-1.5">
                    {h.videoCount > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-black/70 px-2 py-1 text-[10px] font-mono text-white/85 border border-white/10">
                        <Clapperboard className="w-3.5 h-3.5" /> {h.videoCount}
                      </span>
                    )}
                    {h.photoCount > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-black/70 px-2 py-1 text-[10px] font-mono text-white/85 border border-white/10">
                        <Images className="w-3.5 h-3.5" /> {h.photoCount}
                      </span>
                    )}
                  </span>

                  {/* Кружки тех, кто был — состав виден прямо на открытке */}
                  {h.attendees.length > 0 && (
                    <span className="absolute top-3 left-3 flex -space-x-2">
                      {h.attendees.slice(0, 5).map((a) => (
                        <span key={a.telegramId} className="w-7 h-7 rounded-full ring-2 ring-black/60 overflow-hidden bg-white/10 flex items-center justify-center">
                          {a.avatar
                            ? <img src={a.avatar} alt="" loading="lazy" className="w-full h-full object-cover" />
                            : <Avatar name={a.name} size={28} />}
                        </span>
                      ))}
                      {h.attendees.length > 5 && (
                        <span className="w-7 h-7 rounded-full ring-2 ring-black/60 bg-black/80 text-white/80 text-[9px] font-mono flex items-center justify-center">
                          +{h.attendees.length - 5}
                        </span>
                      )}
                    </span>
                  )}

                  {/* Подпись: дата, место, название */}
                  <div className="absolute bottom-0 left-0 right-0 p-3">
                    {h.dateLabel && (
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] font-mono">
                        <span className="inline-flex items-center gap-1 text-brand">
                          <Calendar className="w-3 h-3" /> {h.dateLabel}
                        </span>
                        {h.location && (
                          <span className="inline-flex items-center gap-1 text-white/60">
                            <MapPin className="w-3 h-3" /> {h.location}
                          </span>
                        )}
                      </div>
                    )}
                    <div className="font-display font-black text-lg uppercase tracking-tight text-white leading-tight mt-0.5">
                      {h.title}
                    </div>
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