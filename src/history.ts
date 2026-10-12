/**
 * Ролики, смонтированные вручную и лежащие файлом в /public, — привязка к
 * событиям по id.
 *
 * Раньше здесь жил весь «архив» — жёсткий список из пяти открыток. Теперь архив
 * строится из базы (api/events.ts, action=archive), но часть роликов существует
 * только как файлы на диске: их никто не заливал в галерею события, и без этой
 * карты Ислочь, Нарочь и Марш-бросок остались бы в архиве без единого ролика.
 *
 * Ключ — id события, а не название: название организатор меняет, id живёт вечно.
 * Ролик подставляется ТОЛЬКО если у события нет своего видео, поэтому свежая
 * загрузка в галерею всегда побеждает и не дублируется.
 */
export interface LegacyVideo {
  /** Файл ролика в /public. */
  src: string;
  /** Кадр-обложка: без неё <video> показывает чёрный квадрат до нажатия play. */
  poster: string;
  title: string;
}

export const LEGACY_VIDEOS: Record<string, LegacyVideo> = {
  'event-1783682194028': {
    title: 'Ислочь',
    src: '/assets/video/history/flint-isloch-2025.mp4',
    poster: '/assets/video/history/flint-isloch-poster.jpg',
  },
  'event-1784796070475': {
    title: 'Перезагрузка на Нарочи',
    src: '/assets/video/history/hero.mp4',
    poster: '/assets/video/history/hero-poster.jpg',
  },
  'event-1787430056600': {
    title: 'Марш-бросок 30 км',
    src: '/assets/video/history/flint-30km.mp4',
    poster: '/assets/video/history/run30-poster.jpg',
  },
  'event-1783859565746': {
    title: 'Меловые карьеры',
    src: '/assets/video/history/flint-melovcarier-2026.mp4',
    poster: '/assets/video/history/melov-poster.jpg',
  },
};