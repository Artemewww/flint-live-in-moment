const fetch = require('node-fetch');

const API_BASE = process.env.API_BASE || 'https://flint-live-in-moment.vercel.app';

// Состояния диалога
const STEPS = {
  START: 'diet_start',
  DIETARY: 'diet_dietary',
  ALLERGIES: 'diet_allergies',
  LIKED: 'diet_liked',
  CUSTOM_FOOD: 'diet_custom',
  GUESTS_COUNT: 'diet_guests_count',
  GUEST_NAME: 'diet_guest_name',
  GUEST_DIET: 'diet_guest_diet',
  GUEST_ALLERGIES: 'diet_guest_allergies',
  GUEST_AGE: 'diet_guest_age',
  CONFIRM: 'diet_confirm',
};

// Хранилище сессий (временное, в БД будет позже)
const sessions = new Map();

function getSession(telegramId) {
  if (!sessions.has(telegramId)) {
    sessions.set(telegramId, { step: STEPS.START, data: {} });
  }
  return sessions.get(telegramId);
}

function clearSession(telegramId) {
  sessions.delete(telegramId);
}

/** Клавиатура с типами питания */
function dietaryKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🥩 Всеядный (омнивор)', callback_data: 'diet_omnivore' }],
        [{ text: '🥦 Вегетарианец', callback_data: 'diet_vegetarian' }],
        [{ text: '🌱 Веган', callback_data: 'diet_vegan' }],
        [{ text: '🔙 Назад', callback_data: 'diet_cancel' }],
      ],
    },
  };
}

/** Клавиатура с чек-листом продуктов */
function foodCheckKeyboard(selected, categoryIndex, categories) {
  const cat = categories[categoryIndex];
  if (!cat) return null;

  const rows = cat.items.map((item, i) => {
    const isSelected = selected.includes(item);
    return [{
      text: `${isSelected ? '✅' : '⬜'} ${item}`,
      callback_data: `food_toggle_${categoryIndex}_${i}`,
    }];
  });

  const navRow = [];
  if (categoryIndex > 0) {
    navRow.push({ text: '⬅️ Назад', callback_data: `food_cat_${categoryIndex - 1}` });
  }
  if (categoryIndex < categories.length - 1) {
    navRow.push({ text: '➡️ Далее', callback_data: `food_cat_${categoryIndex + 1}` });
  } else {
    navRow.push({ text: '✅ Готово', callback_data: 'food_done' });
  }
  rows.push(navRow);
  rows.push([{ text: '✏️ Вписать своё', callback_data: 'food_custom' }]);
  rows.push([{ text: '🔙 Отмена', callback_data: 'diet_cancel' }]);

  return { reply_markup: { inline_keyboard: rows } };
}

/** Клавиатура для аллергий */
function allergiesKeyboard(selected) {
  const common = ['молочные', 'орехи', 'глютен', 'яйца', 'рыба', 'морепродукты', 'соя', 'мед'];
  const rows = common.map((a) => {
    const isSelected = selected.includes(a);
    return [{
      text: `${isSelected ? '✅' : '⬜'} ${a}`,
      callback_data: `allergy_toggle_${a}`,
    }];
  });
  rows.push([{ text: '✏️ Другая аллергия', callback_data: 'allergy_custom' }]);
  rows.push([{ text: '✅ Нет аллергий / Готово', callback_data: 'allergy_done' }]);
  return { reply_markup: { inline_keyboard: rows } };
}

/** Клавиатура для возраста гостя */
function guestAgeKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '👶 Ребёнок', callback_data: 'guest_child' }],
        [{ text: '👤 Взрослый', callback_data: 'guest_adult' }],
      ],
    },
  };
}

