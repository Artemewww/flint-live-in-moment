/**
 * Единый эндпоинт профиля участника (экономия функций Vercel).
 * POST /api/profile
 *
 * action='onboard'   → онбординг профиля развития (требует ADMIN_TOKEN)
 * action='diet'      → сохранить профиль питания (через initData)
 * action='save_diet' → сохранить профиль питания + гости + кастомные продукты
 * action='suggest'   → чек-лист продуктов на выбор
 * action='menu'      → получить меню события
 * action='generate'  → ИИ-генерация меню для события
 * action='receipt'   → распознать чек и разложить расходы
 * action='recipe'    → сгенерировать рецепт для блюда
 * action='rate'      → оценить блюдо
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

// Базовый чек-лист продуктов по категориям
const FOOD_CATEGORIES = [
  { name: 'Мясо и птица', items: ['Курица', 'Говядина', 'Свинина', 'Индейка', 'Фарш', 'Колбаса/сосиски', 'Бекон', 'Печень'] },
  { name: 'Рыба и морепродукты', items: ['Лосось/семга', 'Тунец', 'Треска', 'Скумбрия', 'Креветки', 'Мидии'] },
  { name: 'Овощи и зелень', items: ['Картофель', 'Морковь', 'Лук репчатый', 'Чеснок', 'Помидоры', 'Огурцы', 'Перец болгарский', 'Капуста', 'Кабачки', 'Баклажаны', 'Зелень', 'Салат', 'Шпинат'] },
  { name: 'Фрукты и ягоды', items: ['Яблоки', 'Бананы', 'Апельсины/мандарины', 'Груши', 'Виноград', 'Лимоны', 'Авокадо', 'Ягоды (заморозка)', 'Сухофрукты'] },
  { name: 'Крупы и макароны', items: ['Гречка', 'Рис', 'Макароны/паста', 'Овсянка', 'Перловка', 'Кускус/булгур', 'Чечевица'] },
  { name: 'Молочные продукты', items: ['Молоко', 'Сметана', 'Творог', 'Сыр твердый', 'Сыр плавленый', 'Масло сливочное', 'Йогурт', 'Яйца'] },
  { name: 'Консервы и соусы', items: ['Тушенка', 'Рыбные консервы', 'Кукуруза консерв.', 'Оливки/маслины', 'Кетчуп', 'Майонез', 'Горчица', 'Соевый соус', 'Томатная паста'] },
  { name: 'Бакалея', items: ['Хлеб/лаваш', 'Мука', 'Сахар', 'Соль', 'Масло растительное', 'Специи', 'Мед', 'Орехи', 'Шоколад/сладости', 'Чай', 'Кофе'] },
  { name: 'Напитки', items: ['Вода без газа', 'Компот/морс', 'Сок', 'Квас'] },
];

/** Генерация меню на основе профилей питания участников */
async function generateMenu(eventId: string): Promise<any[]> {
  const { data: registrations } = await supabase
    .from('registrations')
    .select('telegram_id')
    .eq('event_id', eventId)
    .in('status', ['confirmed', 'pending']);

  const ids = (registrations || []).map((r: any) => r.telegram_id).filter(Boolean);
  const profiles: any[] = [];
  let guestCount = 0;
  let guestAllergies: string[] = [];

  if (ids.length > 0) {
    const { data: members } = await supabase
      .from('members')
      .select('telegram_id,first_name,dietary,allergies,liked_foods,disliked_foods,cooking_skills,meal_preferences,guests')
      .in('telegram_id', ids);

    for (const m of members || []) {
      const profile = {
        name: m.first_name || 'Участник',
        dietary: m.dietary || 'omnivore',
        allergies: m.allergies || [],
        liked: m.liked_foods || [],
        disliked: m.disliked_foods || [],
        cookingSkills: m.cooking_skills || '',
        meals: m.meal_preferences || {},
      };
      profiles.push(profile);

      // Учитываем гостей
      const guests = m.guests || [];
      if (Array.isArray(guests)) {
        guestCount += guests.length;
        for (const g of guests) {
          profiles.push({
            name: g.name || 'Гость',
            dietary: g.dietary || profile.dietary,
            allergies: g.allergies || [],
            liked: g.likedFoods || profile.liked,
            disliked: g.dislikedFoods || [],
            cookingSkills: '',
            meals: profile.meals,
          });
          if (g.allergies) guestAllergies.push(...g.allergies);
        }
      }
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

  const peopleCount = profiles.length || 10;
  const dietaryCount = {
    vegan: profiles.filter((p) => p.dietary === 'vegan').length,
    vegetarian: profiles.filter((p) => p.dietary === 'vegetarian').length,
  };
  const allAllergies = [...new Set(profiles.flatMap((p) => p.allergies))];

  // Пробуем ИИ-генерацию
  try {
    const aiRes = await fetch(`${process.env.VERCEL_URL || 'http://localhost:3000'}/api/ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: 'generate_menu',
        event: { title: event?.title, days, type: event?.type },
        profiles,
        mealSummary: { total: peopleCount, vegan: dietaryCount.vegan, vegetarian: dietaryCount.vegetarian, allergies: allAllergies },
      }),
    });
    if (aiRes.ok) {
      const aiData = await aiRes.json();
      if (aiData.menu && Array.isArray(aiData.menu)) return aiData.menu;
    }
  } catch {}

  // Фолбэк-меню
  const menu: any[] = [];
  const mealTypes = ['breakfast', 'lunch', 'dinner', 'snack'];
  const fallbackDishes: Record<string, string[]> = {
    breakfast: ['Каша овсяная с ягодами', 'Бутерброды с авокадо', 'Яичница с овощами', 'Сырники со сметаной'],
    lunch: ['Суп куриный с лапшой', 'Гречка с тушеными овощами', 'Паста болоньезе', 'Рис с рыбой'],
    dinner: ['Запеканка картофельная', 'Овощное рагу с мясом', 'Рыба на углях с лимоном', 'Шашлык с лавашом'],
    snack: ['Фруктовая нарезка', 'Ореховая смесь', 'Печенье овсяное', 'Чай с мятой'],
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
        cookingNotes: dietaryCount.vegan > 0 ? `Учесть веган-опцию (${dietaryCount.vegan} чел)` : `Приготовить на ${peopleCount} человек`,
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

    // === ONBOARD ===
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

    // === SUGGEST (чек-лист продуктов) ===
    if (action === 'suggest') {
      return res.status(200).json({ categories: FOOD_CATEGORIES });
    }

    // === MENU ===
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

    // === DIET (старый) / SAVE_DIET (новый с гостями) ===
    if (action === 'diet' || action === 'save_diet') {
      const user = verifyInitData(body.initData);
      if (!user) return res.status(200).json({ ok: false, error: 'not-in-telegram' });

      const updateData: Record<string, any> = {};
      if (body.dietary) updateData.dietary = body.dietary;
      if (body.allergies !== undefined) updateData.allergies = JSON.stringify(body.allergies);
      if (body.likedFoods !== undefined) updateData.liked_foods = JSON.stringify(body.likedFoods);
      if (body.dislikedFoods !== undefined) updateData.disliked_foods = JSON.stringify(body.dislikedFoods);
      if (body.cookingSkills) updateData.cooking_skills = body.cookingSkills;
      if (body.mealPreferences !== undefined) updateData.meal_preferences = JSON.stringify(body.mealPreferences);

      // Кастомные продукты, вписанные участником — запоминаем
      if (body.customFoods !== undefined) {
        const existing = await supabase.from('members').select('liked_foods').eq('telegram_id', user.id).maybeSingle();
        const current = (existing as any)?.liked_foods || [];
        const merged = [...new Set([...current, ...body.customFoods])];
        updateData.liked_foods = JSON.stringify(merged);
      }

      if (Object.keys(updateData).length === 0 && !body.guests) {
        return res.status(200).json({ ok: false, error: 'Nothing to update' });
      }

      if (Object.keys(updateData).length > 0) {
        const { error } = await supabase.from('members').update(updateData).eq('telegram_id', user.id);
        if (error) return res.status(200).json({ ok: false, error: error.message });
      }

      // Сохраняем гостей (дети, муж/жена без Telegram)
      if (body.guests && Array.isArray(body.guests)) {
        await supabase.from('members').update({
          guests: JSON.stringify(body.guests.map((g: any) => ({
            name: g.name,
            dietary: g.dietary || 'omnivore',
            allergies: g.allergies || [],
            likedFoods: g.likedFoods || [],
            isChild: !!g.isChild,
          }))),
        }).eq('telegram_id', user.id);
      }

      return res.status(200).json({ ok: true, message: 'Профиль питания сохранён' });
    }

    // === RECEIPT (распознавание чека) ===
    if (action === 'receipt') {
      const { eventId, imageUrl } = body;
      if (!eventId || !imageUrl) return res.status(400).json({ error: 'Missing eventId or imageUrl' });

      let items: { name: string; price: number }[] = [];
      try {
        const aiRes = await fetch(`${process.env.VERCEL_URL || 'http://localhost:3000'}/api/ai`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ task: 'parse_receipt', imageUrl }),
        });
        const aiData = await aiRes.json();
        if (aiData.items && Array.isArray(aiData.items)) items = aiData.items;
      } catch {}

      if (items.length === 0) {
        return res.status(200).json({ ok: false, manual: true, message: 'Не удалось распознать чек. Введите позиции вручную.' });
      }

      const total = items.reduce((s, i) => s + i.price, 0);
      const { data: regs } = await supabase
        .from('registrations')
        .select('telegram_id')
        .eq('event_id', eventId)
        .in('status', ['confirmed', 'pending']);

      const peopleCount = Math.max(1, (regs || []).length);
      const perPerson = Math.ceil(total / peopleCount);

      const { data: ev } = await supabase.from('events').select('logistics').eq('id', eventId).maybeSingle();
      const logistics = (ev as any)?.logistics || {};
      const expenses: any[] = logistics.expenses || [];
      expenses.push({ date: new Date().toISOString(), items, total, perPerson, receiptUrl: imageUrl });
      await supabase.from('events').update({ logistics: { ...logistics, expenses } }).eq('id', eventId);

      return res.status(200).json({
        ok: true, items, total, peopleCount, perPerson,
        message: `Чек на ${total} ₽. По ${perPerson} ₽ с человека (${peopleCount} чел).`,
      });
    }

    // === RECIPE (рецепт к блюду) ===
    if (action === 'recipe') {
      const { dish } = body;
      if (!dish) return res.status(400).json({ error: 'Missing dish' });

      let recipe = '';
      try {
        const aiRes = await fetch(`${process.env.VERCEL_URL || 'http://localhost:3000'}/api/ai`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ task: 'generate_recipe', dish }),
        });
        const aiData = await aiRes.json();
        if (aiData.recipe) recipe = aiData.recipe;
      } catch {}

      if (!recipe) recipe = `Рецепт для "${dish}" временно недоступен. Попробуйте позже.`;
      return res.status(200).json({ ok: true, dish, recipe });
    }

    // === RATE (оценка блюда) ===
    if (action === 'rate') {
      const user = verifyInitData(body.initData);
      if (!user) return res.status(200).json({ ok: false, error: 'not-in-telegram' });

      const { eventId, dish, rating } = body;
      if (!eventId || !dish || !rating) return res.status(400).json({ error: 'Missing fields' });

      const { error } = await supabase.from('menu_votes').upsert({
        event_id: eventId,
        telegram_id: user.id,
        day: body.day || 1,
        meal_type: body.mealType || 'lunch',
        dish,
        vote: rating >= 4 ? 1 : rating <= 2 ? -1 : 0,
      }, { onConflict: 'event_id,telegram_id,day,meal_type,dish' });

      if (error) return res.status(200).json({ ok: false, error: error.message });
      return res.status(200).json({ ok: true, message: 'Оценка сохранена' });
    }

    // === SAVE ACTIVITY PREFERENCES ===
    if (action === 'save_activity_preferences') {
      const user = verifyInitData(body.initData);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const { preferences, fitnessLevel, medicalNotes } = body;
      const { error } = await supabase
        .from('members')
        .update({
          activity_preferences: preferences || {},
          fitness_level: fitnessLevel || '',
          medical_notes: medicalNotes || '',
        })
        .eq('telegram_id', user.id);

      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    // === SAVE SLEEP SCHEDULE ===
    if (action === 'save_sleep_schedule') {
      const user = verifyInitData(body.initData);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const { bedtime, wakeTime, napNeeded } = body;
      const { error } = await supabase
        .from('members')
        .update({
          sleep_schedule: { bedtime, wakeTime, napNeeded },
        })
        .eq('telegram_id', user.id);

      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    // === GET EVENT ROLES ===
    if (action === 'get_event_roles') {
      const { eventId } = body;
      if (!eventId) return res.status(400).json({ error: 'Missing eventId' });

      const { data: roles } = await supabase
        .from('event_roles')
        .select('*')
        .eq('event_id', eventId)
        .order('role');

      return res.status(200).json({ roles: roles || [] });
    }

    // === SAVE EVENT ROLE ===
    if (action === 'save_event_role') {
      const user = verifyInitData(body.initData);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const { eventId, role, customName, notes } = body;
      if (!eventId || !role) return res.status(400).json({ error: 'Missing fields' });

      const { error } = await supabase
        .from('event_roles')
        .upsert({
          event_id: eventId,
          telegram_id: user.id,
          role,
          custom_name: customName || '',
          notes: notes || '',
          confirmed: true,
        }, { onConflict: 'event_id,telegram_id,role' });

      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    // === DELETE EVENT ROLE ===
    if (action === 'delete_event_role') {
      const user = verifyInitData(body.initData);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const { eventId, role } = body;
      if (!eventId || !role) return res.status(400).json({ error: 'Missing fields' });

      const { error } = await supabase
        .from('event_roles')
        .delete()
        .eq('event_id', eventId)
        .eq('telegram_id', user.id)
        .eq('role', role);

      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    // === GENERATE SCHEDULE ===
    if (action === 'generate_schedule') {
      const { eventId } = body;
      if (!eventId) return res.status(400).json({ error: 'Missing eventId' });

      // Получаем событие
      const { data: event } = await supabase
        .from('events')
        .select('*')
        .eq('id', eventId)
        .maybeSingle();

      if (!event) return res.status(404).json({ error: 'Event not found' });

      // Получаем участников с их предпочтениями
      const { data: regs } = await supabase
        .from('registrations')
        .select('telegram_id')
        .eq('event_id', eventId)
        .in('status', ['confirmed', 'pending']);

      const ids = (regs || []).map((r: any) => r.telegram_id).filter(Boolean);
      let participants: any[] = [];
      if (ids.length > 0) {
        const { data: members } = await supabase
          .from('members')
          .select('telegram_id,first_name,activity_preferences,sleep_schedule,fitness_level,medical_notes')
          .in('telegram_id', ids);
        participants = members || [];
      }

      // Получаем погоду (если есть координаты)
      let weatherData = null;
      if (event.coordinates?.lat && event.coordinates?.lng) {
        try {
          const weatherRes = await fetch(
            `/api/weather?lat=${event.coordinates.lat}&lng=${event.coordinates.lng}&date=${event.date}`
          );
          if (weatherRes.ok) {
            const weatherJson = await weatherRes.json();
            if (weatherJson.ok) weatherData = weatherJson.weather;
          }
        } catch {}
      }

      // Пробуем ИИ-генерацию расписания
      try {
        const aiRes = await fetch(`${process.env.VERCEL_URL || 'http://localhost:3000'}/api/ai`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            task: 'generate_schedule',
            event: {
              title: event.title,
              type: event.type,
              date: event.date,
              dateEnd: event.date_end,
              program: event.program || [],
            },
            participants: participants.map((p) => ({
              name: p.first_name,
              activities: p.activity_preferences?.activities || [],
              sleepSchedule: p.sleep_schedule || {},
              fitnessLevel: p.fitness_level,
              medicalNotes: p.medical_notes,
            })),
            weather: weatherData,
          }),
        });
        if (aiRes.ok) {
          const aiData = await aiRes.json();
          if (aiData.schedule && Array.isArray(aiData.schedule)) {
            // Сохраняем расписание в БД
            await supabase.from('event_schedules').delete().eq('event_id', eventId);
            for (const item of aiData.schedule) {
              await supabase.from('event_schedules').insert({
                event_id: eventId,
                day: item.day || 1,
                start_time: item.start_time || '10:00',
                end_time: item.end_time || '11:00',
                custom_title: item.title || item.custom_title || '',
                location: item.location || '',
                notes: item.notes || '',
              });
            }
            return res.status(200).json({ ok: true, schedule: aiData.schedule });
          }
        }
      } catch {}

      // Фолбэк: простое расписание на основе программы события
      const schedule: any[] = [];
      const program = event.program || [];
      let time = '10:00';
      for (let i = 0; i < program.length; i++) {
        const [h, m] = time.split(':').map(Number);
        const start = new Date(0, 0, 0, h, m);
        const end = new Date(start.getTime() + 60 * 60 * 1000); // +1 час
        const endTime = `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;

        schedule.push({
          day: 1,
          start_time: time,
          end_time: endTime,
          custom_title: program[i],
          location: '',
          notes: '',
        });

        time = endTime;
      }

      // Сохраняем фолбэк-расписание
      if (schedule.length > 0) {
        await supabase.from('event_schedules').delete().eq('event_id', eventId);
        await supabase.from('event_schedules').insert(
          schedule.map((s) => ({
            event_id: eventId,
            day: s.day,
            start_time: s.start_time,
            end_time: s.end_time,
            custom_title: s.custom_title,
            location: s.location,
            notes: s.notes,
          }))
        );
      }

      return res.status(200).json({ ok: true, schedule, fallback: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    return res.status(200).json({ ok: false, error: (err as Error).message });
  }
}