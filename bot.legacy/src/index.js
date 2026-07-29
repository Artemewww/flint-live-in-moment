require('dotenv').config();
const { Bot } = require('grammy');

// Функция для отправки сообщений в группу
function sendMessageToGroup(chatId, message) {
  bot.sendMessage(chatId, message)
    .then(() => console.log(`Сообщение успешно отправлено в группу ${chatId}`))
    .catch(err => console.error(`Ошибка при отправке сообщения в группу ${chatId}:`, err));
}
const { handleStart } = require('./handlers/start');
const { handleEvents } = require('./handlers/events');
const { handleRegistration } = require('./handlers/registration');
const { handleProfile } = require('./handlers/profile');
const { handleAdmin } = require('./handlers/admin');
const { handleDietStart, handleDietaryChoice, handleFoodToggle, handleFoodCategory, handleFoodDone, handleAllergyToggle, handleAllergyDone, handleGuestsCount, handleGuestName, handleGuestDiet, handleGuestAge, handleDietCancel, getSession, STEPS } = require('./handlers/diet');
const { handlePreferencesStart, handleActivityToggle, handleActivitiesDone, handleFitnessChoice, handleMedicalNotes, handleSleepChoice, handlePreferencesCancel, getSession: getPrefSession, STEPS: PREF_STEPS } = require('./handlers/preferences');
const { handleRolesStart, handleRoleToggle, handleRoleSave, handleRoleCancel, getSession: getRoleSession } = require('./handlers/roles');
const { handleCreateChat } = require('./handlers/chats');
const { setupNotifications } = require('./notifications');

// Инициализация бота
const bot = new Bot(process.env.BOT_TOKEN);

// Функция для расчета взаиморасчетов и отправки сообщений в группу
async function calculateAndSendMessage(eventId, groupId) {
  // Пример данных для расчета взаиморасчетов
  const participants = [
    { name: 'Лиза', paid: 74, debt: 34.25 },
    { name: 'Александр', paid: 63, refund: 28.75 },
    { name: 'Артём', debt: 34.25 },
    { name: 'Андрей', debt: 34.25 }
  ];

  const category1 = {
    name: 'Общая еда',
    total: 137,
    participants: participants.slice(0, 4)
  };

  const category2 = {
    name: 'Оплата Алексею',
    total: 75,
    participants: [
      { name: 'Лиза', debt: 25 },
      { name: 'Андрей', debt: 25 },
      { name: 'Артём', refund: 50 }
    ]
  };

  const summary = `
1. Категория «${category1.name}» (${category1.total} BYN):
   - Лиза: заплатила ${category1.participants[0].paid} BYN, должна вернуть ${category1.participants[0].debt.toFixed(2)} BYN
   - Александр: заплатил ${category1.participants[1].paid} BYN, должен получить ${category1.participants[1].refund.toFixed(2)} BYN
   - Артём: должен заплатить ${category1.participants[2].debt.toFixed(2)} BYN
   - Андрей: должен заплатить ${category1.participants[3].debt.toFixed(2)} BYN

2. Категория «${category2.name}» (${category2.total} BYN):
   - Лиза: должна Артёму ${category2.participants[0].debt.toFixed(2)} BYN
   - Андрей: должен Артёму ${category2.participants[1].debt.toFixed(2)} BYN
   - Артём: должен получить ${category2.participants[2].refund.toFixed(2)} BYN (от Лизы и Андрея)

3. Итоговый взаиморасчет:
   - Лиза: должна получить ${category1.participants[0].refund.toFixed(2)} BYN (общая еда)
   - Лиза: должна Артёму ${category2.participants[0].debt.toFixed(2)} BYN
   - Итого: Лиза должна получить на руки ${(category1.participants[0].refund - category2.participants[0].debt).toFixed(2)} BYN

   - Артём: должен заплатить ${category1.participants[2].debt.toFixed(2)} BYN (общая еда)
   - Артём: должен получить ${category2.participants[2].refund.toFixed(2)} BYN (от Лизы и Андрея)
   - Итого: Артём должен получить на руки ${(category2.participants[2].refund - category1.participants[2].debt).toFixed(2)} BYN

   - Александр: должен получить ${category1.participants[1].refund.toFixed(2)} BYN (общая еда)
   - Итог: Александр должен получить на руки ${category1.participants[1].refund.toFixed(2)} BYN

   - Андрей: должен заплатить ${category1.participants[3].debt.toFixed(2)} BYN (общая еда)
   - Андрей: должен Артёму ${category2.participants[1].debt.toFixed(2)} BYN
   - Итого: Андрей должен отдать ${(category1.participants[3].debt + category2.participants[1].debt).toFixed(2)} BYN

💡 Как перевести деньги проще всего:
Единственный, кто остался в минусе — это Андрей. Сумма его долга (${(category1.participants[3].debt + category2.participants[1].debt).toFixed(2)} BYN) ровно закрывает все выплаты:
Андрей переводит Лизе: ${(category1.participants[0].refund - category2.participants[0].debt).toFixed(2)} BYN
Андрей переводит Артёму: ${(category2.participants[2].refund - category1.participants[2].debt).toFixed(2)} BYN
Андрей переводит Александру: ${category1.participants[1].refund.toFixed(2)} BYN`;

  // Отправляем сообщение в группу
  try {
    await tg('sendMessage', {
      chat_id: groupId,
      parse_mode: 'HTML',
      text: summary
    });
  } catch (err) {
    console.error('Ошибка при отправке сообщения в группу:', err);
  }
}

