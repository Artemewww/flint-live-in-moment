const fetch = require('node-fetch');

const API_BASE = process.env.API_BASE || 'https://flint-live-in-moment.vercel.app';

// Состояния диалога
const STEPS = {
  START: 'pref_start',
  ACTIVITIES: 'pref_activities',
  FITNESS: 'pref_fitness',
  MEDICAL: 'pref_medical',
  SLEEP: 'pref_sleep',
  CONFIRM: 'pref_confirm',
};

// Хранилище сессий
const sessions = new Map();

function getSession(telegramId) {
  if (!sessions.has(telegramId)) {
    sessions.set(telegramId, { step: STEPS.START, data: {} });
  }
  return sessions.get(telegramId);
}

function clearSession(telegramId) {
  sessions.delete(telegramId);
}

/** Клавиатура с типами активностей */
function activitiesKeyboard(selected) {
  const activities = [
    { id: 'hiking', label: '🥾 Походы / прогулки' },
    { id: 'workshops', label: '🎨 Мастер-классы / лекции' },
    { id: 'games', label: '🎮 Игры / тимбилдинг' },
    { id: 'sports', label: '⚽ Спорт / активный отдых' },
    { id: 'meditation', label: '🧘 Медитация / йога' },
    { id: 'social', label: '💬 Общение / дискуссии' },
    { id: 'rest', label: '😴 Отдых / расслабление' },
    { id: 'creative', label: '✏️ Творчество / искусство' },
  ];

  const rows = activities.map((a) => {
    const isSelected = selected.includes(a.id);
    return [{
      text: `${isSelected ? '✅' : '⬜'} ${a.label}`,
      callback_data: `activity_toggle_${a.id}`,
    }];
  });

  rows.push([{ text: '✅ Готово', callback_data: 'activity_done' }]);
  rows.push([{ text: '🔙 Отмена', callback_data: 'pref_cancel' }]);

  return { reply_markup: { inline_keyboard: rows } };
}

/** Клавиатура с уровнями подготовки */
function fitnessKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🌱 Начинающий', callback_data: 'fitness_beginner' }],
        [{ text: '💪 Средний', callback_data: 'fitness_medium' }],
        [{ text: '🏆 Продвинутый', callback_data: 'fitness_advanced' }],
        [{ text: '🔙 Назад', callback_data: 'pref_cancel' }],
      ],
    },
  };
}

/** Клавиатура для режима сна */
function sleepKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🌅 Жаворонок (рано встаю)', callback_data: 'sleep_morning' }],
        [{ text: '🦉 Сова (поздно ложусь)', callback_data: 'sleep_night' }],
        [{ text: '⚖️ Средний режим', callback_data: 'sleep_normal' }],
        [{ text: '🔙 Назад', callback_data: 'pref_cancel' }],
      ],
    },
  };
}

/** Сохранить предпочтения через API */
async function savePreferences(telegramId, session) {
  const { data } = session;
  try {
    const res = await fetch(`${API_BASE}/api/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'save_activity_preferences',
        initData: '',
        preferences: {
          activities: data.activities || [],
          sleepSchedule: data.sleepSchedule || {},
        },
        fitnessLevel: data.fitnessLevel || '',
        medicalNotes: data.medicalNotes || '',
      }),
    });
    const result = await res.json();
    return result.ok;
  } catch (e) {
    console.error('Save preferences error:', e);
    return false;
  }
}

/** Начать анкету предпочтений */
async function handlePreferencesStart(ctx) {
  const telegramId = ctx.from.id;
  const session = getSession(telegramId);
  session.step = STEPS.ACTIVITIES;
  session.data = {};

  await ctx.reply(
    '🎯 <b>Твои предпочтения</b>\n\n' +
    'Выбери активности, которые тебе интересны (можно несколько):',
    { parse_mode: 'HTML', ...activitiesKeyboard([]) }
  );
}

/** Обработка выбора активности */
async function handleActivityToggle(ctx, activityId) {
  const telegramId = ctx.from.id;
  const session = getSession(telegramId);
  const activities = session.data.activities || [];

  const idx = activities.indexOf(activityId);
  if (idx >= 0) {
    activities.splice(idx, 1);
  } else {
    activities.push(activityId);
  }
  session.data.activities = activities;

  await ctx.editMessageReplyMarkup(activitiesKeyboard(activities).reply_markup);
}

/** Завершение выбора активностей */
async function handleActivitiesDone(ctx) {
  const telegramId = ctx.from.id;
  const session = getSession(telegramId);
  session.step = STEPS.FITNESS;

  await ctx.editMessageText(
    '💪 <b>Уровень физической подготовки</b>\n\n' +
    'Как ты оцениваешь свою форму?',
    { parse_mode: 'HTML', ...fitnessKeyboard() }
  );
}

/** Обработка уровня подготовки */
async function handleFitnessChoice(ctx, level) {
  const telegramId = ctx.from.id;
  const session = getSession(telegramId);
  session.data.fitnessLevel = level;
  session.step = STEPS.MEDICAL;

  await ctx.editMessageText(
    '🏥 <b>Медицинские особенности</b>\n\n' +
    'Есть ли противопоказания или важные примечания?\n' +
    '(травмы, аллергии, хронические заболевания)\n\n' +
    'Напиши текстом или нажми «Нет»:',
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '✅ Нет противопоказаний', callback_data: 'medical_none' }],
          [{ text: '🔙 Назад', callback_data: 'pref_cancel' }],
        ],
      },
    }
  );
}

/** Обработка медицинских заметок */
async function handleMedicalNotes(ctx, text) {
  const telegramId = ctx.from.id;
  const session = getSession(telegramId);
  session.data.medicalNotes = text;
  session.step = STEPS.SLEEP;

  await ctx.editMessageText(
    '😴 <b>Режим сна</b>\n\n' +
    'Ты жаворонок или сова?',
    { parse_mode: 'HTML', ...sleepKeyboard() }
  );
}

/** Обработка режима сна */
async function handleSleepChoice(ctx, schedule) {
  const telegramId = ctx.from.id;
  const session = getSession(telegramId);
  session.data.sleepSchedule = schedule;

  // Сохраняем
  const ok = await savePreferences(telegramId, session);
  clearSession(telegramId);

  if (ok) {
    await ctx.editMessageText(
      '✅ <b>Предпочтения сохранены!</b>\n\n' +
      'Теперь мы учтём твои интересы и режим при планировании мероприятий.\n\n' +
      'Ты всегда можешь изменить настройки через /preferences',
      { parse_mode: 'HTML' }
    );
  } else {
    await ctx.editMessageText('❌ Ошибка сохранения. Попробуй позже.');
  }
}

/** Отмена */
async function handlePreferencesCancel(ctx) {
  const telegramId = ctx.from.id;
  clearSession(telegramId);
  await ctx.editMessageText('❌ Анкета отменена. Можно начать заново через /preferences');
}

module.exports = {
  handlePreferencesStart,
  handleActivityToggle,
  handleActivitiesDone,
  handleFitnessChoice,
  handleMedicalNotes,
  handleSleepChoice,
  handlePreferencesCancel,
  getSession,
  STEPS,
};