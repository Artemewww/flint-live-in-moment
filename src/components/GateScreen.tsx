import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Lock, KeyRound, ArrowRight, Loader2, UserPlus, X, CheckCircle } from 'lucide-react';
import { LogoMain } from './VectorIcons';
import { getInitData, getStartParam, haptic, openBot, closeToBot, isInsideTelegram } from '../telegram';
import { submitClubApplication } from '../api';

/**
 * Шлюз закрытого клуба. Показывается, когда включён флаг VITE_GATE_ENABLED и
 * пользователь ещё не подтверждён. Двери открываются валидной реф-ссылкой/кодом
 * (или автоматически, если внутри Telegram и уже участник).
 */

/** Достаёт ref-код из строки: ссылка t.me/...?start=ref_CODE, ?ref=CODE или сам код. */
function extractRefCode(raw: string): string {
  const s = (raw || '').trim();
  const m = s.match(/(?:ref_|[?&](?:ref|start|startapp)=(?:ref_)?)([a-zA-Z0-9]+)/);
  if (m) return m[1];
  return s.replace(/^ref_/, '');
}

/**
 * `applyOnly` — экран открыт РАДИ АНКЕТЫ, а не ради кода: человек уже прошёл
 * визуальный шлюз (по реф-ссылке), но членом клуба ещё не стал, и сервер не
 * отдаёт ему афишу. Раньше он упирался в «Только для участников» со ссылкой
 * «Вступить через бот» — анкеты там не было вообще, и путь обрывался.
 * В этом режиме автопроверку кода не запускаем (она уже проходила и снова
 * позвала бы onPass), а сразу показываем форму заявки.
 */
