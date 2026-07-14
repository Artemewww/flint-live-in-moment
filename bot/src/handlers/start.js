const { handleEvents } = require('./events');

/**
 * Обработчик команды /start
 * Приветствие + главное меню + сброс контекста
 */
async function handleStart(ctx) {
  const telegramId = ctx.from.id;
  const username = ctx.from.username || `user_${telegramId}`;
  const firstName = ctx.from.first_name || 'Друг';
  
  // Сбрасываем сессию бота (обнуляем контекст)
  const { clearSession } = require('./diet');
  clearSession(telegramId);
  
  // TODO: Сохранить/обновить пользователя в базе
  console.log(`User started: ${telegramId} (@${username})`);
  
  // Приветственное сообщение
  const welcomeText = 
    `🔥 <b>Добро пожаловать во ФЛИНТ, ${firstName}!</b>\n\n` +
    `Живое сообщество осознанных людей.\n` +
    `Трезвые приключения. Живое общение.\n\n` +
    `Что будем делать? 👇`;
  
  // Кнопки главного меню (4 основных раздела)
  const menuButtons = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🏠 Афиша', callback_data: 'events' },
          { text: '📅 Мои события', callback_data: 'my_events' }
        ],
        [
          { text: '👤 Профиль', callback_data: 'profile' },
          { text: '❓ Помощь', callback_data: 'help' }
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