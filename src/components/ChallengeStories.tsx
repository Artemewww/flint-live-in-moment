import React, { useEffect, useMemo, useState } from 'react';
import { X, ChevronLeft, ChevronRight, Trophy } from 'lucide-react';
import { CommunityEvent, getToday } from '../types';
import Avatar from './Avatar';
import { haptic } from '../telegram';

/**
 * ЛЕНТА СТОРИС ЧЕЛЛЕНДЖА — «кто как отчитался сегодня».
 *
 * Стиль Instagram Stories: горизонтальная лента кружков сверху, тап →
 * полноэкранный просмотр с прогресс-баром и перелистыванием.
 *
 * Источник кружков: `file_id` из `app_config.challenge_checkin:*`, прокси
 * `/api/events?action=media&fid=` отдаёт файл из Telegram. В Supabase
 * сами видео НЕ храним — 92 × N участников забьют память.
 *
 * Текстовые отчёты (без видео) показываются карточкой с текстом.
 */

type CheckinStory = {
  telegram_id: number;
  name: string;
  avatar?: string;
  date: string;
  time?: string;
  file_id?: string;
  type?: 'video_note' | 'video';
  text?: string;  // текстовый отчёт
};

type Props = {
  event: CommunityEvent;
  /** Фильтр: показать сторис только одного участника за конкретный день */
  focus?: { telegramId: number; date: string } | null;
  onCloseFocus?: () => void;
};

