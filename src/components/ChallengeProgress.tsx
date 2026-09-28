import React, { useEffect, useMemo, useState } from 'react';
import Avatar from './Avatar';
import { CommunityEvent, getToday } from '../types';

/**
 * ТАБЛИЦА ПРОГРЕССА ЧЕЛЛЕНДЖА — «кто сколько прошёл».
 *
 * Структура: аватар + имя слева, полоса из 92 точек справа (по одной на день).
 * Кружок пунктирный (ещё не пройден), залитый с галочкой (пройден).
 * Дата/месяц подписана под точками: сентябрь, октябрь, … — группы по месяцам.
 *
 * Тап по точке → открывается сторис с кружком этого дня (через callback).
 *
 * Хранение кружков: только Telegram (`file_id` из `app_config`), здесь —
 * только метаданные (дата, время, имя). 92 × N участников в Supabase
 * забили бы память; Telegram хранит сам, прокси `/api/events?action=media&fid=`
 * отдаёт по `file_id`.
 */

type CheckinDay = {
  date: string;        // YYYY-MM-DD
  time?: string;
  telegram_id?: number;
};

type Participant = {
  telegram_id: number;
  name: string;
  avatar?: string;     // photo_url из Telegram
  days: CheckinDay[];  // его чек-ины
};

type Props = {
  event: CommunityEvent;
  /** Открыть сторис по (telegramId, date) */
  onOpenStory: (telegramId: number, date: string) => void;
};

const MONTHS_RU = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

function daysBetween(from: string, to: string): number {
  return Math.round((new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86400000);
}

/** Группировка дней по месяцам: [{month, year, days: [{dayNo, date}]}] */
function groupByMonth(start: string, end: string) {
  const total = daysBetween(start, end) + 1;
  const groups: { month: number; year: number; days: { dayNo: number; date: string }[] }[] = [];
  const cursor = new Date(`${start}T00:00:00`);
  for (let i = 0; i < total; i += 1) {
    const ymd = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
    const m = cursor.getMonth() + 1;
    const y = cursor.getFullYear();
    let g = groups.find((x) => x.month === m && x.year === y);
    if (!g) { g = { month: m, year: y, days: [] }; groups.push(g); }
    g.days.push({ dayNo: i + 1, date: ymd });
    cursor.setDate(cursor.getDate() + 1);
  }
  return groups;
}

export default function ChallengeProgress({ event, onOpenStory }: Props) {
  const today = getToday();
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(true);

  const start = event.date || today;
  const end = event.dateEnd || event.date || today;
  const monthGroups = useMemo(() => groupByMonth(start, end), [start, end]);

  // Один запрос: все чек-ины события, сгруппированные по telegram_id.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/events?action=checkins_grouped&id=${encodeURIComponent(event.id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive) return;
        if (Array.isArray(j?.participants)) setParticipants(j.participants);
        setLoading(false);
      })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [event.id]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[.03] p-4 space-y-2">
        <span className="font-mono text-[10px] uppercase tracking-widest text-white/40">Прогресс участников</span>
        <div className="h-20 animate-pulse rounded-xl bg-white/[.06]" />
      </div>
    );
  }

  if (!participants.length) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[.03] p-4 space-y-2">
        <span className="font-mono text-[10px] uppercase tracking-widest text-white/40">Прогресс участников</span>
        <p className="text-[11px] text-white/50">Пока никто не отметился. Будь первым — отправь кружок в чат челленджа.</p>
      </div>
    );
  }

  // Сортируем: больше пройденных дней → выше в списке.
  const sorted = [...participants].sort((a, b) => b.days.length - a.days.length);
  const totalDays = monthGroups.reduce((s, g) => s + g.days.length, 0);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[.03] p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-widest text-white/40">Прогресс участников</span>
        <span className="font-mono text-[10px] text-white/50">{participants.length} чел. · макс. {totalDays}</span>
      </div>

      {/* Шапка месяцев — общая для всех строк */}
      <div className="flex gap-3 overflow-x-auto scrollbar-none pb-1">
        <div className="w-24 shrink-0" />
        <div className="flex gap-4">
          {monthGroups.map((g) => (
            <div key={`${g.year}-${g.month}`} className="shrink-0">
              <div className="font-mono text-[9px] uppercase tracking-wider text-amber-300/70">
                {MONTHS_RU[g.month - 1]} {g.year}
              </div>
              <div className="flex gap-1 mt-0.5">
                {g.days.map((d) => (
                  <span key={d.date} className="w-5 text-center font-mono text-[8px] text-white/30">
                    {d.dayNo}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Строки участников */}
      <div className="space-y-2 max-h-72 overflow-y-auto scrollbar-none">
        {sorted.map((p) => {
          const doneDates = new Set(p.days.map((d) => d.date));
          return (
            <div key={p.telegram_id} className="flex items-center gap-3">
              {/* Аватар + имя */}
              <div className="w-24 shrink-0 flex items-center gap-2 min-w-0">
                <Avatar name={p.name} src={p.avatar} size={28} />
                <span className="truncate text-[11px] font-bold text-white/85">{p.name}</span>
              </div>

              {/* Полоса по месяцам */}
              <div className="flex gap-4 overflow-x-auto scrollbar-none">
                {monthGroups.map((g) => (
                  <div key={`${g.year}-${g.month}`} className="shrink-0 flex gap-1">
                    {g.days.map((d) => {
                      const done = doneDates.has(d.date);
                      const isToday = d.date === today;
                      const isFuture = d.date > today;
                      return (
                        <button
                          key={d.date}
                          type="button"
                          disabled={!done}
                          onClick={() => done && onOpenStory(p.telegram_id, d.date)}
                          title={done ? `День ${d.dayNo} · ${d.date}` : `День ${d.dayNo} · ещё не пройден`}
                          className={`
                            w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold
                            transition-all
                            ${done
                              ? 'bg-gradient-to-br from-amber-400 to-orange-500 text-black shadow-sm shadow-amber-500/30 hover:scale-110 cursor-pointer'
                              : isToday
                                ? 'border-2 border-dashed border-amber-400/60 text-amber-300/70'
                                : isFuture
                                  ? 'border border-dashed border-white/15 text-white/20'
                                  : 'border border-dashed border-white/25 text-white/30'
                            }
                          `}
                        >
                          {done ? '✓' : isToday ? '•' : ''}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>

              {/* Счётчик справа */}
              <div className="ml-auto shrink-0 font-mono text-[10px] text-white/50">
                {p.days.length}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[9px] font-mono text-white/30 leading-relaxed">
        Тап по залитой точке → сторис с кружком этого дня.
      </p>
    </div>
  );
}
