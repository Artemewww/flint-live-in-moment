/**
 * «История сообщества» — страница прошедших мероприятий.
 * Каждое мероприятие — открытка-обложка (постер с датой), по клику открывается
 * просмотр видео (и галерея фото, если есть).
 * Файлы живут в /public/assets/video/history. Добавить = положить видео и строку сюда.
 */
export interface HistoryItem {
  id: string;
  /** Название события. */
  title: string;
  /** Тип/тема события (иконка-акцент). */
  emoji: string;
  /** Дата проведения (для подписи на открытке). */
  date: string;
  /** Место / локация. */
  place?: string;
  /** Короткое описание. */
  caption?: string;
  /** URL видео. */
  src: string;
  /** Обложка-постер (рекомендуется) — иначе берём первый кадр видео. */
  poster?: string;
  /** Есть ли у события фотографии (показывает иконку 📷 поверх обложки). */
  hasPhotos?: boolean;
  /** Прямые ссылки на фото события (открываются по клику «смотреть фото»). */
  photos?: string[];
}

export const HISTORY: HistoryItem[] = [
  {
    id: 'march-30km',
    title: 'Марш-бросок 30 км',
    emoji: '🏃',
    date: '04 сентября 2026',
    place: 'Новая Боровая',
    caption: '30 километров дорог, озера и характера',
    src: '/assets/video/history/flint-30km.mp4',
    poster: '/assets/video/history/run30-poster.jpg',
  },
  {
    id: 'mushroom-naroch',
    title: 'Грибная Нарочь',
    emoji: '🍄',
    date: '29 августа 2026',
    place: 'Нарочь',
    caption: 'Тихий заплыв за дарами леса',
    src: '/assets/video/history/hero.mp4',
    poster: '/assets/video/history/hero-poster.jpg',
  },
  {
    id: 'isloch-2025',
    title: 'Ислочь 2025',
    emoji: '🏕️',
    date: '2025',
    place: 'Долина Ислочи',
    caption: 'Лесной поход к берегам',
    src: '/assets/video/history/flint-isloch-2025.mp4',
    poster: '/assets/video/history/flint-isloch-poster.jpg',
  },
  {
    id: 'melovcarier-2026',
    title: 'Мелкарьер 2026',
    emoji: '🌊',
    date: '2026',
    place: 'Мелкарьер',
    caption: 'Дзен-сплав и берега',
    src: '/assets/video/history/flint-melovcarier-2026.mp4',
    poster: '/assets/video/history/melov-poster.jpg',
  },
  {
    id: 'lv-event',
    title: 'Live in Moment',
    emoji: '✨',
    date: '2026',
    place: 'Клуб одного дыхания',
    caption: 'События живого общения',
    src: '/assets/video/history/flint-lv-event.mp4',
    poster: '/assets/video/history/lv-poster.jpg',
    hasPhotos: true,
  },
];