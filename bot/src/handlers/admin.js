const fetch = require('node-fetch');

/**
 * Обработчик админских команд
 */
async function handleAdmin(ctx) {
  const telegramId = ctx.from.id;
  
  // TODO: Проверить, является ли пользователь админом
  const isAdmin = telegramId === 123456789; // Заменить на реальный ID
  
  if (!isAdmin) {
    return ctx.answerCallbackQuery('❌ У вас нет прав администратора');
  }
  
  const adminText = 
    `🔐 <b>Админ-панель</b>\n\n` +
    `Выберите действие:`;
  
  const buttons = {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📊 Статистика', callback_data: 'admin_stats' }],
        [{ text: '📣 Рассылка', callback_data: 'admin_broadcast' }],
        [{ text: '👥 Управление пользователями', callback_data: 'admin_users' }],
        [{ text: '🔙 Назад', callback_data: 'start' }]
      ]
    }
  };
  
  await ctx.editMessageText(adminText, {
    parse_mode: 'HTML',
    ...buttons
  });
}

/**
 * Статистика
 */
async function handleAdminStats(ctx) {
  try {
    const apiUrl = process.env.WEB_APP_URL || 'https://flint-live-in-moment.vercel.app';
    
    // Получаем события
    const eventsResponse = await fetch(`${apiUrl}/api/events`);
    const eventsData = await eventsResponse.json();
    const events = eventsData.events || [];
    
    // Получаем регистрации
    const regsResponse = await fetch(`${apiUrl}/api/admin/registrations`, {
      headers: { 'Authorization': `Bearer ${process.env.ADMIN_TOKEN}` }
    });
    const regsData = await regsResponse.json();
    
    const statsText = 
      `📊 <b>Статистика:</b>\n\n` +
      `Всего мероприятий: ${events.length}\n` +
      `Всего заявок: ${regsData.registrations?.length || 0}\n` +
      `Подтверждено: ${regsData.stats?.confirmed || 0}\n` +
      `Ожидает: ${regsData.stats?.pending || 0}\n` +
      `Оплачено: ${regsData.stats?.payments || 0}\n\n` +
      `💰 Собрано: ${regsData.stats?.total_amount || 0} BYN`;
    
    await ctx.editMessageText(statsText, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔙 Назад', callback_data: 'admin' }]
        ]
      }
    });
  } catch (error) {
    console.error('Admin stats error:', error);
    await ctx.editMessageText('❌ Ошибка загрузки статистики');
  }
}

/**
 * Рассылка
 */
async function handleAdminBroadcast(ctx) {
  const broadcastText = 
    `📣 <b>Рассылка</b>\n\n` +
    `Введите сообщение для рассылки всем пользователям:`;
  
  // TODO: Реализовать состояние для рассылки
  await ctx.editMessageText(broadcastText, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔙 Назад', callback_data: 'admin' }]
      ]
    }
  });
}

module.exports = { handleAdmin, handleAdminStats, handleAdminBroadcast };