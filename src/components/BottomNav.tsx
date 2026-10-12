import React from 'react';
import { CalendarCheck, Clapperboard, Home, Package, User } from 'lucide-react';
import { haptic } from '../telegram';

export type NavKey = 'home' | 'events' | 'history' | 'gear' | 'profile';

/**
 * Нижнее меню — пять главных мест под большим пальцем.
 * Раньше подпись была только у активной вкладки, остальные — голые иконки:
 * коробка и хлопушка ничего не говорили, и до «Снаряжения» и «Истории»
 * люди не доходили. Теперь, как в 360 Padel и банковских приложениях,
 * у каждой вкладки иконка и подпись, активная — лаймовой «таблеткой».
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
      <div className="mx-auto grid max-w-md grid-cols-5 px-1 pt-1.5">
        {items.map(({ k, label, Icon }) => {
          const on = active === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => { haptic('success'); onSelect(k); }}
              aria-label={label}
              aria-current={on ? 'page' : undefined}
              className="relative flex min-h-[48px] flex-col items-center justify-center gap-0.5 border-0 bg-transparent cursor-pointer"
            >
              <span className={`flex h-7 w-12 items-center justify-center rounded-full transition-colors ${on ? 'bg-brand text-black' : 'text-white/55'}`}>
                <Icon className="h-[19px] w-[19px] shrink-0" />
              </span>
              <span className={`text-[10.5px] leading-none ${on ? 'font-black text-brand' : 'font-medium text-white/50'}`}>{label}</span>
              {k === 'events' && !!badge && !on && (
                <span className="absolute left-1/2 top-0 ml-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[9px] font-black text-black">{badge}</span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
