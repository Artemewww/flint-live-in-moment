import React, { useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Loader2, Camera, Plus } from 'lucide-react';
import { CLUB_RULES, ClubRule, RULES_VERSION, RULES_MAP_KEY, fullAcceptedMap } from '../data/clubRules';
import { getInitData, haptic } from '../telegram';
import { submitClubApplication } from '../api';

/**
 * ОНБОРДИНГ ВСТУПЛЕНИЯ В КЛУБ.
 *
 * Проблема, ради которой он написан (владелец, 30.08): человека принимали в
 * клуб, а правила у него оставались непринятыми — он не понимал, куда попал, и
 * костяк решал по имени с телефоном. Теперь порядок обратный: сначала человек
 * проходит знакомство и принимает КАЖДОЕ правило отдельно, потом рассказывает
 * о себе, и только после этого уходит заявка.
 *
 * Формат — как в мобильных приложениях: иллюстрация сверху, текст снизу,
 * вертикальная пагинация справа, один экран = одно решение. Иллюстрации —
 * инлайн-SVG в фирменной палитре (кислотный лайм на графите): вектор, а не
 * PNG, потому что он чёткий на любом экране, весит килобайты и красится
 * темой, а не пересохраняется в графическом редакторе.
 */

type FormId = 'about' | 'work' | 'activity' | 'gear' | 'final';
type Step =
  | { kind: 'intro'; scene: SceneName; title: string; text: string; cta: string }
  | { kind: 'rule'; rule: ClubRule }
  | { kind: 'form'; id: FormId; title: string; hint: string; scene: SceneName };

type SceneName =
  | 'flint' | 'circle' | 'path' | 'sober' | 'respect' | 'nature'
  | 'program' | 'buddy' | 'money' | 'camera' | 'form' | 'gear' | 'photo';

/* ══════════════════════════ ИЛЛЮСТРАЦИИ ══════════════════════════════════
 * Линейная графика в одном ключе: тонкая линия, лайм — только на смысловом
 * акценте экрана. Одна композиция на весь блок, без мелочи: на телефоне
 * иллюстрация занимает треть экрана и должна читаться с расстояния.
 */
