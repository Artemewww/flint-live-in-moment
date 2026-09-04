import type { CommunityEvent } from './types';

/**
 * Промо-видео, привязанные к событиям по сигнатуре названия/локации.
 * Нужно, чтобы рекламный ролик грибного события гарантированно появлялся
 * в его карточке, даже когда в базе поле promo_video ещё не заполнено.
 *
 * Как это работает: сначала берём event.promoVideo (заполнили в админке/базе),
 * и только если его нет — матчим сигнатуры ниже против названия и локации.
 *
 * Файлы живут в /public/assets/video. Добавить ролик = положить сюда видео
 * и дописать строку с сигнатурами.
 */
interface PromoRule {
  /** Подстроки названия события (lowercase) — любое совпадение включает ролик. */
  titleHints: string[];
  /** Подстроки локации (lowercase). */
  locationHints: string[];
  src: string;
  label: string;
}

const RULES: PromoRule[] = [
  {
    titleHints: ['гриб', 'нароч', 'mushroom'],
    locationHints: ['нароч', 'naroch'],
    src: '/assets/video/flint-mushroom.mp4',
    label: 'Тираж Тихого Заплыва — грибной сезон на Нарочи',
  },
];

/**
 * Возвращает промо-видео для события: сперва явное поле event.promoVideo,
 * затем — совпадение по правилам (название/локация).
 */
export function getPromoVideo(event: CommunityEvent): { src: string; label?: string } | null {
  if (event.promoVideo) return { src: event.promoVideo };

  const title = (event.title || '').toLowerCase();
  const location = `${event.location || ''} ${event.locationDetails || ''}`.toLowerCase();

  for (const rule of RULES) {
    const titleHit = rule.titleHints.some((h) => title.includes(h));
    const locHit = rule.locationHints.some((h) => location.includes(h));
    if (titleHit || locHit) {
      return { src: rule.src, label: rule.label };
    }
  }
  return null;
}