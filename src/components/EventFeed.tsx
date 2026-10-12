import React, { useState, Suspense } from 'react';
import { AvatarStack } from './Avatar';
import { motion, AnimatePresence } from 'motion/react';
import {
  CalendarDays, History, Sparkles, ChevronRight, Compass, ShieldAlert, ArrowUpRight, Lock, Archive, MapPin
} from 'lucide-react';
import { CommunityEvent, EventType, getEventPhase, getToday, isEventOver, prettyPlace } from '../types';
import { lazyWithRetry } from '../lazy';
import HomeScreenButton from './HomeScreenButton';

/**
 * Карточка события весит ~94 КБ и тянет за собой логистику, задачи, правила и
 * историю. Статический импорт здесь означал, что ВСЕ, кто просто открыл афишу,
 * скачивали её вместе с лентой — хотя открывают единицы. Ленивим: едет только
 * по тапу на карточку.
 */
const EventDetailModal = lazyWithRetry(() => import('./EventDetailModal'));

/** «9–11 окт · пт–вс» / «27 сент · сб · 09:20» — главное о времени одной строкой. */
function whenLine(e: CommunityEvent): string {
  const d = (s: string) => new Date(`${s}T00:00:00`);
  const a = d(e.date);
  if (Number.isNaN(a.getTime())) return '';
  const wd = (x: Date) => x.toLocaleDateString('ru-RU', { weekday: 'short' });
  const mon = (x: Date) => x.toLocaleDateString('ru-RU', { month: 'short' }).replace('.', '');
  if (e.dateEnd && e.dateEnd > e.date) {
    const b = d(e.dateEnd);
    const range = a.getMonth() === b.getMonth()
      ? `${a.getDate()}–${b.getDate()} ${mon(b)}`
      : `${a.getDate()} ${mon(a)} – ${b.getDate()} ${mon(b)}`;
    return `${range} · ${wd(a)}–${wd(b)}`;
  }
  return `${a.getDate()} ${mon(a)} · ${wd(a)}${e.time ? ` · ${e.time}` : ''}`;
}

const placesWord = (n: number) =>
  n % 10 === 1 && n % 100 !== 11 ? 'место' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'места' : 'мест';

interface EventFeedProps {
  events: CommunityEvent[];
  registeredEventIds: string[];
  onRegisterClick: (event: CommunityEvent) => void;
  selectedEventId?: string | null;
}