function Scene({ name }: { name: SceneName }) {
  const stroke = 'rgba(255,255,255,0.32)';
  const brand = '#E6FD3A';
  const common = { fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

  const scenes: Record<SceneName, React.ReactNode> = {
    // Кремень и искра — знак клуба.
    flint: (
      <g {...common}>
        <path d="M60 118 L96 62 L142 78 L134 132 Z" stroke={stroke} strokeWidth="2" />
        <path d="M96 62 L134 132" stroke={stroke} strokeWidth="1" opacity=".6" />
        <path d="M150 60 L172 38" stroke={brand} strokeWidth="3" />
        <path d="M158 78 L186 70" stroke={brand} strokeWidth="2.5" />
        <path d="M146 44 L152 20" stroke={brand} strokeWidth="2" />
        <circle cx="192" cy="52" r="3" fill={brand} stroke="none" />
      </g>
    ),
    // Круг людей у костра.
    circle: (
      <g {...common}>
        <ellipse cx="120" cy="98" rx="72" ry="34" stroke={stroke} strokeWidth="1.5" />
        <path d="M112 96 L120 74 L128 96" stroke={brand} strokeWidth="2.5" />
        <path d="M116 96 L120 84 L124 96" stroke={brand} strokeWidth="2" opacity=".7" />
        {[0, 1, 2, 3, 4, 5].map((i) => {
          const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
          return <circle key={i} cx={120 + Math.cos(a) * 72} cy={98 + Math.sin(a) * 34} r="7" stroke={stroke} strokeWidth="2" />;
        })}
      </g>
    ),
    // Путь из шагов.
    path: (
      <g {...common}>
        <path d="M40 130 C 80 130, 80 70, 120 70 S 160 130, 200 130" stroke={stroke} strokeWidth="2" strokeDasharray="6 8" />
        <circle cx="40" cy="130" r="6" stroke={stroke} strokeWidth="2" />
        <circle cx="120" cy="70" r="7" stroke={brand} strokeWidth="2.5" />
        <circle cx="200" cy="130" r="9" fill={brand} stroke="none" />
        <path d="M196 130 l3 3 l6 -7" stroke="#0A0A0A" strokeWidth="2" />
      </g>
    ),
    // Перечёркнутый бокал.
    sober: (
      <g {...common}>
        <path d="M96 56 L144 56 L134 92 Q120 104 106 92 Z" stroke={stroke} strokeWidth="2" />
        <path d="M120 104 L120 130 M104 132 L136 132" stroke={stroke} strokeWidth="2" />
        <path d="M78 40 L166 142" stroke="#FB7185" strokeWidth="3" />
      </g>
    ),
    // Двое напротив, между ними — равенство.
    respect: (
      <g {...common}>
        <circle cx="80" cy="72" r="14" stroke={stroke} strokeWidth="2" />
        <path d="M58 130 q22 -30 44 0" stroke={stroke} strokeWidth="2" />
        <circle cx="160" cy="72" r="14" stroke={stroke} strokeWidth="2" />
        <path d="M138 130 q22 -30 44 0" stroke={stroke} strokeWidth="2" />
        <path d="M104 92 L136 92 M104 104 L136 104" stroke={brand} strokeWidth="2.5" />
      </g>
    ),
    // Гора, дерево, ничего после нас.
    nature: (
      <g {...common}>
        <path d="M36 132 L92 56 L128 108 L150 82 L204 132 Z" stroke={stroke} strokeWidth="2" />
        <path d="M92 56 L106 76 L78 76 Z" fill={brand} stroke="none" opacity=".85" />
        <path d="M60 132 q60 -14 120 0" stroke={brand} strokeWidth="2" opacity=".5" />
      </g>
    ),
    // Тайминг программы.
    program: (
      <g {...common}>
        <rect x="52" y="48" width="136" height="92" rx="10" stroke={stroke} strokeWidth="2" />
        <path d="M52 74 L188 74" stroke={stroke} strokeWidth="1.5" />
        <path d="M72 94 L120 94 M72 112 L152 112" stroke={stroke} strokeWidth="2" />
        <circle cx="62" cy="94" r="3" fill={brand} stroke="none" />
        <circle cx="62" cy="112" r="3" fill={brand} stroke="none" />
        <path d="M84 38 L84 58 M156 38 L156 58" stroke={brand} strokeWidth="2.5" />
      </g>
    ),
    // Двое связаны линией — бади.
    buddy: (
      <g {...common}>
        <circle cx="84" cy="90" r="18" stroke={brand} strokeWidth="2.5" />
        <circle cx="156" cy="90" r="18" stroke={brand} strokeWidth="2.5" />
        <path d="M102 90 L138 90" stroke={stroke} strokeWidth="2" strokeDasharray="4 5" />
        <path d="M84 118 L84 138 M156 118 L156 138" stroke={stroke} strokeWidth="1.5" opacity=".6" />
      </g>
    ),
    // Честный делёж.
    money: (
      <g {...common}>
        <circle cx="90" cy="92" r="26" stroke={stroke} strokeWidth="2" />
        <circle cx="150" cy="92" r="26" stroke={stroke} strokeWidth="2" />
        <path d="M120 62 L120 122" stroke={brand} strokeWidth="2.5" strokeDasharray="5 6" />
        <path d="M82 92 L98 92 M142 92 L158 92" stroke={brand} strokeWidth="2.5" />
      </g>
    ),
    // Камера и согласие.
    camera: (
      <g {...common}>
        <rect x="58" y="66" width="124" height="80" rx="12" stroke={stroke} strokeWidth="2" />
        <path d="M96 66 L104 52 L136 52 L144 66" stroke={stroke} strokeWidth="2" />
        <circle cx="120" cy="106" r="22" stroke={brand} strokeWidth="2.5" />
        <circle cx="120" cy="106" r="8" stroke={stroke} strokeWidth="2" />
      </g>
    ),
    // Анкета.
    form: (
      <g {...common}>
        <rect x="66" y="44" width="108" height="104" rx="10" stroke={stroke} strokeWidth="2" />
        <path d="M86 74 L154 74 M86 94 L138 94 M86 114 L126 114" stroke={stroke} strokeWidth="2" />
        <circle cx="160" cy="126" r="16" fill={brand} stroke="none" />
        <path d="M153 126 l5 5 l10 -11" stroke="#0A0A0A" strokeWidth="2.5" />
      </g>
    ),
    // Снаряжение.
    gear: (
      <g {...common}>
        <path d="M84 76 q36 -34 72 0 L164 140 L76 140 Z" stroke={stroke} strokeWidth="2" />
        <path d="M104 76 L104 60 q16 -12 32 0 L136 76" stroke={stroke} strokeWidth="2" />
        <path d="M100 104 L140 104" stroke={brand} strokeWidth="2.5" />
      </g>
    ),
    // Портрет.
    photo: (
      <g {...common}>
        <circle cx="120" cy="82" r="24" stroke={brand} strokeWidth="2.5" />
        <path d="M74 142 q46 -44 92 0" stroke={stroke} strokeWidth="2" />
        <rect x="52" y="40" width="136" height="112" rx="14" stroke={stroke} strokeWidth="1.5" opacity=".7" />
      </g>
    ),
  };

  return (
    <svg viewBox="0 0 240 176" className="w-full h-full" role="presentation" aria-hidden="true">
      {scenes[name]}
    </svg>
  );
}

/* ══════════════════════════ ЧИПЫ ВЫБОРА ════════════════════════════════ */

function Chips({
  options, value, onChange, multi = false, allowCustom = true, placeholder = 'Своё…',
}: {
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
  multi?: boolean;
  allowCustom?: boolean;
  placeholder?: string;
}) {
  const [custom, setCustom] = useState('');
  const toggle = (opt: string) => {
    haptic('success');
    if (multi) onChange(value.includes(opt) ? value.filter((v) => v !== opt) : [...value, opt]);
    else onChange(value.includes(opt) ? [] : [opt]);
  };
  const addCustom = () => {
    const v = custom.trim();
    if (!v) return;
    if (!value.includes(v)) onChange(multi ? [...value, v] : [v]);
    setCustom('');
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {[...options, ...value.filter((v) => !options.includes(v))].map((opt) => {
          const on = value.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              onClick={() => toggle(opt)}
              className={`px-3 py-2 rounded-xl text-[12px] font-medium border cursor-pointer transition-all ${
                on
                  ? 'bg-brand text-black border-brand'
                  : 'bg-white/5 text-white/70 border-white/10 hover:border-white/25'
              }`}
            >
              {opt}
            </button>
          );
        })}
      </div>
      {allowCustom && (
        <div className="flex gap-1.5">
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }}
            placeholder={placeholder}
            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-[13px] text-white placeholder:text-white/25 outline-none focus:border-brand/60"
          />
          <button
            type="button" onClick={addCustom} disabled={!custom.trim()}
            className="px-3 rounded-xl bg-white/5 border border-white/10 text-white/60 cursor-pointer disabled:opacity-30"
            aria-label="Добавить своё"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════ ОНБОРДИНГ ══════════════════════════════════ */

const OCCUPATIONS = ['IT / диджитал', 'Инженерия', 'Медицина', 'Стройка', 'Бизнес', 'Продажи', 'Творчество', 'Спорт', 'Образование', 'Госслужба', 'Студент'];
const ACTIVITIES = ['Походы', 'Сап', 'Вело', 'Бег', 'Баня', 'Плавание', 'Йога', 'Тренажёрный', 'Единоборства', 'Кино', 'Музыка', 'Настолки', 'Рыбалка', 'Фото'];
const TRANSPORT = ['Своё авто', 'Права есть, авто нет', 'Без авто'];
const GEAR = ['Палатка', 'Спальник', 'Коврик', 'Горелка', 'Котелок', 'Термос', 'Сап', 'Велосипед', 'Гитара', 'Проектор', 'Мангал', 'Ничего пока нет'];

export default function ClubOnboarding({
  refCode, onDone,
}: {
  refCode?: string;
  /** approved=true — впустили сразу (реф-ссылка), иначе заявка ушла костяку. */
  onDone: (approved: boolean) => void;
}) {
  const steps: Step[] = useMemo(() => [
    {
      kind: 'intro', scene: 'flint',
      title: 'Это закрытый круг',
      text: 'FLINT — клуб живых трезвых событий. Сюда не покупают билет: внутрь попадают по приглашению и после знакомства. Мы посмотрим друг на друга — и решим вместе.',
      cta: 'Понятно, дальше',
    },
    {
      kind: 'intro', scene: 'circle',
      title: 'Мы не меняем людей — мы меняем среду',
      text: 'Силой воли человек себя не вытянет. Зато рядом с двадцатью людьми, для которых трезвость и включённость — норма, это перестаёт быть подвигом. Поэтому у клуба есть правила, и они не декоративные.',
      cta: 'Согласен',
    },
    {
      kind: 'intro', scene: 'path',
      title: 'Как проходит вступление',
      text: 'Сейчас будет восемь правил клуба — каждое нужно принять отдельно. Потом короткий рассказ о себе: три минуты. И заявка уйдёт костяку.',
      cta: 'Начинаем',
    },
    ...CLUB_RULES.map((rule) => ({ kind: 'rule' as const, rule })),
    { kind: 'form', id: 'about', scene: 'form', title: 'Кто ты', hint: 'Имя и телефон нужны, чтобы связаться по логистике. Остальное — чтобы правильно собрать круг.' },
    { kind: 'form', id: 'work', scene: 'form', title: 'Чем занимаешься', hint: 'Не для анкеты ради анкеты: в круге ищут своих, и общий язык часто начинается с рода дела.' },
    { kind: 'form', id: 'activity', scene: 'nature', title: 'Что тебе близко', hint: 'По этим отметкам подбираем события и зовём туда, где тебе будет хорошо.' },
    { kind: 'form', id: 'gear', scene: 'gear', title: 'Транспорт и снаряжение', hint: 'Клуб ездит своим ходом и живёт складчиной. Знать, кто чем может поделиться, — половина логистики.' },
    { kind: 'form', id: 'final', scene: 'photo', title: 'Последнее — и самое важное', hint: 'Ответ прочитает только костяк. По нему тебя и запомнят.' },
  ], []);

  const [idx, setIdx] = useState(0);
  const [accepted, setAccepted] = useState<Record<string, number>>({});
  const scrollRef = useRef<HTMLDivElement>(null);

  // Поля анкеты
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [gender, setGender] = useState<string[]>([]);
  const [birthday, setBirthday] = useState('');
  const [occupation, setOccupation] = useState<string[]>([]);
  const [activities, setActivities] = useState<string[]>([]);
  const [transport, setTransport] = useState<string[]>([]);
  const [seats, setSeats] = useState('');
  const [gear, setGear] = useState<string[]>([]);
  const [why, setWhy] = useState('');
  const [usePhoto, setUsePhoto] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const step = steps[idx];
  const isLast = idx === steps.length - 1;

  const go = (n: number) => {
    setIdx(n);
    setError('');
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  };

  const submit = async () => {
    if (!firstName.trim() || !phone.trim()) {
      setError('Имя и телефон обязательны — без них не связаться.');
      const aboutIdx = steps.findIndex((s) => s.kind === 'form' && s.id === 'about');
      if (aboutIdx >= 0) go(aboutIdx);
      return;
    }
    setSending(true);
    setError('');
    const map = fullAcceptedMap();
    try { localStorage.setItem(RULES_MAP_KEY, JSON.stringify(map)); } catch { /* приватный режим */ }

    const result = await submitClubApplication({
      firstName: firstName.trim(),
      lastName: lastName.trim() || undefined,
      phone: phone.trim(),
      sourceHint: refCode ? `по ссылке-приглашению (код ${refCode})` : undefined,
      refCode: refCode || undefined,
      // Всё, что человек рассказал о себе на онбординге. Сервер разложит
      // пол и дату рождения по колонкам, остальное — в prefs.
      gender: gender[0] === 'Мужчина' ? 'male' : gender[0] === 'Женщина' ? 'female' : undefined,
      birthday: birthday || undefined,
      occupation: occupation.join(', ') || undefined,
      activities,
      transport: transport[0],
      seats: seats ? Number(seats) : undefined,
      gear,
      why: why.trim() || undefined,
      usePhoto,
      rulesMap: map,
      rulesVersion: RULES_VERSION,
    } as any);

    setSending(false);
    if (result.ok) { haptic('success'); onDone(!!result.approved); return; }
    haptic('error');
    setError(result.message || 'Не удалось отправить заявку. Попробуй ещё раз.');
  };

  const next = () => {
    if (step.kind === 'rule') setAccepted((cur) => ({ ...cur, [step.rule.key]: step.rule.v }));
    haptic('success');
    if (isLast) { submit(); return; }
    go(idx + 1);
  };

  const accent = step.kind === 'rule' && step.rule.accent === 'rose'
    ? { text: 'text-rose-400', border: 'border-rose-500/30', bg: 'bg-rose-500/10', dot: 'bg-rose-400' }
    : { text: 'text-brand', border: 'border-brand/30', bg: 'bg-brand/10', dot: 'bg-brand' };

  return (
    <div className="fixed inset-0 z-[90] bg-[#0A0A0A] text-white flex flex-col">
      {/* ── Иллюстрация ───────────────────────────────────────────────────
          Треть экрана, но не больше 300px: на маленьком телефоне текст важнее
          картинки, на большом — картинка не должна распухать. */}
      <div className="relative shrink-0 h-[32vh] max-h-[300px] min-h-[168px] bg-gradient-to-b from-white/[0.06] to-transparent flex items-center justify-center px-10">
        <div className="w-full max-w-[300px] h-full py-6">
          <Scene name={step.kind === 'rule' ? step.rule.scene : step.scene} />
        </div>

        {idx > 0 && (
          <button
            type="button"
            onClick={() => go(idx - 1)}
            className="absolute left-4 top-4 p-2 rounded-full bg-white/5 hover:bg-white/10 border-none text-white/60 cursor-pointer"
            aria-label="Назад"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
        )}

        <span className="absolute right-4 top-4 text-[10px] font-mono text-white/35 tabular-nums">
          {idx + 1} / {steps.length}
        </span>
      </div>

      {/* ── Пагинация справа ────────────────────────────────────────────── */}
      <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex flex-col items-center gap-1.5 z-10">
        {steps.map((s, i) => (
          <span
            key={i}
            className={`rounded-full transition-all ${
              i === idx
                ? 'w-1.5 h-5 bg-brand'
                : i < idx
                  ? 'w-1.5 h-1.5 bg-brand/45'
                  : 'w-1.5 h-1.5 bg-white/15'
            }`}
            aria-hidden="true"
          />
        ))}
      </div>

      {/* ── Текст и поля ──────────────────────────────────────────────── */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-5 pr-9 pt-5 pb-4 flex flex-col">
        {/* my-auto центрирует короткий экран по вертикали и не мешает длинному
            прокручиваться: иначе на высоком телефоне между текстом и кнопкой
            зияла пустая треть экрана. */}
        <div className="max-w-md w-full mx-auto my-auto space-y-4">
          {step.kind === 'rule' && (
            <span className={`inline-block text-[9px] font-mono uppercase tracking-[0.2em] px-2 py-1 rounded-lg border ${accent.border} ${accent.bg} ${accent.text}`}>
              Правило {idx - 2} из {CLUB_RULES.length} · {step.rule.tag}
            </span>
          )}

          <h2 className="font-display font-black text-[22px] leading-tight uppercase tracking-tight">
            {step.kind === 'rule' ? step.rule.title : step.title}
          </h2>

          {step.kind === 'intro' && (
            <p className="text-[14px] text-white/65 leading-relaxed">{step.text}</p>
          )}

          {step.kind === 'rule' && (
            <ul className="space-y-2.5">
              {step.rule.points.map((p, i) => (
                <li key={i} className="flex gap-2.5 text-[13.5px] text-white/75 leading-snug">
                  <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${accent.dot}`} />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          )}

          {step.kind === 'form' && (
            <>
              <p className="text-[12.5px] text-white/50 leading-snug">{step.hint}</p>

              {step.id === 'about' && (
                <div className="space-y-3">
                  <input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Имя *"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3.5 py-3 text-[14px] outline-none focus:border-brand/60 placeholder:text-white/25" />
                  <input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Фамилия"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3.5 py-3 text-[14px] outline-none focus:border-brand/60 placeholder:text-white/25" />
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="Телефон *"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3.5 py-3 text-[14px] outline-none focus:border-brand/60 placeholder:text-white/25" />
                  <div className="space-y-1.5">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-white/35">Пол · для расселения по палаткам</span>
                    <Chips options={['Мужчина', 'Женщина']} value={gender} onChange={setGender} allowCustom={false} />
                  </div>
                  <div className="space-y-1.5">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-white/35">Дата рождения · клуб поздравляет своих</span>
                    <input type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-3.5 py-3 text-[14px] outline-none focus:border-brand/60 [color-scheme:dark]" />
                  </div>
                </div>
              )}

              {step.id === 'work' && (
                <Chips options={OCCUPATIONS} value={occupation} onChange={setOccupation} multi placeholder="Своя сфера…" />
              )}

              {step.id === 'activity' && (
                <Chips options={ACTIVITIES} value={activities} onChange={setActivities} multi placeholder="Что-то ещё…" />
              )}

              {step.id === 'gear' && (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-white/35">Транспорт</span>
                    <Chips options={TRANSPORT} value={transport} onChange={setTransport} allowCustom={false} />
                    {transport[0] === 'Своё авто' && (
                      <input value={seats} onChange={(e) => setSeats(e.target.value.replace(/\D/g, '').slice(0, 2))}
                        inputMode="numeric" placeholder="Сколько мест могу взять"
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-3.5 py-3 text-[14px] outline-none focus:border-brand/60 placeholder:text-white/25" />
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-white/35">Чем можешь поделиться</span>
                    <Chips options={GEAR} value={gear} onChange={setGear} multi placeholder="Своё снаряжение…" />
                  </div>
                </div>
              )}

              {step.id === 'final' && (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-white/35">Зачем тебе клуб</span>
                    <textarea value={why} onChange={(e) => setWhy(e.target.value)} rows={4}
                      placeholder="Что ищешь и что готов приносить кругу"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-3.5 py-3 text-[14px] outline-none focus:border-brand/60 placeholder:text-white/25 resize-none" />
                  </div>
                  <button
                    type="button" onClick={() => { setUsePhoto((v) => !v); haptic('success'); }}
                    className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl border cursor-pointer text-left transition-all ${
                      usePhoto ? 'bg-brand/10 border-brand/40' : 'bg-white/5 border-white/10'
                    }`}
                  >
                    <Camera className={`w-4 h-4 shrink-0 ${usePhoto ? 'text-brand' : 'text-white/40'}`} />
                    <span className="text-[12.5px] leading-snug text-white/75">
                      Взять моё фото из Telegram — чтобы в круге узнавали в лицо
                    </span>
                    <span className={`ml-auto w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${usePhoto ? 'bg-brand border-brand' : 'border-white/20'}`}>
                      {usePhoto && <Check className="w-3.5 h-3.5 text-black" />}
                    </span>
                  </button>
                </div>
              )}
            </>
          )}

          {error && <p className="text-[12px] text-rose-400 leading-snug">{error}</p>}
        </div>
      </div>

      {/* ── Действие ──────────────────────────────────────────────────── */}
      <div className="shrink-0 px-5 pr-9 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
        <div className="max-w-md mx-auto">
          <button
            type="button"
            onClick={next}
            disabled={sending}
            className="w-full bg-brand hover:bg-brand-hover text-black font-black py-3.5 rounded-2xl uppercase text-[12px] tracking-[0.12em] cursor-pointer border-none disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {sending
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Отправляю…</>
              : isLast
                ? <>Отправить заявку <ArrowRight className="w-4 h-4" /></>
                : step.kind === 'rule'
                  ? <>{step.rule.acceptLabel} <Check className="w-4 h-4" /></>
                  : step.kind === 'intro'
                    ? <>{step.cta} <ArrowRight className="w-4 h-4" /></>
                    : <>Дальше <ArrowRight className="w-4 h-4" /></>}
          </button>
          {step.kind === 'rule' && (
            <p className="text-[10px] text-white/30 text-center mt-2 leading-snug">
              Принятые правила запоминаются — при записи на события их не спросят заново.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
