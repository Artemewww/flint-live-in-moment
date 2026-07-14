const fetch = require('node-fetch');

/**
 * Обработчик просмотра мероприятий
 */
async function handleEvents(ctx) {
  try {
    // Получаем события из API
    const apiUrl = process.env.WEB_APP_URL || 'https://flint-live-in-moment.vercel.app';
    const response = await fetch(`${apiUrl}/api/events`);
    
    if (!response.ok) {
      throw new Error('Failed to fetch events');
    }
    
    const data = await response.json();
    const events = data.events || [];
    
    if (events.length === 0) {
      return ctx.editMessageText('📭 Пока нет запланированных мероприятий. Следите за обновлениями!');
    }
    
    // Формируем список мероприятий
    let message = '📅 <b>Ближайшие мероприятия:</b>\n\n';
    
    events.slice(0, 10).forEach((event, index) => {
      const date = new Date(event.date).toLocaleDateString('ru-RU', { 
        day: 'numeric', 
        month: 'long' 
      });
      
      message += `${index + 1}. <b>${event.title}</b>\n`;
      message += `   📆 ${date} в ${event.time || '19:00'}\n`;
      message += `   📍 ${event.location}\n`;
      message += `   👥 ${event.participantsCount || 0}/${event.maxParticipants || 15}\n`;
      message += `   💰 ${event.priceLabel || 'На совесть'}\n\n`;
    });
    
    message += 'Для регистрации нажмите на мероприятие 👇';
    
    // Кнопки для регистрации
    const buttons = events.slice(0, 10).map(event => ({
      text: `${event.title} (${event.date})`,
      callback_data: `register_${event.id}`
    }));
    
    // Разбиваем на ряды по 1 кнопке
    const keyboard = {
      reply_markup: {
        inline_keyboard: buttons.map(btn => [btn])
      }
    };
    
    await ctx.editMessageText(message, {
      parse_mode: 'HTML',
      ...keyboard
    });
    
  } catch (error) {
    console.error('Error fetching events:', error);
    await ctx.editMessageText('❌ Ошибка загрузки мероприятий. Попробуйте позже.');
  }
}

module.exports = { handleEvents };