// Middleware для логирования
bot.use(async (ctx, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  console.log(`${ctx.updateType} ${ctx.from?.username || 'unknown'} - ${ms}ms`);
});

// Middleware для проверки авторизации
bot.use(async (ctx, next) => {
  // Пропускаем команду /start
  if (ctx.message && ctx.message.text === '/start') {
    return next();
  }
  
  // Проверяем, есть ли пользователь в базе
  const telegramId = ctx.from?.id;
  if (!telegramId) {
    return ctx.reply('Ошибка авторизации. Попробуйте /start');
  }
  
  // TODO: Проверить в базе, что пользователь одобрен
  // Пока пропускаем всех
  await next();
});

// Команды
bot.command('start', handleStart);
bot.command('events', handleEvents);
bot.command('profile', handleProfile);
bot.command('diet', handleDietStart);
bot.command('preferences', handlePreferencesStart);
bot.command('help', (ctx) => {
  ctx.reply(
    '🤖 <b>FLINT Bot - Команды:</b>\n\n' +
    '/start - Главное меню\n' +
    '/events - Ближайшие мероприятия\n' +
    '/profile - Мой профиль\n' +
    '/help - Помощь\n\n' +
    'Или используйте кнопки меню 👇',
    { parse_mode: 'HTML' }
  );
});

// Callback query handlers
bot.callbackQuery('events', handleEvents);
bot.callbackQuery('profile', handleProfile);
bot.callbackQuery('register_', handleRegistration);
bot.callbackQuery('admin', handleAdmin);

// Мои события (сброс контекста)
bot.callbackQuery('my_events', async (ctx) => {
  const { clearSession } = require('./handlers/diet');
  clearSession(ctx.from.id);
  await ctx.editMessageText('📅 <b>Мои события</b>\n\nФункция в разработке. Скоро здесь будут твои регистрации.', { parse_mode: 'HTML' });
});

