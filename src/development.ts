/**
 * Модуль "Осознанное развитие" — аналитика, рекомендации и умный матчинг
 * для платформы FLINT «Живи в моменте».
 * 
 * Связывает 6 качеств «Дома Личности» с мероприятиями, запросами участников
 * и персональными рекомендациями.
 */

import { HouseQuality, CommunityEvent, UserProfile } from './types';
import { HOUSE_QUALITIES } from './houseQualities';

// ─── Конфигурация качеств с маркерами и форматами ─────────────────────────

/** Обогащённая карта качеств с маркерами для ИИ-анализа. */
export const QUALITY_MAP: Record<string, {
  key: HouseQuality['key'];
  name: string;
  part: string;
  emoji: string;
  description: string;
  /** Какие форматы событий лучше всего прокачивают это качество. */
  recommendedFormats: string[];
  /** Ключевые слова-маркеры, которые помогут ИИ определить запрос. */
  markers: string[];
  /** Вопрос для ИИ-онбординга, чтобы выявить запрос. */
  onboardingQuestion: string;
}> = {
  foundation: {
    key: 'foundation',
    name: 'Предназначение',
    part: 'Фундамент',
    emoji: '🏛️',
    description: 'Укрепляет внутренний стержень и ясность целей',
    recommendedFormats: ['дискуссия', 'шеринг', 'интеллектуальный клуб', 'стратегическая сессия'],
    markers: ['смысл', 'цель', 'предназначение', 'миссия', 'путь', 'направление', 'призвание', 'ценности', 'разобраться', 'понять себя', 'кризис'],
    onboardingQuestion: 'Чувствуешь потребность разобраться в своих целях и направлении? Или, наоборот, хочешь укрепить уже найденный путь?',
  },
  wall: {
    key: 'wall',
    name: 'Воля',
    part: 'Стены',
    emoji: '🧱',
    description: 'Развивает дисциплину, выдержку и характер',
    recommendedFormats: ['выезд', 'экстрим', 'активный отдых', 'спорт', 'преодоление', 'поход'],
    markers: ['дисциплина', 'воля', 'сила', 'характер', 'преодоление', 'выдержка', 'тренировка', 'режим', 'собраться', 'бросить вызов'],
    onboardingQuestion: 'Ты сейчас в поиске дисциплины и структуры? Или хочешь бросить себе вызов и проверить свои границы?',
  },
  roof: {
    key: 'roof',
    name: 'Совесть',
    part: 'Крыша',
    emoji: '🛡️',
    description: 'Формирует честность, ответственность и нравственный компас',
    recommendedFormats: ['мужской круг', 'честный разговор', 'рефлексия', 'мастер-майнд'],
    markers: ['совесть', 'честность', 'ответственность', 'мораль', 'стыд', 'прощение', 'искупление', 'правда', 'принять решение'],
    onboardingQuestion: 'Есть ли что-то, что тяготит и с чем нужно разобраться честно? Важно чувство ответственности и чистоты?',
  },
  decor: {
    key: 'decor',
    name: 'Творчество',
    part: 'Декор',
    emoji: '🎨',
    description: 'Раскрывает креативность, вдохновение и самовыражение',
    recommendedFormats: ['арт-сессия', 'воркшоп', 'музыка', 'ремесло', 'свободное творчество'],
    markers: ['творчество', 'креатив', 'вдохновение', 'самовыражение', 'искусство', 'рисовать', 'музыка', 'писать', 'создавать', 'фантазия'],
    onboardingQuestion: 'Чувствуешь потребность в творческом самовыражении? Давно хотел что-то создать, но не было контекста?',
  },
  heat: {
    key: 'heat',
    name: 'Любовь',
    part: 'Тепло',
    emoji: '🔥',
    description: 'Развивает эмпатию, принятие и глубокие связи',
    recommendedFormats: ['близкий круг', 'семейный', 'шеринг', 'парный формат', 'групповая терапия'],
    markers: ['любовь', 'отношения', 'тепло', 'принятие', 'близость', 'дружба', 'одиночество', 'доверие', 'открыться', 'чувства'],
    onboardingQuestion: 'Как у тебя с близостью и доверием? Хочется больше тепла в отношениях или разобраться в чувствах?',
  },
  life: {
    key: 'life',
    name: 'Счастье',
    part: 'Жизнь',
    emoji: '☀️',
    description: 'Помогает находить радость, благодарность и полноту жизни',
    recommendedFormats: ['праздник', 'фестиваль', 'природа', 'легкий формат', 'баня', 'отдых'],
    markers: ['счастье', 'радость', 'легкость', 'благодарность', 'кайф', 'удовольствие', 'отдых', 'расслабиться', 'наслаждение', 'довольство'],
    onboardingQuestion: 'Чего больше хочется — лёгкости и радости или глубины и смысла? Или баланса?',
  },
};

