import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { X, Trophy, Flame, Star, Target, Zap, Award, Users, Copy, Check, RefreshCw } from 'lucide-react';
import { getInitData, haptic } from '../telegram';

/** Личная реферальная ссылка участника (презентационно; данные — из профиля выше). */
function ReferralSection({ data, onRotate, rotating }: { data: any; onRotate: () => void; rotating: boolean }) {
  const [copied, setCopied] = useState(false);

  if (!data || !data.refLink) {
    return (
      <div className="bg-white/5 border border-white/10 rounded-2xl p-4 text-center text-[11px] text-white/40 font-mono">
        Реферальная ссылка доступна внутри Telegram — открой афишу из бота @campsflint_bot.
      </div>
    );
  }

  const copy = async () => {
    try { await navigator.clipboard.writeText(data.refLink); setCopied(true); haptic('success'); setTimeout(() => setCopied(false), 1500); } catch { /* no-op */ }
  };

  return (
    <div className="bg-brand/5 border border-brand/20 rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-brand text-[10px] uppercase font-mono font-bold tracking-widest flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5" /> Твоя реф-ссылка
        </span>
        <span className="text-[10px] text-white/50 font-mono">Приглашено: <b className="text-brand">{data.referralsCount}</b></span>
      </div>
      <div className="flex gap-2">
        <input readOnly value={data.refLink} className="flex-1 bg-black/30 border border-white/10 rounded-lg p-2 text-white/80 text-[11px] font-mono truncate outline-none" />
        <button onClick={copy} className="shrink-0 bg-brand hover:bg-brand-hover text-black rounded-lg px-3 flex items-center justify-center cursor-pointer border-none" title="Копировать">
          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
        </button>
      </div>
      <button onClick={onRotate} disabled={rotating} className="text-[10px] text-white/50 hover:text-white font-mono flex items-center gap-1.5 cursor-pointer bg-transparent border-none disabled:opacity-50">
        <RefreshCw className={`w-3 h-3 ${rotating ? 'animate-spin' : ''}`} /> Сгенерировать новую ссылку
      </button>
      <p className="text-[9px] text-white/40 font-mono leading-relaxed">Приглашай своих. За друга, прошедшего первое событие, начислим баллы.</p>
    </div>
  );
}

interface UserStatsProps {
  registrations: Array<{eventId: string, registeredAt: string}>;
  events: Array<{id: string, title: string, houseQualities: Array<{key: string}>}>;
  onClose: () => void;
}

