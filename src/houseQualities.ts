import { HouseQuality } from './types';

/**
 * Единый источник 6 качеств «Дома Личности».
 * Ключи: foundation (Предназначение), wall (Воля), roof (Совесть),
 *        decor (Творчество), heat (Любовь), life (Счастье).
 */
export const HOUSE_QUALITIES: HouseQuality[] = [
  {
    key: 'foundation',
    name: 'Предназначение',
    part: 'Фундамент',
    emoji: '🏛️',
    description: 'Укрепляет внутренний стержень и ясность целей',
  },
  {
    key: 'wall',
    name: 'Воля',
    part: 'Стены',
    emoji: '🧱',
    description: 'Развивает дисциплину, выдержку и характер',
  },
  {
    key: 'roof',
    name: 'Совесть',
    part: 'Крыша',
    emoji: '🛡️',
    description: 'Формирует честность, ответственность и нравственный компас',
  },
  {
    key: 'decor',
    name: 'Творчество',
    part: 'Декор',
    emoji: '🎨',
    description: 'Раскрывает креативность, вдохновение и самовыражение',
  },
  {
    key: 'heat',
    name: 'Любовь',
    part: 'Тепло',
    emoji: '🔥',
    description: 'Развивает эмпатию, принятие и глубокие связи',
  },
  {
    key: 'life',
    name: 'Счастье',
    part: 'Жизнь',
    emoji: '☀️',
    description: 'Помогает находить радость, благодарность и полноту жизни',
  },
];

/** Карта: ключ → качество. */
export const HOUSE_QUALITIES_MAP: Record<string, HouseQuality> = {};
for (const q of HOUSE_QUALITIES) {
  HOUSE_QUALITIES_MAP[q.key] = q;
}

/** Преобразует массив ключей в массив HouseQuality. */
export function qualitiesFromKeys(keys: string[]): HouseQuality[] {
  return keys
    .map((k) => HOUSE_QUALITIES_MAP[k])
    .filter(Boolean) as HouseQuality[];
}