// Показ меню события
bot.callbackQuery(/^menu_(\d+)$/, async (ctx) => {
  const match = ctx.callbackQuery.data.match(/^menu_(\d+)$/);
  if (!match) return;
  const eventId = match[1];
  await ctx.editMessageText('📋 Загружаю меню...');
  
  try {
    const res = await fetch(`${API_BASE}/api/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'menu', eventId }),
    });
    const data = await res.json();
    const menu = data.menu || [];
    
    if (menu.length === 0) {
      await ctx.editMessageText('Меню ещё не составлено. Организатор должен сгенерировать его в админке.');
      return;
    }
    
    const days = [...new Set(menu.map(m => m.day))].sort();
    let msg = '🍽 <b>Меню мероприятия</b>\n\n';
    
    for (const day of days) {
      msg += `<b>День ${day}</b>\n`;
      const dayItems = menu.filter(m => m.day === day);
      for (const item of dayItems) {
        const mealLabels = { breakfast: 'Завтрак', lunch: 'Обед', dinner: 'Ужин', snack: 'Перекус' };
        msg += `${mealLabels[item.meal_type] || item.meal_type}: ${item.dish}\n`;
        if (item.cooking_notes) msg += `   ${item.cooking_notes}\n`;
      }
      msg += '\n';
    }
    
    await ctx.editMessageText(msg, { parse_mode: 'HTML' });
  } catch (e) {
    console.error('Menu error:', e);
    await ctx.editMessageText('❌ Ошибка загрузки меню');
  }
});

// Роли участников
bot.callbackQuery(/^roles_start_(.+)$/, async (ctx) => {
  const match = ctx.callbackQuery.data.match(/^roles_start_(.+)$/);
  if (match) await handleRolesStart(ctx, match[1]);
});

// Групповые чаты
bot.callbackQuery(/^create_chat_(.+)$/, async (ctx) => {
  const match = ctx.callbackQuery.data.match(/^create_chat_(.+)$/);
  if (match) await handleCreateChat(ctx, match[1]);
});
bot.callbackQuery(/^role_toggle_(.+)$/, async (ctx) => {
  const match = ctx.callbackQuery.data.match(/^role_toggle_(.+)$/);
  if (match) await handleRoleToggle(ctx, match[1]);
});
bot.callbackQuery('role_save', handleRoleSave);
bot.callbackQuery('role_cancel', handleRoleCancel);

// Анкета предпочтений
bot.callbackQuery('pref_start', handlePreferencesStart);
bot.callbackQuery(/^activity_toggle_(.+)$/, async (ctx) => {
  const match = ctx.callbackQuery.data.match(/^activity_toggle_(.+)$/);
  if (match) await handleActivityToggle(ctx, match[1]);
});
bot.callbackQuery('activity_done', handleActivitiesDone);
bot.callbackQuery(/^fitness_(.+)$/, async (ctx) => {
  const match = ctx.callbackQuery.data.match(/^fitness_(.+)$/);
  if (match) await handleFitnessChoice(ctx, match[1]);
});
bot.callbackQuery('medical_none', (ctx) => handleMedicalNotes(ctx, 'Нет противопоказаний'));
bot.callbackQuery(/^sleep_(.+)$/, async (ctx) => {
  const match = ctx.callbackQuery.data.match(/^sleep_(.+)$/);
  if (match) await handleSleepChoice(ctx, match[1]);
});
bot.callbackQuery('pref_cancel', handlePreferencesCancel);

// Анкета питания
bot.callbackQuery('diet_start', handleDietStart);
bot.callbackQuery('diet_omnivore', (ctx) => handleDietaryChoice(ctx, 'omnivore'));
bot.callbackQuery('diet_vegetarian', (ctx) => handleDietaryChoice(ctx, 'vegetarian'));
bot.callbackQuery('diet_vegan', (ctx) => handleDietaryChoice(ctx, 'vegan'));
bot.callbackQuery('diet_cancel', handleDietCancel);

bot.callbackQuery(/^food_toggle_(\d+)_(\d+)$/, async (ctx) => {
  const match = ctx.callbackQuery.data.match(/^food_toggle_(\d+)_(\d+)$/);
  if (match) await handleFoodToggle(ctx, parseInt(match[1]), parseInt(match[2]));
});
bot.callbackQuery(/^food_cat_(\d+)$/, async (ctx) => {
  const match = ctx.callbackQuery.data.match(/^food_cat_(\d+)$/);
  if (match) await handleFoodCategory(ctx, parseInt(match[1]));
});
bot.callbackQuery('food_done', handleFoodDone);
bot.callbackQuery('food_custom', (ctx) => {
  const session = getSession(ctx.from.id);
  session.step = STEPS.CUSTOM_FOOD;
  ctx.editMessageText('Напиши продукты, которые ты любишь (через запятую):');
});

bot.callbackQuery(/^allergy_toggle_(.+)$/, async (ctx) => {
  const match = ctx.callbackQuery.data.match(/^allergy_toggle_(.+)$/);
  if (match) await handleAllergyToggle(ctx, decodeURIComponent(match[1]));
});
bot.callbackQuery('allergy_custom', (ctx) => {
  const session = getSession(ctx.from.id);
  session.step = STEPS.CUSTOM_FOOD;
  ctx.editMessageText('Напиши свою аллергию или непереносимость:');
});
bot.callbackQuery('allergy_done', handleAllergyDone);

bot.callbackQuery(/^guests_(\d+)$/, async (ctx) => {
  const match = ctx.callbackQuery.data.match(/^guests_(\d+)$/);
  if (match) await handleGuestsCount(ctx, parseInt(match[1]));
});

bot.callbackQuery('guest_child', (ctx) => handleGuestAge(ctx, true));
bot.callbackQuery('guest_adult', (ctx) => handleGuestAge(ctx, false));

// Обработка фото (распознавание чека)
bot.on('message:photo', async (ctx) => {
  const telegramId = ctx.from.id;
  const session = getSession(telegramId);
  
  // Если пользователь в режиме отправки чека
  if (session.step === 'receipt_photo') {
    const photos = ctx.message.photo;
    const best = photos[photos.length - 1]; // самое большое фото
    const file = await ctx.telegram.getFile(best.file_id);
    const imageUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
    
    await ctx.reply('📸 Получил чек. Распознаю...');
    
    try {
      const res = await fetch(`${API_BASE}/api/profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'receipt',
          eventId: session.data.eventId,
          imageUrl,
        }),
      });
      const data = await res.json();
      
      if (data.ok) {
        let msg = `✅ <b>Чек распознан</b>\n\n`;
        msg += `Итого: <b>${data.total} ₽</b>\n`;
        msg += `По ${data.perPerson} ₽ с человека (${data.peopleCount} чел)\n\n`;
        msg += `<b>Позиции:</b>\n`;
        data.items.forEach((item, i) => {
          msg += `${i + 1}. ${item.name} — ${item.price} ₽\n`;
        });
        await ctx.reply(msg, { parse_mode: 'HTML' });
      } else if (data.manual) {
        await ctx.reply('❌ Не удалось распознать чек автоматически.\nНапиши позиции вручную в формате:\nПродукт — цена\nНапример:\nМясо — 500\nОвощи — 300');
        session.step = 'receipt_manual';
      } else {
        await ctx.reply('❌ Ошибка: ' + (data.error || 'неизвестно'));
      }
    } catch (e) {
      console.error('Receipt error:', e);
      await ctx.reply('❌ Ошибка сети. Попробуй позже.');
    }
    clearSession(telegramId);
    return;
  }
  
  // Если не в режиме чека — игнорируем фото
  await ctx.reply('📸 Если хочешь отправить чек, сначала выбери событие и нажми «Отправить чек»');
});

