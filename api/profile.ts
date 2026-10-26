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
// Чат костяка: сюда уходят события состава — заявки и отмены.
const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID || '-1003935660570';

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
  const { data: m } = await supabase.from('members').select('ref_code,status,is_core').eq('telegram_id', telegramId).maybeSingle();
  // Ссылку-приглашение выдаём только принятым: ссылка не принятого не впускает.
  if (!m || !((m as any).status === 'approved' || (m as any).is_core === true)) return null;
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

/**
 * Подписанная ссылка на аватарку участника (тот же приём, что в api/events.ts).
 * Вынесено на уровень модуля, потому что понадобилось сразу в нескольких
 * обработчиках, а локальные копии перекрывали друг друга по видимости.
 */
function avatarOf(id: number): string {
  if (!(id > 0) || !BOT_TOKEN) return '';
  return `/api/events?action=avatar&u=${id}&s=${crypto.createHmac('sha256', BOT_TOKEN).update(`avatar:${id}`).digest('hex').slice(0, 16)}`;
}

/** IP клиента за прокси Vercel (первый в x-forwarded-for). */
function clientIp(req: any): string {
  const xf = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || String(req.headers?.['x-real-ip'] || '') || 'unknown';
}

/**
 * Rate-limit на Supabase (переживает несколько инстансов Vercel, в отличие от
 * in-memory). Бакет живёт в bot_sessions под отрицательным ключом-хешем — тот
 * же приём, что в api/events.ts и api/admin/events.ts.
 *
 * Зачем профилю: до этого здесь не было НИ ОДНОГО ограничения. Действие
 * `gate` перебирало реф-коды (6 символов base36), `apply` могло залить костяк
 * фейковыми заявками, `send_message` — спамом в личку каждому члену клуба.
 */
async function rateLimit(scope: string, ident: string, max: number, windowMs: number): Promise<{ allowed: boolean; retryAfter: number }> {
  try {
    const raw = `rl:${scope}:${ident}`;
    let h = 0;
    for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) | 0;
    const key = -Math.abs(h) - 200000; // отдельный диапазон от presence/login
    const now = Date.now();
    const { data } = await supabase.from('bot_sessions').select('context').eq('telegram_id', key).maybeSingle();
    const ctx: any = (data as any)?.context || {};
    const windowStart = Number(ctx.ws) || 0;
    let count = Number(ctx.n) || 0;
    if (now - windowStart > windowMs) {
      await supabase.from('bot_sessions').upsert(
        { telegram_id: key, state: 'ratelimit', context: { ws: now, n: 1 }, updated_at: new Date().toISOString() },
        { onConflict: 'telegram_id' }
      );
      return { allowed: true, retryAfter: 0 };
    }
    if (count >= max) return { allowed: false, retryAfter: Math.ceil((windowStart + windowMs - now) / 1000) };
    count += 1;
    await supabase.from('bot_sessions').upsert(
      { telegram_id: key, state: 'ratelimit', context: { ws: windowStart, n: count }, updated_at: new Date().toISOString() },
      { onConflict: 'telegram_id' }
    );
    return { allowed: true, retryAfter: 0 };
  } catch {
    // При сбое стора не блокируем легитимных пользователей.
    return { allowed: true, retryAfter: 0 };
  }
}

/**
 * Проверка дорогих действий — по Telegram-подписи, а не «по факту запроса».
 *
 * Зачем: `generate`, `generate_schedule`, `receipt`, `recipe` дергают Gemini.
 * У бесплатного тира 20 запросов в СУТКИ на модель; любой человек с curl мог
 * выжечь квоту клуба за минуту, и организаторы оставались без ИИ до полуночи.
 * Теперь эти действия доступны участнику клуба или админ-токену.
 * Возвращает 'ok' | 'deny'.
 */