export default function ChallengeStories({ event, focus, onCloseFocus }: Props) {
  const today = getToday();
  const [stories, setStories] = useState<CheckinStory[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewIndex, setViewIndex] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/events?action=stories&id=${encodeURIComponent(event.id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive) return;
        if (Array.isArray(j?.stories)) setStories(j.stories);
        setLoading(false);
      })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [event.id]);

  // Группировка: по участникам, внутри — по дням (новые сверху).
  const byUser = useMemo(() => {
    const map = new Map<number, { user: { id: number; name: string; avatar?: string }; items: CheckinStory[] }>();
    for (const s of stories) {
      if (!map.has(s.telegram_id)) {
        map.set(s.telegram_id, { user: { id: s.telegram_id, name: s.name, avatar: s.avatar }, items: [] });
      }
      map.get(s.telegram_id)!.items.push(s);
    }
    // Сортируем дни по убыванию (новый сторис — первым).
    for (const v of map.values()) v.items.sort((a, b) => (a.date < b.date ? 1 : -1));
    return Array.from(map.values());
  }, [stories]);

  // Фокус из ChallengeProgress: показываем только этот день этого участника.
  useEffect(() => {
    if (!focus) return;
    const idx = stories.findIndex((s) => s.telegram_id === focus.telegramId && s.date === focus.date);
    if (idx >= 0) setViewIndex(idx);
  }, [focus, stories]);

  const closeViewer = () => {
    setViewIndex(null);
    onCloseFocus?.();
  };

  const go = (dir: -1 | 1) => {
    if (viewIndex === null) return;
    const next = viewIndex + dir;
    if (next < 0 || next >= stories.length) { closeViewer(); return; }
    setViewIndex(next);
  };

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[.03] p-4">
        <span className="font-mono text-[10px] uppercase tracking-widest text-white/40">Сторис участников</span>
        <div className="mt-2 h-16 animate-pulse rounded-xl bg-white/[.06]" />
      </div>
    );
  }

  if (!byUser.length) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[.03] p-4">
        <span className="font-mono text-[10px] uppercase tracking-widest text-white/40">Сторис участников</span>
        <p className="mt-1 text-[11px] text-white/50">Кружки появятся здесь, как только кто-то отправит первый отчёт.</p>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-2xl border border-white/10 bg-white/[.03] p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-white/40">Сторис участников</span>
          <span className="font-mono text-[10px] text-white/50">{stories.length} отчётов</span>
        </div>

        {/* Горизонтальная лента аватаров — как в Instagram */}
        <div className="flex gap-3 overflow-x-auto scrollbar-none pb-1">
          {byUser.map((u) => {
            const latest = u.items[0];
            const seenToday = u.items.some((i) => i.date === today);
            return (
              <button
                key={u.user.id}
                type="button"
                onClick={() => {
                  haptic('success');
                  const idx = stories.findIndex((s) => s.telegram_id === u.user.id && s.date === latest.date);
                  if (idx >= 0) setViewIndex(idx);
                }}
                className="shrink-0 flex flex-col items-center gap-1 w-16"
              >
                <span className={`
                  p-0.5 rounded-full
                  ${seenToday ? 'bg-gradient-to-tr from-amber-400 via-orange-500 to-rose-400' : 'bg-white/20'}
                `}>
                  <span className="block rounded-full bg-[#121212] p-0.5">
                    <Avatar name={u.user.name} src={u.user.avatar} size={48} />
                  </span>
                </span>
                <span className="w-full truncate text-center text-[10px] font-bold text-white/85">
                  {u.user.name}
                </span>
                <span className="font-mono text-[8px] text-white/40">
                  {u.items.length} дн.
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Полноэкранный просмотр сторис */}
      {viewIndex !== null && stories[viewIndex] && (
        <StoryViewer
          story={stories[viewIndex]}
          index={viewIndex}
          total={stories.length}
          onClose={closeViewer}
          onNav={go}
        />
      )}
    </>
  );
}

function StoryViewer({ story, index, total, onClose, onNav }: {
  story: CheckinStory;
  index: number;
  total: number;
  onClose: () => void;
  onNav: (dir: -1 | 1) => void;
}) {
  const src = story.file_id
    ? `/api/events?action=media&fid=${encodeURIComponent(story.file_id)}`
    : null;

  return (
    <div className="fixed inset-0 z-[70] bg-black/95 flex flex-col">
      {/* Прогресс-бар сверху */}
      <div className="flex gap-1 p-3">
        {Array.from({ length: Math.min(total, 20) }).map((_, i) => (
          <span key={i} className={`h-0.5 flex-1 rounded-full ${i <= index ? 'bg-white' : 'bg-white/30'}`} />
        ))}
      </div>

      {/* Шапка: аватар, имя, дата */}
      <div className="flex items-center gap-3 px-4 pb-3">
        <Avatar name={story.name} src={story.avatar} size={36} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-white truncate">{story.name}</div>
          <div className="font-mono text-[11px] text-white/60">
            {story.date}{story.time ? ` · ${story.time}` : ''}
          </div>
        </div>
        <button type="button" onClick={onClose} className="p-2 rounded-full bg-white/10 text-white hover:bg-white/20">
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Контент: видео или текст */}
      <div className="flex-1 relative flex items-center justify-center px-4">
        {src && (story.type === 'video_note' || story.type === 'video') ? (
          <video
            src={src}
            controls
            autoPlay
            playsInline
            className="max-h-full max-w-full rounded-2xl"
          />
        ) : (
          <div className="max-w-md w-full rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-600/10 border border-amber-400/30 p-6 text-center space-y-3">
            <Trophy className="h-8 w-8 text-amber-300 mx-auto" />
            <p className="text-lg font-bold text-white leading-snug">
              {story.text || 'Отчёт принят'}
            </p>
            <p className="font-mono text-[11px] text-white/50">Текстовый отчёт · день зачтён</p>
          </div>
        )}

        {/* Стрелки навигации */}
        <button
          type="button"
          onClick={() => onNav(-1)}
          className="absolute left-2 p-2 rounded-full bg-white/10 text-white hover:bg-white/20"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
        <button
          type="button"
          onClick={() => onNav(1)}
          className="absolute right-2 p-2 rounded-full bg-white/10 text-white hover:bg-white/20"
        >
          <ChevronRight className="h-6 w-6" />
        </button>
      </div>

      {/* Нижняя подпись */}
      <div className="p-4 text-center">
        <p className="font-mono text-[11px] text-white/50">
          {index + 1} / {total}
        </p>
      </div>
    </div>
  );
}
