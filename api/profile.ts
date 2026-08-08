/**
 * Единый эндпоинт профиля участника (экономия функций Vercel).
 * POST /api/profile
 *
 * action='gate'      → проверка входа в клуб (участник Telegram или реф-код)
 * action='profile'   → профиль клуба: реф-код, статус, баллы (через initData)
 * action='apply'     → заявка на вступление с сайта
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

/** Структурированный лог: одна JSON-строка на событие — greppable в Vercel. */
function slog(level: 'info' | 'warn' | 'error', msg: string, err?: any) {
  const line: any = { t: new Date().toISOString(), level, scope: 'profile', msg };
  if (err !== undefined) line.err = err?.message || String(err);
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(JSON.stringify(line));
}

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || 'campsflint_bot';

// Свежесть initData: без проверки auth_date перехваченная строка годна вечно
// (replay — можно бесконечно выдавать себя за участника). Окно 24ч: mini-app
// переоткрывается с новой подписью, легальные сессии не рвутся.
const INITDATA_MAX_AGE_SEC = 24 * 60 * 60;

function verifyInitData(initData: string): { id: number; username?: string; first_name?: string } | null {
  if (!initData || !BOT_TOKEN) return null;
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');
    const dcs = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    const expected = crypto.createHmac('sha256', secret).update(dcs).digest('hex');
    const a = Buffer.from(expected), b = Buffer.from(hash);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    // Отсекаем старые/replay-подписи по auth_date.
    const authDate = Number(params.get('auth_date') || 0);
    if (!authDate || (Date.now() / 1000 - authDate) > INITDATA_MAX_AGE_SEC) return null;
    const u = JSON.parse(params.get('user') || '{}');
    return u && u.id ? u : null;
  } catch {
    return null;
  }
}

async function ensureRefCode(telegramId: number, force = false): Promise<string | null> {
  const { data: m } = await supabase.from('members').select('ref_code').eq('telegram_id', telegramId).maybeSingle();
  if (m?.ref_code && !force) return m.ref_code;
  for (let i = 0; i < 5; i++) {
    const code = Math.random().toString(36).slice(2, 9);
    const { error } = await supabase.from('members').update({ ref_code: code }).eq('telegram_id', telegramId);
    if (!error) return code;
  }
  return m?.ref_code || null;
}

function escHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

    // === GATE (проверка входа в клуб: участник в Telegram или реф-код) ===
    if (action === 'gate') {
      // 1) Уже одобренный участник внутри Telegram — без кода.
      const user = verifyInitData(body.initData);
      if (user) {
        const { data: me } = await supabase.from('members').select('status,is_core').eq('telegram_id', user.id).maybeSingle();
        if (me) {
          if (me.status === 'approved' || me.is_core) return res.status(200).json({ valid: true, reason: 'member' });
          if (me.status === 'blocked') return res.status(200).json({ valid: false, blocked: true, reason: 'blocked' });
          if (me.status === 'pending_review') return res.status(200).json({ valid: false, pending: true, reason: 'pending_review' });
        }
      }
      // 2) Валидный реферальный код.
      const ref = String(body.ref || '').trim();
      if (ref) {
        const { data: inviter } = await supabase.from('members').select('telegram_id,first_name,username').eq('ref_code', ref).maybeSingle();
        if (inviter) {
          // Привязываем реферера, если пользователь авторизован через Telegram и ещё не привязан
          if (user && user.id !== inviter.telegram_id) {
            const { data: existing } = await supabase
              .from('members')
              .select('referred_by')
              .eq('telegram_id', user.id)
              .maybeSingle();
            // `!existing` — новичок, который открыл Mini App по ссылке раньше,
            // чем нажал /start: строки ещё нет, и старое условие `existing &&`
            // молча теряло привязку реферера.
            if (!existing || !existing.referred_by) {
              await supabase.from('members').upsert(
                {
                  telegram_id: user.id,
                  username: user.username || null,
                  first_name: user.first_name || null,
                  referred_by: inviter.telegram_id,
                },
                { onConflict: 'telegram_id' },
              );
              try {
                await supabase.from('referrals').insert({
                  ref_code: ref,
                  inviter_id: inviter.telegram_id,
                  invited_id: user.id,
                  event_id: null,
                });
              } catch {}
            }
          }
          return res.status(200).json({ valid: true, reason: 'ref', inviterName: inviter.first_name || inviter.username || 'участник клуба' });
        }
      }
      return res.status(200).json({ valid: false });
    }

    // === PROFILE (профиль клуба: реф-код, статус, баллы) ===
    if (action === 'profile') {
      const user = verifyInitData(body.initData);
      if (!user) return res.status(200).json({ ok: false, error: 'not-in-telegram' });

      await supabase.from('members').upsert(
        { telegram_id: user.id, username: user.username || null, first_name: user.first_name || null },
        { onConflict: 'telegram_id' }
      );

      const refCode = await ensureRefCode(user.id, body.op === 'rotate');

      const { data: me } = await supabase
        .from('members')
        .select('telegram_id,username,first_name,status,is_core,role,points')
        .eq('telegram_id', user.id)
        .maybeSingle();

      const { count } = await supabase
        .from('members')
        .select('telegram_id', { count: 'exact', head: true })
        .eq('referred_by', user.id);

      return res.status(200).json({
        ok: true,
        profile: {
          telegramId: user.id,
          firstName: me?.first_name || user.first_name || '',
          username: me?.username || user.username || '',
          status: me?.status || 'pending',
          isCore: !!me?.is_core,
          role: me?.role || 'member',
          points: me?.points || 0,
          refCode,
          refLink: refCode ? `https://t.me/${BOT_USERNAME}?start=ref_${refCode}` : null,
          referralsCount: count || 0,
        },
      });
    }

    /**
     * === PROFILE_FULL: всё для личного кабинета одним запросом ===
     * Профиль в Mini App открывается по одному тапу, поэтому собираем данные
     * здесь, а не пятью запросами с клиента (на мобильной сети это заметно).
     * Новый ФАЙЛ в api/** добавлять нельзя — лимит Hobby 12 функций.
     */
    if (action === 'profile_full') {
      const user = verifyInitData(body.initData);
      if (!user) return res.status(200).json({ ok: false, error: 'not-in-telegram' });

      const { data: me } = await supabase
        .from('members')
        .select('telegram_id,first_name,username,phone,status,is_core,role,points,gender,birthday,dietary,prefs,ref_code,agreed_pd,created_at')
        .eq('telegram_id', user.id)
        .maybeSingle();

      // Регистрации + события (двумя запросами: PostgREST-алиасы в embed легко
      // сломать, а падение join'а тихо отдаёт пустой список).
      const { data: regs } = await supabase
        .from('registrations')
        .select('id,event_id,status,payment_status,payment_amount,attended,guest_count,'
          + 'has_transport,transport_details,transport_seats,dietary,category,equipment,roles,registered_at')
        .eq('telegram_id', user.id)
        .neq('status', 'cancelled')
        .order('registered_at', { ascending: false });

      const evIds = [...new Set((regs || []).map((r: any) => r.event_id).filter(Boolean))];
      let evMap: Record<string, any> = {};
      if (evIds.length) {
        const { data: evs } = await supabase
          .from('events')
          .select('id,title,date,date_end,location,status,type,price_amount,price_label,image')
          .in('id', evIds);
        for (const e of evs || []) evMap[(e as any).id] = e;
      }

      const today = new Date().toISOString().slice(0, 10);
      const myEvents = (regs || []).map((r: any) => {
        const ev = evMap[r.event_id] || {};
        const end = ev.date_end || ev.date || '';
        return {
          regId: r.id,
          eventId: r.event_id,
          title: ev.title || r.event_id,
          date: ev.date || null,
          dateEnd: ev.date_end || null,
          location: ev.location || null,
          image: ev.image || null,
          type: ev.type || null,
          eventStatus: ev.status || null,
          priceAmount: ev.price_amount ?? null,
          priceLabel: ev.price_label || null,
          regStatus: r.status || 'pending',
          paymentStatus: r.payment_status || 'pending',
          paymentAmount: r.payment_amount ?? 0,
          attended: !!r.attended,
          guestCount: r.guest_count || 0,
          hasTransport: !!r.has_transport,
          transportDetails: r.transport_details || null,
          transportSeats: r.transport_seats || 0,
          dietary: r.dietary || null,
          roles: r.roles || null,
          equipment: r.equipment || null,
          registeredAt: r.registered_at || null,
          upcoming: !!end && end >= today,
        };
      });

      // Снаряжение участника + клубное на руках + незакрытые передачи.
      const { data: myGear } = await supabase
        .from('member_equipment')
        .select('id,item,quantity,category,condition,price,photo_url')
        .eq('telegram_id', user.id)
        .order('item');

      let transfers: any[] = [];
      try {
        const { data: tr } = await supabase
          .from('equipment_transfers')
          .select('id,item_name,quantity,status,from_telegram_id,to_telegram_id,created_at')
          .or(`from_telegram_id.eq.${user.id},to_telegram_id.eq.${user.id}`)
          .eq('status', 'pending')
          .order('created_at', { ascending: false });
        transfers = tr || [];
      } catch { /* таблицы может не быть до миграции */ }

      // Питание: что человек выбрал по событиям (с названиями продуктов).
      let food: any[] = [];
      try {
        const { data: sel } = await supabase
          .from('food_selections')
          .select('event_id,product_id,quantity,custom_note')
          .eq('telegram_id', user.id);
        const pids = [...new Set((sel || []).map((s: any) => s.product_id))];
        let pMap: Record<number, any> = {};
        if (pids.length) {
          const { data: prods } = await supabase
            .from('food_products').select('id,name_ru,emoji,unit').in('id', pids);
          for (const p of prods || []) pMap[(p as any).id] = p;
        }
        food = (sel || []).map((s: any) => ({
          eventId: s.event_id,
          eventTitle: evMap[s.event_id]?.title || s.event_id,
          quantity: s.quantity || 1,
          note: s.custom_note || null,
          name: pMap[s.product_id]?.name_ru || `#${s.product_id}`,
          emoji: pMap[s.product_id]?.emoji || '🍽',
          unit: pMap[s.product_id]?.unit || '',
        }));
      } catch { /* таблиц может не быть */ }

      /**
       * Уведомления. Своей таблицы нет, поэтому берём РЕАЛЬНО отправленные
       * человеку сообщения из support_messages (direction='out') — их пишет
       * бот. Плюс ниже клиент добавляет вычисляемые «требует внимания»
       * (неоплачено / незаполнено), чтобы лента не была пустой у новичка.
       */
      let notifications: any[] = [];
      try {
        const { data: msgs } = await supabase
          .from('support_messages')
          .select('id,direction,text,from_name,created_at')
          .eq('telegram_id', user.id)
          .order('created_at', { ascending: false })
          .limit(30);
        notifications = (msgs || []).map((m: any) => ({
          id: m.id,
          kind: m.direction === 'out' ? 'from_club' : 'from_me',
          text: m.text,
          author: m.from_name || null,
          at: m.created_at,
        }));
      } catch { /* таблицы может не быть до миграции */ }

      const { count: referralsCount } = await supabase
        .from('members')
        .select('telegram_id', { count: 'exact', head: true })
        .eq('referred_by', user.id);

      const refCode = (me as any)?.ref_code || null;
      const attended = myEvents.filter((e) => e.attended).length;

      return res.status(200).json({
        ok: true,
        profile: {
          telegramId: user.id,
          firstName: (me as any)?.first_name || user.first_name || '',
          username: (me as any)?.username || user.username || '',
          phone: (me as any)?.phone || '',
          status: (me as any)?.status || 'pending',
          isCore: !!(me as any)?.is_core,
          role: (me as any)?.role || 'member',
          points: (me as any)?.points || 0,
          gender: (me as any)?.gender || null,
          birthday: (me as any)?.birthday || null,
          dietary: (me as any)?.dietary || null,
          agreedPd: !!(me as any)?.agreed_pd,
          prefs: (me as any)?.prefs || {},
          memberSince: (me as any)?.created_at || null,
          refCode,
          refLink: refCode ? `https://t.me/${BOT_USERNAME}?start=ref_${refCode}` : null,
          referralsCount: referralsCount || 0,
          attended,
          signedUp: myEvents.length,
        },
        events: myEvents,
        equipment: myGear || [],
        transfers,
        food,
        notifications,
      });
    }

    /**
     * === SAVE_SETTINGS: правка своего профиля из личного кабинета ===
     * Белый список полей — иначе через этот же роут можно было бы поднять себе
     * status/points/is_core.
     */
    if (action === 'save_settings') {
      const user = verifyInitData(body.initData);
      if (!user) return res.status(200).json({ ok: false, error: 'not-in-telegram' });

      const patch: Record<string, unknown> = {};
      if (typeof body.firstName === 'string' && body.firstName.trim()) {
        patch.first_name = body.firstName.trim().slice(0, 100);
      }
      if (typeof body.phone === 'string') patch.phone = body.phone.trim().slice(0, 40) || null;
      if (body.gender === 'male' || body.gender === 'female') patch.gender = body.gender;
      // День рождения — ОБЯЗАТЕЛЬНОЕ поле: нужен для доски дней рождения и
      // расчёта возраста в админке. Валидируем формат YYYY-MM-DD и что дата
      // не в будущем.
      if (typeof body.birthday === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.birthday)) {
        const bd = new Date(`${body.birthday}T00:00:00`);
        if (!Number.isNaN(bd.getTime()) && bd.getTime() <= Date.now()) {
          patch.birthday = body.birthday;
        }
      }
      if (['omnivore', 'vegetarian', 'vegan'].includes(body.dietary)) patch.dietary = body.dietary;

      // Настройки уведомлений живут в members.prefs (jsonb) — без миграции.
      if (body.notifyPrefs && typeof body.notifyPrefs === 'object') {
        const { data: cur } = await supabase
          .from('members').select('prefs').eq('telegram_id', user.id).maybeSingle();
        const prefs: any = (cur as any)?.prefs || {};
        const allowed = ['events', 'payments', 'logistics', 'digest'];
        prefs.notify = prefs.notify || {};
        for (const k of allowed) {
          if (typeof body.notifyPrefs[k] === 'boolean') prefs.notify[k] = body.notifyPrefs[k];
        }
        patch.prefs = prefs;
      }

      if (!Object.keys(patch).length) return res.status(200).json({ ok: true, saved: false });

      const { error } = await supabase.from('members').update(patch).eq('telegram_id', user.id);
      if (error) return res.status(200).json({ ok: false, error: error.message });
      return res.status(200).json({ ok: true, saved: true });
    }

    /**
     * === ACCEPT_RULES: участник принял кодекс клуба ===
     * Клиент помнит это в localStorage, но там факт привязан к браузеру,
     * теряется при смене устройства и невидим костяку. Пишем в members.prefs
     * (jsonb, без миграции), чтобы админка показывала, кто правила принял.
     */
    if (action === 'accept_rules') {
      const user = verifyInitData(body.initData);
      if (!user) return res.status(200).json({ ok: false, error: 'not-in-telegram' });

      const version = String(body.version || 'v1').slice(0, 16);
      const { data: cur } = await supabase
        .from('members').select('prefs').eq('telegram_id', user.id).maybeSingle();
      const prefs: any = (cur as any)?.prefs || {};
      prefs.rules_accepted = { version, at: new Date().toISOString() };
      const { error } = await supabase.from('members').update({ prefs }).eq('telegram_id', user.id);
      if (error) return res.status(200).json({ ok: false, error: error.message });
      return res.status(200).json({ ok: true });
    }

    /**
     * === SEND_MESSAGE: участник пишет организаторам ИЗ ПРОФИЛЯ на сайте ===
     * Раньше ответить можно было только в боте, и переписка, начатая
     * организатором, обрывалась: в ленте профиля сообщения видны, а ответить
     * нечем. Пишем в ту же таблицу support_messages (direction='in'), поэтому
     * ответ появляется в админке в общем треде — отдельного канала не возникает.
     */
    if (action === 'send_message') {
      const user = verifyInitData(body.initData);
      if (!user) return res.status(200).json({ ok: false, error: 'not-in-telegram' });

      const text = String(body.text || '').trim();
      if (!text) return res.status(200).json({ ok: false, error: 'Пустое сообщение' });

      const { data: me } = await supabase
        .from('members').select('first_name,username,status').eq('telegram_id', user.id).maybeSingle();
      // Заблокированному нет смысла открывать канал в админку.
      if ((me as any)?.status === 'blocked') return res.status(200).json({ ok: false, error: 'Отправка недоступна' });

      const author = `${(me as any)?.first_name || user.first_name || ''}${(me as any)?.username ? ' @' + (me as any).username : ''}`.trim()
        || `id${user.id}`;

      const { error } = await supabase.from('support_messages').insert({
        telegram_id: user.id, direction: 'in', text: text.slice(0, 4000), from_name: author,
      });
      if (error) return res.status(200).json({ ok: false, error: error.message });

      /**
       * Уведомляем костяк. НЕ только в админ-чат: если бота из группы убрали
       * или её id устарел, сообщение видел бы только тот, кто зайдёт в админку.
       * Поэтому дублируем в личку каждому костяку и возвращаем, дошло ли.
       */
      let notified = 0;
      if (BOT_TOKEN) {
        const body2 = `💬 <b>Сообщение из профиля (сайт)</b>\nОт: ${escHtml(author)} (id ${user.id})\n\n<i>${escHtml(text.slice(0, 1500))}</i>`;
        const markup = { inline_keyboard: [[{ text: '✍️ Ответить', callback_data: `reply_${user.id}` }]] };
        const targets: (string | number)[] = [];
        const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
        if (adminChatId) targets.push(adminChatId);
        try {
          const { data: core } = await supabase.from('members').select('telegram_id').eq('is_core', true);
          for (const c of core || []) {
            const id = Number((c as any).telegram_id);
            if (Number.isFinite(id) && id > 0 && id !== user.id) targets.push(id);
          }
        } catch { /* остаётся хотя бы админ-чат */ }
        for (const chat of targets) {
          try {
            const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: chat, parse_mode: 'HTML', text: body2, reply_markup: markup }),
            });
            if ((await r.json())?.ok === true) notified += 1;
          } catch { /* пробуем остальных */ }
        }
      }
      // Сообщение уже в БД, поэтому ok:true; но клиенту сообщаем, дошёл ли пинг,
      // чтобы не обещать быстрый ответ, когда уведомить никого не удалось.
      return res.status(200).json({ ok: true, notified });
    }

    // === BIRTHDAYS (дни рождения участников клуба) ===
    // Доска дней рождения: только одобренные участники, только имя + дата.
    // Возраст НЕ отдаём — на доске он не нужен (пожелание владельца).
    if (action === 'birthdays') {
      const user = verifyInitData(body.initData);
      if (!user) return res.status(200).json({ ok: false, error: 'not-in-telegram' });

      const { data: members } = await supabase
        .from('members')
        .select('telegram_id,first_name,birthday')
        .eq('status', 'approved')
        .not('birthday', 'is', null);

      const list = (members || [])
        .filter((m: any) => m.birthday && /^\d{4}-\d{2}-\d{2}$/.test(m.birthday))
        .map((m: any) => {
          const bd = m.birthday.split('-');
          return {
            id: String(m.telegram_id),
            name: m.first_name || 'Участник',
            date: `${bd[1]}-${bd[2]}`, // MM-DD
          };
        });

      return res.status(200).json({ ok: true, birthdays: list });
    }

    // === MY_EVENTS (история событий участника) ===
    if (action === 'my_events') {
      const user = verifyInitData(body.initData);
      if (!user) return res.status(200).json({ ok: false, error: 'not-in-telegram' });

      const { data: regs } = await supabase
        .from('registrations')
        .select('id,event_id,status,payment_status,has_transport')
        .eq('telegram_id', user.id)
        .neq('status', 'cancelled')
        .order('created_at', { ascending: false });

      const eventIds = (regs || []).map((r: any) => r.event_id);
      if (!eventIds.length) {
        return res.status(200).json({ ok: true, events: [] });
      }

      const { data: events } = await supabase
        .from('events')
        .select('id,title,date,date_end,status')
        .in('id', eventIds)
        .order('date', { ascending: false });

      const result = (events || []).map((ev: any) => {
        const reg = regs?.find((r: any) => r.event_id === ev.id);
        return {
          id: ev.id,
          title: ev.title,
          date: ev.date,
          dateEnd: ev.date_end,
          eventStatus: ev.status,
          regStatus: reg?.status || 'unknown',
          paymentStatus: reg?.payment_status || 'pending',
          hasTransport: reg?.has_transport || false,
        };
      });

      return res.status(200).json({ ok: true, events: result });
    }

    // === APPLY (заявка на вступление — ТОЛЬКО через Telegram) ===
    if (action === 'apply') {
      const { firstName, lastName, phone, sourceHint } = body;
      if (!firstName || !phone) {
        return res.status(200).json({ ok: false, error: 'Имя и телефон обязательны' });
      }

      // Telegram ОБЯЗАТЕЛЕН: личность заявителя берём из подписанного initData,
      // а не с его слов. Иначе (а) при одобрении некуда прислать уведомление,
      // (б) человек не сможет авторизоваться и войти в клуб, (в) можно
      // назваться кем угодно. Аккаунты без @ника пропускаем — идентификатор
      // это telegram_id (его сменить нельзя), ник лишь для показа.
      const user = verifyInitData(body.initData);
      if (!user || !user.id) {
        return res.status(200).json({
          ok: false, code: 'need_telegram',
          message: 'Вступление в клуб — только через Telegram. Открой @campsflint_bot и подай заявку там: так мы свяжем заявку с твоим аккаунтом и сможем прислать ответ.',
        });
      }
      const telegramId: number = user.id;

      // 0) Текущий Telegram-аккаунт УЖЕ в клубе → впускаем сразу, а не блокируем
      //    формой. Раньше одобренный участник, попавший на экран анкеты, получал
      //    «вы уже участник» и не мог войти (жалоба 03.08).
      if (user) {
        const { data: meNow } = await supabase
          .from('members').select('status,is_core').eq('telegram_id', user.id).maybeSingle();
        if (meNow && ((meNow as any).status === 'approved' || (meNow as any).is_core)) {
          return res.status(200).json({ ok: true, approved: true, message: 'Вы уже в клубе' });
        }
        if (meNow && (meNow as any).status === 'blocked') {
          return res.status(200).json({ ok: false, code: 'blocked', message: 'Ваш доступ заблокирован. Обратитесь в поддержку.' });
        }
      }

      /**
       * Реф-ссылка больше НЕ впускает автоматически — фиксирует лишь того, кто
       * пригласил (для атрибуции). Костяк решает по КАЖДОЙ заявке вручную
       * кнопками «Принять / Отклонить / Написать» (требование владельца 06.08:
       * «вход только по приглашению», но всех проверять лично). Безопасно, т.к.
       * уведомление костяку в личку теперь доставляется надёжно.
       */
      let inviterId: number | null = null;
      const applyRef = String(body.refCode || '').trim();
      if (applyRef) {
        const { data: inv } = await supabase
          .from('members').select('telegram_id,status,is_core').eq('ref_code', applyRef).maybeSingle();
        const inviterInside = !!inv && ((inv as any).status === 'approved' || (inv as any).is_core === true);
        if (inviterInside && Number((inv as any).telegram_id) !== telegramId) {
          inviterId = Number((inv as any).telegram_id);
        }
      }

      // Телефон привязан к ДРУГОМУ аккаунту. Своя запись (тот же telegram_id)
      // сюда не попадает — иначе повторная отправка ложно ругалась «вы уже
      // участник» (жалоба 03.08).
      const { data: existing } = await supabase
        .from('members')
        .select('telegram_id, status, referred_by')
        .eq('phone', phone)
        .maybeSingle();
      const existOther = !!existing && Number((existing as any).telegram_id) !== telegramId;
      if (existOther && (existing as any).status === 'approved') {
        return res.status(200).json({ ok: false, code: 'already_member', message: 'Этот телефон уже привязан к участнику клуба. Если это вы — откройте приложение под тем же Telegram-аккаунтом.' });
      }
      if (existOther && (existing as any).status === 'blocked') {
        return res.status(200).json({ ok: false, code: 'blocked', message: 'Ваш доступ заблокирован. Обратитесь в поддержку.' });
      }
      // Своя заявка уже на модерации — не плодим дубли-уведомления костяку.
      if (existing && Number((existing as any).telegram_id) === telegramId
          && (existing as any).status === 'pending_review') {
        return res.status(200).json({ ok: false, code: 'already_pending', message: 'Ваша заявка уже на рассмотрении — костяк ответит в бот.' });
      }

      const refCode = Math.random().toString(36).slice(2, 9);

      const memberData: any = {
        telegram_id: telegramId,
        first_name: firstName,
        last_name: lastName || null,
        phone,
        status: 'pending_review',   // всегда на ручное решение костяка
        ref_code: refCode,
        agreed_pd: true,
        username: user?.username || null,
      };
      // Реф-ссылка фиксирует пригласившего (атрибуция), но НЕ впускает сама.
      if (inviterId && !(existing as any)?.referred_by) memberData.referred_by = inviterId;
      // «Откуда узнал» — в members НЕТ колонки source_hint (именно из-за неё
      // КАЖДАЯ заявка падала на upsert 02–03.08). Кладём в prefs (jsonb).
      if (sourceHint) {
        const { data: cur } = await supabase.from('members').select('prefs').eq('telegram_id', telegramId).maybeSingle();
        const prefs: any = (cur as any)?.prefs || {};
        prefs.source_hint = String(sourceHint).slice(0, 300);
        memberData.prefs = prefs;
      }

      const { error } = await supabase.from('members').upsert(
        memberData,
        { onConflict: 'telegram_id' }
      );

      if (error) {
        // Реальную причину показываем и в лог, и пользователю: раньше её прятал
        // общий текст, и невозможно было понять, что упало (напр. source_hint).
        slog('error', 'apply upsert failed', error);
        return res.status(200).json({ ok: false, error: `Не удалось сохранить заявку: ${error.message || 'ошибка БД'}` });
      }

      // Доставку админу возвращаем в ответе (_adminNotified/_adminNotifyErr):
      // раньше провал глушился, и было не видно, дошло ли уведомление.
      // КРИТИЧНО: шлём не только в групповой админ-чат (мог быть замьючен/не тот),
      // но и В ЛИЧКУ каждому костяку — так владелец гарантированно видит заявку
      // и жмёт «Принять» прямо у себя. Тот же приём, что notifyCore в боте.
      let adminNotified = false;
      let adminNotifyErr: string | null = null;
      if (!BOT_TOKEN) {
        adminNotifyErr = 'TELEGRAM_BOT_TOKEN не задан в окружении';
      } else {
        const uname = user?.username ? '@' + escHtml(user.username) : 'ника нет (вход по id)';
        // Пригласивший — справочно (кто ручается), но решает всё равно костяк.
        let invLine = '';
        if (inviterId) {
          const { data: invM } = await supabase.from('members').select('first_name,username').eq('telegram_id', inviterId).maybeSingle();
          const invName = (invM as any)?.first_name || ((invM as any)?.username ? '@' + (invM as any).username : `id ${inviterId}`);
          invLine = `\n🔗 Пригласил: ${escHtml(invName)}`;
        }
        const who =
          `👤 ${escHtml(firstName)} ${escHtml(lastName || '')}\n` +
          `📞 <code>${escHtml(phone)}</code>\n` +
          `✈️ ${uname} (id ${telegramId})` +
          invLine +
          (sourceHint ? `\n💬 Откуда: ${escHtml(sourceHint)}` : '');
        // Кнопки Принять/Отклонить/Написать — callback approve_/reject_/reply_
        // по telegram_id (стабильный, работает и без @ника). Костяк решает в
        // один тап и в личке, и в групповом чате.
        const text = `🚪 <b>Новая заявка в клуб</b>\n\n${who}\n\nРешай кнопками ниже — ответ придёт заявителю в бот.`;
        const replyMarkup = { inline_keyboard: [
          [{ text: '✅ Принять', callback_data: `approve_${telegramId}` }, { text: '❌ Отклонить', callback_data: `reject_${telegramId}` }],
          [{ text: '✍️ Написать заявителю', callback_data: `reply_${telegramId}` }],
        ] };

        // Получатели: групповой админ-чат + личка всем костякам (без дублей).
        const recipients = new Set<string>();
        const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
        if (adminChatId) recipients.add(String(adminChatId));
        try {
          const { data: core } = await supabase.from('members').select('telegram_id').eq('is_core', true);
          for (const c of core || []) {
            const id = Number((c as any).telegram_id);
            if (Number.isFinite(id) && id > 0 && id !== telegramId) recipients.add(String(id));
          }
        } catch { /* нет доступа к таблице — остаётся хотя бы админ-чат */ }

        if (!recipients.size) {
          adminNotifyErr = 'некому слать: нет TELEGRAM_ADMIN_CHAT_ID и ни одного костяка';
        } else {
          const errs: string[] = [];
          for (const chat of recipients) {
            try {
              const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chat, parse_mode: 'HTML', disable_web_page_preview: true, text, reply_markup: replyMarkup }),
              });
              const j: any = await r.json().catch(() => ({ ok: false }));
              if (j.ok === true) adminNotified = true;
              else errs.push(`${chat}: ${j.description || r.status}`);
            } catch (e) { errs.push(`${chat}: ${(e as Error).message}`); }
          }
          if (!adminNotified) { adminNotifyErr = errs.join('; ') || 'sendMessage не ok'; slog('warn', 'apply admin-notify нигде не доставлено', errs); }
        }
      }

      // Авто-впуска больше нет: всегда «заявка на рассмотрении», костяк решит
      // кнопками и ответит в бот.
      return res.status(200).json({ ok: true, message: 'Заявка отправлена! Костяк рассмотрит её и ответит в бот.', _adminNotified: adminNotified, _adminNotifyErr: adminNotifyErr });
    }

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
        message: `Чек на ${total} Br. По ${perPerson} Br с человека (${peopleCount} чел).`,
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

    // === MY REGISTRATIONS (Мои заявки из Mini App) ===
    if (action === 'my_registrations') {
      const user = verifyInitData(body.initData);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const { data: regs } = await supabase
        .from('registrations')
        .select(`
          id,
          event_id,
          status,
          payment_status,
          payment_amount,
          attended,
          guest_count,
          children_count,
          transport_details,
          has_transport,
          transport_seats,
          registered_at,
          events!inner(title, date, location, status as event_status, type)
        `)
        .eq('telegram_id', user.id)
        .order('registered_at', { ascending: false });

      return res.status(200).json({ registrations: regs || [] });
    }

    // === GET PROFILE ===
    if (action === 'get_profile') {
      const user = verifyInitData(body.initData);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const { data: member } = await supabase
        .from('members')
        .select('first_name,username,phone,status,points,attended_count,invited_count,level,achievements')
        .eq('telegram_id', user.id)
        .maybeSingle();

      if (!member) return res.status(404).json({ error: 'Profile not found' });

      // Получаем регистрации
      const { data: regs } = await supabase
        .from('registrations')
        .select('attended')
        .eq('telegram_id', user.id);

      const attended = (regs || []).filter(r => r.attended).length;

      return res.status(200).json({
        profile: {
          ...member,
          attended,
        },
      });
    }

    // === GET PREFILL DATA (для автозаполнения формы регистрации) ===
    if (action === 'get_prefill') {
      const user = verifyInitData(body.initData);
      if (!user) return res.status(200).json({ ok: false, error: 'not-in-telegram' });

      // Получаем профиль
      const { data: member } = await supabase
        .from('members')
        .select('first_name,phone')
        .eq('telegram_id', user.id)
        .maybeSingle();

      // Получаем последнюю регистрацию для автозаполнения транспорта
      const { data: lastReg } = await supabase
        .from('registrations')
        .select('has_transport,transport_details,transport_seats,has_license,category,dietary,equipment,roles')
        .eq('telegram_id', user.id)
        .neq('status', 'cancelled')
        .order('registered_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      return res.status(200).json({
        ok: true,
        prefill: {
          name: member?.first_name || '',
          phone: member?.phone || '',
          hasTransport: lastReg?.has_transport || false,
          transportDetails: lastReg?.transport_details || '',
          transportSeats: lastReg?.transport_seats || 0,
          hasLicense: lastReg?.has_license === true ? 'yes' : lastReg?.has_license === false ? 'no' : null,
          category: lastReg?.category || 'male',
          dietary: lastReg?.dietary || 'omnivore',
          equipment: Array.isArray(lastReg?.equipment) ? lastReg.equipment.join(',') : '',
          roles: Array.isArray(lastReg?.roles) ? lastReg.roles.join(',') : '',
        },
      });
    }

    // === ADD POINTS ===
    if (action === 'add_points') {
      const ADMIN_SECRET = process.env.ADMIN_TOKEN || '';
      const bearer = String(req.headers?.authorization || '').replace('Bearer ', '');
      const safeEq = (a: string, b: string) => {
        const A = Buffer.from(String(a)), B = Buffer.from(String(b));
        return A.length === B.length && A.length > 0 && crypto.timingSafeEqual(A, B);
      };
      if (!ADMIN_SECRET || !bearer || !safeEq(bearer, ADMIN_SECRET)) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { telegramId, eventId, reason, points, description } = body;
      if (!telegramId || !reason || !points) {
        return res.status(400).json({ error: 'Missing fields' });
      }

      // Начисляем баллы
      const { data: member } = await supabase
        .from('members')
        .select('points, attended_count, invited_count, level, achievements')
        .eq('telegram_id', Number(telegramId))
        .maybeSingle();

      if (!member) {
        return res.status(404).json({ error: 'Member not found' });
      }

      const newPoints = (member.points || 0) + points;
      const updates: any = { points: newPoints };

      // Обновляем счётчики
      if (reason === 'attendance') {
        updates.attended_count = (member.attended_count || 0) + 1;
      } else if (reason === 'invite') {
        updates.invited_count = (member.invited_count || 0) + 1;
      }

      // Проверяем достижения
      const achievements = member.achievements || [];
      const { data: allAchievements } = await supabase
        .from('achievements')
        .select('*');

      const newAchievements = [...achievements];
      for (const ach of allAchievements || []) {
        if (newAchievements.includes(ach.code)) continue; // уже есть

        const condition = ach.condition || {};
        const attendedCount = member.attended_count || 0;
        const invitedCount = member.invited_count || 0;
        const pointsTotal = member.points || 0;

        let earned = false;
        if (condition.attended_count && attendedCount >= condition.attended_count) earned = true;
        if (condition.invited_count && invitedCount >= condition.invited_count) earned = true;
        if (condition.points_required && pointsTotal >= condition.points_required) earned = true;

        if (earned) {
          newAchievements.push(ach.code);
          // Бонус за достижение
          updates.points = newPoints + 10; // +10 бонус
        }
      }

      updates.achievements = JSON.stringify(newAchievements);

      // Обновляем уровень
      if (newPoints >= 500) updates.level = 'legend';
      else if (newPoints >= 200) updates.level = 'core';
      else if (newPoints >= 50) updates.level = 'regular';

      // Сохраняем
      await supabase.from('members').update(updates).eq('telegram_id', Number(telegramId));

      // Логируем
      await supabase.from('points_log').insert({
        telegram_id: Number(telegramId),
        event_id: eventId || null,
        reason,
        points,
        description: description || '',
      });

      return res.status(200).json({
        ok: true,
        newPoints: updates.points,
        level: updates.level,
        newAchievements: newAchievements.filter(a => !achievements.includes(a)),
      });
    }

    // === METRICS (метрики и аналитика) ===
    if (action === 'metrics') {
      const ADMIN_SECRET = process.env.ADMIN_TOKEN || '';
      const bearer = String(req.headers?.authorization || '').replace('Bearer ', '');
      const safeEq = (a: string, b: string) => {
        const A = Buffer.from(String(a)), B = Buffer.from(String(b));
        return A.length === B.length && A.length > 0 && crypto.timingSafeEqual(A, B);
      };
      if (!ADMIN_SECRET || !bearer || !safeEq(bearer, ADMIN_SECRET)) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { eventId, period } = body;
      
      // Получаем базовую статистику по событию
      const { data: event } = await supabase
        .from('events')
        .select('*')
        .eq('id', eventId)
        .maybeSingle();

      if (!event) return res.status(404).json({ error: 'Event not found' });

      // Регистрации
      const { data: regs } = await supabase
        .from('registrations')
        .select('status, payment_status, payment_amount, attended, registered_at')
        .eq('event_id', eventId);

      const totalRegs = (regs || []).length;
      const confirmed = (regs || []).filter((r: any) => r.status === 'confirmed').length;
      const paid = (regs || []).filter((r: any) => r.payment_status === 'paid').length;
      const attended = (regs || []).filter((r: any) => r.attended).length;
      const totalRevenue = (regs || []).reduce((s: number, r: any) => s + (r.payment_amount || 0), 0);

      // Конверсия
      const conversionRate = totalRegs > 0 ? Math.round((confirmed / totalRegs) * 100) : 0;
      const attendanceRate = confirmed > 0 ? Math.round((attended / confirmed) * 100) : 0;
      const paymentRate = confirmed > 0 ? Math.round((paid / confirmed) * 100) : 0;

      // Средний чек
      const avgPayment = paid > 0 ? Math.round(totalRevenue / paid) : 0;

      // Баллы и достижения
      const { data: membersData } = await supabase
        .from('members')
        .select('points, level, achievements')
        .eq('status', 'approved');

      const totalMembers = (membersData || []).length;
      const avgPoints = totalMembers > 0 ? Math.round((membersData || []).reduce((s: number, m: any) => s + (m.points || 0), 0) / totalMembers) : 0;
      const legends = (membersData || []).filter((m: any) => m.level === 'legend').length;
      const core = (membersData || []).filter((m: any) => m.level === 'core').length;

      return res.status(200).json({
        ok: true,
        event: {
          id: eventId,
          title: event.title,
          date: event.date,
          status: event.status,
        },
        registrations: {
          total: totalRegs,
          confirmed,
          paid,
          attended,
          pending: totalRegs - confirmed,
          conversionRate,
          attendanceRate,
          paymentRate,
        },
        revenue: {
          total: totalRevenue,
          avgPayment,
          currency: 'BYN',
        },
        community: {
          totalMembers,
          avgPoints,
          legends,
          core,
        },
        timestamp: new Date().toISOString(),
      });
    }

    // === DEPLOY BOT (перезапуск бота на VPS после деплоя) ===
    if (action === 'deploy_bot') {
      const ADMIN_SECRET = process.env.ADMIN_TOKEN || '';
      const bearer = String(req.headers?.authorization || '').replace('Bearer ', '');
      const safeEq = (a: string, b: string) => {
        const A = Buffer.from(String(a)), B = Buffer.from(String(b));
        return A.length === B.length && A.length > 0 && crypto.timingSafeEqual(A, B);
      };
      if (!ADMIN_SECRET || !bearer || !safeEq(bearer, ADMIN_SECRET)) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const VPS_DEPLOY_URL = process.env.VPS_DEPLOY_URL || '';
      if (!VPS_DEPLOY_URL) {
        return res.status(200).json({ ok: false, error: 'VPS_DEPLOY_URL не настроен' });
      }

      try {
        const deployRes = await fetch(VPS_DEPLOY_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            secret: process.env.VPS_DEPLOY_SECRET || '',
            repo: 'flint-live-in-moment',
            branch: 'main',
          }),
        });

        if (deployRes.ok) {
          return res.status(200).json({ ok: true, message: 'Бот перезапущен' });
        } else {
          return res.status(200).json({ ok: false, error: `VPS ответил: ${deployRes.status}` });
        }
      } catch (e) {
        return res.status(200).json({ ok: false, error: (e as Error).message });
      }
    }

    // === INTEGRATIONS (внешние сервисы) ===
    if (action === 'integrations') {
      const ADMIN_SECRET = process.env.ADMIN_TOKEN || '';
      const bearer = String(req.headers?.authorization || '').replace('Bearer ', '');
      const safeEq = (a: string, b: string) => {
        const A = Buffer.from(String(a)), B = Buffer.from(String(b));
        return A.length === B.length && A.length > 0 && crypto.timingSafeEqual(A, B);
      };
      if (!ADMIN_SECRET || !bearer || !safeEq(bearer, ADMIN_SECRET)) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { eventId, service, action: intAction, payload } = body;
      if (!eventId || !service) return res.status(400).json({ error: 'Missing fields' });

      // Здесь можно добавить интеграции с внешними сервисами
      // Пока возвращаем заглушку
      return res.status(200).json({
        ok: true,
        service,
        action: intAction,
        message: `Интеграция с ${service} в разработке`
      });
    }

    // Чаты событий живут в боте: /link в группе → инвайт-ссылка в
    // events.telegram_bot_url (таблицы event_chats в БД нет и не было).

    // === GET WEATHER ===
    if (action === 'get_weather') {
      const { lat, lng, date } = body;
      if (!lat || !lng) return res.status(400).json({ error: 'Missing lat/lng' });

      try {
        const weatherUrl = new URL('https://api.open-meteo.com/v1/forecast');
        weatherUrl.searchParams.set('latitude', String(lat));
        weatherUrl.searchParams.set('longitude', String(lng));
        weatherUrl.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode');
        weatherUrl.searchParams.set('timezone', 'Europe/Minsk');
        weatherUrl.searchParams.set('forecast_days', '7');

        const weatherRes = await fetch(weatherUrl.toString());
        if (weatherRes.ok) {
          const weatherData = await weatherRes.json();
          const daily = weatherData.daily || {};

          let dateIndex = 0;
          if (date && daily.time) {
            const dateStr = String(date);
            dateIndex = daily.time.findIndex((t: string) => t === dateStr);
            if (dateIndex < 0) dateIndex = 0;
          }

          const weatherCode = daily.weathercode?.[dateIndex] || 0;
          const tempMax = daily.temperature_2m_max?.[dateIndex];
          const tempMin = daily.temperature_2m_min?.[dateIndex];
          const precipitation = daily.precipitation_sum?.[dateIndex];

          const weatherDescriptions: Record<number, { label: string; emoji: string; recommendation: string }> = {
            0: { label: 'Ясно', emoji: '☀️', recommendation: 'Идеальная погода для мероприятия!' },
            1: { label: 'Преимущественно ясно', emoji: '🌤️', recommendation: 'Хорошая погода, можно планировать outdoor.' },
            2: { label: 'Переменная облачность', emoji: '⛅', recommendation: 'Погода переменная, иметь запасной план.' },
            3: { label: 'Облачно', emoji: '☁️', recommendation: 'Облачно, но без осадков.' },
            45: { label: 'Туман', emoji: '🌫️', recommendation: 'Туман, осторожно на дороге.' },
            48: { label: 'Изморозь', emoji: '🌫️', recommendation: 'Изморозь, скользко.' },
            51: { label: 'Лёгкая морось', emoji: '🌦️', recommendation: 'Небольшой дождь, взять зонты.' },
            53: { label: 'Морось', emoji: '🌦️', recommendation: 'Дождь, нужны зонты/крыши.' },
            55: { label: 'Сильная морось', emoji: '🌧️', recommendation: 'Дождь, лучше indoor.' },
            61: { label: 'Лёгкий дождь', emoji: '🌦️', recommendation: 'Дождь, взять зонты.' },
            63: { label: 'Дождь', emoji: '🌧️', recommendation: 'Дождь, нужны крыши/палатки.' },
            65: { label: 'Сильный дождь', emoji: '⛈️', recommendation: 'Ливень, лучше перенести или indoor.' },
            71: { label: 'Лёгкий снег', emoji: '🌨️', recommendation: 'Снег, тёплая одежда.' },
            73: { label: 'Снег', emoji: '❄️', recommendation: 'Снег, подготовить зимнее снаряжение.' },
            75: { label: 'Сильный снег', emoji: '❄️', recommendation: 'Метель, опасное путешествие.' },
            80: { label: 'Ливень', emoji: '🌧️', recommendation: 'Кратковременный ливень.' },
            81: { label: 'Сильный ливень', emoji: '⛈️', recommendation: 'Ливень, укрыться.' },
            82: { label: 'Очень сильный ливень', emoji: '⛈️', recommendation: 'Шторм, опасность.' },
            95: { label: 'Гроза', emoji: '⚡', recommendation: 'Гроза, опасность на открытом пространстве.' },
            96: { label: 'Гроза с градом', emoji: '⛈️', recommendation: 'Опасно, искать укрытие.' },
            99: { label: 'Сильная гроза с градом', emoji: '⛈️', recommendation: 'Крайне опасно, оставаться внутри.' },
          };

          const weather = weatherDescriptions[weatherCode] || { label: 'Неизвестно', emoji: '❓', recommendation: 'Погода неизвестна' };

          return res.status(200).json({
            ok: true,
            weather: {
              code: weatherCode,
              label: weather.label,
              emoji: weather.emoji,
              recommendation: weather.recommendation,
              tempMax: tempMax ? Math.round(tempMax) : null,
              tempMin: tempMin ? Math.round(tempMin) : null,
              precipitation: precipitation ? Math.round(precipitation * 10) / 10 : 0,
              date: date || daily.time?.[0] || null,
            },
          });
        }
      } catch (weatherError) {
        slog('error', 'Weather API error', weatherError);
      }

      return res.status(200).json({
        ok: true,
        weather: {
          code: 0,
          label: 'Данные временно недоступны',
          emoji: '🌡️',
          recommendation: 'Проверьте погоду самостоятельно перед выходом.',
          tempMax: null,
          tempMin: null,
          precipitation: 0,
          date: date || null,
          fallback: true,
        },
      });
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

      // Получаем погоду (если есть координаты) через тот же эндпоинт
      let weatherData = null;
      if (event.coordinates?.lat && event.coordinates?.lng) {
        try {
          const weatherRes = await fetch(`${process.env.VERCEL_URL || 'http://localhost:3000'}/api/profile`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'get_weather',
              lat: event.coordinates.lat,
              lng: event.coordinates.lng,
              date: event.date,
            }),
          });
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