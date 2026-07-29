import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

function authorized(req: any): boolean {
  const token = String(req.headers.authorization || '').replace('Bearer ', '');
  return !!(process.env.JWT_SECRET && token === process.env.JWT_SECRET);
}

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!authorized(req)) return res.status(401).json({ error: 'Unauthorized' });

  const { action } = req.query || {};

  try {
    // Поиск снаряжения
    if (action === 'search' && req.method === 'GET') {
      const { q, category, telegram_id } = req.query || {};

      let query = supabase.from('member_equipment').select('*');

      if (telegram_id) {
        query = query.eq('telegram_id', Number(telegram_id));
      }
      if (category) {
        query = query.eq('category', category);
      }
      if (q) {
        query = query.ilike('item', `%${q}%`);
      }

      const { data, error } = await query.order('item', { ascending: true }).limit(50);
      if (error) return res.status(500).json({ error: error.message });
      return res.json(data || []);
    }

    // Поиск клубного снаряжения
    if (action === 'search-club' && req.method === 'GET') {
      const { q, category } = req.query || {};

      let query = supabase.from('club_equipment').select('*');

      if (category) {
        query = query.eq('category', category);
      }
      if (q) {
        query = query.ilike('item', `%${q}%`);
      }

      const { data, error } = await query.order('item', { ascending: true }).limit(50);
      if (error) return res.status(500).json({ error: error.message });
      return res.json(data || []);
    }

    // Добавить предмет в личное снаряжение
    if (action === 'add' && req.method === 'POST') {
      const { telegram_id, item, quantity, category } = req.body || {};
      if (!telegram_id || !item) return res.status(400).json({ error: 'telegram_id and item required' });

      const { data, error } = await supabase.from('member_equipment').upsert({
        telegram_id: Number(telegram_id),
        item: item.trim(),
        quantity: quantity || 1,
        category: category || 'other',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'telegram_id,item' });
      if (error) return res.status(500).json({ error: error.message });
      return res.json({ ok: true, data });
    }

    // Передача предмета другому участнику (с подтверждением)
    if (action === 'transfer' && req.method === 'POST') {
      const { equipment_id, from_telegram_id, to_telegram_id, item_name, quantity } = req.body || {};
      if (!equipment_id || !from_telegram_id || !to_telegram_id) {
        return res.status(400).json({ error: 'equipment_id, from_telegram_id, to_telegram_id required' });
      }

      // 1. Создаём запрос на передачу
      const { data: transfer, error: transferError } = await supabase.from('equipment_transfers').insert({
        equipment_id: Number(equipment_id),
        from_telegram_id: Number(from_telegram_id),
        to_telegram_id: Number(to_telegram_id),
        item_name: item_name || '',
        quantity: quantity || 1,
        status: 'pending',
        created_at: new Date().toISOString(),
      }).select().single();

      if (transferError) return res.status(500).json({ error: transferError.message });

      // 2. Отправляем уведомление получателю
      if (process.env.TELEGRAM_BOT_TOKEN) {
        const msg = `📦 Запрос на передачу снаряжения\n\nОт: @${from_telegram_id}\nПредмет: ${item_name || equipment_id}\n\nЧтобы подтвердить, нажми кнопку ниже.`;
        await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: Number(to_telegram_id),
            text: msg,
            reply_markup: {
              inline_keyboard: [[
                { text: '✅ Принял', callback_data: `eq_confirm_${transfer.id}` },
                { text: '❌ Отказ', callback_data: `eq_decline_${transfer.id}` }
              ]]
            }
          }),
        });
      }

      return res.json({ ok: true, transfer_id: transfer.id });
    }

    // Подтверждение/отказ передачи
    if (action === 'confirm-transfer' && req.method === 'POST') {
      const { transfer_id, confirm } = req.body || {};
      if (!transfer_id) return res.status(400).json({ error: 'transfer_id required' });

      const { data: t } = await supabase.from('equipment_transfers').select('*').eq('id', transfer_id).single();

      if (!t) return res.status(404).json({ error: 'Transfer not found' });

      if (confirm) {
        // Передаём предмет: удаляем у старого владельца, добавляем новому
        await supabase.from('member_equipment').delete().eq('id', t.equipment_id).eq('telegram_id', t.from_telegram_id);

        await supabase.from('member_equipment').insert({
          telegram_id: t.to_telegram_id,
          item: t.item_name || 'предмет',
          quantity: t.quantity || 1,
        });

        await supabase.from('equipment_transfers').update({ status: 'confirmed' }).eq('id', transfer_id);
      } else {
        await supabase.from('equipment_transfers').update({ status: 'declined' }).eq('id', transfer_id);
      }

      return res.json({ ok: true, confirmed: confirm });
    }

    // Список неподтверждённых передач (кто у кого на руках)
    if (action === 'pending-transfers') {
      const { data, error } = await supabase
        .from('equipment_transfers')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      if (error) return res.status(500).json({ error: error.message });
      return res.json(data || []);
    }

    // ─── Питание ────────────────────────────────────────────────────────────
    // Раньше это был отдельный api/food.ts, но на Vercel Hobby лимит — 12
    // serverless-функций, и он был исчерпан (деплой падал). Роутер тот же:
    // авторизация и разбор ?action= общие, поэтому питание живёт здесь.

    // Категории с продуктами
    if (action === 'food-categories') {
      const { data: categories, error: catError } = await supabase
        .from('food_categories')
        .select('*')
        .order('sort_order', { ascending: true });
      if (catError) return res.status(500).json({ error: catError.message });

      const { data: products, error: prodError } = await supabase
        .from('food_products')
        .select('*')
        .order('sort_order', { ascending: true });
      if (prodError) return res.status(500).json({ error: prodError.message });

      const result = (categories || []).map((cat: any) => ({
        ...cat,
        products: (products || []).filter((p: any) => p.category_slug === cat.slug),
      }));
      return res.json(result);
    }

    // Выборы участника
    if (action === 'food-selections') {
      const { event_id, telegram_id } = req.query || {};
      if (!event_id || !telegram_id) return res.status(400).json({ error: 'event_id and telegram_id required' });

      const { data, error } = await supabase
        .from('food_selections')
        .select('product_id, quantity, custom_note')
        .eq('event_id', event_id)
        .eq('telegram_id', Number(telegram_id));
      if (error) return res.status(500).json({ error: error.message });
      return res.json(data || []);
    }

    // Переключить выбор продукта
    if (action === 'food-toggle' && req.method === 'POST') {
      const { event_id, telegram_id, product_id, selected } = req.body || {};
      if (!event_id || !telegram_id || !product_id) {
        return res.status(400).json({ error: 'event_id, telegram_id, product_id required' });
      }

      if (selected) {
        const { error } = await supabase.from('food_selections').upsert({
          event_id,
          telegram_id: Number(telegram_id),
          product_id: Number(product_id),
          quantity: 1,
        }, { onConflict: 'event_id,telegram_id,product_id' });
        if (error) return res.status(500).json({ error: error.message });
      } else {
        const { error } = await supabase.from('food_selections')
          .delete()
          .eq('event_id', event_id)
          .eq('telegram_id', Number(telegram_id))
          .eq('product_id', Number(product_id));
        if (error) return res.status(500).json({ error: error.message });
      }
      return res.json({ ok: true });
    }

    return res.status(400).json({
      error: 'Unknown action. Use: search, search-club, add, transfer, confirm-transfer, '
        + 'pending-transfers, food-categories, food-selections, food-toggle',
    });
  } catch (err: any) {
    console.error('Equipment API error:', err);
    return res.status(500).json({ error: err.message });
  }
}