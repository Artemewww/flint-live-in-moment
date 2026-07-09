import { HouseQuality } from './types';

/** Канонический «Дом Личности» — 6 качеств манифеста. Единый источник для карточки и админки. */
export const HOUSE_QUALITIES: Array<HouseQuality & { emoji: string }> = [
  { key: 'foundation', name: 'Предназначение', part: 'Фундамент', emoji: '🎯',
    description: 'Осознание своей жизненной миссии, целей и глубокое понимание «Зачем ты здесь».' },
  { key: 'wall', name: 'Воля', part: 'Стены', emoji: '💪',
    description: 'Сила характера, развитие мощной самодисциплины и энергии для преодоления преград.' },
  { key: 'roof', name: 'Совесть', part: 'Крыша', emoji: '🧠',
    description: 'Внутренний компас и нравственный щит. Защищает личность от разрушительных шагов.' },
  { key: 'decor', name: 'Творчество', part: 'Украшение', emoji: '🎨',
    description: 'Раскрытие уникального потенциала, эстетического взгляда и ораторской харизмы.' },
  { key: 'heat', name: 'Любовь', part: 'Тепло', emoji: '❤️',
    description: 'Эмпатия, подлинные партнёрские узы Мужчины и Женщины, созидание душевного тепла.' },
  { key: 'life', name: 'Счастье', part: 'Жизнь в доме', emoji: '✨',
    description: 'Гармония, состояние подлинного присутствия здесь и сейчас без фальшивых ролей.' },
];

export type HouseQualityKey = HouseQuality['key'];

/** Строит массив HouseQuality из выбранных ключей (порядок канонический). */
export function qualitiesFromKeys(keys: string[]): HouseQuality[] {
  const set = new Set(keys);
  return HOUSE_QUALITIES.filter(q => set.has(q.key)).map(({ key, name, part, description }) => ({ key, name, part, description }));
}
