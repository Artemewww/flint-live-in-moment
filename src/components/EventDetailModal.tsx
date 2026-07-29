import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  X, MapPin, Clock, Users, Sparkles, Check, Send, Calendar, ShieldCheck, Tag, Eye, Lock, Bell, Share2, Monitor, Wifi, Smartphone
} from 'lucide-react';
import { CommunityEvent, getYandexMapsUrl, getEventPhase, calculateDynamicPrice, getToday } from '../types';
import { getVectorIconByKey } from './VectorIcons';
import { submitInterest, submitVote } from '../api';
import { haptic } from '../telegram';
import ProgramVoting from './ProgramVoting';
import { getEventGuide } from '../eventGuide';

// --- .ics (self-contained, data-URI) ---
const pad = (n: number) => String(n).padStart(2, '0');
const icsEscape = (s: string) =>
  String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
function icsAddDayCompact(ymd: string): string {
  const dt = new Date(`${ymd}T00:00:00`);
  dt.setDate(dt.getDate() + 1);
  return `${dt.getFullYear()}${pad(dt.getMonth() + 1)}${pad(dt.getDate())}`;
}
/** Собирает .ics data-URI из даты/времени события. Точную локацию кладём только зарегистрированным. */
function buildIcsDataUri(event: CommunityEvent, includeLocation: boolean): string {
  const start = (event.date || '').replace(/-/g, '');
  // Время берём только для однодневных (у диапазона — событие «на весь день»).
  const m = !event.dateEnd ? `${event.time} ${event.dateLabel}`.match(/(\d{1,2}):(\d{2})/) : null;
  let dtStart: string, dtEnd: string;
  if (m) {
    const sh = Number(m[1]);
    const sm = m[2];
    dtStart = `DTSTART:${start}T${pad(sh)}${sm}00`;
    const me = (event.timeEnd || '').match(/(\d{1,2}):(\d{2})/);
    dtEnd = `DTEND:${start}T${me ? pad(Number(me[1])) + me[2] : pad((sh + 3) % 24) + sm}00`;
  } else {
    dtStart = `DTSTART;VALUE=DATE:${start}`;
    dtEnd = `DTEND;VALUE=DATE:${icsAddDayCompact(event.dateEnd || event.date)}`;
  }
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//FLINT//RU', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT', `UID:${event.id}@flint`, dtStart, dtEnd,
    `SUMMARY:${icsEscape(event.title)}`,
    `DESCRIPTION:${icsEscape(`${event.painPoint || ''}\nБот: https://t.me/campsflint_bot?start=event_${event.id}`)}`,
    includeLocation && event.location ? `LOCATION:${icsEscape(event.location)}` : '',
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean);
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(lines.join('\r\n'))}`;
}

// Компонент динамической цены
function DynamicPrice({ event }: { event: CommunityEvent }) {
  const { price, label, factors } = calculateDynamicPrice(event);
  
  return (
    <div className="space-y-1">
      <div className="text-brand font-black text-lg">{label}</div>
      <div className="text-white/50 text-[10px]">
        {event.priceType === 'free' ? 'Полностью свободное участие' : 'Взнос на аренду — делится поровну на всех'}
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

// --- Погода (open-meteo, без ключа, запрос из браузера) ---
const WMO: Record<number, { icon: string; label: string }> = {
  0: { icon: '☀️', label: 'Ясно' }, 1: { icon: '🌤', label: 'Малооблачно' },
  2: { icon: '⛅️', label: 'Облачно' }, 3: { icon: '☁️', label: 'Пасмурно' },
  45: { icon: '🌫', label: 'Туман' }, 48: { icon: '🌫', label: 'Изморозь' },
  51: { icon: '🌦', label: 'Морось' }, 53: { icon: '🌦', label: 'Морось' }, 55: { icon: '🌦', label: 'Морось' },
  61: { icon: '🌧', label: 'Дождь' }, 63: { icon: '🌧', label: 'Дождь' }, 65: { icon: '🌧', label: 'Ливень' },
  71: { icon: '🌨', label: 'Снег' }, 73: { icon: '🌨', label: 'Снег' }, 75: { icon: '❄️', label: 'Снегопад' },
  80: { icon: '🌦', label: 'Ливни' }, 81: { icon: '🌧', label: 'Ливни' }, 82: { icon: '⛈', label: 'Ливни' },
  95: { icon: '⛈', label: 'Гроза' }, 96: { icon: '⛈', label: 'Гроза' }, 99: { icon: '⛈', label: 'Гроза с градом' },
};
function WeatherBlock({ event }: { event: CommunityEvent }) {
  const [data, setData] = useState<any>(null);
  const lat = event.coordinates?.lat;
  const lng = event.coordinates?.lng;
  useEffect(() => {
    if (!lat || !lng) return;
    const start = event.date;
    const end = event.dateEnd || event.date;
    const today = getToday();
    if (!start || start < today) return;
    const daysAhead = (new Date(`${start}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86400000;
    if (daysAhead > 15) return; // open-meteo прогноз ~16 дней
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode&timezone=auto&start_date=${start}&end_date=${end}`;
    fetch(url).then((r) => r.json()).then(setData).catch(() => {});
  }, [lat, lng, event.date, event.dateEnd]);

  if (!data?.daily?.time?.length) return null;
  const d = data.daily;
  const maxRain = Math.max(...((d.precipitation_probability_max as number[]) || [0]));
  return (
    <div className="bg-white/5 border border-white/10 p-4 rounded-2xl space-y-2.5">
      <span className="text-brand text-[10px] tracking-widest font-mono block uppercase font-bold">🌦 Погода на даты</span>
      <div className="flex gap-2 overflow-x-auto scrollbar-none">
        {(d.time as string[]).map((t, i) => {
          const w = WMO[d.weathercode[i]] || { icon: '🌡', label: '' };
          return (
            <div key={t} className="shrink-0 bg-black/25 border border-white/5 rounded-xl px-3 py-2 text-center min-w-[74px]">
              <div className="text-[10px] text-white/50">{new Date(`${t}T00:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</div>
              <div className="text-xl leading-tight my-0.5" title={w.label}>{w.icon}</div>
              <div className="text-xs font-bold text-white">{Math.round(d.temperature_2m_max[i])}°<span className="text-white/40">/{Math.round(d.temperature_2m_min[i])}°</span></div>
              <div className="text-[9px] text-sky-300/80">💧 {d.precipitation_probability_max[i]}%</div>
            </div>
          );
        })}
      </div>
      {maxRain >= 60 && <p className="text-[11px] text-amber-400">☔️ Высокая вероятность дождя — возьми дождевик.</p>}
    </div>
  );
}

