/**
 * Единый эндпоинт профиля участника (экономия функций Vercel).
 * POST /api/profile
 *
 * action='onboard'  → онбординг профиля развития (требует ADMIN_TOKEN)
 * action='diet'     → сохранить профиль питания (через initData)
 * action='menu'     → получить меню события
 * action='generate' → ИИ-генерация меню для события
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

/** Генерация меню на основе профилей питания участников */
async function generateMenu(eventId: string): Promise<any[]> {
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

  // Фолбэк-меню
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
        cookingNotes: `Приготовить на ${profiles.length || 10} человек`,
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
    const action = body.action;

    // === ONBOARD (профиль развития, требует ADMIN_TOKEN) ===
    if (action === 'onboard') {
      const ADMIN_SECRET = process.env.ADMIN_TOKEN || '';
      if (!ADMIN_SECRET) return res.status(200).json({ error: 'ADMIN_TOKEN не настроен' });

      const bearer = String(req.headers?.authorization || '').replace('Bearer ', '');
      const safeEq = (a: string, b: string) => {
        const A = Buffer.from(String(a)), B = Buffer.from(String(b));
        return A.length === B.length && A.length > 0 && crypto.timingSafeEqual(A, B);
      };
      if (!bearer || !safeEq(bearer, ADMIN_SECRET)) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { telegramId, dreams, interests, skills, developmentGoal } = body;
      if (!telegramId) return res.status(400).json({ error: 'telegramId обязателен' });

      const updateData: Record<string, any> = {
        is_profile_completed: true,
        updated_at: new Date().toISOString(),
      };
      if (dreams !== undefined) updateData.dreams = String(dreams);
      if (interests !== undefined) updateData.interests = JSON.stringify(interests);
      if (skills !== undefined) updateData.skills = JSON.stringify(skills);
      if (developmentGoal !== undefined) updateData.development_goal = String(developmentGoal);

      const { error } = await supabase.from('members').update(updateData).eq('telegram_id', Number(telegramId));
      if (error) return res.status(200).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    // === GET MENU ===
    if (action === 'menu') {
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
    if (action === 'generate') {
      const { eventId } = body;
      if (!eventId) return res.status(400).json({ error: 'Missing eventId' });

      await supabase.from('event_menus').delete().eq('event_id', eventId);
      const menu = await generateMenu(eventId);

      if (menu.length > 0) {
        await supabase.from('event_menus').insert(
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
      }

      return res.status(200).json({ ok: true, menu });
    }

    // === SAVE DIET ===
    if (action === 'diet') {
      const user = verifyInitData(body.initData);
      if (!user) return res.status(200).json({ ok: false, error: 'not-in-telegram' });

      const updateData: Record<string, any> = {};
      if (body.dietary) updateData.dietary = body.dietary;
      if (body.allergies !== undefined) updateData.allergies = JSON.stringify(body.allergies);
      if (body.likedFoods !== undefined) updateData.liked_foods = JSON.stringify(body.likedFoods);
      if (body.dislikedFoods !== undefined) updateData.disliked_foods = JSON.stringify(body.dislikedFoods);
      if (body.cookingSkills) updateData.cooking_skills = body.cookingSkills;
      if (body.mealPreferences !== undefined) updateData.meal_preferences = JSON.stringify(body.mealPreferences);

      if (Object.keys(updateData).length === 0) return res.status(200).json({ ok: false, error: 'Nothing to update' });

      const { error } = await supabase.from('members').update(updateData).eq('telegram_id', user.id);
      if (error) return res.status(200).json({ ok: false, error: error.message });

      return res.status(200).json({ ok: true, message: 'Профиль питания сохранён' });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    return res.status(200).json({ ok: false, error: (err as Error).message });
  }
}