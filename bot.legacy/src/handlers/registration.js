const fetch = require('node-fetch');

// Хранилище состояний регистрации (в продакшене использовать базу данных)
const registrationStates = new Map();

/**
 * Начало регистрации на мероприятие
 */
async function handleRegistration(ctx, eventId) {
  const telegramId = ctx.from.id;
  const username = ctx.from.username || `user_${telegramId}`;
  
  // Получаем информацию о мероприятии
  const apiUrl = process.env.WEB_APP_URL || 'https://flint-live-in-moment.vercel.app';
  const eventsResponse = await fetch(`${apiUrl}/api/events`);
  const eventsData = await eventsResponse.json();
  const event = eventsData.events?.find(e => e.id === eventId);
  
  if (!event) {
    return ctx.editMessageText('❌ Мероприятие не найдено');
  }
  
  // Сохраняем состояние
  registrationStates.set(telegramId, {
    eventId,
    step: 'name',
    data: {}
  });
  
  // Запрашиваем имя
  await ctx.editMessageText(
    `📝 <b>Регистрация на:</b> ${event.title}\n\n` +
    `Шаг 1/5: Введите ваше имя и фамилию:`,
    { parse_mode: 'HTML' }
  );
}

/**
 * Обработка ввода данных регистрации
 */
async function processRegistrationInput(ctx) {
  const telegramId = ctx.from.id;
  const text = ctx.message.text;
  
  const state = registrationStates.get(telegramId);
  if (!state) {
    return ctx.reply('❌ Сессия регистрации истекла. Начните заново через /events');
  }
  
  switch (state.step) {
    case 'name':
      state.data.name = text;
      state.step = 'phone';
      await ctx.reply('Шаг 2/5: Введите номер телефона:');
      break;
      
    case 'phone':
      state.data.phone = text;
      state.step = 'category';
      await ctx.reply(
        'Шаг 3/5: Выберите категорию:',
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '👨 Мужчина', callback_data: 'category_male' }],
              [{ text: '👩 Женщина', callback_data: 'category_female' }]
            ]
          }
        }
      );
      break;
      
    case 'dietary':
      state.data.dietary = text;
      state.step = 'transport';
      await ctx.reply(
        'Шаг 5/5: Есть ли возможность подвезти людей?',
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '✅ Да, могу подвезти', callback_data: 'transport_yes' }],
              [{ text: '❌ Нет', callback_data: 'transport_no' }]
            ]
          }
        }
      );
      break;
      
    case 'confirm':
      // Отправляем заявку
      await submitRegistration(ctx, state);
      registrationStates.delete(telegramId);
      break;
  }
}

/**
 * Отправка регистрации на сервер
 */
async function submitRegistration(ctx, state) {
  const telegramId = ctx.from.id;
  const username = ctx.from.username || `user_${telegramId}`;
  
  try {
    const apiUrl = process.env.WEB_APP_URL || 'https://flint-live-in-moment.vercel.app';
    const response = await fetch(`${apiUrl}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId: state.eventId,
        name: state.data.name,
        telegram: username,
        phone: state.data.phone,
        category: state.data.category,
        dietary: state.data.dietary,
        hasTransport: state.data.hasTransport || false,
        transportDetails: state.data.transportDetails,
        transportSeats: state.data.transportSeats || 0,
        source: 'telegram-bot'
      })
    });
    
    const result = await response.json();
    
    if (result.success) {
      await ctx.reply(
        '✅ <b>Регистрация успешна!</b>\n\n' +
        'Организаторы свяжутся с вами для подтверждения.\n' +
        'Следите за уведомлениями в этом чате.',
        { parse_mode: 'HTML' }
      );

      // Вызываем функцию для расчета взаиморасчетов и отправки сообщений в группу
      const groupId = -1004479912314;
      calculateAndSendMessage(state.eventId, groupId);
    } else {
      throw new Error(result.error || 'Registration failed');
    }
  } catch (error) {
    console.error('Registration error:', error);
    await ctx.reply('❌ Ошибка регистрации. Попробуйте позже или обратитесь к организаторам.');
  }
}

/**
 * Обработка callback-запросов регистрации
 */
async function handleRegistrationCallback(ctx, action, value) {
  const telegramId = ctx.from.id;
  const state = registrationStates.get(telegramId);
  
  if (!state) {
    return ctx.answerCallbackQuery('Сессия истекла. Начните заново.');
  }
  
  switch (action) {
    case 'category':
      state.data.category = value;
      state.step = 'dietary';
      await ctx.editMessageText('Шаг 4/5: Выберите тип питания:', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🍖 Все', callback_data: 'dietary_omnivore' }],
            [{ text: '🥗 Вегетарианец', callback_data: 'dietary_vegetarian' }],
            [{ text: '🥬 Веган', callback_data: 'dietary_vegan' }]
          ]
        }
      });
      break;
      
    case 'dietary':
      state.data.dietary = value;
      state.step = 'transport';
      await ctx.editMessageText(
        'Шаг 5/5: Есть ли возможность подвезти людей?',
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '✅ Да, могу подвезти', callback_data: 'transport_yes' }],
              [{ text: '❌ Нет', callback_data: 'transport_no' }]
            ]
          }
        }
      );
      break;
      
    case 'transport':
      if (value === 'yes') {
        state.data.hasTransport = true;
        state.step = 'transport_details';
        await ctx.editMessageText('Сколько мест в машине? (введите число):');
      } else {
        state.data.hasTransport = false;
        state.step = 'confirm';
        await showConfirmation(ctx, state);
      }
      break;
      
    case 'transport_details':
      state.data.transportSeats = parseInt(value) || 0;
      state.step = 'confirm';
      await showConfirmation(ctx, state);
      break;
  }
  
  await ctx.answerCallbackQuery();
}

/**
 * Показ подтверждения регистрации
 */
async function showConfirmation(ctx, state) {
  const eventId = state.eventId;
  const apiUrl = process.env.WEB_APP_URL || 'https://flint-live-in-moment.vercel.app';
  
  // Получаем название мероприятия
  const eventsResponse = await fetch(`${apiUrl}/api/events`);
  const eventsData = await eventsResponse.json();
  const event = eventsData.events?.find(e => e.id === eventId);
  
  const confirmText = 
    `📋 <b>Подтвердите регистрацию:</b>\n\n` +
    `Мероприятие: <b>${event?.title || 'Неизвестно'}</b>\n` +
    `Имя: ${state.data.name}\n` +
    `Телефон: ${state.data.phone}\n` +
    `Категория: ${state.data.category === 'male' ? 'Мужчина' : 'Женщина'}\n` +
    `Питание: ${state.data.dietary}\n` +
    `Транспорт: ${state.data.hasTransport ? `Да (${state.data.transportSeats} мест)` : 'Нет'}\n\n` +
    `Все верно?`;
  
  await ctx.editMessageText(confirmText, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: '✅ Подтвердить', callback_data: 'confirm_yes' }],
        [{ text: '❌ Отменить', callback_data: 'confirm_no' }]
      ]
    }
  });
}

module.exports = { 
  handleRegistration, 
  processRegistrationInput, 
  handleRegistrationCallback 
};