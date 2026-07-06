import React from 'react';
import { Calendar, MapPin, Users, Gift, Sparkles } from 'lucide-react';
import { CommunityEvent } from '../types';

interface EventPosterProps {
  event: CommunityEvent;
  onClose: () => void;
}

export default function EventPoster({ event, onClose }: EventPosterProps) {
  const shareText = `🎯 ${event.title}\n\n📅 ${event.dateLabel}\n⏰ ${event.time}\n📍 ${event.location}\n\n🔥 Присоединяйся к живому кругу!\n\n#LiveInMoment #ЖивиВМоменте`;
  const telegramShareUrl = `https://t.me/share/url?url=${encodeURIComponent(window.location.origin)}&text=${encodeURIComponent(shareText)}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" id="event-poster-root">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/90 backdrop-blur-md"
        onClick={onClose}
      />

      {/* Poster Card */}
      <div className="bg-[#121212] rounded-3xl w-full max-w-lg shadow-2xl relative z-10 border border-white/10 overflow-hidden text-white">
        
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-20 p-2.5 rounded-full bg-black/60 border border-white/10 hover:border-brand/40 text-white/70 hover:text-[#E6FD3A] hover:scale-105 transition-all outline-none cursor-pointer"
        >
          ✕
        </button>

        {/* Poster Image */}
        <div className="relative h-64 w-full bg-black">
          <img 
            src={event.image} 
            alt={event.title}
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover brightness-[0.5] select-none pointer-events-none"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#121212] via-[#121212]/30 to-transparent" />
        </div>

        {/* Poster Content */}
        <div className="p-6 space-y-4">
          {/* Event Type Badge */}
          <div className="flex items-center gap-2">
            <span className={`
              px-3 py-1 rounded-full text-[10px] font-bold font-mono uppercase tracking-widest inline-flex items-center gap-1.5 bg-black/75 border
              ${event.type === 'male' ? 'border-indigo-500/30 text-indigo-300' :
                event.type === 'mixed' ? 'border-brand/35 text-brand' :
                event.type === 'intellectual' ? 'border-emerald-500/30 text-emerald-300' : 'border-rose-500/30 text-rose-300'}
            `}>
              <Sparkles className="w-3 h-3" />
              {event.type === 'male' ? 'Мужское Братство' :
                event.type === 'mixed' ? 'Смешанный Круг' :
                event.type === 'intellectual' ? 'Интеллектуальный Клуб' : 'Активный Выезд'}
            </span>
          </div>

          {/* Title */}
          <h2 className="font-display font-black text-2xl uppercase tracking-tight text-white leading-tight">
            {event.title}
          </h2>

          {/* Event Details */}
          <div className="space-y-2.5">
            <div className="flex items-start gap-3 text-sm">
              <Calendar className="w-5 h-5 text-brand shrink-0 mt-0.5" />
              <div>
                <div className="text-white font-bold">{event.dateLabel}</div>
                <div className="text-white/60 text-xs">{event.time}</div>
              </div>
            </div>

            <div className="flex items-start gap-3 text-sm">
              <MapPin className="w-5 h-5 text-brand shrink-0 mt-0.5" />
              <div>
                <div className="text-white font-bold">{event.location}</div>
                {event.locationDetails && (
                  <div className="text-white/60 text-xs italic">{event.locationDetails}</div>
                )}
              </div>
            </div>

            <div className="flex items-start gap-3 text-sm">
              <Users className="w-5 h-5 text-brand shrink-0 mt-0.5" />
              <div className="text-white">
                <span className="font-bold">{event.participantsCount}</span>
                <span className="text-white/60"> участников</span>
              </div>
            </div>
          </div>

          {/* Pain Point */}
          <div className="bg-brand/5 border border-brand/20 rounded-2xl p-4 space-y-1">
            <div className="text-[10px] text-brand uppercase font-mono font-bold tracking-widest">ЗАПРОС</div>
            <p className="text-xs text-white/80 italic leading-relaxed">
              « {event.painPoint} »
            </p>
          </div>

          {/* CTA */}
          <div className="pt-2 space-y-2">
            <a
              href={telegramShareUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full bg-brand hover:bg-brand-hover text-black py-4 rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-brand/10 hover:shadow-brand/20"
            >
              <Gift className="w-4 h-4" />
              Поделиться в Telegram
            </a>
            <button
              type="button"
              onClick={onClose}
              className="w-full border border-white/10 py-3 rounded-xl text-xs font-bold uppercase tracking-widest text-white/60 hover:bg-white/5 transition-colors cursor-pointer font-mono bg-transparent"
            >
              Закрыть
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}