// Обработка текстовых сообщений
bot.on('message:text', async (ctx) => {
  const text = ctx.message.text;
  
  // Если это не команда, обрабатываем как обычное сообщение
  if (!text.startsWith('/')) {
    const telegramId = ctx.from.id;
    const session = getSession(telegramId);
    
    // Состояния анкеты питания
    if (session.step === STEPS.GUEST_NAME) {
      return handleGuestName(ctx, text.trim());
    }
    if (session.step === STEPS.CUSTOM_FOOD) {
      const foods = text.split(',').map(s => s.trim()).filter(Boolean);
      if (foods.length > 0) {
        session.data.customFoods = [...(session.data.customFoods || []), ...foods];
      }
      // Возвращаемся к выбору продуктов или переходим к аллергиям
      if (session.data.categories && session.data.categories.length > 0) {
        session.step = STEPS.LIKED;
        const cat = session.data.categories[session.data.categoryIndex || 0];
        await ctx.reply(
          `Добавил: ${foods.join(', ')}\n\nПродолжай выбирать из категории «${cat?.name || 'продукты'}» или нажми «Готово»:`,
          foodCheckKeyboard(session.data.likedFoods || [], session.data.categoryIndex || 0, session.data.categories)
        );
      } else {
        session.step = STEPS.ALLERGIES;
        await ctx.reply('🥜 Аллергии и непереносимости:', allergiesKeyboard([]));
      }
      return;
    }
    
    // Состояния анкеты предпочтений
    const prefSession = getPrefSession(telegramId);
    if (prefSession.step === PREF_STEPS.MEDICAL) {
      return handleMedicalNotes(ctx, text.trim());
    }
    
    await ctx.reply('Используйте команды или кнопки меню');
  }
});

// Обработка ошибок
bot.catch((err) => {
  console.error('Bot error:', err);
});

// Запуск бота
async function main() {
  console.log('🤖 Starting FLINT bot...');
  
  // Устанавливаем команды меню
  await bot.api.setMyCommands([
    { command: 'start', description: 'Главное меню' },
    { command: 'events', description: 'Ближайшие мероприятия' },
    { command: 'profile', description: 'Мой профиль' },
    { command: 'help', description: 'Помощь' }
  ]);
  
  // Запускаем уведомления
  setupNotifications(bot);
  
  // Запускаем поллинг
  console.log('✅ Bot is running!');
  await bot.start();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});