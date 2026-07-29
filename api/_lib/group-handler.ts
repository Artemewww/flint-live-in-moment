/**
 * Обработчик групповых чатов: ИИ учится на истории в моменте
 * Автозадачи, подсказки по логистике, закупки, SOS организатору
 */

import { createClient } from '@supabase/supabase-js';
import { analyzeChat, quickAI } from './ai-helpers';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID || '';

function tg(method: string, payload: unknown) {
  return fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => r.json());
}

function esc(s: any): string {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Сохранить сообщение в историю (скользящее окно) */
async function saveMessage(chatId: number, msgId: number, from: any, text: string) {
  await supabase.from('group_messages').upsert({
    chat_id: chatId,
    message_id: msgId,
    telegram_id: from.id,
    username: from.username || null,
    first_name: from.first_name || null,
    text: text.slice(0, 2000),
    created_at: new Date().toISOString(),
  }, { onConflict: 'chat_id,message_id' });
}

/** Получить контекст чата (последние 20 сообщений) */
async function getChatContext(chatId: number): Promise<Array<{text: string; from: string}>> {
  const { data } = await supabase.rpc('get_chat_context', {
    p_chat_id: chatId,
    p_limit: 20,
  });
  
  return (data || []).map((m: any) => ({
    text: m.txt || '',
    from: m.username || m.first_name || `id${m.tg_id}`,
  })).reverse();
}

/** Логировать действие бота */
async function logAction(chatId: number, eventId: string, type: string, trigger: string, response: string, data?: any) {
  await supabase.from('bot_group_actions').insert({
    chat_id: chatId,
    event_id: eventId,
    action_type: type,
    trigger_text: trigger.slice(0, 300),
    response_text: response.slice(0, 500),
    data: data || null,
  });
}

/** Обновить паттерн обучения (что сработало) */
async function updatePattern(type: string, keywords: string[], success: boolean) {
  const { data: existing } = await supabase
    .from('ai_learning_patterns')
    .select('*')
    .eq('pattern_type', type)
    .maybeSingle();

  if (existing) {
    await supabase
      .from('ai_learning_patterns')
      .update({
        success_count: existing.success_count + (success ? 1 : 0),
        fail_count: existing.fail_count + (success ? 0 : 1),
        last_used: new Date().toISOString(),
      })
      .eq('id', existing.id);
  } else {
    await supabase.from('ai_learning_patterns').insert({
      pattern_type: type,
      trigger_keywords: keywords,
      action: type,
      success_count: success ? 1 : 0,
      fail_count: success ? 0 : 1,
      last_used: new Date().toISOString(),
    });
  }
}

/** Обработать сообщение в групповом чате */
export async function handleGroupMessage(msg: any, chatId: number) {
  if (!msg.text || msg.text.startsWith('/')) return; // команды пропускаем
  
  const text = msg.text.trim();
  if (text.length < 5) return; // слишком короткое

  // Сохранить в историю
  await saveMessage(chatId, msg.message_id, msg.from, text);

  // Найти событие для этой группы
  const { data: eventGroup } = await supabase
    .from('event_groups')
    .select('event_id')
    .eq('chat_id', chatId)
    .eq('active', true)
    .maybeSingle();

  if (!eventGroup) return; // группа не привязана к событию

  const eventId = eventGroup.event_id;
  
  // Получить контекст события
  const { data: event } = await supabase
    .from('events')
    .select('*')
    .eq('id', eventId)
    .maybeSingle();

  if (!event) return;

  const eventCtx = `${event.title}, ${event.date}${event.time ? ` ${event.time}` : ''}, ${event.location || '—'}`;

  // Получить историю чата
  const history = await getChatContext(chatId);
  
  // Анализ ИИ: что делать?
  const analysis = await analyzeChat(history, eventCtx);

  switch (analysis.action) {
    case 'create_task': {
      // Кто-то вызвался сделать задачу
      const taskTitle = analysis.data?.task_title || text.slice(0, 100);
      const { data: task } = await supabase
        .from('tasks')
        .insert({
          event_id: eventId,
          title: taskTitle,
          taken_by: msg.from.id,
          taker_name: msg.from.first_name || msg.from.username || '',
          done: false,
        })
        .select('id')
        .single();

      if (task) {
        await tg('sendMessage', {
          chat_id: chatId,
          parse_mode: 'HTML',
          text: `✅ Отлично! Записал задачу:\n<b>${esc(taskTitle)}</b>\n\nБерёт: ${esc(msg.from.first_name || msg.from.username || 'участник')}`,
        });

        await logAction(chatId, eventId, 'task_created', text, taskTitle, { task_id: task.id });
        await updatePattern('task_auto', ['возьму', 'заберу', 'сделаю', 'я'], true);
      }
      break;
    }

    case 'suggest_ride': {
      // Кто-то ищет место или предлагает подвезти
      const { data: rides } = await supabase
        .from('rides')
        .select('driver_name,from_point,seats_total,seats_taken')
        .eq('event_id', eventId)
        .eq('active', true);

      const freeSeats = (rides || []).reduce((sum, r) => sum + Math.max(0, (r.seats_total || 0) - (r.seats_taken || 0)), 0);
      
      if (freeSeats > 0) {
        const list = (rides || [])
          .filter((r: any) => (r.seats_total || 0) > (r.seats_taken || 0))
          .map((r: any) => `• ${r.driver_name} из ${r.from_point} — ${Math.max(0, (r.seats_total || 0) - (r.seats_taken || 0))} мест`)
          .join('\n');

        await tg('sendMessage', {
          chat_id: chatId,
          parse_mode: 'HTML',
          text: `🚗 Есть свободные места:\n\n${list}\n\nПосмотри в боте: Логистика → Машины`,
        });

        await logAction(chatId, eventId, 'ride_suggested', text, list);
        await updatePattern('ride_suggest', ['машина', 'подвезти', 'место'], true);
      }
      break;
    }

    case 'group_shopping': {
      // Предложение закупки
      const title = analysis.data?.shopping_title || 'Закупка';
      await tg('sendMessage', {
        chat_id: chatId,
        parse_mode: 'HTML',
        text: `🛒 <b>${esc(title)}</b>\n\nЗапустить коллективную закупку? Участники выберут категории, я сформирую список, назначим закупщика.\n\nОрганизатор, напиши боту /start_shopping`,
      });

      await logAction(chatId, eventId, 'shopping_proposed', text, title);
      break;
    }

    case 'answer_info': {
      // Вопрос о событии — ИИ отвечает из данных
      const { data: regs } = await supabase
        .from('registrations')
        .select('name,guest_count')
        .eq('event_id', eventId)
        .neq('status', 'cancelled');

      const people = (regs || []).length;
      const guests = (regs || []).reduce((s, r) => s + (r.guest_count || 0), 0);

      const infoCtx =
        `Событие: ${eventCtx}\n` +
        `Участников: ${people} (+${guests} гостей)\n` +
        `Программа: ${((event.program || []) as string[]).slice(0, 5).join(', ') || '—'}`;

      const answer = await quickAI(
        `Вопрос участника: "${text}"\n\nДанные:\n${infoCtx}\n\nОтветь кратко (до 300 символов)`
      );

      if (answer) {
        await tg('sendMessage', {
          chat_id: chatId,
          parse_mode: 'HTML',
          text: `⚡ ${esc(answer)}`,
        });

        await logAction(chatId, eventId, 'info_reply', text, answer);
        await updatePattern('answer_info', ['когда', 'где', 'сколько', 'кто'], true);
      }
      break;
    }

    case 'silent':
    default:
      // Обычная беседа, бот молчит
      await logAction(chatId, eventId, 'silent', text.slice(0, 100), '', { reason: analysis.reason });
      break;
  }
}

/** Добавить группу к событию */
export async function linkGroupToEvent(chatId: number, eventId: string, chatTitle?: string) {
  await supabase.from('event_groups').upsert({
    event_id: eventId,
    chat_id: chatId,
    chat_title: chatTitle || null,
    active: true,
  }, { onConflict: 'chat_id' });
}

// Библиотечный модуль: лежит в api/_lib/, поэтому Vercel НЕ считает его
// serverless-функцией (лимит Hobby — 12). Заглушка-хендлер больше не нужна.

