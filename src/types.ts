export type EventType = 'male' | 'mixed' | 'intellectual' | 'active';

export interface HouseQuality {
  key: 'foundation' | 'wall' | 'roof' | 'decor' | 'heat' | 'life';
  name: string;      // e.g. "Воля"
  part: string;      // e.g. "Стены"
  description: string; // e.g. "Укрепляет внутренний стержень и дисциплину"
}

/**
 * Жизненный цикл мероприятия — единый для сайта и Telegram-бота.
 * - 'locked'  — анонс «под замочком»: даты определяются, набор скоро откроется.
 * - 'open'    — идёт активный набор участников (регистрация доступна).
 * - 'closed'  — набор закрыт вручную организатором.
 * Прошедшие события ('past') вычисляются по дате и не хранятся в поле.
 */
export type EventStatus = 'locked' | 'open' | 'closed';

/** Итоговая фаза для отображения (учитывает дату и заполненность). */
export type EventPhase = 'past' | 'locked' | 'open' | 'full' | 'closed';

export interface CommunityEvent {
  id: string;
  title: string;
  description: string;
  type: EventType;
  date: string; // YYYY-MM-DD format (e.g., "2026-06-04")
  dateLabel: string; // Readable single day or range, e.g. "4 июня в 19:00"
  time: string; // Weekly scale, e.g. "Каждый четверг в 19:00" or "Пятница - Воскресенье"
  location: string;
  locationDetails?: string;
  painPoint: string; // "Главная боль, которую закрывает"
  houseQualities: HouseQuality[];
  image: string;
  maxParticipants?: number;
  participantsCount: number;
  telegramBotUrl?: string;
  // Flint system thresholds & prices
  priceType: 'free' | 'conscience' | 'paid';
  priceLabel: string;     // e.g. "50 BYN на аренду"
  entryThreshold: string; // e.g. "100% Чистота + Вклад на совесть/веник"
  needsOnboarding?: boolean; // Фильтр/Табель отбора
  /** Текущий статус набора. По умолчанию — 'open'. */
  status?: EventStatus;
  /** Текст-подсказка для события «под замочком», напр. «Даты уточняются». */
  lockedHint?: string;
}

/** Возвращает сегодняшнюю дату в формате YYYY-MM-DD. */
export function getToday(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Единая точка вычисления фазы мероприятия — используется и на сайте,
 * и в API (которое отдаёт данные боту), чтобы состояние совпадало везде.
 */
export function getEventPhase(event: CommunityEvent, today: string = getToday()): EventPhase {
  if (event.date < today) return 'past';
  if (event.status === 'closed') return 'closed';
  if (event.status === 'locked') return 'locked';
  if (event.maxParticipants && event.participantsCount >= event.maxParticipants) return 'full';
  return 'open';
}

/** Можно ли прямо сейчас записаться на мероприятие через форму сайта. */
export function isRegistrationOpen(event: CommunityEvent, today: string = getToday()): boolean {
  return getEventPhase(event, today) === 'open';
}

export interface Registration {
  eventId: string;
  name: string;
  phone: string;
  telegram: string;
  registeredAt: string;
  /** Статус верификации участника */
  verificationStatus: 'pending' | 'approved' | 'rejected' | 'voting';
  /** ID голосования в группе (если нужно) */
  votingMessageId?: string;
  /** Количество голосов "за" */
  votesFor?: number;
  /** Количество голосов "против" */
  votesAgainst?: number;
  /** Кто проголосовал (telegram IDs) */
  voters?: string[];
  /** Примечания организаторов */
  adminNotes?: string;
}

export function getYandexMapsUrl(location: string): string {
  const loc = (location || '').toLowerCase();
  let coords = '';
  if (loc.includes('рыжий кот') || loc.includes('волковичи')) {
    coords = '53.818146,27.387930';
  } else if (loc.includes('козлова 3') || loc.includes('чарли')) {
    coords = '53.910331,27.579450';
  } else if (loc.includes('октябрьская 16') || loc.includes('дом 12')) {
    coords = '53.890412,27.573912';
  } else if (loc.includes('минское море') || loc.includes('причал')) {
    coords = '53.978225,27.383111';
  } else if (loc.includes('ислочь') || loc.includes('налибокская')) {
    coords = '53.978912,26.711221';
  } else if (loc.includes('пантелеевский') || loc.includes('браслав')) {
    coords = '55.632211,27.051512';
  } else if (loc.includes('ратомка') || loc.includes('у истока')) {
    coords = '53.945223,27.340112';
  } else if (loc.includes('дрозды')) {
    coords = '53.947212,27.483111';
  } else if (loc.includes('киевец')) {
    coords = '53.966512,26.852412';
  }

  if (coords) {
    return `https://yandex.ru/maps/?text=${coords}&z=14`;
  }
  return `https://yandex.ru/maps/?text=${encodeURIComponent(location)}`;
}

/**
 * Динамическое ценообразование для бани.
 * Логика: общая стоимость аренды делится на количество участников.
 * - Базовая аренда: 500 BYN
 * - При 10+ человек: ~50 BYN/чел
 * - Чем больше людей, тем дешевле для каждого
 */
export function calculateDynamicPrice(event: CommunityEvent, today: string = getToday()): {
  price: number;
  label: string;
  factors: string[];
} {
  const RENTAL_COST = 500; // Стоимость аренды бани в BYN
  const MIN_PARTICIPANTS = 10; // Минимум для подтверждения заезда
  const eventDate = new Date(event.date);
  const todayDate = new Date(today);
  const daysUntilEvent = Math.ceil((eventDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24));
  
  // Определяем день недели (0 = воскресенье, 6 = суббота)
  const dayOfWeek = eventDate.getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  
  // Количество участников (включая текущего пользователя если он зарегистрирован)
  const currentParticipants = event.participantsCount;
  
  // Если нет участников, показываем цену при минимальном количестве
  const participantsForCalc = currentParticipants > 0 ? currentParticipants : MIN_PARTICIPANTS;
  
  // Базовая цена = аренда / участники
  let price = Math.ceil(RENTAL_COST / participantsForCalc);
  const factors: string[] = [];
  
  // 1. Скидка за раннюю регистрацию (за 7+ дней)
  if (daysUntilEvent >= 7) {
    price = Math.round(price * 0.9); // -10%
    factors.push('Ранняя запись (-10%)');
  }
  
  // 2. Наценка за позднюю регистрацию (за 2 дня)
  if (daysUntilEvent <= 2 && daysUntilEvent >= 0) {
    price = Math.round(price * 1.15); // +15%
    factors.push('Поздняя регистрация (+15%)');
  }
  
  // 3. Выходные дороже
  if (isWeekend) {
    price = Math.round(price * 1.2); // +20%
    factors.push('Выходные (+20%)');
  }
  
  // 4. Минимальная и максимальная цена
  price = Math.max(30, Math.min(price, 150)); // От 30 до 150 BYN
  
  return {
    price: price,
    label: `${price} BYN`,
    factors
  };
}

