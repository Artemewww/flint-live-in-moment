/**
 * ЧТО МОЖНО И ЧЕГО НЕЛЬЗЯ НА СОБЫТИИ — напоминание, а не повторный кодекс.
 *
 * Правила человек принимает один раз на входе в клуб (ClubOnboarding), и
 * заставлять его читать восемь экранов перед каждым выездом бессмысленно.
 * Но и молчать нельзя: на Нарочи разбитый термос повис в воздухе, потому что
 * «в правилах этого не написано» — а правило было, просто никто не помнил.
 *
 * Поэтому здесь плитки-теги: свёрнуто это одна строка на весь блок, развёрнуто
 * — короткие пункты именно того правила, которое человек ткнул. Место на
 * странице события стоит дорого: его забирают программа, состав и логистика.
 */
import { useState } from 'react';
import { ShieldCheck, ChevronDown } from 'lucide-react';
import { CLUB_RULES } from '../data/clubRules';

export function EventRules() {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="bg-white/5 border border-white/5 rounded-2xl p-4 space-y-3">
      <span className="text-white/40 uppercase text-[9px] tracking-wider flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-brand" /> Что важно на событии
      </span>

      {/* Теги в две колонки: так восемь правил занимают четыре строки, а не восемь. */}
      <div className="grid grid-cols-2 gap-2">
        {CLUB_RULES.map((r) => {
          const isOpen = open === r.key;
          const danger = r.accent === 'rose';
          return (
            <button
              key={r.key}
              type="button"
              onClick={() => setOpen(isOpen ? null : r.key)}
              className={`text-left rounded-xl px-3 py-2 border transition-all flex items-center justify-between gap-1 ${
                isOpen
                  ? 'bg-brand/10 border-brand/30 text-brand'
                  : danger
                    ? 'bg-rose-500/5 border-rose-500/20 text-rose-200/80 hover:bg-rose-500/10'
                    : 'bg-black/20 border-white/10 text-white/70 hover:bg-white/5'
              }`}
            >
              <span className="text-[11px] font-bold font-mono uppercase tracking-wide truncate">{r.tag}</span>
              <ChevronDown className={`w-3 h-3 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>
          );
        })}
      </div>

      {open && (
        <div className="bg-black/20 border border-white/10 rounded-xl p-3 space-y-1.5">
          <div className="text-white text-sm font-bold">
            {CLUB_RULES.find((r) => r.key === open)?.title}
          </div>
          <ul className="space-y-1">
            {(CLUB_RULES.find((r) => r.key === open)?.points || []).map((p, i) => (
              <li key={i} className="text-white/70 text-[11px] leading-snug flex gap-2">
                <span className="text-brand shrink-0">•</span>
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-white/30 text-[10px] font-mono">
        Ты принял это при вступлении — здесь просто под рукой
      </p>
    </div>
  );
}
