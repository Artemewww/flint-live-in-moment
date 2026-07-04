import React, { useState } from 'react';
import { CommunityEvent } from '../types';
import { Sparkles, Calendar, Zap, Compass, Check, X, Shield, ArrowRight, Info, Users, MapPin, Heart } from 'lucide-react';

interface CalendarGridProps {
  events: CommunityEvent[];
  selectedEventId: string | null;
  onSelectEvent: (id: string | null) => void;
}

export default function CalendarGrid({ events, selectedEventId, onSelectEvent }: CalendarGridProps) {
  const [showYearModal, setShowYearModal] = useState(false);
  const [modalActiveMonth, setModalActiveMonth] = useState<number>(0); // 0=June, 1=July, 2=August, 3=September
  const [hoveredEvent, setHoveredEvent] = useState<CommunityEvent | null>(null);

  const daysInJune = 30;
  const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

  // Current simulated date is June 3, 2026
  const todayDayNum = 3;

  // Helper to map June day to event(s)
  const getEventsForDay = (dayNum: number): CommunityEvent[] => {
    const formattedDate = `2026-06-${dayNum.toString().padStart(2, '0')}`;
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

  // Mock database for Year round planning to render identical figures in full screen
  const monthsData = [
    {
      name: 'Июнь 2026',
      days: 30,
      season: 'Лето 2026',
      startOffset: 0, // Starts on Monday (Пн) 
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
        { id: 'conscious-fasting-23', title: 'Осознанное голодание (День 2)', day: 23, type: 'active', desc: 'Телесный детокс от 2 до 4 дней в загородной тишине.', duration: '2-4 дня', label: 'Голод' },
        { id: 'conscious-fasting-24', title: 'Осознанное голодание (День 3)', day: 24, type: 'active', desc: 'Телесный детокс от 2 до 4 дней в загородной тишине.', duration: '2-4 дня', label: 'Голод' },
        { id: 'conscious-fasting-25', title: 'Осознанное голодание (День 4)', day: 25, type: 'active', desc: 'Телесный детокс от 2 до 4 дней в загородной тишине.', duration: '2-4 дня', label: 'Голод' },
        { id: 'poker-no-smoke', title: 'Покерный заезд "Трезвый круг"', day: 25, type: 'mixed', desc: 'Тлеющие угольки, мандарины, апельсиновый сок и глубокая математика.', duration: '18:00', label: 'Покер' },
        { id: 'isloch-challenges-male', title: 'Лагерь "Закалка" Ислочь', day: 26, type: 'male', desc: 'Мужские лесные перегрузки и банный ритуал возрождения.', duration: '3 дня', label: 'Лагерь' },
        { id: 'isloch-challenges-male-27', title: 'Лагерь "Закалка" Ислочь (День 2)', day: 27, type: 'male', desc: 'Мужские лесные перегрузки и банный ритуал возрождения.', duration: '3 дня', label: 'Лагерь' },
        { id: 'isloch-challenges-male-28', title: 'Лагерь "Закалка" Ислочь (День 3)', day: 28, type: 'male', desc: 'Мужские лесные перегрузки и банный ритуал возрождения.', duration: '3 дня', label: 'Лагерь' },
        { id: 'braslav-family-zen', title: 'Браславский Семейный Слет I', day: 29, type: 'mixed', desc: 'Уютный дзен у воды для резидентов и их семей.', duration: '2 дня', label: 'Слет' }
      ]
    },
    {
      name: 'Июль 2026',
      days: 31,
      season: 'Лето 2026',
      startOffset: 2, // Starts on Wednesday (Ср)
      focus: 'Озера, Дзен & Каяки на рассвете',
      desc: 'Месяц тишины и уединения. Расширенные заезды на Браславские озера и палаточные лагеря в глубине пущи.',
      events: [
        { id: 'jul-braslav-family', title: 'Браславский Семейный Слет II', day: 10, type: 'mixed', desc: 'Семейная палаточная усадьба у озера, лекции о психогеографии.', duration: '3 дня', label: 'Слет' },
        { id: 'jul-braslav-family-2', title: 'Браславский Слет (День 2)', day: 11, type: 'mixed', desc: 'Семейная палаточная усадьба у озера.', duration: '3 дня', label: 'Слет' },
        { id: 'jul-kayaks', title: 'Сплав в молчании на каяках', day: 18, type: 'active', desc: 'Медитативный переход по зеркальной глади воды на рассвете.', duration: '05:00', label: 'Сплав' },
        { id: 'jul-flint-stars', title: 'Баня FLINT под звездами', day: 23, type: 'male', desc: 'Мужская перезагрузка под созвездиями на берегу реки.', duration: '19:00', label: 'Баня' },
        { id: 'jul-reading', title: 'Читательский круг "Рассвет"', day: 30, type: 'intellectual', desc: 'Книжный вечер у камина во флигеле.', duration: '19:00', label: 'Книга' }
      ]
    },
    {
      name: 'Август 2026',
      days: 31,
      season: 'Лето 2026',
      startOffset: 5, // Starts on Saturday (Сб)
      focus: 'Творческий синтез & Спичбатлы у костра',
      desc: 'Раскрытие естественного голоса, утренние пробежки босиком, трезвый покер и джем-сейшены у огня.',
      events: [
        { id: 'aug-orator', title: 'Летний Orator-Практикум', day: 7, type: 'intellectual', desc: 'Речевая харизма и снятие телесных зажимов у костра.', duration: '18:30', label: 'Спич' },
        { id: 'aug-poker', title: 'Покерный заезд "Трезвый круг"', day: 14, type: 'mixed', desc: 'Интеллектуальная колода карт и лесной дзен.', duration: '18:00', label: 'Покер' },
        { id: 'aug-banya', title: 'Мужское банное таинство', day: 20, type: 'male', desc: 'Мягкий глубокий пар в усадьбе с сеновалом.', duration: '19:00', label: 'Баня' },
        { id: 'aug-slet', title: 'Августовский слет у воды', day: 28, type: 'mixed', desc: 'Прощание с летом, теплый чай со специями у огня.', duration: '3 дня', label: 'Слет' },
        { id: 'aug-slet-2', title: 'Августовский слет у воды (День 2)', day: 29, type: 'mixed', desc: 'Warm tea and acoustic live sessions.', duration: '3 дня', label: 'Слет' }
      ]
    },
    {
      name: 'Сентябрь 2026',
      days: 30,
      season: 'Осень 2026',
      startOffset: 1, // Starts on Tuesday (Вт)
      focus: 'Каминные круги, Чтение & Самопознание',
      desc: 'Перенос встреч в теплые загородные усадьбы с живым камином, упор на психологическую безопасность и чтение книг.',
      events: [
        { id: 'sep-reading', title: 'Читательский клуб СМЫСЛЫ', day: 3, type: 'intellectual', desc: 'Философский вечер при свечах.', duration: '19:00', label: 'Книга' },
        { id: 'sep-therapy', title: 'Парная терапия у камина', day: 17, type: 'mixed', desc: 'Психологическая рефлексия взаимопонимания в тепле камина.', duration: '18:00', label: 'Семинар' },
        { id: 'sep-flint', title: 'Баня Flint Осенний Жар', day: 24, type: 'male', desc: 'Горячий целебный пар для укрепления иммунитета осенью.', duration: '19:00', label: 'Баня' }
      ]
    }
  ];

  return (
    <div className="space-y-4 font-sans">
      
      {/* Calendar Header Rail & Category Indicators (Legend) */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-3 px-1">
        <div className="space-y-1.5 scroll-m-2">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-brand animate-pulse" />
            <span className="text-[11px] font-mono uppercase tracking-widest text-[#E6FD3A] font-black">
              Июнь 2026
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            setModalActiveMonth(0); // June
            setShowYearModal(true);
          }}
          className="bg-brand/10 border border-brand/35 hover:bg-brand hover:text-black hover:border-transparent text-brand transition-all text-[10px] font-mono uppercase tracking-wider py-2 px-4 rounded-full flex items-center gap-1.5 cursor-pointer"
        >
          <Sparkles className="w-3.5 h-3.5 animate-spin-slow text-[#E6FD3A]" />
          Смотреть на весь год
        </button>
      </div>

      {/* Main Horizontal Scroll Container */}
      <div 
        id="calendar-horizontal-scroll" 
        className="h-[140px] bg-[#121212] border border-white/10 rounded-3xl flex items-center px-4 overflow-x-auto overflow-y-hidden scrollbar-none w-full gap-3 select-none"
      >
        {/* YEAR INTRO CARD */}
        <button
          type="button"
          onClick={() => setShowYearModal(true)}
          className="flex-shrink-0 h-[106px] w-[130px] rounded-2xl border border-dashed border-brand/30 hover:border-brand/90 bg-brand/5 hover:bg-brand/10 transition-all p-3 flex flex-col justify-between text-left cursor-pointer group outline-none"
        >
          <div className="bg-brand/10 w-7 h-7 rounded-lg flex items-center justify-center border border-brand/20 group-hover:scale-105 transition-transform">
            <Calendar className="w-3.5 h-3.5 text-brand" />
          </div>
          <div>
            <span className="text-[9px] font-mono uppercase tracking-wider text-brand block font-black">
              Весь 2026
            </span>
            <span className="text-[10px] text-white/70 block leading-tight mt-0.5">
              Смотреть планы и анонсы →
            </span>
          </div>
        </button>

        {/* JUNE DAY CARDS */}
        {Array.from({ length: daysInJune }, (_, idx) => {
          const dayNum = idx + 1;
          const dayEvents = getEventsForDay(dayNum);
          const hasEvents = dayEvents.length > 0;
          const primaryEvent = dayEvents[0];
          const isSelected = primaryEvent && selectedEventId === primaryEvent.id;
          const weekday = weekdays[idx % 7];
          const isToday = dayNum === todayDayNum;

          return (
            <div 
              key={dayNum} 
              className="relative flex-shrink-0"
              onMouseEnter={() => hasEvents && setHoveredEvent(primaryEvent)}
              onMouseLeave={() => setHoveredEvent(null)}
            >
              
              {/* Day card button (height: ~106px, perfect inside the 140px scroll container) */}
              <button
                type="button"
                onClick={() => {
                  if (hasEvents) {
                    const targetId = primaryEvent.id.includes('conscious-fasting') ? 'conscious-fasting' : primaryEvent.id;
                    onSelectEvent(targetId);
                    // Scroll to actual card below
                    const targetCard = document.getElementById(`event-card-${targetId}`);
                    if (targetCard) {
                      targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                  } else {
                    onSelectEvent(null);
                  }
                }}
                className={`
                  h-[106px] w-[78px] rounded-2xl border flex flex-col justify-between items-center p-2 transition-all outline-none cursor-pointer relative
                  ${hasEvents 
                    ? isSelected
                      ? 'border-brand bg-brand/10 text-white shadow-[0_0_15px_rgba(230,253,58,0.15)] font-bold'
                      : 'border-white/10 hover:border-brand/50 bg-[#161616] text-white hover:bg-[#1E1E1E]'
                    : 'border-transparent text-white/30 hover:bg-white/5 hover:text-white'
                  }
                `}
              >
                {/* Visual marker in the top part for "TODAY" with pulsing beacon */}
                {isToday && (
                  <div className="absolute top-1 right-1 flex items-center justify-center" title="Сегодня">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand opacity-80"></span>
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#E6FD3A]"></span>
                    </span>
                  </div>
                )}

                {/* Weekday indicator */}
                <span className={`text-[8px] font-mono uppercase tracking-wider ${isSelected ? 'text-[#E6FD3A] font-bold' : 'text-white/40'}`}>
                  {weekday}
                </span>

                {/* Day number */}
                <span className="text-xl font-display font-black leading-none tracking-tight">
                  {dayNum}
                </span>

                {/* Event micro title / caption */}
                {hasEvents ? (
                  <div className="flex flex-col items-center gap-0.5 w-full">
                    {/* Caption label under circles with + numbering if multiple events! */}
                    <span className="text-[8px] font-mono uppercase tracking-widest text-[#E6FD3A]/90 font-black block text-center truncate max-w-full">
                      {getShortEventName(primaryEvent.id, primaryEvent.type)}
                      {dayEvents.length > 1 && `+${dayEvents.length - 1}`}
                    </span>
                    
                    {/* Circle indicators */}
                    <div className="flex gap-0.5 justify-center items-center h-1 mt-0.5">
                      {dayEvents.map((e, eIdx) => {
                        let color = 'bg-[#E6FD3A]';
                        if (e.type === 'male') color = 'bg-indigo-400';
                        else if (e.type === 'intellectual') color = 'bg-emerald-400';
                        else if (e.type === 'active') color = 'bg-rose-450';
                        
                        return (
                          <span 
                            key={e.id + eIdx} 
                            className={`w-1 h-1 rounded-full ${color} ${isSelected ? 'scale-125' : ''}`} 
                          />
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <span className="text-[10px] font-mono text-white/10">ー</span>
                )}
              </button>
            </div>
          );
        })}
      </div>

      {/* DEDICATED HOVER/DASHBOARD PREVIEW BLOCK BELOW (Guarantees zero overlap issues!) */}
      <div className="min-h-[64px] bg-[#161616] border border-white/5 rounded-2xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
        {hoveredEvent ? (
          <>
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${
                  hoveredEvent.type === 'male' ? 'bg-indigo-400' :
                  hoveredEvent.type === 'intellectual' ? 'bg-emerald-400' :
                  hoveredEvent.type === 'active' ? 'bg-rose-455' : 'bg-[#E6FD3A]'
                }`} />
                <span className="text-[9px] font-mono uppercase tracking-wider text-brand/80">
                  {hoveredEvent.type === 'male' ? 'Мужской круг' : 
                   hoveredEvent.type === 'intellectual' ? 'Интеллектуальный круг' : 'Смешанный круг'}
                </span>
                <span className="text-[9px] font-mono text-white/40 uppercase bg-white/5 px-1.5 py-0.5 rounded">
                  {hoveredEvent.dateLabel}
                </span>
              </div>
              <h4 className="font-bold text-white uppercase text-sm font-display tracking-tight leading-none">
                {hoveredEvent.title}
              </h4>
              <p className="text-[11px] text-white/60 font-sans line-clamp-1 italic">
                {hoveredEvent.description}
              </p>
            </div>
            
            <div className="flex items-center gap-4 text-[10px] font-mono text-white/40 shrink-0">
              <span className="flex items-center gap-1 text-[#E6FD3A]">
                👥 {hoveredEvent.participantsCount} в кругу
              </span>
              <span>💰 {hoveredEvent.priceType === 'free' ? 'Донат' : 'Оплата'}</span>
              <span className="text-brand uppercase tracking-wider font-extrabold animate-pulse">
                Нажмите для просмотра подробностей ↓
              </span>
            </div>
          </>
        ) : (
          <div className="w-full flex items-center gap-2 text-white/40 font-mono text-[10px] uppercase tracking-wide">
            <Info className="w-3.5 h-3.5 text-brand/50 shrink-0" />
            <span>Наведите на любой заполненный день календаря или кликните по нему, чтобы моментально вывести карточку события</span>
          </div>
        )}
      </div>

      {/* FULL-SCREEN INTERACTIVE YEAR MODAL */}
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
                <span className="text-[9px] uppercase font-mono font-black tracking-widest text-black bg-[#E6FD3A] px-2.5 py-1 rounded-full inline-block mb-1.5">
                  Полный Весь 2026 Спланированный Сезон
                </span>
                <h3 className="font-display font-black text-xl sm:text-3xl text-white uppercase tracking-tight">
                  Интерактивный Годовой Сектор
                </h3>
                <p className="text-xs text-[#E6FD3A]/70 font-mono uppercase tracking-widest mt-0.5">
                  Трезвое Сообщество • Ударные направления круглый год
                </p>
              </div>
              
              <button 
                onClick={() => setShowYearModal(false)}
                className="p-1 px-3 py-1.5 rounded-xl text-white/40 hover:text-white hover:bg-white/5 transition-colors cursor-pointer border border-white/10 font-mono text-[10px] uppercase font-black"
              >
                Закрыть Режим
              </button>
            </div>

            {/* MONTH SELECTOR BAR */}
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
                  {mObj.name} • {mObj.season}
                </button>
              ))}
            </div>

            {/* MODAL MAIN LAYOUT: SPLIT VIEW GRID */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
              
              {/* CURRENT SELECTED MONTH CARD SUMMARY */}
              <div className="bg-gradient-to-r from-[#161616] to-[#0A0A0A] rounded-2xl p-4 border border-white/10">
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <div>
                    <h4 className="text-lg font-black uppercase text-[#E6FD3A] tracking-wide">{monthsData[modalActiveMonth].name}</h4>
                    <p className="text-xs text-white/40 uppercase font-mono tracking-wider mt-0.5">Фокус: {monthsData[modalActiveMonth].focus}</p>
                    <p className="text-sm text-white/80 leading-relaxed font-sans mt-2 max-w-xl">
                      {monthsData[modalActiveMonth].desc}
                    </p>
                  </div>
                  <div className="bg-[#E6FD3A]/5 border border-[#E6FD3A]/25 rounded-xl p-3.5 text-xs text-brand/90 max-w-sm">
                    💡 Кликните по дате с меткой, чтобы выбрать ее и посмотреть подробный план круга.
                  </div>
                </div>
              </div>

              {/* MONTH DAY GRID (Exactly same visual figures as horizontal layout, in adaptive bento grid format!) */}
              <div>
                <h4 className="text-[10px] uppercase font-mono tracking-widest text-white/40 mb-3 font-bold">
                  Интерактивная Сетка Дней — {monthsData[modalActiveMonth].name}
                </h4>
                
                <div className="grid grid-cols-4 sm:grid-cols-7 gap-2.5">
                  
                  {/* Empty offsets to align weekday columns correctly if desired */}
                  {Array.from({ length: monthsData[modalActiveMonth].startOffset }, (_, index) => (
                    <div key={`offset-${index}`} className="hidden sm:block h-[100px] bg-[#121212]/10 border border-transparent rounded-xl" />
                  ))}

                  {Array.from({ length: monthsData[modalActiveMonth].days }, (_, idx) => {
                    const dayNum = idx + 1;
                    
                    // Match events from our mock monthsDB
                    const monthEvents = monthsData[modalActiveMonth].events.filter(e => e.day === dayNum);
                    const hasEvt = monthEvents.length > 0;
                    const primaryEv = monthEvents[0];
                    
                    let cellBorderColor = 'border-white/5 bg-black/40 text-white/20';
                    let textAccentColor = 'text-white/30';
                    let dayColor = '';
                    
                    if (hasEvt) {
                      textAccentColor = 'text-[#E6FD3A] font-bold';
                      dayColor = 'text-white';
                      if (primaryEv.type === 'male') {
                        cellBorderColor = 'border-indigo-500/25 bg-indigo-505/10 hover:border-indigo-400 text-white';
                      } else if (primaryEv.type === 'intellectual') {
                        cellBorderColor = 'border-emerald-500/25 bg-emerald-505/10 hover:border-emerald-400 text-white';
                      } else if (primaryEv.type === 'active') {
                        cellBorderColor = 'border-rose-500/25 bg-rose-505/10 hover:border-rose-400 text-white';
                      } else {
                        cellBorderColor = 'border-[#E6FD3A]/30 bg-[#E6FD3A]/5 hover:border-[#E6FD3A] text-white';
                      }
                    }

                    return (
                      <button
                        key={`modal-day-${dayNum}`}
                        type="button"
                        onClick={() => {
                          if (hasEvt) {
                            // Close modal, select June event if June, or simply scroll
                            if (modalActiveMonth === 0) {
                              const targetId = primaryEv.id.includes('conscious-fasting') ? 'conscious-fasting' : primaryEv.id;
                              onSelectEvent(targetId);
                              setShowYearModal(false);
                              const targetCard = document.getElementById(`event-card-${targetId}`);
                              if (targetCard) {
                                setTimeout(() => targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
                              }
                            } else {
                              // If they clicked on other months, alert them and display details
                              alert(`Вы выбрали событие: "${primaryEv.title}" в будущем месяце (${monthsData[modalActiveMonth].name}). Календарь на этот месяц откроется для онлайн-бронирования совсем скоро! Можно записаться через Телеграм-Бот.`);
                            }
                          }
                        }}
                        className={`h-[100px] rounded-xl border p-2 flex flex-col justify-between text-left transition-all outline-none relative cursor-pointer ${cellBorderColor} hover:bg-white/5`}
                      >
                        <div className="flex justify-between items-start w-full">
                          <span className="text-[10px] font-mono font-bold text-white/50">
                            {weekdays[(idx + monthsData[modalActiveMonth].startOffset) % 7]}
                          </span>
                          <span className="text-xl font-display font-black leading-none">
                            {dayNum}
                          </span>
                        </div>

                        {hasEvt ? (
                          <div className="w-full">
                            <span className="text-[9px] font-mono block truncate text-[#E6FD3A] font-bold uppercase leading-none">
                              {primaryEv.label} {monthEvents.length > 1 && `+${monthEvents.length - 1}`}
                            </span>
                            <span className="text-[8px] text-white/50 block line-clamp-1 mt-0.5">
                              {primaryEv.title}
                            </span>
                          </div>
                        ) : (
                          <span className="text-[9px] text-white/5 font-mono">ー</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* LIST OF FUTURE EVENTS FOR CONVENIENCE */}
              <div className="space-y-3">
                <h4 className="text-[10px] uppercase font-mono tracking-widest text-[#E6FD3A] font-black">
                  Предварительный анонс сессий ({monthsData[modalActiveMonth].name})
                </h4>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {monthsData[modalActiveMonth].events.map((evt, eIdx) => (
                    <div 
                      key={eIdx}
                      className="bg-white/5 hover:bg-white/10 border border-white/5 rounded-xl p-4 flex justify-between items-center transition-all text-xs"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5">
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            evt.type === 'male' ? 'bg-indigo-400' :
                            evt.type === 'intellectual' ? 'bg-emerald-400' :
                            evt.type === 'active' ? 'bg-rose-455' : 'bg-[#E6FD3A]'
                          }`} />
                          <span className="font-bold text-white text-sm uppercase font-display block">{evt.title}</span>
                        </div>
                        <span className="text-[10px] text-white/50 font-mono block">Время: {evt.duration} • Число: {evt.day} {monthsData[modalActiveMonth].name}</span>
                        <p className="text-[11px] text-white/60 leading-normal italic">{evt.desc}</p>
                      </div>
                      
                      <span className="bg-[#E6FD3A]/10 text-[#E6FD3A] text-[9px] uppercase font-mono tracking-widest font-black px-2.5 py-1 rounded">
                        Доступен анонс
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-5 border-t border-white/10 bg-[#121212] flex flex-col sm:flex-row gap-3">
              <button 
                onClick={() => setShowYearModal(false)}
                className="flex-1 border border-white/15 py-3.5 rounded-xl text-xs font-bold uppercase tracking-widest text-white/70 hover:bg-white/5 transition-all cursor-pointer font-mono bg-transparent"
              >
                Вернуться на главную страницу
              </button>
              <a
                href="https://t.me/LiveInMomentBot?start=year_planning_modal"
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 bg-[#E6FD3A] hover:bg-[#d8ed31] text-black py-3.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all text-center flex items-center justify-center gap-2 shadow-md shadow-brand/10 hover:shadow-brand/20 cursor-pointer border-none"
              >
                <Compass className="w-4 h-4 text-black animate-spin-slow" />
                Подать экспресс-заявку на сезон в бот
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
