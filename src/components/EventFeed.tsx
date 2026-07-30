import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  CalendarDays, History, Sparkles, ChevronRight, Compass, ShieldAlert, ArrowUpRight, Lock, Archive
} from 'lucide-react';
import { CommunityEvent, EventType, getEventPhase, getToday } from '../types';
import EventDetailModal from './EventDetailModal';

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
  const lastDay = (e: CommunityEvent) => e.dateEnd || e.date;
  const upcomingEvents = events.filter(e => lastDay(e) >= today);
  const pastEvents = events.filter(e => lastDay(e) < today);

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
                  <button
                    onClick={() => setActiveDetailEvent(event)}
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

                    {/* Card Content */}
                    <div className="p-4 space-y-2">
                      <h3 className="font-display font-black text-sm uppercase tracking-tight text-white group-hover:text-brand transition-colors leading-tight">
                        {event.title}
                      </h3>
                      
                      <p className="text-[10px] text-white/50 font-mono line-clamp-2 leading-relaxed">
                        {event.painPoint}
                      </p>

                      <div className="flex items-center justify-between pt-1">
                        <div className="flex items-center gap-2 text-[9px] text-white/40 font-mono">
                          <span>{event.participantsCount} участников</span>
                          {event.priceType === 'paid' && event.priceAmount > 0 && (
                            <span className="text-brand/80">{event.priceAmount} Br</span>
                          )}
                        </div>
                        <ChevronRight className="w-3.5 h-3.5 text-white/20 group-hover:text-brand transition-colors" />
                      </div>

                      {/* Registered badge */}
                      {isRegistered && (
                        <div className="flex items-center gap-1 text-[8px] text-emerald-400 font-mono uppercase tracking-wider pt-1 border-t border-white/5">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                          Вы записаны
                        </div>
                      )}
                    </div>
                  </button>
                </motion.div>
              );
            })
          )}
        </AnimatePresence>
      </div>

      {/* Detail Modal */}
      <AnimatePresence>
        {activeDetailEvent && (
          <EventDetailModal
            event={activeDetailEvent}
            isRegistered={registeredEventIds.includes(activeDetailEvent.id)}
            onClose={() => setActiveDetailEvent(null)}
            onRegisterClick={onRegisterClick}
          />
        )}
      </AnimatePresence>
    </div>
  );
}