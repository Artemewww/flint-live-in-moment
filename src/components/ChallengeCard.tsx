import React, { useEffect, useMemo, useState } from 'react';
import { Flame, Sunrise, Video, ArrowRight, Trophy, CalendarDays } from 'lucide-react';
import { CommunityEvent, getToday } from '../types';
import { haptic } from '../telegram';

/**
 * КАРТОЧКА ЧЕЛЛЕНДЖА — пульсирующий блок на главной.
 *
 * Челлендж отличается от выезда всем: он идёт КАЖДЫЙ ДЕНЬ и не заканчивается
 * в дату старта. Поэтому обычная карточка события здесь врёт — счётчик «до
 * старта» показывал бы ноль уже со второго дня, а «мест осталось» вообще
 * не имеет смысла: участников может быть сколько угодно.
 *
 * Что важно человеку, который открывает главную утром:
 *   1) сегодня уже отмечен или ещё нет — от этого зависит, бежать ли за
 *      телефоном прямо сейчас;
 *   2) сколько дней подряд он держится — стрик и есть ценность челленджа;
 *   3) сколько дней осталось до конца марафона.
 *
 * Ритм и пульс — не украшение: челлендж про ежедневное действие, и блок
 * должен выглядеть живым, а не как объявление. Анимация задаётся через
 * tailwind-класс animate-pulse на индикаторе серии.
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

  // Последний чек-ин — «во сколько встал» вчера. Это та цифра, из-за которой
  // люди и заходят: не «прогресс 43%», а «вчера в 05:12».
  const lastTime = [...checkins].sort((a, b) => (a.date < b.date ? 1 : -1))[0]?.time;

  return (
    <div
      id={`challenge-card-${event.id}`}
      className="relative overflow-hidden rounded-3xl border border-amber-500/30 bg-gradient-to-br from-[#141007] via-[#0F0D08] to-[#0A0A0A] shadow-2xl"
    >
      {/* Пульс: мягкое дыхание фона — челлендж живой, он идёт прямо сейчас. */}
      <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-amber-500/10 blur-3xl animate-pulse" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,176,0,0.08),transparent_55%)]" />

      <div className="relative grid gap-5 p-5 sm:p-7 md:grid-cols-[1.4fr_1fr] md:items-center">
        {/* ─── Левая часть: суть челленджа ─── */}
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1 font-mono text-[10px] font-black uppercase tracking-widest text-amber-300">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-70" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
              </span>
              Идёт сейчас · день {stats.dayNo} из {stats.totalDays}
            </span>
            {stats.streak > 1 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-orange-400/30 bg-orange-400/10 px-3 py-1 font-mono text-[10px] font-black uppercase tracking-widest text-orange-300">
                <Flame className="h-3 w-3" /> Серия {stats.streak} дн.
              </span>
            )}
          </div>

          <div className="space-y-2">
            <h3 className="font-display text-2xl font-black uppercase italic leading-tight tracking-tight text-white sm:text-3xl">
              {event.title}
            </h3>
            <p className="max-w-xl text-[13px] leading-6 text-white/60">
              {event.painPoint || event.description}
            </p>
          </div>

          {/* Правила в трёх шагах: длинные тексты на главной не читают. */}
          <div className="flex flex-wrap gap-2">
            {[
              { icon: <Sunrise className="h-3.5 w-3.5" />, text: 'Встать до 06:00' },
              { icon: <Video className="h-3.5 w-3.5" />, text: 'Кружок в чат' },
              { icon: <Trophy className="h-3.5 w-3.5" />, text: '+10 баллов за день' },
            ].map((r) => (
              <span key={r.text} className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[.04] px-3 py-1.5 text-[11px] font-bold text-white/70">
                <span className="text-amber-300">{r.icon}</span> {r.text}
              </span>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => { haptic('success'); onOpenDetails(event); }}
              className="inline-flex items-center gap-2 rounded-xl border-0 bg-amber-400 px-5 py-3 text-xs font-black uppercase tracking-widest text-black transition hover:bg-amber-300"
            >
              {stats.doneToday ? 'Посмотреть челлендж' : 'Я в деле — открыть'} <ArrowRight className="h-4 w-4" />
            </button>
            <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-white/45">
              <CalendarDays className="h-3.5 w-3.5" />
              до {new Date(`${event.dateEnd || event.date}T00:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}
            </span>
          </div>
        </div>

        {/* ─── Правая часть: мой статус на сегодня ─── */}
        <div className="rounded-2xl border border-white/10 bg-black/45 p-5 backdrop-blur-sm">
          <p className="font-mono text-[10px] uppercase tracking-widest text-white/45">Сегодня</p>

          {stats.doneToday ? (
            <div className="mt-2 space-y-1">
              <p className="flex items-center gap-2 font-display text-xl font-black uppercase italic text-amber-300">
                <Flame className="h-5 w-5" /> Отмечен{lastTime ? ` в ${lastTime}` : ''}
              </p>
              <p className="text-[11px] text-white/55">Кружок дошёл до чата. Серия продолжается — не разрывай 🔥</p>
            </div>
          ) : (
            <div className="mt-2 space-y-1">
              <p className="flex items-center gap-2 font-display text-xl font-black uppercase italic text-white">
                <Video className="h-5 w-5 text-amber-300" /> Ждём твой кружок
              </p>
              <p className="text-[11px] text-white/55">
                Сними видео-кружок и отправь в чат челленджа — бот сам засчитает день и начислит баллы.
              </p>
            </div>
          )}

          {/* Прогресс по дням марафона: линейка, а не проценты — видно «где я». */}
          <div className="mt-4 space-y-1.5">
            <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-widest text-white/40">
              <span>Пройдено дней</span>
              <span className="text-white/70">{stats.daysDone} / {stats.totalDays}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500 transition-all duration-700"
                style={{ width: `${stats.percent}%` }}
              />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            {[
              { k: 'Серия', v: stats.streak },
              { k: 'Отметок', v: stats.daysDone },
              { k: 'Осталось', v: stats.left },
            ].map((m) => (
              <div key={m.k} className="rounded-xl border border-white/10 bg-white/[.03] py-2">
                <div className="font-display text-lg font-black text-white">{m.v}</div>
                <div className="font-mono text-[9px] uppercase tracking-widest text-white/40">{m.k}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
