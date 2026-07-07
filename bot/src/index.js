require('dotenv').config();
const { Bot } = require('grammy');
const { handleStart } = require('./handlers/start');
const { handleEvents } = require('./handlers/events');
const { handleRegistration } = require('./handlers/registration');
const { handleProfile } = require('./handlers/profile');
const { handleAdmin } = require('./handlers/admin');
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

// Обработка текстовых сообщений
bot.on('message:text', async (ctx) => {
  const text = ctx.message.text;
  
  // Если это не команда, обрабатываем как обычное сообщение
  if (!text.startsWith('/')) {
    // TODO: Обработка состояний (регистрация, опросы и т.д.)
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