export default function EventFeed({ 
  events, 
  registeredEventIds, 
  onRegisterClick,
  selectedEventId
}: EventFeedProps) {
  const [activeFilter, setActiveFilter] = useState<EventType | 'all'>('all');
  const [showArchive, setShowArchive] = useState(false);
  const [activeDetailEvent, setActiveDetailEvent] = useState<CommunityEvent | null>(null);

  // Динамическая дата «сегодня» — прошедшие события скрыты по умолчанию
  const today = getToday();

  // Только актуальные события в основной ленте. Прошедшим считается событие,
  // у которого закончился ПОСЛЕДНИЙ день: по одному `date` многодневный выезд
  // уезжал в архив уже на второй день, пока люди ещё на месте.
  // Завершённое кнопкой «Завершить» уходит в архив сразу, не дожидаясь даты.
  const upcomingEvents = events.filter(e => !isEventOver(e, today));
  const pastEvents = events.filter(e => isEventOver(e, today));

  // Применяем фильтр по типу
  const filteredEvents = activeFilter === 'all' 
    ? upcomingEvents 
    : upcomingEvents.filter(e => e.type === activeFilter);

  // Фильтр для архива
  const filteredArchive = activeFilter === 'all'
    ? pastEvents
    : pastEvents.filter(e => e.type === activeFilter);

  // Filter Categories list config
  const filterCategories: { key: EventType | 'all'; label: string }[] = [
    { key: 'all', label: 'Все направления' },
    { key: 'male', label: 'Мужские' },
    { key: 'mixed', label: 'Семейные / Смешанные' },
    { key: 'intellectual', label: 'Интеллектуальные' },
    { key: 'active', label: 'Спортивные / Активные' }
  ];

  return (
    <div id="event-feed-section" className="space-y-6">
      
      {/* Header with Archive button */}
      <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-white/10 pb-4 gap-4">
        <div className="flex items-center gap-2">
          <CalendarDays className="w-5 h-5 text-brand" />
          <h2 className="font-sans font-black text-xl text-white uppercase tracking-tight" id="feed-title">
            {showArchive ? 'Архив встреч' : 'Каталог перезагрузок'}
          </h2>
        </div>

        {/* Archive Toggle Button */}
        <button
          onClick={() => setShowArchive(!showArchive)}
          className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2 cursor-pointer ${
            showArchive
              ? 'bg-brand text-black shadow-md font-black shadow-brand/10'
              : 'bg-[#121212] border border-white/10 text-white/60 hover:text-white hover:bg-white/5'
          }`}
        >
          {showArchive ? (
            <><CalendarDays className="w-3.5 h-3.5" /> К текущим</>
          ) : (
            <><Archive className="w-3.5 h-3.5" /> Архив ({pastEvents.length})</>
          )}
        </button>
      </div>

      {/* Ярлык на «Домой»: люди забывают про приложение — пусть оно будет на экране. */}
      {!showArchive && <div className="-mx-4"><HomeScreenButton variant="banner" /></div>}

      {/* FILTER BUTTONS CONTAINER */}
      <div 
        id="filters-toolbar" 
        className="h-[50px] bg-[#121212] border border-white/5 rounded-2xl flex items-center px-3 overflow-hidden"
      >
        <div 
          id="filters-tabs-scroller" 
          className="flex gap-1.5 overflow-x-auto scrollbar-none w-full"
        >
          {filterCategories.map(cat => (
            <button
              key={cat.key}
              onClick={() => setActiveFilter(cat.key)}
              className={`whitespace-nowrap px-3.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
                activeFilter === cat.key
                  ? 'bg-brand/20 text-brand border border-brand/30'
                  : 'text-white/40 hover:text-white/70 border border-transparent'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Events Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <AnimatePresence mode="popLayout">
          {(showArchive ? filteredArchive : filteredEvents).length === 0 ? (
            <motion.div 
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="col-span-full text-center py-12"
            >
              <Compass className="w-12 h-12 text-white/10 mx-auto mb-3" />
              <p className="text-white/30 text-sm font-mono">
                {showArchive ? 'В архиве пока нет встреч' : 'Скоро появятся новые события'}
              </p>
            </motion.div>
          ) : (
            (showArchive ? filteredArchive : filteredEvents).map((event) => {
              const phase = getEventPhase(event);
              const isRegistered = registeredEventIds.includes(event.id);
              const isPast = phase === 'past';
              const isLocked = phase === 'locked';

              return (
                <motion.div
                  key={event.id}
                  layout
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.2 }}
                >
                  {/* div, а не button: внутри живёт своя кнопка «Записаться»,
                      а кнопка в кнопке — невалидный HTML и двойной клик в Safari. */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setActiveDetailEvent(event)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveDetailEvent(event); } }}
                    className="w-full text-left bg-[#121212] border border-white/10 hover:border-brand/30 rounded-2xl overflow-hidden transition-all cursor-pointer group"
                  >
                    {/* Card Image */}
                    <div className="relative h-40 bg-black overflow-hidden">
                      <img 
                        src={event.image} 
                        alt={event.title}
                        className="w-full h-full object-cover brightness-[0.5] group-hover:scale-105 transition-transform duration-500"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-[#121212] via-transparent to-transparent" />
                      
                      {/* Badges */}
                      <div className="absolute top-3 left-3 flex gap-1.5 flex-wrap">
                        <span className={`px-2 py-0.5 rounded-full text-[8px] font-bold font-mono uppercase tracking-wider border ${
                          event.type === 'male' ? 'border-indigo-500/30 text-indigo-300 bg-black/60' :
                          event.type === 'mixed' ? 'border-brand/30 text-brand bg-black/60' :
                          event.type === 'intellectual' ? 'border-emerald-500/30 text-emerald-300 bg-black/60' :
                          'border-rose-500/30 text-rose-300 bg-black/60'
                        }`}>
                          {event.type === 'male' ? 'Муж' :
                           event.type === 'mixed' ? 'Микс' :
                           event.type === 'intellectual' ? 'Интел' : 'Актив'}
                        </span>
                        {event.format && event.format !== 'offline' && (
                          <span className="px-2 py-0.5 rounded-full text-[8px] font-bold font-mono uppercase tracking-wider border border-sky-500/30 text-sky-300 bg-black/60">
                            {event.format === 'online' ? 'Онлайн' : 'Гибрид'}
                          </span>
                        )}
                        {isLocked && (
                          <span className="px-2 py-0.5 rounded-full text-[8px] font-bold font-mono uppercase tracking-wider border border-brand/30 text-brand bg-black/60 flex items-center gap-1">
                            <Lock className="w-2 h-2" /> Скоро
                          </span>
                        )}
                      </div>

                      {/* Date badge */}
                      <div className="absolute top-3 right-3 bg-black/80 border border-white/10 rounded-xl px-2.5 py-1.5 text-center">
                        <div className="text-[10px] font-black text-brand font-mono leading-none">
                          {new Date(event.date + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric' })}
                        </div>
                        <div className="text-[7px] text-white/50 font-mono uppercase tracking-wider leading-none mt-0.5">
                          {new Date(event.date + 'T00:00:00').toLocaleDateString('ru-RU', { month: 'short' })}
                        </div>
                      </div>
                    </div>

                    {/* Card Content — как у 360 Padel: когда, где, сколько мест и
                        кнопка записи прямо на карточке, без захода в подробности. */}
                    <div className="p-4 space-y-2.5">
                      <h3 className="font-display font-black text-[15px] uppercase tracking-tight text-white group-hover:text-brand transition-colors leading-tight">
                        {event.title}
                      </h3>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-white/60">
                        {whenLine(event) && (
                          <span className="flex items-center gap-1.5"><CalendarDays className="w-3.5 h-3.5 text-brand/80" />{whenLine(event)}</span>
                        )}
                        {event.location && (
                          <span className="flex min-w-0 items-center gap-1.5"><MapPin className="w-3.5 h-3.5 shrink-0 text-brand/80" /><span className="truncate max-w-[170px]">{prettyPlace(event.location)}</span></span>
                        )}
                      </div>

                      {event.painPoint && (
                        <p className="text-[12px] text-white/45 line-clamp-2 leading-relaxed">
                          {event.painPoint}
                        </p>
                      )}

                      {/* Челлендж — не «места», а день из скольких: идёт ли он и сколько осталось. */}
                      {!isPast && event.isChallenge && event.dateEnd ? (() => {
                        const d0 = new Date(`${event.date}T00:00:00`).getTime();
                        const total = Math.round((new Date(`${event.dateEnd}T00:00:00`).getTime() - d0) / 86400000) + 1;
                        const day = Math.min(total, Math.max(0, Math.round((new Date(`${today}T00:00:00`).getTime() - d0) / 86400000) + 1));
                        return (
                          <div className="space-y-1.5">
                            <div className="flex justify-between text-[11px]">
                              <span className="text-white/45">{day > 0 ? 'Идёт челлендж' : 'Старт скоро'}</span>
                              <span className="font-bold text-brand tabular-nums">{day > 0 ? `день ${day} из ${total}` : `${total} дней`}</span>
                            </div>
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                              <div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(3, (day / total) * 100)}%` }} />
                            </div>
                          </div>
                        );
                      })() : null}

                      {/* Места: шкала заполнения. Пустую шкалу у «без лимита» не рисуем. */}
                      {!isPast && !event.isChallenge && event.maxParticipants ? (() => {
                        const max = event.maxParticipants;
                        const taken = Math.min(max, event.participantsCount || 0);
                        const left = Math.max(0, max - taken);
                        return (
                          <div className="space-y-1.5">
                            <div className="flex justify-between text-[11px]">
                              <span className="text-white/45">Участников</span>
                              <span className="font-bold text-brand tabular-nums">{taken} / {max}</span>
                            </div>
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                              <div className={`h-full rounded-full ${left <= 2 ? 'bg-rose-400' : 'bg-brand'}`} style={{ width: `${Math.max(4, (taken / max) * 100)}%` }} />
                            </div>
                            <div className={`text-[11px] ${left <= 2 ? 'text-rose-300' : 'text-white/45'}`}>
                              {left > 0 ? `${left} ${placesWord(left)} свободно` : 'Мест нет — можно в лист ожидания'}
                            </div>
                          </div>
                        );
                      })() : null}

                      <div className="flex items-center justify-between gap-2 pt-1">
                        <div className="flex min-w-0 items-center gap-2 text-[11px] text-white/45">
                          {event.participantsCount > 0 || (event.participants?.length || 0) > 0 ? (
                            <AvatarStack people={event.participants || []} total={event.participantsCount} size={26} />
                          ) : !isPast && !event.maxParticipants ? (
                            <span>Будь первым</span>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {!isPast && (
                            <span className="rounded-full bg-brand/10 px-2.5 py-1.5 text-[12px] font-bold text-brand">
                              {event.priceType !== 'paid' ? 'Бесплатно'
                                : event.priceAmount > 0 ? `${event.priceAmount} Br`
                                : (event.priceLabel && event.priceLabel.length <= 14 ? event.priceLabel : 'Платно')}
                            </span>
                          )}
                          {isPast ? (
                            <ChevronRight className="w-4 h-4 text-white/25 group-hover:text-brand transition-colors" />
                          ) : isRegistered ? (
                            <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-3 py-1.5 text-[12px] font-bold text-emerald-300">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> {event.isChallenge ? 'Ты в челлендже' : 'Ты едешь'}
                            </span>
                          ) : phase === 'open' && event.isChallenge ? (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); onRegisterClick(event); }}
                              className="rounded-full border-none bg-brand px-4 py-1.5 text-[12px] font-black text-black cursor-pointer hover:bg-brand-hover"
                            >
                              ⚡ Участвовать
                            </button>
                          ) : phase === 'open' ? (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); onRegisterClick(event); }}
                              className="rounded-full border-none bg-brand px-4 py-1.5 text-[12px] font-black text-black cursor-pointer hover:bg-brand-hover"
                            >
                              Записаться
                            </button>
                          ) : (
                            <span className="rounded-full bg-white/5 px-3 py-1.5 text-[12px] font-bold text-white/50">
                              {isLocked ? 'Скоро' : phase === 'full' ? 'Мест нет' : event.isChallenge ? 'Открыть' : 'Набор закрыт'}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })
          )}
        </AnimatePresence>
      </div>

      {/* Detail Modal */}
      <AnimatePresence>
        {activeDetailEvent && (
          <Suspense fallback={null}>
            <EventDetailModal
              event={activeDetailEvent}
              isRegistered={registeredEventIds.includes(activeDetailEvent.id)}
              onClose={() => setActiveDetailEvent(null)}
              onRegisterClick={onRegisterClick}
            />
          </Suspense>
        )}
      </AnimatePresence>
    </div>
  );
}