async function requireMemberOrAdmin(req: any, body: any): Promise<'ok' | 'deny'> {
  const ADMIN_SECRET = process.env.ADMIN_TOKEN || '';
  const bearer = String(req.headers?.authorization || '').replace('Bearer ', '');
  const safeEq = (a: string, b: string) => {
    const A = Buffer.from(String(a)), B = Buffer.from(String(b));
    return A.length === B.length && A.length > 0 && crypto.timingSafeEqual(A, B);
  };
  if (ADMIN_SECRET && bearer && safeEq(bearer, ADMIN_SECRET)) return 'ok';
  const user = verifyInitData(body?.initData);
  if (!user) return 'deny';
  const { data: me } = await supabase.from('members').select('status,is_core').eq('telegram_id', user.id).maybeSingle();
  const ok = !!me && ((me as any).is_core === true || (me as any).status === 'approved');
  return ok ? 'ok' : 'deny';
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

/**
 * БАЗА ЗНАНИЙ клуба — закрытый раздел для тех, кто ведёт события.
 *
 * ⚠️ ДУБЛИКАТ константы из api/telegram/webhook.ts — ПРАВЬ ОБА ФАЙЛА.
 * Vercel не включает в бандл функции модули из папок на «_», поэтому общий
 * api/_lib/ здесь не работает (MODULE_NOT_FOUND в рантайме) — тот же приём,
 * что с camping-checklist и group-ban.
 *
 * Почему не отдаём это фронту статикой: бандл скачивает кто угодно, а раздел
 * закрытый. Текст уходит клиенту только после проверки прав по initData.
 */
const KB_SECTIONS: Record<string, { title: string; body: string }> = {
  merch: {
    title: '🏅 Вручение фирменного мерча',
    body:
      '<b>ДНК вручения FLINT</b>\n\n' +
      'Церемония держится на четырёх шагах. Главная ошибка — раскачка в начале ' +
      '(«ребята… я постараюсь что-то сказать…»): она съедает весь эффект.\n\n' +
      '<b>1. Энергичный старт, без поиска слов</b>\n' +
      '«Друзья, сфокусируемся! Наступает главный и самый душевный момент нашего выезда!»\n\n' +
      '<b>2. Ценность и конкретная заслуга</b>\n' +
      'Не «он победил», а <i>за что именно</i>: взаимовыручка, лидерство, командный дух, пройденное испытание.\n' +
      '«Евгений сегодня показал не просто отличный результат, а настоящий командный дух, включённость и волю к победе на протяжении всего выезда.»\n\n' +
      '<b>3. Символизм мерча</b>\n' +
      'Джерси — не текстиль, а статус «своего» и отметка личного достижения.\n' +
      '«Эта яркая джерси FLINT — не просто мерч. Это знак признания от команды и символическая „броня“ нашего клуба, которую нужно носить с гордостью.»\n\n' +
      '<b>4. Кульминация и вручение</b>\n' +
      '«Евгений, добро пожаловать в семью FLINT! Держи джерси, ты её честно заработал!» — аплодисменты, рукопожатие, объятия.\n\n' +
      '<b>Невербалика</b>\n' +
      '• Разверни майку логотипом к зрителям и камере <i>до</i> того, как назовёшь имя — это создаёт интригу.\n' +
      '• Смотри на человека и на команду, а не в землю и не в скомканную майку.\n' +
      '• Подзови получателя в центр: вручение должно выглядеть ритуалом, а не передачей вещи из рук в руки.',
  },
  energy: {
    title: '⚡️ Энергия дня: как собирать программу',
    body:
      '<b>Задача выезда — перезагрузка, а не марафон.</b> Программа должна вести энергию, а не ломать её.\n\n' +
      '<b>Порядок блоков</b>\n' +
      '• Активное — в первую половину дня, пока есть силы: маршрут, вода, спорт, испытания.\n' +
      '• Пассивное — вечером: разговоры, костёр, кино.\n' +
      '• <b>После бани не ставить ничего, что требует внимания</b> — кино, лекцию, разбор. После парилки люди засыпают, и пункт срывается.\n' +
      '• Не ставить два активных блока подряд без еды и паузы между ними — на второй у команды не хватит сил.\n' +
      '• После длинного переезда — сначала обустройство и еда, потом активность.\n\n' +
      '<b>Еда под задачу</b>\n' +
      '• Перед активным блоком — лёгкое и углеводное. Тяжёлое и жирное перед нагрузкой убивает темп.\n' +
      '• Плотный приём пищи — после основной активности, а не до неё.\n' +
      '• Вода и перекусы на маршруте закладываются в программу, а не «кто взял, тот взял».\n\n' +
      '<b>Тайминг</b>\n' +
      '• У каждого пункта есть время и ответственный. Пункт без ответственного не поедет.\n' +
      '• Между блоками — люфт 15–30 минут: сборы всегда дольше плана.\n' +
      '• Изменения в программе объявляет организатор в чате события. Молчаливый сдвиг = развалившийся круг: люди приходят к времени, которого уже нет.\n\n' +
      '<i>После Нарочи: программа плыла на ходу, и часть круга просто разошлась спать.</i>',
  },
  roles: {
    title: '🔐 Роли и границы доступа',
    body:
      '<b>Костяк</b> — держит платформу: одобряет события, ведёт аудиторию клуба, имеет панель.\n' +
      'Ни одно мероприятие не появляется на платформе само: организатор готовит его, костяк одобряет.\n\n' +
      '<b>Организатор</b> — ведёт свои события.\n' +
      '• Видит состав ТОЛЬКО своего события, а не базу клуба.\n' +
      '• Общение с участниками — в чате мероприятия. Личные рассылки по базе организатору недоступны: так данные людей не расходятся по рукам.\n' +
      '• Имя организатора видно в карточке события — участник всегда знает, кто отвечает за выезд.\n\n' +
      'Правило простое: доступ к человеку даёт только событие, на которое он сам записался.',
  },
  buddy: {
    title: '🤝 Бади и спорные ситуации',
    body:
      'У каждого участника на событии есть бади — напарник, который держит его в поле зрения от сбора до разъезда.\n\n' +
      '• Бади решает со своим человеком бытовые и спорные вопросы, а не отправляет его к организатору.\n' +
      '• Сломал, потерял, испортил чужое — возмещает сам, в разумный срок и без напоминаний.\n' +
      '• Спор о возмещении ведут бади сторон; организатор подключается, только если они не договорились.\n' +
      '• Несогласие с решением обсуждается с организатором напрямую, а не в кулуарах.\n\n' +
      '<i>Правило появилось после Нарочи: разбитый термос повис в воздухе, потому что «в правилах этого не написано».</i>',
  },
};

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const action = body.action;

    /**
     * ОГРАНИЧИТЕЛИ ПУБЛИЧНЫХ ДЕЙСТВИЙ.
     * До этого у профиля не было ни одного лимита: `gate` можно было
     * перебирать (реф-код — 6 символов), `apply` — заваливать костяк фейковыми
     * заявками с чужими телефонами (на каждого уходит уведомление в личку и в
     * админ-чат), `send_message` — спамить в личку всему клубу.
     */
    const LIMITED: Record<string, { scope: string; max: number; windowMs: number }> = {
      gate: { scope: 'gate', max: 30, windowMs: 10 * 60 * 1000 },
      apply: { scope: 'apply', max: 5, windowMs: 60 * 60 * 1000 },
      send_message: { scope: 'msg', max: 20, windowMs: 10 * 60 * 1000 },
    };
    const lim = typeof action === 'string' ? LIMITED[action] : undefined;
    if (lim) {
      // Ключ лимита — Telegram-аккаунт из initData, а не IP: у мобильных
      // операторов один IP на сотни людей (CGNAT), и чужие заявки съедали лимит.
      // Подделанный id ничего не даёт: initData дальше проверяется подписью.
      let limitKey = clientIp(req);
      try {
        const uid = JSON.parse(new URLSearchParams(String(body?.initData || '')).get('user') || '{}')?.id;
        if (uid) limitKey = `tg:${uid}`;
      } catch { /* нет initData — остаётся IP */ }
      const rl = await rateLimit(lim.scope, limitKey, lim.max, lim.windowMs);
      if (!rl.allowed) {
        res.setHeader('Retry-After', String(rl.retryAfter));
        slog('warn', `rate limit: ${action}`, { ip: clientIp(req), retryAfter: rl.retryAfter });
        return res.status(429).json({ ok: false, error: `Слишком много запросов. Попробуй через ${Math.max(1, Math.ceil(rl.retryAfter / 60))} мин.` });
      }
    }

    /**
     * ДОРОГИЕ ДЕЙСТВИЯ (обращения к Gemini). Квота бесплатного тира — 20
     * запросов в сутки на модель, поэтому пускаем только участника клуба или
     * админ-токен. Раньше эндпоинт был открыт всем, и квоту выжигали чужие.
     */
    const AI_ACTIONS = new Set(['generate', 'generate_schedule', 'receipt', 'recipe']);
    if (typeof action === 'string' && AI_ACTIONS.has(action)) {
      const verdict = await requireMemberOrAdmin(req, body);
      if (verdict !== 'ok') {
        slog('warn', `ИИ-действие без прав: ${action}`, { ip: clientIp(req) });
        return res.status(403).json({ ok: false, error: 'Доступно участникам клуба' });
      }
      const rl = await rateLimit('ai', `u:${String(body?.initData || '').length}:${clientIp(req)}`, 20, 60 * 60 * 1000);
      if (!rl.allowed) {
        res.setHeader('Retry-After', String(rl.retryAfter));
        return res.status(429).json({ ok: false, error: 'Слишком часто. ИИ-квота клуба ограничена — попробуй позже.' });
      }
    }

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
        .select('telegram_id,username,first_name,status,is_core,role,points,gender,birthday,phone')
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
          // Пол и дата рождения нужны интерфейсу: без пола приходится писать
          // «записан(а)» скобкой, а без даты рождения не посчитать возраст —
          // а он у клуба обязателен, событиям 18+ иначе не с чем сверяться.
          gender: (me as any)?.gender || null,
          birthday: (me as any)?.birthday || null,
          hasPhone: Boolean((me as any)?.phone),
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

      // История баллов — как история бонусов в банке: за что и сколько.
      // Журнала может не быть до миграции points_log — тогда просто пусто.
      let pointsHistory: any[] = [];
      try {
        const { data: pl } = await supabase.from('points_log')
          .select('id,points,reason,description,created_at').eq('telegram_id', user.id)
          .order('created_at', { ascending: false }).limit(40);
        pointsHistory = (pl || []).map((x: any) => ({ id: x.id, points: Number(x.points) || 0, reason: x.reason || '', text: x.description || x.reason || 'Баллы', at: x.created_at }));
      } catch { /* журнала нет */ }

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

      /**
       * ЗАДАЧИ КРУГА. Бот вытаскивает обещания из переписки чата
       * («Stanislav: заказать новый термос») и кладёт в tasks — но до сих пор
       * они лежали мёртвым грузом: человек их не видел нигде, кроме одной
       * строки в чате, которая уезжает вверх за десять минут. Отдаём:
       *  • мои — которые я взял и не закрыл;
       *  • свободные — по СВОИМ событиям, чтобы было что взять.
       */
      let tasks: any[] = [];
      try {
        const myEvIds = myEvents.map((e: any) => e.id).filter(Boolean);
        const { data: tRows } = await supabase
          .from('tasks')
          .select('id,event_id,title,taken_by,done,created_at')
          .or(`taken_by.eq.${user.id}${myEvIds.length ? `,event_id.in.(${myEvIds.map((x: string) => `"${x}"`).join(',')})` : ''}`)
          .eq('done', false)
          .order('created_at', { ascending: false })
          .limit(40);
        tasks = (tRows || []).map((t: any) => ({
          id: t.id,
          title: t.title,
          eventId: t.event_id,
          eventTitle: evMap[t.event_id]?.title || null,
          mine: Number(t.taken_by) === Number(user.id),
          takenBy: t.taken_by ? String(t.taken_by) : null,
          createdAt: t.created_at,
        }));
      } catch { /* таблицы может не быть */ }

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
        tasks,
        equipment: myGear || [],
        pointsHistory,
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
     * === TASK: взять задачу или закрыть её ===
     * Задача без кнопки — это просто текст: на Нарочи обещания из чата так и
     * остались обещаниями. Брать можно только задачи по событиям, где человек
     * записан; закрывать — только свои (или свободные, если он их и сделал).
     */
    if (action === 'task_take' || action === 'task_done' || action === 'task_drop') {
      const user = verifyInitData(body.initData);
      if (!user) return res.status(200).json({ ok: false, error: 'not-in-telegram' });

      const taskId = Number(body.taskId);
      if (!Number.isFinite(taskId)) return res.status(200).json({ ok: false, error: 'bad-task' });

      const { data: t } = await supabase
        .from('tasks').select('id,event_id,taken_by,done,title').eq('id', taskId).maybeSingle();
      if (!t) return res.status(200).json({ ok: false, error: 'Задача не найдена' });

      const { data: reg } = await supabase
        .from('registrations').select('id')
        .eq('event_id', (t as any).event_id).eq('telegram_id', user.id).neq('status', 'cancelled').maybeSingle();
      if (!reg) return res.status(200).json({ ok: false, error: 'Это задача чужого события' });

      const owner = Number((t as any).taken_by) || 0;
      if (action === 'task_take') {
        if (owner && owner !== user.id) return res.status(200).json({ ok: false, error: 'Задачу уже взял другой' });
        await supabase.from('tasks').update({ taken_by: user.id }).eq('id', taskId);
      } else if (action === 'task_drop') {
        if (owner !== user.id) return res.status(200).json({ ok: false, error: 'Это не твоя задача' });
        await supabase.from('tasks').update({ taken_by: null }).eq('id', taskId);
      } else {
        if (owner && owner !== user.id) return res.status(200).json({ ok: false, error: 'Закрыть может тот, кто взял' });
        await supabase.from('tasks').update({ done: true, taken_by: owner || user.id }).eq('id', taskId);
      }
      return res.status(200).json({ ok: true });
    }

    /**
     * === RULES_STATE: что человек уже принял ===
     * Гейт спрашивает это на старте, чтобы не гонять по правилам, принятым с
     * другого устройства: localStorage привязан к браузеру, а кодекс — к человеку.
     */
    /**
     * ЗАДАЧИ СОБЫТИЯ — в моменте и на виду у всех.
     * Раньше задачу можно было только «взять» самому из общего списка в
     * профиле. Организатор не мог сказать «Стас — купить уголь до пятницы»,
     * а остальные не видели, что горит. Теперь в карточке события: кто что
     * делает, до какого срока, что просрочено. Назначенному — сообщение в
     * бот, в чат события — короткое «📌 задача для …».
     */
    if (action === 'event_tasks' || action === 'event_task_add' || action === 'event_task_update') {
      const user = verifyInitData(body.initData);
      if (!user) return res.status(200).json({ ok: false, error: 'not-in-telegram' });
      const evId = String(body.eventId || '');
      const { data: me } = await supabase.from('members').select('is_core,role').eq('telegram_id', user.id).maybeSingle();
      const { data: ev } = await supabase.from('events').select('id,title,deputy_id').eq('id', evId).maybeSingle();
      if (!ev) return res.status(200).json({ ok: false, error: 'Событие не найдено' });
      const { data: regs } = await supabase.from('registrations').select('telegram_id,name').eq('event_id', evId).neq('status', 'cancelled');
      const isLead = (me as any)?.is_core === true || ['owner', 'organizer'].includes((me as any)?.role) || Number((ev as any).deputy_id) === user.id;
      const inEvent = (regs || []).some((r: any) => Number(r.telegram_id) === user.id);
      if (!inEvent && !isLead) return res.status(200).json({ ok: false, error: 'Задачи видят участники события' });
      const avatarOf = (id: number) => id > 0 && BOT_TOKEN ? `/api/events?action=avatar&u=${id}&s=${crypto.createHmac('sha256', BOT_TOKEN).update(`avatar:${id}`).digest('hex').slice(0, 16)}` : '';
      const people = (regs || []).filter((r: any) => Number(r.telegram_id) > 0)
        .map((r: any) => ({ id: Number(r.telegram_id), name: r.name || 'Участник', avatar: avatarOf(Number(r.telegram_id)) }));
      const nameById = new Map(people.map((x) => [x.id, x.name]));
      const notify = async (chatId: number, text: string) => {
        if (!BOT_TOKEN || !chatId) return;
        try {
          await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
          });
        } catch { /* уведомление — не повод ронять задачу */ }
      };
      const escT = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const dueText = (iso?: string | null) => {
        if (!iso) return '';
        const d = new Date(iso);
        return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Minsk' });
      };

      /**
       * Добавление: одному, нескольким или «кто возьмёт». Несколько
       * исполнителей — по задаче на каждого: у каждого свой статус.
       * kind='confirm' — «подтвердить участие»: задача на меня, цель — человек
       * (target_id); «Пингануть» шлёт ему кнопки «Подтверждаю / Не еду».
       */
      if (action === 'event_task_add') {
        const kind = body.kind === 'confirm' ? 'confirm' : null;
        const due = body.dueAt && !Number.isNaN(new Date(body.dueAt).getTime()) ? new Date(body.dueAt).toISOString() : null;
        const ids: number[] = (Array.isArray(body.assignees) ? body.assignees : body.assignee ? [body.assignee] : []).map(Number).filter((n: number) => n > 0);
        if (ids.some((id) => !nameById.has(id))) return res.status(200).json({ ok: false, error: 'Назначить можно только участникам события' });
        const who = nameById.get(user.id) || 'Организатор';
        const rows: any[] = [];
        if (kind === 'confirm') {
          if (!ids.length) return res.status(200).json({ ok: false, error: 'Выбери, чьё участие подтвердить' });
          for (const t of ids) rows.push({ event_id: evId, title: `Подтвердить участие: ${nameById.get(t)}`, taken_by: user.id, done: false, created_by: user.id, assigned_by: user.id, due_at: due, kind, target_id: t, helpers: [] });
        } else {
          const title = String(body.title || '').trim().slice(0, 200);
          if (!title) return res.status(200).json({ ok: false, error: 'Что нужно сделать?' });
          for (const a of (ids.length ? ids : [null])) rows.push({ event_id: evId, title, taken_by: a, done: false, created_by: user.id, assigned_by: a ? user.id : null, due_at: due, helpers: [] });
        }
        let ins = await supabase.from('tasks').insert(rows).select('id');
        if (ins.error && /column|schema cache/i.test(ins.error.message)) {
          // Миграция задач v2 не накатана — сохраняем без новых полей.
          ins = await supabase.from('tasks').insert(rows.map(({ due_at, assigned_by, kind: k, target_id, helpers, ...core }: any) => core)).select('id');
        }
        if (ins.error) return res.status(200).json({ ok: false, error: ins.error.message });
        if (kind !== 'confirm') {
          for (const a of ids) if (a !== user.id) {
            await notify(a, `📌 <b>${escT(who)}</b> назначил тебе задачу на «${escT((ev as any).title)}»:\n\n${escT(rows[0].title)}${due ? `\n⏰ до ${escT(dueText(due))}` : ''}\n\nОтметить «готово» — в карточке события, блок «Задачи».`);
          }
          const { data: eg } = await supabase.from('event_groups').select('chat_id').eq('event_id', evId).eq('active', true).maybeSingle();
          if ((eg as any)?.chat_id) {
            await notify(Number((eg as any).chat_id), `📌 Задача${ids.length ? ` для <b>${ids.map((a) => escT(nameById.get(a))).join(', ')}</b>` : ' — кто возьмёт?'}: ${escT(rows[0].title)}${due ? ` · до ${escT(dueText(due))}` : ''}\nПомочь может любой — кнопка «🙋 Помогу» в карточке события.`);
          }
        }
      }

      if (action === 'event_task_update') {
        const taskId = Number(body.taskId);
        const op = String(body.op || '');
        const { data: t } = await supabase.from('tasks').select('id,event_id,taken_by,done,title,created_by').eq('id', taskId).maybeSingle();
        if (!t || String((t as any).event_id) !== evId) return res.status(200).json({ ok: false, error: 'Задача не найдена' });
        const owner = Number((t as any).taken_by) || 0;
        if (op === 'take') {
          if (owner && owner !== user.id) return res.status(200).json({ ok: false, error: 'Задачу уже взял другой' });
          await supabase.from('tasks').update({ taken_by: user.id }).eq('id', taskId);
        } else if (op === 'drop') {
          if (owner !== user.id && !isLead) return res.status(200).json({ ok: false, error: 'Это не твоя задача' });
          await supabase.from('tasks').update({ taken_by: null }).eq('id', taskId);
        } else if (op === 'done' || op === 'undo') {
          if (owner && owner !== user.id && !isLead) return res.status(200).json({ ok: false, error: 'Закрыть может тот, кто взял, или организатор' });
          const patch: any = op === 'done' ? { done: true, taken_by: owner || user.id, done_at: new Date().toISOString() } : { done: false, done_at: null };
          const up = await supabase.from('tasks').update(patch).eq('id', taskId);
          if (up.error && /done_at|column/i.test(up.error.message)) { delete patch.done_at; await supabase.from('tasks').update(patch).eq('id', taskId); }
          const creator = Number((t as any).created_by) || 0;
          if (op === 'done' && creator && creator !== user.id) {
            await notify(creator, `✅ <b>${escT(nameById.get(user.id) || 'Участник')}</b> выполнил задачу «${escT((t as any).title)}» (${escT((ev as any).title)}).`);
          }
        } else if (op === 'help') {
          // «Готов помочь»: любой участник вызывается к чужой задаче с пометкой.
          const { data: full } = await supabase.from('tasks').select('helpers').eq('id', taskId).maybeSingle();
          const list: any[] = Array.isArray((full as any)?.helpers) ? (full as any).helpers : [];
          const note = String(body.note || '').trim().slice(0, 140);
          const next = list.some((h: any) => Number(h.id) === user.id)
            ? list.filter((h: any) => Number(h.id) !== user.id)
            : [...list, { id: user.id, name: nameById.get(user.id) || 'Участник', note }];
          const up = await supabase.from('tasks').update({ helpers: next }).eq('id', taskId);
          if (up.error) return res.status(200).json({ ok: false, error: 'Нужна миграция задач (колонка helpers) — см. инструкцию' });
          if (owner && owner !== user.id && next.length > list.length) {
            await notify(owner, `🙋 <b>${escT(nameById.get(user.id) || 'Участник')}</b> готов помочь с задачей «${escT((t as any).title)}»${note ? `: ${escT(note)}` : ''}. Договоритесь в личке или в чате события.`);
          }
        } else if (op === 'ping') {
          // «Пингануть»: цели приходит «Подтверждаю / Не еду» — задача
          // закроется сама, когда человек ответит.
          const { data: full } = await supabase.from('tasks').select('kind,target_id').eq('id', taskId).maybeSingle();
          const target = Number((full as any)?.target_id || 0);
          if ((full as any)?.kind !== 'confirm' || !target) return res.status(200).json({ ok: false, error: 'Это не задача подтверждения' });
          if (!BOT_TOKEN) return res.status(200).json({ ok: false, error: 'Бот недоступен' });
          const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: target, parse_mode: 'HTML',
              text: `👋 <b>${escT(nameById.get(user.id) || 'Организатор')}</b> просит подтвердить участие в «<b>${escT((ev as any).title)}</b>». Едешь?`,
              reply_markup: { inline_keyboard: [[
                { text: '✅ Подтверждаю', callback_data: `cfm_${taskId}_y` },
                { text: '❌ Не еду', callback_data: `cfm_${taskId}_n` },
              ]] },
            }),
          }).then((x) => x.json()).catch(() => null);
          if (!r?.ok) return res.status(200).json({ ok: false, error: 'Не дошло: человек не открывал бота. Напиши или позвони ему сам.' });
        } else if (op === 'delete') {
          if (!isLead && Number((t as any).created_by) !== user.id) return res.status(200).json({ ok: false, error: 'Удалить может автор или организатор' });
          await supabase.from('tasks').delete().eq('id', taskId);
        } else return res.status(200).json({ ok: false, error: 'bad-op' });
      }

      let q = await supabase.from('tasks').select('id,title,taken_by,done,created_by,due_at,created_at,helpers,kind,target_id').eq('event_id', evId).order('done').order('created_at');
      if (q.error) q = await supabase.from('tasks').select('id,title,taken_by,done,created_by,due_at,created_at').eq('event_id', evId).order('done').order('created_at') as any;
      if (q.error) q = await supabase.from('tasks').select('id,title,taken_by,done,created_by,created_at').eq('event_id', evId).order('done').order('created_at') as any;
      const tasks = (q.data || []).map((t: any) => ({
        id: t.id, title: t.title, done: !!t.done, dueAt: t.due_at || null,
        assignee: t.taken_by ? { id: Number(t.taken_by), name: nameById.get(Number(t.taken_by)) || 'Участник', avatar: avatarOf(Number(t.taken_by)) } : null,
        mine: Number(t.taken_by) === user.id, canManage: isLead || Number(t.created_by) === user.id,
        kind: t.kind || null,
        target: t.target_id ? { id: Number(t.target_id), name: nameById.get(Number(t.target_id)) || 'Участник', avatar: avatarOf(Number(t.target_id)) } : null,
        helpers: (Array.isArray(t.helpers) ? t.helpers : []).map((h: any) => ({ id: Number(h.id), name: h.name, note: h.note || '', avatar: avatarOf(Number(h.id)) })),
      }));
      return res.status(200).json({ ok: true, tasks, people, isLead, me: user.id });
    }

    if (action === 'rules_state') {
      const user = verifyInitData(body.initData);
      if (!user) return res.status(200).json({ ok: false, error: 'not-in-telegram' });
      const { data: me } = await supabase
        .from('members').select('prefs').eq('telegram_id', user.id).maybeSingle();
      const ra: any = (me as any)?.prefs?.rules_accepted || null;
      return res.status(200).json({ ok: true, map: (ra && ra.map) || {}, at: ra?.at || null });
    }

    /**
     * === KB: база знаний организатора в Mini App ===
     * Требование владельца (19.08): база знаний должна быть в приложении и
     * открываться ТОЛЬКО костяку и организаторам. Проверяем права на сервере,
     * а не прячем вкладку на клиенте: спрятанная вкладка — не защита.
     */
    if (action === 'kb') {
      const user = verifyInitData(body.initData);
      if (!user) return res.status(200).json({ ok: false, error: 'not-in-telegram' });

      const { data: me } = await supabase
        .from('members').select('is_core,role,status').eq('telegram_id', user.id).maybeSingle();
      const canLead = !!me && ((me as any).is_core === true || (me as any).role === 'organizer' || (me as any).role === 'owner');
      if (!canLead) return res.status(200).json({ ok: false, error: 'Раздел для организаторов и костяка' });

      return res.status(200).json({
        ok: true,
        sections: Object.entries(KB_SECTIONS).map(([key, v]) => ({ key, title: v.title, body: v.body })),
      });
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
      /**
       * `map` = {ключ правила: версия}. Нужен, чтобы при добавлении ОДНОГО
       * правила переспрашивать только его, а не весь кодекс заново: раньше
       * версия была общая, и люди бросали запись на пятом экране из восьми.
       * Старое поле version/at оставляем — на него смотрят админка и «Штурман».
       */
      const prevMap: Record<string, number> = (prefs.rules_accepted?.map && typeof prefs.rules_accepted.map === 'object')
        ? prefs.rules_accepted.map : {};
      const incoming: Record<string, number> = (body.map && typeof body.map === 'object') ? body.map : {};
      const map: Record<string, number> = { ...prevMap };
      for (const [k, v] of Object.entries(incoming).slice(0, 40)) {
        const key = String(k).slice(0, 40);
        map[key] = Math.max(Number(map[key] || 0), Number(v) || 0);
      }
      prefs.rules_accepted = { version, at: new Date().toISOString(), map };
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
      // Жёсткая граница длины: в Telegram текст режется на 4096, а в базе
      // хранится 4000. Раньше лимит был только на записи в БД, а в уведомление
      // каждому костяку уходило всё — длинную «простыню» можно было гонять как
      // спам-бомбу по личкам. Режем один раз и используем везде.
      const safeText = text.slice(0, 4000);
      if (safeText.length < 2) return res.status(200).json({ ok: false, error: 'Слишком короткое сообщение' });

      const { data: me } = await supabase
        .from('members').select('first_name,username,status').eq('telegram_id', user.id).maybeSingle();
      // Заблокированному нет смысла открывать канал в админку.
      if ((me as any)?.status === 'blocked') return res.status(200).json({ ok: false, error: 'Отправка недоступна' });

      const author = `${(me as any)?.first_name || user.first_name || ''}${(me as any)?.username ? ' @' + (me as any).username : ''}`.trim()
        || `id${user.id}`;

      const { error } = await supabase.from('support_messages').insert({
        telegram_id: user.id, direction: 'in', text: safeText, from_name: author,
      });
      if (error) return res.status(200).json({ ok: false, error: error.message });

      /**
       * Уведомляем костяк. НЕ только в админ-чат: если бота из группы убрали
       * или её id устарел, сообщение видел бы только тот, кто зайдёт в админку.
       * Поэтому дублируем в личку каждому костяку и возвращаем, дошло ли.
       */
      let notified = 0;
      if (BOT_TOKEN) {
        const body2 = `💬 <b>Сообщение из профиля (сайт)</b>\nОт: ${escHtml(author)} (id ${user.id})\n\n<i>${escHtml(safeText.slice(0, 1500))}</i>`;
        const markup = { inline_keyboard: [[{ text: '✍️ Ответить', callback_data: `reply_${user.id}` }]] };
        const targets: (string | number)[] = [];
        const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID || '-1003935660570'; // как в webhook.ts
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

    /**
     * РЕЙТИНГ КЛУБА — таблица по очкам и «твоя позиция».
     * Очки и уровни в клубе давно есть, но человек видел только свои цифры:
     * не с чем сравнить, нет повода прийти ещё раз. Подсмотрено у 360 Padel:
     * лидеры сверху и закреплённая плашка «ты — на N-м месте».
     * Только для участников клуба (подпись Telegram), наружу список не отдаём.
     */
    /**
     * МОЙ ПРИГЛАСИТЕЛЬНЫЙ на событие (если клуб выписал его на меня).
     *   op='status' — есть ли билет: номер, всего, код, забрал/использован;
     *   op='send'   — бот присылает именной PDF мне в личку (почистил чат —
     *                 нажал ещё раз). Чужой билет так получить нельзя: ищем
     *                 строго по подписанному telegram id.
     */
    if (action === 'my_ticket') {
      const user = verifyInitData(body.initData);
      if (!user) return res.status(200).json({ ok: false, error: 'Открой приложение из Telegram' });
      const eventId = String(body.eventId || '');
      const { data: row } = await supabase.from('app_config').select('value').eq('key', `club_tickets:${eventId}`).maybeSingle();
      let pool: any = null;
      try { pool = (row as any)?.value ? JSON.parse((row as any).value) : null; } catch { /* битый пул */ }
      if (!pool) return res.status(200).json({ ok: true, pool: false });
      const t = (pool.tickets || []).find((x: any) => Number(x.assignedTo) === Number(user.id));
      const free = (pool.tickets || []).filter((x: any) => !x.assignedTo).length;
      if (!t) return res.status(200).json({ ok: true, pool: true, total: pool.total, free, ticket: null });
      // Временная ссылка на файл (10 минут) — для тех, кому бот не может
      // написать: человек скачивает PDF прямо из приложения.
      const signed = async () => {
        const fname = `Пригласительный_${t.no}_${t.code}.pdf`;
        const { data: su } = await supabase.storage.from('club-tickets').createSignedUrl(t.issued, 600, { download: fname });
        return { url: (su as any)?.signedUrl || '', fileName: fname };
      };
      if (body.op === 'download') {
        t.openedAt = t.openedAt || new Date().toISOString();
        await supabase.from('app_config').upsert({ key: `club_tickets:${eventId}`, value: JSON.stringify(pool) }, { onConflict: 'key' });
        return res.status(200).json({ ok: true, ...(await signed()) });
      }
      if (body.op === 'send') {
        const { data: file } = await supabase.storage.from('club-tickets').download(t.issued);
        if (!file) return res.status(200).json({ ok: false, error: 'Файл билета не найден — напиши организатору' });
        const { data: ev } = await supabase.from('events').select('title,date_label,location').eq('id', eventId).maybeSingle();
        const form = new FormData();
        form.append('chat_id', String(user.id));
        form.append('parse_mode', 'HTML');
        form.append('caption',
          `🎟 <b>Твой пригласительный — ${escHtml(String((ev as any)?.title || 'событие'))}</b>\n№ ${t.no} из ${pool.total} · код <code>${escHtml(t.code)}</code>\n\n` +
          ((ev as any)?.date_label ? `📆 ${escHtml((ev as any).date_label)}\n` : '') + ((ev as any)?.location ? `📍 ${escHtml((ev as any).location)}\n` : '') +
          `\nНа входе покажи QR из файла. Билет одноразовый и именной — не пересылай его.`);
        form.append('reply_markup', JSON.stringify({ inline_keyboard: [[{ text: '🎟 Прислать ещё раз', callback_data: `tkt_${eventId}` }]] }));
        form.append('document', new Blob([await file.arrayBuffer()], { type: 'application/pdf' }), `Пригласительный_${t.no}_${t.code}.pdf`);
        const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, { method: 'POST', body: form });
        const j: any = await r.json().catch(() => ({}));
        if (!j?.ok) {
          // Бот не может написать первым (человек не нажимал «Старт») —
          // отдаём файл прямо в приложение, не оставляем без билета.
          return res.status(200).json({ ok: false, code: 'need_start', error: 'Бот пока не может тебе написать — скачиваю файл прямо сюда', ...(await signed()) });
        }
        t.sentAt = t.sentAt || new Date().toISOString();
        delete t.sendError;
        t.openedAt = t.openedAt || new Date().toISOString();
        t.resentCount = (t.resentCount || 0) + 1;
        await supabase.from('app_config').upsert({ key: `club_tickets:${eventId}`, value: JSON.stringify(pool) }, { onConflict: 'key' });
      }
      return res.status(200).json({
        ok: true, pool: true, total: pool.total, free,
        ticket: { no: t.no, code: t.code, name: t.assignedName || '', received: !!t.openedAt, used: !!t.usedAt },
      });
    }

    if (action === 'leaderboard') {
      const POINT_REASON: Record<string, string> = {
        attend: '🏕 Участие в событиях', referral: '🤝 Привёл друзей', share_car: '🚗 Подвёз на машине',
        share_tent: '⛺ Место в палатке', share_gear: '🎒 Одолжил снаряжение', checkin: '🔥 Чек-ины челленджа',
        contribution: '💪 Поступки на событиях', fundraiser: '💚 Вклад в сбор', 'fundraiser-rollback': '↩️ Отмена вклада',
        manual: '⭐ Начислено костяком', legacy: '📦 Начислено до журнала',
        attendance: '🏕 Участие в событиях', invite: '🤝 Привёл друзей',
        photos: '📸 Запечатлел моменты',
      };
      const user = verifyInitData(body.initData);
      if (!user) return res.status(200).json({ ok: false, error: 'not-in-telegram' });
      const { data: members } = await supabase
        .from('members').select('telegram_id,first_name,username,points,is_core')
        .eq('status', 'approved').order('points', { ascending: false }).limit(500);
      const { data: att } = await supabase.from('registrations').select('telegram_id').eq('attended', true).limit(5000);
      const trips = new Map<number, number>();
      for (const r of att || []) trips.set(Number((r as any).telegram_id), (trips.get(Number((r as any).telegram_id)) || 0) + 1);
      // Равные баллы раньше давали одно место на всех: у двадцати человек с
      // 0 баллов слева стояло одно и то же «#12», а медалей 🥇 могло быть две.
      // Теперь места сквозные 1, 2, 3…; при равенстве выше тот, у кого больше
      // выездов, дальше — по имени (стабильно между открытиями).
      const sorted = [...(members || [])].sort((a: any, b: any) =>
        (Number(b.points) || 0) - (Number(a.points) || 0)
        || (trips.get(Number(b.telegram_id)) || 0) - (trips.get(Number(a.telegram_id)) || 0)
        || String(a.first_name || a.username || '').localeCompare(String(b.first_name || b.username || ''), 'ru'));
      const all = sorted.map((m: any, i: number) => ({
        place: i + 1,
        id: String(m.telegram_id),
        name: m.first_name || (m.username ? `@${m.username}` : 'Участник'),
        points: Number(m.points) || 0,
        level: Math.floor((Number(m.points) || 0) / 500) + 1,
        trips: trips.get(Number(m.telegram_id)) || 0,
        avatar: avatarOf(Number(m.telegram_id)),
        me: Number(m.telegram_id) === Number(user.id),
      }));
      const me = all.find((m) => m.me) || null;
      // ПОЧЕМУ СТОЛЬКО БАЛЛОВ: журнал начислений по участникам списка. Раньше
      // рейтинг показывал только цифру — непонятно, за что человек впереди.
      // Тянем весь журнал и режем на куски по человеку (запросов на человека — 0).
      const topIds = new Set([...all.slice(0, 30), ...(me ? [me] : [])].map((m) => m.id));
      const reasons: Record<string, { points: number; text: string }[]> = {};
      try {
        const { data: pl } = await supabase
          .from('points_log').select('telegram_id,points,reason,description')
          .in('telegram_id', [...topIds].map(Number)).limit(1000);
        // Группируем по причине: «Участие в событиях ×3 — 300», а не восемь
        // одинаковых строк. Подробности (какие события) — в скобках.
        const groups: Record<string, Record<string, { points: number; n: number; items: string[] }>> = {};
        for (const row of pl || []) {
          const k = String((row as any).telegram_id);
          if (!topIds.has(k)) continue;
          const reason = String((row as any).reason || 'other');
          const g = ((groups[k] ||= {})[reason] ||= { points: 0, n: 0, items: [] });
          g.points += Number((row as any).points) || 0;
          g.n += 1;
          const d = String((row as any).description || '').replace(/^(Участие|Привёл друга|Одолжил|Поступок на событии):\s*/, '');
          if (d && g.items.length < 4) g.items.push(d.slice(0, 50));
        }
        for (const [k, byReason] of Object.entries(groups)) {
          reasons[k] = Object.entries(byReason)
            .map(([reason, g]) => ({
              points: g.points,
              text: `${POINT_REASON[reason] || reason}${g.n > 1 ? ` ×${g.n}` : ''}${g.items.length && reason !== 'legacy' ? ` (${g.items.join(', ')}${g.n > g.items.length ? '…' : ''})` : ''}`,
            }))
            .sort((a, b) => b.points - a.points);
        }
      } catch { /* журнала ещё нет до миграции — рейтинг и так работает */ }
      return res.status(200).json({ ok: true, top: all.slice(0, 30), me, total: all.length, reasons });
    }

    // === MY_EVENTS (история событий участника) ===
    /**
     * СНАРЯЖЕНИЕ В ПРОФИЛЕ.
     * Панель ходила в /api/equipment, а тот пускает только по серверному
     * JWT_SECRET — у участника в Mini App его нет, поэтому любое «добавить» и
     * «показать» получало 401: снаряжение нельзя было ни завести, ни увидеть.
     * Теперь личное снаряжение живёт здесь, под подписью Telegram.
     */
    if (typeof action === 'string' && action.startsWith('gear_')) {
      const user = verifyInitData(body.initData);
      if (!user) return res.status(401).json({ error: 'Открой приложение из Telegram' });
      const { data: me } = await supabase.from('members').select('status,is_core').eq('telegram_id', user.id).maybeSingle();
      if (!me || !((me as any).is_core === true || (me as any).status === 'approved')) return res.status(403).json({ error: 'Только для участников клуба' });
      const CONDITIONS = ['perfect', 'good', 'worn', 'damaged'];
      const shapeGear = (g: any) => ({
        id: g.id, item: g.item, quantity: Number(g.quantity) || 1, category: g.category || 'other',
        condition: CONDITIONS.includes(g.condition) ? g.condition : 'good', price: Number(g.price) || 0,
        photoUrl: g.photo_url || '', description: g.description || '', shareable: g.access_level === 'all',
      });

      if (action === 'gear_mine') {
        const { data, error } = await supabase.from('member_equipment').select('*').eq('telegram_id', user.id).order('updated_at', { ascending: false });
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ items: (data || []).map(shapeGear) });
      }

      /**
       * ПРОСЬБА ПОДЕЛИТЬСЯ ВЕЩЬЮ.
       *
       * Человек увидел у круга «Палатка Naturehike» и хочет её на выезд. Жмёт
       * «Попросить» — и хозяину вещи падает уведомление в Telegram.
       *
       * Раньше механика жила только в api/equipment.ts (action=transfer), но там
       * уведомление уходило ПОЛУЧАТЕЛЮ, а не владельцу, и подтверждение
       * ПЕРЕДАВАЛО вещь (удалял у хозяина, создавал у просителя). Для «поделиться»
       * это неверно: вещь остаётся у хозяина, он просто разрешает ей пользоваться.
       */
      if (action === 'gear_request') {
        const equipmentId = Number(body.equipmentId) || 0;
        const ownerId = Number(body.ownerId) || 0;
        const itemName = String(body.itemName || '').trim().slice(0, 80);
        const note = String(body.note || '').trim().slice(0, 300);
        if (!equipmentId || !ownerId || !itemName) return res.status(400).json({ error: 'Не хватает данных: нужны вещь и владелец' });
        if (ownerId === user.id) return res.status(400).json({ error: 'Это твоя вещь — её и так не надо просить' });

        // Не плодим одинаковые просьбы: если такая уже висит — просто скажем.
        const { data: dupes } = await supabase
          .from('equipment_transfers').select('id')
          .eq('equipment_id', equipmentId).eq('to_telegram_id', user.id).eq('status', 'pending').limit(1);
        if ((dupes || []).length) return res.status(200).json({ ok: true, already: true });

        const { data: created, error: insErr } = await supabase.from('equipment_transfers').insert({
          equipment_id: equipmentId,
          from_telegram_id: ownerId,
          to_telegram_id: user.id,
          item_name: itemName,
          quantity: 1,
          status: 'pending',
          created_at: new Date().toISOString(),
        }).select('id').single();
        if (insErr) return res.status(500).json({ error: insErr.message });

        if (BOT_TOKEN && ownerId > 0) {
          try {
            const who = (me as any)?.first_name || `id ${user.id}`;
            const text =
              `🙋 <b>${escHtml(itemName)}</b>\n\n` +
              `${escHtml(who)} просит по твоей вещи — скажи, можешь ли поделиться.\n` +
              (note ? `\n<i>${escHtml(note)}</i>\n` : '') +
              `\nОтветить — в профиле, раздел «Снаряжение».`;
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: ownerId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
            });
          } catch { /* уведомление не должно ронять заявку */ }
        }
        return res.status(200).json({ ok: true, id: (created as any).id });
      }

      /**
       * АКТ ПРИЁМА: «ВЗЯЛ».
       *
       * Раньше считалось был один сцепая — или сколько разов. Но
       * собратиь вещь нельзя: ответа «да» — и никто не понято,
       * что вещь у кого-то лежит.
       *
       * Теперь принимает передаче с аттачением в личном обраще и отказом, но
       * фактически не было — пока и не в обязанель вообще не точности.
       */
      if (action === 'gear_take') {
        const equipmentId = Number(body.equipmentId) || 0;
        const note = String(body.note || '').trim().slice(0, 300);
        const photo = body.photo ? String(body.photo) : '';
        if (!equipmentId) return res.status(400).json({ error: 'Не указана вещь' });
        const { data: g } = await supabase.from('member_equipment').select('*').eq('id', equipmentId).maybeSingle();
        if (!g) return res.status(404).json({ error: 'Вещь не найдена' });
        const owner = Number(g.telegram_id);
        if (owner === user.id) return res.status(400).json({ error: 'Это твоя вещь' });

        // Одновременно в запросе: вещь может лежать только у одного владельца,
        // и второй попытка установит нельзя сравнять самолецы с ерой.
        const { data: busy } = await supabase
          .from('equipment_transfers').select('id')
          .eq('equipment_id', equipmentId).eq('status', 'taken').limit(1);
        if ((busy || []).length) return res.status(409).json({ error: 'Вещь уже взяты — дай больше не получать' });

        const { error: insErr } = await supabase.from('equipment_transfers').insert({
          equipment_id: equipmentId,
          from_telegram_id: owner,
          to_telegram_id: user.id,
          item_name: String(g.item || 'вещь').slice(0, 80),
          quantity: 1, status: 'taken', note,
          taken_photo: photo || null,
          created_at: new Date().toISOString(),
          taken_at: new Date().toISOString(),
        });
        if (insErr) return res.status(500).json({ error: insErr.message });

        if (BOT_TOKEN && owner > 0) {
          try {
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: owner,
                text: `📦 <b>${escHtml(String(g.item || 'вещь'))}</b>
\n${escHtml((me as any)?.first_name || 'Участник')} взял у себя.` +
                  (note ? `\n<i>${escHtml(note)}</i>` : ''),
                parse_mode: 'HTML', disable_web_page_preview: true,
              }),
            });
          } catch { /* уведомление не должно ронять передачу */ }
        }
        return res.status(200).json({ ok: true });
      }

      if (action === 'gear_save') {
        const g = body.gear || {};
        const item = String(g.item || '').trim().slice(0, 80);
        if (!item) return res.status(400).json({ error: 'Назови вещь' });
        // Фото: dataURL с телефона → в хранилище; готовую ссылку оставляем как есть.
        let photoUrl = String(g.photoUrl || '').slice(0, 500);
        const m = /^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(g.photo || ''));
        if (m) {
          const bin = Buffer.from(m[2], 'base64');
          if (bin.length > 4_000_000) return res.status(400).json({ error: 'Фото больше 4 МБ' });
          const path = `gear/${user.id}-${Date.now().toString(36)}.${m[1] === 'image/png' ? 'png' : 'jpg'}`;
          const up = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/event-images/${path}`, {
            method: 'POST',
            headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY || '', Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY || ''}`, 'Content-Type': m[1], 'x-upsert': 'true' },
            body: bin,
          });
          if (!up.ok) return res.status(500).json({ error: 'Не удалось сохранить фото' });
          photoUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/event-images/${path}`;
        }
        const row: any = {
          telegram_id: user.id, item,
          quantity: Math.max(1, Math.min(99, Number(g.quantity) || 1)),
          category: String(g.category || 'other').slice(0, 30),
          condition: CONDITIONS.includes(g.condition) ? g.condition : 'good',
          price: Math.max(0, Number(g.price) || 0),
          photo_url: photoUrl || null,
          description: String(g.description || '').slice(0, 300) || null,
          access_level: g.shareable ? 'all' : 'owner',
          updated_at: new Date().toISOString(),
        };
        const q = g.id
          ? supabase.from('member_equipment').update(row).eq('id', g.id).eq('telegram_id', user.id)
          : supabase.from('member_equipment').upsert(row, { onConflict: 'telegram_id,item' });
        const { data, error } = await q.select('*').single();
        if (error) return res.status(500).json({ error: /duplicate/i.test(error.message) ? 'Такая вещь у тебя уже есть' : error.message });
        return res.status(200).json({ ok: true, item: shapeGear(data) });
      }

      if (action === 'gear_delete') {
        const { error } = await supabase.from('member_equipment').delete().eq('id', body.id).eq('telegram_id', user.id);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ ok: true });
      }

      /** Мои заявки: кому я написал и кто написал мне (в обе стороны). */
      if (action === 'gear_requests') {
        const { data: rows } = await supabase
          .from('equipment_transfers').select('*')
          .or(`from_telegram_id.eq.${user.id},to_telegram_id.eq.${user.id}`)
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(60);
        const otherIds = [...new Set((rows || []).map((r: any) => (
          Number(r.from_telegram_id) === user.id ? Number(r.to_telegram_id) : Number(r.from_telegram_id)
        )).filter((n: number) => n > 0))];
        const { data: ppl } = otherIds.length
          ? await supabase.from('members').select('telegram_id,first_name,username').in('telegram_id', otherIds)
          : { data: [] };
        const byId = new Map((ppl || []).map((p: any) => [Number(p.telegram_id), p]));
        const nameOf = (id: number) => {
          const p: any = byId.get(Number(id)) || {};
          return {
            id: Number(id),
            name: p.first_name || (p.username ? `@${p.username}` : 'Участник'),
            username: p.username || '',
            avatar: avatarOf(Number(id)),
          };
        };
        return res.status(200).json({
          incoming: (rows || []).filter((r: any) => Number(r.from_telegram_id) === user.id)
            .map((r: any) => ({ id: r.id, item: r.item_name, from: nameOf(Number(r.to_telegram_id)) })),
          outgoing: (rows || []).filter((r: any) => Number(r.to_telegram_id) === user.id)
            .map((r: any) => ({ id: r.id, item: r.item_name, to: nameOf(Number(r.from_telegram_id)) })),
        });
      }

      /**
       * Ответ владельца на просьбу. Вещь НЕ переходит: он просто разрешает
       * пользоваться. Прежний confirm-transfer в api/equipment.ts переносил
       * владение, а это ломало учёт — вещь пропадала у хозяина навсегда.
       */
      if (action === 'gear_request_respond') {
        const id = Number(body.id) || 0;
        const accept = body.accept === true;
        if (!id) return res.status(400).json({ error: 'Нет id заявки' });
        const { data: row } = await supabase.from('equipment_transfers').select('*').eq('id', id).maybeSingle();
        if (!row) return res.status(404).json({ error: 'Заявка не найдена' });
        if (Number(row.from_telegram_id) !== user.id) return res.status(403).json({ error: 'Это не твоя заявка' });
        const { error: upErr } = await supabase.from('equipment_transfers').update({
          status: accept ? 'confirmed' : 'declined',
          confirmed_at: accept ? new Date().toISOString() : null,
          declined_at: accept ? null : new Date().toISOString(),
        }).eq('id', id);
        if (upErr) return res.status(500).json({ error: upErr.message });

        /**
         * «Поделился вещью» — поступок, за который клуб благодарит баллами.
         * Один раз на заявку: повторное «разрешить» по той же заявке не платит.
         */
        if (accept && row.status !== 'confirmed') {
          const GEAR_POINTS = 10;
          try {
            const { data: om } = await supabase.from('members').select('points').eq('telegram_id', user.id).maybeSingle();
            await supabase.from('members').update({ points: Number((om as any)?.points || 0) + GEAR_POINTS }).eq('telegram_id', user.id);
            const { data: tm } = await supabase.from('members').select('first_name').eq('telegram_id', Number(row.to_telegram_id)).maybeSingle();
            await supabase.from('points_log').insert({
              telegram_id: user.id, event_id: null, reason: 'share_gear', points: GEAR_POINTS,
              description: `Одолжил: ${String(row.item_name || 'вещь').slice(0, 60)} → ${(tm as any)?.first_name || 'участнику'}`,
            });
          } catch { /* баллы — бонус, не роняем ответ */ }
        }

        if (BOT_TOKEN) {
          try {
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: Number(row.to_telegram_id), parse_mode: 'HTML',
                text: accept
                  ? `✅ <b>${escHtml(row.item_name)}</b> — ${escHtml((me as any)?.first_name || 'Владелец')} разрешил(а) пользоваться. Спишись и договорись о датах.`
                  : `😔 По вещи <b>${escHtml(row.item_name)}</b> отказали. На выезд придётся взять своё или посмотреть склад клуба.`,
              }),
            });
          } catch { /* не роняем ответ */ }
        }
        return res.status(200).json({ ok: true });
      }

      /**
       * «Что есть у круга»: вещи участников, которыми они готовы делиться, и
       * имущество клуба. Прежде чем покупать палатку — видно, у кого она есть.
       */
      if (action === 'gear_circle') {
        const { data: shared } = await supabase.from('member_equipment').select('*').eq('access_level', 'all').neq('telegram_id', user.id).limit(200);
        const ownerIds = [...new Set((shared || []).map((g: any) => Number(g.telegram_id)))];
        const { data: owners } = ownerIds.length ? await supabase.from('members').select('telegram_id,first_name,username').in('telegram_id', ownerIds) : { data: [] };
        const byId = new Map((owners || []).map((o: any) => [Number(o.telegram_id), o]));
        const avatarOf = (id: number) => BOT_TOKEN ? `/api/events?action=avatar&u=${id}&s=${crypto.createHmac('sha256', BOT_TOKEN).update(`avatar:${id}`).digest('hex').slice(0, 16)}` : '';
        const { data: inv } = await supabase.from('app_config').select('value').eq('key', 'club_inventory').maybeSingle();
        let club: any[] = [];
        try { club = JSON.parse(String((inv as any)?.value || '[]')); } catch { club = []; }
        // Люди клуба с фото — для «у кого сейчас», «чья» и «кто вложился».
        const { data: ppl } = await supabase.from('members').select('telegram_id,first_name,username,status,is_core').or('status.eq.approved,is_core.eq.true').limit(400);
        const people = (ppl || []).map((m: any) => ({ id: Number(m.telegram_id), name: m.first_name || (m.username ? `@${m.username}` : 'Участник'), username: m.username || '', avatar: avatarOf(Number(m.telegram_id)) }));
        const pById = new Map(people.map((x) => [x.id, x]));
        const person = (id: any, name?: any) => {
          const n = Number(id) || 0; const p = n ? pById.get(n) : null;
          return p || (name ? { id: n || null, name: String(name), username: '', avatar: n ? avatarOf(n) : '' } : null);
        };
        club = club.map((it: any) => ({
          ...it,
          holder: person(it.holderId, it.holderName),
          owner: person(it.ownerId, it.ownerName),
          contributors: (Array.isArray(it.contributors) ? it.contributors : []).map((c: any) => ({ ...c, avatar: c.tgId ? avatarOf(Number(c.tgId)) : '' })),
          mine: Number(it.holderId) === user.id || Number(it.ownerId) === user.id,
        }));
        return res.status(200).json({
          people,
          shared: (shared || []).map((g: any) => {
            const o: any = byId.get(Number(g.telegram_id)) || {};
            return {
              ...shapeGear(g),
              // id нужен для заявки «Попросить»: по нему мы ищем вещь в
              // equipment_transfers и пишем владельцу.
              owner: {
                id: Number(g.telegram_id),
                name: o.first_name || (o.username ? `@${o.username}` : 'Участник'),
                username: o.username || '',
                avatar: avatarOf(Number(g.telegram_id)),
              },
            };
          }),
          club,
        });
      }
      /**
       * Вещь клуба / чужая вещь у меня на руках. «Олег передал мне ракетку,
       * сетку и три мяча» раньше жило только в памяти. Теперь участник сам
       * отмечает: что, чьё, у кого сейчас и кто на неё скидывался. Реестр тот
       * же, что видит бот (app_config.club_inventory). Править запись может
       * тот, у кого вещь, её владелец или костяк.
       */
      /**
       * Запрос на ВЕЩЬ КЛУБА.
       *
       * Раньше «Попросить» работал только для личных вещей участников: у
       * склада клуба не было ни кнопки, ни адресата. Именно поэтому вопрос
       * «нажал на склад клуба — на мангал, а спросить некого» оставался без
       * ответа. Адресат — тот, у кого вещь сейчас на руках, иначе костяк.
       */
      if (action === 'gear_club_request') {
        const KEY = 'club_inventory';
        const { data: inv } = await supabase.from('app_config').select('value').eq('key', KEY).maybeSingle();
        let items: any[] = [];
        try { items = JSON.parse(String((inv as any)?.value || '[]')); } catch { items = []; }
        const it = items.find((x: any) => x.id === String(body.id || ''));
        if (!it) return res.status(404).json({ error: 'Вещь не найдена' });
        if (it.holderId === user.id) return res.status(400).json({ error: 'Она уже у тебя' });

        // Если вещь просто стоит на складе (никто её не держит), писать
        // некому — уведомление уходит костяку.
        const target = Number(it.holderId) || Number(process.env.TELEGRAM_ADMIN_CHAT_ID) || 0;
        const note = String(body.note || '').trim().slice(0, 300);
        if (target > 0 && BOT_TOKEN) {
          const who = (me as any)?.first_name || `id ${user.id}`;
          try {
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: target,
                text: `🙋 <b>${escHtml(it.title)}</b>\n\n${escHtml(who)} просит вещь из склада клуба.` +
                  (note ? `\n<i>${escHtml(note)}</i>` : '') +
                  `\n\nПередать или нет — в профиле, раздел «Снаряжение».`,
                parse_mode: 'HTML', disable_web_page_preview: true,
              }),
            });
          } catch { /* уведомление не должно ронять заявку */ }
        }
        return res.status(200).json({ ok: true });
      }

      if (action === 'gear_club_save' || action === 'gear_club_delete') {
        const KEY = 'club_inventory';
        const { data: inv } = await supabase.from('app_config').select('value').eq('key', KEY).maybeSingle();
        let items: any[] = [];
        try { items = JSON.parse(String((inv as any)?.value || '[]')); } catch { items = []; }
        const isCoreMe = (me as any).is_core === true;
        const canEdit = (it: any) => isCoreMe || Number(it.holderId) === user.id || Number(it.ownerId) === user.id;
        if (action === 'gear_club_delete') {
          const i = items.findIndex((x: any) => x.id === String(body.id));
          if (i < 0) return res.status(404).json({ error: 'Вещь не найдена' });
          if (!canEdit(items[i])) return res.status(403).json({ error: 'Убрать может тот, у кого вещь, владелец или костяк' });
          items.splice(i, 1);
        } else {
          const g = body.item || {};
          const title = String(g.title || '').trim().slice(0, 120);
          if (!title) return res.status(400).json({ error: 'Назови вещь' });
          const nameOf = async (id: number) => {
            if (!id) return null;
            const { data: m } = await supabase.from('members').select('first_name,username').eq('telegram_id', id).maybeSingle();
            return (m as any)?.first_name || ((m as any)?.username ? `@${(m as any).username}` : null);
          };
          const holderId = Number(g.holderId) || user.id;
          const ownerId = Number(g.ownerId) || null;
          const prev = g.id ? items.find((x: any) => x.id === String(g.id)) : null;
          if (prev && !canEdit(prev)) return res.status(403).json({ error: 'Править может тот, у кого вещь, владелец или костяк' });
          const item = {
            ...(prev || {}),
            id: prev?.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            title,
            kind: ['club', 'shared', 'personal'].includes(g.kind) ? g.kind : (ownerId && ownerId !== user.id ? 'personal' : 'club'),
            qty: Math.max(1, Math.min(99, Number(g.qty) || 1)),
            holderId, holderName: await nameOf(holderId),
            ownerId, ownerName: ownerId ? await nameOf(ownerId) : (g.ownerName ? String(g.ownerName).slice(0, 60) : null),
            contributors: (Array.isArray(g.contributors) ? g.contributors : []).slice(0, 20).map((c: any) => ({
              name: String(c?.name || '').slice(0, 60), tgId: Number(c?.tgId) || null, amount: Number(c?.amount) || null, paid: c?.paid === true,
            })).filter((c: any) => c.name),
            note: g.note ? String(g.note).slice(0, 200) : null,
            // Фото вещи. Без него карточка рисует только иконку категории, и
            // отличить два мангала в складе невозможно — а именно по фото
            // человек решает, брать ли вещь.
            photo: g.photo ? String(g.photo).slice(0, 4000000) : (prev?.photo || null),
            category: g.category ? String(g.category).slice(0, 20) : (prev?.category || null),
            returned: false,
            updatedAt: new Date().toISOString(),
          };
          if (prev) items[items.indexOf(prev)] = item; else items.push(item);
        }
        await supabase.from('app_config').upsert({ key: KEY, value: JSON.stringify(items) }, { onConflict: 'key' });
        return res.status(200).json({ ok: true });
      }
      return res.status(400).json({ error: 'Unknown gear action' });
    }

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

    /**
     * ═══ ЛОГИСТИКА В MINI APP ═══
     * Машины, палатки, брони и попутки жили ТОЛЬКО в боте: кнопка в карточке
     * события вела «🚗 Кто едет, попутки и брони — в боте», и дальше человек
     * листал ленту сообщений, где каждая машина — отдельное сообщение, а
     * состояние устаревало сразу после отправки. Владелец: «через бота это
     * очень неудобно». Теперь то же самое живёт в приложении и обновляется
     * на месте, а бот остаётся каналом уведомлений — как и задумано с 28.08.
     *
     * Все действия идут под подписанной initData: чужим именем место не занять.
     */
    if (typeof action === 'string' && action.startsWith('logi_')) {
      const user = verifyInitData(body.initData);
      if (!user) return res.status(200).json({ ok: false, error: 'not-in-telegram' });

      /** Уведомление в бот — best-effort: логистика не должна падать из-за Telegram. */
      const notify = async (chatId: number | string, text: string, markup?: unknown) => {
        if (!BOT_TOKEN || !chatId) return;
        try {
          await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: markup }),
          });
        } catch { /* no-op */ }
      };
      /** Активна ли у человека заявка на событие: бронировать может только едущий. */
      const isRegistered = async (evId: string): Promise<boolean> => {
        const { data } = await supabase.from('registrations').select('id')
          .eq('event_id', evId).eq('telegram_id', user.id).neq('status', 'cancelled').maybeSingle();
        return Boolean(data);
      };
      const rideById = async (rideId: number) => {
        const { data } = await supabase.from('rides').select('*').eq('id', rideId).maybeSingle();
        return data as any;
      };

      /**
       * ЧТО ВООБЩЕ НУЖНО ЭТОМУ СОБЫТИЮ.
       * Копия featureOn из api/telegram/webhook.ts (общий _lib роняет функции
       * на Vercel). Приложение показывало палатки всегда — и на однодневном
       * спортивном старте участнику предлагали «свою палатку». Признак тот
       * же, что у бота, чтобы они не расходились.
       */
      const featureOn = (ev: any, key: 'rides' | 'tents'): boolean => {
        if (ev?.notifications?._format === 'online') return false;
        const v = ev?.notifications?.[`feat_${key}`];
        if (typeof v === 'boolean') return v;
        // Однодневка — никто не ночует, палатки ни к чему.
        if (key === 'tents') {
          const end = ev?.date_end;
          if (!end || end === ev?.date) return false;
        }
        return ev?.type !== 'intellectual';
      };

      // ── Состояние: один запрос, из которого приложение рисует весь экран ──
      if (action === 'logi_state') {
        const evId = String(body.eventId || '');
        if (!evId) return res.status(200).json({ ok: false, error: 'no-event' });

        const [{ data: ev }, { data: allRides }, { data: reqs }, registered] = await Promise.all([
          supabase.from('events').select('id,title,logistics,time,type,date,date_end,notifications').eq('id', evId).maybeSingle(),
          supabase.from('rides').select('*').eq('event_id', evId).eq('active', true).order('created_at'),
          supabase.from('ride_requests').select('passenger_id,passenger_name,from_area').eq('event_id', evId).eq('active', true),
          isRegistered(evId),
        ]);

        const rideIds = (allRides || []).map((r: any) => r.id);
        const { data: books } = rideIds.length
          ? await supabase.from('ride_bookings').select('ride_id,passenger_id,passenger_name').in('ride_id', rideIds)
          : { data: [] as any[] };

        // Ник и телефон водителя — только тем, кто реально едет в этой машине.
        // Контакты остальных в приложение не отдаём: доступ к человеку даёт
        // общая поездка, а не просмотр списка.
        const myRideIds = new Set((books || []).filter((b: any) => Number(b.passenger_id) === user.id).map((b: any) => b.ride_id));
        const driverIds = Array.from(new Set((allRides || []).map((r: any) => Number(r.driver_id)).filter((n) => n > 0)));
        const drv = new Map<number, any>();
        if (driverIds.length) {
          const { data: dm } = await supabase.from('members').select('telegram_id,username,phone').in('telegram_id', driverIds);
          for (const m of dm || []) drv.set(Number((m as any).telegram_id), m);
        }

        const shape = (r: any) => {
          const seatsTotal = Number(r.seats_total) || 0;
          const seatsTaken = Number(r.seats_taken) || 0;
          const iAmIn = myRideIds.has(r.id);
          const isMine = Number(r.driver_id) === user.id;
          const d = drv.get(Number(r.driver_id));
          return {
            id: r.id,
            kind: r.kind === 'tent' ? 'tent' : 'car',
            driverId: Number(r.driver_id),
            driverName: r.driver_name || 'Водитель',
            // Контакты — только своим попутчикам и самому водителю.
            driverUsername: (iAmIn || isMine) ? (d?.username || '') : '',
            driverPhone: (iAmIn || isMine) ? (d?.phone || '') : '',
            seatsTotal, seatsTaken,
            free: Math.max(0, seatsTotal - seatsTaken),
            fromPoint: r.from_point || '',
            departText: r.depart_text || '',
            // Марка, цвет и номер — чтобы попутчик нашёл машину на точке, а не
            // высматривал незнакомого человека. Живёт в свободной колонке note.
            carInfo: r.note || '',
            fuelCost: Number(r.fuel_cost) || 0,
            isMine, iAmIn,
            passengers: (books || []).filter((b: any) => b.ride_id === r.id)
              .map((b: any) => ({ name: b.passenger_name || 'Участник', isMe: Number(b.passenger_id) === user.id })),
          };
        };

        const shaped = (allRides || []).map(shape);
        return res.status(200).json({
          ok: true,
          registered,
          event: {
            id: evId,
            title: (ev as any)?.title || '',
            assemblyPoint: ((ev as any)?.logistics || {}).assemblyPoint || '',
            departureTime: ((ev as any)?.logistics || {}).departureTime || (ev as any)?.time || '',
          },
          features: { rides: featureOn(ev, 'rides'), tents: featureOn(ev, 'tents') },
          cars: shaped.filter((r: any) => r.kind === 'car'),
          tents: shaped.filter((r: any) => r.kind === 'tent'),
          seekers: (reqs || []).map((r: any) => ({
            name: r.passenger_name || 'Участник',
            fromArea: r.from_area || '',
            isMe: Number(r.passenger_id) === user.id,
          })),
          meSeeking: (reqs || []).some((r: any) => Number(r.passenger_id) === user.id),
        });
      }

      // ── Занять место ──────────────────────────────────────────────────────
      if (action === 'logi_book') {
        const ride = await rideById(Number(body.rideId));
        if (!ride || !ride.active) return res.status(200).json({ ok: false, error: 'Поездка недоступна' });
        if (!(await isRegistered(ride.event_id))) {
          return res.status(200).json({ ok: false, error: 'Сначала запишись на событие' });
        }
        const name = user.first_name || user.username || 'Пассажир';
        // Захват места атомарный (RPC): иначе двое одновременно сядут на одно.
        const { data: outcome, error } = await supabase.rpc('book_ride_seat', {
          p_ride_id: ride.id, p_passenger: user.id, p_name: name,
        });
        if (error || outcome !== 'ok') {
          const why = outcome === 'dup' ? 'Ты уже в этой машине'
            : outcome === 'full' ? 'Мест уже нет'
            : outcome === 'gone' ? 'Поездка отменена'
            : 'Не получилось забронировать';
          return res.status(200).json({ ok: false, error: why });
        }
        // Сел в машину → снимаем его «нужна попутка», чтобы не висел в списке ищущих.
        await supabase.from('ride_requests').update({ active: false })
          .eq('event_id', ride.event_id).eq('passenger_id', user.id);

        const { data: paxInfo } = await supabase.from('members').select('phone').eq('telegram_id', user.id).maybeSingle();
        await notify(ride.driver_id,
          `🧍 <b>К тебе в машину сел ${escHtml(name)}</b>${user.username ? ` @${escHtml(user.username)}` : ''}\n` +
          ((paxInfo as any)?.phone ? `📞 <code>${escHtml(String((paxInfo as any).phone))}</code>\n` : '') +
          `\nЗабронировал место через приложение.`);
        return res.status(200).json({ ok: true });
      }

      // ── Освободить своё место ────────────────────────────────────────────
      if (action === 'logi_unbook') {
        const ride = await rideById(Number(body.rideId));
        if (!ride) return res.status(200).json({ ok: false, error: 'Поездка не найдена' });
        const { data: outcome } = await supabase.rpc('cancel_ride_seat', { p_ride_id: ride.id, p_passenger: user.id });
        if (outcome !== 'ok') return res.status(200).json({ ok: false, error: 'Ты не занимал место в этой машине' });
        await notify(ride.driver_id,
          `🚗 <b>${escHtml(user.first_name || 'Участник')}</b> освободил место в твоей машине. Место снова свободно.`);
        // Место освободилось — зовём первого из очереди «нужна попутка».
        const { data: queue } = await supabase.from('ride_requests')
          .select('passenger_id,passenger_name').eq('event_id', ride.event_id).eq('active', true)
          .order('created_at', { ascending: true }).limit(1);
        for (const q of queue || []) {
          await notify((q as any).passenger_id,
            `🚗 <b>Освободилось место</b> у ${escHtml(ride.driver_name || 'водителя')} (${escHtml(ride.from_point || 'точка по договорённости')}).\n\nОткрой приложение — займи, пока свободно.`);
        }
        return res.status(200).json({ ok: true });
      }

      // ── Заявить свою машину или палатку ──────────────────────────────────
      if (action === 'logi_offer') {
        const evId = String(body.eventId || '');
        if (!evId) return res.status(200).json({ ok: false, error: 'no-event' });
        if (!(await isRegistered(evId))) {
          return res.status(200).json({ ok: false, error: 'Сначала запишись на событие' });
        }
        const kind = body.kind === 'tent' ? 'tent' : 'car';
        /**
         * Мест не может быть 8980 — а именно столько уехало в базу, когда в
         * поле свободных мест оказалось не то число. Режем по здравому смыслу.
         */
        const seats = Math.max(0, Math.min(8, Math.trunc(Number(body.seats) || 0)));
        const { data: ev } = await supabase.from('events').select('logistics').eq('id', evId).maybeSingle();
        const fromPoint = String(body.fromPoint || '').slice(0, 120).trim()
          || String(((ev as any)?.logistics || {}).assemblyPoint || '').trim()
          || 'по договорённости';
        const departText = String(body.departText || '').slice(0, 60).trim() || 'по договорённости';
        const carInfo = String(body.carInfo || '').slice(0, 80).trim();

        // Одна активная машина и одна палатка на человека: повтор = правка,
        // иначе в списке плодятся дубли одной и той же машины.
        const { data: existing } = await supabase.from('rides').select('id,kind')
          .eq('event_id', evId).eq('driver_id', user.id).eq('active', true);
        const same = (existing || []).find((r: any) => (r.kind === 'tent') === (kind === 'tent'));
        const row: Record<string, unknown> = {
          event_id: evId, driver_id: user.id,
          driver_name: user.first_name || user.username || (kind === 'tent' ? 'Хозяин палатки' : 'Водитель'),
          from_point: fromPoint, depart_text: departText, seats_total: seats, kind, active: true,
          note: carInfo || null,
        };
        if (same) await supabase.from('rides').update(row).eq('id', (same as any).id);
        else await supabase.from('rides').insert(row);

        // Ищущим попутку — сразу в бот: ради этого они и оставляли заявку.
        if (kind === 'car' && seats > 0) {
          const { data: seekers } = await supabase.from('ride_requests')
            .select('passenger_id').eq('event_id', evId).eq('active', true);
          for (const s of seekers || []) {
            if (Number((s as any).passenger_id) === user.id) continue;
            await notify((s as any).passenger_id,
              `🚗 <b>Появилась машина</b>: ${escHtml(String(row.driver_name))} из «${escHtml(fromPoint)}» (${escHtml(departText)}), мест: <b>${seats}</b>.\n\nОткрой приложение — займи место.`);
          }
        }
        return res.status(200).json({ ok: true });
      }

      // ── Отменить свою поездку ────────────────────────────────────────────
      if (action === 'logi_cancel') {
        const ride = await rideById(Number(body.rideId));
        if (!ride) return res.status(200).json({ ok: false, error: 'Поездка не найдена' });
        if (Number(ride.driver_id) !== user.id) {
          return res.status(200).json({ ok: false, error: 'Отменить поездку может только её водитель' });
        }
        await supabase.from('rides').update({ active: false }).eq('id', ride.id);
        // Пассажиров предупреждаем поимённо: иначе человек узнает об отмене на
        // точке сбора, когда машина не приедет.
        const { data: pax } = await supabase.from('ride_bookings').select('passenger_id').eq('ride_id', ride.id);
        for (const p of pax || []) {
          await notify((p as any).passenger_id,
            `⚠️ <b>${escHtml(ride.driver_name || 'Водитель')} отменил поездку</b>, на которую ты записался.\n\nОткрой приложение — поищи другую машину или оставь заявку «нужна попутка».`);
        }
        return res.status(200).json({ ok: true });
      }

      // ── Нужна попутка ────────────────────────────────────────────────────
      if (action === 'logi_seek') {
        const evId = String(body.eventId || '');
        if (!evId) return res.status(200).json({ ok: false, error: 'no-event' });
        if (!(await isRegistered(evId))) {
          return res.status(200).json({ ok: false, error: 'Сначала запишись на событие' });
        }
        // Повторное нажатие снимает заявку: кнопка в приложении одна и та же.
        if (body.off === true) {
          await supabase.from('ride_requests').update({ active: false })
            .eq('event_id', evId).eq('passenger_id', user.id);
          return res.status(200).json({ ok: true });
        }
        await supabase.from('ride_requests').upsert({
          event_id: evId, passenger_id: user.id,
          passenger_name: user.first_name || user.username || 'Пассажир',
          from_area: String(body.fromArea || '').slice(0, 120) || null,
          active: true,
        }, { onConflict: 'event_id,passenger_id' });

        const { data: rides } = await supabase.from('rides')
          .select('driver_id,seats_total,seats_taken,kind').eq('event_id', evId).eq('active', true);
        const free = (rides || []).filter((r: any) => r.kind !== 'tent' && Number(r.seats_total || 0) > Number(r.seats_taken || 0));
        for (const d of Array.from(new Set(free.map((r: any) => Number(r.driver_id))))) {
          if (d === user.id) continue;
          await notify(d, `🚶 <b>${escHtml(user.first_name || 'Участник')}</b> ищет попутку${body.fromArea ? `, забрать: ${escHtml(String(body.fromArea).slice(0, 80))}` : ''}.\n\nУ тебя есть свободные места — подхватишь?`);
        }
        return res.status(200).json({ ok: true });
      }

      // ── Встать в очередь на машину, где мест нет ─────────────────────────
      if (action === 'logi_wait') {
        const ride = await rideById(Number(body.rideId));
        if (!ride || !ride.active) return res.status(200).json({ ok: false, error: 'Поездка недоступна' });
        await supabase.from('ride_requests').upsert({
          event_id: ride.event_id, passenger_id: user.id,
          passenger_name: user.first_name || user.username || 'Пассажир', active: true,
        }, { onConflict: 'event_id,passenger_id' });
        return res.status(200).json({ ok: true });
      }

      return res.status(200).json({ ok: false, error: 'unknown-logi-action' });
    }

    /**
     * ОТМЕНА УЧАСТИЯ ИЗ ПРИЛОЖЕНИЯ.
     * Экран «мои участия» слал отмену на /api/my — эндпоинт удалили ещё в
     * июле, объединив в этот файл. Запрос уходил в 404, ошибку глотал catch,
     * и человек видел «участие отменено», а в базе оставался записанным:
     * занимал место, числился в составе и получал напоминания о выезде.
     */
    if (action === 'cancel_registration') {
      const user = verifyInitData(body.initData);
      if (!user) return res.status(200).json({ ok: false, error: 'not-in-telegram' });
      const evId = String(body.eventId || '');
      if (!evId) return res.status(200).json({ ok: false, error: 'no-event' });

      const { data: reg } = await supabase
        .from('registrations').select('id,name')
        .eq('event_id', evId).eq('telegram_id', user.id).neq('status', 'cancelled').maybeSingle();
      if (!reg) return res.status(200).json({ ok: true, alreadyCancelled: true });

      await supabase.from('registrations')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
        .eq('id', (reg as any).id);

      // Ушёл с события — освобождаем и место в чужой машине: иначе водитель
      // везёт пустое кресло мимо тех, кто искал попутку.
      try {
        const { data: evRides } = await supabase
          .from('rides').select('id,driver_id').eq('event_id', evId).eq('active', true);
        for (const r of (evRides || []) as any[]) {
          const { data: outcome } = await supabase.rpc('cancel_ride_seat', { p_ride_id: r.id, p_passenger: user.id });
          if (outcome === 'ok' && BOT_TOKEN && r.driver_id) {
            try {
              await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: r.driver_id, parse_mode: 'HTML',
                  text: `🚗 <b>${escHtml(user.first_name || 'Участник')}</b> снялся с события — место в твоей машине снова свободно.`,
                }),
              });
            } catch { /* no-op */ }
          }
        }
      } catch { /* освобождение места не должно ронять саму отмену */ }

      // Своя машина тоже уезжает вместе с ним.
      await supabase.from('rides').update({ active: false })
        .eq('event_id', evId).eq('driver_id', user.id).eq('active', true);
      await supabase.from('ride_requests').update({ active: false })
        .eq('event_id', evId).eq('passenger_id', user.id);

      // Организатору события — ЛИЧНО: отказ за день до выезда меняет машины,
      // еду и расселение, а общий чат обычно на mute.
      if (BOT_TOKEN) {
        try {
          const { data: evD } = await supabase.from('events').select('title,deputy_id').eq('id', evId).maybeSingle();
          const dep = Number((evD as any)?.deputy_id);
          const reason = String(body.reason || '').trim().slice(0, 300);
          if (Number.isFinite(dep) && dep > 0 && dep !== Number(user.id)) {
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: dep, parse_mode: 'HTML',
                text: `🔴 <b>Отказ от участия</b> · ${escHtml((evD as any)?.title || evId)}\n\n`
                  + `${escHtml((reg as any).name || user.first_name || 'Участник')}${user.username ? ` (@${escHtml(user.username)})` : ''} больше не едет.`
                  + (reason ? `\nПричина: ${escHtml(reason)}` : ''),
              }),
            });
          }
        } catch { /* уведомление не важнее самой отмены */ }
      }

      // Костяку — сразу: состав меняется за день до выезда, и это их работа.
      if (BOT_TOKEN && ADMIN_CHAT_ID) {
        const { data: ev } = await supabase.from('events').select('title').eq('id', evId).maybeSingle();
        try {
          await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: ADMIN_CHAT_ID, parse_mode: 'HTML',
              text: `🔴 <b>Снялся с события</b>\n${escHtml((ev as any)?.title || evId)}\n${escHtml((reg as any).name || user.first_name || '')} (id ${user.id})`,
            }),
          });
        } catch { /* no-op */ }
      }
      return res.status(200).json({ ok: true });
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
      /**
       * Анкета онбординга. В `members` есть колонки только под пол и дату
       * рождения — всё остальное (род деятельности, активности, транспорт,
       * снаряжение, мотив, принятые правила) кладём в prefs (jsonb): новых
       * колонок не заводим, миграция не нужна.
       *
       * Ключевое: `rules_accepted` пишется ВМЕСТЕ с заявкой. Раньше человека
       * принимали в клуб, а правила у него оставались непринятыми — 23.08 так
       * и случилось, и заметили это случайно. Теперь непринятых правил у
       * принятого участника быть не может: без них заявка просто не создаётся.
       */
      {
        const { data: cur } = await supabase.from('members').select('prefs').eq('telegram_id', telegramId).maybeSingle();
        const prefs: any = (cur as any)?.prefs || {};
        if (sourceHint) prefs.source_hint = String(sourceHint).slice(0, 300);
        if (body.occupation) prefs.occupation = String(body.occupation).slice(0, 200);
        if (Array.isArray(body.activities) && body.activities.length) {
          prefs.activities = body.activities.slice(0, 30).map((a: any) => String(a).slice(0, 40));
        }
        if (body.transport) prefs.transport = String(body.transport).slice(0, 60);
        if (Number(body.seats) > 0) prefs.transport_seats = Math.min(9, Number(body.seats));
        if (Array.isArray(body.gear) && body.gear.length) {
          prefs.gear = body.gear.slice(0, 30).map((g: any) => String(g).slice(0, 40));
        }
        if (body.why) prefs.join_reason = { text: String(body.why).slice(0, 1000), at: new Date().toISOString() };
        if (body.rulesMap && typeof body.rulesMap === 'object') {
          prefs.rules_accepted = {
            version: String(body.rulesVersion || 'v3').slice(0, 16),
            at: new Date().toISOString(),
            map: body.rulesMap,
          };
          // Правила приняты осознанно и поимённо — это же и есть подтверждение
          // ценностей, второй раз спрашивать человека не за что.
          prefs.values_confirmed = { at: new Date().toISOString(), version: 'v1' };
        }
        if (body.usePhoto) prefs.use_tg_photo = true;
        memberData.prefs = prefs;
      }
      if (body.gender === 'male' || body.gender === 'female') memberData.gender = body.gender;
      if (typeof body.birthday === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.birthday)) {
        const year = Number(body.birthday.slice(0, 4));
        // Границы от опечаток: в базе уже лежат «2026 год рождения».
        if (year >= 1930 && year <= new Date().getFullYear() - 14) memberData.birthday = body.birthday;
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

      // Заявителю — подтверждение в бот. Раньше его не было вовсе: человек
      // отправлял анкету и не понимал, дошла ли она.
      if (BOT_TOKEN) {
        try {
          await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: telegramId, parse_mode: 'HTML',
              text: `✅ <b>Заявка в FLINT получена</b>\n\nКостяк клуба посмотрит её в течение суток и ответит сюда. Пока можно заглянуть в афишу.`,
            }),
          });
        } catch (e) { slog('warn', 'apply: подтверждение заявителю не ушло', (e as Error).message); }
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

      /**
       * Запрос был сломан дважды, и оба раза молча.
       *
       * 1. `status as event_status` — это синтаксис SQL, а не PostgREST: там
       *    алиас пишется как `event_status:status`. Вложенный select падал,
       *    и ВЕСЬ запрос возвращал ошибку.
       * 2. `children_count` живёт в миграции 2026-final.sql, которая не
       *    накатана. Колонки нет — запрос падает целиком.
       *
       * Ошибку никто не проверял, `data` приходил null, наружу уходило
       * `{ registrations: [] }`. То есть эндпоинт ВСЕГДА отвечал «ты никуда
       * не записан» — человек открывал событие, где он едет, и ему предлагали
       * записаться заново.
       *
       * Поэтому здесь только колонки из schema.sql, без вложенных сущностей
       * (единственный потребитель — App.tsx — читает лишь саму заявку) и с
       * проверкой ошибки: тихо падать этот запрос больше не должен.
       */
      const { data: regs, error: regsErr } = await supabase
        .from('registrations')
        .select('id,event_id,name,phone,status,payment_status,payment_amount,guest_count,has_transport,transport_details,transport_seats,registered_at')
        .eq('telegram_id', user.id)
        .order('registered_at', { ascending: false });

      if (regsErr) {
        slog('error', 'my_registrations failed', regsErr);
        return res.status(500).json({ error: 'registrations-query-failed' });
      }
      return res.status(200).json({ registrations: regs || [] });
    }

    // === GET PROFILE ===
    if (action === 'get_profile') {
      const user = verifyInitData(body.initData);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      // Колонок attended_count/invited_count/level/achievements может не быть
      // до применения миграции 2026-dietary-profile.sql — тогда отдаём минимум.
      const fullMember = await supabase
        .from('members')
        .select('first_name,username,phone,status,points,attended_count,invited_count,level,achievements')
        .eq('telegram_id', user.id)
        .maybeSingle();

      let member: any = fullMember.data;
      if (fullMember.error) {
        slog('warn', 'get_profile: расширенная схема members недоступна', fullMember.error.message);
        member = (await supabase
          .from('members')
          .select('first_name,username,phone,status,points')
          .eq('telegram_id', user.id)
          .maybeSingle()).data;
      }

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

      // Получаем профиль. Пол и питание берём и отсюда: у новичка прошлой
      // регистрации нет, а в профиле эти поля уже могут быть — переспрашивать
      // одно и то же на каждой записи и было главной претензией к анкете.
      const { data: member } = await supabase
        .from('members')
        .select('first_name,phone,gender,dietary,agreed_pd')
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

      // Пол: сначала прошлая регистрация, потом профиль. НИКАКОГО дефолта
      // 'male' — раньше он молча подставлялся всем, включая женщин, и уезжал
      // в базу как их ответ.
      const gender = (member as any)?.gender;
      const category = lastReg?.category
        || (gender === 'female' ? 'female' : gender === 'male' ? 'male' : null);

      return res.status(200).json({
        ok: true,
        prefill: {
          name: member?.first_name || '',
          phone: member?.phone || '',
          hasTransport: lastReg?.has_transport || false,
          transportDetails: lastReg?.transport_details || '',
          transportSeats: lastReg?.transport_seats || 0,
          hasLicense: lastReg?.has_license === true ? 'yes' : lastReg?.has_license === false ? 'no' : null,
          category,
          dietary: lastReg?.dietary || (member as any)?.dietary || null,
          equipment: Array.isArray(lastReg?.equipment) ? lastReg.equipment.join(',') : '',
          roles: Array.isArray(lastReg?.roles) ? lastReg.roles.join(',') : '',
          // Есть ли что подставлять вообще — фронт показывает «данные из профиля».
          hasHistory: !!lastReg,
          /**
           * Как добирался в прошлый раз — целиком, а не только «водитель».
           * Раньше восстанавливалась лишь машина, и «ищу попутку»/«сам»
           * приходилось выбирать заново на каждой записи. Нужно экспресс-записи.
           */
          transportMode: lastReg
            ? (lastReg.has_transport
              ? (/^каршеринг/i.test(String(lastReg.transport_details || '')) ? 'carsharing' : 'car')
              : /попутк/i.test(String(lastReg.transport_details || '')) ? 'seek' : 'self')
            : null,
          // Согласие на обработку данных уже дано — не переспрашиваем галочкой.
          agreedPd: (member as any)?.agreed_pd === true,
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

      // Начисляем баллы.
      // Миграция 2026-dietary-profile.sql в этой базе применена не полностью,
      // поэтому колонок attended_count / invited_count / level / achievements
      // может не быть. Не роняем операцию: сначала пробуем полный набор,
      // при ошибке схемы откатываемся к минимуму (только points).
      let member: any = null;
      let richSchema = true;
      {
        const full = await supabase
          .from('members')
          .select('points, attended_count, invited_count, level, achievements')
          .eq('telegram_id', Number(telegramId))
          .maybeSingle();
        if (full.error) {
          richSchema = false;
          slog('warn', 'add_points: расширенная схема members недоступна, работаю в минимальном режиме', full.error.message);
          const basic = await supabase
            .from('members')
            .select('points')
            .eq('telegram_id', Number(telegramId))
            .maybeSingle();
          member = basic.data;
        } else {
          member = full.data;
        }
      }

      if (!member) {
        return res.status(404).json({ error: 'Member not found' });
      }

      const newPoints = (member.points || 0) + points;
      const updates: any = { points: newPoints };

      // Обновляем счётчики
      if (richSchema && reason === 'attendance') {
        updates.attended_count = (member.attended_count || 0) + 1;
      } else if (richSchema && reason === 'invite') {
        updates.invited_count = (member.invited_count || 0) + 1;
      }

      // Проверяем достижения (только при полной схеме: нужен member.achievements)
      const achievements = richSchema ? (member.achievements || []) : [];
      const { data: allAchievements } = richSchema
        ? await supabase.from('achievements').select('*')
        : { data: [] as any[] };

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

      if (richSchema) {
        updates.achievements = JSON.stringify(newAchievements);

        // Обновляем уровень
        if (newPoints >= 500) updates.level = 'legend';
        else if (newPoints >= 200) updates.level = 'core';
        else if (newPoints >= 50) updates.level = 'regular';
      }

      // Сохраняем
      const { error: updateErr } = await supabase.from('members').update(updates).eq('telegram_id', Number(telegramId));
      if (updateErr) {
        slog('error', 'add_points: не удалось обновить баллы', updateErr.message);
        return res.status(500).json({ error: 'Не удалось начислить баллы' });
      }

      // Логируем (журнал необязателен — таблицы points_log может не быть до миграции)
      const { error: logErr } = await supabase.from('points_log').insert({
        telegram_id: Number(telegramId),
        event_id: eventId || null,
        reason,
        points,
        description: description || '',
      });
      if (logErr) slog('warn', 'add_points: points_log недоступен, пропускаю запись журнала', logErr.message);

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

      // Баллы и достижения (колонок level/achievements может не быть до миграции)
      const full = await supabase
        .from('members')
        .select('points, level, achievements')
        .eq('status', 'approved');
      const membersData = full.error
        ? (await supabase.from('members').select('points').eq('status', 'approved')).data
        : full.data;
      if (full.error) slog('warn', 'metrics: схема members без level/achievements', full.error.message);

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

      // Генерация ЗАТИРАЕТ расписание события (event_schedules) и дергает Gemini.
      // Поэтому право проверяем здесь второй раз — по организатору конкретного
      // события: любой участник клуба не должен переписать программу чужого выезда.
      {
        const verdict = await requireMemberOrAdmin(req, body);
        if (verdict !== 'ok') return res.status(403).json({ ok: false, error: 'Доступно организатору события' });
      }

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