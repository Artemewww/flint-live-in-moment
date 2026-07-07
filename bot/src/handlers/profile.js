const fetch = require('node-fetch');

/**
 * Обработчик профиля пользователя
 */
async function handleProfile(ctx) {
  const telegramId = ctx.from.id;
  const username = ctx.from.username || `user_${telegramId}`;
  
  try {
    // TODO: Получить реальные данные из базы
    // Пока заглушка
    const profileText = 
      `👤 <b>Мой профиль</b>\n\n` +
      `Telegram: @${username}\n` +
      `ID: ${telegramId}\n\n` +
      `📊 <b>Статистика:</b>\n` +
      `Мероприятий посещено: 0\n` +
      `Баллов: 0\n` +
      `Уровень: Новичок\n\n` +
      `🏆 <b>Достижения:</b>\n` +
      `Пока нет достижений. Участвуйте в мероприятиях!`;
    
    const buttons = {
      reply_markup: {
        inline_keyboard: [
          [{ text: '📅 Мои мероприятия', callback_data: 'my_events' }],
          [{ text: '🔙 Назад', callback_data: 'start' }]
        ]
      }
    };
    
    await ctx.editMessageText(profileText, {
      parse_mode: 'HTML',
      ...buttons
    });
    
  } catch (error) {
    console.error('Profile error:', error);
    await ctx.editMessageText('❌ Ошибка загрузки профиля');
  }
}

module.exports = { handleProfile };