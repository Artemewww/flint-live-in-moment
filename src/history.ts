/**
 * «История сообщества» — вертикальная лента видео как в сторис/Reels.
 * Каждая история: видео (рекомендуется 9:16 или квадрат) + заголовок события.
 * Файлы живут в /public/assets/video/history. Добавить = положить видео и строку сюда.
 */
export interface HistoryItem {
  id: string;
  /** Название события / подпись истории. */
  title: string;
  /** Тип события (для иконки-акцента в ленте). */
  emoji: string;
  /** Подпись-подзаголовок: дата или место. */
  caption?: string;
  src: string;
  /** Постер-превью (опционально) — если нет, берём видео с preload. */
  poster?: string;
}

export const HISTORY: HistoryItem[] = [
  {
    id: 'mushroom-naroch',
    title: 'Грибная Нарочь',
    emoji: '🍄',
    caption: 'Тихий заплыв за дарами леса',
    src: '/assets/video/history/hero.mp4',
  },
  {
    id: 'isloch-2025',
    title: 'Ислочь 2025',
    emoji: '🏕️',
    caption: 'Лесной поход к берегам',
    src: '/assets/video/history/flint-isloch-2025.mp4',
    poster: '/assets/video/history/flint-isloch-poster.jpg',
  },
  {
    id: 'melovcarier-2026',
    title: 'Мелкарьер 2026',
    emoji: '🌊',
    caption: 'Дзен-сплав и берега',
    src: '/assets/video/history/flint-melovcarier-2026.mp4',
  },
  {
    id: 'lv-event',
    title: 'Live in Moment',
    emoji: '✨',
    caption: 'События живого общения',
    src: '/assets/video/history/flint-lv-event.mp4',
  },
];