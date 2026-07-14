require('dotenv').config();
const { Bot } = require('grammy');
const { handleStart } = require('./handlers/start');
const { handleEvents } = require('./handlers/events');
const { handleRegistration } = require('./handlers/registration');
const { handleProfile } = require('./handlers/profile');
const { handleAdmin } = require('./handlers/admin');
const { handleDietStart, handleDietaryChoice, handleFoodToggle, handleFoodCategory, handleFoodDone, handleAllergyToggle, handleAllergyDone, handleGuestsCount, handleGuestName, handleGuestDiet, handleGuestAge, handleDietCancel, getSession, STEPS } = require('./handlers/diet');
const { setupNotifications } = require('./notifications');

// Инициализация бота
const bot = new Bot(process.env.BOT_TOKEN);

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