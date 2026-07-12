import React, { useState, useRef, useEffect, useCallback } from 'react';
import { CommunityEvent } from '../types';
import { Sparkles, Calendar, Users, X, ChevronRight, Lock, Image as ImageIcon } from 'lucide-react';

interface CalendarGridProps {
  events: CommunityEvent[];
  selectedEventId: string | null;
  onSelectEvent: (id: string | null) => void;
  onOpenDetail: (event: CommunityEvent | null) => void;
}

/** Правильное склонение слова «событие» для русского языка. */
function pluralEvents(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 19) return 'событий';
  if (mod10 >= 2 && mod10 <= 4) return 'события';
  if (mod10 === 1) return 'событие';
  return 'событий';
}

export default function CalendarGrid({ events, selectedEventId, onSelectEvent, onOpenDetail }: CalendarGridProps) {
  const [showYearModal, setShowYearModal] = useState(false);
  const [modalActiveMonth, setModalActiveMonth] = useState<number>(0);
  const [selectedDayEvents, setSelectedDayEvents] = useState<CommunityEvent[] | null>(null);
  /** Выбранный день внутри годового модала — раскрывает список событий под сеткой. */
  const [yearModalDayEvents, setYearModalDayEvents] = useState<CommunityEvent[] | null>(null);
  const [monthInfoOpen, setMonthInfoOpen] = useState<boolean>(false);
  /** Позиция стрелки-указателя (px от левого края контейнера). */
  const [arrowLeft, setArrowLeft] = useState<number | null>(null);
  /** Ref на контейнер скролла для вычисления позиции ячеек. */
  const scrollRef = useRef<HTMLDivElement>(null);
  /** Ref на плашку для автоскролла. */
  const popupRef = useRef<HTMLDivElement>(null);

  const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

  // Динамическая дата «сегодня»
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-based
  const todayDayNum = now.getDate();
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  const currentMonthName = monthNames[currentMonth];
  const currentMonthStr = String(currentMonth + 1).padStart(2, '0');

  const pad2 = (n: number) => String(n).padStart(2, '0');

  // События, попадающие на конкретную дату: честный диапазон date..dateEnd (§12.4)
  const eventsOnDate = (dateStr: string): CommunityEvent[] =>
    events.filter(evt => evt.date <= dateStr && dateStr <= (evt.dateEnd || evt.date));

  const getEventsForDay = (dayNum: number): CommunityEvent[] =>
    eventsOnDate(`${currentYear}-${currentMonthStr}-${pad2(dayNum)}`);

  const getWeekdayForDay = (dayNum: number): string => {
    const date = new Date(currentYear, currentMonth, dayNum);
    return weekdays[date.getDay() === 0 ? 6 : date.getDay() - 1];
  };

  // Находим ближайшее событие для сжатия пустых дней
  let nextEventDay: number | null = null;
  for (let d = todayDayNum; d <= daysInMonth; d++) {
    if (getEventsForDay(d).length > 0) {
      nextEventDay = d;
      break;
    }
  }
  const daysToNextEvent = nextEventDay ? nextEventDay - todayDayNum : 0;
  const useCompactMode = daysToNextEvent > 6;

  /** Любой клик по дате раскрывает нижний блок с событиями. */
  const handleDayClick = (dayNum: number) => {
    const dayEvents = getEventsForDay(dayNum);
    if (dayEvents.length === 0) return;
    setSelectedDayEvents(dayEvents);
  };

  // Автоскролл к плашке при её появлении
  useEffect(() => {
    if (selectedDayEvents && selectedDayEvents.length > 0 && popupRef.current) {
      setTimeout(() => {
        popupRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 50);
    }
  }, [selectedDayEvents]);

  // Вычисление позиции стрелки при клике
  const updateArrowPosition = useCallback((dayNum: number) => {
    if (!scrollRef.current) return;
    const container = scrollRef.current;
    const dayEl = container.querySelector(`[data-daynum="${dayNum}"]`) as HTMLElement | null;
    if (!dayEl) return;
    const containerRect = container.getBoundingClientRect();
    const dayRect = dayEl.getBoundingClientRect();
    const centerX = dayRect.left + dayRect.width / 2 - containerRect.left;
    setArrowLeft(centerX);
  }, []);

  // Перехватываем handleDayClick для обновления стрелки
  const onDayClick = (dayNum: number) => {
    handleDayClick(dayNum);
    updateArrowPosition(dayNum);
  };

  const openFromDayPopup = (evt: CommunityEvent) => {
    setSelectedDayEvents(null);
    onOpenDetail(evt);
  };

  // Годовой календарь
  const yearMonthKeys = new Set<string>();
  for (let m = currentMonth; m < 12; m++) yearMonthKeys.add(`${currentYear}-${pad2(m + 1)}`);
  events.forEach(evt => {
    const key = evt.date.slice(0, 7);
    if (key > `${currentYear}-12`) yearMonthKeys.add(key);
  });
  const yearMonths = [...yearMonthKeys].sort().map(key => {
    const [y, m] = key.split('-').map(Number);
    const monthIdx = m - 1;
    const monthEvents = events
      .filter(evt => evt.date.slice(0, 7) === key || (evt.dateEnd || '').slice(0, 7) === key)
      .sort((a, b) => a.date.localeCompare(b.date));
    return {
      key,
      name: `${monthNames[monthIdx]} ${y}`,
      days: new Date(y, m, 0).getDate(),
      startOffset: (new Date(y, monthIdx, 1).getDay() + 6) % 7,
      events: monthEvents,
    };
  });
  const activeYearMonth = yearMonths[Math.min(modalActiveMonth, yearMonths.length - 1)];

  const getTypeColor = (type: string) => {
    if (type === 'male') return 'bg-indigo-400';
    if (type === 'intellectual') return 'bg-emerald-400';
    if (type === 'active') return 'bg-rose-400';
    return 'bg-brand';
  };

  const getTypeTextColor = (type: string) => {
    if (type === 'male') return 'text-indigo-400';
    if (type === 'intellectual') return 'text-emerald-400';
    if (type === 'active') return 'text-rose-400';
    return 'text-brand';
  };

  const getTypeLabel = (type: string) => {
    if (type === 'male') return 'Мужской';
    if (type === 'intellectual') return 'Интеллект';
    if (type === 'active') return 'Актив';
    return 'Микс';
  };

  /** Карточка события с обложкой — для главной и годового модала. */
  const EventCard = ({ evt, onClick }: { evt: CommunityEvent; onClick: () => void }) => (
    <button
      onClick={onClick}
      className="w-full text-left bg-[#121212] hover:bg-brand/5 border border-white/5 hover:border-brand/30 rounded-xl p-3 transition-all flex items-center gap-3 cursor-pointer group"
    >
      {/* Обложка события */}
      <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl overflow-hidden shrink-0 bg-white/5 border border-white/10">
        {evt.image ? (
          <img src={evt.image} alt="" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-white/20">
            <ImageIcon className="w-5 h-5" />
          </div>
        )}
      </div>
      <div className={`w-1 h-8 rounded-full shrink-0 ${getTypeColor(evt.type)}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-[9px] font-mono uppercase tracking-wider font-bold ${getTypeTextColor(evt.type)}`}>
            {getTypeLabel(evt.type)}
          </span>
          {evt.status === 'locked' && (
            <span className="text-[8px] font-mono text-brand/60 flex items-center gap-0.5">
              <Lock className="w-2.5 h-2.5" /> Скоро
            </span>
          )}
        </div>
        <h4 className="text-sm font-bold text-white truncate group-hover:text-brand transition-colors">
          {evt.title}
        </h4>
        <div className="flex items-center gap-3 text-[10px] text-white/40 font-mono mt-0.5">
          <span className="flex items-center gap-1">
            <Users className="w-3 h-3" /> {evt.participantsCount}
          </span>
          <span>{evt.time}</span>
          {evt.dateEnd && evt.dateEnd !== evt.date && (
            <span className="text-brand/60">• {evt.dateLabel || `${evt.date}–${evt.dateEnd}`}</span>
          )}
        </div>
      </div>
      <ChevronRight className="w-4 h-4 text-white/20 group-hover:text-brand transition-colors shrink-0" />
    </button>
  );

  return (
    <div className="space-y-3 font-sans">
      
      {/* Calendar Header */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-brand" />
          <span className="text-[11px] font-mono uppercase tracking-widest text-brand font-black">
            {currentMonthName} {currentYear}
          </span>
        </div>

        <button
          type="button"
          onClick={() => {
            const now = new Date();
            const firstIdx = yearMonths.findIndex(m => {
              const [y, mon] = m.key.split('-').map(Number);
              return y > now.getFullYear() || (y === now.getFullYear() && mon - 1 >= now.getMonth());
            });
            setModalActiveMonth(firstIdx >= 0 ? firstIdx : 0);
            setShowYearModal(true);
          }}
          className="bg-brand/10 border border-brand/35 hover:bg-brand hover:text-black hover:border-transparent text-brand transition-all text-[10px] font-mono uppercase tracking-wider py-2 px-4 rounded-full flex items-center gap-1.5 cursor-pointer"
        >
          <Sparkles className="w-3.5 h-3.5 text-brand" />
          <span className="hidden sm:inline">Смотреть на весь год</span>
          <span className="sm:hidden">Весь год</span>
        </button>
      </div>

      {/* Main Horizontal Scroll Container */}
      <div className="relative">
        <div 
          ref={scrollRef}
          id="calendar-horizontal-scroll" 
          className="bg-[#121212] border border-white/10 rounded-3xl flex items-center px-3 sm:px-4 overflow-x-auto overflow-y-hidden scrollbar-none w-full gap-1.5 sm:gap-3 select-none"
          style={{ minHeight: 'fit-content', paddingTop: '10px', paddingBottom: '10px' }}
        >
          {Array.from({ length: daysInMonth - todayDayNum + 1 }, (_, idx) => {
            const dayNum = todayDayNum + idx;
            const dayEvents = getEventsForDay(dayNum);
            const hasEvents = dayEvents.length > 0;
            const primaryEvent = dayEvents[0];
            const isSelected = primaryEvent && selectedEventId === primaryEvent.id;
            const weekday = getWeekdayForDay(dayNum);
            const weekdayIndex = weekdays.indexOf(weekday);
            const isToday = dayNum === todayDayNum;
            const isWeekend = weekdayIndex === 5 || weekdayIndex === 6;
            const isPopupActive = selectedDayEvents && selectedDayEvents.some(e => dayEvents.some(d => d.id === e.id));

            return (
              <div 
                key={dayNum} 
                className="relative flex-shrink-0"
                data-daynum={dayNum}
              >
                {(() => {
                  const isEmpty = !hasEvents && !isToday;
                  const isBeforeNextEvent = nextEventDay !== null && dayNum < nextEventDay;
                  const isCompact = isEmpty && isBeforeNextEvent;
                  
                  return (
                    <button
                      type="button"
                      onClick={() => onDayClick(dayNum)}
                      className={`
                        rounded-2xl border flex flex-col justify-between items-center p-1.5 sm:p-2 transition-all outline-none cursor-pointer relative
                        ${isCompact ? 'h-[60px] w-[20px] sm:h-[80px] sm:w-[32px]' : 'h-[80px] w-[48px] sm:h-[106px] sm:w-[78px]'}
                        ${isToday
                          ? 'border-white/10 bg-[#161616] text-white'
                          : hasEvents && isSelected
                            ? 'border-brand/50 bg-brand/5 text-white'
                            : hasEvents
                              ? 'border-white/15 hover:border-brand/50 bg-[#161616] text-white hover:bg-[#1E1E1E]'
                              : isWeekend
                                ? 'border-transparent text-white/20 hover:bg-white/5 hover:text-white/50 bg-white/[0.02]'
                                : 'border-transparent text-white/20 hover:bg-white/5 hover:text-white/50'
                        }
                      `}
                    >
                      {isToday && (
                        <div className="absolute -top-0.5 -right-0.5 flex items-center justify-center" title="Сегодня">
                          <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand opacity-60"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-brand"></span>
                          </span>
                        </div>
                      )}

                      <span className={`font-mono uppercase tracking-wider ${
                        isCompact ? 'text-[6px] sm:text-[7px] text-white/30' : 'text-[7px] sm:text-[8px]'
                      } ${isWeekend ? 'text-rose-400/50' : 'text-white/40'}`}>
                        {weekday}
                      </span>

                      <span className={`font-display font-black leading-none tracking-tight ${
                        isCompact ? 'text-[10px] sm:text-[11px] text-white/40' : 'text-sm sm:text-xl'
                      } ${isToday ? 'text-white animate-pulse' : isWeekend ? 'text-rose-300/60' : ''}`}>
                        {dayNum}
                      </span>

                      {hasEvents ? (
                        <div className="flex gap-0.5 justify-center items-center">
                          {dayEvents.slice(0, 4).map((e, eIdx) => (
                            <span 
                              key={e.id + eIdx} 
                              className={`w-1 h-1 sm:w-1.5 sm:h-1.5 rounded-full ${getTypeColor(e.type)}`} 
                            />
                          ))}
                          {dayEvents.length > 4 && (
                            <span className="text-[6px] text-white/40 font-mono ml-0.5">+{dayEvents.length - 4}</span>
                          )}
                        </div>
                      ) : !isCompact && (
                        <span className="text-[8px] sm:text-[10px] font-mono text-white/5">ー</span>
                      )}
                    </button>
                  );
                })()}
              </div>
            );
          })}
        </div>

        {/* Стрелка-указатель — динамически позиционируется под активной ячейкой */}
        {selectedDayEvents && selectedDayEvents.length > 0 && arrowLeft !== null && (
          <div className="relative h-0" style={{ left: 0 }}>
            <div
              className="absolute w-0 h-0 border-l-[10px] border-r-[10px] border-b-[10px] border-l-transparent border-r-transparent border-b-brand/60 transition-all duration-200"
              style={{ left: arrowLeft - 10, top: '-2px' }}
            />
          </div>
        )}
      </div>

      {/* Popup с событиями дня — раскрывается при любом клике на дату с событиями */}
      {selectedDayEvents && selectedDayEvents.length > 0 && (
        <div ref={popupRef} className="bg-[#161616] border border-brand/20 rounded-2xl p-4 relative">
          <div className="flex items-center justify-between mb-3 pb-2 border-b border-white/5">
            <div className="flex items-center gap-2">
              <Calendar className="w-3.5 h-3.5 text-brand" />
              <span className="text-xs font-mono font-bold text-brand uppercase tracking-wider">
                {selectedDayEvents[0].dateLabel || selectedDayEvents[0].date}
              </span>
              <span className="text-[10px] text-white/40 font-mono">
                {selectedDayEvents.length} {pluralEvents(selectedDayEvents.length)}
              </span>
            </div>
            <button
              onClick={() => { setSelectedDayEvents(null); setArrowLeft(null); }}
              className="text-white/30 hover:text-white p-1 rounded-lg hover:bg-white/5 transition-all cursor-pointer border-none bg-transparent"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-2">
            {selectedDayEvents.map((evt) => (
              <EventCard key={evt.id} evt={evt} onClick={() => openFromDayPopup(evt)} />
            ))}
          </div>
        </div>
      )}

      {/* FULL-SCREEN YEAR MODAL */}
      {showYearModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-2 sm:p-3 bg-black/95 backdrop-blur-md" id="all-year-plan-modal">
          <div className="absolute inset-0" onClick={() => { setShowYearModal(false); setYearModalDayEvents(null); }} />
          
          <div 
            className="bg-[#0b0b0b] rounded-3xl w-full max-w-[95vw] sm:max-w-7xl h-[95vh] sm:h-[90vh] shadow-2xl relative z-10 border border-white/10 flex flex-col overflow-hidden text-white font-sans"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header — минималистичный */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 bg-[#121212] shrink-0">
              <h3 className="font-display font-black text-lg uppercase tracking-tight">
                План мероприятий
              </h3>
              <button 
                onClick={() => { setShowYearModal(false); setYearModalDayEvents(null); }}
                className="p-2 rounded-full text-white/40 hover:text-white hover:bg-white/5 transition-colors cursor-pointer bg-transparent border-none"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* MONTH SELECTOR */}
            <div className="bg-[#121212] border-b border-white/5 p-3 flex flex-wrap gap-2 justify-center shrink-0">
              {yearMonths.map((mObj, idx) => {
                const [y, mon] = mObj.key.split('-').map(Number);
                const isPast = y < currentYear || (y === currentYear && mon - 1 < currentMonth);
                return isPast ? null : (
                <button
                  key={idx}
                  type="button"
                  onClick={() => { setModalActiveMonth(idx); setYearModalDayEvents(null); }}
                  className={`px-4 py-2 rounded-full text-xs font-mono uppercase tracking-wider font-bold transition-all cursor-pointer ${
                    modalActiveMonth === idx
                      ? 'bg-brand text-black font-black'
                      : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  {mObj.name}
                </button>
                );
              })}
            </div>

            {/* MODAL CONTENT */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
              
              {activeYearMonth && (
              <>
              <div className="bg-gradient-to-r from-[#161616] to-[#0A0A0A] rounded-2xl px-4 py-2.5 border border-white/10">
                <button
                  type="button"
                  onClick={() => setMonthInfoOpen(o => !o)}
                  className="w-full flex items-center justify-between gap-3 cursor-pointer bg-transparent text-left"
                >
                  <h4 className="text-base font-black uppercase text-brand tracking-wide">{activeYearMonth.name}</h4>
                  <span className="shrink-0 text-white/40 text-[10px] font-mono uppercase tracking-wider flex items-center gap-1">
                    {activeYearMonth.events.length} {pluralEvents(activeYearMonth.events.length)}
                  </span>
                </button>
                {monthInfoOpen && (
                  <div className="mt-2 space-y-1.5">
                    <p className="text-sm text-white/80 leading-relaxed font-sans max-w-xl">
                      Нажми на день — увидишь список событий. Клик по событию откроет карточку.
                    </p>
                  </div>
                )}
              </div>

              {/* Month grid */}
              <div>
                <div className="grid grid-cols-4 sm:grid-cols-7 gap-2.5">
                  {Array.from({ length: activeYearMonth.startOffset }, (_, index) => (
                    <div key={`offset-${index}`} className="hidden sm:block h-[100px]" />
                  ))}

                  {Array.from({ length: activeYearMonth.days }, (_, idx) => {
                    const dayNum = idx + 1;
                    const dayStr = `${activeYearMonth.key}-${pad2(dayNum)}`;
                    const dayEvents = events.filter(evt => evt.date <= dayStr && dayStr <= (evt.dateEnd || evt.date));
                    const hasEvt = dayEvents.length > 0;
                    const isToday = activeYearMonth.key === `${currentYear}-${currentMonthStr}` && dayNum === todayDayNum;
                    
                    let cellBorderColor = 'border-white/5 bg-black/40';
                    
                    if (hasEvt) {
                      const type = dayEvents[0].type;
                      if (type === 'male') {
                        cellBorderColor = 'border-indigo-500/25 bg-indigo-500/10 hover:border-indigo-400';
                      } else if (type === 'intellectual') {
                        cellBorderColor = 'border-emerald-500/25 bg-emerald-500/10 hover:border-emerald-400';
                      } else if (type === 'active') {
                        cellBorderColor = 'border-rose-500/25 bg-rose-500/10 hover:border-rose-400';
                      } else {
                        cellBorderColor = 'border-brand/30 bg-brand/5 hover:border-brand';
                      }
                    }
                    if (yearModalDayEvents && yearModalDayEvents.some(e => dayEvents.some(d => d.id === e.id))) {
                      cellBorderColor = 'border-brand bg-brand/15';
                    }

                    return (
                      <button
                        key={`modal-day-${dayNum}`}
                        type="button"
                        onClick={() => {
                          if (!hasEvt) return;
                          setYearModalDayEvents(yearModalDayEvents?.length === dayEvents.length && yearModalDayEvents[0]?.id === dayEvents[0]?.id ? null : dayEvents);
                        }}
                        className={`h-[100px] rounded-xl border p-2 flex flex-col justify-between text-left transition-all outline-none cursor-pointer ${cellBorderColor} hover:bg-white/5 relative`}
                      >
                        {/* TODAY pulsing dot в годовом календаре */}
                        {isToday && (
                          <div className="absolute -top-0.5 -right-0.5 flex items-center justify-center" title="Сегодня">
                            <span className="relative flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand opacity-60"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-brand"></span>
                            </span>
                          </div>
                        )}
                        <span className="text-[10px] font-mono font-bold text-white/50">
                          {weekdays[(idx + activeYearMonth.startOffset) % 7]}
                        </span>
                        <span className={`text-xl font-display font-black leading-none ${isToday ? 'text-brand' : 'text-white'}`}>
                          {dayNum}
                        </span>
                        {hasEvt && (
                          <div className="flex flex-wrap gap-0.5 mt-auto pt-1">
                            {dayEvents.slice(0, 4).map((e, eIdx) => (
                              <span 
                                key={e.id + eIdx} 
                                className={`w-1.5 h-1.5 rounded-full ${getTypeColor(e.type)}`} 
                              />
                            ))}
                            {dayEvents.length > 4 && (
                              <span className="text-[6px] text-white/40 font-mono">+{dayEvents.length - 4}</span>
                            )}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Список событий выбранного дня (раскрывается внутри модала) — с обложками */}
              {yearModalDayEvents && yearModalDayEvents.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-[10px] uppercase font-mono tracking-widest text-brand font-black">
                      {yearModalDayEvents[0].dateLabel || yearModalDayEvents[0].date} · {yearModalDayEvents.length} {pluralEvents(yearModalDayEvents.length)}
                    </h4>
                    <button
                      onClick={() => setYearModalDayEvents(null)}
                      className="text-[9px] text-white/40 hover:text-white font-mono uppercase bg-transparent border-none cursor-pointer"
                    >
                      Скрыть
                    </button>
                  </div>
                  {yearModalDayEvents.map((evt) => (
                    <EventCard key={evt.id} evt={evt} onClick={() => {
                      onOpenDetail(evt);
                      setShowYearModal(false);
                      setYearModalDayEvents(null);
                    }} />
                  ))}
                </div>
              )}

              {/* Events list — все события месяца */}
              <div className="space-y-3">
                <h4 className="text-[10px] uppercase font-mono tracking-widest text-brand font-black">
                  Анонсы — {activeYearMonth.name}
                </h4>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {activeYearMonth.events.map((evt) => (
                    <div 
                      key={evt.id}
                      className="bg-white/5 hover:bg-white/10 border border-white/5 rounded-xl p-4 text-xs transition-all cursor-pointer"
                      onClick={() => {
                        onSelectEvent(evt.id);
                        setShowYearModal(false);
                        setYearModalDayEvents(null);
                        setTimeout(() => {
                          const targetCard = document.getElementById(`event-card-${evt.id}`);
                          if (targetCard) targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }, 100);
                      }}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className={`w-1.5 h-1.5 rounded-full ${getTypeColor(evt.type)}`} />
                        <span className="font-bold text-white text-sm uppercase font-display">{evt.title}</span>
                      </div>
                      <span className="text-[10px] text-white/50 font-mono block">
                        {evt.dateLabel || evt.date}{evt.time ? ` • ${evt.time}` : ''}
                      </span>
                      <p className="text-[11px] text-white/60 leading-normal italic mt-1">{evt.description}</p>
                    </div>
                  ))}
                </div>
              </div>
              </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}