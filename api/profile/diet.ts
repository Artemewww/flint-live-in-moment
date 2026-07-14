/**
 * Сохранение профиля питания участника.
 * POST /api/profile/diet
 *
 * Принимает: { action: 'save', initData, dietary, allergies, likedFoods,
 *   dislikedFoods, cookingSkills, mealPreferences }
 * Сохраняет в БД: members.dietary, members.allergies, members.liked_foods,
 *   members.disliked_foods, members.cooking_skills, members.meal_preferences
 *
 * Или { action: 'menu', eventId } — получить меню события
 * Или { action: 'generate', eventId } — ИИ-генерация меню
 */

import { createClient } from '@supabase/supabase-js';
import * as crypto from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

function verifyInitData(initData: string): { id: number; username?: string; first_name?: string } | null {
  if (!initData || !BOT_TOKEN) return null;
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');
    const dcs = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    if (crypto.createHmac('sha256', secret).update(dcs).digest('hex') !== hash) return null;
    const u = JSON.parse(params.get('user') || '{}');
    return u && u.id ? u : null;
  } catch {
    return null;
  }
}

/**
 * ИИ-генерация меню для события на основе профилей участников.
 * Вызывается { action: 'generate', eventId }
 */
async function generateMenu(eventId: string): Promise<any[]> {
  // 1. Получаем участников события с их профилями питания
  const { data: registrations } = await supabase
    .from('registrations')
    .select('telegram_id')
    .eq('event_id', eventId)
    .in('status', ['confirmed', 'pending']);

  const ids = (registrations || []).map((r: any) => r.telegram_id).filter(Boolean);
  const profiles: any[] = [];

  if (ids.length > 0) {
    const { data: members } = await supabase
      .from('members')
      .select('telegram_id,first_name,dietary,allergies,liked_foods,disliked_foods,cooking_skills,meal_preferences')
      .in('telegram_id', ids);

    for (const m of members || []) {
      profiles.push({
        name: m.first_name || 'Участник',
        dietary: m.dietary || 'omnivore',
        allergies: m.allergies || [],
        liked: m.liked_foods || [],
        disliked: m.disliked_foods || [],
        cookingSkills: m.cooking_skills || '',
        meals: m.meal_preferences || {},
      });
    }
  }

  // 2. Получаем событие
  const { data: event } = await supabase
    .from('events')
    .select('title, date, date_end, type')
    .eq('id', eventId)
    .maybeSingle();

  const days = event?.date_end
    ? Math.max(1, Math.round(
        (new Date(event.date_end).getTime() - new Date(event.date).getTime()) / 86400000
      ) + 1)
    : 1;

  const mealSummary = {
    total: profiles.length,
    vegan: profiles.filter((p) => p.dietary === 'vegan').length,
    vegetarian: profiles.filter((p) => p.dietary === 'vegetarian').length,
    allergies: [...new Set(profiles.flatMap((p) => p.allergies))],
    dislikedCommon: [...new Set(profiles.flatMap((p) => p.disliked))],
  };

  // 3. Пробуем ИИ-генерацию через /api/ai
  try {
    const aiRes = await fetch(`${process.env.VERCEL_URL || 'http://localhost:3000'}/api/ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: 'generate_menu',
        event: { title: event?.title, days, type: event?.type },
        profiles,
        mealSummary,
      }),
    });
    if (aiRes.ok) {
      const aiData = await aiRes.json();
      if (aiData.menu && Array.isArray(aiData.menu)) return aiData.menu;
    }
  } catch {}

  // 4. Фолбэк: простое меню
  const menu: any[] = [];
  const mealTypes = ['breakfast', 'lunch', 'dinner', 'snack'];
  const fallbackDishes: Record<string, string[]> = {
    breakfast: ['Каша овсяная', 'Бутерброды', 'Яичница', 'Сырники'],
    lunch: ['Суп', 'Гречка с овощами', 'Паста', 'Рис с котлетой'],
    dinner: ['Запеканка', 'Овощное рагу', 'Рыба на углях', 'Мясо гриль'],
    snack: ['Фрукты', 'Орехи', 'Печенье', 'Чай'],
  };

  for (let d = 1; d <= days; d++) {
    for (const mt of mealTypes) {
      const dishes = fallbackDishes[mt] || fallbackDishes.snack;
      const dish = dishes[(d * mealTypes.indexOf(mt)) % dishes.length];
      menu.push({
        eventId,
        day: d,
        mealType: mt,
        dish,
        ingredients: [],
        cookingNotes: `Приготовить на ${profiles.length} человек`,
      });
    }
  }

  return menu;
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};

    // === GET MENU ===
    if (body.action === 'menu') {
      const { eventId } = body;
      if (!eventId) return res.status(400).json({ error: 'Missing eventId' });

      const { data: menu } = await supabase
        .from('event_menus')
        .select('*')
        .eq('event_id', eventId)
        .order('day')
        .order('meal_type');

      return res.status(200).json({ menu: menu || [] });
    }

    // === GENERATE MENU ===
    if (body.action === 'generate') {
      const { eventId } = body;
      if (!eventId) return res.status(400).json({ error: 'Missing eventId' });

      // Удаляем старое меню
      await supabase.from('event_menus').delete().eq('event_id', eventId);

      // Генерируем новое
      const menu = await generateMenu(eventId);

      // Сохраняем в БД
      if (menu.length > 0) {
        const { error } = await supabase.from('event_menus').insert(
          menu.map((item: any) => ({
            event_id: item.eventId || eventId,
            day: item.day || 1,
            meal_type: item.mealType || 'lunch',
            dish: item.dish,
            ingredients: item.ingredients || [],
            cooking_notes: item.cookingNotes || '',
            assigned_to: item.assignedTo || null,
          }))
        );
        if (error) console.error('Menu insert error:', error);
      }

      return res.status(200).json({ ok: true, menu });
    }

    // === SAVE DIETARY PROFILE ===
    const user = verifyInitData(body.initData);
    if (!user) {
      return res.status(200).json({ ok: false, error: 'not-in-telegram' });
    }

    const updateData: Record<string, any> = {};
    if (body.dietary) updateData.dietary = body.dietary;
    if (body.allergies !== undefined) updateData.allergies = JSON.stringify(body.allergies);
    if (body.likedFoods !== undefined) updateData.liked_foods = JSON.stringify(body.likedFoods);
    if (body.dislikedFoods !== undefined) updateData.disliked_foods = JSON.stringify(body.dislikedFoods);
    if (body.cookingSkills) updateData.cooking_skills = body.cookingSkills;
    if (body.mealPreferences !== undefined) updateData.meal_preferences = JSON.stringify(body.mealPreferences);

    if (Object.keys(updateData).length === 0) {
      return res.status(200).json({ ok: false, error: 'Nothing to update' });
    }

    const { error } = await supabase
      .from('members')
      .update(updateData)
      .eq('telegram_id', user.id);

    if (error) {
      return res.status(200).json({ ok: false, error: error.message });
    }

    return res.status(200).json({ ok: true, message: 'Профиль питания сохранён' });
  } catch (err) {
    return res.status(200).json({ ok: false, error: (err as Error).message });
  }
}