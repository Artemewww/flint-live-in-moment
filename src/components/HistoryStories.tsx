import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Play, MapPin, Clapperboard, ChevronLeft, ChevronRight, Users, Images, Film } from 'lucide-react';
import { getInitData } from '../telegram';
import { LEGACY_VIDEOS } from '../history';
import Avatar from './Avatar';

interface Media { id: string; src: string; poster?: string }

interface HistoryItem {
  id: string;
  title: string;
  date: string;
  dateEnd: string | null;
  dateLabel: string;
  location: string;
  cover: string;
  recap?: Media | null;
  videos: Media[];
  photos: { id: string; src: string }[];
  attendees: { telegramId: number; name: string; avatar: string }[];
  videoCount: number;
  photoCount: number;
  peopleCount: number;
}

interface HistoryStoriesProps {
  onClose: () => void;
  /** Открыть сразу этот выезд (тап по истории на главной). */
  initialId?: string | null;
}

/** Плиток кадров за раз: дальше — «Показать ещё», чтобы не грузить сотню файлов. */
const PAGE = 30;

type Slide = { id: string; kind: 'video' | 'photo'; src: string; poster?: string; recap?: boolean };

/** Видеоотчёт события: смонтированный ролик или старый файл из /public. */
function recapOf(h: HistoryItem): Media | null {
  if (h.recap) return h.recap;
  const l = LEGACY_VIDEOS[h.id];
  return l ? { id: `legacy-${h.id}`, src: l.src, poster: l.poster } : null;
}

/** Кандидаты в лицо открытки по порядку: афиша события (её рисуют под
 *  событие) → кадр из клипа → фото → кадр отчёта (на нём уже впечатано
 *  название, поверх нашей подписи выходит дважды). Не загрузился — следующий. */
function facesOf(h: HistoryItem): string[] {
  const afisha = h.cover && h.cover.includes('action=image') ? h.cover : '';
  return [afisha, h.videos[0]?.poster, h.photos[0]?.src, h.cover, recapOf(h)?.poster]
    .filter((x, i, a): x is string => !!x && a.indexOf(x) === i);
}

