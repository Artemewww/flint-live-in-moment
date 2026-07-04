import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Calendar, MapPin, Users, Heart, ArrowUpRight, Compass, ShieldCheck, Info } from 'lucide-react';
import { CommunityEvent, getYandexMapsUrl } from '../types';
import { getVectorIconByKey } from './VectorIcons';

interface InfoSectionProps {
  events: CommunityEvent[];
  onRegisterClick: (event: CommunityEvent) => void;
  onOpenManifesto: () => void;
  onOpenDetails: (event: CommunityEvent) => void;
}

export default function InfoSection({ 
  events, 
  onRegisterClick, 
  onOpenManifesto,
  onOpenDetails
}: InfoSectionProps) {
  // Find nearest upcoming event: "banya-flint-weekly" which is 2026-06-04, or any upcoming
  const featuredEvent = events.find(e => e.id === 'banya-flint-weekly') || events.find(e => e.date >= '2026-06-03') || events[0];

  // Calculated registered slots
  const maxSpots = featuredEvent.maxParticipants || 15;
  const spotsTaken = featuredEvent.participantsCount;
  const percentFull = Math.min(100, Math.floor((spotsTaken / maxSpots) * 100));

  // Target date for countdown (June 4, 2026 at 19:00:00 Minsk timezone format or general)
  const targetDate = new Date(`${featuredEvent.date}T19:00:00`).getTime();
  const [timeLeft, setTimeLeft] = useState({ days: '00', hours: '00', minutes: '00', seconds: '00' });

  useEffect(() => {
    const updateTimer = () => {
      const now = new Date().getTime();
      const diff = targetDate - now;

      if (diff <= 0) {
        setTimeLeft({ days: '00', hours: '00', minutes: '00', seconds: '00' });
        return;
      }

      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
      const minutes = Math.floor((diff / 1000 / 60) % 65);
      const seconds = Math.floor((diff / 1000) % 60);

      setTimeLeft({
        days: days.toString().padStart(2, '0'),
        hours: hours.toString().padStart(2, '0'),
        minutes: minutes.toString().padStart(2, '0'),
        seconds: seconds.toString().padStart(2, '0')
      });
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [targetDate]);

  return (
    <div id="info-section-container" className="block w-full">
      <div 
        id="featured-hero-card" 
        className="w-full relative min-h-[500px] rounded-3xl overflow-hidden border border-white/10 flex flex-col justify-between p-5 sm:p-8 md:p-10 shadow-2xl bg-[#111]"
      >
        {/* Background artwork */}
        <div className="absolute inset-0 z-0">
          <img 
            src={featuredEvent.image} 
            alt={featuredEvent.title}
            className="w-full h-full object-cover brightness-[0.65] contrast-[1.10] transition-transform duration-700 ease-out select-none pointer-events-none"
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0A0A0A] via-black/10 to-transparent" />
          <div className="absolute top-0 right-0 w-80 h-80 bg-brand/10 rounded-full blur-3xl pointer-events-none" />
        </div>

        {/* TOP RAIL: Alert/Countdown and Club tag */}
        <div className="relative z-10 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-end w-full">
          {/* Majestic Countdown Box */}
          <div className="bg-black/70 border border-brand/35 backdrop-blur-md rounded-2xl p-3 sm:px-5 sm:py-2.5 max-w-sm flex flex-col text-left">
            <span className="text-white/50 font-bold uppercase tracking-widest text-[9px] mb-1 block">
              До твоей следующей перезагрузки осталось...
            </span>
            <div className="flex items-center gap-2 font-mono text-xl sm:text-2xl font-black text-brand">
              <div className="flex flex-col items-center">
                <span>{timeLeft.days}</span>
                <span className="text-[8px] text-white/40 uppercase font-bold tracking-tight">днеи</span>
              </div>
              <span className="text-white/30 animate-pulse">:</span>
              <div className="flex flex-col items-center">
                <span>{timeLeft.hours}</span>
                <span className="text-[8px] text-white/40 uppercase font-bold tracking-tight">час</span>
              </div>
              <span className="text-white/30 animate-pulse">:</span>
              <div className="flex flex-col items-center">
                <span>{timeLeft.minutes}</span>
                <span className="text-[8px] text-white/40 uppercase font-bold tracking-tight">мин</span>
              </div>
              <span className="text-white/30 animate-pulse">:</span>
              <div className="flex flex-col items-center">
                <span>{timeLeft.seconds}</span>
                <span className="text-[8px] text-white/40 uppercase font-bold tracking-tight">сек</span>
              </div>
            </div>
          </div>
        </div>

        {/* MIDDLE / BOTTOM CORE META SECTION */}
        <div className="relative z-10 space-y-4 max-w-4xl mt-8">

          {/* Central title header */}
          <div className="space-y-2">
            <h1 className="font-display font-black text-3xl sm:text-5xl text-white uppercase tracking-tighter leading-tight italic drop-shadow-[0_4px_12px_rgba(0,0,0,0.9)]" id="featured-title">
              {featuredEvent.title}
            </h1>
          </div>

          {/* Timing indicators inline */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[11px] sm:text-xs text-white/80 font-mono pt-1">
            <span className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-brand" />
              <span>{featuredEvent.time}</span>
            </span>
            <a 
              href={getYandexMapsUrl(featuredEvent.location)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 hover:text-brand transition-colors cursor-pointer group"
              title="Поехать (Открыть координаты на Яндекс Картах)"
            >
              <MapPin className="w-4 h-4 text-brand group-hover:scale-110 transition-transform" />
              <span className="underline decoration-[#E6FD3A]/30 italic">{featuredEvent.location} 🗺️</span>
            </a>
            <span className="flex items-center gap-2">
              <Users className="w-4 h-4 text-brand" />
              <span>Занято мест: {spotsTaken} из {maxSpots}</span>
            </span>
          </div>

          {/* Wide progress slider indicator */}
          <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div className="h-full bg-brand" style={{ width: `${percentFull}%` }} />
          </div>

          {/* Action trigger row */}
          <div className="flex flex-col sm:flex-row gap-3 pt-2 items-stretch sm:items-center">
            <button
              onClick={() => onRegisterClick(featuredEvent)}
              className="flex-1 bg-brand hover:bg-brand-hover text-black font-black uppercase text-xs sm:text-sm tracking-widest py-3.5 px-6 rounded-2xl transition-all flex items-center justify-center gap-2 group cursor-pointer shadow-lg shadow-brand/10 border-none active:scale-98"
              id="hero-friendly-cta-btn"
            >
              Занять свое место в кругу
              <Compass className="w-4 h-4 text-black group-hover:rotate-45 transition-transform duration-300" />
            </button>

            <button 
              type="button"
              onClick={() => onOpenDetails(featuredEvent)} 
              className="flex-1 border border-white/20 hover:border-brand/40 bg-white/5 text-white hover:text-brand px-6 py-3.5 rounded-2xl text-xs font-bold uppercase tracking-widest font-mono transition-all cursor-pointer flex items-center justify-center gap-2"
            >
              Узнать подробнее
              <Info className="w-4 h-4 text-brand shrink-0" />
            </button>

            <button 
              type="button"
              onClick={onOpenManifesto} 
              className="border border-white/20 hover:border-brand/40 bg-white/5 text-white hover:text-brand px-5 py-3.5 rounded-2xl text-xs font-bold uppercase tracking-widest font-mono transition-all cursor-pointer flex items-center justify-center gap-2"
            >
              Кодекс сообщества
              <Heart className="w-3.5 h-3.5 text-rose-500 fill-rose-500" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
