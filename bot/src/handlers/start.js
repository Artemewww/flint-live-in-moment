const { handleEvents } = require('./events');

/**
 * Обработчик команды /start
 * Приветствие + главное меню
 */
async function handleStart(ctx) {
  const telegramId = ctx.from.id;
  const username = ctx.from.username || `user_${telegramId}`;
  const firstName = ctx.from.first_name || 'Друг';
  
  // TODO: Сохранить/обновить пользователя в базе
  console.log(`User started: ${telegramId} (@${username})`);
  
  // Приветственное сообщение
  const welcomeText = 
    `🔥 <b>Добро пожаловать в FLINT, ${firstName}!</b>\n\n` +
    `Живое сообщество осознанных людей в Беларуси.\n` +
    `100% чистота. Без алкоголя. Только живое общение.\n\n` +
    `Что будем делать? 👇`;
  
  // Кнопки главного меню
  const menuButtons = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '📅 Ближайшие мероприятия', callback_data: 'events' },
          { text: '👤 Мой профиль', callback_data: 'profile' }
        ],
        [
          { text: '🍽 Анкета питания', callback_data: 'diet_start' },
          { text: '🎯 Предпочтения', callback_data: 'pref_start' }
        ]
      ]
    }
  };
  
  await ctx.reply(welcomeText, {
    parse_mode: 'HTML',
    ...menuButtons
  });
}

module.exports = { handleStart };