// ─── Аналитика запросов сообщества ─────────────────────────────────────────

export interface CommunityRequestAnalysis {
  /** Распределение запросов по качествам: ключ → процент. */
  distribution: Record<string, number>;
  /** Качество, которое запрашивают больше всего. */
  topQuality: string;
  /** Доля top-качества в процентах. */
  topShare: number;
  /** Рекомендация организатору. */
  recommendation: string;
  /** Пример формата для top-качества. */
  suggestedFormat: string;
}

/**
 * Анализирует "карту запросов" сообщества на основе профилей участников.
 * @param profiles массив профилей с developmentGoal
 * @returns Аналитика с распределением и рекомендацией
 */
export function analyzeCommunityRequests(profiles: (UserProfile | { developmentGoal?: HouseQuality['key'] })[]): CommunityRequestAnalysis {
  const counts: Record<string, number> = {};
  let total = 0;

  for (const p of profiles) {
    const goal = p.developmentGoal;
    if (goal && goal in QUALITY_MAP) {
      counts[goal] = (counts[goal] || 0) + 1;
      total++;
    }
  }

  const distribution: Record<string, number> = {};
  for (const key of Object.keys(QUALITY_MAP)) {
    distribution[key] = total > 0 ? Math.round(((counts[key] || 0) / total) * 100) : 0;
  }

  // Качество с максимальным запросом
  let topQuality = '';
  let topCount = 0;
  for (const [key, n] of Object.entries(counts)) {
    if (n > topCount) {
      topCount = n;
      topQuality = key;
    }
  }

  const topShare = total > 0 ? Math.round((topCount / total) * 100) : 0;
  const q = QUALITY_MAP[topQuality];

  let recommendation = '';
  if (topShare >= 60) {
    recommendation = `🚀 ${topShare}% сообщества запрашивает "${q?.name}". Создай событие в формате "${q?.recommendedFormats[0]}" — это сейчас максимально востребовано.`;
  } else if (topShare >= 30) {
    recommendation = `📊 ${topShare}% участников хотят развивать "${q?.name}". Хороший момент добавить событие в этом направлении.`;
  } else if (total > 0) {
    recommendation = `🔍 Запросы распределены равномерно. Можно чередовать форматы, чтобы закрывать все 6 качеств.`;
  } else {
    recommendation = '📝 Пока нет данных о запросах. Добавь онбординг с вопросами о целях развития.';
  }

  return {
    distribution,
    topQuality,
    topShare,
    recommendation,
    suggestedFormat: q?.recommendedFormats[0] || 'смешанный формат',
  };
}

// ─── Умный матчинг ─────────────────────────────────────────────────────────

export interface SmartMatch {
  event: CommunityEvent;
  /** Насколько событие подходит цели развития (0..1). */
  relevanceScore: number;
  /** Какие качества закрывает. */
  matchedQualities: string[];
  /** Сообщение для приглашения участника. */
  invitationMessage: string;
}

