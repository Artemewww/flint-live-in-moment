# 🔧 Патч для интеграции новых функций в webhook.ts

## Что нужно добавить

### 1. Импорты в начало файла (после существующих импортов)

```typescript
// ── Новые функции: ИИ-обработка групп, напоминания ──
import { handleGroupMessage } from './group-handler';
import { parseEquipment, parseCoordinates, parseTime } from './ai-helpers';
```

### 2. Обработка групповых чатов (в секции message handler, ПЕРЕД обработкой команд)

Найти:
```typescript
if (msg && msg.text) {
  const text = msg.text.trim();
  const chatId = msg.chat.id;
```

Добавить СРАЗУ ПОСЛЕ:
```typescript
  // Групповые чаты: ИИ-менеджер с обучением в моменте
  if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
    try {
      await handleGroupMessage(msg, chatId);
    } catch (e) {
      console.error('Group handler error:', e);
    }
    return res.status(200).json({ ok: true });
  }
```

### 3. Новые callback-обработчики (в секции callback_query)

Добавить в switch по callback_data (перед default):

```typescript
// Подтверждение техники безопасности
if (data.startsWith('safety_confirm:')) {
  const evId = data.split(':')[1];
  await supabase.from('safety_confirmations').upsert({
    event_id: evId,
    telegram_id: cbq.from.id,
    confirmed_at: new Date().toISOString(),
  }, { onConflict: 'event_id,telegram_id' });
  
  await tg('answerCallbackQuery', { callback_query_id: cbq.id, text: '✅ Подтверждено' });
  await tg('editMessageText', {
    chat_id: cbq.message.chat.id,
    message_id: cbq.message.message_id,
    text: '✅ Ты подтвердил ознакомление с техникой безопасности. Спасибо!',
  });
  return res.status(200).json({ ok: true });
}

// Участие в коллективной закупке
if (data.startsWith('shopping_join:')) {
  const shopId = data.split(':')[1];
  await setSession(cbq.from.id, 'shopping_prefs', { shopId });
  
  const { data: categories } = await supabase.from('food_categories').select('*').order('id');
  const keyboard = (categories || []).map((c: any) => [{
    text: `${c.emoji} ${c.title_ru}`,
    callback_data: `shop_cat:${shopId}:${c.slug}`,
  }]);
  keyboard.push([{ text: '✍️ Написать свободно', callback_data: `shop_free:${shopId}` }]);
  
  await tg('editMessageText', {
    chat_id: cbq.message.chat.id,
    message_id: cbq.message.message_id,
    parse_mode: 'HTML',
    text: '<b>Выбери категории</b> или напиши свободно, что хочешь:\n\n(можешь выбрать несколько)',
    reply_markup: { inline_keyboard: keyboard },
  });
  return res.status(200).json({ ok: true });
}

// Обновить данные о гостях
if (data.startsWith('guests_update:')) {
  const evId = data.split(':')[1];
  await setSession(cbq.from.id, 'guests_count', { evId });
  await tg('sendMessage', {
    chat_id: cbq.message.chat.id,
    text: 'Сколько гостей точно едет? Напиши число.',
  });
  return res.status(200).json({ ok: true });
}

// Указать точку забора
if (data.startsWith('pickup_add:')) {
  const evId = data.split(':')[1];
  await setSession(cbq.from.id, 'pickup_location', { evId });
  await tg('sendMessage', {
    chat_id: cbq.message.chat.id,
    parse_mode: 'HTML',
    text: 'Напиши адрес и время встречи:\n\nПример: <i>ул. Ленина 5, завтра в 9:00</i>\n\nМожешь добавить координаты: <i>53.9045, 27.5615</i>',
  });
  return res.status(200).json({ ok: true });
}
```

### 4. Новые текстовые сессии (в секции text message handlers)

Добавить ПЕРЕД последним фолбэком "Не понял":

