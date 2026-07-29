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
    // Получить категории с продуктами
    if (action === 'categories') {
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

    // Получить выборы участника
    if (action === 'selections') {
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
    if (action === 'toggle' && req.method === 'POST') {
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

    return res.status(400).json({ error: 'Unknown action. Use: categories, selections, toggle' });
  } catch (err: any) {
    console.error('Food API error:', err);
    return res.status(500).json({ error: err.message });
  }
}