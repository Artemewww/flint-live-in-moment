import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  X, MapPin, Clock, Users, Sparkles, Check, Send, Calendar, ShieldCheck, Tag, Eye, Lock, Bell, Share2
} from 'lucide-react';
import { CommunityEvent, getYandexMapsUrl, getEventPhase, calculateDynamicPrice } from '../types';
import { getVectorIconByKey } from './VectorIcons';
import { submitInterest, submitVote } from '../api';
import { haptic, isAuthorized } from '../telegram';
import ProgramVoting from './ProgramVoting';

// Компонент динамической цены
function DynamicPrice({ event }: { event: CommunityEvent }) {
  const { price, label, factors } = calculateDynamicPrice(event);
  
  return (
    <div className="space-y-1">
      <div className="text-brand font-black text-lg">{label}</div>
      <div className="text-white/50 text-[10px]">
        {event.priceType === 'free' ? 'Полностью свободное участие' :
         event.priceType === 'conscience' ? 'Взнос на личное усмотрение' : 'Взнос на организационные расходы'}
      </div>
      {factors.length > 0 && (
        <div className="space-y-0.5 mt-1.5">
          {factors.map((factor, idx) => (
            <div key={idx} className="text-[9px] text-white/40 font-mono flex items-center gap-1">
              <span className="w-1 h-1 rounded-full bg-brand/60" />
              {factor}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface EventDetailModalProps {
  event: CommunityEvent;
  isRegistered: boolean;
  onClose: () => void;
  onRegisterClick: (event: CommunityEvent) => void;
}

export default function EventDetailModal({ 
  event, 
  isRegistered, 
  onClose, 
  onRegisterClick 
}: EventDetailModalProps) {
  const maxSpots = event.maxParticipants || 15;
  const totalRegistered = event.participantsCount + (isRegistered ? 1 : 0);
  const spotsRemaining = Math.max(0, maxSpots - totalRegistered);
  const spotsFull = spotsRemaining <= 0;
  const percentFull = Math.min(100, Math.floor((totalRegistered / maxSpots) * 100));
  const phase = getEventPhase(event);
  const isLocked = phase === 'locked';

  // Сигнал спроса «Мне интересно» → уходит организаторам в группу.
  const authorized = isAuthorized();
  const [interestSent, setInterestSent] = useState(false);
  const [interestSending, setInterestSending] = useState(false);
  const handleInterest = async () => {
    if (interestSending || interestSent) return;
    setInterestSending(true);
    await submitInterest(event.id, event.title);
    setInterestSending(false);
    setInterestSent(true);
    haptic('success');
  };

  // Six vectors of development reference
  const orderedKeys = ['foundation', 'wall', 'roof', 'decor', 'heat', 'life'] as const;
  const qualityInfo = {
    foundation: { label: 'Предназначение (Фундамент)', description: 'Осознание своей жизненной миссии, целей и глубокое понимание «Зачем ты здесь».' },
    wall: { label: 'Воля (Стены)', description: 'Сила характера, развитие мощной самодисциплины и энергии для преодоления преград.' },
    roof: { label: 'Совесть (Крыша)', description: 'Внутренний компас и нравственный щит. Защищает личность от разрушительных шагов.' },
    decor: { label: 'Творчество (Украшение)', description: 'Раскрытие уникального потенциала, эстетического взгляда и ораторской харизмы.' },
    heat: { label: 'Любовь (Тепло)', description: 'Эмпатия, подлинные партнерские узы Мужчины и Женщины, созидание душевного тепла.' },
    life: { label: 'Счастье (Жизнь в доме)', description: 'Гармония, состояние подлинного присутствия здесь и сейчас без фальшивых ролей.' }
  };

  // Prevent scroll behind modal
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" id="event-detail-modal-root">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/90 backdrop-blur-md"
        id="detail-backdrop"
      />

      {/* Detail Card Panel */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 30 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 30 }}
        transition={{ type: 'spring', damping: 25, stiffness: 350 }}
        className="bg-[#121212] rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden relative z-10 border border-white/10 flex flex-col max-h-[90vh] text-white"
        id="detail-card-panel"
      >
        {/* Floating Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-30 p-2.5 rounded-full bg-black/60 border border-white/10 hover:border-brand/40 text-white/70 hover:text-[#E6FD3A] hover:scale-105 transition-all outline-none cursor-pointer"
          title="Закрыть"
          id="detail-close-btn"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Scrollable Container */}
        <div className="overflow-y-auto w-full flex-grow scrollbar-none" id="detail-scroll-container">
          
          {/* Cover Hero Banner */}
          <div className="relative h-64 sm:h-80 w-full bg-black">
            <img 
              src={event.image} 
              alt={event.title}
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover brightness-[0.4] select-none pointer-events-none"
            />
            {/* Ambient gradients */}
            <div className="absolute inset-0 bg-gradient-to-t from-[#121212] via-[#121212]/30 to-black/50" />
            <div className="absolute bottom-6 left-6 right-6 space-y-2">
              <span className={`
                px-3 py-1 rounded-full text-[10px] font-bold font-mono uppercase tracking-widest inline-flex items-center gap-1.5 bg-black/75 border
                ${event.type === 'male' ? 'border-indigo-500/30 text-indigo-300' :
                  event.type === 'mixed' ? 'border-brand/35 text-brand' :
                  event.type === 'intellectual' ? 'border-emerald-500/30 text-emerald-300' : 'border-rose-500/30 text-rose-300'}
              `}>
                <span className={`w-1.5 h-1.5 rounded-full ${
                  event.type === 'male' ? 'bg-indigo-400' :
                  event.type === 'mixed' ? 'bg-brand' :
                  event.type === 'intellectual' ? 'bg-emerald-400' : 'bg-rose-400'
                }`} />
                {event.type === 'male' ? 'Мужское Братство' :
                  event.type === 'mixed' ? 'Смешанный Круг' :
                  event.type === 'intellectual' ? 'Интеллектуальный Клуб' : 'Активный Выезд'}
              </span>

              {isLocked && (
                <span className="px-3 py-1 rounded-full text-[10px] font-bold font-mono uppercase tracking-widest inline-flex items-center gap-1.5 bg-black/75 border border-brand/40 text-brand ml-2">
                  <Lock className="w-3 h-3" /> Скоро • набор ещё не открыт
                </span>
              )}

              <h2 className="font-display font-black text-2xl sm:text-4xl uppercase tracking-tight italic text-white max-w-xl leading-none">
                {event.title}
              </h2>
            </div>
          </div>

          {/* Grid of Essential Parameters */}
          <div className="p-6 space-y-6">
            
            {/* Time / Price / Location Info Blocks */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 font-mono text-xs">
              <div className="bg-white/5 border border-white/5 rounded-2xl p-4 flex gap-3 items-start">
                <Calendar className="w-5 h-5 text-brand shrink-0" />
                <div className="space-y-1">
                  <span className="text-white/40 uppercase text-[9px] tracking-wider block">ДАТА И ВРЕМЯ проведения</span>
                  <div className="text-white font-bold">{event.dateLabel}</div>
                  <div className="text-white/60 text-[10px]">{event.time}</div>
                </div>
              </div>

              {authorized ? (
                <a 
                  href={getYandexMapsUrl(event.location)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-white/5 border border-white/5 hover:border-[#E6FD3A]/40 hover:bg-white/10 rounded-2xl p-4 flex gap-3 items-start transition-all cursor-pointer group"
                  title="Поехать (Открыть в Яндекс Картах)"
                  id="location-yandex-link"
                >
                  <MapPin className="w-5 h-5 text-brand shrink-0 group-hover:scale-110 transition-transform" />
                  <div className="space-y-1 text-left">
                    <span className="text-[#E6FD3A] uppercase text-[9px] tracking-wider block font-bold flex items-center gap-1">
                      ЛОКАЦИЯ И СБОР • Яндекс Карты 🗺️
                    </span>
                    <div className="text-white font-bold group-hover:text-brand transition-colors underline decoration-brand/35">{event.location}</div>
                    {event.locationDetails && (
                      <div className="text-white/60 text-[10px] italic leading-normal">{event.locationDetails}</div>
                    )}
                  </div>
                </a>
              ) : (
                <div className="bg-white/5 border border-white/5 rounded-2xl p-4 flex gap-3 items-start opacity-60">
                  <Lock className="w-5 h-5 text-brand shrink-0" />
                  <div className="space-y-1 text-left">
                    <span className="text-white/40 uppercase text-[9px] tracking-wider block font-bold">
                      ЛОКАЦИЯ СКРЫТА 🔒
                    </span>
                    <div className="text-white/50 text-xs italic">
                      Точное место сбора станет доступно после подтверждения участия
                    </div>
                  </div>
                </div>
              )}

              <div className="bg-white/5 border border-white/5 rounded-2xl p-4 flex gap-3 items-start">
                <Tag className="w-5 h-5 text-brand shrink-0" />
                <div className="space-y-1">
                  <span className="text-white/40 uppercase text-[9px] tracking-wider block">УСЛОВИЯ УЧАСТИЯ</span>
                  <DynamicPrice event={event} />
                </div>
              </div>

              <div className="bg-white/5 border border-white/5 rounded-2xl p-4 flex gap-3 items-start">
                <Users className="w-5 h-5 text-brand shrink-0" />
                <div className="space-y-1 w-full">
                  <span className="text-white/40 uppercase text-[9px] tracking-wider block">СОСТОЯНИЕ МЕСТ</span>
                  <div className="text-white font-bold flex justify-between items-center w-full">
                    <span>Забронировано {totalRegistered} из {maxSpots}</span>
                    <span className="text-brand font-mono text-[10px]">{percentFull}%</span>
                  </div>
                  <div className="w-full bg-white/10 h-1 rounded-full mt-2 overflow-hidden">
                    <div className="bg-[#E6FD3A] h-full" style={{ width: `${percentFull}%` }} />
                  </div>
                </div>
              </div>
            </div>

            {/* Pain Point Solution Panel (PAIN) */}
            <div className="bg-white/5 border border-white/10 p-4.5 rounded-2xl flex items-start gap-3.5" id={`detail-pain-block-${event.id}`}>
              <div className="bg-[#E6FD3A]/10 border border-[#E6FD3A]/30 text-brand font-black text-[9px] px-2 py-0.5 rounded uppercase font-mono tracking-widest shrink-0 mt-0.5">
                ЗАПРОС
              </div>
              <div className="space-y-1">
                <span className="text-white/40 text-[9px] tracking-wider font-mono block uppercase">Решаемая проблема</span>
                <p className="italic font-sans text-xs sm:text-sm text-white/85 leading-relaxed">
                  « {event.painPoint} »
                </p>
              </div>
            </div>

            {/* Comprehensive Description */}
            <div className="space-y-2">
              <span className="text-white/40 text-[10px] tracking-widest font-mono block uppercase">ПОДРОБНЫЙ СЦЕНАРИЙ И СМЫСЛ ВСТРЕЧИ</span>
              <p className="font-sans text-sm text-white/80 leading-relaxed whitespace-pre-wrap">
                {event.description}
              </p>
            </div>

            {/* Hard Entry Threshold */}
            <div className="bg-rose-500/5 border border-rose-500/20 p-4 rounded-2xl flex gap-3.5 items-start">
              <ShieldCheck className="w-5 h-5 text-rose-450 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <span className="text-rose-400 text-[10px] tracking-wider font-mono block uppercase font-bold">Правила прохода & Порог входа</span>
                <p className="text-xs text-white/80 leading-relaxed font-sans font-medium">
                  {event.entryThreshold}
                </p>
              </div>
            </div>

            {/* Detailed Rules & Preparation */}
            {event.locationDetails && (
              <div className="bg-white/5 border border-white/10 p-4 rounded-2xl space-y-2">
                <span className="text-white/40 text-[10px] tracking-widest font-mono block uppercase">Подробные правила и подготовка</span>
                <p className="text-xs text-white/70 leading-relaxed font-sans">
                  {event.locationDetails}
                </p>
              </div>
            )}

            {/* Program Voting */}
            <ProgramVoting
              event={event}
              onVote={(eventId, option) => {
                submitVote(eventId, option);
                haptic('success');
              }}
            />

            {/* Vector Alignment Breakdown ("Дом Личности") */}
            <div className="space-y-3 pt-2">
              <div className="flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-[#E6FD3A]" />
                <span className="text-white/40 text-[10px] tracking-widest font-mono block uppercase">МАНИФЕСТ РАЗВИТИЯ «ДОМ ЛИЧНОСТИ»</span>
              </div>

              <div className="space-y-2">
                {orderedKeys.map(key => {
                  const isTrained = event.houseQualities.some(q => q.key === key);
                  
                  return (
                    <div 
                      key={key}
                      className={`
                        flex gap-3 p-3.5 rounded-2xl border transition-all
                        ${isTrained 
                          ? 'bg-[#E6FD3A]/5 border-[#E6FD3A]/20 text-white' 
                          : 'bg-black/20 border-white/5 opacity-40'
                        }
                      `}
                    >
                      <div className={`p-1.5 rounded-xl border shrink-0 flex items-center justify-center h-9 w-9 ${
                        isTrained 
                          ? 'bg-[#E6FD3A]/10 border-[#E6FD3A]/25 text-[#E6FD3A] drop-shadow-[0_0_8px_rgba(230,253,58,0.2)]' 
                          : 'bg-white/5 border-white/5 text-white/15'
                      }`}>
                        {getVectorIconByKey(key, false, 20)}
                      </div>

                      <div className="space-y-1 text-left">
                        <strong className={`block text-xs uppercase font-mono tracking-wide ${isTrained ? 'text-[#E6FD3A]' : 'text-white/80'}`}>
                          {key === 'foundation' ? '1. Предназначение (Фундамент)' :
                           key === 'wall' ? '2. Воля (Стены)' :
                           key === 'roof' ? '3. Совесть (Крыша)' :
                           key === 'decor' ? '4. Творчество (Украшение)' :
                           key === 'heat' ? '5. Любовь (Тепло)' : '6. Счастье (Жизнь в доме)'}
                          {isTrained && <span className="font-sans text-[10px] lowercase text-white/50 font-normal pl-1.5">(активно развивается)</span>}
                        </strong>
                        <p className="text-[11px] text-white/60 leading-normal font-sans">
                          {qualityInfo[key].description}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

          </div>
        </div>

        {/* Footer Registration Action Area */}
        <div className="p-6 border-t border-white/10 bg-[#161616] flex flex-col sm:flex-row gap-3 items-stretch justify-between snap-none">
          {phase === 'past' ? (
            /* Past event - feedback and share */
            <div className="flex flex-col sm:flex-row gap-2.5 items-stretch w-full">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  window.dispatchEvent(new CustomEvent('openFeedback', { detail: { eventId: event.id, eventTitle: event.title } }));
                }}
                className="flex-1 bg-brand/10 border border-brand/30 text-brand py-4 rounded-2xl text-xs font-bold uppercase tracking-widest hover:bg-brand/20 transition-colors cursor-pointer font-mono"
              >
                Оставить отзыв
              </button>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  window.dispatchEvent(new CustomEvent('openPoster', { detail: { eventId: event.id } }));
                }}
                className="flex-1 bg-white/5 border border-white/10 text-white/70 py-4 rounded-2xl text-xs font-bold uppercase tracking-widest hover:bg-white/10 hover:text-white transition-colors cursor-pointer font-mono flex items-center justify-center gap-2"
              >
                <Share2 className="w-4 h-4" />
                Поделиться
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex-1 border border-white/10 py-4 rounded-2xl text-xs font-bold uppercase tracking-widest text-[#FFF]/60 hover:bg-[#FFF]/5 transition-colors cursor-pointer font-mono bg-transparent"
              >
                Вернуться в каталог
              </button>
            </div>
          ) : isLocked ? (
            /* «Под замочком» — набор ещё не открыт */
            <div className="flex flex-col sm:flex-row gap-2.5 items-stretch w-full">
              <div className="bg-white/5 border border-white/10 rounded-2xl px-5 py-4 flex items-center justify-center gap-2.5 flex-grow text-white/70">
                <Lock className="w-4 h-4 text-brand shrink-0" />
                <span className="text-xs font-bold font-mono uppercase tracking-wider text-center">
                  {event.lockedHint || 'Набор скоро откроется'}
                </span>
              </div>
              <button
                type="button"
                onClick={handleInterest}
                disabled={interestSending || interestSent}
                className={`font-black font-mono text-xs py-4 px-6 rounded-2xl transition-all flex items-center justify-center gap-2 uppercase tracking-widest text-center border-none cursor-pointer ${
                  interestSent
                    ? 'bg-brand/15 text-brand border border-brand/30'
                    : 'bg-brand hover:bg-brand-hover text-black shadow-lg shadow-brand/10'
                }`}
              >
                {interestSent ? (
                  <><Check className="w-4 h-4 shrink-0" /> Интерес учтён</>
                ) : interestSending ? (
                  'Отправляем…'
                ) : (
                  <><Bell className="w-4 h-4 text-black shrink-0" /> Мне интересно</>
                )}
              </button>
            </div>
          ) : isRegistered ? (
            /* Already Registered */
            <div className="flex flex-col sm:flex-row gap-2.5 items-stretch w-full">
              <div className="bg-brand/10 border border-brand/30 rounded-2xl px-5 py-4 flex items-center justify-center gap-2.5 flex-grow">
                <Check className="w-4 h-4 text-brand stroke-[3px]" />
                <span className="text-xs font-bold text-brand font-mono uppercase tracking-wider">Ваше участие подтверждено! Вы в кругу</span>
              </div>
              <a
                href={`https://t.me/campsflint_bot?start=event_${event.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-[#E6FD3A] hover:bg-[#D4E825] text-black font-black font-mono text-xs py-4 px-6 rounded-2xl transition-all flex items-center justify-center gap-2 uppercase tracking-widest text-center shadow-lg shadow-brand/10"
              >
                ТГ-Бот флинта
                <Send className="w-4 h-4 text-black shrink-0" />
              </a>
            </div>
          ) : (
            /* Open for Registration */
            <>
              {event.needsOnboarding && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    // Открываем верификацию через App.tsx
                    window.dispatchEvent(new CustomEvent('openVerification', { detail: { eventId: event.id, eventTitle: event.title } }));
                  }}
                  className="flex-1 order-2 sm:order-1 border border-brand/30 py-4.5 rounded-2xl text-xs font-bold uppercase tracking-widest text-brand hover:bg-brand/10 transition-colors cursor-pointer font-mono bg-transparent"
                >
                  Пройти верификацию
                </button>
              )}

              <button
                type="button"
                onClick={onClose}
                className={`flex-1 order-${event.needsOnboarding ? '3' : '2'} sm:order-${event.needsOnboarding ? '2' : '1'} border border-white/10 py-4.5 rounded-2xl text-xs font-bold uppercase tracking-widest text-[#FFF]/60 hover:bg-[#FFF]/5 transition-colors cursor-pointer font-mono bg-transparent`}
              >
                Вернуться в каталог
              </button>

              <button
                onClick={() => {
                  onClose();
                  onRegisterClick(event);
                }}
                disabled={spotsFull}
                className={`
                  flex-1 order-${event.needsOnboarding ? '4' : '1'} sm:order-${event.needsOnboarding ? '3' : '2'} py-4.5 rounded-2xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all outline-none border-none cursor-pointer
                  ${spotsFull 
                    ? 'bg-white/5 text-white/30 cursor-not-allowed'
                    : 'bg-brand hover:bg-brand-hover text-black shadow-lg shadow-brand/10 active:scale-98'
                  }
                `}
              >
                {spotsFull ? (
                  <span>Все места заняты</span>
                ) : (
                  <>
                    Вступить в живой круг
                    <span>({spotsRemaining} мест)</span>
                  </>
                )}
              </button>
            </>
          )}
        </div>

      </motion.div>
    </div>
  );
}
