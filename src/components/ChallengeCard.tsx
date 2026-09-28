import React, { useEffect, useMemo, useState } from 'react';
import { Flame, Zap, ArrowRight, Target, Video } from 'lucide-react';
import { CommunityEvent, getToday } from '../types';
import { haptic } from '../telegram';

/**
 * КАРТОЧКА ЧЕЛЛЕНДЖА — компактный пульсирующий блок на главной.
 *
 * РАЗМЕР — как у сбора (FundraiserBanner): 76px обложка, p-2.5, rounded-2xl.
 * Больше не нужно: челлендж идёт каждый день, человек заходит утром,
 * ему нужен один ответ «отметился ли я» — а не панель управления.
 *
 * АКЦЕНТ — топ-метрики: день X/92, серия 🔥, отмечен-сегодня.
 * Пульс на ВСЕЙ карточке (animate-pulse на корне), не на индикаторе.
 */

type Checkin = {
  date: string;
  time?: string;
  telegram_id?: number;
};

const KEY_PREFIX = 'flint_challenge_checkins:';

/** Локальный кэш чек-инов: серверный ответ приходит по сети, а серия нужна мгновенно. */
function readLocalCheckins(eventId: string): Checkin[] {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + eventId);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** Серия = сколько подряд идущих дней до сегодня включительно есть чек-ины. */
function streakOf(dates: string[], today: string): number {
  const set = new Set(dates);
  let n = 0;
  const d = new Date(`${today}T00:00:00`);
  // Пока день есть в наборе — идём назад. Пропуск обрывает серию сразу:
  // «35 из 36» и «35 подряд» — разные вещи, и врать человеку нельзя.
  for (let i = 0; i < 400; i += 1) {
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!set.has(ymd)) break;
    n += 1;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

function daysBetween(from: string, to: string): number {
  return Math.round((new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86400000);
}

export default function ChallengeCard({
  event,
  onOpenDetails,
}: {
  event: CommunityEvent;
  onOpenDetails: (event: CommunityEvent) => void;
}) {
  const today = getToday();
  const [checkins, setCheckins] = useState<Checkin[]>([]);

  // Серия и «отметился ли сегодня» считаются из общего списка чек-инов:
  // так один источник правды и для бейджа, и для прогресса.
  useEffect(() => {
    setCheckins(readLocalCheckins(event.id));
    let alive = true;
    fetch(`/api/events?action=checkins&id=${encodeURIComponent(event.id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive || !j) return;
        // Сервер знает про всех — он и главный источник правды.
        if (Array.isArray(j.days)) {
          try { localStorage.setItem(KEY_PREFIX + event.id, JSON.stringify(j.days)); } catch { /* приватный режим */ }
          setCheckins(j.days);
        }
      })
      .catch(() => { /* оффлайн — остаёмся на локальных данных */ });
    return () => { alive = false; };
  }, [event.id]);

  const stats = useMemo(() => {
    const dates = checkins.map((c) => c.date).filter(Boolean);
    const doneToday = dates.includes(today);
    const streak = streakOf(dates, today);
    const start = event.date || today;
    const end = event.dateEnd || event.date || today;
    const totalDays = Math.max(1, daysBetween(start, end) + 1);
    const dayNo = Math.min(totalDays, Math.max(1, daysBetween(start, today) + 1));
    const left = Math.max(0, totalDays - dayNo);
    const daysDone = dates.length;
    return { doneToday, streak, totalDays, dayNo, left, daysDone, percent: Math.min(100, Math.round((dayNo / totalDays) * 100)) };
  }, [checkins, today, event.date, event.dateEnd]);

  // Последний чек-ин — «во сколько отчитался». Это та цифра, из-за которой
  // люди и заходят: не «прогресс 43%», а «вчера в 05:12».
  const lastTime = [...checkins].sort((a, b) => (a.date < b.date ? 1 : -1))[0]?.time;

  return (
    <div
      id={`challenge-card-${event.id}`}
      className="relative overflow-hidden rounded-2xl border border-amber-500/30 bg-gradient-to-br from-[#141007] via-[#0F0D08] to-[#0A0A0A] shadow-lg animate-pulse"
    >
      {/* Пульс: мягкое дыхание фона — челлендж живой, он идёт прямо сейчас. */}
      <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-amber-500/10 blur-3xl" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,176,0,0.08),transparent_55%)]" />

      <div className="relative flex items-center gap-3 p-2.5 pr-3">
        {/* Обложка квадратом 76px (как FundraiserBanner) */}
        <span className="relative h-[76px] w-[76px] shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-amber-500/30 to-amber-600/10 flex items-center justify-center">
          <span className="text-3xl">🔥</span>
          <span className="absolute left-1 top-1 rounded-md bg-black/70 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-amber-300">челлендж</span>
        </span>

        {/* Основной контент */}
        <span className="min-w-0 flex-1 space-y-1">
          <span className="flex items-center justify-between gap-2">
            <span className="line-clamp-1 text-[13px] font-black uppercase leading-tight">{event.title}</span>
            <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-white/40">
              {stats.dayNo}/{stats.totalDays}
            </span>
          </span>

          {/* Три топ-метрики: день, серия, статус */}
          <span className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="inline-flex items-center gap-1 rounded-md bg-white/[.06] px-1.5 py-0.5">
              <Target className="h-3 w-3 text-amber-300" />
              <b className="text-white">День {stats.dayNo}</b>
            </span>
            {stats.streak > 0 && (
              <span className="inline-flex items-center gap-1 rounded-md bg-white/[.06] px-1.5 py-0.5">
                <Flame className="h-3 w-3 text-orange-400" />
                <b className="text-white">{stats.streak}</b>
                <span className="text-white/50">подряд</span>
              </span>
            )}
            <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 ${stats.doneToday ? 'bg-amber-400/20' : 'bg-white/[.06]'}`}>
              {stats.doneToday ? (
                <><Zap className="h-3 w-3 text-amber-300" /><b className="text-amber-300">✓ Отмечен{lastTime ? ` ${lastTime}` : ''}</b></>
              ) : (
                <><Video className="h-3 w-3 text-white/60" /><span className="text-white/60">Ждём отчёт</span></>
              )}
            </span>
          </span>

          {/* Прогресс-бар: пройдено дней */}
          <span className="flex items-center gap-2">
            <span className="flex-1 h-1.5 overflow-hidden rounded-full bg-white/10">
              <span className="block h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500 transition-all duration-700" style={{ width: `${stats.percent}%` }} />
            </span>
            <span className="font-mono text-[10px] text-white/50">{stats.daysDone}/{stats.totalDays}</span>
          </span>
        </span>

        {/* Стрелка-CTA */}
        <button
          type="button"
          onClick={() => { haptic('success'); onOpenDetails(event); }}
          className="shrink-0 p-2 rounded-xl bg-amber-400/10 border border-amber-400/30 text-amber-300 hover:bg-amber-400/20 hover:scale-105 transition-all"
          title={stats.doneToday ? 'Посмотреть челлендж' : 'Открыть и отметить день'}
        >
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
