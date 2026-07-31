import React, { useState, useMemo } from 'react';
import { motion } from 'motion/react';
import { Calendar, Gift, Users, X, Plus, Lock, Bot } from 'lucide-react';
import { isAuthorized, openBot } from '../telegram';

interface Birthday {
  id: string;
  name: string;
  date: string; // MM-DD format
  year?: number;
  telegram?: string;
}

interface BirthdayCalendarProps {
  birthdays: Birthday[];
  onClose: () => void;
  onAddBirthday: (birthday: {id: string, name: string, date: string, year?: number, telegram?: string}) => void;
}

interface AddBirthdayFormProps {
  onAdd: (birthday: {id: string, name: string, date: string, year?: number, telegram?: string}) => void;
}

function AddBirthdayForm({ onAdd }: AddBirthdayFormProps) {
  const [name, setName] = useState('');
  const [day, setDay] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [telegram, setTelegram] = useState('');

  const handleSubmit = () => {
    if (!name || !day || !month) return;
    
    const dateStr = `${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    onAdd({
      id: Date.now().toString(),
      name,
      date: dateStr,
      year: year ? parseInt(year) : undefined,
      telegram: telegram || undefined
    });
    
    setName('');
    setDay('');
    setMonth('');
    setYear('');
    setTelegram('');
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Имя"
          className="bg-white/5 border border-white/10 rounded-xl p-2.5 text-white text-xs placeholder:text-white/30 focus:outline-none focus:border-brand/40"
        />
        <input
          type="text"
          value={telegram}
          onChange={(e) => setTelegram(e.target.value)}
          placeholder="@username (необязательно)"
          className="bg-white/5 border border-white/10 rounded-xl p-2.5 text-white text-xs placeholder:text-white/30 focus:outline-none focus:border-brand/40"
        />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <input
          type="number"
          value={day}
          onChange={(e) => setDay(e.target.value)}
          placeholder="День"
          min="1"
          max="31"
          className="bg-white/5 border border-white/10 rounded-xl p-2.5 text-white text-xs placeholder:text-white/30 focus:outline-none focus:border-brand/40"
        />
        <input
          type="number"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          placeholder="Месяц"
          min="1"
          max="12"
          className="bg-white/5 border border-white/10 rounded-xl p-2.5 text-white text-xs placeholder:text-white/30 focus:outline-none focus:border-brand/40"
        />
        <input
          type="number"
          value={year}
          onChange={(e) => setYear(e.target.value)}
          placeholder="Год (необязательно)"
          className="bg-white/5 border border-white/10 rounded-xl p-2.5 text-white text-xs placeholder:text-white/30 focus:outline-none focus:border-brand/40"
        />
      </div>
      <button
        type="button"
        onClick={handleSubmit}
        disabled={!name || !day || !month}
        className={`w-full py-3 rounded-xl text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all outline-none border-none cursor-pointer ${
          !name || !day || !month
            ? 'bg-white/5 text-white/30 cursor-not-allowed'
            : 'bg-brand hover:bg-brand-hover text-black shadow-lg shadow-brand/10'
        }`}
      >
        <Plus className="w-4 h-4" />
        Добавить
      </button>
    </div>
  );
}

export default function BirthdayCalendar({ birthdays, onClose, onAddBirthday }: BirthdayCalendarProps) {
  const authorized = isAuthorized();
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return now.getMonth(); // 0-based
  });

  const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 
                      'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

  const birthdaysThisMonth = useMemo(() => {
    return birthdays
      .filter(b => {
        const month = parseInt(b.date.split('-')[0]) - 1;
        return month === selectedMonth;
      })
      .sort((a, b) => {
        const dayA = parseInt(a.date.split('-')[1]);
        const dayB = parseInt(b.date.split('-')[1]);
        return dayA - dayB;
      });
  }, [birthdays, selectedMonth]);

  const getDaysInMonth = (month: number) => {
    return new Date(2024, month + 1, 0).getDate();
  };

  const getBirthdayForDay = (day: number) => {
    return birthdaysThisMonth.find(b => {
      const birthdayDay = parseInt(b.date.split('-')[1]);
      return birthdayDay === day;
    });
  };

  const isToday = (day: number) => {
    const now = new Date();
    return now.getMonth() === selectedMonth && now.getDate() === day;
  };

  const daysInMonth = getDaysInMonth(selectedMonth);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center md:p-4" id="birthday-calendar-root">
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
        className="bg-[#121212] md:rounded-3xl w-full max-w-2xl shadow-2xl relative z-10 md:border md:border-white/10 flex flex-col h-[100dvh] md:h-auto md:max-h-[90vh] text-white"
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-30 p-2.5 rounded-full bg-black/60 border border-white/10 hover:border-brand/40 text-white/70 hover:text-[#E6FD3A] hover:scale-105 transition-all outline-none cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="overflow-y-auto w-full flex-grow scrollbar-none p-4 sm:p-6 space-y-6">
          {/* Header */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Gift className="w-5 h-5 text-brand" />
              <span className="text-[10px] uppercase font-mono font-bold tracking-widest text-brand">
                Календарь
              </span>
            </div>
            <h2 className="font-display font-black text-2xl uppercase tracking-tight text-white">
              Дни Рождения
            </h2>
            <p className="text-white/60 text-xs font-sans">
              Поздравляем наших участников!
            </p>
          </div>

          {!authorized && (
            <div className="bg-brand/5 border border-brand/20 rounded-2xl p-6 text-center space-y-3">
              <Lock className="w-10 h-10 text-brand mx-auto" />
              <div className="space-y-1">
                <p className="text-sm font-bold text-white uppercase tracking-wider">Доступно только резидентам</p>
                <p className="text-xs text-white/60 leading-relaxed">
                  Календарь дней рождения участников сообщества — приватная информация. 
                  Откройте сайт через бота <strong className="text-brand">@campsflint_bot</strong>, чтобы увидеть дни рождения.
                </p>
              </div>
              <button
                type="button"
                onClick={() => openBot('https://t.me/campsflint_bot')}
                className="inline-flex items-center gap-2 bg-brand hover:bg-brand-hover text-black px-6 py-3 rounded-xl text-xs font-bold uppercase tracking-widest transition-all border-none cursor-pointer"
              >
                <Bot className="w-4 h-4" />
                Открыть в боте
              </button>
            </div>
          )}

          {authorized && (
          <>
          {/* Month Selector */}
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none">
            {monthNames.map((month, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setSelectedMonth(idx)}
                className={`px-4 py-2 rounded-full text-xs font-mono uppercase tracking-wider font-bold transition-all whitespace-nowrap cursor-pointer border-none ${
                  selectedMonth === idx
                    ? 'bg-brand text-black font-black'
                    : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white'
                }`}
              >
                {month}
              </button>
            ))}
          </div>

          {/* Calendar Grid */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
            {/* Weekday Headers */}
            <div className="grid grid-cols-7 gap-2 mb-2">
              {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(day => (
                <div key={day} className="text-center text-[10px] font-mono text-white/40 uppercase tracking-wider">
                  {day}
                </div>
              ))}
            </div>

            {/* Days Grid */}
            <div className="grid grid-cols-7 gap-2">
              {/* Empty cells for days before the 1st */}
              {Array.from({ length: (new Date(2024, selectedMonth, 1).getDay() + 6) % 7 }).map((_, idx) => (
                <div key={`empty-${idx}`} className="aspect-square" />
              ))}

              {/* Days of the month */}
              {Array.from({ length: daysInMonth }, (_, idx) => {
                const day = idx + 1;
                const birthday = getBirthdayForDay(day);
                const today = isToday(day);

                return (
                  <div
                    key={day}
                    className={`aspect-square rounded-xl border flex flex-col items-center justify-center relative transition-all ${
                      birthday
                        ? 'bg-brand/10 border-brand/30 text-brand'
                        : today
                          ? 'bg-white/10 border-white/20 text-white'
                          : 'border-transparent text-white/30'
                    }`}
                  >
                    <span className={`text-xs font-mono font-bold ${
                      birthday ? 'text-brand' : today ? 'text-white' : 'text-white/30'
                    }`}>
                      {day}
                    </span>
                    {birthday && (
                      <span className="text-[8px] mt-0.5">🎂</span>
                    )}
                    {today && !birthday && (
                      <span className="text-[8px]">●</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Birthdays List */}
          {birthdaysThisMonth.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-white/40 uppercase text-[9px] tracking-wider font-mono">
                Именинники {monthNames[selectedMonth]}
              </h3>
              <div className="space-y-2">
                {birthdaysThisMonth.map(birthday => {
                  const day = parseInt(birthday.date.split('-')[1]);
                  const today = isToday(day);

                  return (
                    <div
                      key={birthday.id}
                      className={`p-4 rounded-xl border flex items-center gap-3 ${
                        today
                          ? 'bg-brand/10 border-brand/30'
                          : 'bg-white/5 border-white/5'
                      }`}
                    >
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-xl ${
                        today ? 'bg-brand/20' : 'bg-white/10'
                      }`}>
                        🎂
                      </div>
                      <div className="flex-1">
                        <div className="text-sm font-bold text-white">
                          {birthday.name}
                        </div>
                        <div className="text-[10px] text-white/50 font-mono">
                          {day} {monthNames[selectedMonth]}
                          {birthday.year && ` (${new Date().getFullYear() - birthday.year} лет)`}
                        </div>
                      </div>
                      {today && (
                        <span className="text-[9px] uppercase font-mono font-bold text-brand bg-brand/10 px-2 py-1 rounded-full">
                          Сегодня!
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Add Birthday Form */}
          <div className="space-y-3 pt-4 border-t border-white/10">
            <h3 className="text-white/40 uppercase text-[9px] tracking-wider font-mono">
              Добавить свой день рождения
            </h3>
            <AddBirthdayForm onAdd={(newBirthday) => {
              onAddBirthday(newBirthday);
            }} />
          </div>

          {birthdaysThisMonth.length === 0 && (
            <div className="text-center py-8 text-white/40 text-xs">
              <Gift className="w-12 h-12 mx-auto mb-2 opacity-30" />
              <p>В этом месяце нет дней рождения</p>
            </div>
          )}
          </>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 sm:p-6 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-6 border-t border-white/10 bg-[#161616]">
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