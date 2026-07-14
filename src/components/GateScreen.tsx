import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Lock, KeyRound, ArrowRight, Loader2, UserPlus, X, CheckCircle } from 'lucide-react';
import { LogoMain } from './VectorIcons';
import { getInitData, getStartParam, haptic } from '../telegram';
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

export default function GateScreen({ onPass, onAdmin }: { onPass: () => void; onAdmin?: () => void }) {
  const [input, setInput] = useState('');
  const [checking, setChecking] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Состояние для формы заявки
  const [showApplyForm, setShowApplyForm] = useState(false);
  const [applyName, setApplyName] = useState('');
  const [applyLastName, setApplyLastName] = useState('');
  const [applyPhone, setApplyPhone] = useState('');
  const [applySource, setApplySource] = useState('');
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState('');
  const [applySuccess, setApplySuccess] = useState(false);

  // Состояние для блокировки
  const [blocked, setBlocked] = useState(false);
  const [pendingReview, setPendingReview] = useState(false);

  const validate = async (ref: string): Promise<boolean> => {
    try {
      const res = await fetch('/api/club', {
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
    });
    if (result.ok) {
      setApplySuccess(true);
      haptic('success');
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
          <a
            href="https://t.me/campsflint_bot"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block bg-white/10 hover:bg-white/20 text-white font-mono text-xs uppercase tracking-widest py-3 px-6 rounded-xl transition-all"
          >
            Написать в поддержку →
          </a>
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
          <h1 className="font-display font-black text-2xl uppercase italic tracking-tight leading-none mb-2">
            Спасибо!
          </h1>
          <p className="text-sm text-white/50 leading-relaxed mb-6">
            Ваша заявка на вступление в клуб отправлена. Мы свяжемся с вами после рассмотрения.
          </p>
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
              <button
                onClick={() => { setShowApplyForm(true); setError(''); }}
                className="w-full bg-white/5 hover:bg-white/10 border border-white/10 text-white font-mono text-xs uppercase tracking-widest py-3.5 rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <UserPlus className="w-4 h-4" /> Подать заявку на вступление
              </button>
            </div>

            <a
              href="https://t.me/campsflint_bot"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mt-4 text-[11px] text-white/40 hover:text-brand transition-colors font-mono"
            >
              Написать в бот →
            </a>
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

              <input
                value={applySource}
                onChange={(e) => setApplySource(e.target.value)}
                placeholder="Откуда узнали о клубе? (необязательно)"
                className="w-full bg-white/5 border border-white/10 focus:border-brand/40 rounded-xl p-3.5 text-white text-sm outline-none transition-colors placeholder:text-white/25"
              />

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