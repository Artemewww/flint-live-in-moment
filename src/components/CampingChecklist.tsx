import React, { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, RotateCcw, Backpack, Lightbulb } from 'lucide-react';
import { CAMPING_CHECKLIST, CAMPING_TIPS, checklistTotal } from '../data/campingChecklist';

/**
 * Чек-лист для кемпинга с галочками. Отмеченное хранится в localStorage —
 * человек собирается не в один присест, и без сохранения список бесполезен.
 * Ключ по названию пункта, а не по индексу: правка списка не должна сбивать
 * уже поставленные галочки.
 */
const LS_KEY = 'flint_camping_checklist';

function loadTicks(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; }
}

export default function CampingChecklist({ defaultOpen }: { defaultOpen?: boolean }) {
  const [ticks, setTicks] = useState<Record<string, boolean>>(loadTicks);
  const [open, setOpen] = useState<string | null>(defaultOpen ? CAMPING_CHECKLIST[0].key : null);

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(ticks)); } catch { /* приватный режим */ }
  }, [ticks]);

  const total = useMemo(checklistTotal, []);
  const done = useMemo(() => Object.values(ticks).filter(Boolean).length, [ticks]);

  const toggle = (item: string) => setTicks((s) => ({ ...s, [item]: !s[item] }));
  const sectionDone = (key: string) => {
    const s = CAMPING_CHECKLIST.find((x) => x.key === key);
    if (!s) return 0;
    return s.groups.reduce((n, g) => n + g.items.filter((i) => ticks[i]).length, 0);
  };
  const sectionTotal = (key: string) => {
    const s = CAMPING_CHECKLIST.find((x) => x.key === key);
    return s ? s.groups.reduce((n, g) => n + g.items.length, 0) : 0;
  };

  return (
    <div className="space-y-2" id="camping-checklist">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Backpack className="w-4 h-4 text-brand shrink-0" />
          <span className="text-[11px] font-mono uppercase tracking-widest text-white/60 truncate">
            Чек-лист для кемпинга
          </span>
        </div>
        <span className="text-[10px] font-mono text-white/40 shrink-0">
          {done} / {total}
        </span>
      </div>

      <div className="w-full bg-white/10 h-1 rounded-full overflow-hidden">
        <div className="bg-brand h-full transition-all" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
      </div>

      {CAMPING_CHECKLIST.map((s) => {
        const isOpen = open === s.key;
        const sd = sectionDone(s.key), st = sectionTotal(s.key);
        return (
          <div key={s.key} className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : s.key)}
              className="w-full flex items-center gap-2.5 p-3.5 bg-transparent border-none cursor-pointer text-left text-white"
            >
              <span className="text-base shrink-0">{s.emoji}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-[13px] font-bold uppercase tracking-wide truncate">{s.title}</span>
                <span className={`block text-[10px] font-mono ${sd === st ? 'text-brand' : 'text-white/40'}`}>
                  {sd} / {st}{sd === st ? ' · собрано' : ''}
                </span>
              </span>
              <ChevronDown className={`w-4 h-4 shrink-0 text-white/40 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
              <div className="px-3.5 pb-3.5 space-y-3">
                {s.groups.map((g, gi) => (
                  <div key={gi} className="space-y-1">
                    {g.title && (
                      <div className="text-[9px] font-mono uppercase tracking-widest text-white/35 pt-1">{g.title}</div>
                    )}
                    {g.items.map((item) => {
                      const on = !!ticks[item];
                      return (
                        <button
                          key={item}
                          type="button"
                          onClick={() => toggle(item)}
                          className="w-full flex items-center gap-2.5 py-1.5 bg-transparent border-none cursor-pointer text-left"
                        >
                          <span className={`w-4 h-4 rounded shrink-0 border flex items-center justify-center transition-colors ${
                            on ? 'bg-brand border-brand' : 'border-white/25'
                          }`}>
                            {on && <Check className="w-3 h-3 text-black" />}
                          </span>
                          <span className={`text-[12px] leading-snug ${on ? 'text-white/35 line-through' : 'text-white/85'}`}>
                            {item}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <div className="bg-brand/5 border border-brand/20 rounded-2xl p-3.5 space-y-2">
        <div className="flex items-center gap-1.5 text-brand text-[9px] font-mono uppercase tracking-widest font-bold">
          <Lightbulb className="w-3.5 h-3.5" /> {CAMPING_TIPS.title}
        </div>
        <div className="text-[12px] text-white/80 leading-snug">
          За день до поездки зарядите: {CAMPING_TIPS.chargeDayBefore.join(', ')}.
        </div>
        <div className="text-[11px] text-white/50 leading-snug">{CAMPING_TIPS.note}</div>
      </div>

      {done > 0 && (
        <button
          type="button"
          onClick={() => setTicks({})}
          className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/50 hover:text-white text-[10px] font-mono uppercase tracking-widest cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5" /> Сбросить галочки перед новым выездом
        </button>
      )}
    </div>
  );
}
