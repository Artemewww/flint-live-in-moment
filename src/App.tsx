import React, { useState, useEffect } from 'react';
import { AnimatePresence } from 'motion/react';
import { 
  Heart, Compass, Calendar as CalendarIcon, UserCheck, Trash2, CheckCircle, 
  BookOpen, Info, ShieldCheck, HelpCircle, FileText, Sparkles, X
} from 'lucide-react';
import { INITIAL_EVENTS } from './data';
import { CommunityEvent, Registration } from './types';
import InfoSection from './components/InfoSection';
import EventFeed from './components/EventFeed';
import RegistrationModal from './components/RegistrationModal';
import EventDetailModal from './components/EventDetailModal';
import CalendarGrid from './components/CalendarGrid';
import { LogoMain, LogoEmblem, getVectorIconByKey } from './components/VectorIcons';

export default function App() {
  const [events, setEvents] = useState<CommunityEvent[]>(INITIAL_EVENTS);
  const [registeredEventIds, setRegisteredEventIds] = useState<string[]>([]);
  const [userRegistrations, setUserRegistrations] = useState<Registration[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [registeringEvent, setRegisteringEvent] = useState<CommunityEvent | null>(null);
  const [showMyRegistrationsModal, setShowMyRegistrationsModal] = useState<boolean>(false);
  const [showManifestoModal, setShowManifestoModal] = useState<boolean>(false);
  const [activeDetailEvent, setActiveDetailEvent] = useState<CommunityEvent | null>(null);

  // Load registration state from localStorage on init
  useEffect(() => {
    try {
      const savedIds = localStorage.getItem('moment_registered_event_ids');
      const savedRegs = localStorage.getItem('moment_user_registrations');
      
      if (savedIds) {
        setRegisteredEventIds(JSON.parse(savedIds));
      }
      if (savedRegs) {
        setUserRegistrations(JSON.parse(savedRegs));
      }
    } catch (err) {
      console.error('Failed to load local storage registrations', err);
    }
  }, []);

  // Save registration state to localStorage on update
  const saveToLocalStorage = (ids: string[], regs: Registration[]) => {
    try {
      localStorage.setItem('moment_registered_event_ids', JSON.stringify(ids));
      localStorage.setItem('moment_user_registrations', JSON.stringify(regs));
    } catch (err) {
      console.error('Failed to save to local storage', err);
    }
  };

  const handleRegistrationSuccess = (newReg: Registration) => {
    const updatedIds = [...registeredEventIds, newReg.eventId];
    const updatedRegs = [...userRegistrations, newReg];

    setRegisteredEventIds(updatedIds);
    setUserRegistrations(updatedRegs);
    saveToLocalStorage(updatedIds, updatedRegs);

    // Increment participants counter
    setEvents(prevEvents =>
      prevEvents.map(evt => {
        if (evt.id === newReg.eventId) {
          return {
            ...evt,
            participantsCount: evt.participantsCount + 1
          };
        }
        return evt;
      })
    );
  };

  const handleClearRegistrations = () => {
    if (window.confirm('Вы действительно хотите отменить все регистрации?')) {
      setRegisteredEventIds([]);
      setUserRegistrations([]);
      localStorage.removeItem('moment_registered_event_ids');
      localStorage.removeItem('moment_user_registrations');
      
      // Reset counters to defaults from data.ts
      setEvents(INITIAL_EVENTS);
      setShowMyRegistrationsModal(false);
    }
  };

  const handleDeleteRegistration = (eventId: string) => {
    if (window.confirm('Вы действительно хотите отменить участие в этом событии?')) {
      const updatedIds = registeredEventIds.filter(id => id !== eventId);
      const updatedRegs = userRegistrations.filter(reg => reg.eventId !== eventId);

      setRegisteredEventIds(updatedIds);
      setUserRegistrations(updatedRegs);
      saveToLocalStorage(updatedIds, updatedRegs);

      // Decrement participants counter
      setEvents(prevEvents =>
        prevEvents.map(evt => {
          if (evt.id === eventId) {
            return {
              ...evt,
              participantsCount: Math.max(0, evt.participantsCount - 1)
            };
          }
          return evt;
        })
      );

      if (updatedIds.length === 0) {
        setShowMyRegistrationsModal(false);
      }
    }
  };

  return (
    <div id="app-root" className="min-h-screen bg-[#0A0A0A] text-white font-sans selection:bg-brand/35 selection:text-white pb-12 antialiased">
      {/* Dynamic Glow Accents */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-brand/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-1/4 right-1/4 w-80 h-80 bg-brand/5 rounded-full blur-3xl pointer-events-none animate-pulse" />

      {/* Navigation Header */}
      <header className="sticky top-0 z-40 bg-[#0A0A0A]/90 backdrop-blur-md border-b border-white/10" id="main-navigation">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          
          {/* Logo element in Upper-Left corner */}
          <div className="flex items-center gap-3" id="header-brand-logo">
            <LogoMain size={38} className="cursor-pointer hover:opacity-90 select-none" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} />
            <div className="hidden md:block pl-3 border-l border-white/15">
              <span className="text-[10px] uppercase font-mono font-bold text-brand tracking-widest block">
                ЖИВОЕ СООБЩЕСТВО
              </span>
              <span className="text-[9px] text-white/40 font-mono tracking-widest uppercase">
                БЕЛАРУСЬ • МИНСК
              </span>
            </div>
          </div>

          {/* Core navigation controls / Trigger buttons */}
          <div className="flex items-center gap-4" id="nav-actions">
            
            {/* Manifesto button */}
            <button
              onClick={() => setShowManifestoModal(true)}
              className="px-3.5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border border-white/10 bg-white/5 hover:bg-white/10 hover:text-brand cursor-pointer flex items-center gap-2 font-mono h-10"
              id="show-manifesto-header-btn"
            >
              <BookOpen className="w-4 h-4 text-brand" />
              <span className="hidden sm:inline">Манифест</span>
            </button>

            {/* Persistent registrations manager */}
            {registeredEventIds.length > 0 && (
              <button
                onClick={() => setShowMyRegistrationsModal(true)}
                className="bg-[#151515] hover:bg-[#1C1C1C] border border-white/10 text-white px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer relative group h-10"
                id="my-regs-btn"
              >
                <UserCheck className="w-4 h-4 text-brand" />
                <span className="hidden sm:inline">Мои Участия</span>
                <span className="bg-brand text-black font-black text-[10px] w-5 h-5 rounded-full flex items-center justify-center">
                  {registeredEventIds.length}
                </span>
                
                {/* Micro-dot pulse indicator */}
                <span className="absolute -top-1 -right-1 flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-brand"></span>
                </span>
              </button>
            )}

            <a
              href="https://t.me/LiveInMomentBot"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-brand hover:bg-brand-hover text-black px-4.5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest transition-all flex items-center gap-2 cursor-pointer font-bold h-10 shadow-lg shadow-brand/10 hover:shadow-brand/20 active:scale-98"
              id="tg-bot-main-btn"
            >
              <span>В Бот</span>
              <span className="font-mono text-[9px] text-black/50 hidden sm:inline">@LiveInMomentBot</span>
            </a>
          </div>
        </div>
      </header>

      {/* Central Content Canvas */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-10 relative z-10" id="main-content">
        
        {/* Compact Calendar Grid with no headers */}
        <section id="calendar-widget-block" className="pt-2">
          <CalendarGrid 
            events={events} 
            selectedEventId={selectedEventId} 
            onSelectEvent={setSelectedEventId} 
          />
        </section>

        {/* Row 2: COMPONENT 2 - Featured Highlight Event Hero Card */}
        <section id="featured-hero-banner-block" className="pt-2">
          <InfoSection 
            events={events} 
            onRegisterClick={(evt) => setRegisteringEvent(evt)} 
            onOpenManifesto={() => setShowManifestoModal(true)}
            onOpenDetails={(evt) => setActiveDetailEvent(evt)}
          />
        </section>

        {/* Row 3: COMPONENT 3 - Event Listing Filter Catalog */}
        <section id="event-feed-catalog" className="pt-6 border-t border-white/10">
          <EventFeed 
            events={events} 
            registeredEventIds={registeredEventIds}
            onRegisterClick={(evt) => setRegisteringEvent(evt)}
            selectedEventId={selectedEventId}
          />
        </section>

      </main>

      {/* Footer Block: «100% Чистота» Principles reminder */}
      <footer id="footer-sauce" className="bg-brand border-t border-brand-hover text-black py-12 mt-16 relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 text-center space-y-6 relative z-10">
          <div className="space-y-3">
            <span className="text-[11px] font-mono font-black uppercase tracking-[0.25em] text-black/60 block">ЖИВИ В МОМЕНТЕ • НАШ СОУС</span>
            <p className="font-display font-black text-xl sm:text-2xl md:text-3xl text-black max-w-4xl mx-auto leading-tight uppercase tracking-tight">
              «Только живое общение. 100% Чистота. Без алкоголя и фальши. Равенство, искренность и поддержка каждого»
            </p>
          </div>

          <div className="border-t border-black/10 pt-6 flex flex-col sm:flex-row items-center justify-between text-[11px] text-black/85 font-mono gap-4" id="footer-fine-print">
            <div>
              <span className="font-bold">© {new Date().getFullYear()} LIVE IN MOMENT BELARUS — SELF-DEVELOPMENT THROUGH DIALOGUE</span>
            </div>
            <div className="flex gap-4 font-black">
              <button onClick={() => setShowManifestoModal(true)} className="hover:underline bg-transparent border-none text-black p-0 cursor-pointer uppercase tracking-wider font-mono font-bold">СПИСОК ВЕКТОРОВ</button>
              <span>•</span>
              <a href="https://t.me/LiveInMomentBot" className="hover:underline">ВСТУПИТЬ В БОТ</a>
            </div>
          </div>
        </div>
      </footer>

      {/* Popup Registration Modal Dialog */}
      {registeringEvent && (
        <RegistrationModal
          event={registeringEvent}
          onClose={() => setRegisteringEvent(null)}
          onSuccess={handleRegistrationSuccess}
        />
      )}

      {/* CUSTOM POPUP MODAL 1: Community Core Manifesto & House of Persona Vectors */}
      {showManifestoModal && (
        <div className="fixed inset-0 z-55 flex items-center justify-center p-4" id="manifesto-modal-root">
          <div className="absolute inset-0 bg-black/85 backdrop-blur-md" onClick={() => setShowManifestoModal(false)} />
          
          <div className="bg-[#121212] rounded-3xl w-full max-w-2xl shadow-2xl relative z-10 border border-white/10 max-h-[85vh] overflow-y-auto flex flex-col text-white">
            
            {/* Header */}
            <div className="p-6 border-b border-white/10 flex justify-between items-start bg-[#181818] sticky top-0 z-10">
              <div>
                <span className="text-[10px] uppercase font-mono font-bold tracking-widest text-[#000] bg-brand px-2.5 py-1 rounded-full inline-block mb-1.5">
                  Манифест Сообщества
                </span>
                <h3 className="font-display font-black text-2xl text-white uppercase tracking-tight">
                  Пространство Живого Общения
                </h3>
                <p className="text-xs text-brand font-mono uppercase tracking-widest mt-0.5">
                  Живи в моменте • Минск
                </p>
              </div>
              <button 
                onClick={() => setShowManifestoModal(false)}
                className="p-1 px-3 py-1.5 rounded-xl text-white/40 hover:text-white hover:bg-white/5 transition-colors cursor-pointer border border-white/10 font-mono text-[10px] uppercase font-black"
              >
                Закрыть
              </button>
            </div>

            {/* Inner Content */}
            <div className="p-6 space-y-6 text-sm leading-relaxed" id="manifesto-scroll-body">
              
              {/* Mission */}
              <div className="space-y-2">
                <h4 className="text-brand font-display font-black text-sm uppercase tracking-wider flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-brand" />
                  Кто мы и зачем мы собираемся?
                </h4>
                <p className="text-white/80 font-sans">
                  Мы строим сообщество осознанных людей в Беларуси. Место, где смывается привычная шелуха городских ролей. Наш фокус — здоровый отдых, глубокое психологическое развитие и неподдельная человеческая встреча мужчины и женщины.
                </p>
              </div>

              {/* Core Philosophy Pillar */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-white/10">
                <div className="bg-white/5 border border-white/5 rounded-2xl p-4 space-y-1.5">
                  <div className="text-[10px] text-brand uppercase font-mono font-bold tracking-widest">Культ Здоровья</div>
                  <div className="font-display font-black text-base uppercase text-white leading-tight">100% Чистота ума</div>
                  <p className="text-[11px] text-white/50 leading-normal">
                    Все перезагрузки проводятся без алкоголя, кальянов и измененных состояний сознания. Мы ищем настоящий дофамин присутствия.
                  </p>
                </div>

                <div className="bg-white/5 border border-white/5 rounded-2xl p-4 space-y-1.5">
                  <div className="text-[10px] text-brand uppercase font-mono font-bold tracking-widest">Инструмент силы</div>
                  <div className="font-display font-black text-base uppercase text-white leading-tight">Дом Личности</div>
                  <p className="text-[11px] text-white/50 leading-normal">
                    Каждое мероприятие клуба закаляет один из шести ключевых стержней характера (Предназначение, Воля, Совесть, Творчество, Любовь, Бытие).
                  </p>
                </div>
              </div>

              {/* The 6 Vectors breakdown */}
              <div className="space-y-4 pt-4 border-t border-white/15">
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#E6FD3A]" />
                  <span className="text-white/40 text-[10px] tracking-widest font-mono block uppercase">Векторы Развития (6 Стихий застройки)</span>
                </div>

                <div className="space-y-3">
                  {/* Style 0: Foundation */}
                  <div className="flex gap-3 p-3.5 rounded-2xl border transition-all bg-[#E6FD3A]/5 border-[#E6FD3A]/20 text-white">
                    <div className="p-1.5 rounded-xl border shrink-0 flex items-center justify-center h-9 w-9 bg-[#E6FD3A]/10 border-[#E6FD3A]/25 text-[#E6FD3A] drop-shadow-[0_0_8px_rgba(230,253,58,0.2)]">
                      {getVectorIconByKey('foundation', false, 20)}
                    </div>
                    <div className="space-y-1 text-left">
                      <strong className="block text-xs uppercase font-mono tracking-wide text-[#E6FD3A]">
                        1. Предназначение (Фундамент) — Вектор жизни
                      </strong>
                      <p className="text-[11px] text-white/70 leading-normal font-sans">
                        Осознание своей жизненной миссии, целей, глубокое понимание своего призвания и ориентиров в жизни.
                      </p>
                    </div>
                  </div>

                  {/* Style 1: Wall */}
                  <div className="flex gap-3 p-3.5 rounded-2xl border transition-all bg-[#E6FD3A]/5 border-[#E6FD3A]/20 text-white">
                    <div className="p-1.5 rounded-xl border shrink-0 flex items-center justify-center h-9 w-9 bg-[#E6FD3A]/10 border-[#E6FD3A]/25 text-[#E6FD3A] drop-shadow-[0_0_8px_rgba(230,253,58,0.2)]">
                      {getVectorIconByKey('wall', false, 20)}
                    </div>
                    <div className="space-y-1 text-left">
                      <strong className="block text-xs uppercase font-mono tracking-wide text-[#E6FD3A]">
                        2. Воля (Стены) — Мужской Дух
                      </strong>
                      <p className="text-[11px] text-white/70 leading-normal font-sans">
                        Плавление зажимов, баня дубовым веником, ледяная прорубь, честный разговор лицом к лицу без страха осуждений.
                      </p>
                    </div>
                  </div>

                  {/* Style 2: Roof */}
                  <div className="flex gap-3 p-3.5 rounded-2xl border transition-all bg-[#E6FD3A]/5 border-[#E6FD3A]/20 text-white">
                    <div className="p-1.5 rounded-xl border shrink-0 flex items-center justify-center h-9 w-9 bg-[#E6FD3A]/10 border-[#E6FD3A]/25 text-[#E6FD3A] drop-shadow-[0_0_8px_rgba(230,253,58,0.2)]">
                      {getVectorIconByKey('roof', false, 20)}
                    </div>
                    <div className="space-y-1 text-left">
                      <strong className="block text-xs uppercase font-mono tracking-wide text-[#E6FD3A]">
                        3. Совесть (Крыша) — Интеллект
                      </strong>
                      <p className="text-[11px] text-white/70 leading-normal font-sans">
                        Интеллектуальные дискуссионные баттлы, глубокий разбор прочитанного в читательском клубе, избавление от чужих клише.
                      </p>
                    </div>
                  </div>

                  {/* Style 3: Decor */}
                  <div className="flex gap-3 p-3.5 rounded-2xl border transition-all bg-[#E6FD3A]/5 border-[#E6FD3A]/20 text-white">
                    <div className="p-1.5 rounded-xl border shrink-0 flex items-center justify-center h-9 w-9 bg-[#E6FD3A]/10 border-[#E6FD3A]/25 text-[#E6FD3A] drop-shadow-[0_0_8px_rgba(230,253,58,0.2)]">
                      {getVectorIconByKey('decor', false, 20)}
                    </div>
                    <div className="space-y-1 text-left">
                      <strong className="block text-xs uppercase font-mono tracking-wide text-[#E6FD3A]">
                        4. Творчество (Декор) — Эстетика
                      </strong>
                      <p className="text-[11px] text-white/70 leading-normal font-sans">
                        Музыкальные джемы у ночного костра, лесные фотосессии, раскрытие природной харизмы и созидательность.
                      </p>
                    </div>
                  </div>

                  {/* Style 4: Heat */}
                  <div className="flex gap-3 p-3.5 rounded-2xl border transition-all bg-[#E6FD3A]/5 border-[#E6FD3A]/20 text-white">
                    <div className="p-1.5 rounded-xl border shrink-0 flex items-center justify-center h-9 w-9 bg-[#E6FD3A]/10 border-[#E6FD3A]/25 text-[#E6FD3A] drop-shadow-[0_0_8px_rgba(230,253,58,0.2)]">
                      {getVectorIconByKey('heat', false, 20)}
                    </div>
                    <div className="space-y-1 text-left">
                      <strong className="block text-xs uppercase font-mono tracking-wide text-[#E6FD3A]">
                        5. Любовь (Тепло) — Союз
                      </strong>
                      <p className="text-[11px] text-white/70 leading-normal font-sans">
                        Встречи мужчин и женщин в смешанных группах. Зеркало подсознания, построение гармоничных искренних союзов.
                      </p>
                    </div>
                  </div>

                  {/* Style 5: Life */}
                  <div className="flex gap-3 p-3.5 rounded-2xl border transition-all bg-[#E6FD3A]/5 border-[#E6FD3A]/20 text-white">
                    <div className="p-1.5 rounded-xl border shrink-0 flex items-center justify-center h-9 w-9 bg-[#E6FD3A]/10 border-[#E6FD3A]/25 text-[#E6FD3A] drop-shadow-[0_0_8px_rgba(230,253,58,0.2)]">
                      {getVectorIconByKey('life', false, 20)}
                    </div>
                    <div className="space-y-1 text-left">
                      <strong className="block text-xs uppercase font-mono tracking-wide text-[#E6FD3A]">
                        6. Счастье (Дзен / Жизнь в доме) — Бытие
                      </strong>
                      <p className="text-[11px] text-white/70 leading-normal font-sans">
                        Медитации в тишине на каяках сплава, лесной трекинг, чистый воздух, слияние с естественными биоритмами Земли.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Bot callout */}
              <div className="p-4 bg-brand/5 border border-brand/20 rounded-2xl flex items-start gap-3 text-xs text-brand leading-relaxed">
                <ShieldCheck className="w-5 h-5 shrink-0" />
                <div className="text-white/80">
                  <strong className="text-brand block uppercase tracking-wide font-bold mb-0.5">Готовы стать частью живого круга?</strong>
                  Активируйте нашего Telegram бота, чтобы пройти анкету соответствия ценностям сообщества и забронировать билет.
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="p-6 border-t border-white/10 bg-[#161616] flex flex-col sm:flex-row gap-3">
              <button 
                onClick={() => setShowManifestoModal(false)}
                className="flex-1 border border-white/15 py-3 rounded-xl text-xs font-bold uppercase tracking-widest text-white/70 hover:bg-white/5 transition-colors cursor-pointer font-mono bg-transparent"
              >
                Вернуться на главную
              </button>
              <a
                href="https://t.me/LiveInMomentBot"
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 bg-brand hover:bg-brand-hover text-black py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all text-center flex items-center justify-center gap-1 shadow-md shadow-brand/10 hover:shadow-brand/20 cursor-pointer"
              >
                Запустить бот
              </a>
            </div>
          </div>
        </div>
      )}

      {/* CUSTOM: User Registrations Manager Modal */}
      {showMyRegistrationsModal && (
        <div className="fixed inset-0 z-55 flex items-center justify-center p-4" id="regs-modal-root">
          <div className="absolute inset-0 bg-black/85 backdrop-blur-sm" onClick={() => setShowMyRegistrationsModal(false)} />
          
          <div className="bg-[#121212] rounded-3xl w-full max-w-md shadow-2xl relative z-10 border border-white/10 p-6 space-y-5 text-white">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div>
                <h3 className="font-display font-black text-lg text-white uppercase tracking-wider">Календарный План</h3>
                <p className="text-xs text-brand font-mono uppercase tracking-widest mt-0.5">ВЫ ПОДТВЕРДИЛИ УЧАСТИЕ</p>
              </div>
              <button 
                onClick={() => setShowMyRegistrationsModal(false)}
                className="text-white/40 hover:text-white font-mono uppercase tracking-wider text-xs cursor-pointer border-none bg-transparent"
              >
                Закрыть
              </button>
            </div>

            <div className="space-y-3 max-h-60 overflow-y-auto pr-1" id="saved-regs-details">
              {userRegistrations.map((reg, idx) => {
                const targetEvent = events.find(e => e.id === reg.eventId);
                if (!targetEvent) return null;
                return (
                  <div key={`${reg.eventId}-${idx}`} className="bg-[#181818] rounded-2xl p-4 border border-white/5 flex justify-between items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold text-white uppercase truncate">{targetEvent.title}</div>
                      <div className="text-[10px] text-brand font-mono uppercase tracking-wide mt-1">{targetEvent.dateLabel}</div>
                      <div className="text-[10px] text-white/40 mt-0.5 truncate">Локация: {targetEvent.location}</div>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <span className="bg-brand/15 text-brand border border-brand/25 text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider font-mono">Активен</span>
                      <button
                        onClick={() => handleDeleteRegistration(reg.eventId)}
                        className="text-rose-400 hover:text-rose-300 p-1 px-2 rounded hover:bg-rose-500/10 transition-colors border-none bg-transparent cursor-pointer flex items-center gap-1 text-[9px] uppercase font-mono font-bold"
                        title="Удалить из моих регистраций"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Удалить</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="pt-4 border-t border-white/10 flex flex-col gap-2 font-mono">
              <button
                onClick={handleClearRegistrations}
                className="w-full border border-rose-500/30 hover:bg-rose-500/10 text-rose-400 py-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer bg-transparent"
                id="delete-all-regs-btn"
              >
                <Trash2 className="w-4 h-4" />
                Сбросить мои регистрации
              </button>
              <button
                onClick={() => setShowMyRegistrationsModal(false)}
                className="w-full bg-brand text-black hover:bg-brand-hover transition-colors py-3 rounded-xl text-xs font-bold uppercase tracking-widest cursor-pointer border-none"
              >
                Вернуться к событиям
              </button>
            </div>
          </div>
        </div>
      )}
      {/* FLY-OUT DETAILS MODAL FROM HERO ACTIONS */}
      {activeDetailEvent && (
        <EventDetailModal
          event={activeDetailEvent}
          isRegistered={registeredEventIds.includes(activeDetailEvent.id)}
          onClose={() => setActiveDetailEvent(null)}
          onRegisterClick={(evt) => setRegisteringEvent(evt)}
        />
      )}
    </div>
  );
}
