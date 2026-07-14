const fetch = require('node-fetch');

const API_BASE = process.env.API_BASE || 'https://flint-live-in-moment.vercel.app';

/**
 * Создать групповой чат для мероприятия
 * Только для админов
 */
async function handleCreateChat(ctx, eventId) {
  const telegramId = ctx.from.id;

  // TODO: Проверить, что пользователь — админ/организатор события
  // Пока пропускаем всех

  await ctx.reply('🔄 Создаю групповой чат для мероприятия...');

  try {
    // Создаём чат через Telegram API
    const botToken = process.env.BOT_TOKEN;
    const createChatRes = await fetch(`https://api.telegram.org/bot${botToken}/createChatInviteLink`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: telegramId, // Временно используем ID пользователя, потом заменим на реальный chat_id
        name: `FLINT: ${eventId}`,
        member_limit: 50,
      }),
    });

    const chatData = await createChatRes.json();

    if (!chatData.ok) {
      throw new Error(chatData.description || 'Failed to create chat');
    }

    const inviteLink = chatData.result.invite_link;

    // Сохраняем в БД
    const saveRes = await fetch(`${API_BASE}/api/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create_event_chat',
        eventId,
        chatId: telegramId, // TODO: заменить на реальный chat_id
        chatType: 'group',
        inviteLink,
      }),
    });

    const saveData = await saveRes.json();

    if (saveData.ok) {
      await ctx.reply(
        '✅ <b>Групповой чат создан!</b>\n\n' +
        `Ссылка для приглашения: ${inviteLink}\n\n` +
        'Отправь эту ссылку участникам, чтобы они могли присоединиться к чату.',
        { parse_mode: 'HTML' }
      );
    } else {
      throw new Error(saveData.error || 'Failed to save chat');
    }
  } catch (e) {
    console.error('Create chat error:', e);
    await ctx.reply('❌ Ошибка создания чата. Попробуй позже или обратись к организатору.');
  }
}

module.exports = {
  handleCreateChat,
};