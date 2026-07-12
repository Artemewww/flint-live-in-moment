import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Send, Heart, Sparkles, Shield, BookOpen } from 'lucide-react';
import { UserProfile, HouseQuality } from '../types';
import { HOUSE_QUALITIES } from '../houseQualities';
import { detectDevelopmentGoal } from '../development';

/**
 * Эмпатичный онбординг — «Мягкая миграция» профиля развития.
 * 
 * Принципы:
 * - Не спрашиваем то, что уже знаем
 * - Объясняем ЗАЧЕМ каждый вопрос
 * - Полная прозрачность и конфиденциальность
 * - Дружелюбный, поддерживающий тон
 */

interface OnboardingModalProps {
  profile: UserProfile;
  onComplete: (updated: Partial<UserProfile>) => void;
  onDismiss: () => void;
}

type Step = 'welcome' | 'dreams' | 'interests' | 'skills' | 'goal' | 'complete';

const STEP_CONFIG: Record<Step, {
  title: string;
  emoji: string;
  message: string;
  field: keyof UserProfile;
  placeholder: string;
  skipLabel?: string;
}> = {
  welcome: {
    title: 'Добро пожаловать в обновлённое сообщество!',
    emoji: '🌟',
    message: '',
    field: 'developmentRequest',
    placeholder: '',
  },
  dreams: {
    title: 'Копилка Мечт',
    emoji: '💭',
    message: 'У каждого из нас есть заветные стремления. Поделись, что именно наполняет тебя энергией или о чём ты давно мечтаешь? Это поможет нам создавать события, которые вдохновляют именно тебя.',
    field: 'dreams',
    placeholder: 'Например: научиться стоять на сапборде, побывать в походе с палатками, найти единомышленников для глубоких разговоров…',
    skipLabel: 'Пропустить',
  },
  interests: {
    title: 'Твои увлечения',
    emoji: '🎯',
    message: 'Расскажи, чем тебе нравится заниматься в свободное время? Это нужно, чтобы мы могли подобрать мероприятия, которые будут тебе по душе.',
    field: 'interests',
    placeholder: 'Например: кайтсерфинг, фотография, настольные игры, йога, волонтёрство…',
    skipLabel: 'Пропустить',
  },
  skills: {
    title: 'Твои таланты',
    emoji: '🛠️',
    message: 'Какими навыками или знаниями ты готов делиться с сообществом? Возможно, ты умеешь играть на гитаре, разбираешься в технике или классно готовишь на костре? Это поможет нам распределять роли на событиях.',
    field: 'skills',
    placeholder: 'Например: игра на гитаре, организация, фотография, первая помощь, приготовление еды на костре…',
    skipLabel: 'Пропустить',
  },
  goal: {
    title: 'Твой вектор развития',
    emoji: '🧭',
    message: 'Мы заметили, что ты упомянул(а) важные для себя темы. Какое из 6 качеств «Дома Личности» тебе сейчас хочется развивать больше всего? Это поможет нам рекомендовать события, которые будут максимально полезны для твоего роста.',
    field: 'developmentGoal',
    placeholder: '',
    skipLabel: 'Пока не знаю',
  },
  complete: {
    title: 'Профиль развития готов!',
    emoji: '✨',
    message: '',
    field: 'isProfileCompleted',
    placeholder: '',
  },
};