/**
 * Подбирает события под цель развития участника, сортируя по релевантности.
 * @param events список доступных событий
 * @param developmentGoal цель развития участника
 * @returns отсортированный список матчей с сообщениями
 */
export function smartMatch(
  events: CommunityEvent[],
  developmentGoal?: HouseQuality['key']
): SmartMatch[] {
  if (!developmentGoal) {
    return events.map(e => ({
      event: e,
      relevanceScore: 0.3,
      matchedQualities: [],
      invitationMessage: 'Приходи — будет интересно!',
    }));
  }

  const quality = QUALITY_MAP[developmentGoal];
  if (!quality) return [];

  const scored = events.map(e => {
    // Какие качества закрывает это событие
    const eventKeys = new Set(e.houseQualities.map(hq => hq.key));
    const matched = [...eventKeys].filter(k => k in QUALITY_MAP);

    // Основная оценка: есть ли target-качество среди houseQualities события
    const hasTarget = eventKeys.has(developmentGoal);
    const targetScore = hasTarget ? 0.6 : 0.1;

    // Дополнительная оценка: формат события
    const formatStr = (e.description + ' ' + e.program.join(' ')).toLowerCase();
    const formatBonus = quality.recommendedFormats.some(f => formatStr.includes(f.toLowerCase())) ? 0.2 : 0;

    // Бонус за близость по типу
    const typeBonus = e.type === 'active' && developmentGoal === 'wall' ? 0.1 :
                      e.type === 'intellectual' && developmentGoal === 'foundation' ? 0.1 :
                      e.type === 'mixed' && developmentGoal === 'heat' ? 0.05 : 0;

    const score = Math.min(1, targetScore + formatBonus + typeBonus);

    // Генерация персонального сообщения
    const qualityName = quality.name.toLowerCase();
    let invitationMessage = '';
    if (hasTarget) {
      invitationMessage = `🎯 Это событие идеально поможет тебе прокачать твою **${qualityName}** через ${quality.recommendedFormats[0] || 'практику'}.`;
    } else if (score > 0.3) {
      invitationMessage = `💪 Здесь ты сможешь развить важные качества, в том числе **${qualityName}**.`;
    } else {
      invitationMessage = `📅 Отличное событие для новых впечатлений!`;
    }

    return { event: e, relevanceScore: score, matchedQualities: matched, invitationMessage };
  });

  return scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
}

// ─── Определение цели развития по тексту ────────────────────────────────────

/**
 * Определяет наиболее вероятную цель развития на основе текста ответа.
 * Используется в ИИ-онбординге, когда пользователь отвечает на наводящие вопросы.
 * @param text ответ пользователя
 * @returns ключ качества и уверенность (0..1)
 */
export function detectDevelopmentGoal(text: string): { key: HouseQuality['key']; confidence: number } | null {
  const lower = text.toLowerCase();
  let bestKey: HouseQuality['key'] | null = null;
  let bestScore = 0;

  for (const [, q] of Object.entries(QUALITY_MAP)) {
    let score = 0;
    for (const marker of q.markers) {
      if (lower.includes(marker.toLowerCase())) {
        score += 0.2;
      }
    }
    // Если в тексте упомянуто само качество
    if (lower.includes(q.name.toLowerCase())) {
      score += 0.5;
    }
    if (score > bestScore) {
      bestScore = score;
      bestKey = q.key;
    }
  }

  if (bestKey && bestScore >= 0.3) {
    return { key: bestKey, confidence: Math.min(1, bestScore) };
  }
  return null;
}

// ─── Форматирование для аналитики в админке ─────────────────────────────────

export function formatQualityDistribution(distribution: Record<string, number>): string {
  const lines = Object.entries(QUALITY_MAP).map(([key, q]) => {
    const pct = distribution[key] || 0;
    const bar = '█'.repeat(Math.round(pct / 5));
    return `${q.emoji} ${q.name.padEnd(14)} ${pct}% ${bar}`;
  });
  return lines.join('\n');
}