
export const QUALITIES = {
  foundation: {
    key: 'foundation',
    name: 'Предназначение',
    part: 'Фундамент',
    description: 'Осознание своей жизненной миссии, целей и глубокое понимание «Зачем ты здесь».'
  },
  wall: {
    key: 'wall',
    name: 'Воля',
    part: 'Стены',
    description: 'Сила характера, развитие мощной самодисциплины и энергии для преодоления преград.'
  },
  roof: {
    key: 'roof',
    name: 'Совесть',
    part: 'Крыша',
    description: 'Внутренний компас и нравственный щит. Защищает личность от разрушительных шагов.'
  },
  decor: {
    key: 'decor',
    name: 'Творчество',
    part: 'Украшение',
    description: 'Раскрытие уникального потенциала, эстетического взгляда и ораторской харизмы.'
  },
  heat: {
    key: 'heat',
    name: 'Любовь',
    part: 'Тепло',
    description: 'Эмпатия, подлинные партнерские узы Мужчины и Женщины, созидание душевного тепла.'
  },
  life: {
    key: 'life',
    name: 'Счастье',
    part: 'Жизнь в доме',
    description: 'Гармония, состояние подлинного присутствия здесь и сейчас без фальшивых ролей.'
  }
};

export const INITIAL_EVENTS = [
  {
    id: 'banya-flint-weekly',
    title: 'Мужская баня FLINT',
    description: 'Каноническая перезагрузка ума и тела. Профессиональный пар в бане «Рыжий кот» (redhouse.by), закалка ледяной купелью, глубокий прогрев дубовыми вениками и честные разговоры по душам у открытого камина.\n\nКак это работает: аренду мы делим на всех поровну — чем больше собирается круг, тем меньше взнос с каждого. Нужно набрать минимум 10 человек, чтобы порог входа опустился до ~50 ₽/чел; если людей меньше — заезд может не подтвердиться. По-дружески: возьми с собой что-то на общий стол (свой чай, угощение) — это не обязательно, но по-нашему.',
    type: 'male',
    date: '2026-06-04',
    dateLabel: '4 июня (Четверг), 19:00',
    time: 'Четверг, 19:00 - 23:00',
    location: 'Баня «Рыжий кот» (redhouse.by), д. Волковичи',
    locationDetails: '10 км от МКАД, уединенный деревянный сруб на опушке.',
    painPoint: 'Телесные зажимы, маски мегаполиса, синдром одинокого топ-менеджера',
    houseQualities: [QUALITIES.wall, QUALITIES.foundation],
    image: '/assets/images/nano_banya_flint_1780473778276.png', // Beautiful wooden sauna
    maxParticipants: 12,
    participantsCount: 8,
    telegramBotUrl: 'https://t.me/campsflint_bot',
    priceType: 'conscience',
    priceLabel: 'Аренда делится на всех • при 10+ ≈ 50 ₽/чел • меньше людей — взнос выше',
    entryThreshold: 'Только мужчины • 100% трезвость • личный веник • минимум 10 чел для подтверждения • по желанию — угощение на общий стол',
    needsOnboarding: true
  },
  {
    id: 'kettlebell-walk-active',
    title: 'Спортивная прогулка с гирями',
    description: 'Символическое силовой трекинг на свежем воздухе для привлечения внимания и обмена чистым опытом. Бег трусцой 5 км в комфортном темпе, разминка на траве и укрепление физического стержня.',
    type: 'active',
    date: '2026-06-07',
    dateLabel: '7 июня (Воскресенье), 09:00',
    time: 'Воскресенье, 09:00 - 11:30',
    location: 'Минское море, причал №3',
    locationDetails: 'Сбор у центрального входа на пляж со своими гирями (по возможности).',
    painPoint: 'Выходная лень, упадок сил, прокрастинация перед монитором',
    houseQualities: [QUALITIES.wall, QUALITIES.life],
    image: '/assets/images/kettlebell_walk_1780473796598.png', // Athletic kettlebell / morning run vibe
    maxParticipants: 30,
    participantsCount: 14,
    telegramBotUrl: 'https://t.me/campsflint_bot',
    priceType: 'free',
    priceLabel: 'Бесплатно / Соратники',
    entryThreshold: 'Любой пол • Готовность двигаться',
    needsOnboarding: false
  },
  {
    id: 'movie-club-june',
    title: 'Экзистенциальный киноклуб FLINT',
    description: 'Разбор легендарных шедевров кинематографа на скрытые смыслы за чашкой горячего травяного чая. Учимся рефлексировать, понимать истинные мотивы героев и избавляться от чужих социальных паттернов.',
    type: 'intellectual',
    date: '2026-06-09',
    dateLabel: '9 июня (Вторник), 19:30',
    time: 'Вторник в 19:30',
    location: 'Лофт «Дом 12», ул. Октябрьская 16',
    locationDetails: 'Зал с проектором и мягкими пуфиками.',
    painPoint: 'Поверхностные светские разговоры, дефицит глубоких интеллектуальных бесед',
    houseQualities: [QUALITIES.roof, QUALITIES.decor],
    image: '/assets/images/existential_cinema_1780473811493.png', // Dark Cinema theatre
    maxParticipants: 15,
    participantsCount: 12,
    telegramBotUrl: 'https://t.me/campsflint_bot',
    priceType: 'conscience',
    priceLabel: 'На совесть (угощение на стол)',
    entryThreshold: '100% Трезвость • Уважение при обсуждении мнений',
    needsOnboarding: true
  },
  {
    id: 'reader-club-june',
    title: 'Читательский клуб «Смыслы»',
    description: 'Обсуждение заранее прочитанных философских трудов и сильной литературы. Развиваем критическое мышление, обмениваемся практическими инсайтами о жизни и личном росте.',
    type: 'intellectual',
    date: '2026-06-11',
    dateLabel: '11 июня (Четверг), 19:15',
    time: 'Четверг в 19:15',
    location: 'Чарли Коворкинг, ул. Козлова 3',
    locationDetails: 'Камерная переговорная с книжной полкой.',
    painPoint: 'Умственный застой, клиповое мышление, отсутствие пищи для ума',
    houseQualities: [QUALITIES.roof, QUALITIES.foundation],
    image: '/assets/images/reading_smysly_1780473826786.png', // Candlelit books
    maxParticipants: 12,
    participantsCount: 9,
    telegramBotUrl: 'https://t.me/campsflint_bot',
    priceType: 'conscience',
    priceLabel: 'На совесть (вкусняшка к чаю)',
    entryThreshold: 'Обязательное прочтение согласованных глав',
    needsOnboarding: false
  },
  {
    id: 'forest-hike-camp',
    title: 'Лесной поход к берегам Ислочи',
    description: 'Пеший трекинг по глухим живописным тропам Налибокской пущи. Завершается сытным ужином у костра, завариванием ароматных лесных трав в котелке и искренними песнями под акустическую гитару.',
    type: 'active',
    date: '2026-06-14',
    dateLabel: '14 июня (Воскресенье)',
    time: 'Воскресенье, 10:00 - 21:00',
    location: 'Налибокская пуща, берег р. Ислочь',
    locationDetails: 'Координаты места сбора трансфера высылаются за сутки.',
    painPoint: 'Офисное выгорание, гиподинамия, шум бетонного Минска в голове',
    houseQualities: [QUALITIES.life, QUALITIES.heat],
    image: '/assets/images/forest_hike_isloch_1780473844806.png', // Pine forest camp fire
    maxParticipants: 20,
    participantsCount: 16,
    telegramBotUrl: 'https://t.me/campsflint_bot',
    priceType: 'conscience',
    priceLabel: 'На совесть (доля дров и еды в котел)',
    entryThreshold: 'Удобная обувь • Походная кружка • Чистое сердце',
    needsOnboarding: true
  },
  {
    id: 'orator-laboratory',
    title: 'Клуб ораторского искусства',
    description: 'Практическая лаборатория живого слова. Убираем страх сцены, зажимы связок, учимся убеждать, держать зрительный контакт и дебатировать в безопасном кругу.',
    type: 'intellectual',
    date: '2026-06-16',
    dateLabel: '16 июня (Вторник), 19:00',
    time: 'Вторник, 19:00 - 21:30',
    location: 'Чарли Коворкинг, ул. Козлова 3',
    locationDetails: 'Профессиональный зал со сценой и трибуной.',
    painPoint: 'Дрожащий голос при выступлениях, каша в мыслях, неумение убеждать',
    houseQualities: [QUALITIES.decor, QUALITIES.foundation],
    image: '/assets/images/orator_podium_1780473860957.png', // Lecture spotlight speaker
    maxParticipants: 25,
    participantsCount: 18,
    telegramBotUrl: 'https://t.me/campsflint_bot',
    priceType: 'conscience',
    priceLabel: 'Донейшн по сердцу',
    entryThreshold: 'Готовность выйти на сцену перед кругом',
    needsOnboarding: false
  },
  {
    id: 'poker-flint-night',
    title: 'Экологичный Покер & Обмен опытом',
    description: 'Закрытый вечер спортивного покера БЕЗ алкоголя и сигаретного дыма. Площадка для качественного нетворкинга сильных людей, открытого обмена бизнес-опытом и интеллектуального отдыха.',
    type: 'mixed',
    date: '2026-06-18',
    dateLabel: '18 июня (Четверг), 19:00',
    time: 'Четверг, 19:00 - 23:30',
    location: 'Усадьба «У истока», п. Ратомка',
    locationDetails: 'Каминный зал усадьбы, ароматный закарпатский чай на травах.',
    painPoint: 'Одиночество на вершине бизнеса, дефицит сильных сторонников с чистыми целями',
    houseQualities: [QUALITIES.foundation, QUALITIES.heat],
    image: '/assets/images/poker_no_smoke_1780473876261.png', // Chips wooden table poker
    maxParticipants: 10,
    participantsCount: 9,
    telegramBotUrl: 'https://t.me/campsflint_bot',
    priceType: 'paid',
    priceLabel: '15 BYN (чипсы/организация чая)',
    entryThreshold: 'Прохождение интервью • 100% Трезвость',
    needsOnboarding: true
  },
  {
    id: 'conscious-fasting',
    title: 'Осознанное голодание «Путь чистоты»',
    description: 'Глубокий телесный и душевный детокс-практикум в загородной тишине. Программа включает мягкое вхождение в осознанный отказ от пищи на период от 2 до 4 дней (по индивидуальному отклику и состоянию здоровья), дыхательные практики цигун, утренние бережные медитации у воды, лесные пешие прогулки в молчании и вечерние круги искренней поддержки.',
    type: 'active',
    date: '2026-06-22',
    dateLabel: '22–25 июня (Понедельник - Четверг)',
    time: '2–4 дня глубинного очищения',
    location: 'Загородная усадьба, пос. Ратомка',
    locationDetails: 'Каминный зал, уединенная территория в окружении вековых сосен.',
    painPoint: 'Телесная зашлакованность, замутненный фокус ума, эмоциональное выгорание, пищевая зависимость',
    houseQualities: [QUALITIES.wall, QUALITIES.foundation, QUALITIES.life],
    image: 'https://images.unsplash.com/photo-1545205597-3d9d02c29597?q=80&w=800',
    maxParticipants: 10,
    participantsCount: 5,
    telegramBotUrl: 'https://t.me/campsflint_bot',
    priceType: 'conscience',
    priceLabel: 'На совесть / Солидарный взнос за аренду усадьбы',
    entryThreshold: '100% Трезвость • Прохождение анкеты здоровья • Твердое намерение',
    needsOnboarding: true
  },
  {
    id: 'isloch-challenges-male',
    title: 'Мужские вызовы на Ислочи',
    description: 'Грандиозный 3-дневный лесной кемпинг-вызов. Мужское братство, возведение временного лесного штаба, суровые физические испытания на силу и ловкость, баня на берегу бурлящей реки.',
    type: 'male',
    date: '2026-06-26',
    dateLabel: '26–28 июня (Пятница - Воскресенье)',
    time: '3 дня автономного лесного пребывания',
    location: 'Пойма реки Ислочь (дикие леса)',
    locationDetails: 'Дикая стоянка без связи в глуши Налибокской пущи.',
    painPoint: 'Изнеженность комфортом городов, застой мужской энергии, жажда сильного испытания',
    houseQualities: [QUALITIES.foundation, QUALITIES.wall],
    image: '/assets/images/male_isloch_camp_1780473892239.png', // Cinematic camping tents in dark forest
    maxParticipants: 20,
    participantsCount: 14,
    telegramBotUrl: 'https://t.me/campsflint_bot',
    priceType: 'paid',
    priceLabel: '120 BYN (закупка провизии и общих тентов)',
    entryThreshold: 'Полная готовность к лишениям • Готовность рубить дрова на совесть',
    needsOnboarding: true
  },
  {
    id: 'braslav-family-camp',
    title: 'Семейный кемпинг «Браслав Тепло»',
    description: 'Масштабный развивающий выезд на Браславские озера для всей семьи. Творческие мастерские на свежем воздухе, совместный походный быт на островах, психологические круги семейного сближения и детская школа туризма.',
    type: 'mixed',
    date: '2026-07-03',
    dateLabel: '3–5 июля (Выходные)',
    time: 'Пятница 12:00 – Воскресенье 20:00',
    location: 'Браславские озёра, полуостров Пантелеевский',
    locationDetails: 'Оборудованная стоянка национального парка, деревянные навесы.',
    painPoint: 'Потеря контакта с супругом, дети залипли в гаджетах, нехватка душевного тепла',
    houseQualities: [QUALITIES.heat, QUALITIES.life],
    image: '/assets/images/braslav_family_sunset_1780473908072.png', // Mist over water lakeside camp
    maxParticipants: 40,
    participantsCount: 22,
    telegramBotUrl: 'https://t.me/campsflint_bot',
    priceType: 'paid',
    priceLabel: '150 BYN с семьи (эко-сборы и общее обустройство)',
    entryThreshold: 'Семейные ценности • Проведение времени без деструктивных привычек',
    needsOnboarding: true
  },

  // === АНОНСЫ «ПОД ЗАМОЧКОМ» — набор ещё не открыт, даты определяются ===
  {
    id: 'kayak-zen-july',
    title: 'Дзен-сплав на каяках (рассвет)',
    description: 'Медитативный сплав по зеркальной глади реки на рассвете. Полная тишина, гребля в такт командного весла и слияние с естественными биоритмами воды. Точные даты и стоимость аренды каяков определяются — набор откроется в ближайшее время.',
    type: 'active',
    date: '2026-07-18',
    dateLabel: 'Июль 2026 • даты уточняются',
    time: 'Ранний рассвет, ~05:00',
    location: 'Река Ислочь (маршрут уточняется)',
    locationDetails: 'Точка старта трансфера будет объявлена при открытии набора.',
    painPoint: 'Перегрузка ума, хроническая спешка, отрыв от природы',
    houseQualities: [QUALITIES.life, QUALITIES.wall],
    image: 'https://images.unsplash.com/photo-1501555088652-021faa106b9b?q=80&w=800',
    maxParticipants: 18,
    participantsCount: 0,
    telegramBotUrl: 'https://t.me/campsflint_bot',
    priceType: 'paid',
    priceLabel: 'Ориентировочно 60 BYN (каяк и жилет)',
    entryThreshold: '100% Трезвость • Спасательный жилет обязателен',
    needsOnboarding: true,
    status: 'locked',
    lockedHint: 'Согласуем даты и трансфер. Открытие набора — скоро.'
  },
  {
    id: 'banya-stars-july',
    title: 'Баня FLINT под звёздами',
    description: 'Мужская перезагрузка под открытым небом на берегу реки. Глубокий пар, ледяная купель и честный разговор у ночного костра под созвездиями. Готовим локацию и уточняем дату — набор откроется, как только всё будет согласовано.',
    type: 'male',
    date: '2026-07-23',
    dateLabel: 'Июль 2026 • даты уточняются',
    time: 'Вечер, ~19:00',
    location: 'Загородная усадьба у воды (уточняется)',
    locationDetails: 'Точный адрес высылается зарегистрированным при открытии набора.',
    painPoint: 'Телесные зажимы, городская суета, дефицит мужского круга',
    houseQualities: [QUALITIES.wall, QUALITIES.foundation],
    image: '/assets/images/nano_banya_flint_1780473778276.png',
    maxParticipants: 12,
    participantsCount: 0,
    telegramBotUrl: 'https://t.me/campsflint_bot',
    priceType: 'conscience',
    priceLabel: 'Аренда делится на всех • при 10+ ≈ 50 ₽/чел',
    entryThreshold: 'Только мужчины • 100% трезвость • личный веник • минимум 10 чел • по желанию — угощение на стол',
    needsOnboarding: true,
    status: 'locked',
    lockedHint: 'Финализируем дату и локацию. Скоро откроем запись.'
  },
  {
    id: 'august-slet-locked',
    title: 'Августовский слёт у воды',
    description: 'Большой выездной слёт на выходных: тёплый чай со специями у огня, акустические live-сессии, психологические круги и совместный походный быт. Программа в разработке — анонс дат и старт набора совсем скоро.',
    type: 'mixed',
    date: '2026-08-28',
    dateLabel: 'Август 2026 • даты уточняются',
    time: '2–3 дня на природе',
    location: 'Браславские озёра (площадка уточняется)',
    locationDetails: 'Оборудованная стоянка нацпарка — детали при открытии набора.',
    painPoint: 'Потеря контакта с близкими, усталость от города, нехватка тепла',
    houseQualities: [QUALITIES.heat, QUALITIES.life],
    image: '/assets/images/braslav_family_sunset_1780473908072.png',
    maxParticipants: 40,
    participantsCount: 0,
    telegramBotUrl: 'https://t.me/campsflint_bot',
    priceType: 'paid',
    priceLabel: 'Ориентировочно 150 BYN с семьи',
    entryThreshold: 'Семейные ценности • Досуг без деструктивных привычек',
    needsOnboarding: true,
    status: 'locked',
    lockedHint: 'Собираем программу. Набор откроется в ближайшее время.'
  },

  // === ARCHIVE / PAST EVENTS (MAY 2026) -> All past events
  {
    id: 'running-clarity-past',
    title: 'Пробег трезвости & Чайный круг',
    description: 'Массовый оздоровительный забег в Минске, направленный на популяризацию трезвого досуга. Дистанции 3км и 5км, затем душевное заваривание чая у костра из термосов.',
    type: 'active',
    date: '2026-05-03',
    dateLabel: '3 мая (Прошедшее)',
    time: '3 мая 2026, Воскресенье 10:00',
    location: 'Дрозды, Минск',
    locationDetails: 'Успешно завершено при участии 34 соратников.',
    painPoint: 'Культ нездорового отдыха в мегаполисе, дефицит живой бодрости',
    houseQualities: [QUALITIES.wall, QUALITIES.life],
    image: 'https://images.unsplash.com/photo-1476480862126-209bfaa8edc8?q=80&w=800',
    participantsCount: 34,
    priceType: 'free',
    priceLabel: 'Бесплатно',
    entryThreshold: 'Трезвость'
  },
  {
    id: 'zen-kayaking-past',
    title: 'Весенний дзен-сплав Ислочь',
    description: 'Осознанный сплав в весенней дымке по капризному руслу Ислочи. Преодоление завалов деревьев, гребля в такт командного весла и полная тишина бытия.',
    type: 'active',
    date: '2026-05-20',
    dateLabel: '20 мая (Прошедшее)',
    time: '20 мая 2026, Среда 09:00',
    location: 'Река Ислочь, Киевец',
    locationDetails: 'Успешно укомплектовано 18 каяков.',
    painPoint: 'Перегрузка ума, синдром хронической спешки',
    houseQualities: [QUALITIES.wall, QUALITIES.life],
    image: 'https://images.unsplash.com/photo-1501555088652-021faa106b9b?q=80&w=800',
    participantsCount: 18,
    priceType: 'paid',
    priceLabel: '60 BYN (каяк и жилет)',
    entryThreshold: 'Спасательный жилет обязателен'
  },
  {
    id: 'quiz-intellect-past',
    title: 'Игры разума: КВИЗ FLINT',
    description: 'Командный интеллектуальный баттл на раскрытие заложенного потенциала ума, эрудиции и скорости логики. Интерактивные раунды в душевной семейной атмосфере.',
    type: 'intellectual',
    date: '2026-05-24',
    dateLabel: '24 мая (Прошедшее)',
    time: '24 мая 2026, Воскресенье 15:00',
    location: 'Лофт «Дом 12», Минск',
    locationDetails: '8 команд сражались за звание интеллектуального стержня.',
    painPoint: 'Интеллектуальная рутина и серые будни',
    houseQualities: [QUALITIES.roof, QUALITIES.decor],
    image: 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?q=80&w=800',
    participantsCount: 42,
    priceType: 'conscience',
    priceLabel: 'На совесть (донейшн на развитие)',
    entryThreshold: '100% Трезвость'
  }
];

/** Возвращает сегодняшнюю дату в формате YYYY-MM-DD. */
export function getToday() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Единая точка вычисления фазы мероприятия (сайт + API/бот). */
export function getEventPhase(event, today = getToday()) {
  if (event.date < today) return 'past';
  if (event.status === 'closed') return 'closed';
  if (event.status === 'locked') return 'locked';
  if (event.maxParticipants && event.participantsCount >= event.maxParticipants) return 'full';
  return 'open';
}

/** Можно ли записаться прямо сейчас. */
export function isRegistrationOpen(event, today = getToday()) {
  return getEventPhase(event, today) === 'open';
}
