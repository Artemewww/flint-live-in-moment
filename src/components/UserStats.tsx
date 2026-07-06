import React from 'react';
import { motion } from 'motion/react';
import { X, Trophy, Flame, Star, Target, Zap, Award } from 'lucide-react';

interface UserStatsProps {
  registrations: Array<{eventId: string, registeredAt: string}>;
  events: Array<{id: string, title: string, houseQualities: Array<{key: string}>}>;
  onClose: () => void;
}

export default function UserStats({ registrations, events, onClose }: UserStatsProps) {
  // Вычисляем статистику
  const totalEvents = registrations.length;
  const totalPoints = registrations.length * 100; // 100 баллов за каждое мероприятие
  
  // Подсчитываем развитые векторы
  const vectorStats = React.useMemo(() => {
    const stats: Record<string, number> = {};
    registrations.forEach(reg => {
      const event = events.find(e => e.id === reg.eventId);
      if (event) {
        event.houseQualities.forEach(q => {
          stats[q.key] = (stats[q.key] || 0) + 1;
        });
      }
    });
    return stats;
  }, [registrations, events]);

  // Определяем уровень
  const level = Math.floor(totalPoints / 500) + 1;
  const levelTitle = level <= 2 ? 'Новичок' : level <= 5 ? 'Участник' : level <= 10 ? 'Ветеран' : 'Мастер';
  
  // Достижения
  const achievements = [
    { id: 'first', name: 'Первый шаг', desc: 'Первое мероприятие', icon: Star, unlocked: totalEvents >= 1 },
    { id: 'five', name: 'Активный', desc: '5 мероприятий', icon: Flame, unlocked: totalEvents >= 5 },
    { id: 'ten', name: 'Ветеран', desc: '10 мероприятий', icon: Trophy, unlocked: totalEvents >= 10 },
    { id: 'all_vectors', name: 'Разносторонний', desc: 'Все 6 векторов', icon: Target, unlocked: Object.keys(vectorStats).length >= 6 },
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

          {/* Stats Grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-1">
              <div className="text-white/40 text-[10px] uppercase font-mono tracking-widest">Мероприятия</div>
              <div className="font-display font-black text-3xl text-white">{totalEvents}</div>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-1">
              <div className="text-white/40 text-[10px] uppercase font-mono tracking-widest">Очки</div>
              <div className="font-display font-black text-3xl text-brand">{totalPoints}</div>
            </div>
          </div>

          {/* Vector Progress */}
          <div className="space-y-3">
            <h3 className="text-white/40 uppercase text-[9px] tracking-wider font-mono">Развитие векторов</h3>
            <div className="space-y-2">
              {Object.entries(vectorStats).map(([key, count]) => {
                const vectorNames: Record<string, string> = {
                  foundation: 'Предназначение',
                  wall: 'Воля',
                  roof: 'Совесть',
                  decor: 'Творчество',
                  heat: 'Любовь',
                  life: 'Счастье'
                };
                const maxCount = Math.max(...Object.values(vectorStats), 1);
                const percentage = (count / maxCount) * 100;
                
                return (
                  <div key={key} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-white/70 font-mono">{vectorNames[key] || key}</span>
                      <span className="text-brand font-bold">{count}</span>
                    </div>
                    <div className="w-full bg-white/10 h-1.5 rounded-full overflow-hidden">
                      <motion.div
                        className="bg-brand h-full"
                        initial={{ width: 0 }}
                        animate={{ width: `${percentage}%` }}
                        transition={{ duration: 0.8, ease: 'easeOut' }}
                      />
                    </div>
                  </div>
                );
              })}
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