interface EventDetailModalProps {
  event: CommunityEvent;
  isRegistered: boolean;
  /** Уже принят в клуб — тогда «верификацию» не показываем. */
  isClubMember?: boolean;
  onClose: () => void;
  onRegisterClick: (event: CommunityEvent) => void;
}

export default function EventDetailModal({
  event,
  isRegistered,
  isClubMember,
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
  const guide = getEventGuide(event);

  // Сигнал спроса «Мне интересно» → уходит организаторам в группу.
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
    <div className="fixed inset-0 z-50 flex items-center justify-center md:p-4" id="event-detail-modal-root">
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
        className="bg-[#121212] md:rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden relative z-10 md:border md:border-white/10 flex flex-col h-[100dvh] md:h-auto md:max-h-[90vh] text-white"
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
          
          {/* Cover Hero Banner — во всю ширину экрана, без рамок (пожелание владельца) */}
          <div className="relative h-[42vh] min-h-[15rem] sm:h-80 w-full bg-black">
            <img
              src={event.image}
              alt={event.title}
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover brightness-[0.55] select-none pointer-events-none"
            />
            {/* Ambient gradients */}
            <div className="absolute inset-0 bg-gradient-to-t from-[#121212] via-[#121212]/30 to-black/50" />
            <div className="absolute bottom-5 left-4 right-4 sm:bottom-6 sm:left-6 sm:right-6 space-y-2">
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

              {event.format && event.format !== 'offline' && (
                <span className="px-3 py-1 rounded-full text-[10px] font-bold font-mono uppercase tracking-widest inline-flex items-center gap-1.5 bg-black/75 border border-sky-500/30 text-sky-300 ml-2">
                  {event.format === 'online' ? <Monitor className="w-3 h-3" /> : <Wifi className="w-3 h-3" />}
                  {event.format === 'online' ? 'Онлайн' : 'Гибрид'}
                </span>
              )}

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

          {/* Grid of Essential Parameters. На мобильном узкие отступы — больше места контенту. */}
          <div className="p-4 sm:p-6 space-y-6">
            
            {/* Time / Price / Location Info Blocks */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 font-mono text-xs">
              <div className="bg-white/5 border border-white/5 rounded-2xl p-4 flex gap-3 items-start">
                <Calendar className="w-5 h-5 text-brand shrink-0" />
                <div className="space-y-1">
                  <span className="text-white/40 uppercase text-[9px] tracking-wider block">ДАТА И ВРЕМЯ проведения</span>
                  <div className="text-white font-bold">{event.dateLabel}</div>
                  {event.time && !event.dateLabel.includes(event.time) && (
                    <div className="text-white/60 text-[10px]">{event.time}</div>
                  )}
                  {phase !== 'past' && (
                    <a
                      href={buildIcsDataUri(event, isRegistered)}
                      download={`flint-${event.id}.ics`}
                      onClick={() => haptic('success')}
                      className="inline-flex items-center gap-1 text-[10px] text-brand/80 hover:text-brand mt-1.5 font-mono uppercase tracking-wider transition-colors"
                      title="Добавить в календарь (.ics)"
                    >
                      <Calendar className="w-3 h-3" /> В календарь
                    </a>
                  )}
                </div>
              </div>

              {isRegistered ? (
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
                      РАЙОН · точка сбора скрыта 🔒
                    </span>
                    {event.location && (
                      <div className="text-white/70 text-xs font-bold">{event.location}</div>
                    )}
                    <div className="text-white/50 text-[10px] italic">
                      Точное место сбора и карта откроются после подтверждения участия
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

            {/* Погода на даты (open-meteo) */}
            <WeatherBlock event={event} />

            {/* «Под вопросом» — честно предупреждаем до того, как человек запишется */}
            {event.statusReason && (
              <div className="bg-amber-500/10 border border-amber-500/30 p-4 rounded-2xl" id={`detail-at-risk-${event.id}`}>
                <p className="text-amber-300 text-[10px] font-mono uppercase tracking-widest mb-1">⚠️ Мероприятие под вопросом</p>
                <p className="text-xs text-white/85 leading-relaxed">{event.statusReason}</p>
                {event.decisionDeadline && (
                  <p className="text-[10px] text-white/50 mt-1 font-mono">Решение до {event.decisionDeadline}</p>
                )}
              </div>
            )}

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

            {/* Программа по времени */}
            {guide.program.length > 0 && (
              <div className="bg-white/5 border border-white/10 p-4 rounded-2xl space-y-3">
                <span className="text-brand text-[10px] tracking-widest font-mono block uppercase font-bold flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5" /> Программа
                </span>
                {(() => {
                  // Группируем программу по дню: «День N» или дата в начале строки
                  // становится заголовком-разделителем, а под ним идут только время и
                  // активность — без повтора даты в каждой строке (дерево по часам).
                  // Заголовок дня в начале строки: «День N», «Day N», «N день»,
                  // дата «12.07», дата с месяцем «17 июля», день недели «Суббота».
                  const dayRe = /^\s*(День\s*\d+|Day\s*\d+|\d{1,2}\s*день\w*|\d{1,2}[.\/]\d{1,2}(?:[.\/]\d{2,4})?|\d{1,2}\s+(?:янв|фев|мар|апр|ма[йя]|июн|июл|авг|сен|окт|ноя|дек)[а-я]*|понедельник|вторник|сред[аы]|четверг|пятниц[аы]|суббот[аы]|воскресень[ея])(?=[\s)\].,:–—-]|$)\s*[)\].,:–—-]*\s*/i;
                  const groups: { day: string | null; items: string[] }[] = [];
                  for (const raw of guide.program) {
                    const m = raw.match(dayRe);
                    const day = m ? m[1].trim() : null;
                    const rest = (m ? raw.slice(m[0].length) : raw).trim();
                    const last = groups[groups.length - 1];
                    if (day && (!last || last.day !== day)) groups.push({ day, items: rest ? [rest] : [] });
                    else if (last) { if (rest) last.items.push(rest); }
                    else groups.push({ day, items: rest ? [rest] : [] });
                  }
                  const hasDays = groups.some((g) => g.day);
                  if (!hasDays) {
                    return (
                      <ol className="space-y-2">
                        {guide.program.map((step, i) => (
                          <li key={i} className="flex gap-3 text-xs text-white/80">
                            <span className="shrink-0 w-5 h-5 rounded-full bg-brand/15 text-brand font-bold flex items-center justify-center text-[10px]">{i + 1}</span>
                            <span className="leading-relaxed pt-0.5">{step}</span>
                          </li>
                        ))}
                      </ol>
                    );
                  }
                  return (
                    <div className="space-y-3">
                      {groups.map((g, gi) => (
                        <div key={gi} className="space-y-1.5">
                          {g.day && (
                            <div className="text-brand text-[11px] font-bold uppercase tracking-wide flex items-center gap-2">
                              <span className="w-1.5 h-1.5 rounded-full bg-brand" />{g.day}
                            </div>
                          )}
                          <ul className="space-y-1.5 border-l border-white/10 ml-[3px] pl-3">
                            {g.items.map((it, ii) => {
                              const tm = it.match(/^(\d{1,2}[:.]\d{2})\s*[–—-]?\s*/);
                              const time = tm ? tm[1] : '';
                              const text = tm ? it.slice(tm[0].length) : it;
                              return (
                                <li key={ii} className="flex gap-2 text-xs text-white/80">
                                  {time && <span className="shrink-0 font-mono text-brand/90 text-[11px] pt-0.5 w-11">{time}</span>}
                                  <span className="leading-relaxed pt-0.5">{text}</span>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Что взять с собой */}
            <div className="bg-white/5 border border-white/10 p-4 rounded-2xl space-y-2.5">
              <span className="text-brand text-[10px] tracking-widest font-mono block uppercase font-bold flex items-center gap-2">
                <Check className="w-3.5 h-3.5" /> Что взять с собой
              </span>
              <div className="flex flex-wrap gap-2">
                {guide.bring.map((item, i) => (
                  <span key={i} className="text-[11px] text-white/80 bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5">
                    {item}
                  </span>
                ))}
              </div>
              <p className="text-[9px] text-white/40 font-mono uppercase tracking-wider pt-1">По-дружески и по желанию — без обязаловки. Главное: 100% трезвость и открытость.</p>
            </div>

            {/* Вектор «Дома Личности» — зачем это */}
            <div className="bg-brand/5 border border-brand/20 p-4 rounded-2xl space-y-1">
              <span className="text-brand text-[10px] tracking-widest font-mono block uppercase font-bold">Дом Личности · зачем это</span>
              <div className="text-sm font-bold text-white">{guide.vector.title}</div>
              <p className="text-xs text-white/70 leading-relaxed">{guide.vector.text}</p>
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

            {/* Detailed Rules & Preparation — только зарегистрированным (гейтинг локации) */}
            {isRegistered && event.locationDetails && (
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
              onVote={async (eventId, option) => {
                const res = await submitVote(eventId, option);
                haptic(res.ok ? 'success' : 'error');
                return res;
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
        <div className="p-4 sm:p-6 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-6 border-t border-white/10 bg-[#161616] flex flex-col sm:flex-row gap-3 items-stretch justify-between snap-none">
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
              {event.telegramBotUrl && (
                <a
                  href={event.telegramBotUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="border border-brand/30 text-brand hover:bg-brand/10 font-black font-mono text-xs py-4 px-6 rounded-2xl transition-all flex items-center justify-center gap-2 uppercase tracking-widest text-center"
                >
                  Чат события
                  <Send className="w-4 h-4 shrink-0" />
                </a>
              )}
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
              {/* «Верификация» — только для тех, кого ещё не приняли в клуб. */}
              {event.needsOnboarding && !isClubMember && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
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