/** Сохранить профиль питания через API */
async function saveDietProfile(telegramId, session) {
  const { data } = session;
  try {
    const res = await fetch(`${API_BASE}/api/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'save_diet',
        initData: '', // бот не использует initData
        dietary: data.dietary || 'omnivore',
        allergies: data.allergies || [],
        likedFoods: data.likedFoods || [],
        customFoods: data.customFoods || [],
        guests: data.guests || [],
      }),
    });
    const result = await res.json();
    return result.ok;
  } catch (e) {
    console.error('Save diet error:', e);
    return false;
  }
}

/** Начать анкету питания */
async function handleDietStart(ctx) {
  const telegramId = ctx.from.id;
  const session = getSession(telegramId);
  session.step = STEPS.DIETARY;
  session.data = {};

  await ctx.reply(
    '🍽 <b>Анкета питания</b>\n\n' +
    'Давай подберём меню под твои предпочтения. Начнём с типа питания:',
    { parse_mode: 'HTML', ...dietaryKeyboard() }
  );
}

/** Обработка выбора типа питания */
async function handleDietaryChoice(ctx, dietary) {
  const telegramId = ctx.from.id;
  const session = getSession(telegramId);
  session.data.dietary = dietary;
  session.step = STEPS.LIKED;

  // Загружаем чек-лист продуктов
  try {
    const res = await fetch(`${API_BASE}/api/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'suggest' }),
    });
    const data = await res.json();
    session.data.categories = data.categories || [];
    session.data.categoryIndex = 0;
    session.data.likedFoods = [];
  } catch (e) {
    console.error('Suggest error:', e);
  }

  const cat = session.data.categories?.[0];
  if (cat) {
    await ctx.editMessageText(
      `🍽 <b>Твои предпочтения</b>\n\nВыбери, что ты любишь из категории «${cat.name}» (можно пропустить):`,
      { parse_mode: 'HTML', ...foodCheckKeyboard([], 0, session.data.categories) }
    );
  } else {
    await ctx.editMessageText('Выбери продукты, которые ты любишь (напиши через запятую):');
    session.step = STEPS.CUSTOM_FOOD;
  }
}

/** Обработка выбора продукта из чек-листа */
async function handleFoodToggle(ctx, categoryIndex, itemIndex) {
  const telegramId = ctx.from.id;
  const session = getSession(telegramId);
  const cat = session.data.categories?.[categoryIndex];
  if (!cat || !cat.items[itemIndex]) return;

  const item = cat.items[itemIndex];
  const liked = session.data.likedFoods || [];
  const idx = liked.indexOf(item);
  if (idx >= 0) {
    liked.splice(idx, 1);
  } else {
    liked.push(item);
  }
  session.data.likedFoods = liked;

  await ctx.editMessageReplyMarkup(
    foodCheckKeyboard(liked, categoryIndex, session.data.categories).reply_markup
  );
}

/** Переключение категории */
async function handleFoodCategory(ctx, categoryIndex) {
  const telegramId = ctx.from.id;
  const session = getSession(telegramId);
  session.data.categoryIndex = categoryIndex;
  const cat = session.data.categories?.[categoryIndex];
  if (!cat) return;

  await ctx.editMessageText(
    `Выбери, что ты любишь из категории «${cat.name}»:`,
    foodCheckKeyboard(session.data.likedFoods || [], categoryIndex, session.data.categories)
  );
}

/** Завершение выбора продуктов */
async function handleFoodDone(ctx) {
  const telegramId = ctx.from.id;
  const session = getSession(telegramId);
  session.step = STEPS.ALLERGIES;
  session.data.allergies = [];

  await ctx.editMessageText(
    '🥜 <b>Аллергии и непереносимости</b>\n\n' +
    'Отметь, если у тебя есть аллергия на что-то из списка (или нажми «Готово»):',
    { parse_mode: 'HTML', ...allergiesKeyboard([]) }
  );
}

/** Обработка аллергии */
async function handleAllergyToggle(ctx, allergy) {
  const telegramId = ctx.from.id;
  const session = getSession(telegramId);
  const allergies = session.data.allergies || [];
  const idx = allergies.indexOf(allergy);
  if (idx >= 0) {
    allergies.splice(idx, 1);
  } else {
    allergies.push(allergy);
  }
  session.data.allergies = allergies;

  await ctx.editMessageReplyMarkup(allergiesKeyboard(allergies).reply_markup);
}

/** Завершение аллергий */
async function handleAllergyDone(ctx) {
  const telegramId = ctx.from.id;
  const session = getSession(telegramId);
  session.step = STEPS.GUESTS_COUNT;

  await ctx.editMessageText(
    '👥 <b>Гости</b>\n\n' +
    'Ты едешь с кем-то, кто не зарегистрирован в Telegram?\n' +
    '(дети, муж/жена, друзья без Telegram)\n\n' +
    'Сколько гостей с тобой? (0, если никого)',
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '0 — никого', callback_data: 'guests_0' }],
          [{ text: '1 гость', callback_data: 'guests_1' }],
          [{ text: '2 гостя', callback_data: 'guests_2' }],
          [{ text: '3+', callback_data: 'guests_3' }],
        ],
      },
    }
  );
}

