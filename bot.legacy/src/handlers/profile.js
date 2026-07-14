const fetch = require('node-fetch');

// Хранилище профилей (в продакшене - база данных)
const userProfiles = new Map();

/**
 * Обработчик профиля пользователя
 */
async function handleProfile(ctx) {
  const telegramId = ctx.from.id;
  
  try {
    // Получаем данные через API
    const res = await fetch(`${API_BASE}/api/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'get_profile',
        initData: '',
      }),
    });

    const data = await res.json();
    
    if (!data.ok || !data.profile) {
      return ctx.reply('Профиль не найден. Напиши /start для регистрации.');
    }

    const profile = data.profile;
    const username = profile.username || 'нет';
    const firstName = profile.first_name || 'Пользователь';
    
    // Формируем текст профиля
    const profileText = 
      `👤 <b>Мой профиль</b>\n\n` +
      `Имя: ${firstName}\n` +
      `Telegram: @${username}\n` +
      `Телефон: ${profile.phone || 'не указан'}\n` +
      `Статус: ${getStatusLabel(profile.status)}\n\n` +
      `📊 <b>Статистика:</b>\n` +
      `• Баллы: <b>${profile.points || 0}</b> 🏅\n` +
      `• Посетил: ${profile.attended || 0} мероприятий\n` +
      `• Пригласил: ${profile.invited_count || 0}\n\n` +
      `🎖 <b>Уровень:</b> ${getLevelLabel(profile.level)}\n` +
      (profile.achievements && profile.achievements.length > 0 
        ? `\n🏆 <b>Достижения:</b>\n` + profile.achievements.map((a) => `• ${getAchievementLabel(a)}\n`).join('')
        : '');
    
    const buttons = {
      reply_markup: {
        inline_keyboard: [
          [{ text: '📅 Мои мероприятия', callback_data: 'my_events' }],
          [{ text: '🏆 Достижения', callback_data: 'achievements' }],
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

/**
 * Показ достижений
 */
async function handleAchievements(ctx) {
  const telegramId = ctx.from.id;
  const profile = userProfiles.get(telegramId) || { achievements: [] };
  
  const allAchievements = [
    { id: 'first', name: 'Первый шаг', desc: 'Первое мероприятие', icon: '⭐' },
    { id: 'three', name: 'Регулярный', desc: '3 мероприятия', icon: '🔥' },
    { id: 'five', name: 'Активный', desc: '5 мероприятий', icon: '⚡' },
    { id: 'ten', name: 'Ветеран', desc: '10 мероприятий', icon: '🏆' },
    { id: 'all_vectors', name: 'Разносторонний', desc: 'Все 6 векторов', icon: '🎯' },
    { id: 'level5', name: 'Эксперт', desc: 'Достичь 5 уровня', icon: '👑' }
  ];
  
  const unlockedIds = profile.achievements || [];
  
  let message = '🏆 <b>Достижения</b>\n\n';
  
  allAchievements.forEach(ach => {
    const unlocked = unlockedIds.includes(ach.id);
    message += `${unlocked ? '✅' : '⬜'} ${ach.icon} <b>${ach.name}</b>\n`;
    message += `   ${ach.desc}\n\n`;
  });
  
  await ctx.editMessageText(message, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔙 Назад', callback_data: 'profile' }]
      ]
    }
  });
}

/**
 * Показ моих мероприятий
 */
async function handleMyEvents(ctx) {
  const telegramId = ctx.from.id;
  const profile = userProfiles.get(telegramId);
  
  if (!profile || !profile.events || profile.events.length === 0) {
    return ctx.editMessageText(
      '📭 У вас пока нет мероприятий.\n' +
      'Используйте /events чтобы найти интересное событие!',
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📅 К мероприятиям', callback_data: 'events' }],
            [{ text: '🔙 Назад', callback_data: 'profile' }]
          ]
        }
      }
    );
  }
  
  let message = '📅 <b>Мои мероприятия:</b>\n\n';
  
  profile.events.forEach((event, index) => {
    const date = new Date(event.date).toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long'
    });
    
    message += `${index + 1}. <b>${event.title}</b>\n`;
    message += `   📆 ${date}\n`;
    message += `   📍 ${event.location}\n`;
    message += `   Статус: ${event.status === 'confirmed' ? '✅ Подтверждено' : '⏳ Ожидает'}\n\n`;
  });
  
  await ctx.editMessageText(message, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔙 Назад', callback_data: 'profile' }]
      ]
    }
  });
}

/**
 * Обновление профиля после мероприятия
 */
function updateProfileAfterEvent(telegramId, eventId, eventTitle) {
  const profile = userProfiles.get(telegramId) || {
    totalEvents: 0,
    totalAttended: 0,
    points: 0,
    achievements: [],
    events: []
  };
  
  // Проверяем, было ли уже это мероприятие
  const existingEvent = profile.events.find(e => e.id === eventId);
  if (!existingEvent) {
    profile.totalEvents += 1;
    profile.points += 100;
    profile.events.push({
      id: eventId,
      title: eventTitle,
      date: new Date().toISOString(),
      status: 'confirmed'
    });
    
    // Проверяем достижения
    if (profile.totalEvents >= 1 && !profile.achievements.includes('first')) {
      profile.achievements.push('first');
    }
    if (profile.totalEvents >= 3 && !profile.achievements.includes('three')) {
      profile.achievements.push('three');
    }
    if (profile.totalEvents >= 5 && !profile.achievements.includes('five')) {
      profile.achievements.push('five');
    }
    if (profile.totalEvents >= 10 && !profile.achievements.includes('ten')) {
      profile.achievements.push('ten');
    }
    
    userProfiles.set(telegramId, profile);
  }
}

function getStatusLabel(status) {
  const labels = {
    'approved': '✅ Участник',
    'pending_review': '⏳ На рассмотрении',
    'blocked': '❌ Заблокирован',
    'left': '🚪 Вышел'
  };
  return labels[status] || 'Неизвестно';
}

function getLevelLabel(level) {
  const labels = {
    'newbie': '🌱 Новичок',
    'regular': '⭐ Постоянный',
    'core': '🌟 Костяк',
    'legend': '👑 Легенда'
  };
  return labels[level] || '🌱 Новичок';
}

function getAchievementLabel(code) {
  const labels = {
    'first_event': '🎯 Первое мероприятие',
    'regular': '⭐ Постоянный участник (5+)',
    'organizer': '🎬 Организатор',
    'cook': '👨‍🍳 Повар',
    'driver': '🚗 Водитель',
    'photographer': '📸 Фотограф',
    'legend': '👑 Легенда клуба (500+ баллов)'
  };
  return labels[code] || code;
}

module.exports = {
  handleProfile,
  handleAchievements,
  handleMyEvents,
  updateProfileAfterEvent
};
