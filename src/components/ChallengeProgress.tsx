import React, { useEffect, useMemo, useState } from 'react';
import { Zap } from 'lucide-react';
import { getInitData, getTelegramUser } from '../telegram';
import Avatar from './Avatar';
import { CommunityEvent, getToday } from '../types';

/**
 * ТАБЛИЦА ПРОГРЕССА ЧЕЛЛЕНДЖА — «кто сколько прошёл и кто отстаёт».
 *
 * Как было и почему переделано (претензии владельца):
 *  • шапка с днями и строка КАЖДОГО участника прокручивались отдельно —
 *    столбцы не совпадали, сравнить людей по одному дню было нельзя;
 *  • дни шли с первого: свежие уезжали за правый край, и пропуски последних
 *    дней (самое важное) не были видны без прокрутки;
 *  • оранжевые галочки без дат — непонятно, какой именно день пропущен.
 *
 * Теперь: одна таблица с общей прокруткой, имена закреплены слева, дни —
 * от СЕГОДНЯ к началу (свежие слева), над столбцом число и день недели.
 * Пройденный день — фирменная лаймовая клетка с молнией из логотипа.
 * У каждого — серия подряд и сколько дней пропущено.
 *
 * Тап по пройденной клетке → сторис с кружком этого дня.
 */

type CheckinDay = { date: string; time?: string; telegram_id?: number };
type Participant = { telegram_id: number; name: string; avatar?: string; days: CheckinDay[] };
type Props = {
  event: CommunityEvent;
  /** Открыть сторис по (telegramId, date) */
  onOpenStory: (telegramId: number, date: string) => void;
};

const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Дни челленджа от сегодня (или конца) к старту — свежие первыми. */
function daysNewestFirst(start: string, end: string, today: string): string[] {
  const last = today < end ? today : end;
  const out: string[] = [];
  const cur = new Date(`${last}T00:00:00`);
  const first = new Date(`${start}T00:00:00`);
  for (let i = 0; i < 400 && cur >= first; i += 1) {
    out.push(ymd(cur));
    cur.setDate(cur.getDate() - 1);
  }
  return out;
}

const CELL = 28; // px: палец попадает, а 14 дней помещаются на экран телефона после прокрутки

