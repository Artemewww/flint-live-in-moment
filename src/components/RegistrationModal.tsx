import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { X, Send, CheckCircle2, ShieldCheck, Bell, Sparkles, Loader2, Bot, Info, Users, Copy, Check, Truck, Package } from 'lucide-react';
import { CommunityEvent, Registration } from '../types';
import { isInsideTelegram, getTelegramUser, getStartParam, haptic } from '../telegram';
import { submitRegistration } from '../api';

interface RegistrationModalProps {
  event: CommunityEvent;
  onClose: () => void;
  onSuccess: (registration: Registration) => void;
}

const insideTg = isInsideTelegram();

export default function RegistrationModal({ event, onClose, onSuccess }: RegistrationModalProps) {
  // Внутри Telegram личность известна сразу → сразу 'detected'.
  // В обычном браузере честно показываем ручную форму.
  const [sessionState, setSessionState] = useState<'scanning' | 'detected' | 'manual'>(
    insideTg ? 'scanning' : 'manual'
  );
  const [tgUsername, setTgUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [formData, setFormData] = useState({
    hasTransport: false,
    transportDetails: '',
    transportSeats: 0,
    inventory: '',
    category: 'male' as 'male' | 'female',
    dietary: 'omnivore' as 'omnivore' | 'vegetarian' | 'vegan',
    guestCount: 0,
    equipment: '',
    roles: '',
    source: ''
  });

  // Referral flow inputs
  const [inviter, setInviter] = useState('');
  const [isCopied, setIsCopied] = useState(false);
  // Код доступа к закрытому событию (нужен только когда event.isPublic === false).
  const [accessCode, setAccessCode] = useState('');
  const isClosedEvent = event.isPublic === false;

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDone, setIsDone] = useState(false);
  /** Сервер сообщил, что заявка уже была (анти-дубль) — показываем «вы уже записаны». */
  const [alreadyReg, setAlreadyReg] = useState(false);
  const [delivered, setDelivered] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const [consentGiven, setConsentGiven] = useState(false);

  // Определяем реферала (из URL или Telegram start_param) и личность из Telegram.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlRef = params.get('ref') || params.get('start') || '';
    const tgStart = getStartParam().replace(/^ref_/, '');
    const ref = urlRef || tgStart;
    if (ref) setInviter(ref);

    if (insideTg) {
      const u = getTelegramUser();
      if (u) {
        setTgUsername(u.username || `id${u.id}`);
        setFullName([u.first_name, u.last_name].filter(Boolean).join(' '));
      }
      // Небольшая пауза для плавного появления «подтверждено».
      const timer = setTimeout(() => setSessionState('detected'), 600);
      return () => clearTimeout(timer);
    }
  }, []);

  const finishSuccess = async (name: string, tg: string, phoneVal: string) => {
    setIsSubmitting(true);
    setError('');

    const result = await submitRegistration({
      eventId: event.id,
      eventTitle: event.title,
      name,
      telegram: tg,
      phone: phoneVal,
      inviter: inviter.trim(),
      source: insideTg ? 'telegram-mini-app' : 'website',
      accessCode: isClosedEvent ? accessCode.trim() : undefined,
    });

    // Закрытое событие с неверным кодом — сервер вернул отказ. Не показываем «успех».
    if (!result.ok && result.code === 'access_denied') {
      setError(result.message || 'Неверный код доступа к закрытому событию');
      setIsSubmitting(false);
      haptic('error');
      return;
    }

    // Анти-дубль: сервер уже видел заявку — всё равно отмечаем «записан», но текст другой.
    setAlreadyReg(!!result.alreadyRegistered);

    const reg: Registration = {
      id: `reg-${Date.now()}`,
      eventId: event.id,
      name,
      phone: phoneVal,
      telegram: tg.startsWith('@') ? tg : `@${tg}`,
      status: 'pending',
      registeredAt: new Date().toISOString(),
      hasTransport: formData.hasTransport,
      transportDetails: formData.hasTransport ? formData.transportDetails : undefined,
      transportSeats: formData.hasTransport ? formData.transportSeats : 0,
      inventory: formData.inventory ? formData.inventory.split(',').map(item => item.trim()).filter(Boolean) : [],
      paymentStatus: 'pending',
      paymentAmount: 0,
      donationAmount: 0,
      category: formData.category,
      dietary: formData.dietary,
      guestCount: formData.guestCount || undefined,
      equipment: formData.equipment ? formData.equipment.split(',').map(item => item.trim()).filter(Boolean) : undefined,
      roles: formData.roles ? formData.roles.split(',').map(item => item.trim()).filter(Boolean) : undefined,
      source: formData.source || undefined
    };

    onSuccess(reg);
    setDelivered(result.delivered);
    setIsDone(true);
    setIsSubmitting(false);
    haptic('success');
  };

  const handleApplyAutoMatch = () => {
    if (!inviter.trim()) {
      setError('Сообщество закрытое. Обязательно укажите, кто вас пригласил (Имя / никнейм друга или инвайт-код)');
      haptic('error');
      return;
    }
    if (isClosedEvent && !accessCode.trim()) {
      setError('Это закрытое событие — введите код доступа');
      haptic('error');
      return;
    }
    finishSuccess(fullName || 'Гость', tgUsername, phone);
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!fullName.trim()) return setError('Пожалуйста, введите Ваше имя');
    if (!phone.trim()) return setError('Пожалуйста, укажите телефон для связи');
    if (!inviter.trim()) return setError('Пожалуйста, обязательно укажите, от кого вы пришли (Имя друга или промокод)');
    if (isClosedEvent && !accessCode.trim()) return setError('Это закрытое событие — введите код доступа');

    // Вне Telegram идентификатор — телефон с префиксом (уходит в отрицательный id, без коллизий с реальными TG).
    finishSuccess(fullName, `web-${phone.replace(/\D/g, '')}`, phone);
  };

  // Copy referral link to share with friends
  const handleCopyLink = () => {
    const cleanNick = tgUsername.replace(/^@/, '');
    const personalRefLink = `${window.location.origin}${window.location.pathname}?ref=${cleanNick}`;
    navigator.clipboard.writeText(personalRefLink);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 shadow-2xl" id="reg-modal-root">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        id="reg-modal-backdrop"
        className="absolute inset-0 bg-black/90 backdrop-blur-md"
      />

      {/* Modal Card */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        id="reg-modal-card"
        className="bg-[#121212] rounded-3xl w-full max-w-lg overflow-hidden relative z-10 border border-white/10 flex flex-col text-white my-auto"
      >
        {/* Header decoration */}
        <div className="p-6 border-b border-white/10 flex justify-between items-start bg-[#181818]">
          <div className="space-y-1">
            <span className="text-[9px] uppercase font-mono font-bold tracking-widest text-[#000] bg-[#E6FD3A] px-2.5 py-1 rounded-full inline-block">
              Telegram Verification & Closed Entry
            </span>
            <h3 className="font-display font-black text-xl text-white uppercase tracking-tight">
              Запись в Закрытый Круг
            </h3>
            <p className="text-xs text-brand font-mono uppercase tracking-wide">
              Событие: {event.title} • {event.dateLabel}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 px-2.5 py-1.5 rounded-xl text-white/40 hover:text-white hover:bg-white/5 transition-colors cursor-pointer border border-white/10 font-mono text-[9px] uppercase font-bold"
            id="close-modal-btn"
          >
            Закрыть
          </button>
        </div>

        {/* Modal Scrollable Canvas */}
        <div className="p-6 overflow-y-auto max-h-[75vh]" id="modal-scroll-area">
          {!isDone ? (
            <div className="space-y-5">
              
              {/* Closed community value proposition */}
              <div className="bg-[#E6FD3A]/5 border border-[#E6FD3A]/25 p-4 rounded-2xl flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-[#E6FD3A] shrink-0 mt-0.5" />
                <div className="text-xs text-white/80 leading-relaxed font-sans">
                  <strong className="text-[#E6FD3A] block uppercase tracking-wide font-black mb-0.5">Вход строго по приглашениям</strong>
                  Сообщество «Moment» является камерным и закрытым. Попасть на любую встречу можно только указав имя резидента или рабочий инвайт-код.
                </div>
              </div>

              {/* TELEGRAM AUTH SCANNER WIDGET */}
              <div className="bg-[#181818] border border-white/5 rounded-2xl p-5 space-y-4">
                
                {sessionState === 'scanning' && (
                  <div className="py-6 flex flex-col items-center justify-center text-center space-y-3">
                    <Loader2 className="w-8 h-8 text-brand animate-spin" />
                    <div className="space-y-1">
                      <span className="text-xs text-brand font-mono uppercase tracking-widest block font-bold">Определение защищенной сессии...</span>
                      <p className="text-[10px] text-white/40 max-w-xs leading-normal font-sans">
                        Связываемся со шлюзом Telegram для верификации вашего аккаунта...
                      </p>
                    </div>
                  </div>
                )}

                {sessionState === 'detected' && (
                  <div className="space-y-4 font-sans text-center">
                    <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-brand/10 border border-brand/20 text-brand">
                      <Bot className="w-6 h-6 animate-pulse text-[#E6FD3A]" />
                    </div>
                    
                    <div className="space-y-1">
                      <span className="text-[9px] uppercase font-mono tracking-widest text-[#E6FD3A] block font-black">Telegram-сессия верифицирована!</span>
                      <h4 className="font-display font-black text-white text-base uppercase">@{tgUsername}</h4>
                    </div>

                    {/* REFERRAL INPUT FIELD */}
                    <div className="text-left bg-black/40 p-4 rounded-2xl border border-white/10 space-y-3">
                      <div>
                        <label className="block text-[10px] font-mono font-bold uppercase tracking-wider text-[#E6FD3A] mb-1.5 flex items-center justify-between">
                          <span>Кто пригласил вас в Клуб? *</span>
                          <span className="text-white/40 font-normal">Обязательно</span>
                        </label>
                        <input
                          type="text"
                          value={inviter}
                          onChange={(e) => setInviter(e.target.value)}
                          placeholder="Имя друга, никнейм в TG или код приглашения"
                          className="w-full px-4 py-3 rounded-xl border border-white/10 focus:border-[#E6FD3A] focus:ring-1 focus:ring-[#E6FD3A]/30 outline-none text-xs transition-all bg-[#121212] text-white font-mono"
                          required
                        />
                        <span className="text-[9px] text-white/40 font-mono block mt-1 uppercase">
                          Без указания пригласившего лица заявка отсеивается ботом.
                        </span>
                      </div>
                    </div>

                    {isClosedEvent && (
                      <div className="text-left bg-black/40 p-4 rounded-2xl border border-[#E6FD3A]/20 space-y-2">
                        <label className="block text-[10px] font-mono font-bold uppercase tracking-wider text-[#E6FD3A] mb-1.5">
                          🔒 Код доступа к закрытому событию *
                        </label>
                        <input
                          type="text"
                          value={accessCode}
                          onChange={(e) => setAccessCode(e.target.value)}
                          placeholder="Кодовое слово из приглашения"
                          autoComplete="off"
                          className="w-full px-4 py-3 rounded-xl border border-white/10 focus:border-[#E6FD3A] focus:ring-1 focus:ring-[#E6FD3A]/30 outline-none text-xs transition-all bg-[#121212] text-white font-mono"
                        />
                      </div>
                    )}

                    <div className="text-left">
                      <label className="block text-[10px] font-mono font-bold uppercase tracking-wider text-white/50 mb-1.5">
                        Ваше имя
                      </label>
                      <input
                        type="text"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder="Как к вам обращаться"
                        className="w-full px-4 py-3 rounded-xl border border-white/10 focus:border-brand focus:ring-1 focus:ring-brand/35 outline-none text-xs transition-all bg-[#121212] text-white font-sans"
                      />
                    </div>

                    <div className="bg-black/20 py-2.5 px-4 rounded-xl text-left text-xs text-white/60 space-y-1">
                      <div className="flex justify-between py-1 items-center">
                        <span>Аккаунт Telegram</span>
                        <span className="font-bold text-brand font-mono">@{tgUsername}</span>
                      </div>
                    </div>

                    {error && (
                      <div className="text-[10px] bg-rose-500/10 border border-rose-500/20 text-rose-400 p-2.5 rounded-xl font-mono text-left uppercase tracking-wide leading-normal">
                        ⚠️ {error}
                      </div>
                    )}

                    {/* ACTIONS */}
                    <div className="space-y-2 pt-1">
                      <button
                        type="button"
                        onClick={handleApplyAutoMatch}
                        disabled={isSubmitting}
                        className="w-full bg-brand hover:bg-brand-hover text-black py-3.5 px-6 rounded-xl text-xs sm:text-sm font-black uppercase tracking-widest transition-all cursor-pointer flex items-center justify-center gap-2 border-none active:scale-98 shadow-md shadow-brand/10"
                      >
                        {isSubmitting ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin text-black" />
                            Проверка приглашения...
                          </>
                        ) : (
                          <>
                            <Send className="w-4 h-4 fill-black text-black" />
                            Подтвердить участие через Telegram
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => setSessionState('manual')}
                        className="text-[10px] text-white/40 hover:text-white transition-all underline font-mono uppercase bg-transparent border-none cursor-pointer"
                      >
                        Регистрация вручную (другой контакт)
                      </button>
                    </div>
                  </div>
                )}

                {sessionState === 'manual' && (
                  <form onSubmit={handleManualSubmit} className="space-y-4 text-left font-sans">
                    <span className="text-[9px] uppercase font-mono tracking-widest text-[#E6FD3A]/60 block font-black border-b border-white/5 pb-2">
                      Реестр ручной инвайт-регистрации
                    </span>

                    {!insideTg && (
                      <div className="bg-brand/5 border border-brand/20 rounded-xl p-3 flex items-start gap-2 text-[10px] text-white/70 font-sans leading-normal">
                        <Bot className="w-4 h-4 text-brand shrink-0 mt-0.5" />
                        <span>
                          Совет: откройте афишу через <strong className="text-brand">@campsflint_bot</strong> — тогда имя и Telegram подтянутся автоматически, а заявка сразу уйдёт организатору.
                        </span>
                      </div>
                    )}

                    <div>
                      <label className="block text-[10px] font-mono font-bold uppercase tracking-wider text-white/50 mb-1.5">
                        Ваше имя / позывной *
                      </label>
                      <input
                        type="text"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder="Например, Александр"
                        className="w-full px-4 py-3 rounded-xl border border-white/10 focus:border-brand focus:ring-1 focus:ring-brand/35 outline-none text-xs transition-all bg-[#161616] text-white font-sans"
                        required
                        disabled={isSubmitting}
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-mono font-bold uppercase tracking-wider text-[#E6FD3A] mb-1.5">
                        Кто пригласил в Клуб? (Ник друга / Код) *
                      </label>
                      <input
                        type="text"
                        value={inviter}
                        onChange={(e) => setInviter(e.target.value)}
                        placeholder="Обязательно укажите резидента"
                        className="w-full px-4 py-3 rounded-xl border border-[#E6FD3A]/30 focus:border-brand focus:ring-1 focus:ring-brand/35 outline-none text-xs transition-all bg-[#161616] text-white font-mono"
                        required
                        disabled={isSubmitting}
                      />
                    </div>

                    {isClosedEvent && (
                      <div>
                        <label className="block text-[10px] font-mono font-bold uppercase tracking-wider text-[#E6FD3A] mb-1.5">
                          🔒 Код доступа к закрытому событию *
                        </label>
                        <input
                          type="text"
                          value={accessCode}
                          onChange={(e) => setAccessCode(e.target.value)}
                          placeholder="Кодовое слово из приглашения"
                          autoComplete="off"
                          className="w-full px-4 py-3 rounded-xl border border-[#E6FD3A]/30 focus:border-brand focus:ring-1 focus:ring-brand/35 outline-none text-xs transition-all bg-[#161616] text-white font-mono"
                          disabled={isSubmitting}
                        />
                      </div>
                    )}

                    <div>
                      <label className="block text-[10px] font-mono font-bold uppercase tracking-wider text-white/50 mb-1.5">
                        Телефон для связи
                      </label>
                      <input
                        type="text"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="+375 (29) 111-22-33"
                        className="w-full px-4 py-3 rounded-xl border border-white/10 focus:border-brand focus:ring-1 focus:ring-brand/35 outline-none text-xs transition-all bg-[#161616] text-white font-mono"
                        disabled={isSubmitting}
                      />
                    </div>

                    {/* Транспорт */}
                    <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id="hasTransport"
                          checked={(formData as any).hasTransport || false}
                          onChange={(e) => setFormData({...formData, hasTransport: e.target.checked} as any)}
                        />
                        <label htmlFor="hasTransport" className="text-xs text-white/60 flex items-center gap-2">
                          <Truck className="w-4 h-4 text-brand" />
                          У меня есть транспорт
                        </label>
                      </div>

                      {(formData as any).hasTransport && (
                        <div className="space-y-2 pl-6">
                          <input
                            type="text"
                            value={(formData as any).transportDetails || ''}
                            onChange={(e) => setFormData({...formData, transportDetails: e.target.value} as any)}
                            className="w-full bg-white/5 border border-white/10 rounded-xl p-2 text-white text-xs"
                            placeholder="Марка/модель авто"
                          />
                          <input
                            type="number"
                            value={(formData as any).transportSeats || 0}
                            onChange={(e) => setFormData({...formData, transportSeats: parseInt(e.target.value) || 0} as any)}
                            className="w-full bg-white/5 border border-white/10 rounded-xl p-2 text-white text-xs"
                            placeholder="Количество мест (включая ваше)"
                            min="1"
                          />
                        </div>
                      )}
                    </div>

                    {/* Инвентарь */}
                    <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-2">
                      <label className="text-xs text-white/60 flex items-center gap-2">
                        <Package className="w-4 h-4 text-brand" />
                        Инвентарь (через запятую)
                      </label>
                      <textarea
                        value={(formData as any).inventory || ''}
                        onChange={(e) => setFormData({...formData, inventory: e.target.value} as any)}
                        className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white text-xs"
                        placeholder="Палатка, спальник, каремат, газовка..."
                        rows={2}
                      />
                    </div>

                    {/* Категория участника */}
                    <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
                      <label className="text-xs text-white/60 block">Категория участника *</label>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setFormData({...formData, category: 'male'} as any)}
                          className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
                            formData.category === 'male'
                              ? 'bg-brand text-black'
                              : 'bg-white/10 text-white/60 hover:bg-white/20'
                          }`}
                        >
                          Мужчина
                        </button>
                        <button
                          type="button"
                          onClick={() => setFormData({...formData, category: 'female'} as any)}
                          className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
                            formData.category === 'female'
                              ? 'bg-brand text-black'
                              : 'bg-white/10 text-white/60 hover:bg-white/20'
                          }`}
                        >
                          Женщина
                        </button>
                      </div>
                    </div>

                    {/* Пищевые предпочтения */}
                    <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-2">
                      <label className="text-xs text-white/60 block">Пищевые предпочтения</label>
                      <select
                        value={formData.dietary}
                        onChange={(e) => setFormData({...formData, dietary: e.target.value as any})}
                        className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white text-xs"
                      >
                        <option value="omnivore">Всеядный</option>
                        <option value="vegetarian">Вегетарианец</option>
                        <option value="vegan">Веган</option>
                      </select>
                    </div>

                    {/* Гости: сколько человек берёшь с собой (0–2 кнопкой или своё число) */}
                    <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
                      <label className="text-xs text-white/60 block">Берёте кого-то с собой?</label>
                      <div className="flex gap-2">
                        {[0, 1, 2].map((n) => (
                          <button
                            key={n}
                            type="button"
                            onClick={() => setFormData({...formData, guestCount: n})}
                            className={`flex-1 py-3 rounded-lg text-xs font-bold transition-all ${
                              formData.guestCount === n
                                ? 'bg-brand text-black'
                                : 'bg-white/10 text-white/60 hover:bg-white/20'
                            }`}
                          >
                            {n === 0 ? 'Один' : `+${n}`}
                          </button>
                        ))}
                        {/* Своё число: инпут подсвечивается, когда выбрано 3+ */}
                        <input
                          type="number"
                          min={0}
                          max={50}
                          inputMode="numeric"
                          placeholder="своё"
                          value={formData.guestCount && formData.guestCount > 2 ? formData.guestCount : ''}
                          onChange={(e) => {
                            const v = Math.max(0, Math.min(50, parseInt(e.target.value, 10) || 0));
                            setFormData({...formData, guestCount: v});
                          }}
                          className={`w-16 py-3 rounded-lg text-xs font-bold text-center transition-all border ${
                            (formData.guestCount || 0) > 2
                              ? 'bg-brand text-black border-brand'
                              : 'bg-white/10 text-white/60 border-white/10 placeholder:text-white/30'
                          }`}
                        />
                      </div>
                      {(formData.guestCount || 0) > 0 && (
                        <p className="text-[10px] text-white/50 italic">
                          Вы берёте с собой {formData.guestCount} {(formData.guestCount || 0) === 1 ? 'гостя' : 'человек'}. За гостей отвечаете и оплачиваете вы.
                        </p>
                      )}
                    </div>

                    {/* Снаряжение (чек-лист) */}
                    <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
                      <label className="text-xs text-white/60 block">Снаряжение (выберите что есть)</label>
                      <div className="grid grid-cols-2 gap-2">
                        {['Вилка', 'Ложка', 'Спальник', 'Фонарик', 'Дождевик', 'Аптечка', 'Мусорные пакеты', 'Антисептик', 'Туалетная бумага', 'Лопата'].map((item) => (
                          <label key={item} className="flex items-center gap-2 text-xs text-white/60 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={(formData.equipment || '').split(',').includes(item)}
                              onChange={(e) => {
                                const current = formData.equipment ? formData.equipment.split(',').filter(Boolean) : [];
                                const updated = e.target.checked
                                  ? [...current, item]
                                  : current.filter(i => i !== item);
                                setFormData({...formData, equipment: updated.join(',')} as any);
                              }}
                              className="rounded"
                            />
                            {item}
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Роли */}
                    <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-2">
                      <label className="text-xs text-white/60 block">Готов помочь с (роли)</label>
                      <div className="grid grid-cols-2 gap-2">
                        {['Готовка', 'Уборка', 'Транспорт', 'Фото', 'Музыка', 'Организация'].map((role) => (
                          <label key={role} className="flex items-center gap-2 text-xs text-white/60 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={(formData.roles || '').split(',').includes(role)}
                              onChange={(e) => {
                                const current = formData.roles ? formData.roles.split(',').filter(Boolean) : [];
                                const updated = e.target.checked
                                  ? [...current, role]
                                  : current.filter(i => i !== role);
                                setFormData({...formData, roles: updated.join(',')} as any);
                              }}
                              className="rounded"
                            />
                            {role}
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Источник */}
                    <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-2">
                      <label className="text-xs text-white/60 block">Откуда узнали о мероприятии?</label>
                      <input
                        type="text"
                        value={formData.source}
                        onChange={(e) => setFormData({...formData, source: e.target.value})}
                        className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white text-xs"
                        placeholder="Telegram, друг, соцсети..."
                      />
                    </div>

                    {/* Согласие на обработку персональных данных */}
                    <div className="bg-rose-500/5 border border-rose-500/20 rounded-xl p-4 space-y-2">
                      <label className="flex items-start gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={consentGiven}
                          onChange={(e) => setConsentGiven(e.target.checked)}
                          className="mt-0.5 rounded"
                          required
                        />
                        <span className="text-xs text-white/70 leading-relaxed">
                          Я согласен на обработку персональных данных в соответствии с{' '}
                          <a href="#" className="text-brand underline">политикой конфиденциальности</a>
                          {' '}и даю согласие на участие в мероприятии
                        </span>
                      </label>
                    </div>

                    {error && (
                      <div className="text-[10px] bg-rose-500/10 border border-rose-500/20 text-rose-400 p-2.5 rounded-xl font-mono uppercase tracking-wide">
                        ⚠️ {error}
                      </div>
                    )}

                    <div className="pt-2 flex gap-3 text-xs font-mono">
                      {insideTg && (
                        <button
                          type="button"
                          onClick={() => setSessionState('detected')}
                          className="flex-1 border border-white/10 py-3 rounded-xl text-white/60 hover:text-white hover:bg-white/5 transition-all text-center uppercase tracking-wider cursor-pointer bg-transparent"
                        >
                          Назад
                        </button>
                      )}

                      <button
                        type="submit"
                        disabled={isSubmitting}
                        className="flex-1 bg-[#E6FD3A] hover:bg-[#d8ed31] text-black py-3 rounded-xl font-black transition-all flex items-center justify-center gap-1 cursor-pointer border-none uppercase tracking-wider disabled:opacity-60"
                      >
                        {isSubmitting ? 'Отправка…' : 'Продолжить'}
                      </button>
                    </div>
                  </form>
                )}

              </div>
              
              {/* Emergency fine print */}
              <div className="text-[10px] text-white/40 text-center uppercase tracking-wider font-mono">
                Закрытая Среда • Проверка соответствия Кодексу
              </div>
            </div>
          ) : (
            /* Immersive Success Screen with invite link generator code! */
            <div className="text-center py-6 space-y-6" id="success-registration-screen">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-brand/10 border border-brand/20 text-brand rounded-full">
                <CheckCircle2 className="w-10 h-10 text-[#E6FD3A]" />
              </div>

              <div className="space-y-1.5">
                <span className="text-[9px] uppercase font-mono tracking-widest text-[#E6FD3A] bg-[#E6FD3A]/10 px-3 py-1 rounded-full font-black">
                  {alreadyReg ? 'Вы уже записаны' : 'Гость в базе • Синхронизация завершена'}
                </span>
                <h4 className="font-display font-black text-2xl text-white uppercase tracking-tight">
                  {alreadyReg ? 'Вы уже в списке!' : 'Добро пожаловать в круг!'}
                </h4>
                <p className="text-xs text-white/70 max-w-sm mx-auto font-sans leading-relaxed">
                  {alreadyReg ? (
                    <>Вы уже записаны на «{event.title}». Повторная заявка не нужна — ждите деталей и напоминаний. Подтвердить участие можно в боте ниже.</>
                  ) : (
                    <>Поздравляем! Вы записаны по приглашению от <strong className="text-[#E6FD3A] font-mono">{inviter}</strong>. Ваш аккаунт <strong className="text-brand">@{tgUsername}</strong> в заявке на «{event.title}».</>
                  )}
                </p>
              </div>

              {/* Статус доставки заявки организатору через Telegram-бот */}
              <div className={`mx-auto max-w-sm text-[10px] font-mono uppercase tracking-wider px-3 py-2 rounded-xl border flex items-center justify-center gap-2 ${
                delivered
                  ? 'bg-brand/10 border-brand/25 text-brand'
                  : 'bg-white/5 border-white/10 text-white/50'
              }`}>
                {delivered ? (
                  <><Check className="w-3.5 h-3.5" /> Заявка доставлена организатору в Telegram</>
                ) : (
                  <><Bell className="w-3.5 h-3.5" /> Заявка сохранена • подтвердите её в боте ниже</>
                )}
              </div>

              {/* GENERATE REFFERAL LINK TO SHARE */}
              <div className="bg-[#181818] border border-white/10 p-5 rounded-2xl text-left space-y-3 max-w-sm mx-auto font-sans">
                <div>
                  <span className="font-bold text-white uppercase tracking-wider text-[10px] block mb-1">Ваша личная реферальная ссылка:</span>
                  <p className="text-[10px] text-white/40 leading-normal mb-3">
                    Приглашайте только тех близких, за чью порядочность и трезвость готовы поручиться лично.
                  </p>
                  
                  <div className="flex gap-2">
                    <div className="flex-1 bg-black rounded-lg border border-white/10 px-3 py-2 text-[11px] font-mono select-all overflow-hidden text-white/70 whitespace-nowrap text-ellipsis flex items-center">
                      {window.location.origin}/?ref={tgUsername.replace('@', '')}
                    </div>
                    <button 
                      onClick={handleCopyLink}
                      className="bg-[#E6FD3A] hover:bg-[#d8ed31] text-black w-9 h-9 shrink-0 rounded-lg flex items-center justify-center transition-all cursor-pointer border-none"
                      title="Копировать"
                    >
                      {isCopied ? <Check className="w-4 h-4 text-black font-black" /> : <Copy className="w-4 h-4 text-black" />}
                    </button>
                  </div>
                  {isCopied && (
                    <span className="text-[9px] text-[#E6FD3A] font-mono block mt-1 text-right uppercase tracking-wider font-bold">
                      Скопировано в буфер обмена!
                    </span>
                  )}
                </div>
              </div>

              {/* AUTOMATIC NOTIFICATION BOT ALERTS DETAILS */}
              <div className="bg-black/40 border border-white/5 p-4 rounded-xl text-left text-xs text-white/60 space-y-2.5 max-w-sm mx-auto font-mono">
                <div className="flex gap-2.5 items-start">
                  <Bell className="w-4 h-4 text-[#E6FD3A] mt-0.5 shrink-0" />
                  <div>
                    <span className="font-bold text-white uppercase tracking-widest text-[9px] block">Автоматические напоминания:</span>
                    <ul className="mt-1 text-white/55 space-y-0.5 text-[10px] list-none pl-0 leading-normal uppercase">
                      <li>• Оповещение с локацией сбора (за 24 ч)</li>
                      <li>• Напоминание с контактами старшего (за 2 ч)</li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* DIRECT TELEGRAM TRIGGER LINK */}
              <div className="pt-2 flex flex-col gap-2 font-mono">
                <a
                  href={`https://t.me/campsflint_bot?start=event_${event.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full bg-brand hover:bg-brand-hover text-black font-black py-4 px-6 rounded-xl text-xs transition-all flex items-center justify-center gap-2 shadow-lg shadow-brand/15 cursor-pointer uppercase tracking-widest border-none text-center"
                >
                  <Send className="w-4 h-4 fill-black text-black" />
                  Подтвердить регистрацию в боте
                </a>
                
                <button
                  type="button"
                  onClick={onClose}
                  className="text-xs text-white/40 hover:text-white transition-all py-1.5 font-black uppercase tracking-wider cursor-pointer border-none bg-transparent"
                >
                  Вернуться на сайт
                </button>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
