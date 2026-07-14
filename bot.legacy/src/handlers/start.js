const fetch = require('node-fetch');
const { setSession } = require('./diet');

const API_BASE = process.env.API_BASE || 'https://flint-live-in-moment.vercel.app';

/**
 * Проверить статус пользователя через API
 */
async function getMemberStatus(telegramId) {
  try {
    const res = await fetch(`${API_BASE}/api/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'get_profile',
        initData: '',
        telegramId: Number(telegramId),
      }),
    });
    const data = await res.json();
    return data.profile?.status || null;
  } catch {
    return null;
  }
}

/**
 * Отправить заявку через API
 */
async function submitApplication(telegramId, username, firstName, refMatch) {
  try {
    await fetch(`${API_BASE}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        telegramId: Number(telegramId),
        username: username || '',
        firstName: firstName || 'Пользователь',
        refCode: refMatch && refMatch.length > 1 ? refMatch[1] : null,
        source: 'telegram',
      }),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Обработчик команды /start
 */
async function handleStart(ctx) {
  const telegramId = ctx.from.id;
  const username = ctx.from.username || '';
  const firstName = ctx.from.first_name || 'Друг';
  
  console.log(`User /start: ${telegramId} (@${username})`);
  
  // Сбрасываем сессию
  setSession(telegramId, {});
  
  // Проверяем статус пользователя
  const status = await getMemberStatus(telegramId);
  
  // Новый пользователь — онбординг
  if (!status) {
    // Есть реферальный код в ссылке?
    const refMatch = ctx.message?.text?.match(/\/start\s+(\w+)/);
    if (refMatch) {
      // Реферальная ссылка — регистрируем и одобряем
      await submitApplication(telegramId, username, firstName, refMatch);
      await ctx.reply(
        `🔥 <b>Добро пожаловать во ФЛИНТ, ${firstName}!</b>\n\n` +
        `Вы перешли по ссылке участника — заявка одобрена!`,
        { parse_mode: 'HTML' }
      );
      return showMainMenu(ctx, firstName);
    } else {
      // Нет реферала — заявка на рассмотрение
      await submitApplication(telegramId, username, firstName, null);
      await ctx.reply(
        `🔥 <b>Добро пожаловать во ФЛИНТ, ${firstName}!</b>\n\n` +
        `Заявка отправлена. Костяк клуба рассмотрит её в ближайшее время.\n\n` +
        `После одобрения все функции станут доступны.`,
        { parse_mode: 'HTML' }
      );
      return;
    }
  }
  
  // На рассмотрении
  if (status === 'pending' || status === 'pending_review') {
    await ctx.reply(
      `⏳ <b>Твоя заявка ещё на рассмотрении.</b>\n\n` +
      `Как только костяк клуба одобрит — я сообщу.`,
      { parse_mode: 'HTML' }
    );
    return;
  }
  
  // Заблокирован
  if (status === 'blocked') {
    await ctx.reply(
      `🚫 <b>Доступ к клубу закрыт.</b>\n\n` +
      `Если хочешь обсудить это — напиши организаторам.`,
      { parse_mode: 'HTML' }
    );
    return;
  }
  
  // Одобрен — главное меню
  return showMainMenu(ctx, firstName);
}

/**
 * Показать главное меню
 */
async function showMainMenu(ctx, name) {
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
  
  await ctx.reply(
    `🔥 <b>С возвращением, ${name}!</b>\n\n` +
    `Трезвые приключения. Живое общение.\n\n` +
    `Что будем делать? 👇`,
    { parse_mode: 'HTML', ...menuButtons }
  );
}

/**
 * Middleware: проверка одобрения пользователя
 */
async function requireApproval(ctx, next) {
  // Команда /start всегда пропускается
  if (ctx.message?.text === '/start') return next();
  
  const telegramId = ctx.from?.id;
  if (!telegramId) return ctx.reply('Ошибка авторизации');
  
  const status = await getMemberStatus(telegramId);
  
  if (!status) {
    return ctx.reply('🤖 Напиши /start чтобы подать заявку в клуб.');
  }
  
  if (status === 'pending' || status === 'pending_review') {
    return ctx.reply(
      '⏳ <b>Заявка на рассмотрении.</b>\n\n' +
      'Как только костяк клуба одобрит — я сообщу.',
      { parse_mode: 'HTML' }
    );
  }
  
  if (status === 'blocked') {
    return ctx.reply(
      '🚫 <b>Доступ закрыт.</b>\n\n' +
      'Напиши организаторам для выяснения причин.',
      { parse_mode: 'HTML' }
    );
  }
  
  // Одобрен — пропускаем
  await next();
}

module.exports = { handleStart, requireApproval };