export default function OnboardingModal({ profile, onComplete, onDismiss }: OnboardingModalProps) {
  const [step, setStep] = useState<Step>('welcome');
  const [input, setInput] = useState('');
  const [collected, setCollected] = useState<Partial<UserProfile>>({});
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showDismissHint, setShowDismissHint] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Автофокус на поле ввода
  useEffect(() => {
    if (step !== 'welcome' && step !== 'complete' && inputRef.current) {
      inputRef.current.focus();
    }
  }, [step]);

  // Показываем подсказку о возможности закрыть через 5 сек
  useEffect(() => {
    if (step === 'welcome') {
      const t = setTimeout(() => setShowDismissHint(true), 5000);
      return () => clearTimeout(t);
    }
  }, [step]);

  const handleNext = async () => {
    if (step === 'welcome') {
      setStep('dreams');
      return;
    }

    if (step === 'dreams') {
      setCollected((prev) => ({ ...prev, dreams: input.trim() }));
      setInput('');
      setStep('interests');
      return;
    }

    if (step === 'interests') {
      const interests = input.trim() ? input.split(',').map(s => s.trim()).filter(Boolean) : [];
      setCollected((prev) => ({ ...prev, interests }));
      setInput('');
      setStep('skills');
      return;
    }

    if (step === 'skills') {
      const skills = input.trim() ? input.split(',').map(s => s.trim()).filter(Boolean) : [];
      setCollected((prev) => ({ ...prev, skills }));
      setInput('');
      setStep('goal');
      return;
    }

    if (step === 'goal') {
      setIsAnalyzing(true);
      try {
        // Определяем цель развития по тексту
        const textToAnalyze = input.trim() || collected.dreams || '';
        let goal: HouseQuality['key'] | undefined;

        if (input.trim()) {
          const detected = detectDevelopmentGoal(input);
          if (detected) goal = detected.key;
        }

        if (!goal && textToAnalyze) {
          // Пробуем через ИИ
          const res = await fetch('/api/ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ task: 'detect_goal', text: textToAnalyze }),
          });
          const j = await res.json();
          if (j.goal) goal = j.goal;
        }

        setCollected((prev) => ({ ...prev, developmentGoal: goal }));
      } catch {
        // Если ИИ не ответил — не страшно
      }
      setIsAnalyzing(false);
      setStep('complete');
      return;
    }

    if (step === 'complete') {
      onComplete({ ...collected, isProfileCompleted: true });
      return;
    }
  };

  const handleSkip = () => {
    if (step === 'dreams') { setInput(''); setStep('interests'); }
    else if (step === 'interests') { setInput(''); setStep('skills'); }
    else if (step === 'skills') { setInput(''); setStep('goal'); }
    else if (step === 'goal') { setInput(''); setStep('complete'); }
  };

  const config = STEP_CONFIG[step];

  return (
    <div className="fixed inset-0 z-[80] flex items-end md:items-center justify-center md:p-4">
      <div className="absolute inset-0 bg-black/95 backdrop-blur-sm" onClick={step === 'welcome' ? undefined : onDismiss} />

      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 40 }}
        className="bg-[#121212] md:rounded-3xl rounded-t-3xl w-full max-w-lg relative z-10 border border-white/10 flex flex-col max-h-[90dvh]"
      >
        {/* Header */}
        <div className="p-4 md:p-6 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-brand" />
            <span className="text-[10px] text-white/40 uppercase font-mono">
              {step === 'welcome' ? 'Обновление платформы' :
               step === 'complete' ? 'Готово' :
               `Шаг ${['dreams', 'interests', 'skills', 'goal'].indexOf(step) + 1} из 4`}
            </span>
          </div>
          {step !== 'welcome' && step !== 'complete' && (
            <button
              onClick={onDismiss}
              className="p-1.5 rounded-full bg-white/5 hover:bg-white/10 cursor-pointer border-none text-white/50 hover:text-white transition-colors"
              title="Закрыть (можно продолжить позже)"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="p-4 md:p-6 space-y-4 overflow-y-auto">
          {step === 'welcome' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-14 h-14 rounded-2xl bg-brand/15 border border-brand/30 flex items-center justify-center text-3xl">
                  🌟
                </div>
                <div>
                  <h3 className="font-bold text-lg uppercase">Привет!</h3>
                  <p className="text-[10px] text-white/40 font-mono">{profile.name || 'Участник'}</p>
                </div>
              </div>

              <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
                <p className="text-sm text-white/90 leading-relaxed">
                  Мы обновили нашу платформу, чтобы делать мероприятия ещё лучше для тебя.
                </p>
                <p className="text-sm text-white/90 leading-relaxed">
                  Мы хотим лучше узнать твои <b>мечты, интересы и навыки</b>, чтобы планировать выезды, которые вдохновляют именно тебя.
                </p>
                <p className="text-sm text-white/90 leading-relaxed">
                  Удели, пожалуйста, пару минут — мы просто пообщаемся в свободном формате, а система сама заполнит твой профиль развития.
                </p>
              </div>

              {/* Блок конфиденциальности */}
              <div className="bg-brand/5 border border-brand/20 rounded-xl p-3 flex items-start gap-3">
                <Shield className="w-5 h-5 text-brand shrink-0 mt-0.5" />
                <div>
                  <p className="text-[11px] text-white/80 font-bold">Твои данные — это твой личный компас развития</p>
                  <p className="text-[10px] text-white/50 mt-1">
                    Доступ к ним имеешь только ты и организатор для планирования. 
                    Мы храним их с максимальным уважением к приватности.
                  </p>
                </div>
              </div>

              {showDismissHint && (
                <p className="text-[10px] text-white/30 text-center">
                  Можешь закрыть и вернуться позже — твой прогресс сохранится
                </p>
              )}
            </div>
          )}

          {step === 'complete' && (
            <div className="space-y-4 text-center py-4">
              <div className="text-5xl mb-4">✨</div>
              <h3 className="font-bold text-xl uppercase">Профиль развития готов!</h3>
              <p className="text-sm text-white/70 leading-relaxed">
                Спасибо, что доверил(а) нам свои стремления. Мы бережно сохраним это, 
                чтобы однажды воплотить в жизнь.
              </p>
              <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-2 text-left">
                {collected.dreams && (
                  <div className="flex items-start gap-2">
                    <span className="text-brand shrink-0">💭</span>
                    <div>
                      <p className="text-[10px] text-white/40 uppercase font-mono">Мечты</p>
                      <p className="text-xs text-white/80">{collected.dreams}</p>
                    </div>
                  </div>
                )}
                {collected.interests && collected.interests.length > 0 && (
                  <div className="flex items-start gap-2">
                    <span className="text-brand shrink-0">🎯</span>
                    <div>
                      <p className="text-[10px] text-white/40 uppercase font-mono">Интересы</p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {collected.interests.map((i, idx) => (
                          <span key={idx} className="text-[10px] bg-white/10 px-2 py-0.5 rounded">{i}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
                {collected.skills && collected.skills.length > 0 && (
                  <div className="flex items-start gap-2">
                    <span className="text-brand shrink-0">🛠️</span>
                    <div>
                      <p className="text-[10px] text-white/40 uppercase font-mono">Навыки</p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {collected.skills.map((s, idx) => (
                          <span key={idx} className="text-[10px] bg-white/10 px-2 py-0.5 rounded">{s}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
                {collected.developmentGoal && (
                  <div className="flex items-start gap-2">
                    <span className="text-brand shrink-0">🧭</span>
                    <div>
                      <p className="text-[10px] text-white/40 uppercase font-mono">Цель развития</p>
                      <p className="text-xs text-white/80">
                        {HOUSE_QUALITIES.find(q => q.key === collected.developmentGoal)?.emoji}{' '}
                        {HOUSE_QUALITIES.find(q => q.key === collected.developmentGoal)?.name}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {step !== 'welcome' && step !== 'complete' && (
            <div className="space-y-4">
              {/* Сообщение ИИ */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-brand/15 border border-brand/30 flex items-center justify-center text-sm shrink-0">
                    🤖
                  </div>
                  <div>
                    <p className="text-[10px] text-brand font-mono mb-1">Наставник FLINT</p>
                    <p className="text-sm text-white/90 leading-relaxed">{config.message}</p>
                  </div>
                </div>
              </div>

              {/* Поле ввода */}
              <div className="relative">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={config.placeholder}
                  rows={3}
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white text-sm placeholder:text-white/30 focus:border-brand/40 outline-none resize-none"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if (input.trim()) handleNext();
                    }
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 md:p-6 border-t border-white/10">
          {step === 'welcome' && (
            <div className="flex gap-2">
              <button
                onClick={handleNext}
                className="flex-1 bg-brand hover:bg-brand-hover text-black py-3 rounded-xl text-xs font-bold uppercase cursor-pointer border-none transition-colors"
              >
                Начнём! 🚀
              </button>
              <button
                onClick={onDismiss}
                className="flex-1 border border-white/10 py-3 rounded-xl text-xs font-bold uppercase text-white/60 cursor-pointer bg-transparent hover:bg-white/5 transition-colors"
              >
                Позже
              </button>
            </div>
          )}

          {step === 'complete' && (
            <button
              onClick={handleNext}
              className="w-full bg-brand hover:bg-brand-hover text-black py-3 rounded-xl text-xs font-bold uppercase cursor-pointer border-none transition-colors"
            >
              ✅ Всё готово!
            </button>
          )}

          {step !== 'welcome' && step !== 'complete' && (
            <div className="flex gap-2">
              <button
                onClick={handleNext}
                disabled={!input.trim() || isAnalyzing}
                className="flex-1 bg-brand hover:bg-brand-hover text-black py-3 rounded-xl text-xs font-bold uppercase cursor-pointer border-none transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isAnalyzing ? (
                  <>
                    <span className="w-3 h-3 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                    Анализирую…
                  </>
                ) : (
                  <>
                    Далее <Send className="w-3 h-3" />
                  </>
                )}
              </button>
              <button
                onClick={handleSkip}
                className="border border-white/10 py-3 rounded-xl text-[10px] font-bold uppercase text-white/40 cursor-pointer bg-transparent hover:bg-white/5 transition-colors px-4"
              >
                {config.skipLabel || 'Пропустить'}
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}