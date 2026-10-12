import React, { useEffect, useState } from 'react';
import { Trophy, X } from 'lucide-react';
import { getInitData, haptic } from '../telegram';
import Avatar from './Avatar';

export interface RatingRow {
  place: number;
  id: string;
  name: string;
  points: number;
  level: number;
  trips: number;
  avatar?: string;
  me?: boolean;
}

interface RatingData { top: RatingRow[]; me: RatingRow | null; total: number }

/** Один запрос на открытие профиля: и плашке «#N», и списку. */
export function useClubRating(enabled: boolean) {
  const [data, setData] = useState<RatingData | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetch('/api/profile', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'leaderboard', initData: getInitData() }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive && j?.ok) setData({ top: j.top || [], me: j.me || null, total: Number(j.total) || 0 }); })
      .catch(() => { /* офлайн — плашка просто не появится */ });
    return () => { alive = false; };
  }, [enabled]);
  return data;
}

const MEDAL = ['🥇', '🥈', '🥉'];

function Row({ r, sticky }: { r: RatingRow; sticky?: boolean }) {
  return (
    <div className={`flex items-center gap-3 px-3 py-2.5 ${
      sticky ? 'rounded-2xl bg-brand text-black shadow-lg shadow-brand/20'
        : r.me ? 'rounded-2xl bg-brand/10 border border-brand/30' : ''
    }`}>
      <span className={`w-7 shrink-0 text-center text-sm font-black ${sticky ? 'text-black' : 'text-white/50'}`}>
        {r.place <= 3 && !sticky ? MEDAL[r.place - 1] : r.place}
      </span>
      <Avatar name={r.name} src={r.avatar} size={36} />
      <div className="min-w-0 flex-1">
        {sticky && <div className="text-[10px] font-mono uppercase tracking-widest text-black/60">Твоя позиция</div>}
        <div className={`truncate text-[14px] font-bold ${sticky ? 'text-black' : 'text-white'}`}>{r.name}</div>
        <div className={`text-[11px] ${sticky ? 'text-black/60' : 'text-white/45'}`}>
          Ур. {r.level}{r.trips ? ` · ${r.trips} ${r.trips % 10 === 1 && r.trips % 100 !== 11 ? 'выезд' : r.trips % 10 >= 2 && r.trips % 10 <= 4 && (r.trips % 100 < 10 || r.trips % 100 >= 20) ? 'выезда' : 'выездов'}` : ''}
        </div>
      </div>
      <span className={`shrink-0 text-lg font-black tabular-nums ${sticky ? 'text-black' : 'text-brand'}`}>{r.points}</span>
    </div>
  );
}

/**
 * РЕЙТИНГ КЛУБА. Лидеры по очкам + закреплённая снизу «Твоя позиция»
 * (если ты не в топе — видно, сколько до него). Подсмотрено у 360 Padel.
 */
export default function ClubRating({ data, onClose }: { data: RatingData | null; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const me = data?.me || null;
  const meInTop = !!me && (data?.top || []).some((r) => r.me);
  const gapToTop = me && data?.top?.length ? Math.max(0, data.top[data.top.length - 1].points - me.points + 1) : 0;

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-[#0b0b0b]" role="dialog" aria-label="Рейтинг клуба">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <Trophy className="h-5 w-5 text-brand" />
          <div>
            <h2 className="font-display text-lg font-black uppercase leading-none text-white">Рейтинг клуба</h2>
            <p className="mt-1 text-[11px] text-white/45">Очки за выезды, задачи и помощь кругу{data ? ` · ${data.total} участников` : ''}</p>
          </div>
        </div>
        <button
          type="button" onClick={() => { haptic('success'); onClose(); }}
          className="flex h-11 w-11 items-center justify-center rounded-full border-none bg-white/5 text-white/70 cursor-pointer"
          aria-label="Закрыть"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 pb-32">
        {!data ? (
          <p className="py-16 text-center text-sm text-white/40">Загружаем рейтинг…</p>
        ) : data.top.length === 0 ? (
          <p className="py-16 text-center text-sm text-white/40">Пока пусто — первые очки дают выезды</p>
        ) : (
          <div className="space-y-1">
            {data.top.map((r) => <Row key={r.id} r={r} />)}
          </div>
        )}
      </div>

      {me && (
        <div className="absolute inset-x-3 bottom-4 space-y-2" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          <Row r={me} sticky />
          {!meInTop && gapToTop > 0 && (
            <p className="text-center text-[11px] text-white/55">До топ-{data?.top.length}: <b className="text-brand">{gapToTop}</b> очков — это примерно один выезд</p>
          )}
        </div>
      )}
    </div>
  );
}