/** <img>, который при ошибке берёт следующий источник, а не рисует пустоту. */
function Fallback({ srcs, className, lazy }: { srcs: string[]; className: string; lazy?: boolean }) {
  const [i, setI] = useState(0);
  if (i >= srcs.length) return null;
  return <img src={srcs[i]} alt="" loading={lazy ? 'lazy' : undefined} decoding="async" onError={() => setI(i + 1)} className={className} />;
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
/** «24 октября» / «9–11 октября»: в date_label лежит афишная строка со временем
 *  и днём недели — для архива это шум. */
function when(h: HistoryItem): string {
  const [y, m, d] = String(h.date || '').split('-').map(Number);
  if (!m || !d) return h.dateLabel || '';
  const [, m2, d2] = String(h.dateEnd || '').split('-').map(Number);
  const yr = y !== new Date().getFullYear() ? ` ${y}` : '';
  if (d2 && (d2 !== d || m2 !== m)) return m2 === m ? `${d}–${d2} ${MONTHS[m - 1]}${yr}` : `${d} ${MONTHS[m - 1]} — ${d2} ${MONTHS[m2 - 1]}${yr}`;
  return `${d} ${MONTHS[m - 1]}${yr}`;
}
/** Место — до первой запятой: «Китайский бассейн», а не адрес со входом. */
const place = (h: HistoryItem) => String(h.location || '').split(',')[0].trim();

const plural = (n: number, one: string, few: string, many: string) =>
  n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many;

/**
 * «ИСТОРИЯ СООБЩЕСТВА» — архив прошедших событий из базы.
 *
 * Как устроено (и почему так):
 *  • СПИСОК. Свежее событие — крупной карточкой, его видеоотчёт крутится без
 *    звука: так человек сразу видит, что здесь «живое», а не архив-таблица.
 *    Остальные — сеткой вертикальных открыток (весь контент у нас вертикальный).
 *    Раньше все открытки были затемнены до 70 % и выглядели серыми — теперь
 *    градиент только под текстом.
 *  • СОБЫТИЕ. Видеоотчёт — главный экран, кадры участников — сеткой под ним.
 *    Стрелки «следующее событие» переехали из-под пальца в шапку.
 *  • ПРОСМОТР. Всё листается одним свайпом: отчёт, клипы, фото — со счётчиком.
 *  • БИТЫЕ ФАЙЛЫ. Плитка, которая не загрузилась, исчезает, а не висит пустым
 *    квадратом; события без единого кадра сервер в архив не отдаёт.
 */
export default function HistoryStories({ onClose, initialId }: HistoryStoriesProps) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const [slide, setSlide] = useState<number | null>(null);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [shown, setShown] = useState(PAGE);
  // Файлы, которые не загрузились, — прячем (id → true).
  const [broken, setBroken] = useState<Record<string, true>>({});
  const scroller = useRef<HTMLDivElement>(null);
  const hide = useCallback((id: string) => setBroken((b) => (b[id] ? b : { ...b, [id]: true })), []);

  useEffect(() => {
    let alive = true;
    fetch('/api/events?action=archive', { headers: { 'X-Telegram-Init-Data': getInitData() } })
      .then((r) => (r.ok ? r.json() : Promise.reject(String(r.status))))
      .then((j) => {
        if (!alive) return;
        const list: HistoryItem[] = Array.isArray(j?.items) ? j.items : [];
        setItems(list);
        if (initialId) {
          const i = list.findIndex((x) => x.id === initialId);
          if (i >= 0) setActive(i);
        }
      })
      .catch(() => { if (alive) setFailed(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const item = active !== null ? items[active] ?? null : null;

  /** Всё, что листается в просмотре: отчёт → клипы → фото, без битых. */
  const slides: Slide[] = useMemo(() => {
    if (!item) return [];
    const r = recapOf(item);
    return [
      ...(r ? [{ id: r.id, kind: 'video' as const, src: r.src, poster: r.poster, recap: true }] : []),
      ...item.videos.map((v) => ({ id: v.id, kind: 'video' as const, src: v.src, poster: v.poster })),
      ...item.photos.map((p) => ({ id: p.id, kind: 'photo' as const, src: p.src })),
    ].filter((s) => !broken[s.id]);
  }, [item, broken]);
  const tiles = slides.filter((s) => !s.recap);
  const recap = slides.find((s) => s.recap) || null;

  const open = (i: number) => {
    setActive(i); setSlide(null); setPeopleOpen(false); setShown(PAGE);
    scroller.current?.scrollTo({ top: 0 });
  };
  const go = (dir: 1 | -1) => { if (active !== null && items.length > 1) open((active + dir + items.length) % items.length); };
  /** Крестик — на один шаг назад: кадр → событие → список → закрыть. */
  const stepBack = () => {
    if (slide !== null) return setSlide(null);
    if (peopleOpen) return setPeopleOpen(false);
    if (active !== null) return setActive(null);
    onClose();
  };
  const totalShots = items.reduce((n, h) => n + h.videoCount + h.photoCount, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center md:p-4" id="history-stories-root">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} onClick={onClose}
        className="absolute inset-0 bg-black/90 backdrop-blur-md" />
      <motion.div
        initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', damping: 26, stiffness: 320 }}
        className="bg-[#0d0d0d] md:rounded-3xl w-full max-w-lg relative z-10 md:border md:border-white/10 flex flex-col h-[100dvh] md:h-[90vh] text-white overflow-hidden"
      >
        {/* ── Шапка: назад, название, листание событий ── */}
        <div className="shrink-0 flex items-center gap-2 px-3 pt-3 pb-2 bg-[#0d0d0d]/95 backdrop-blur z-30 border-b border-white/5">
          <button onClick={stepBack} aria-label={active === null ? 'Закрыть' : 'Назад'}
            className="p-2 rounded-full bg-white/[0.06] text-white/80 hover:text-brand transition-colors cursor-pointer">
            {active === null ? <X className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
          </button>
          <div className="min-w-0 flex-1">
            {item ? (
              <>
                <div className="font-display font-black text-[13px] uppercase tracking-tight truncate">{item.title}</div>
                <div className="text-[10px] font-mono text-brand/80 truncate">{when(item)}</div>
              </>
            ) : (
              <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-brand">
                <Clapperboard className="w-4 h-4" /> История сообщества
              </div>
            )}
          </div>
          {item && items.length > 1 && (
            <div className="flex gap-1">
              <button onClick={() => go(-1)} aria-label="Предыдущее событие"
                className="p-2 rounded-full bg-white/[0.06] text-white/70 hover:text-white cursor-pointer"><ChevronLeft className="w-4 h-4" /></button>
              <button onClick={() => go(1)} aria-label="Следующее событие"
                className="p-2 rounded-full bg-white/[0.06] text-white/70 hover:text-white cursor-pointer"><ChevronRight className="w-4 h-4" /></button>
            </div>
          )}
        </div>

        <div ref={scroller} className="flex-1 overflow-y-auto scrollbar-none">
          {/* ════════ СПИСОК СОБЫТИЙ ════════ */}
          {!item && (
            <div className="p-4 space-y-5">
              <div>
                <h2 className="font-display font-black text-[28px] leading-none uppercase tracking-tight">Как это было</h2>
                {items.length > 0 && (
                  <p className="text-white/50 text-xs mt-2">
                    {items.length} {plural(items.length, 'событие', 'события', 'событий')} · {totalShots} {plural(totalShots, 'кадр', 'кадра', 'кадров')} от участников
                  </p>
                )}
              </div>

              {loading && <Skeleton />}
              {!loading && failed && <Empty text="Не удалось загрузить историю. Открой приложение ещё раз." />}
              {!loading && !failed && items.length === 0 && <Empty text="Здесь появятся прошедшие события клуба — с роликами и кадрами участников." />}

              {items[0] && <Featured h={items[0]} onOpen={() => open(0)} />}

              {items.length > 1 && (
                <div className="grid grid-cols-2 gap-3">
                  {items.slice(1).map((h, k) => (
                    <Card key={h.id} h={h} onOpen={() => open(k + 1)} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ════════ СОБЫТИЕ ════════ */}
          {item && (
            <div className="pb-8">
              {/* Главный экран: видеоотчёт, иначе лучший кадр */}
              {recap ? (
                <button onClick={() => setSlide(0)} aria-label="Смотреть видеоотчёт"
                  className="relative block w-full aspect-[4/5] bg-black overflow-hidden cursor-pointer group">
                  {/* Беззвучное превью вместо статичной обложки: на обложке отчёта
                      впечатан титр, и кнопка по центру закрывала его. */}
                  <video key={recap.id} src={recap.src} poster={recap.poster} muted loop playsInline autoPlay preload="metadata"
                    className="absolute inset-0 w-full h-full object-cover" />
                  <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/80 to-transparent" />
                  <span className="absolute right-4 bottom-4 w-14 h-14 rounded-full bg-brand text-black flex items-center justify-center shadow-[0_0_40px_rgba(230,253,58,0.35)] group-hover:scale-105 transition-transform">
                    <Play className="w-6 h-6 ml-0.5" fill="currentColor" />
                  </span>
                  <span className="absolute left-4 bottom-4 inline-flex items-center gap-1.5 rounded-full bg-brand px-3 py-1.5 text-[10px] font-mono font-bold tracking-widest text-black">
                    <Film className="w-3.5 h-3.5" /> СМОТРЕТЬ ОТЧЁТ СО ЗВУКОМ
                  </span>
                </button>
              ) : (tiles[0] || item.cover) ? (
                <div className="relative w-full aspect-[4/5] bg-black overflow-hidden">
                  <img src={tiles[0]?.poster || tiles[0]?.src || item.cover} alt="" className="absolute inset-0 w-full h-full object-cover" />
                </div>
              ) : null}

              <div className="px-4 pt-4 space-y-3">
                <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono">
                  {item.location && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.06] px-2.5 py-1 text-white/70">
                      <MapPin className="w-3 h-3" /> {place(item)}
                    </span>
                  )}
                  {tiles.length > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.06] px-2.5 py-1 text-white/70">
                      <Images className="w-3 h-3" /> {tiles.length} {plural(tiles.length, 'кадр', 'кадра', 'кадров')}
                    </span>
                  )}
                </div>
                {item.attendees.length > 0 && (
                  <button onClick={() => setPeopleOpen(true)} className="flex items-center gap-2.5 cursor-pointer group"
                    aria-label={`Кто был на событии — ${item.peopleCount}`}>
                    <Faces list={item.attendees} max={7} size={30} />
                    <span className="text-xs text-white/60 group-hover:text-brand transition-colors">
                      {item.peopleCount} {plural(item.peopleCount, 'человек был', 'человека были', 'человек были')}
                    </span>
                  </button>
                )}
              </div>

              {tiles.length > 0 && (
                <div className="px-3 pt-5">
                  <div className="px-1 mb-2 text-[10px] font-mono uppercase tracking-widest text-white/40">Кадры участников</div>
                  <div className="grid grid-cols-3 gap-1">
                    {tiles.slice(0, shown).map((t) => {
                      const idx = slides.indexOf(t);
                      return (
                        <button key={t.id} onClick={() => setSlide(idx)} aria-label={t.kind === 'video' ? 'Открыть видео' : 'Открыть фото'}
                          className="relative aspect-[3/4] overflow-hidden rounded-md bg-white/[0.04] cursor-pointer">
                          <img src={t.kind === 'video' ? (t.poster || '') : t.src} alt="" loading="lazy" decoding="async"
                            onError={() => hide(t.id)} className="w-full h-full object-cover" />
                          {t.kind === 'video' && (
                            <span className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/55 backdrop-blur flex items-center justify-center">
                              <Play className="w-3 h-3 ml-px" fill="currentColor" />
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {tiles.length > shown && (
                    <button onClick={() => setShown((n) => n + PAGE)}
                      className="mt-3 w-full rounded-xl bg-white/[0.06] py-3 text-[11px] font-mono tracking-widest text-white/70 hover:text-brand cursor-pointer">
                      ПОКАЗАТЬ ЕЩЁ · {tiles.length - shown}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Состав ── */}
        <AnimatePresence>
          {item && peopleOpen && (
            <>
              <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={() => setPeopleOpen(false)} className="absolute inset-0 z-40 bg-black/70 cursor-pointer" aria-label="Закрыть состав" />
              <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
                className="absolute inset-x-3 bottom-3 z-50 bg-[#171717] border border-white/10 rounded-2xl p-4 max-h-[60vh] overflow-y-auto scrollbar-none">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-brand flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5" /> Были · {item.peopleCount}
                  </div>
                  <button onClick={() => setPeopleOpen(false)} className="p-1.5 rounded-full bg-white/10 text-white/70 cursor-pointer" aria-label="Закрыть">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {item.attendees.map((a) => (
                    <div key={a.telegramId} className="flex items-center gap-2 bg-white/5 rounded-xl px-2 py-1.5 min-w-0">
                      <Face a={a} size={32} />
                      <span className="text-xs text-white/85 truncate">{a.name || 'Участник'}</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* ── Просмотр: всё листается свайпом ── */}
        {item && slide !== null && slides[slide] && (
          <Viewer slides={slides} index={slide} onIndex={setSlide} onClose={() => setSlide(null)} onBroken={hide} />
        )}
      </motion.div>
    </div>
  );
}

/** Свежее событие — крупно, с беззвучным превью отчёта. */
function Featured({ h, onOpen }: { h: HistoryItem; onOpen: () => void }) {
  const r = recapOf(h);
  const [videoOk, setVideoOk] = useState(true);
  return (
    <button onClick={onOpen} aria-label={`Открыть ${h.title}`}
      className="relative block w-full aspect-[4/5] rounded-3xl overflow-hidden bg-white/[0.04] text-left cursor-pointer group">
      <Fallback srcs={facesOf(h)} className="absolute inset-0 w-full h-full object-cover" />
      {r && videoOk && (
        <video src={r.src} poster={r.poster} muted loop playsInline autoPlay preload="metadata"
          onError={() => setVideoOk(false)} className="absolute inset-0 w-full h-full object-cover" />
      )}
      <div className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black via-black/60 to-transparent" />
      <span className="absolute top-3 left-3 rounded-full bg-brand px-2.5 py-1 text-[9px] font-mono font-bold tracking-widest text-black">СВЕЖЕЕ</span>
      <div className="absolute inset-x-0 bottom-0 p-4">
        <div className="text-[10px] font-mono text-brand">{when(h)}{place(h) ? ` · ${place(h)}` : ''}</div>
        <div className="font-display font-black text-2xl uppercase tracking-tight leading-[1.05] mt-1 line-clamp-2">{h.title}</div>
        <div className="mt-3 flex items-center justify-between gap-3">
          {h.attendees.length > 0 ? <Faces list={h.attendees} max={5} size={26} /> : <span />}
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white text-black px-3.5 py-2 text-[11px] font-bold group-hover:bg-brand transition-colors">
            <Play className="w-3.5 h-3.5" fill="currentColor" /> {r ? 'Смотреть отчёт' : 'Смотреть кадры'}
          </span>
        </div>
      </div>
    </button>
  );
}

/** Открытка события в сетке. */
function Card({ h, onOpen }: { h: HistoryItem; onOpen: () => void }) {
  const shots = h.videoCount + h.photoCount;
  return (
    <button onClick={onOpen} aria-label={`Открыть ${h.title}`}
      className="relative block aspect-[3/4] rounded-2xl overflow-hidden text-left cursor-pointer group bg-gradient-to-br from-[#1d1f12] to-[#0d0d0d]">
      <Fallback srcs={facesOf(h)} lazy className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-500" />
      <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />
      {recapOf(h) && (
        <span className="absolute top-2 left-2 w-7 h-7 rounded-full bg-brand text-black flex items-center justify-center">
          <Play className="w-3.5 h-3.5 ml-px" fill="currentColor" />
        </span>
      )}
      <div className="absolute inset-x-0 bottom-0 p-2.5">
        <div className="font-display font-black text-[13px] uppercase tracking-tight leading-tight line-clamp-2">{h.title}</div>
        <div className="mt-1 flex items-center gap-1.5 text-[9px] font-mono text-white/55">
          <span className="text-brand/90">{when(h)}</span>
          {shots > 0 && <span>· {shots} {plural(shots, 'кадр', 'кадра', 'кадров')}</span>}
        </div>
      </div>
    </button>
  );
}

/** Полноэкранный просмотр: свайп/тап по краям, счётчик, крестик. */
function Viewer({ slides, index, onIndex, onClose, onBroken }: {
  slides: Slide[]; index: number; onIndex: (i: number) => void; onClose: () => void; onBroken: (id: string) => void;
}) {
  const s = slides[index];
  const x0 = useRef<number | null>(null);
  const step = (d: 1 | -1) => { const n = index + d; if (n >= 0 && n < slides.length) onIndex(n); };
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'ArrowRight') step(1); if (e.key === 'ArrowLeft') step(-1); if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });
  return (
    <div className="absolute inset-0 z-50 bg-black flex flex-col"
      onPointerDown={(e) => {
        // снизу — полоса перемотки видео: её протяжка не должна листать кадры
        const r = e.currentTarget.getBoundingClientRect();
        x0.current = e.clientY > r.bottom - 90 ? null : e.clientX;
      }}
      onPointerUp={(e) => {
        if (x0.current === null) return;
        const dx = e.clientX - x0.current; x0.current = null;
        if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
      }}>
      <div className="absolute top-0 inset-x-0 z-10 flex items-center justify-between p-3 bg-gradient-to-b from-black/70 to-transparent">
        <span className="text-[11px] font-mono text-white/70">
          {s.recap ? 'ВИДЕООТЧЁТ' : `${index + 1 - (slides[0]?.recap ? 1 : 0)} / ${slides.length - (slides[0]?.recap ? 1 : 0)}`}
        </span>
        <button onClick={onClose} aria-label="Закрыть" className="p-2 rounded-full bg-white/10 text-white cursor-pointer"><X className="w-5 h-5" /></button>
      </div>
      <div className="flex-1 flex items-center justify-center">
        {s.kind === 'video' ? (
          <video key={s.id} src={s.src} poster={s.poster} controls autoPlay playsInline preload="auto"
            onError={() => { onBroken(s.id); }} className="max-w-full max-h-full w-full h-full object-contain" />
        ) : (
          <img key={s.id} src={s.src} alt="" onError={() => onBroken(s.id)} className="max-w-full max-h-full object-contain select-none" draggable={false} />
        )}
      </div>
      {index > 0 && (
        <button onClick={() => step(-1)} aria-label="Предыдущий кадр"
          className="absolute left-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/10 text-white cursor-pointer"><ChevronLeft className="w-5 h-5" /></button>
      )}
      {index < slides.length - 1 && (
        <button onClick={() => step(1)} aria-label="Следующий кадр"
          className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/10 text-white cursor-pointer"><ChevronRight className="w-5 h-5" /></button>
      )}
    </div>
  );
}

function Face({ a, size }: { a: { name: string; avatar: string }; size: number }) {
  const [ok, setOk] = useState(!!a.avatar);
  return ok
    ? <img src={a.avatar} alt="" loading="lazy" onError={() => setOk(false)} style={{ width: size, height: size }} className="rounded-full object-cover shrink-0" />
    : <Avatar name={a.name} size={size} />;
}

function Faces({ list, max, size }: { list: HistoryItem['attendees']; max: number; size: number }) {
  return (
    <span className="flex -space-x-2 shrink-0">
      {list.slice(0, max).map((a) => (
        <span key={a.telegramId} className="rounded-full ring-2 ring-black overflow-hidden bg-white/10 flex">
          <Face a={a} size={size} />
        </span>
      ))}
      {list.length > max && (
        <span style={{ width: size, height: size }} className="rounded-full ring-2 ring-black bg-[#222] text-white/80 text-[9px] font-mono flex items-center justify-center">
          +{list.length - max}
        </span>
      )}
    </span>
  );
}

function Skeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="aspect-[4/5] rounded-3xl bg-white/[0.05]" />
      <div className="grid grid-cols-2 gap-3">
        <div className="aspect-[3/4] rounded-2xl bg-white/[0.05]" />
        <div className="aspect-[3/4] rounded-2xl bg-white/[0.05]" />
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="text-white/45 text-xs text-center py-14 px-6">{text}</div>;
}
