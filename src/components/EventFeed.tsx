import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  CalendarDays, History, Sparkles, ChevronRight, Compass, ShieldAlert, ArrowUpRight, Lock
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
  const [timeTab, setTimeTab] = useState<'upcoming' | 'past'>('upcoming');
  const [activeDetailEvent, setActiveDetailEvent] = useState<CommunityEvent | null>(null);

  // Динамическая дата «сегодня» — прошедшие события скрыты по умолчанию
  const today = getToday();

  // Split into lists based on date
  const upcomingEventsRaw = events.filter(e => e.date >= today);
  const pastEventsRaw = events.filter(e => e.date < today);

  // Apply filtered view based on time tab
  const currentCategoryEvents = timeTab === 'upcoming' ? upcomingEventsRaw : pastEventsRaw;

  // Apply category event filters
  const filteredEvents = activeFilter === 'all' 
    ? currentCategoryEvents 
    : currentCategoryEvents.filter(e => e.type === activeFilter);

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
      
      {/* Upper Timeline Navigator (Upcoming vs Past) */}
      <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-white/10 pb-4 gap-4">
        <div className="flex items-center gap-2">
          <CalendarDays className="w-5 h-5 text-brand" />
          <h2 className="font-sans font-black text-xl text-white uppercase tracking-tight" id="feed-title">
            Каталог перезагрузок
          </h2>
        </div>

        {/* The Toggle Pills */}
        <div className="bg-[#121212] border border-white/10 p-1 rounded-2xl flex gap-1 self-start md:self-auto" id="timeline-toggle-wrapper">
          <button
            onClick={() => {
              setTimeTab('upcoming');
              setActiveFilter('all');
            }}
            className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2 cursor-pointer ${
              timeTab === 'upcoming'
                ? 'bg-brand text-black shadow-md font-black shadow-brand/10'
                : 'text-white/60 hover:text-white hover:bg-white/5'
            }`}
          >
            <span>Предстоящие ({upcomingEventsRaw.length})</span>
          </button>
          <button
            onClick={() => {
              setTimeTab('past');
              setActiveFilter('all');
            }}
            className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2 cursor-pointer ${
              timeTab === 'past'
                ? 'bg-brand text-black shadow-md font-black shadow-brand/10'
                : 'text-white/60 hover:text-white hover:bg-white/5'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>Архив встреч ({pastEventsRaw.length})</span>
          </button>
        </div>
      </div>

      {/* FILTER BUTTONS CONTAINER - EXPLICITLY 50px HEIGHT */}
      <div 
        id="filters-toolbar" 
        className="h-[50px] bg-[#121212] border border-white/5 rounded-2xl flex items-center px-3 overflow-hidden"
      >
        <div 
          id="filters-tabs-scroller" 
          className="flex gap-2 overflow-x-auto scrollbar-none w-full items-center py-1 shrink-0"
        >
          {filterCategories.map(cat => {
            const isActive = activeFilter === cat.key;
            // Count matching in current time tab
            const count = cat.key === 'all' 
              ? currentCategoryEvents.length 
              : currentCategoryEvents.filter(e => e.type === cat.key).length;

            return (
              <button
                key={cat.key}
                onClick={() => setActiveFilter(cat.key)}
                id={`filter-tab-${cat.key}`}
                className={`
                  px-3 py-1.5 rounded-xl text-[11px] font-bold whitespace-nowrap transition-all border flex items-center gap-2 cursor-pointer outline-none shrink-0 h-8
                  ${isActive
                    ? 'bg-brand border-brand text-black font-black'
                    : 'bg-[#181818] border-white/5 text-white/50 hover:border-white/10 hover:bg-[#202020] hover:text-white'
                  }
                `}
              >
                <span>{cat.label}</span>
                <span className={`
                  text-[9px] px-1.5 py-0.2 rounded font-mono font-bold
                  ${isActive ? 'bg-black/10 text-black' : 'bg-white/5 text-white/40'}
                `}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Grid of Minimalist Ticket banner-cards */}
      {filteredEvents.length === 0 ? (
        <div className="bg-[#121212] border border-white/5 rounded-3xl p-12 text-center text-white/40 font-mono text-xs max-w-lg mx-auto space-y-3">
          <Sparkles className="w-8 h-8 text-white/20 mx-auto" />
          <p>В выбранной категории сейчас нет записей.</p>
          {timeTab === 'past' && <p className="text-[10px]">Все прошедшие заезды за май уже отправлены в архив сообщества.</p>}
        </div>
      ) : (
        <div id="events-grid" className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <AnimatePresence mode="popLayout">
            {filteredEvents.map(event => {
              const isRegistered = registeredEventIds.includes(event.id);
              const isLocked = getEventPhase(event) === 'locked';
              const isHighlighted = selectedEventId === event.id;
              const anySelected = !!selectedEventId;
              const isDimmed = anySelected && !isHighlighted;

              return (
                <motion.div
                  layout
                  whileHover={isDimmed ? {} : { y: -3, scale: 1.01 }}
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ 
                    opacity: isDimmed ? 0.3 : 1, 
                    scale: isHighlighted ? 1.015 : 1,
                    borderColor: isHighlighted ? '#E6FD3A' : 'rgba(255, 255, 255, 0.08)'
                  }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ duration: 0.25 }}
                  key={event.id}
                  id={`event-card-${event.id}`}
                  onClick={() => setActiveDetailEvent(event)}
                  className={`
                    bg-[#121212] rounded-2xl border p-5 sm:p-6 transition-all flex flex-col justify-between group relative overflow-hidden cursor-pointer min-h-[170px] sm:min-h-[190px]
                    ${isHighlighted ? 'ring-2 ring-brand/10 shadow-[0_0_35px_rgba(230,253,58,0.12)] bg-[#1a1a14]' : 'border-white/10 hover:border-[#E6FD3A]/30 hover:shadow-[0_0_25px_rgba(230,253,58,0.08)]'}
                    ${isDimmed ? 'opacity-30 saturation-50' : 'opacity-100'}
                  `}
                >
                  {/* Subtle Background Art Accent for tickets */}
                  <div className="absolute right-0 bottom-0 top-0 w-1/3 pointer-events-none opacity-[0.03] group-hover:opacity-[0.05] transition-opacity duration-300">
                    <Compass className="w-full h-full text-white rotate-12" />
                  </div>

                  {/* Ambient subtle glowing lines */}
                  <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[#E6FD3A]/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

                  <div className="space-y-3">
                    {/* Header: direction badge + quick look prompt */}
                    <div className="flex justify-between items-center text-[9px] font-mono tracking-wider uppercase text-white/40">
                      <span className={`
                        font-bold flex items-center gap-1.5
                        ${event.type === 'male' ? 'text-indigo-400' :
                          event.type === 'mixed' ? 'text-brand' :
                          event.type === 'intellectual' ? 'text-emerald-400' : 'text-rose-400'}
                      `}>
                        <span className={`w-1 h-1 rounded-full ${
                          event.type === 'male' ? 'bg-indigo-400' :
                          event.type === 'mixed' ? 'bg-brand' :
                          event.type === 'intellectual' ? 'bg-emerald-400' : 'bg-rose-400'
                        }`} />
                        {event.type === 'male' ? 'Мужское Братство' :
                          event.type === 'mixed' ? 'Смешанный Круг' :
                          event.type === 'intellectual' ? 'Интеллектуал' : 'Активность'}
                      </span>
                      
                      {isLocked ? (
                        <span className="text-brand font-black flex items-center gap-1 bg-brand/10 border border-brand/25 px-1.5 py-0.5 rounded" id={`locked-label-${event.id}`}>
                          <Lock className="w-2.5 h-2.5" /> Скоро
                        </span>
                      ) : (
                        <span className="opacity-0 group-hover:opacity-100 transition-opacity text-brand font-black flex items-center gap-0.5" id={`explore-label-${event.id}`}>
                          Детали <ArrowUpRight className="w-3 h-3" />
                        </span>
                      )}
                    </div>

                    {/* TITLE - Display, bold, clickable */}
                    <h3 className="font-display font-black text-lg sm:text-xl text-white uppercase tracking-tight italic transition-colors group-hover:text-brand" id={`title-${event.id}`}>
                      {event.title}
                    </h3>
                  </div>

                  {/* Bottom details: Date & Entry limitation */}
                  <div className="space-y-3 pt-3 border-t border-white/5">
                    {/* Date label with calendar */}
                    <div className="flex items-center gap-1.5 text-xs text-brand font-mono font-bold uppercase tracking-wide">
                      <CalendarDays className="w-4 h-4 text-brand shrink-0" />
                      <span>{event.dateLabel}</span>
                      {isRegistered && (
                        <span className="text-[9px] bg-brand/10 border border-brand/30 text-brand px-1.5 py-0.2 rounded font-sans shrink-0 uppercase tracking-widest font-black ml-1">Вы в кругу</span>
                      )}
                    </div>

                    {/* Entry Threshold - STRICT MANDATORY INSTRUCTION */}
                    <div className="flex items-start gap-1.5 text-[10px] sm:text-xs text-white/60 font-sans leading-normal">
                      <ShieldAlert className="w-3.5 h-3.5 text-rose-450 shrink-0 mt-0.5" />
                      <p className="line-clamp-2">
                        <strong className="text-white/80 font-mono text-[9px] sm:text-[10px] uppercase font-bold pr-1">Порог входа:</strong>
                        {event.entryThreshold}
                      </p>
                    </div>
                  </div>

                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* Fly-out Maximum Details Modal */}
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