export default function ChallengeProgress({ event, onOpenStory }: Props) {
  const today = getToday();
  const myId = getTelegramUser()?.id;
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(true);

  const start = event.date || today;
  const end = event.dateEnd || event.date || today;
  const days = useMemo(() => daysNewestFirst(start, end, today), [start, end, today]);
  const totalDays = useMemo(() => {
    const a = new Date(`${start}T00:00:00`).getTime();
    const b = new Date(`${end}T00:00:00`).getTime();
    return Math.round((b - a) / 86400000) + 1;
  }, [start, end]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/events?action=checkins_grouped&id=${encodeURIComponent(event.id)}`, { headers: { 'X-Telegram-Init-Data': getInitData() } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive) return;
        if (Array.isArray(j?.participants)) setParticipants(j.participants);
        setLoading(false);
      })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [event.id]);

  const rows = useMemo(() => {
    const pastDays = days.filter((d) => d < today); // сегодня ещё не «пропуск» — день не закончился
    return participants.map((p) => {
      const done = new Set(p.days.map((d) => d.date));
      // Серия подряд: от сегодня (если уже отчитался) или от вчера.
      let streak = 0;
      for (const d of days) {
        if (d === today && !done.has(d)) continue;
        if (!done.has(d)) break;
        streak += 1;
      }
      const missed = pastDays.filter((d) => !done.has(d)).length;
      const doneCount = days.filter((d) => done.has(d)).length;
      return { ...p, done, streak, missed, doneCount, todayDone: done.has(today) };
    }).sort((a, b) => b.doneCount - a.doneCount || b.streak - a.streak || a.name.localeCompare(b.name));
  }, [participants, days, today]);

  const header = (
    <div className="flex items-center justify-between gap-2">
      <span className="font-mono text-[11px] uppercase tracking-widest text-white/50">Прогресс участников</span>
      {days.length > 0 && (
        <span className="text-[11px] text-white/50">
          День <b className="text-brand">{Math.min(days.length, totalDays)}</b> из {totalDays}
        </span>
      )}
    </div>
  );

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[.03] p-4 space-y-2">
        {header}
        <div className="h-24 animate-pulse rounded-xl bg-white/[.06]" />
      </div>
    );
  }

  if (!rows.length) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[.03] p-4 space-y-2">
        {header}
        <p className="text-[12px] text-white/55">Пока никто не отметился. Будь первым — отправь кружок в чат челленджа.</p>
      </div>
    );
  }

  const todayCount = rows.filter((r) => r.todayDone).length;
  const leftCol = 'sticky left-0 z-10 bg-[#141414]';

  return (
    <div className="rounded-2xl border border-white/10 bg-[#141414] p-4 space-y-3">
      {header}
      <p className="text-[12px] text-white/60">
        Сегодня отчитались <b className="text-white">{todayCount}</b> из {rows.length}
        {todayCount < rows.length ? ' — ещё не поздно 💪' : ' — все в строю 🔥'}
      </p>

      {/* ОДНА прокрутка на всю таблицу: столбцы дней у всех участников совпадают. */}
      <div className="-mx-4 overflow-x-auto overscroll-x-contain scrollbar-none" role="table" aria-label="Прогресс участников по дням">
        <div className="inline-block min-w-full px-4 pb-1">
          {/* Шапка дней */}
          <div className="flex items-end" role="row">
            <div className={`${leftCol} w-[132px] shrink-0 pr-2`} />
            {days.map((d, i) => {
              const dt = new Date(`${d}T00:00:00`);
              const isToday = d === today;
              const monthStart = i === days.length - 1 || dt.getDate() === 1;
              return (
                <div key={d} role="columnheader" className="shrink-0 text-center" style={{ width: CELL + 4 }}>
                  <div className={`h-3 text-[9px] font-mono uppercase ${monthStart ? 'text-brand/70' : 'text-transparent'}`}>{MON[dt.getMonth()]}</div>
                  <div className={`text-[12px] font-bold leading-tight ${isToday ? 'text-brand' : 'text-white/75'}`}>{dt.getDate()}</div>
                  <div className={`text-[9px] leading-tight ${isToday ? 'text-brand' : 'text-white/35'}`}>{isToday ? 'сег' : WD[dt.getDay()]}</div>
                </div>
              );
            })}
          </div>

          {/* Строки */}
          <div className="mt-2 space-y-1.5">
            {rows.map((p) => {
              const me = myId && Number(myId) === Number(p.telegram_id);
              return (
                <div key={p.telegram_id} role="row" className="flex items-center">
                  <div className={`${leftCol} w-[132px] shrink-0 pr-2`}>
                    <div className={`flex items-center gap-2 rounded-xl py-1 ${me ? 'bg-brand/10 -ml-1 pl-1' : ''}`}>
                      <Avatar name={p.name} src={p.avatar} size={30} />
                      <div className="min-w-0">
                        <div className={`truncate text-[12px] font-bold ${me ? 'text-brand' : 'text-white'}`}>{me ? 'Ты' : p.name}</div>
                        <div className="text-[10px] leading-tight text-white/50 whitespace-nowrap">
                          <b className="text-white/80">{p.doneCount}</b>/{days.length}
                          {p.missed > 0
                            ? <> · <span className="text-white/60" title={`пропущено дней: ${p.missed}`}>−{p.missed}</span></>
                            : <> · <span className="text-brand" title={`серия без пропусков: ${p.streak}`}>🔥{p.streak}</span></>}
                        </div>
                      </div>
                    </div>
                  </div>
                  {days.map((d) => {
                    const done = p.done.has(d);
                    const isToday = d === today;
                    return (
                      <div key={d} role="cell" className="shrink-0 flex justify-center" style={{ width: CELL + 4 }}>
                        <button
                          type="button"
                          disabled={!done}
                          onClick={() => done && onOpenStory(p.telegram_id, d)}
                          aria-label={`${p.name}, ${d}: ${done ? 'отчёт есть' : isToday ? 'сегодня ещё нет' : 'пропуск'}`}
                          className={`flex items-center justify-center rounded-lg border-none transition-transform ${
                            done
                              ? 'bg-brand text-black cursor-pointer hover:scale-110 shadow-sm shadow-brand/20'
                              : isToday
                                ? 'bg-transparent outline outline-1 outline-dashed outline-brand/50'
                                : 'bg-white/[.06]'
                          }`}
                          style={{ width: CELL, height: CELL }}
                        >
                          {done && <Zap className="h-4 w-4 fill-black" strokeWidth={1.5} />}
                        </button>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-white/45">
        <span className="flex items-center gap-1.5"><span className="flex h-4 w-4 items-center justify-center rounded bg-brand"><Zap className="h-3 w-3 fill-black text-black" /></span>отчёт</span>
        <span className="flex items-center gap-1.5"><span className="h-4 w-4 rounded bg-white/[.06]" />пропуск</span>
        <span>−N — пропущено дней · 🔥 — серия без пропусков · свежие дни слева, листай вправо — история</span>
      </div>
    </div>
  );
}
