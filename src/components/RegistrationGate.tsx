import React, { useMemo, useRef, useState } from 'react';
import { ShieldCheck, Ban, Heart, Leaf, Users, Coins, Camera, ListChecks, CheckCircle2, Lock, Compass } from 'lucide-react';
import { CommunityEvent } from '../types';
import { getInitData } from '../telegram';

/**
 * Строгий поэтапный допуск к записи: перед регистрацией участник ОБЯЗАН
 * пройти правила клуба и программу события, приняв КАЖДЫЙ блок кнопкой —
 * ничего не пропуская. Формальной галочки недостаточно (пожелание владельца).
 *
 * Правила клуба одинаковы для всех событий → факт принятия помним в localStorage
 * (версия RULES_VERSION; при изменении правил — принять заново). Программа же
 * привязана к конкретному событию → её подтверждаем при каждой записи.
 */

const RULES_VERSION = 'v2'; // v2 — добавлено правило о программе события
const RULES_LS_KEY = `flint_rules_accepted_${RULES_VERSION}`;

type Step = {
  key: string;
  icon: React.ReactNode;
  tag: string;
  title: string;
  points: string[];
  accent?: 'brand' | 'rose';
  acceptLabel: string;
};

/** Канонический кодекс клуба «Живи в моменте». */
function clubRuleSteps(): Step[] {
  return [
    {
      key: 'values',
      icon: <Heart className="w-5 h-5" />,
      tag: 'Ценности',
      title: 'Философия круга',
      points: [
        'Только живое общение — глаза в глаза, без масок и позы.',
        '100% чистота. Без алкоголя и фальши.',
        'Равенство, искренность и поддержка каждого в круге.',
        'Мы приходим расти и отдавать, а не потреблять.',
      ],
      acceptLabel: 'Разделяю ценности',
    },
    {
      key: 'sober',
      icon: <Ban className="w-5 h-5" />,
      tag: 'Трезвость',
      title: '100% трезвость — без исключений',
      accent: 'rose',
      points: [
        'Никакого алкоголя и любых психоактивных веществ до и во время встречи.',
        'Приходишь в ясном, трезвом состоянии.',
        'Нарушение = исключение из события без возврата взноса и из клуба.',
      ],
      acceptLabel: 'Принимаю правило трезвости',
    },
    {
      key: 'respect',
      icon: <Users className="w-5 h-5" />,
      tag: 'Уважение',
      title: 'Уважение, равенство, приватность',
      points: [
        'Каждый в круге равен. Без унижений, давления и харассмента.',
        '«Нет» уважается сразу и без объяснений.',
        'Что сказано в круге — остаётся в круге. Личное наружу не выносим.',
      ],
      acceptLabel: 'Принимаю',
    },
    {
      key: 'safety',
      icon: <Leaf className="w-5 h-5" />,
      tag: 'Ответственность',
      title: 'Безопасность, ответственность, природа',
      points: [
        'За своё здоровье, снаряжение и безопасность отвечаешь ты сам.',
        'Следуешь инструкциям организатора; в риске для себя/других — регламенту SOS.',
        'Убираем за собой полностью: мусор увозим, огонь — только по правилам (Leave No Trace).',
      ],
      acceptLabel: 'Принимаю',
    },
    {
      /**
       * Программа — часть кодекса, а не пожелание. Правило добавлено после
       * Нарочи: пункты меняли и сдвигали на ходу, и круг рассыпался — люди
       * приходили к времени, которого уже нет. Формулировки взяты из
       * «Правил участника» (Правила_участника.html в корне проекта).
       */
      key: 'program-rules',
      icon: <Compass className="w-5 h-5" />,
      tag: 'Программа',
      title: 'Программа события — не нарушаем',
      points: [
        'Программу собирает организатор — так, чтобы всем было гармонично и комфортно.',
        'Время, порядок и формат — как в программе. Это держит круг вместе.',
        'Хочешь что-то изменить — предложи организатору, а не меняй самовольно.',
        'Взял пункт под ответственность — доводишь до конца или заранее ищешь замену.',
      ],
      acceptLabel: 'Принимаю',
    },
    {
      key: 'guests-money',
      icon: <Coins className="w-5 h-5" />,
      tag: 'Гости и деньги',
      title: 'Гости и финансы',
      points: [
        'За приглашённых гостей отвечаешь и платишь ты; они тоже соблюдают кодекс.',
        'Общие расходы делятся честно и прозрачно.',
        'Взнос вносится вовремя — от этого зависят закупки для всех.',
      ],
      acceptLabel: 'Принимаю',
    },
    {
      key: 'media',
      icon: <Camera className="w-5 h-5" />,
      tag: 'Фото/видео',
      title: 'Съёмка и публикация',
      points: [
        'Согласие на фото/видео и их публикацию спрашивается отдельно.',
        'Без согласия человека его снимки не публикуются (закон РБ).',
        'Уважай приватность других: не снимай тех, кто против.',
      ],
      acceptLabel: 'Принимаю',
    },
  ];
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
  // Правила уже приняты в этой версии? Тогда сразу к программе события.
  const rulesAlreadyAccepted = useMemo(() => {
    try { return localStorage.getItem(RULES_LS_KEY) === '1'; } catch { return false; }
  }, []);

  const steps = useMemo(() => {
    const rules = rulesAlreadyAccepted ? [] : clubRuleSteps();
    return [...rules, programStep(event)];
  }, [event, rulesAlreadyAccepted]);

  const [idx, setIdx] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const step = steps[idx];
  const isLast = idx === steps.length - 1;

  const next = () => {
    if (isLast) {
      try { localStorage.setItem(RULES_LS_KEY, '1'); } catch { /* noop */ }
      // Дублируем факт принятия НА СЕРВЕР. localStorage — только быстрый путь:
      // он привязан к браузеру, теряется при смене устройства и невидим
      // костяку, а принятие правил — организационно значимый факт, который
      // организатор должен видеть в админке.
      const initData = getInitData();
      if (initData) {
        fetch('/api/profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'accept_rules', initData, version: RULES_VERSION }),
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
