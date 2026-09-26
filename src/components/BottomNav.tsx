import React from 'react';
import { CalendarCheck, Clapperboard, Home, Package, User } from 'lucide-react';
import { haptic } from '../telegram';

export type NavKey = 'home' | 'events' | 'history' | 'gear' | 'profile';

/**
 * Нижнее меню — как в банковских приложениях: пять главных мест под
 * большим пальцем. Активная вкладка — «таблеткой» с подписью, остальные —
 * иконками, чтобы меню не превращалось в строку мелкого текста.
 * Лежит ПОД модальными окнами (z-40): карточка события и профиль его
 * перекрывают, и нижние кнопки «Записаться» ничем не заслонены.
 */
export default function BottomNav({ active, onSelect, badge }: { active: NavKey; onSelect: (k: NavKey) => void; badge?: number }) {
  const items: { k: NavKey; label: string; Icon: any }[] = [
    { k: 'home', label: 'Афиша', Icon: Home },
    { k: 'events', label: 'Мои', Icon: CalendarCheck },
    { k: 'history', label: 'История', Icon: Clapperboard },
    { k: 'gear', label: 'Снаряжение', Icon: Package },
    { k: 'profile', label: 'Профиль', Icon: User },
  ];
  return (
    <nav
      className="md:hidden fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#0A0A0A]/95 backdrop-blur-md"
      style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
      aria-label="Главное меню"
    >
      <div className="mx-auto flex max-w-md items-center justify-between px-3 pt-2">
        {items.map(({ k, label, Icon }) => {
          const on = active === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => { haptic('success'); onSelect(k); }}
              aria-label={label}
              aria-current={on ? 'page' : undefined}
              className={`relative flex h-11 items-center justify-center gap-1.5 rounded-full border-0 transition-all ${
                on ? 'bg-brand px-4 text-black' : 'w-11 bg-transparent text-white/55'
              }`}
            >
              <Icon className="h-5 w-5 shrink-0" />
              {on && <span className="text-[12px] font-black">{label}</span>}
              {k === 'events' && !!badge && !on && (
                <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[9px] font-black text-black">{badge}</span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
