const fetch = require('node-fetch');

// Хранилище уведомлений (в продакшене использовать базу)
const notifications = new Map();

/**
 * Настройка системы уведомлений
 */
function setupNotifications(bot) {
  // Проверяем каждые 5 минут
  setInterval(async () => {
    await checkAndSendNotifications(bot);
  }, 5 * 60 * 1000);
  
  console.log('✅ Notification system started');
}

/**
 * Проверка и отправка уведомлений
 */
async function checkAndSendNotifications(bot) {
  try {
    const apiUrl = process.env.WEB_APP_URL || 'https://flint-live-in-moment.vercel.app';
    
    // Получаем события
    const eventsResponse = await fetch(`${apiUrl}/api/events`);
    const eventsData = await eventsResponse.json();
    const events = eventsData.events || [];
    
    const now = new Date();
    
    for (const event of events) {
      const eventDate = new Date(event.date);
      const daysUntil = Math.ceil((eventDate - now) / (1000 * 60 * 60 * 24));
      
      // Уведомление за 7 дней
      if (daysUntil === 7 && event.notifications?.reminder7d) {
        await sendEventNotification(bot, event, 'Через 7 дней');
      }
      
      // Уведомление за 3 дня
      if (daysUntil === 3 && event.notifications?.reminder3d) {
        await sendEventNotification(bot, event, 'Через 3 дня');
      }
      
      // Уведомление за 1 день
      if (daysUntil === 1 && event.notifications?.reminder1d) {
        await sendEventNotification(bot, event, 'Завтра');
      }
      
      // Уведомление за 3 часа
      if (daysUntil === 0) {
        const eventTime = event.time || '19:00';
        const [eventHours, eventMinutes] = eventTime.split(':').map(Number);
        const eventDateTime = new Date(eventDate);
        eventDateTime.setHours(eventHours, eventMinutes, 0, 0);
        
        const hoursUntil = (eventDateTime - now) / (1000 * 60 * 60);
        
        if (hoursUntil <= 3 && hoursUntil > 2 && event.notifications?.reminder3h) {
          await sendEventNotification(bot, event, 'Через 3 часа');
        }
        
        if (hoursUntil <= 1 && hoursUntil > 0 && event.notifications?.reminder1h) {
          await sendEventNotification(bot, event, 'Через 1 час');
        }
      }
    }
  } catch (error) {
    console.error('Notification check error:', error);
  }
}

/**
 * Отправка уведомления о мероприятии
 */
async function sendEventNotification(bot, event, timeText) {
  try {
    // TODO: Получить список зарегистрированных пользователей из базы
    // Пока заглушка
    const message = 
      `🔔 <b>Напоминание!</b>\n\n` +
      `Мероприятие <b>${event.title}</b> состоится ${timeText}!\n\n` +
      `📆 ${event.date} в ${event.time || '19:00'}\n` +
      `📍 ${event.location}\n\n` +
      `💰 ${event.priceLabel || 'На совесть'}\n\n` +
      `Не забудьте!`;
    
    // TODO: Отправить всем зарегистрированным
    console.log(`Notification for event ${event.id}: ${timeText}`);
    
  } catch (error) {
    console.error('Send notification error:', error);
  }
}

module.exports = { setupNotifications };