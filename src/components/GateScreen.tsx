import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Lock, KeyRound, ArrowRight, Loader2 } from 'lucide-react';
import { LogoMain } from './VectorIcons';
import { getInitData, getStartParam, haptic } from '../telegram';

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

export default function GateScreen({ onPass }: { onPass: () => void }) {
  const [input, setInput] = useState('');
  const [checking, setChecking] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const validate = async (ref: string): Promise<boolean> => {
    try {
      const res = await fetch('/api/gate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref, initData: getInitData() }),
      });
      const json = await res.json();
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

  if (checking) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] text-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-brand animate-spin" />
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

        <a
          href="https://t.me/campsflint_bot"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block mt-5 text-[11px] text-white/40 hover:text-brand transition-colors font-mono"
        >
          Нет приглашения? Написать в бот →
        </a>
      </motion.div>
    </div>
  );
}