export default function GateScreen({ onPass, onAdmin, applyOnly }: { onPass: () => void; onAdmin?: () => void; applyOnly?: boolean }) {
  const [input, setInput] = useState('');
  const [checking, setChecking] = useState(!applyOnly);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Состояние для формы заявки. `?apply=1` — deep-link из бота («Подать заявку»):
  // бот больше не ведёт свой диалог заявки, а открывает эту форму в Mini App.
  const [showApplyForm, setShowApplyForm] = useState(() => {
    if (applyOnly) return true;
    try { return new URLSearchParams(window.location.search).get('apply') === '1'; } catch { return false; }
  });
  const [applyName, setApplyName] = useState('');
  const [applyLastName, setApplyLastName] = useState('');
  const [applyPhone, setApplyPhone] = useState('');
  /**
   * «Откуда узнал» — если человек пришёл по ссылке-приглашению, ответ уже
   * известен, и спрашивать его второй раз незачем: подставляем код и
   * показываем поле только тем, кто пришёл сам по себе.
   */
  const knownRef = (() => {
    try {
      const p = new URLSearchParams(window.location.search).get('ref');
      if (p) return p;
      const saved = localStorage.getItem('flint_ref');
      if (saved) return saved;
    } catch { /* нет window/localStorage */ }
    return extractRefCode(getStartParam());
  })();
  const [applySource, setApplySource] = useState(knownRef ? `по ссылке-приглашению (код ${knownRef})` : '');
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState('');
  const [applySuccess, setApplySuccess] = useState(false);

  // Состояние для блокировки
  const [blocked, setBlocked] = useState(false);
  const [pendingReview, setPendingReview] = useState(false);

  const validate = async (ref: string): Promise<boolean> => {
    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'gate', ref, initData: getInitData() }),
      });
      const json = await res.json();
      if (json.blocked) {
        setBlocked(true);
        setChecking(false);
        return false;
      }
      if (json.pending) {
        setPendingReview(true);
        setChecking(false);
        return false;
      }
      if (json.valid) {
        try { localStorage.setItem('flint_gate_ok', '1'); } catch {}
        if (ref) { try { localStorage.setItem('flint_ref', ref); } catch {} }
        haptic('success');
        onPass();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  // Автопроверка: реф из URL/Telegram start_param или членство внутри Telegram.
  useEffect(() => {
    if (applyOnly) return; // код уже проверен, экран открыт ради анкеты
    (async () => {
      const urlRef = new URLSearchParams(window.location.search).get('ref') || '';
      const startRef = extractRefCode(getStartParam());
      const ref = urlRef || startRef || '';
      const ok = await validate(ref);
      if (!ok) setChecking(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async () => {
    const ref = extractRefCode(input);
    if (!ref) { setError('Введите код или ссылку-приглашение'); return; }
    setSubmitting(true);
    setError('');
    const ok = await validate(ref);
    if (!ok) { setError('Код не найден. Попроси действующее приглашение у участника клуба.'); haptic('error'); }
    setSubmitting(false);
  };

  const handleApply = async () => {
    if (!applyName.trim()) { setApplyError('Укажите имя'); return; }
    if (!applyPhone.trim()) { setApplyError('Укажите телефон'); return; }
    setApplying(true);
    setApplyError('');
    const result = await submitClubApplication({
      firstName: applyName.trim(),
      lastName: applyLastName.trim() || undefined,
      phone: applyPhone.trim(),
      sourceHint: applySource.trim() || undefined,
      // Пришёл по приглашению — код снимает ручную модерацию на сервере.
      refCode: knownRef || undefined,
    });
    if (result.ok) {
      haptic('success');
      // Впустили сразу (реф-ссылка): не показываем «ждите рассмотрения», а
      // открываем афишу — иначе человек упирался в экран ожидания, будучи
      // уже принятым, и воронка снова обрывалась.
      if (result.approved) {
        try { localStorage.setItem('flint_gate_ok', '1'); } catch {}
        onPass();
        setApplying(false);
        return;
      }
      setApplySuccess(true);
    } else {
      setApplyError(result.message || 'Ошибка при отправке заявки');
      haptic('error');
    }
    setApplying(false);
  };

  if (checking) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] text-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-brand animate-spin" />
      </div>
    );
  }

  // Экран блокировки
  if (blocked) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] text-white flex items-center justify-center p-6 overflow-hidden relative">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-red-500/5 rounded-full blur-3xl pointer-events-none" />
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative z-10 w-full max-w-md bg-[#121212] border border-white/10 rounded-3xl p-8 shadow-2xl text-center"
        >
          <div className="flex justify-center mb-5"><LogoMain size={54} /></div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-500/10 border border-red-500/30 text-red-400 text-[10px] font-mono uppercase tracking-widest mb-4">
            <Lock className="w-3 h-3" /> Доступ заблокирован
          </div>
          <h1 className="font-display font-black text-2xl uppercase italic tracking-tight leading-none mb-2">
            Ваш доступ заблокирован
          </h1>
          <p className="text-sm text-white/50 leading-relaxed mb-6">
            Если вы считаете, что это ошибка, обратитесь в поддержку.
          </p>
          <button
            type="button"
            onClick={() => openBot('https://t.me/campsflint_bot')}
            className="inline-block bg-white/10 hover:bg-white/20 text-white font-mono text-xs uppercase tracking-widest py-3 px-6 rounded-xl transition-all border-none cursor-pointer"
          >
            Написать в поддержку →
          </button>
        </motion.div>
      </div>
    );
  }

  // Экран «заявка на рассмотрении»
  if (pendingReview) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] text-white flex items-center justify-center p-6 overflow-hidden relative">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative z-10 w-full max-w-md bg-[#121212] border border-white/10 rounded-3xl p-8 shadow-2xl text-center"
        >
          <div className="flex justify-center mb-5"><LogoMain size={54} /></div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 text-[10px] font-mono uppercase tracking-widest mb-4">
            <Loader2 className="w-3 h-3" /> Заявка на рассмотрении
          </div>
          <h1 className="font-display font-black text-2xl uppercase italic tracking-tight leading-none mb-2">
            Ваша заявка ещё рассматривается
          </h1>
          <p className="text-sm text-white/50 leading-relaxed mb-6">
            Как только вашу заявку одобрят, вам откроется доступ к афише мероприятий.
          </p>
        </motion.div>
      </div>
    );
  }

  // Экран успешной подачи заявки
  if (applySuccess) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] text-white flex items-center justify-center p-6 overflow-hidden relative">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="relative z-10 w-full max-w-md bg-[#121212] border border-white/10 rounded-3xl p-8 shadow-2xl text-center"
        >
          <div className="flex justify-center mb-5"><LogoMain size={54} /></div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-green-500/10 border border-green-500/30 text-green-400 text-[10px] font-mono uppercase tracking-widest mb-4">
            <CheckCircle className="w-3 h-3" /> Заявка отправлена
          </div>
          <h1 className="font-display font-black text-2xl uppercase italic tracking-tight leading-none mb-3">
            Заявка отправлена!
          </h1>
          <div className="text-left bg-white/5 border border-white/10 rounded-2xl p-4 mb-5 space-y-2.5">
            <p className="text-[11px] text-white/40 uppercase font-mono tracking-widest mb-1">Что дальше</p>
            <div className="flex gap-2.5 text-sm text-white/70">
              <span className="text-brand font-black shrink-0">1</span>
              <span>Костяк клуба рассмотрит заявку вручную — обычно в течение дня.</span>
            </div>
            <div className="flex gap-2.5 text-sm text-white/70">
              <span className="text-brand font-black shrink-0">2</span>
              <span>Ответ придёт тебе <b className="text-white">прямо в бот @campsflint_bot</b>. Открой его и нажми «Старт», чтобы не пропустить.</span>
            </div>
            <div className="flex gap-2.5 text-sm text-white/70">
              <span className="text-brand font-black shrink-0">3</span>
              <span>Как только одобрят — здесь откроется афиша событий.</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => closeToBot('https://t.me/campsflint_bot')}
            className="w-full bg-brand hover:bg-brand-hover text-black font-black font-mono text-xs uppercase tracking-widest py-3.5 rounded-xl cursor-pointer border-none"
          >
            Вернуться в бот →
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white flex items-center justify-center p-6 overflow-hidden relative">
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-brand/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-80 h-80 bg-brand/5 rounded-full blur-3xl pointer-events-none animate-pulse" />

      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', damping: 22, stiffness: 300 }}
        className="relative z-10 w-full max-w-md bg-[#121212] border border-white/10 rounded-3xl p-8 shadow-2xl text-center"
      >
        <div className="flex justify-center mb-5"><LogoMain size={54} /></div>

        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand/10 border border-brand/30 text-brand text-[10px] font-mono uppercase tracking-widest mb-4">
          <Lock className="w-3 h-3" /> Закрытый клуб
        </div>

        <h1 className="font-display font-black text-2xl uppercase italic tracking-tight leading-none mb-2">
          Вход только по приглашению
        </h1>
        <p className="text-sm text-white/50 leading-relaxed mb-6">
          «Живи в моменте» — трезвое сообщество своих. Двери открывает реферальная
          ссылка от действующего участника.
        </p>

        {!showApplyForm ? (
          <>
            <div className="space-y-3 text-left">
              <label className="text-[10px] text-white/40 uppercase font-mono block flex items-center gap-1.5">
                <KeyRound className="w-3 h-3" /> Код или ссылка-приглашение
              </label>
              <input
                value={input}
                onChange={(e) => { setInput(e.target.value); setError(''); }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
                placeholder="t.me/campsflint_bot?start=ref_..."
                className="w-full bg-white/5 border border-white/10 focus:border-brand/40 rounded-xl p-3.5 text-white text-sm outline-none transition-colors placeholder:text-white/25"
              />
              {error && <p className="text-[11px] text-red-400">{error}</p>}

              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="w-full bg-brand hover:bg-brand-hover disabled:opacity-60 text-black font-black font-mono text-xs uppercase tracking-widest py-4 rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer border-none"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Открыть двери <ArrowRight className="w-4 h-4" /></>}
              </button>
            </div>

            <div className="mt-6 pt-6 border-t border-white/5">
              <p className="text-[10px] text-white/30 uppercase font-mono tracking-wider mb-3">
                Нет приглашения?
              </p>
              {/* Заявку принимаем ТОЛЬКО внутри Telegram: личность заявителя
                  берётся из его аккаунта, а при одобрении ответ приходит в бот.
                  На сайте (без Telegram) отправляем человека в бота. */}
              <button
                onClick={() => {
                  if (isInsideTelegram()) { setShowApplyForm(true); setError(''); }
                  else openBot('https://t.me/campsflint_bot?start=apply');
                }}
                className="w-full bg-white/5 hover:bg-white/10 border border-white/10 text-white font-mono text-xs uppercase tracking-widest py-3.5 rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <UserPlus className="w-4 h-4" /> Подать заявку на вступление
              </button>
              {!isInsideTelegram() && (
                <p className="text-[10px] text-white/30 mt-2 leading-relaxed">
                  Вступление в клуб — через Telegram-бота: так заявка привяжется к твоему аккаунту, и придёт ответ.
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={() => openBot('https://t.me/campsflint_bot')}
              className="inline-block mt-4 text-[11px] text-white/40 hover:text-brand transition-colors font-mono bg-transparent border-none cursor-pointer"
            >
              Написать в бот →
            </button>
          </>
        ) : (
          <>
            <div className="space-y-3 text-left">
              <div className="flex items-center justify-between mb-2">
                <label className="text-[10px] text-white/40 uppercase font-mono flex items-center gap-1.5">
                  <UserPlus className="w-3 h-3" /> Заявка на вступление
                </label>
                <button
                  onClick={() => { setShowApplyForm(false); setApplyError(''); }}
                  className="text-white/30 hover:text-white/70 transition-colors bg-transparent border-none cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <input
                value={applyName}
                onChange={(e) => { setApplyName(e.target.value); setApplyError(''); }}
                placeholder="Имя *"
                className="w-full bg-white/5 border border-white/10 focus:border-brand/40 rounded-xl p-3.5 text-white text-sm outline-none transition-colors placeholder:text-white/25"
              />

              <input
                value={applyLastName}
                onChange={(e) => setApplyLastName(e.target.value)}
                placeholder="Фамилия"
                className="w-full bg-white/5 border border-white/10 focus:border-brand/40 rounded-xl p-3.5 text-white text-sm outline-none transition-colors placeholder:text-white/25"
              />

              <input
                value={applyPhone}
                onChange={(e) => { setApplyPhone(e.target.value); setApplyError(''); }}
                placeholder="Телефон *"
                type="tel"
                className="w-full bg-white/5 border border-white/10 focus:border-brand/40 rounded-xl p-3.5 text-white text-sm outline-none transition-colors placeholder:text-white/25"
              />

              {knownRef ? (
                <p className="text-[11px] text-white/45 font-mono bg-white/5 border border-white/10 rounded-xl p-3">
                  Пришёл по ссылке-приглашению — кто позвал, мы уже знаем.
                </p>
              ) : (
                <input
                  value={applySource}
                  onChange={(e) => setApplySource(e.target.value)}
                  placeholder="Откуда узнали о клубе? (необязательно)"
                  className="w-full bg-white/5 border border-white/10 focus:border-brand/40 rounded-xl p-3.5 text-white text-sm outline-none transition-colors placeholder:text-white/25"
                />
              )}

              {applyError && <p className="text-[11px] text-red-400">{applyError}</p>}

              <button
                onClick={handleApply}
                disabled={applying}
                className="w-full bg-brand hover:bg-brand-hover disabled:opacity-60 text-black font-black font-mono text-xs uppercase tracking-widest py-4 rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer border-none"
              >
                {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Отправить заявку <ArrowRight className="w-4 h-4" /></>}
              </button>
            </div>
          </>
        )}

        {/* Организатору шлюз не должен мешать войти в панель. */}
        {onAdmin && (
          <button
            type="button"
            onClick={onAdmin}
            className="block mx-auto mt-3 text-[11px] text-white/30 hover:text-white/70 transition-colors font-mono bg-transparent border-none cursor-pointer"
          >
            Я организатор — вход в админку
          </button>
        )}
      </motion.div>
    </div>
  );
}