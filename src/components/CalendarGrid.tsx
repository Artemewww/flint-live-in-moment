import React, { useState } from 'react';
import { CommunityEvent } from '../types';
import { Sparkles, Calendar, Compass, Info, Users, MapPin, Heart, X, ChevronRight, Lock } from 'lucide-react';

interface CalendarGridProps {
  events: CommunityEvent[];
  selectedEventId: string | null;
  onSelectEvent: (id: string | null) => void;
}

export default function CalendarGrid({ events, selectedEventId, onSelectEvent }: CalendarGridProps) {
  const [showYearModal, setShowYearModal] = useState(false);
  const [modalActiveMonth, setModalActiveMonth] = useState<number>(0);
  const [selectedDayEvents, setSelectedDayEvents] = useState<CommunityEvent[] | null>(null);

  const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

  // Динамическая дата «сегодня»
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-based
  const todayDayNum = now.getDate();
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Окторябрь', 'Ноябрь', 'Декабрь'];
  const currentMonthName = monthNames[currentMonth];
  const currentMonthStr = String(currentMonth + 1).padStart(2, '0');

  // Форматируем сегодняшнюю дату для сравнения
  const todayFormatted = `${currentYear}-${currentMonthStr}-${String(todayDayNum).padStart(2, '0')}`;

  // Helper to map current month day to event(s)
  const getEventsForDay = (dayNum: number): CommunityEvent[] => {
    const formattedDate = `${currentYear}-${currentMonthStr}-${dayNum.toString().padStart(2, '0')}`;
    return events.filter(evt => {
      if (evt.id === 'isloch-challenges-male') {
        return dayNum >= 26 && dayNum <= 28;
      }
      if (evt.id === 'conscious-fasting') {
        return dayNum >= 22 && dayNum <= 25;
      }
      return evt.date === formattedDate;
    });
  };

  // Human readable short Russian labels for different events
  const getShortEventName = (eventId: string, type: string): string => {
    if (eventId === 'banya-flint-weekly') return 'Баня';
    if (eventId === 'kettlebell-walk-weekly') return 'Гири';
    if (eventId === 'existential-cinema') return 'Кино';
    if (eventId === 'reading-smysly') return 'Книга';
    if (eventId === 'forest-hiking-isloch') return 'Поход';
    if (eventId === 'orator-art-practice') return 'Спич';
    if (eventId === 'poker-no-smoke') return 'Покер';
    if (eventId === 'isloch-challenges-male') return 'Лагерь';
    if (eventId === 'braslav-family-zen') return 'Слет';
    if (eventId === 'conscious-fasting' || eventId.startsWith('conscious-fasting')) return 'Голод';
    
    if (type === 'male') return 'Муж';
    if (type === 'mixed') return 'Микс';
    if (type === 'intellectual') return 'Ум';
    return 'Дзен';
  };

  const handleDayClick = (dayNum: number) => {
    const dayEvents = getEventsForDay(dayNum);
    if (dayEvents.length === 0) return;
    
    // Если одно событие — сразу открываем его детали
    if (dayEvents.length === 1) {
      onSelectEvent(dayEvents[0].id);
      const targetCard = document.getElementById(`event-card-${dayEvents[0].id}`);
      if (targetCard) {
        targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }
    
    // Если несколько — показываем список
    setSelectedDayEvents(dayEvents);
  };

  // Mock database for Year round planning
  const monthsData = [
    {
      name: 'Июнь 2026',
      days: 30,
      season: 'Лето 2026',
      startOffset: 0,
      focus: 'Мужской огонь & Лесные переходы',
      desc: 'Каноническая мужская баня Redhouse, походы по реке Ислочь, тренинги ораторов и запуск Braslav-слетов.',
      events: [
        { id: 'banya-flint-weekly', title: 'Мужская баня FLINT', day: 4, type: 'male', desc: 'Прогрев дубовыми вениками, закалка ледяной купелью.', duration: '19:00', label: 'Баня' },
        { id: 'kettlebell-walk-weekly', title: 'Гиревой вояж у воды', day: 6, type: 'active', desc: 'Утренняя силовая пробежка у Минского моря.', duration: '10:00', label: 'Гири' },
        { id: 'existential-cinema', title: 'Экзистенциальный Кинотеатр', day: 11, type: 'intellectual', desc: 'Рефлексия и глубокий разбор великих кинокартин.', duration: '19:30', label: 'Кино' },
        { id: 'reading-smysly', title: 'Читательский круг "Смыслы"', day: 14, type: 'intellectual', desc: 'Интеллектуальный разбор психологических трудов.', duration: '16:00', label: 'Книга' },
        { id: 'forest-hiking-isloch', title: 'Лесной поход к Ислочи', day: 19, type: 'active', desc: 'Проводники, дикий костер и лесные переходы.', duration: '08:00', label: 'Поход' },
        { id: 'orator-art-practice', title: 'Ораторский Orator-Практикум', day: 22, type: 'intellectual', desc: 'Раскрытие естественного голоса и искусство аргументов.', duration: '19:00', label: 'Спич' },
        { id: 'conscious-fasting', title: 'Осознанное голодание «Путь чистоты»', day: 22, type: 'active', desc: 'Телесный детокс от 2 до 4 дней в загородной тишине.', duration: '2-4 дня', label: 'Голод' },
        { id: 'poker-no-smoke', title: 'Покерный заезд "Трезвый круг"', day: 25, type: 'mixed', desc: 'Тлеющие угольки, мандарины, апельсиновый сок и глубокая математика.', duration: '18:00', label: 'Покер' },
        { id: 'isloch-challenges-male', title: 'Лагерь "Закалка" Ислочь', day: 26, type: 'male', desc: 'Мужские лесные перегрузки и банный ритуал возрождения.', duration: '3 дня', label: 'Лагерь' },
        { id: 'braslav-family-zen', title: 'Браславский Семейный Слет I', day: 29, type: 'mixed', desc: 'Уютный дзен у воды для резидентов и их семей.', duration: '2 дня', label: 'Слет' }
      ]
    },
    {
      name: 'Июль 2026',
      days: 31,
      season: 'Лето 2026',
      startOffset: 2,
      focus: 'Озера, Дзен & Каяки на рассвете',
      desc: 'Месяц тишины и уединения. Расширенные заезды на Браславские озера и палаточные лагеря в глубине пущи.',
      events: [
        { id: 'jul-braslav-family', title: 'Браславский Семейный Слет II', day: 10, type: 'mixed', desc: 'Семейная палаточная усадьба у озера, лекции о психогеографии.', duration: '3 дня', label: 'Слет' },
        { id: 'jul-kayaks', title: 'Сплав в молчании на каяках', day: 18, type: 'active', desc: 'Медитативный переход по зеркальной глади воды на рассвете.', duration: '05:00', label: 'Сплав' },
        { id: 'jul-flint-stars', title: 'Баня FLINT под звездами', day: 23, type: 'male', desc: 'Мужская перезагрузка под созвездиями на берегу реки.', duration: '19:00', label: 'Баня' },
        { id: 'jul-reading', title: 'Читательский круг "Рассвет"', day: 30, type: 'intellectual', desc: 'Книжный вечер у камина во флигеле.', duration: '19:00', label: 'Книга' }
      ]
    },
    {
      name: 'Август 2026',
      days: 31,
      season: 'Лето 2026',
      startOffset: 5,
      focus: 'Творческий синтез & Спичбатлы у костра',
      desc: 'Раскрытие естественного голоса, утренние пробежки босиком, трезвый покер и джем-сейшены у огня.',
      events: [
        { id: 'aug-orator', title: 'Летний Orator-Практикум', day: 7, type: 'intellectual', desc: 'Речевая харизма и снятие телесных зажимов у костра.', duration: '18:30', label: 'Спич' },
        { id: 'aug-poker', title: 'Покерный заезд "Трезвый круг"', day: 14, type: 'mixed', desc: 'Интеллектуальная колода карт и лесной дзен.', duration: '18:00', label: 'Покер' },
        { id: 'aug-banya', title: 'Мужское банное таинство', day: 20, type: 'male', desc: 'Мягкий глубокий пар в усадьбе с сеновалом.', duration: '19:00', label: 'Баня' },
        { id: 'aug-slet', title: 'Августовский слет у воды', day: 28, type: 'mixed', desc: 'Прощание с летом, теплый чай со специями у огня.', duration: '3 дня', label: 'Слет' }
      ]
    },
    {
      name: 'Сентябрь 2026',
      days: 30,
      season: 'Осень 2026',
      startOffset: 1,
      focus: 'Каминные круги, Чтение & Самопознание',
      desc: 'Перенос встреч в теплые загородные усадьбы с живым камином, упор на психологическую безопасность и чтение книг.',
      events: [
        { id: 'sep-reading', title: 'Читательский клуб СМЫСЛЫ', day: 3, type: 'intellectual', desc: 'Философский вечер при свечах.', duration: '19:00', label: 'Книга' },
        { id: 'sep-therapy', title: 'Парная терапия у камина', day: 17, type: 'mixed', desc: 'Психологическая рефлексия взаимопонимания в тепле камина.', duration: '18:00', label: 'Семинар' },
        { id: 'sep-flint', title: 'Баня Flint Осенний Жар', day: 24, type: 'male', desc: 'Горячий целебный пар для укрепления иммунитета осенью.', duration: '19:00', label: 'Баня' }
      ]
    }
  ];

  // Подсветка типа события для иконок
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
            setModalActiveMonth(0);
            setShowYearModal(true);
          }}
          className="bg-brand/10 border border-brand/35 hover:bg-brand hover:text-black hover:border-transparent text-brand transition-all text-[10px] font-mono uppercase tracking-wider py-2 px-4 rounded-full flex items-center gap-1.5 cursor-pointer"
        >
          <Sparkles className="w-3.5 h-3.5 text-brand" />
          <span className="hidden sm:inline">Смотреть на весь год</span>
          <span className="sm:hidden">Весь год</span>
        </button>
      </div>

      {/* Main Horizontal Scroll Container — только сегодня и будущие даты */}
      <div 
        id="calendar-horizontal-scroll" 
        className="h-[140px] bg-[#121212] border border-white/10 rounded-3xl flex items-center px-4 overflow-x-auto overflow-y-hidden scrollbar-none w-full gap-3 select-none"
      >
        {/* Показываем только даты с todayDayNum и до конца месяца */}
        {Array.from({ length: daysInMonth - todayDayNum + 1 }, (_, idx) => {
          const dayNum = todayDayNum + idx;
          const dayEvents = getEventsForDay(dayNum);
          const hasEvents = dayEvents.length > 0;
          const primaryEvent = dayEvents[0];
          const isSelected = primaryEvent && selectedEventId === primaryEvent.id;
          const weekdayIndex = (dayNum - 1) % 7;
          const weekday = weekdays[weekdayIndex];
          const isToday = dayNum === todayDayNum;

          return (
            <div 
              key={dayNum} 
              className="relative flex-shrink-0"
            >
              <button
                type="button"
                onClick={() => handleDayClick(dayNum)}
                className={`
                  h-[106px] w-[78px] rounded-2xl border flex flex-col justify-between items-center p-2 transition-all outline-none cursor-pointer relative
                  ${isToday
                    ? 'border-white/10 bg-[#161616] text-white'
                    : hasEvents && isSelected
                      ? 'border-brand/50 bg-brand/5 text-white'
                      : hasEvents
                        ? 'border-white/15 hover:border-brand/50 bg-[#161616] text-white hover:bg-[#1E1E1E]'
                        : 'border-transparent text-white/20 hover:bg-white/5 hover:text-white/50'
                  }
                `}
              >
                {/* TODAY pulsing dot — единственный акцент */}
                {isToday && (
                  <div className="absolute -top-0.5 -right-0.5 flex items-center justify-center" title="Сегодня">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand opacity-60"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-brand"></span>
                    </span>
                  </div>
                )}

                {/* Weekday — без акцента */}
                <span className="text-[8px] font-mono uppercase tracking-wider text-white/40">
                  {weekday}
                </span>

                {/* Day number — мягкая пульсация цифры */}
                <span className={`text-xl font-display font-black leading-none tracking-tight ${
                  isToday ? 'text-white animate-pulse' : ''
                }`}>
                  {dayNum}
                </span>

                {/* Event micro label */}
                {hasEvents ? (
                  <div className="flex flex-col items-center gap-0.5 w-full">
                    <span className="text-[8px] font-mono uppercase tracking-widest text-brand/90 font-black block text-center truncate max-w-full">
                      {getShortEventName(primaryEvent.id, primaryEvent.type)}
                      {dayEvents.length > 1 && `+${dayEvents.length - 1}`}
                    </span>
                    
                    {/* Circle indicators */}
                    <div className="flex gap-0.5 justify-center items-center h-1 mt-0.5">
                      {dayEvents.map((e, eIdx) => (
                        <span 
                          key={e.id + eIdx} 
                          className={`w-1 h-1 rounded-full ${getTypeColor(e.type)}`} 
                        />
                      ))}
                    </div>
                  </div>
                ) : (
                  <span className="text-[10px] font-mono text-white/5">ー</span>
                )}
              </button>
            </div>
          );
        })}
      </div>

      {/* Popup с событиями дня при клике на день с несколькими событиями */}
      {selectedDayEvents && selectedDayEvents.length > 0 && (
        <div className="bg-[#161616] border border-white/10 rounded-2xl p-4 relative">
          {/* Header */}
          <div className="flex items-center justify-between mb-3 pb-2 border-b border-white/5">
            <div className="flex items-center gap-2">
              <Calendar className="w-3.5 h-3.5 text-brand" />
              <span className="text-xs font-mono font-bold text-brand uppercase tracking-wider">
                {selectedDayEvents[0].dateLabel}
              </span>
              <span className="text-[10px] text-white/40 font-mono">
                {selectedDayEvents.length} {selectedDayEvents.length === 1 ? 'событие' : 'события'}
              </span>
            </div>
            <button
              onClick={() => setSelectedDayEvents(null)}
              className="text-white/30 hover:text-white p-1 rounded-lg hover:bg-white/5 transition-all cursor-pointer border-none bg-transparent"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* List of events for this day */}
          <div className="space-y-2">
            {selectedDayEvents.map((evt) => (
              <button
                key={evt.id}
                onClick={() => {
                  onSelectEvent(evt.id);
                  setSelectedDayEvents(null);
                  const targetCard = document.getElementById(`event-card-${evt.id}`);
                  if (targetCard) {
                    targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }
                }}
                className="w-full text-left bg-[#121212] hover:bg-brand/5 border border-white/5 hover:border-brand/30 rounded-xl p-3 transition-all flex items-center gap-3 cursor-pointer group"
              >
                {/* Type indicator */}
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
                  </div>
                </div>

                <ChevronRight className="w-4 h-4 text-white/20 group-hover:text-brand transition-colors shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* FULL-SCREEN YEAR MODAL */}
      {showYearModal && (
        <div className="fixed inset-0 z-55 flex items-center justify-center p-3 sm:p-4 bg-black/95 backdrop-blur-md" id="all-year-plan-modal">
          <div className="absolute inset-0" onClick={() => setShowYearModal(false)} />
          
          <div 
            className="bg-[#0b0b0b] rounded-3xl w-full max-w-5xl h-[95vh] sm:h-[90vh] shadow-2xl relative z-10 border border-white/10 flex flex-col overflow-hidden text-white font-sans"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="p-5 sm:p-6 border-b border-white/10 flex justify-between items-start bg-[#121212]">
              <div>
                <span className="text-[9px] uppercase font-mono font-black tracking-widest text-black bg-brand px-2.5 py-1 rounded-full inline-block mb-1.5">
                  Полный Сезон 2026
                </span>
                <h3 className="font-display font-black text-xl sm:text-3xl text-white uppercase tracking-tight">
                  План мероприятий
                </h3>
                <p className="text-xs text-brand/70 font-mono uppercase tracking-widest mt-0.5">
                  Трезвое Сообщество • Ударные направления круглый год
                </p>
              </div>
              
              <button 
                onClick={() => setShowYearModal(false)}
                className="p-1 px-3 py-1.5 rounded-xl text-white/40 hover:text-white hover:bg-white/5 transition-colors cursor-pointer border border-white/10 font-mono text-[10px] uppercase font-black bg-transparent"
              >
                Закрыть
              </button>
            </div>

            {/* MONTH SELECTOR */}
            <div className="bg-[#121212] border-b border-white/5 p-3 flex flex-wrap gap-2 justify-center">
              {monthsData.map((mObj, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setModalActiveMonth(idx)}
                  className={`px-4 py-2 rounded-full text-xs font-mono uppercase tracking-wider font-bold transition-all cursor-pointer ${
                    modalActiveMonth === idx
                      ? 'bg-brand text-black font-black' 
                      : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  {mObj.name}
                </button>
              ))}
            </div>

            {/* MODAL CONTENT */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
              
              <div className="bg-gradient-to-r from-[#161616] to-[#0A0A0A] rounded-2xl p-4 border border-white/10">
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <div>
                    <h4 className="text-lg font-black uppercase text-brand tracking-wide">{monthsData[modalActiveMonth].name}</h4>
                    <p className="text-xs text-white/40 uppercase font-mono tracking-wider mt-0.5">Фокус: {monthsData[modalActiveMonth].focus}</p>
                    <p className="text-sm text-white/80 leading-relaxed font-sans mt-2 max-w-xl">
                      {monthsData[modalActiveMonth].desc}
                    </p>
                  </div>
                </div>
              </div>

              {/* Month grid */}
              <div>
                <div className="grid grid-cols-4 sm:grid-cols-7 gap-2.5">
                  {Array.from({ length: monthsData[modalActiveMonth].startOffset }, (_, index) => (
                    <div key={`offset-${index}`} className="hidden sm:block h-[100px]" />
                  ))}

                  {Array.from({ length: monthsData[modalActiveMonth].days }, (_, idx) => {
                    const dayNum = idx + 1;
                    const monthEvents = monthsData[modalActiveMonth].events.filter(e => e.day === dayNum);
                    const hasEvt = monthEvents.length > 0;
                    const primaryEv = monthEvents[0];
                    
                    let cellBorderColor = 'border-white/5 bg-black/40';
                    
                    if (hasEvt) {
                      if (primaryEv.type === 'male') {
                        cellBorderColor = 'border-indigo-500/25 bg-indigo-500/10 hover:border-indigo-400';
                      } else if (primaryEv.type === 'intellectual') {
                        cellBorderColor = 'border-emerald-500/25 bg-emerald-500/10 hover:border-emerald-400';
                      } else if (primaryEv.type === 'active') {
                        cellBorderColor = 'border-rose-500/25 bg-rose-500/10 hover:border-rose-400';
                      } else {
                        cellBorderColor = 'border-brand/30 bg-brand/5 hover:border-brand';
                      }
                    }

                    return (
                      <button
                        key={`modal-day-${dayNum}`}
                        type="button"
                        onClick={() => {
                          if (hasEvt && modalActiveMonth === 0) {
                            const targetId = primaryEv.id.includes('conscious-fasting') ? 'conscious-fasting' : primaryEv.id;
                            onSelectEvent(targetId);
                            setShowYearModal(false);
                            setTimeout(() => {
                              const targetCard = document.getElementById(`event-card-${targetId}`);
                              if (targetCard) targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }, 100);
                          } else if (hasEvt) {
                            alert(`"${primaryEv.title}" в ${monthsData[modalActiveMonth].name}. Запись откроется ближе к дате. Следите в боте.`);
                          }
                        }}
                        className={`h-[100px] rounded-xl border p-2 flex flex-col justify-between text-left transition-all outline-none cursor-pointer ${cellBorderColor} hover:bg-white/5`}
                      >
                        <span className="text-[10px] font-mono font-bold text-white/50">
                          {weekdays[(idx + monthsData[modalActiveMonth].startOffset) % 7]}
                        </span>
                        <span className="text-xl font-display font-black leading-none text-white">
                          {dayNum}
                        </span>
                        {hasEvt && (
                          <span className="text-[8px] font-mono block truncate text-brand font-bold uppercase leading-none mt-1">
                            {primaryEv.label} {monthEvents.length > 1 && `+${monthEvents.length - 1}`}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Events list */}
              <div className="space-y-3">
                <h4 className="text-[10px] uppercase font-mono tracking-widest text-brand font-black">
                  Анонсы — {monthsData[modalActiveMonth].name}
                </h4>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {monthsData[modalActiveMonth].events.map((evt, eIdx) => (
                    <div 
                      key={eIdx}
                      className="bg-white/5 hover:bg-white/10 border border-white/5 rounded-xl p-4 text-xs transition-all"
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className={`w-1.5 h-1.5 rounded-full ${getTypeColor(evt.type)}`} />
                        <span className="font-bold text-white text-sm uppercase font-display">{evt.title}</span>
                      </div>
                      <span className="text-[10px] text-white/50 font-mono block">{evt.duration} • {evt.day} {monthsData[modalActiveMonth].name}</span>
                      <p className="text-[11px] text-white/60 leading-normal italic mt-1">{evt.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-5 border-t border-white/10 bg-[#121212] flex gap-3">
              <button 
                onClick={() => setShowYearModal(false)}
                className="flex-1 border border-white/15 py-3.5 rounded-xl text-xs font-bold uppercase tracking-widest text-white/70 hover:bg-white/5 transition-all cursor-pointer font-mono bg-transparent"
              >
                Закрыть
              </button>
              <a
                href="https://t.me/campsflint_bot"
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 bg-brand hover:bg-brand-hover text-black py-3.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all text-center flex items-center justify-center gap-2 shadow-md shadow-brand/10 cursor-pointer border-none"
              >
                <Compass className="w-4 h-4 text-black" />
                В бот
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}