import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ShieldCheck, Ban, Heart, Leaf, Users, Coins, Camera, ListChecks, CheckCircle2, Lock, Compass } from 'lucide-react';
import { CommunityEvent } from '../types';
import { getInitData } from '../telegram';
import { CLUB_RULES, RULES_VERSION, RULES_MAP_KEY, LEGACY_RULE_KEYS as LEGACY_KEYS } from '../data/clubRules';

/**
 * Строгий поэтапный допуск к записи: перед регистрацией участник ОБЯЗАН
 * пройти правила клуба и программу события, приняв КАЖДЫЙ блок кнопкой —
 * ничего не пропуская. Формальной галочки недостаточно (пожелание владельца).
 *
 * Правила клуба одинаковы для всех событий → факт принятия помним в localStorage
 * (версия RULES_VERSION; при изменении правил — принять заново). Программа же
 * привязана к конкретному событию → её подтверждаем при каждой записи.
 */

/**
 * Правила приехали из общего модуля `src/data/clubRules.ts`: тот же кодекс
 * показывает онбординг вступления, и две копии текста неминуемо разошлись бы.
 * Здесь остаётся только оформление — иконка на каждое правило.
 */
const RULE_ICONS: Record<string, React.ReactNode> = {
  values: <Heart className="w-5 h-5" />,
  sober: <Ban className="w-5 h-5" />,
  respect: <Users className="w-5 h-5" />,
  safety: <Leaf className="w-5 h-5" />,
  'program-rules': <Compass className="w-5 h-5" />,
  buddy: <Users className="w-5 h-5" />,
  'guests-money': <Coins className="w-5 h-5" />,
  media: <Camera className="w-5 h-5" />,
};

type Step = {
  key: string;
  /** Версия ЭТОГО правила. Поднял — переспросим только его. */
  v?: number;
  icon: React.ReactNode;
  tag: string;
  title: string;
  points: string[];
  accent?: 'brand' | 'rose';
  acceptLabel: string;
};

/** Канонический кодекс клуба «Живи в моменте». */
function clubRuleSteps(): Step[] {
  return CLUB_RULES.map((r) => ({
    key: r.key,
    v: r.v,
    icon: RULE_ICONS[r.key] || <ShieldCheck className="w-5 h-5" />,
    tag: r.tag,
    title: r.title,
    points: r.points,
    accent: r.accent,
    acceptLabel: r.acceptLabel,
  }));
}

/** Шаг с программой конкретного события. */
function programStep(event: CommunityEvent): Step {
  const points: string[] = [];
  if (event.entryThreshold && String(event.entryThreshold).trim()) {
    points.push(`Условие входа: ${String(event.entryThreshold).trim()}`);
  }
  const prog = Array.isArray(event.program) ? event.program.filter((p) => p && p.trim()) : [];
  for (const p of prog) points.push(p.trim());
  if (points.length === 0) points.push('Организатор пришлёт подробную программу перед встречей.');
  return {
    key: 'program',
    icon: <ListChecks className="w-5 h-5" />,
    tag: 'Программа',
    title: `Программа: ${event.title}`,
    points,
    acceptLabel: 'Ознакомлен с программой',
  };
}

