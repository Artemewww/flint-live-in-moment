const fetch = require('node-fetch');

const API_BASE = process.env.API_BASE || 'https://flint-live-in-moment.vercel.app';

// Стандартные роли
const ROLE_TEMPLATES = [
  { id: 'driver', label: '🚗 Водитель', description: 'Поездка на машине, перевозка людей/снаряжения' },
  { id: 'cook', label: '👨‍🍳 Повар', description: 'Приготовление еды на мероприятии' },
  { id: 'first_aid', label: '🏥 Медик', description: 'Первая помощь, аптечка' },
  { id: 'photographer', label: '📸 Фотограф', description: 'Фотосъёмка мероприятия' },
  { id: 'entertainment', label: '🎬 Аниматор', description: 'Ведение программы, игры, активности' },
  { id: 'logistics', label: '📦 Логист', description: 'Организация транспорта, снаряжения' },
  { id: 'cleaner', label: '🧹 Уборщик', description: 'Уборка места проведения' },
  { id: 'custom', label: '✏️ Своя роль', description: 'Указать свою роль' },
];

// Хранилище сессий
const sessions = new Map();

function getSession(telegramId) {
  if (!sessions.has(telegramId)) {
    sessions.set(telegramId, { step: 'roles_start', data: {} });
  }
  return sessions.get(telegramId);
}

function clearSession(telegramId) {
  sessions.delete(telegramId);
}

/** Клавиатура с ролями */
function rolesKeyboard(selectedRoles, eventId) {
  const rows = ROLE_TEMPLATES.map((r) => {
    const isSelected = selectedRoles.includes(r.id);
    return [{
      text: `${isSelected ? '✅' : '⬜'} ${r.label}`,
      callback_data: `role_toggle_${r.id}`,
    }];
  });

  rows.push([{ text: '💾 Сохранить роли', callback_data: 'role_save' }]);
  rows.push([{ text: '🔙 Отмена', callback_data: 'role_cancel' }]);

  return { reply_markup: { inline_keyboard: rows } };
}

/** Загрузить существующие роли */
async function loadRoles(telegramId, eventId) {
  try {
    const res = await fetch(`${API_BASE}/api/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'get_event_roles',
        eventId,
        initData: '',
      }),
    });
    const data = await res.json();
    return data.roles || [];
  } catch (e) {
    console.error('Load roles error:', e);
    return [];
  }
}

/** Сохранить роли */
async function saveRoles(telegramId, eventId, selectedRoles) {
  try {
    // Сначала удаляем все старые роли
    const existing = await loadRoles(telegramId, eventId);
    for (const role of existing) {
      await fetch(`${API_BASE}/api/profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete_event_role',
          eventId,
          role: role.role,
          initData: '',
        }),
      });
    }

    // Сохраняем новые
    for (const roleId of selectedRoles) {
      const template = ROLE_TEMPLATES.find((r) => r.id === roleId);
      await fetch(`${API_BASE}/api/profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_event_role',
          eventId,
          role: roleId,
          customName: template ? template.label : roleId,
          initData: '',
        }),
      });
    }

    return true;
  } catch (e) {
    console.error('Save roles error:', e);
    return false;
  }
}

/** Начать выбор ролей */
async function handleRolesStart(ctx, eventId) {
  const telegramId = ctx.from.id;
  const session = getSession(telegramId);
  session.data.eventId = eventId;
  session.data.selectedRoles = [];

  // Загружаем существующие роли
  const existingRoles = await loadRoles(telegramId, eventId);
  session.data.selectedRoles = existingRoles.map((r) => r.role);

  await ctx.editMessageText(
    '🎭 <b>Выбери роли на мероприятии</b>\n\n' +
    'Можешь выбрать несколько ролей. Что ты готов(а) делать?',
    {
      parse_mode: 'HTML',
      ...rolesKeyboard(session.data.selectedRoles, eventId),
    }
  );
}

/** Переключение роли */
async function handleRoleToggle(ctx, roleId) {
  const telegramId = ctx.from.id;
  const session = getSession(telegramId);
  const selected = session.data.selectedRoles || [];

  const idx = selected.indexOf(roleId);
  if (idx >= 0) {
    selected.splice(idx, 1);
  } else {
    selected.push(roleId);
  }
  session.data.selectedRoles = selected;

  await ctx.editMessageReplyMarkup(
    rolesKeyboard(selected, session.data.eventId).reply_markup
  );
}

/** Сохранить роли */
async function handleRoleSave(ctx) {
  const telegramId = ctx.from.id;
  const session = getSession(telegramId);
  const { eventId, selectedRoles } = session.data;

  if (selectedRoles.length === 0) {
    await ctx.editMessageText('⚠️ Выбери хотя бы одну роль или нажми «Отмена»');
    return;
  }

  const ok = await saveRoles(telegramId, eventId, selectedRoles);
  clearSession(telegramId);

  if (ok) {
    const roleLabels = selectedRoles.map((rId) => {
      const template = ROLE_TEMPLATES.find((r) => r.id === rId);
      return template ? template.label : rId;
    });

    await ctx.editMessageText(
      '✅ <b>Роли сохранены!</b>\n\n' +
      `Твои роли: ${roleLabels.join(', ')}\n\n` +
      'Организатор может назначить тебя на конкретную задачу.',
      { parse_mode: 'HTML' }
    );
  } else {
    await ctx.editMessageText('❌ Ошибка сохранения. Попробуй позже.');
  }
}

/** Отмена */
async function handleRoleCancel(ctx) {
  const telegramId = ctx.from.id;
  clearSession(telegramId);
  await ctx.editMessageText('❌ Выбор ролей отменён');
}

module.exports = {
  ROLE_TEMPLATES,
  handleRolesStart,
  handleRoleToggle,
  handleRoleSave,
  handleRoleCancel,
  getSession,
};