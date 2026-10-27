import React, { useEffect, useMemo, useState } from 'react';
import { Zap } from 'lucide-react';
import type { CommunityEvent } from '../types';
import { vibeOf, score, weatherFor, loadPrefs, savePrefs, readinessToday, saveReadiness, Prefs, Weather } from '../vibe';

/**
 * «Тебе сейчас подойдёт»: одно событие из афиши под твой вайб, сегодняшнее
 * состояние и погоду. Три вопроса — один раз, «как ты сегодня» — в один тап.
 */
const Q: { key: keyof Prefs; title: string; opts: [string, number][] }[] = [
  { key: 'energy', title: 'Идеальная суббота', opts: [['Тихо', 1.5], ['По-разному', 3], ['Активно', 4.5]] },
  { key: 'social', title: 'Заряжаешься', opts: [['Один', 1.5], ['Вдвоём-втроём', 3], ['В компании', 4.5]] },
  { key: 'novelty', title: 'Новое и риск', opts: [['Нет', 0.2], ['Иногда', 0.5], ['Да', 0.9]] },
];

const Dots = ({ n, label }: { n: number; label: string }) => (
  <span className="inline-flex items-center gap-1 text-[10px] text-white/50">
    {label}
    {[1, 2, 3, 4, 5].map((i) => <i key={i} className={`w-1.5 h-1.5 rounded-full ${i <= n ? 'bg-brand' : 'bg-white/15'}`} />)}
  </span>
);

export default function VibePick({ events, onOpen }: { events: CommunityEvent[]; onOpen: (e: CommunityEvent) => void }) {
  const [prefs, setPrefs] = useState<Prefs | null>(() => loadPrefs());
  const [draft, setDraft] = useState<Partial<Prefs>>({});
  const [ready, setReady] = useState<number | null>(() => readinessToday());
  const [wx, setWx] = useState<Record<string, Weather>>({});

  const upcoming = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return events.filter((e) => (e.status === 'open' || e.status === 'locked') && !(e as any).isChallenge && e.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8);
  }, [events]);

  useEffect(() => {
    upcoming.forEach((e) => weatherFor(e.date).then((w) => setWx((m) => (e.date in m ? m : { ...m, [e.date]: w }))));
  }, [upcoming]);

  if (!upcoming.length) return null;

  if (!prefs) {
    const done = Q.every((q) => draft[q.key] !== undefined);
    return (
      <section className="rounded-2xl border border-brand/30 bg-brand/[0.05] p-4 space-y-3">
        <h3 className="font-black text-white flex items-center gap-2"><Zap className="w-4 h-4 text-brand" /> Какой у тебя вайб?</h3>
        <p className="text-[12px] text-white/50">Три тапа — и афиша будет подсказывать, что зарядит именно тебя.</p>
        {Q.map((q) => (
          <div key={q.key} className="space-y-1.5">
            <p className="text-[11px] text-white/60">{q.title}</p>
            <div className="flex gap-1.5">
              {q.opts.map(([label, val]) => (
                <button key={label} type="button" onClick={() => setDraft((d) => ({ ...d, [q.key]: val }))}
                  className={`flex-1 rounded-lg text-xs py-2 border ${draft[q.key] === val ? 'border-brand text-brand bg-brand/10' : 'border-white/10 text-white/70'}`}>{label}</button>
              ))}
            </div>
          </div>
        ))}
        <button type="button" disabled={!done} onClick={() => { savePrefs(draft as Prefs); setPrefs(draft as Prefs); }}
          className="w-full rounded-lg bg-brand text-black text-sm font-bold py-2.5 disabled:opacity-30">Готово</button>
      </section>
    );
  }

  const ranked = upcoming.map((e) => {
    const v = vibeOf(e as any);
    const h = Number(String(e.time || '12').slice(0, 2)) || 12;
    return { e, v, ...score(v, prefs, ready, wx[e.date] ?? null, h) };
  }).sort((a, b) => b.total - a.total);
  const best = ranked[0];

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-mono uppercase text-brand">Как ты сегодня?</span>
        <div className="flex gap-1">
          {([['Без сил', 0.15], ['Норм', 0.5], ['Заряжен', 0.9]] as [string, number][]).map(([label, r]) => (
            <button key={label} type="button" onClick={() => { saveReadiness(r); setReady(r); }}
              className={`text-[11px] rounded-full px-2.5 py-1 border ${ready === r ? 'border-brand text-brand' : 'border-white/10 text-white/60'}`}>{label}</button>
          ))}
        </div>
      </div>
      <button type="button" onClick={() => onOpen(best.e)} className="w-full text-left space-y-1.5">
        <p className="text-[11px] text-white/50">Тебе сейчас подойдёт</p>
        <p className="font-black text-lg text-white leading-tight">{best.e.title}</p>
        <p className="text-[12px] text-white/70">{best.why}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-1">
          <Dots n={best.v.energy} label="Энергия" />
          <Dots n={best.v.social} label="Компания" />
          {best.v.boosts.slice(0, 3).map((b) => <span key={b} className="text-[10px] rounded-full bg-brand/10 text-brand px-2 py-0.5">{b}</span>)}
        </div>
      </button>
      <div className="flex items-center justify-between text-[10px] text-white/30">
        <span>Научпоп-подсказка для выбора, не медицинский совет</span>
        <button type="button" onClick={() => { setPrefs(null); setDraft({}); }} className="underline">изменить вайб</button>
      </div>
    </section>
  );
}