/** Обработка количества гостей */
async function handleGuestsCount(ctx, count) {
  const telegramId = ctx.from.id;
  const session = getSession(telegramId);

  if (count === 0) {
    // Нет гостей — сохраняем
    const ok = await saveDietProfile(telegramId, session);
    clearSession(telegramId);
    if (ok) {
      await ctx.editMessageText(
        '✅ <b>Анкета питания сохранена!</b>\n\n' +
        'Теперь нейронка учтёт твои предпочтения при составлении меню.\n\n' +
        'Ты всегда можешь изменить настройки через /diet',
        { parse_mode: 'HTML' }
      );
    } else {
      await ctx.editMessageText('❌ Ошибка сохранения. Попробуй позже.');
    }
    return;
  }

  session.data.guests = [];
  session.data.guestsRemaining = count;
  session.step = STEPS.GUEST_NAME;

  await ctx.editMessageText(
    `👤 <b>Гость #${session.data.guests.length + 1}</b>\n\nВведите имя гостя:`,
    { parse_mode: 'HTML' }
  );
}

/** Обработка имени гостя (текстовое сообщение) */
async function handleGuestName(ctx, name) {
  const telegramId = ctx.from.id;
  const session = getSession(telegramId);
  if (!session.data.guests) session.data.guests = [];

  session.data.guests.push({ name, dietary: 'omnivore', allergies: [], isChild: false });
  session.step = STEPS.GUEST_DIET;

  await ctx.reply(
    `Тип питания для <b>${name}</b>:`,
    { parse_mode: 'HTML', ...dietaryKeyboard() }
  );
}

/** Обработка диеты гостя */
async function handleGuestDiet(ctx, dietary) {
  const telegramId = ctx.from.id;
  const session = getSession(telegramId);
  const guest = session.data.guests[session.data.guests.length - 1];
  if (guest) guest.dietary = dietary;
  session.step = STEPS.GUEST_AGE;

  await ctx.editMessageText(
    `Возраст гостя <b>${guest?.name}</b>:`,
    { parse_mode: 'HTML', ...guestAgeKeyboard() }
  );
}

/** Обработка возраста гостя */
async function handleGuestAge(ctx, isChild) {
  const telegramId = ctx.from.id;
  const session = getSession(telegramId);
  const guest = session.data.guests[session.data.guests.length - 1];
  if (guest) guest.isChild = isChild;

  session.data.guestsRemaining--;
  if (session.data.guestsRemaining > 0) {
    session.step = STEPS.GUEST_NAME;
    await ctx.editMessageText(
      `👤 <b>Гость #${session.data.guests.length + 1}</b>\n\nВведите имя следующего гостя:`,
      { parse_mode: 'HTML' }
    );
  } else {
    // Все гости заполнены — сохраняем
    const ok = await saveDietProfile(telegramId, session);
    clearSession(telegramId);
    if (ok) {
      await ctx.editMessageText(
        '✅ <b>Анкета питания сохранена!</b>\n\n' +
        `Учтено: ты + ${session.data.guests.length} гость(ей).\n` +
        'Нейронка подберёт меню с учётом всех предпочтений.\n\n' +
        'Ты всегда можешь изменить настройки через /diet',
        { parse_mode: 'HTML' }
      );
    } else {
      await ctx.editMessageText('❌ Ошибка сохранения. Попробуй позже.');
    }
  }
}

/** Отмена */
async function handleDietCancel(ctx) {
  const telegramId = ctx.from.id;
  clearSession(telegramId);
  await ctx.editMessageText('❌ Анкета питания отменена. Можно начать заново через /diet');
}

module.exports = {
  handleDietStart,
  handleDietaryChoice,
  handleFoodToggle,
  handleFoodCategory,
  handleFoodDone,
  handleAllergyToggle,
  handleAllergyDone,
  handleGuestsCount,
  handleGuestName,
  handleGuestDiet,
  handleGuestAge,
  handleDietCancel,
  getSession,
  STEPS,
};