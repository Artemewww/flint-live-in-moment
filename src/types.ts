export type EventType = 'male' | 'mixed' | 'intellectual' | 'active';

export interface HouseQuality {
  key: 'foundation' | 'wall' | 'roof' | 'decor' | 'heat' | 'life';
  name: string;
  part: string;
  emoji: string;
  description: string;
  recommendedFormat?: string;
  markers?: string[];
}

export type EventStatus = 'locked' | 'open' | 'closed';
export type EventPhase = 'past' | 'locked' | 'open' | 'full' | 'closed';

export interface CommunityEvent {
  id: string;
  title: string;
  description: string;
  type: EventType;
  date: string;
  dateEnd?: string;
  dateLabel: string;
  time: string;
  timeEnd: string;
  location: string;
  locationDetails?: string;
  logistics?: {
    assemblyPoint?: string;
    departureTime?: string;
    fuelCost?: number;
    returnInfo?: string;
    notes?: string;
  };
  paymentDetails?: {
    erip?: string;
    card?: string;
    method?: string;
  };
  coordinates?: { lat: number; lng: number };
  distanceFromMinsk?: number;
  travelTime?: number;
  format?: 'offline' | 'online' | 'hybrid';
  painPoint: string;
  houseQualities: HouseQuality[];
  image: string;
  maxParticipants?: number;
  participantsCount: number;
  telegramBotUrl?: string;
  priceType: 'free' | 'paid';
  priceLabel: string;
  priceAmount: number;
  entryThreshold: string;
  entryType: 'male' | 'female' | 'all';
  needsOnboarding?: boolean;
  status?: EventStatus;
  statusReason?: string;
  decisionDeadline?: string;
  checklist?: Record<string, boolean>;
  isPublic?: boolean;
  accessCode?: string;
  deputyId?: number;
  lockedHint?: string;
  program: string[];
  /**
   * Напоминания (reminder7d/3d/1d/3h/1h) + флаги функций события
   * (feat_food/feat_rides/feat_tents — вкл/выкл разделов в боте).
   */
  notifications: Record<string, boolean | undefined>;
  programVoting?: {
    enabled: boolean;
    deadline: string;
    options: string[];
  };
}

export function getToday(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getEventPhase(event: CommunityEvent, today: string = getToday()): EventPhase {
  if ((event.dateEnd || event.date) < today) return 'past';
  if (event.status === 'closed') return 'closed';
  if (event.status === 'locked') return 'locked';
  if (event.maxParticipants && event.participantsCount >= event.maxParticipants) return 'full';
  return 'open';
}

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
  developmentGoal?: HouseQuality['key'];
}

export interface DietaryProfile {
  dietary: 'omnivore' | 'vegetarian' | 'vegan' | '';
  allergies: string[];              // ["молочные","орехи","глютен"]
  likedFoods: string[];             // любимые продукты
  dislikedFoods: string[];          // нелюбимые продукты
  cookingSkills: 'beginner' | 'medium' | 'pro' | 'chef' | '';
  mealPreferences: {
    breakfast: boolean;
    lunch: boolean;
    dinner: boolean;
    snacks: boolean;
  };
}

export interface MenuItem {
  id?: number;
  eventId: string;
  day: number;
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  dish: string;
  ingredients: { name: string; qty: string; note?: string }[];
  cookingNotes?: string;
  assignedTo?: number;
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
  developmentGoal?: HouseQuality['key'];
  developmentRequest?: string;
  /** Завершён ли профиль развития (онбординг). */
  isProfileCompleted?: boolean;
  /** Мечты и стремления (текст, собранный в онбординге). */
  dreams?: string;
  /** Интересы и увлечения. */
  interests?: string[];
  /** Навыки, которыми готов делиться. */
  skills?: string[];
  /** Профиль питания */
  dietary?: DietaryProfile;
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
  if (loc.includes('рыжий кот') || loc.includes('волковичи')) coords = '53.818146,27.387930';
  else if (loc.includes('козлова 3') || loc.includes('чарли')) coords = '53.910331,27.579450';
  else if (loc.includes('октябрьская 16') || loc.includes('дом 12')) coords = '53.890412,27.573912';
  else if (loc.includes('минское море') || loc.includes('причал')) coords = '53.978225,27.383111';
  else if (loc.includes('ислочь') || loc.includes('налибокская')) coords = '53.978912,26.711221';
  else if (loc.includes('пантелеевский') || loc.includes('браслав')) coords = '55.632211,27.051512';
  else if (loc.includes('ратомка') || loc.includes('у истока')) coords = '53.945223,27.340112';
  else if (loc.includes('дрозды')) coords = '53.947212,27.483111';
  else if (loc.includes('киевец')) coords = '53.966512,26.852412';
  if (coords) return `https://yandex.ru/maps/?text=${coords}&z=14`;
  return `https://yandex.ru/maps/?text=${encodeURIComponent(location)}`;
}

export function calculateDynamicPrice(event: CommunityEvent, today: string = getToday()): {
  price: number;
  label: string;
  factors: string[];
} {
  const total = Number((event as any).priceAmount) || 0;
  if (event.priceType !== 'paid' || total <= 0) {
    return { price: 0, label: 'Взнос отсутствует', factors: [] };
  }
  const threshold = Number((event as any).minParticipants) || 10;
  const current = event.participantsCount || 0;
  const perNow = Math.ceil(total / Math.max(current, 1));
  const perGoal = Math.ceil(total / threshold);
  const factors: string[] = [
    `Аренда ${total} Br делится поровну на всех`,
    `Сейчас ${current} чел → ≈ ${perNow} Br/чел`,
  ];
  if (current < threshold) {
    factors.push(`При ${threshold} участниках — ≈ ${perGoal} Br/чел. Зови друзей — станет дешевле!`);
  } else {
    factors.push(`Порог ${threshold} набран — заезд подтверждён ✅`);
  }
  return { price: perNow, label: `≈ ${perNow} Br/чел`, factors };
}