```typescript
// Ввод количества гостей
if (sess && sess.state === 'guests_count') {
  const { evId } = sess.context || {};
  const count = parseInt(text, 10);
  if (isNaN(count) || count < 0) {
    await tg('sendMessage', { chat_id: chatId, text: 'Напиши число: сколько гостей едет?' });
    return res.status(200).json({ ok: true });
  }
  
  await setSession(msg.from.id, 'guests_names', { evId, count });
  await tg('sendMessage', {
    chat_id: chatId,
    text: `Отлично, ${count} ${count === 1 ? 'гость' : 'гостей'}. Напиши имена через запятую (или тире, если не хочешь уточнять).`,
  });
  return res.status(200).json({ ok: true });
}

// Имена гостей
if (sess && sess.state === 'guests_names') {
  const { evId, count } = sess.context || {};
  await clearSession(msg.from.id);
  
  const names = text !== '-' ? text.split(/[,\n]/).map(s => s.trim()).filter(Boolean) : [];
  await supabase.from('registrations').update({
    guest_details: { count, names, changed_at: new Date().toISOString() },
  }).eq('event_id', evId).eq('telegram_id', msg.from.id);
  
  await tg('sendMessage', {
    chat_id: chatId,
    parse_mode: 'HTML',
    text: `✅ Записал: <b>${count}</b> ${count === 1 ? 'гость' : 'гостей'}${names.length ? `: ${names.join(', ')}` : ''}`,
  });
  return res.status(200).json({ ok: true });
}

// Точка забора: адрес + время + координаты
if (sess && sess.state === 'pickup_location') {
  const { evId } = sess.context || {};
  await clearSession(msg.from.id);
  
  const coords = parseCoordinates(text);
  const time = parseTime(text);
  const address = text.split('\n')[0].slice(0, 200);
  
  if (!time) {
    await tg('sendMessage', {
      chat_id: chatId,
      text: 'Не нашёл время. Укажи явно: "завтра в 9:00" или "15.07 14:30"',
    });
    return res.status(200).json({ ok: true });
  }
  
  const { data: pickup } = await supabase.from('pickup_points').insert({
    event_id: evId,
    telegram_id: msg.from.id,
    name: msg.from.first_name || msg.from.username || '',
    address,
    lat: coords.lat || null,
    lon: coords.lon || null,
    pickup_time: new Date(time).toISOString(), // упрощённо
    notes: text.includes('\n') ? text.split('\n').slice(1).join(' ') : null,
  }).select('id').single();
  
  if (pickup) {
    await tg('sendMessage', {
      chat_id: chatId,
      parse_mode: 'HTML',
      text: `✅ Точка забора добавлена:\n<b>${esc(address)}</b>\nВремя: ${esc(time)}\n\nВодители увидят в разделе Логистика.`,
    });
  }
  return res.status(200).json({ ok: true });
}

// Свободный ввод снаряжения
if (sess && sess.state === 'equipment_input') {
  await clearSession(msg.from.id);
  
  const items = await parseEquipment(text);
  await supabase.from('member_equipment').upsert(
    items.map(item => ({
      telegram_id: msg.from.id,
      item: item.item,
      quantity: item.qty,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: 'telegram_id,item' }
  );
  
  const list = items.map(i => `• ${i.item} — ${i.qty} шт`).join('\n');
  await tg('sendMessage', {
    chat_id: chatId,
    parse_mode: 'HTML',
    text: `✅ Снаряжение добавлено:\n\n${list}`,
  });
  return res.status(200).json({ ok: true });
}
```

---

## Быстрая интеграция

Если не хочешь вручную патчить:

1. Создай новый файл `api/telegram/webhook-v2.ts`
2. Скопируй весь `webhook.ts` туда
3. Добавь импорты и обработчики из этого патча
4. Переименуй `webhook.ts` → `webhook-old.ts`
5. Переименуй `webhook-v2.ts` → `webhook.ts`

Или просто добавь указанные блоки в существующий webhook.ts в нужные места.

---

## Проверка

После интеграции:
- Групповые сообщения обрабатываются ИИ
- Новые callback работают (техбезопасность, закупки, гости)
- Текстовые сессии для свободного ввода работают

Всё готово! 🚀
