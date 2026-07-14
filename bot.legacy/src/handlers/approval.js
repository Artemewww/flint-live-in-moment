const fetch = require('node-fetch');

// Хранилище заявок на одобрение
const approvalRequests = new Map();

/**
 * Система одобрения пользователей (3 этапа)
 * Этап 1: Пользователь отправляет заявку
 * Этап 2: Админ проверяет и одобряет/отклоняет
 * Этап 3: Пользователь получает уведомление
 */

/**
 * Начало процесса одобрения
 */
async function startApprovalProcess(ctx) {
  const telegramId = ctx.from.id;
  const username = ctx.from.username || `user_${telegramId}`;
  
  // Проверяем, не отправлял ли уже заявку
  const existingRequest = approvalRequests.get(telegramId);
  if (existingRequest && existingRequest.status === 'pending') {
    return ctx.reply('⏳ Ваша заявка уже на рассмотрении. Ожидайте ответа.');
  }
  
  if (existingRequest && existingRequest.status === 'approved') {
    return ctx.reply('✅ Вы уже одобрены! Используйте /events для просмотра мероприятий.');
  }
  
  // Сохраняем состояние
  approvalRequests.set(telegramId, {
    telegramId,
    username,
    status: 'pending',
    step: 'intro',
    data: {},
    createdAt: new Date().toISOString()
  });
  
  // Приветствие и объяснение процесса
  const introText = 
    `👋 <b>Добро пожаловать в FLINT!</b>\n\n` +
    `Для участия в мероприятиях необходимо пройти одобрение.\n\n` +
    `📋 <b>Процесс одобрения (3 этапа):</b>\n` +
    `1️⃣ Вы отправляете заявку\n` +
    `2️⃣ Админы проверяют (обычно 1-2 дня)\n` +
    `3️⃣ Вы получаете уведомление о решении\n\n` +
    `Давайте начнем! Расскажите немного о себе:\n\n` +
    `Почему вы хотите присоединиться к сообществу FLINT?`;
  
  await ctx.reply(introText, { parse_mode: 'HTML' });
}

/**
 * Обработка ввода на этапе одобрения
 */
async function processApprovalInput(ctx) {
  const telegramId = ctx.from.id;
  const text = ctx.message.text;
  
  const request = approvalRequests.get(telegramId);
  if (!request) {
    return ctx.reply('❌ Сессия истекла. Начните заново через /start');
  }
  
  switch (request.step) {
    case 'intro':
      request.data.motivation = text;
      request.step = 'experience';
      await ctx.reply(
        '2/3: Расскажите о вашем опыте:\n' +
        '- Участвовали ли в подобных мероприятиях?\n' +
        '- Что вам интересно в нашем сообществе?'
      );
      break;
      
    case 'experience':
      request.data.experience = text;
      request.step = 'rules';
      await ctx.reply(
        '3/3: Вы согласны с правилами сообщества?\n\n' +
        '✅ 100% трезвость на мероприятиях\n' +
        '✅ Уважение ко всем участникам\n' +
        '✅ Конфиденциальность (не делитесь информацией о других)\n' +
        '✅ Активное участие в жизни сообщества\n\n' +
        'Напишите "Да" или "Согласен" для подтверждения.'
      );
      break;
      
    case 'rules':
      if (text.toLowerCase().includes('да') || text.toLowerCase().includes('согласен')) {
        request.data.rulesAccepted = true;
        request.step = 'submitted';
        request.status = 'pending';
        
        // Отправляем уведомление админам
        await notifyAdminsAboutApproval(request);
        
        await ctx.reply(
          '✅ <b>Заявка отправлена!</b>\n\n' +
          'Админы проверят вашу заявку в течение 1-2 дней.\n' +
          'Вы получите уведомление о решении.\n\n' +
          'Спасибо за интерес к сообществу! 🔥',
          { parse_mode: 'HTML' }
        );
      } else {
        await ctx.reply('❌ Для продолжения необходимо согласие с правилами. Напишите "Да" или "Согласен".');
      }
      break;
  }
}

/**
 * Уведомление админов о новой заявке
 */
async function notifyAdminsAboutApproval(request) {
  const adminChatId = process.env.ADMIN_CHAT_ID;
  if (!adminChatId) {
    console.log('No ADMIN_CHAT_ID configured');
    return;
  }
  
  const message = 
    `🆕 <b>Новая заявка на одобрение</b>\n\n` +
    `User: @${request.username}\n` +
    `ID: ${request.telegramId}\n` +
    `Дата: ${new Date(request.createdAt).toLocaleString('ru-RU')}\n\n` +
    `<b>Мотивация:</b>\n${request.data.motivation}\n\n` +
    `<b>Опыт:</b>\n${request.data.experience}\n\n` +
    `Согласен с правилами: ${request.data.rulesAccepted ? '✅' : '❌'}\n\n` +
    `Для одобрения: /approve_${request.telegramId}\n` +
    `Для отклонения: /reject_${request.telegramId}`;
  
  // TODO: Отправить сообщение админу
  console.log(`Approval request from ${request.username}:`, message);
}

/**
 * Одобрение пользователя (админская команда)
 */
async function approveUser(ctx, telegramId) {
  const request = approvalRequests.get(telegramId);
  if (!request) {
    return ctx.reply('❌ Заявка не найдена');
  }
  
  request.status = 'approved';
  request.approvedAt = new Date().toISOString();
  
  // Уведомляем пользователя
  try {
    await ctx.telegram.sendMessage(
      telegramId,
      '🎉 <b>Поздравляем!</b>\n\n' +
      'Ваша заявка одобрена! Теперь вы можете:\n' +
      '- Просматривать мероприятия (/events)\n' +
      '- Регистрироваться на события\n' +
      '- Участвовать в жизни сообщества\n\n' +
      'Добро пожаловать в FLINT! 🔥',
      { parse_mode: 'HTML' }
    );
  } catch (error) {
    console.error('Failed to notify user:', error);
  }
  
  await ctx.reply(`✅ Пользователь @${request.username} одобрен`);
}

/**
 * Отклонение пользователя (админская команда)
 */
async function rejectUser(ctx, telegramId, reason = '') {
  const request = approvalRequests.get(telegramId);
  if (!request) {
    return ctx.reply('❌ Заявка не найдена');
  }
  
  request.status = 'rejected';
  request.rejectedAt = new Date().toISOString();
  request.rejectionReason = reason;
  
  // Уведомляем пользователя
  try {
    await ctx.telegram.sendMessage(
      telegramId,
      '😔 <b>Заявка отклонена</b>\n\n' +
      'К сожалению, ваша заявка на участие в сообществе FLINT была отклонена.\n\n' +
      (reason ? `Причина: ${reason}\n\n` : '') +
      'Вы можете подать заявку повторно через 30 дней.',
      { parse_mode: 'HTML' }
    );
  } catch (error) {
    console.error('Failed to notify user:', error);
  }
  
  await ctx.reply(`❌ Пользователь @${request.username} отклонен`);
}

/**
 * Проверка, одобрен ли пользователь
 */
function isUserApproved(telegramId) {
  const request = approvalRequests.get(telegramId);
  return request?.status === 'approved';
}

module.exports = {
  startApprovalProcess,
  processApprovalInput,
  approveUser,
  rejectUser,
  isUserApproved
};