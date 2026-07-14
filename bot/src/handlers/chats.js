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
    const botToken = process.env.BOT_TOKEN;
    
    // 1. Создаём группу
    const createGroupRes = await fetch(`https://api.telegram.org/bot${botToken}/createChat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: `FLINT: ${eventId}`,
        chat_type: 'group',
      }),
    });

    const groupData = await createGroupRes.json();
    if (!groupData.ok) {
      throw new Error(groupData.description || 'Failed to create group');
    }

    const chatId = groupData.result.id;
    const chatName = groupData.result.title;

    // 2. Создаём invite link
    const inviteLinkRes = await fetch(`https://api.telegram.org/bot${botToken}/createChatInviteLink`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        name: `Приглашение в ${chatName}`,
        member_limit: 50,
        creates_join_request: false,
      }),
    });

    const inviteData = await inviteLinkRes.json();
    if (!inviteData.ok) {
      throw new Error(inviteData.description || 'Failed to create invite link');
    }

    const inviteLink = inviteData.result.invite_link;

    // 3. Сохраняем в БД
    const saveRes = await fetch(`${API_BASE}/api/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create_event_chat',
        eventId,
        chatId: chatId,
        chatType: 'group',
        inviteLink,
      }),
    });

    const saveData = await saveRes.json();

    if (saveData.ok) {
      await ctx.reply(
        '✅ <b>Групповой чат создан!</b>\n\n' +
        `Чат: <b>${chatName}</b>\n` +
        `Ссылка: ${inviteLink}\n\n` +
        'Отправь эту ссылку участникам, чтобы они могли присоединиться.',
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