export default function RegistrationGate({
  event,
  onAccept,
  onClose,
}: {
  event: CommunityEvent;
  onAccept: () => void;
  onClose: () => void;
}) {
  /**
   * Что человек уже принял: {ключ правила: версия}. Источников два — быстрый
   * localStorage (мгновенный рендер) и сервер (переживает смену устройства).
   * Берём максимум по каждому правилу: принятое нигде не «отменяется».
   */
  const [accepted, setAccepted] = useState<Record<string, number>>(() => {
    try {
      const raw = localStorage.getItem(RULES_MAP_KEY);
      if (raw) return JSON.parse(raw) || {};
      // Кто принимал кодекс до перехода на поверсионный учёт — принял его
      // целиком в тогдашнем виде. Не гоним таких по кругу заново.
      if (LEGACY_KEYS.some((k) => localStorage.getItem(k) === '1')) {
        const seed: Record<string, number> = {};
        for (const st of clubRuleSteps()) seed[st.key] = st.v || 1;
        return seed;
      }
    } catch { /* приватный режим — просто спросим заново */ }
    return {};
  });

  // Догружаем принятое с сервера: человек мог принимать правила с другого
  // устройства, и гонять его по восьми экранам ещё раз — грубо.
  useEffect(() => {
    const initData = getInitData();
    if (!initData) return;
    let alive = true;
    fetch('/api/profile', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'rules_state', initData }),
    })
      .then((r) => r.json())
      .then((j) => {
        if (!alive || !j?.ok || !j.map) return;
        setAccepted((cur) => {
          const next = { ...cur };
          for (const [k, v] of Object.entries(j.map as Record<string, number>)) {
            next[k] = Math.max(Number(next[k] || 0), Number(v || 0));
          }
          return next;
        });
      })
      .catch(() => { /* офлайн — остаёмся на локальном списке */ });
    return () => { alive = false; };
  }, []);

  const steps = useMemo(() => {
    // Показываем только новое и изменившееся.
    const rules = clubRuleSteps().filter((st) => (accepted[st.key] || 0) < (st.v || 1));
    return [...rules, programStep(event)];
  }, [event, accepted]);

  const [idx, setIdx] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const step = steps[idx];
  const isLast = idx === steps.length - 1;

  const next = () => {
    if (isLast) {
      const map: Record<string, number> = { ...accepted };
      for (const st of clubRuleSteps()) map[st.key] = st.v || 1;
      try { localStorage.setItem(RULES_MAP_KEY, JSON.stringify(map)); } catch { /* noop */ }
      // Дублируем факт принятия НА СЕРВЕР. localStorage — только быстрый путь:
      // он привязан к браузеру, теряется при смене устройства и невидим
      // костяку, а принятие правил — организационно значимый факт, который
      // организатор должен видеть в админке.
      const initData = getInitData();
      if (initData) {
        fetch('/api/profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'accept_rules', initData, version: RULES_VERSION, map }),
        }).catch(() => { /* не блокируем запись на событие */ });
      }
      onAccept();
      return;
    }
    setIdx((i) => i + 1);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  };
  const back = () => {
    if (idx === 0) return;
    setIdx((i) => i - 1);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  };

  const accent = step.accent === 'rose'
    ? { text: 'text-rose-400', border: 'border-rose-500/30', bg: 'bg-rose-500/10', dot: 'bg-rose-400' }
    : { text: 'text-brand', border: 'border-brand/30', bg: 'bg-brand/10', dot: 'bg-brand' };

  return (
    <div className="space-y-5" id="reg-gate">
      {/* Прогресс шагов */}
      <div className="flex items-center gap-1.5" aria-label={`Шаг ${idx + 1} из ${steps.length}`}>
        {steps.map((s, i) => (
          <div
            key={s.key}
            className={`h-1.5 flex-1 rounded-full transition-all ${
              i < idx ? 'bg-brand' : i === idx ? 'bg-brand/60' : 'bg-white/10'
            }`}
          />
        ))}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-mono uppercase tracking-widest text-white/40">
          Допуск к записи · шаг {idx + 1}/{steps.length}
        </span>
        <span className={`text-[9px] font-mono uppercase tracking-widest ${accent.text} flex items-center gap-1`}>
          <Lock className="w-3 h-3" /> {step.tag}
        </span>
      </div>

      {/* Карточка шага */}
      {/* На мобильном шаг скроллится вместе со всей страницей (нет вложенного скролла). */}
      <div ref={scrollRef} className={`rounded-2xl border ${accent.border} ${accent.bg} p-4 sm:p-5 space-y-4 md:max-h-[46vh] md:overflow-y-auto`}>
        <div className="flex items-start gap-3">
          <div className={`shrink-0 w-11 h-11 rounded-xl flex items-center justify-center border ${accent.border} ${accent.text} bg-black/30`}>
            {step.icon}
          </div>
          <h3 className="font-display font-black text-lg uppercase tracking-tight leading-tight text-white pt-0.5">
            {step.title}
          </h3>
        </div>
        <ul className="space-y-2.5">
          {step.points.map((p, i) => (
            <li key={i} className="flex items-start gap-2.5 text-[13px] leading-relaxed text-white/85">
              <span className={`mt-1.5 shrink-0 w-1.5 h-1.5 rounded-full ${accent.dot}`} />
              <span>{p}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="text-[10px] text-white/40 text-center font-mono uppercase tracking-wide leading-relaxed">
        Прими каждый пункт, чтобы продолжить. Пропустить нельзя — это условие входа в круг.
      </p>

      <div className="flex gap-3 text-xs font-mono">
        <button
          type="button"
          onClick={idx === 0 ? onClose : back}
          className="px-4 border border-white/10 py-3 rounded-xl text-white/60 hover:text-white hover:bg-white/5 transition-all uppercase tracking-wider cursor-pointer bg-transparent"
        >
          {idx === 0 ? 'Отмена' : 'Назад'}
        </button>
        <button
          type="button"
          onClick={next}
          id="reg-gate-accept"
          className="flex-1 bg-brand hover:bg-brand-hover text-black py-3 rounded-xl font-black transition-all flex items-center justify-center gap-2 cursor-pointer border-none uppercase tracking-wider active:scale-98"
        >
          {isLast ? <CheckCircle2 className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
          {step.acceptLabel}
        </button>
      </div>
    </div>
  );
}