export default function UserStats({ registrations, events, onClose }: UserStatsProps) {
  // Профиль с сервера: реальные баллы (только за достижения) + реф-ссылка.
  const [profile, setProfile] = useState<any>(null);
  const [rotating, setRotating] = useState(false);
  const loadProfile = async (action?: string) => {
    const initData = getInitData();
    if (!initData) return;
    try {
      const res = await fetch('/api/club', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'profile', op: action, initData }),
      });
      const j = await res.json();
      if (j.ok) setProfile(j.profile);
    } catch { /* no-op */ }
    setRotating(false);
  };
  useEffect(() => { loadProfile(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  /**
   * Посещённые события — это те, где админ отметил явку (attended), а НЕ число
   * регистраций. Раньше считали registrations.length, и человек, который только
   * записался, видел награду «посетил 3 мероприятия».
   */
  const attendedEvents = registrations.filter((r) => (r as any).attended).length;
  const totalEvents = attendedEvents;
  const signedUp = registrations.length;

  // Баллы — реальные, начисляются ТОЛЬКО за достижения (подтверждённое участие).
  const totalPoints = profile?.points ?? 0;
  const invited = profile?.referralsCount ?? 0;

  // Определяем уровень — только если есть посещения
  const level = totalEvents > 0 ? Math.floor(totalPoints / 500) + 1 : 1;
  const levelTitle = totalEvents === 0 ? 'Не начато' : level <= 2 ? 'Новичок' : level <= 5 ? 'Участник' : level <= 10 ? 'Ветеран' : 'Мастер';

  // Достижения — открываются ТОЛЬКО за реально посещённые события и приглашённых.
  const achievements = [
    { id: 'first', name: 'Первый шаг', desc: 'Побывать на первом', icon: Star, unlocked: totalEvents >= 1 },
    { id: 'three', name: 'Регулярный', desc: 'Побывать на 3', icon: Flame, unlocked: totalEvents >= 3 },
    { id: 'five', name: 'Активный', desc: 'Побывать на 5', icon: Zap, unlocked: totalEvents >= 5 },
    { id: 'ten', name: 'Ветеран', desc: 'Побывать на 10', icon: Trophy, unlocked: totalEvents >= 10 },
    { id: 'inviter', name: 'Проводник', desc: 'Привести друга', icon: Target, unlocked: invited >= 1 },
    { id: 'level5', name: 'Эксперт', desc: 'Достичь 5 уровня', icon: Award, unlocked: level >= 5 }
  ];

  const unlockedAchievements = achievements.filter(a => a.unlocked);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" id="user-stats-root">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/90 backdrop-blur-md"
      />

      {/* Modal */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 30 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 30 }}
        transition={{ type: 'spring', damping: 25, stiffness: 350 }}
        className="bg-[#121212] rounded-3xl w-full max-w-2xl shadow-2xl relative z-10 border border-white/10 flex flex-col max-h-[90vh] text-white"
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-30 p-2.5 rounded-full bg-black/60 border border-white/10 hover:border-brand/40 text-white/70 hover:text-[#E6FD3A] hover:scale-105 transition-all outline-none cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="overflow-y-auto w-full flex-grow scrollbar-none p-6 space-y-6">
          {/* Header */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Trophy className="w-5 h-5 text-brand" />
              <span className="text-[10px] uppercase font-mono font-bold tracking-widest text-brand">
                Статистика
              </span>
            </div>
            <h2 className="font-display font-black text-2xl uppercase tracking-tight text-white">
              Ваш прогресс
            </h2>
          </div>

          {/* Level Card */}
          <div className="bg-gradient-to-br from-brand/20 to-brand/5 border border-brand/30 rounded-2xl p-6 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-white/60 text-[10px] uppercase font-mono tracking-widest mb-1">Уровень {level}</div>
                <div className="font-display font-black text-3xl text-brand">{levelTitle}</div>
              </div>
              <div className="w-16 h-16 bg-brand/20 rounded-full flex items-center justify-center">
                <Zap className="w-8 h-8 text-brand" />
              </div>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-xs font-mono">
                <span className="text-white/60">Очки</span>
                <span className="text-brand font-bold">{totalPoints} / {level * 500}</span>
              </div>
              <div className="w-full bg-white/10 h-2 rounded-full overflow-hidden">
                <motion.div
                  className="bg-brand h-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${(totalPoints % 500) / 500 * 100}%` }}
                  transition={{ duration: 1, ease: 'easeOut' }}
                />
              </div>
            </div>
          </div>

          {/* Реферальная ссылка */}
          <ReferralSection data={profile} onRotate={() => { setRotating(true); loadProfile('rotate'); }} rotating={rotating} />

          {/* Stats Grid — «посетил» и «записан» это разные вещи */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-1">
              <div className="text-white/40 text-[10px] uppercase font-mono tracking-widest">Посетил</div>
              <div className="font-display font-black text-3xl text-white">{totalEvents}</div>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-1">
              <div className="text-white/40 text-[10px] uppercase font-mono tracking-widest">Записан</div>
              <div className="font-display font-black text-3xl text-white/70">{signedUp}</div>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-1">
              <div className="text-white/40 text-[10px] uppercase font-mono tracking-widest">Очки</div>
              <div className="font-display font-black text-3xl text-brand">{totalPoints}</div>
            </div>
          </div>

          {/* Achievements */}
          <div className="space-y-3">
            <h3 className="text-white/40 uppercase text-[9px] tracking-wider font-mono">Достижения ({unlockedAchievements.length}/{achievements.length})</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {achievements.map(achievement => {
                const Icon = achievement.icon;
                return (
                  <div
                    key={achievement.id}
                    className={`p-3 rounded-xl border flex flex-col items-center gap-2 text-center ${
                      achievement.unlocked
                        ? 'bg-brand/10 border-brand/30 text-brand'
                        : 'bg-white/5 border-white/5 text-white/20'
                    }`}
                  >
                    <Icon className={`w-6 h-6 ${achievement.unlocked ? 'text-brand' : 'text-white/20'}`} />
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wider">{achievement.name}</div>
                      <div className="text-[9px] text-white/50 mt-0.5">{achievement.desc}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-white/10 bg-[#161616]">
          <button
            type="button"
            onClick={onClose}
            className="w-full bg-brand hover:bg-brand-hover text-black py-3.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all cursor-pointer border-none"
          >
            Закрыть
          </button>
        </div>
      </motion.div>
    </div>
  );
}