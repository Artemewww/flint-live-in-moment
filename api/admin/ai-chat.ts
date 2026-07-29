import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

function authorized(req: any): boolean {
  const token = String(req.headers.authorization || '').replace('Bearer ', '');
  return !!(process.env.JWT_SECRET && token === process.env.JWT_SECRET);
}

async function tg(method: string, payload: unknown) {
  if (!BOT_TOKEN) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    return res.json();
  } catch { return null; }
}

/**
 * AI-админ: администратор общается с ботом напрямую в Telegram.
 * Бот через Gemini понимает намерение (создать событие, добавить расход, добавить участника и т.д.)
 * И выполняет действия в БД + задаёт наводящие вопросы.
 */
export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!authorized(req)) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { message, chat_id, event_id } = req.body || {};
    if (!message || !chat_id) return res.status(400).json({ error: 'message and chat_id required' });

    // 1. Получаем контекст события, если указан
    let eventContext = '';
    let eventData: any = null;
    if (event_id) {
      const { data } = await supabase.from('events').select('*').eq('id', event_id).maybeSingle();
      if (data) {
        eventData = data;
        eventContext = `Мероприятие: ${data.title} (${data.date}), участников: ${data.participantsCount}, статус: ${data.status}`;
      }
    }

    // 2. Формируем промпт для Gemini
    const prompt = `Ты — административный AI-ассистент клуба FLINT. Твоя задача — понимать намерения администратора и выполнять действия в базе данных.

Контекст: ${eventContext || 'Нет контекста события'}

Сообщение администратора: "${message}"

Определи намерение и ВЕРНИ ТОЛЬКО JSON:
1. {"intent": "create_event", "fields": {"title": "...", "date": "...", ...}} — создать событие
2. {"intent": "add_expense", "fields": {"event_id": "...", "amount": 0, "description": "...", "category": "..."}} — добавить расход
3. {"intent": "add_participant", "fields": {"event_id": "...", "name": "...", "telegram": "..."}} — добавить участника
4. {"intent": "update_event", "fields": {"event_id": "...", "key": "value"}} — изменить поле события
5. {"intent": "add_purchase", "fields": {"event_id": "...", "item": "...", "qty": 1, "price": 0}} — добавить покупку
6. {"intent": "question", "answer": "наводящий вопрос администратору"} — если не хватает данных
7. {"intent": "unknown", "answer": "вежливый ответ"} — если не удалось определить`;

    const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 500 },
      }),
    });

    const geminiData = await geminiRes.json();
    const responseText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // 3. Парсим JSON из ответа Gemini
    let intent: any;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      intent = jsonMatch ? JSON.parse(jsonMatch[0]) : { intent: 'unknown', answer: 'Не удалось обработать запрос' };
    } catch {
      intent = { intent: 'unknown', answer: 'Ошибка парсинга запроса' };
    }

    // 4. Выполняем действие
    let reply = '';
    switch (intent.intent) {
      case 'create_event': {
        const ev = intent.fields;
        const newId = `event-${Date.now()}`;
        const { error } = await supabase.from('events').insert({
          id: newId,
          title: ev.title || 'Новое событие',
          date: ev.date || new Date().toISOString().slice(0, 10),
          type: ev.type || 'mixed',
          status: 'locked',
          created_at: new Date().toISOString(),
        });
        if (error) {
          reply = `❌ Ошибка создания: ${error.message}`;
        } else {
          reply = `✅ Событие "${ev.title}" создано!\nID: ${newId}\n\nЧто дальше?\n1. Указать формат (офлайн/онлайн/гибрид)\n2. Добавить описание\n3. Установить дату и время\n4. Настроить стоимость`;
        }
        break;
      }

      case 'add_expense': {
        const exp = intent.fields;
        const { error } = await supabase.from('event_expenses').insert({
          event_id: exp.event_id || event_id,
          amount: exp.amount || 0,
          description: exp.description || message,
          category: exp.category || 'other',
          created_at: new Date().toISOString(),
        });
        reply = error ? `❌ Ошибка: ${error.message}` : `✅ Расход "${exp.description}" на ${exp.amount} Br добавлен`;
        break;
      }

      case 'add_participant': {
        const p = intent.fields;
        const { error } = await supabase.from('registrations').insert({
          event_id: p.event_id || event_id,
          name: p.name || 'Новый участник',
          telegram: p.telegram || '@unknown',
          status: 'pending',
          registered_at: new Date().toISOString(),
        });
        reply = error ? `❌ Ошибка: ${error.message}` : `✅ Участник ${p.name} добавлен`;
        break;
      }

      case 'update_event': {
        const f = intent.fields;
        const { error } = await supabase.from('events').update({ [Object.keys(f)[0]]: Object.values(f)[0] }).eq('id', f.event_id || event_id);
        reply = error ? `❌ Ошибка: ${error.message}` : `✅ Событие обновлено`;
        break;
      }

      case 'add_purchase': {
        const pu = intent.fields;
        const { error } = await supabase.from('event_shopping').insert({
          event_id: pu.event_id || event_id,
          item: pu.item || 'покупка',
          quantity: pu.qty || 1,
          price: pu.price || 0,
        });
        reply = error ? `❌ Ошибка: ${error.message}` : `✅ Покупка "${pu.item}" добавлена`;
        break;
      }

      case 'question':
        reply = `🤔 ${intent.answer || 'Уточните, пожалуйста'}`;
        break;

      default:
        reply = intent.answer || 'Не понял запрос. Попробуйте: "создай событие", "добавь расход 50р на еду", "добавь участника Иван"';
    }

    // Отправляем ответ в Telegram
    await tg('sendMessage', {
      chat_id,
      text: reply,
      parse_mode: 'HTML',
    });

    return res.json({ ok: true, reply, intent: intent.intent });
  } catch (err: any) {
    console.error('AI chat error:', err);
    return res.status(500).json({ error: err.message });
  }
}