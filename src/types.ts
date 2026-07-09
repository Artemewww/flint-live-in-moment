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
  date: string; // YYYY-MM-DD дата начала (e.g., "2026-06-04")
  dateEnd?: string; // YYYY-MM-DD дата окончания (для многодневных); пусто = однодневное
  dateLabel: string; // Readable single day or range, e.g. "4 июня в 19:00"
  time: string; // Weekly scale, e.g. "Каждый четверг в 19:00" or "Пятница - Воскресенье"
  timeEnd: string; // Время окончания, e.g. "23:00"
  location: string;
  locationDetails?: string;
  /** Структурированная логистика (точка/время выезда, бензин, обратная дорога). */
  logistics?: {
    assemblyPoint?: string;   // точка сбора / выезда
    departureTime?: string;   // время выезда
    fuelCost?: number;        // взнос на бензин, ₽ (с человека)
    returnInfo?: string;      // обратная дорога
    notes?: string;           // как добраться / доп. инфо
  };
  /** Реквизиты оплаты (для платных событий): ЕРИП / карта / способ. */
  paymentDetails?: {
    erip?: string;
    card?: string;
    method?: string;
  };
  coordinates?: {
    lat: number;
    lng: number;
  };
  painPoint: string; // "Главная боль, которую закрывает"
  houseQualities: HouseQuality[];
  image: string;
  maxParticipants?: number;
  participantsCount: number;
  telegramBotUrl?: string;
  // Flint system thresholds & prices
  priceType: 'free' | 'paid';
  priceLabel: string;     // e.g. "50 BYN на аренду"
  priceAmount: number;    // Основная стоимость аренды (в рублях)
  entryThreshold: string; // e.g. "100% Чистота + Вклад на совесть/веник"
  entryType: 'male' | 'female' | 'all'; // Кто может участвовать
  needsOnboarding?: boolean; // Фильтр/Табель отбора
  /** Текущий статус набора. По умолчанию — 'open'. */
  status?: EventStatus;
  /** Текст-подсказка для события «под замочком», напр. «Даты уточняются». */
  lockedHint?: string;
  /** Программа мероприятия */
  program: string[];
  /** Уведомления */
  notifications: {
    reminder7d: boolean;
    reminder3d: boolean;
    reminder1d: boolean;
    reminder3h: boolean;
    reminder1h: boolean;
  };
  /** Голосование за программу */
  programVoting?: {
    enabled: boolean;
    deadline: string; // YYYY-MM-DD
    options: string[];
  };
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
  // Для многодневных «прошедшее» считается по дате ОКОНЧАНИЯ, а не начала.
  if ((event.dateEnd || event.date) < today) return 'past';
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
  id: string;
  eventId: string;
  telegram: string;
  name: string;
  phone?: string;
  birthday?: string;
  status: 'pending' | 'confirmed' | 'rejected' | 'cancelled';
  paymentStatus: 'pending' | 'paid' | 'free' | 'refunded';
  paymentAmount: number;
  donationAmount: number;
  inviter?: string;
  hasTransport: boolean;
  transportDetails?: string;
  transportSeats: number;
  inventory: string[];
  registeredAt: string;
  confirmedAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
  notes?: string;
  category?: 'male' | 'female';
  dietary?: 'omnivore' | 'vegetarian' | 'vegan';
  guestCount?: number;
  equipment?: string[];
  roles?: string[];
  source?: string;
}

export interface UserProfile {
  telegram: string;
  name: string;
  phone?: string;
  birthday?: string;
  achievements: Achievement[];
  totalEvents: number;
  totalEventsAttended: number;
  createdAt: string;
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  unlockedAt: string;
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
  // Бесплатно — либо явно free, либо платно без суммы (или легаси-значения).
  const total = Number((event as any).priceAmount) || 0;
  if (event.priceType !== 'paid' || total <= 0) {
    return { price: 0, label: 'Бесплатно', factors: [] };
  }

  // Платно: аренда делится ПОРОВНУ на текущее число участников + прогноз к порогу.
  const threshold = Number((event as any).minParticipants) || 10;
  const current = event.participantsCount || 0;
  const perNow = Math.ceil(total / Math.max(current, 1));
  const perGoal = Math.ceil(total / threshold);

  const factors: string[] = [
    `Аренда ${total} ₽ делится поровну на всех`,
    `Сейчас ${current} чел → ≈ ${perNow} ₽/чел`,
  ];
  if (current < threshold) {
    factors.push(`При ${threshold} участниках — ≈ ${perGoal} ₽/чел. Зови друзей — станет дешевле!`);
  } else {
    factors.push(`Порог ${threshold} набран — заезд подтверждён ✅`);
  }

  return { price: perNow, label: `≈ ${perNow} ₽/чел`, factors };
}

