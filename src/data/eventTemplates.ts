import { EventType } from '../types';

// Пресеты событий (§12.1 PLAN.md). Курированные события из бывшего хардкода
// годового календаря (monthsData в CalendarGrid) живут здесь как переиспользуемые
// заготовки: админ выбирает шаблон, ставит дату — получается реальное событие в БД.
// Годовой календарь при этом показывает ТОЛЬКО реальные события.

export interface EventTemplate {
  title: string;
  type: EventType;
  time: string;
  timeEnd: string;
  /** Длительность в днях; > 1 проставляет dateEnd при создании. */
  durationDays?: number;
  maxParticipants: number;
  priceLabel: string;
  priceAmount: number;
  entryThreshold: string;
  entryType: 'male' | 'female' | 'all';
  description: string;
  image: string;
  program: string[];
}

export const EVENT_TEMPLATES: EventTemplate[] = [
  {
    title: 'Мужская баня FLINT',
    type: 'male',
    time: '19:00',
    timeEnd: '23:00',
    maxParticipants: 12,
    priceLabel: 'Аренда делится на всех • при 10+ ≈ 50 Br/чел',
    priceAmount: 500,
    entryThreshold: 'Только мужчины • 100% трезвость • личный веник',
    entryType: 'male',
    description: 'Каноническая перезагрузка ума и тела. Профессиональный пар, закалка ледяной купелью, глубокий прогрев дубовыми вениками и честные разговоры по душам у открытого камина.',
    image: '/assets/images/nano_banya_flint_1780473778276.png',
    program: [
      '18:30 - Сбор, знакомство',
      '19:00 - Парилка (дубовые веники)',
      '20:30 - Перекус, чай',
      '21:00 - Честные разговоры у камина',
      '23:00 - Завершение'
    ]
  },
  {
    title: 'Гиревой вояж у воды',
    type: 'active',
    time: '10:00',
    timeEnd: '12:00',
    maxParticipants: 15,
    priceLabel: 'Свободный вход',
    priceAmount: 0,
    entryThreshold: '100% трезвость • спортивная форма',
    entryType: 'all',
    description: 'Утренняя силовая пробежка у Минского моря. Гири, зарядка, свежий воздух.',
    image: '/assets/images/kettlebell_walk_1780473796598.png',
    program: [
      '10:00 - Сбор, разминка',
      '10:15 - Силовая тренировка',
      '11:30 - Закалка, купание',
      '12:00 - Завершение'
    ]
  },
  {
    title: 'Экзистенциальный Кинотеатр',
    type: 'intellectual',
    time: '19:30',
    timeEnd: '22:00',
    maxParticipants: 20,
    priceLabel: 'Свободный вход',
    priceAmount: 0,
    entryThreshold: '100% трезвость',
    entryType: 'all',
    description: 'Рефлексия и глубокий разбор великих кинокартин. Философские дискуссии после просмотра.',
    image: '/assets/images/existential_cinema_1780473811493.png',
    program: [
      '19:30 - Знакомство',
      '19:45 - Просмотр фильма',
      '21:30 - Философская дискуссия',
      '22:00 - Завершение'
    ]
  },
  {
    title: 'Читательский круг "Смыслы"',
    type: 'intellectual',
    time: '16:00',
    timeEnd: '19:00',
    maxParticipants: 15,
    priceLabel: 'Свободный вход',
    priceAmount: 0,
    entryThreshold: '100% трезвость • книга прочитана',
    entryType: 'all',
    description: 'Интеллектуальный разбор психологических трудов. Глубокие вопросы и честные ответы.',
    image: '/assets/images/reading_smysly_1780473826786.png',
    program: [
      '16:00 - Знакомство',
      '16:15 - Обсуждение книги',
      '17:30 - Глубокие вопросы',
      '19:00 - Завершение'
    ]
  },
  {
    title: 'Лесной поход к Ислочи',
    type: 'active',
    time: '08:00',
    timeEnd: '20:00',
    maxParticipants: 12,
    priceLabel: 'Аренда делится на всех',
    priceAmount: 300,
    entryThreshold: '100% трезвость • спортивная форма • палатка',
    entryType: 'all',
    description: 'Проводники, дикий костер и лесные переходы. Полный день на природе.',
    image: '/assets/images/forest_hike_isloch_1780473844806.png',
    program: [
      '08:00 - Сбор, выезд',
      '10:00 - Начало перехода',
      '13:00 - Обед у костра',
      '16:00 - Осмотр достопримечательностей',
      '18:00 - Возвращение',
      '20:00 - Завершение'
    ]
  },
  {
    title: 'Покерный заезд "Трезвый круг"',
    type: 'mixed',
    time: '18:00',
    timeEnd: '23:00',
    maxParticipants: 16,
    priceLabel: 'Свободный вход',
    priceAmount: 0,
    entryThreshold: '100% трезвость',
    entryType: 'all',
    description: 'Тлеющие угольки, мандарины, апельсиновый сок и глубокая математика.',
    image: '/assets/images/poker_no_smoke_1780473876261.png',
    program: [
      '18:00 - Знакомство, раздача карт',
      '18:30 - Турнир',
      '21:00 - Перерыв, угощения',
      '21:30 - Финальный стол',
      '23:00 - Завершение'
    ]
  },
  {
    title: 'Ораторский Orator-Практикум',
    type: 'intellectual',
    time: '19:00',
    timeEnd: '22:00',
    maxParticipants: 14,
    priceLabel: 'Свободный вход',
    priceAmount: 0,
    entryThreshold: '100% трезвость • готовность выступать',
    entryType: 'all',
    description: 'Раскрытие естественного голоса и искусство аргументов. Речевая харизма и снятие телесных зажимов.',
    image: '/assets/images/orator_podium_1780473860957.png',
    program: [
      '19:00 - Разминка голоса и тела',
      '19:30 - Мини-выступления',
      '20:30 - Разбор и обратная связь',
      '21:30 - Спич-баттл',
      '22:00 - Завершение'
    ]
  },
  {
    title: 'Осознанное голодание «Путь чистоты»',
    type: 'active',
    time: '10:00',
    timeEnd: '18:00',
    durationDays: 3,
    maxParticipants: 10,
    priceLabel: 'Аренда делится на всех',
    priceAmount: 600,
    entryThreshold: '100% трезвость • консультация врача • без противопоказаний',
    entryType: 'all',
    description: 'Телесный детокс от 2 до 4 дней в загородной тишине. Мягкий вход и выход, прогулки, баня, тишина.',
    image: '/assets/images/forest_hike_isloch_1780473844806.png',
    program: [
      'День 1 - Заезд, мягкий вход, прогулка',
      'День 2 - Тишина, баня, дневник',
      'День 3 - Мягкий выход, разбор опыта'
    ]
  },
  {
    title: 'Лагерь "Закалка" Ислочь',
    type: 'male',
    time: '09:00',
    timeEnd: '18:00',
    durationDays: 3,
    maxParticipants: 16,
    priceLabel: 'Аренда делится на всех',
    priceAmount: 900,
    entryThreshold: 'Только мужчины • 100% трезвость • палатка и спальник',
    entryType: 'male',
    description: 'Мужские лесные перегрузки и банный ритуал возрождения. Три дня дисциплины, огня и холодной воды.',
    image: '/assets/images/male_isloch_camp_1780473892239.png',
    program: [
      'День 1 - Заезд, лагерь, вечерний костер',
      'День 2 - Марш-бросок, закалка, баня',
      'День 3 - Ритуал возрождения, разъезд'
    ]
  },
  {
    title: 'Браславский Семейный Слет',
    type: 'mixed',
    time: '12:00',
    timeEnd: '18:00',
    durationDays: 2,
    maxParticipants: 30,
    priceLabel: 'Аренда делится на всех',
    priceAmount: 1200,
    entryThreshold: '100% трезвость • семьи и дети welcome',
    entryType: 'all',
    description: 'Уютный дзен у воды для резидентов и их семей. Палаточная усадьба у озера, лекции, костер, тишина.',
    image: '/assets/images/braslav_family_sunset_1780473908072.png',
    program: [
      'День 1 - Заезд, лагерь, вечер у костра',
      'День 2 - Купание, лекция, разъезд'
    ]
  },
  {
    title: 'Сплав в молчании на каяках',
    type: 'active',
    time: '05:00',
    timeEnd: '12:00',
    maxParticipants: 12,
    priceLabel: 'Аренда делится на всех',
    priceAmount: 400,
    entryThreshold: '100% трезвость • умение плавать',
    entryType: 'all',
    description: 'Медитативный переход по зеркальной глади воды на рассвете. Полное молчание до финиша.',
    image: '/assets/images/braslav_family_sunset_1780473908072.png',
    program: [
      '05:00 - Сбор, инструктаж',
      '05:30 - Старт в молчании',
      '09:00 - Привал, чай',
      '11:00 - Финиш, круг впечатлений',
      '12:00 - Завершение'
    ]
  },
  {
    title: 'Парная терапия у камина',
    type: 'mixed',
    time: '18:00',
    timeEnd: '21:00',
    maxParticipants: 12,
    priceLabel: 'Свободный вход',
    priceAmount: 0,
    entryThreshold: '100% трезвость • открытость к диалогу',
    entryType: 'all',
    description: 'Психологическая рефлексия взаимопонимания в тепле камина. Безопасное пространство и честный разговор.',
    image: '/assets/images/reading_smysly_1780473826786.png',
    program: [
      '18:00 - Знакомство, правила круга',
      '18:30 - Парные практики',
      '20:00 - Общий круг у камина',
      '21:00 - Завершение'
    ]
  }
];
