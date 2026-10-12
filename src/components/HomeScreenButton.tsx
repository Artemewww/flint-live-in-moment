import React, { useEffect, useState } from 'react';
import { Smartphone, Check } from 'lucide-react';
import { addToHomeScreen, haptic, homeScreenStatus, HomeScreenStatus } from '../telegram';

/**
 * «ДОБАВИТЬ FLINT НА ЭКРАН ДОМОЙ».
 * Люди забывают про мини-приложение: оно спрятано внутри Telegram. Ярлык
 * рядом с остальными иконками телефона — самый дешёвый способ вернуть их.
 * Показываем только там, где клиент Telegram это умеет (8.0+), и прячем,
 * когда ярлык уже есть.
 *
 * variant="row"    — строка в профиле;
 * variant="banner" — карточка на главной, с «Не сейчас» (запоминаем отказ).
 */
const DISMISS_KEY = 'flint.homescreen.dismissed';

export default function HomeScreenButton({ variant = 'row' }: { variant?: 'row' | 'banner' }) {
  const [status, setStatus] = useState<HomeScreenStatus>('unsupported');
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
  });

  useEffect(() => { homeScreenStatus().then(setStatus); }, []);

  if (status === 'unsupported' || status === 'unknown') return null;
  if (variant === 'banner' && (status === 'added' || dismissed)) return null;

  const add = async () => {
    haptic('success');
    const ok = await addToHomeScreen();
    if (ok) setStatus('added');
  };

  if (variant === 'banner') {
    return (
      <div className="mx-4 mb-4 flex items-center gap-3 rounded-2xl border border-brand/25 bg-brand/[0.07] p-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand text-black">
          <Smartphone className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-bold text-white">FLINT на экран телефона</div>
          <div className="text-[12px] text-white/55">Одна иконка — и афиша в одно касание</div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <button type="button" onClick={add}
            className="rounded-full border-none bg-brand px-3.5 py-2 text-[12px] font-black text-black cursor-pointer">
            Добавить
          </button>
          <button type="button"
            onClick={() => { setDismissed(true); try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* приватный режим */ } }}
            className="border-none bg-transparent p-0 text-[11px] text-white/40 cursor-pointer">
            Не сейчас
          </button>
        </div>
      </div>
    );
  }

  return (
    <button type="button" onClick={status === 'added' ? undefined : add} disabled={status === 'added'}
      className="flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3 text-left cursor-pointer disabled:cursor-default">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/15 text-brand">
        {status === 'added' ? <Check className="h-5 w-5" /> : <Smartphone className="h-5 w-5" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-bold text-white">{status === 'added' ? 'FLINT на экране «Домой»' : 'Добавить на экран «Домой»'}</span>
        <span className="block text-[12px] text-white/50">{status === 'added' ? 'Ярлык уже есть' : 'Иконка FLINT рядом с остальными приложениями'}</span>
      </span>
    </button>
  );
}
