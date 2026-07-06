import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, User, Phone, Send, CheckCircle, Users, MessageSquare } from 'lucide-react';

interface VerificationModalProps {
  eventId: string;
  eventTitle: string;
  requiresOnboarding: boolean;
  onClose: () => void;
  onSubmit: (data: VerificationData) => void;
}

export interface VerificationData {
  eventId: string;
  name: string;
  phone: string;
  telegram: string;
  motivation: string;
  selectedVectors: string[];
  agreedToRules: boolean;
  submittedAt: string;
}

export default function VerificationModal({ 
  eventId, 
  eventTitle, 
  requiresOnboarding,
  onClose, 
  onSubmit 
}: VerificationModalProps) {
  const [step, setStep] = useState<'form' | 'success'>('form');
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    telegram: '',
    motivation: '',
    selectedVectors: [] as string[],
    agreedToRules: false
  });

  const vectors = [
    { key: 'foundation', label: 'Предназначение', emoji: '🎯' },
    { key: 'wall', label: 'Воля', emoji: '💪' },
    { key: 'roof', label: 'Совесть', emoji: '🧠' },
    { key: 'decor', label: 'Творчество', emoji: '🎨' },
    { key: 'heat', label: 'Любовь', emoji: '❤️' },
    { key: 'life', label: 'Счастье', emoji: '✨' }
  ];

  const handleSubmit = () => {
    if (!formData.name || !formData.phone || !formData.telegram || !formData.agreedToRules) {
      return;
    }

    const verificationData: VerificationData = {
      eventId,
      name: formData.name,
      phone: formData.phone,
      telegram: formData.telegram,
      motivation: formData.motivation,
      selectedVectors: formData.selectedVectors,
      agreedToRules: formData.agreedToRules,
      submittedAt: new Date().toISOString()
    };

    onSubmit(verificationData);
    setStep('success');
  };

  const toggleVector = (key: string) => {
    setFormData(prev => ({
      ...prev,
      selectedVectors: prev.selectedVectors.includes(key)
        ? prev.selectedVectors.filter(v => v !== key)
        : [...prev.selectedVectors, key]
    }));
  };

  return (
    <AnimatePresence>
      {eventId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" id="verification-modal-root">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/90 backdrop-blur-md"
          />

          {/* Modal Card */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 30 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 30 }}
            transition={{ type: 'spring', damping: 25, stiffness: 350 }}
            className="bg-[#121212] rounded-3xl w-full max-w-lg shadow-2xl relative z-10 border border-white/10 flex flex-col max-h-[90vh] text-white"
          >
            {/* Close Button */}
            {step === 'form' && (
              <button
                onClick={onClose}
                className="absolute top-4 right-4 z-30 p-2.5 rounded-full bg-black/60 border border-white/10 hover:border-brand/40 text-white/70 hover:text-[#E6FD3A] hover:scale-105 transition-all outline-none cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            )}

            <div className="overflow-y-auto w-full flex-grow scrollbar-none p-6 space-y-6">
              {step === 'form' ? (
                <>
                  {/* Header */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <User className="w-5 h-5 text-brand" />
                      <span className="text-[10px] uppercase font-mono font-bold tracking-widest text-brand">
                        Верификация
                      </span>
                    </div>
                    <h2 className="font-display font-black text-2xl uppercase tracking-tight text-white">
                      Анкета участника
                    </h2>
                    <p className="text-white/60 text-xs font-sans">
                      {eventTitle}
                    </p>
                    {requiresOnboarding && (
                      <div className="bg-brand/10 border border-brand/30 rounded-xl p-3 text-xs text-brand">
                        ⚠️ Это событие требует подтверждения участия
                      </div>
                    )}
                  </div>

                  {/* Form Fields */}
                  <div className="space-y-4">
                    {/* Name */}
                    <div className="space-y-2">
                      <label className="text-white/40 uppercase text-[9px] tracking-wider block font-mono">
                        Имя *
                      </label>
                      <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                        placeholder="Как к вам обращаться?"
                        className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white text-xs font-sans placeholder:text-white/30 focus:outline-none focus:border-brand/40"
                      />
                    </div>

                    {/* Phone */}
                    <div className="space-y-2">
                      <label className="text-white/40 uppercase text-[9px] tracking-wider block font-mono">
                        Телефон *
                      </label>
                      <input
                        type="tel"
                        value={formData.phone}
                        onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                        placeholder="+375 XX XXX XX XX"
                        className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white text-xs font-sans placeholder:text-white/30 focus:outline-none focus:border-brand/40"
                      />
                    </div>

                    {/* Telegram */}
                    <div className="space-y-2">
                      <label className="text-white/40 uppercase text-[9px] tracking-wider block font-mono">
                        Telegram *
                      </label>
                      <input
                        type="text"
                        value={formData.telegram}
                        onChange={(e) => setFormData(prev => ({ ...prev, telegram: e.target.value }))}
                        placeholder="@username"
                        className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white text-xs font-sans placeholder:text-white/30 focus:outline-none focus:border-brand/40"
                      />
                    </div>

                    {/* Motivation */}
                    <div className="space-y-2">
                      <label className="text-white/40 uppercase text-[9px] tracking-wider block font-mono">
                        Почему хотите присоединиться?
                      </label>
                      <textarea
                        value={formData.motivation}
                        onChange={(e) => setFormData(prev => ({ ...prev, motivation: e.target.value }))}
                        placeholder="Расскажите о своих целях и ожиданиях..."
                        className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white text-xs font-sans placeholder:text-white/30 focus:outline-none focus:border-brand/40 resize-none"
                        rows={3}
                      />
                    </div>

                    {/* Vectors Selection */}
                    <div className="space-y-3">
                      <label className="text-white/40 uppercase text-[9px] tracking-wider block font-mono">
                        Какие векторы развития вас интересуют? (можно выбрать несколько)
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        {vectors.map(vector => (
                          <button
                            key={vector.key}
                            type="button"
                            onClick={() => toggleVector(vector.key)}
                            className={`p-3 rounded-xl border transition-all outline-none cursor-pointer text-left ${
                              formData.selectedVectors.includes(vector.key)
                                ? 'bg-brand/20 border-brand/40 text-brand'
                                : 'bg-white/5 border-white/10 text-white/50 hover:bg-white/10'
                            }`}
                          >
                            <div className="text-lg mb-1">{vector.emoji}</div>
                            <div className="text-[10px] font-bold uppercase tracking-wider">{vector.label}</div>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Rules Agreement */}
                    <div className="space-y-2">
                      <label className="flex items-start gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formData.agreedToRules}
                          onChange={(e) => setFormData(prev => ({ ...prev, agreedToRules: e.target.checked }))}
                          className="mt-0.5 w-4 h-4 rounded border-white/20 bg-white/5 text-brand focus:ring-brand focus:ring-offset-0"
                        />
                        <span className="text-white/70 text-xs font-sans leading-relaxed">
                          Я согласен с <button type="button" className="text-brand underline">правилами сообщества</button> и обязуюсь соблюдать 100% чистоту, искренность и уважение к другим участникам
                        </span>
                      </label>
                    </div>
                  </div>
                </>
              ) : (
                /* Success State */
                <div className="space-y-4 text-center py-8">
                  <div className="w-16 h-16 bg-brand/20 rounded-full flex items-center justify-center mx-auto">
                    <CheckCircle className="w-8 h-8 text-brand" />
                  </div>
                  <h3 className="font-display font-black text-xl uppercase text-white">
                    Заявка отправлена!
                  </h3>
                  <p className="text-white/60 text-xs font-sans max-w-sm mx-auto">
                    Ваша заявка на участие в "{eventTitle}" отправлена на рассмотрение. 
                    Вы получите уведомление в Telegram после проверки.
                  </p>
                  <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-xs text-white/50 font-mono">
                    <div className="flex items-center justify-center gap-2 mb-2">
                      <Users className="w-4 h-4" />
                      <span>Следующий шаг: голосование участников</span>
                    </div>
                    <div className="text-[10px]">
                      Обычно занимает 1-2 дня
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            {step === 'form' && (
              <div className="p-6 border-t border-white/10 bg-[#161616]">
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!formData.name || !formData.phone || !formData.telegram || !formData.agreedToRules}
                  className={`w-full py-4 rounded-xl font-black font-mono text-xs uppercase tracking-widest flex items-center justify-center gap-2 transition-all outline-none border-none cursor-pointer ${
                    !formData.name || !formData.phone || !formData.telegram || !formData.agreedToRules
                      ? 'bg-white/5 text-white/30 cursor-not-allowed'
                      : 'bg-brand hover:bg-brand-hover text-black shadow-lg shadow-brand/10 active:scale-98'
                  }`}
                >
                  <Send className="w-4 h-4" />
                  Отправить заявку
                </button>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}