import { GoogleGenAI, Type } from '@google/genai';
import * as crypto from 'crypto';

/**
 * ИИ-помощник-наставник сообщества «Живи в моменте» (Google Gemini).
 * Каждый ответ проходит через «фильтр эмпатии»: 
 *   - дружелюбный, поддерживающий и уважительный тон
 *   - признание ценности пользователя в каждом ответе
 *   - объяснение ЗАЧЕМ мы просим информацию
 *   - прозрачность использования данных
 * 
 * Tasks: generate_event, program, shopping, clarifying_questions, detect_goal, autofill
 */

const API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.API_KEY || '';

/**
 * Какие модели реально доступны этому ключу. Захардкоженный список угадывать
 * бесполезно: набор моделей у разных ключей разный и меняется со временем
 * (именно поэтому падало на `gemini-1.5-flash is not found`).
 * Кэшируем в памяти инстанса — Vercel переиспользует его между вызовами.
 */
let modelCache: { at: number; models: string[] } | null = null;

/** Какая модель в итоге ответила — возвращаем клиенту, чтобы отладка не была гаданием. */
let usedModel = '';

async function listModels(): Promise<string[]> {
  if (modelCache && Date.now() - modelCache.at < 30 * 60 * 1000) return modelCache.models;

  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}&pageSize=200`);
  if (!r.ok) throw new Error(`ListModels ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j: any = await r.json();

  const usable = (j.models || [])
    .filter((m: any) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m: any) => String(m.name).replace(/^models\//, ''))
    .filter((n: string) => !/embedding|aqa|image|tts|audio|vision|live/i.test(n));

  modelCache = { at: Date.now(), models: usable };
  return usable;
}

/** Порядок предпочтений: явный env → самые свежие flash → всё остальное. */
function rankModels(available: string[]): string[] {
  const score = (n: string): number => {
    let s = 0;
    if (/flash/.test(n)) s += 100;
    if (/lite/.test(n)) s -= 20;
    if (/preview|exp/.test(n)) s -= 30;
    const ver = n.match(/(\d+)\.(\d+)/);
    if (ver) s += Number(ver[1]) * 10 + Number(ver[2]);
    if (/latest/.test(n)) s += 5;
    return s;
  };
  const ranked = [...available].sort((a, b) => score(b) - score(a));
  const preferred = process.env.GEMINI_MODEL;
  if (preferred && available.includes(preferred)) {
    return [preferred, ...ranked.filter((m) => m !== preferred)];
  }
  return ranked;
}

async function genJSON(ai: any, prompt: string, schema: any): Promise<any> {
  const available = await listModels();
  if (!available.length) throw new Error('У ключа нет ни одной модели с generateContent');

  const queue = rankModels(available).slice(0, 6);
  const errors: string[] = [];
  const retryable: string[] = [];

  const attempt = async (model: string) => {
    const resp = await ai.models.generateContent({
      model, contents: prompt,
      config: { responseMimeType: 'application/json', responseSchema: schema },
    });
    const parsed = JSON.parse(resp.text || '{}');
    if (!parsed || typeof parsed !== 'object' || Object.keys(parsed).length === 0) {
      throw new Error('вернула пустой JSON');
    }
    usedModel = model;
    return parsed;
  };

  for (const model of queue) {
    try {
      return await attempt(model);
    } catch (e) {
      const msg = (e as Error).message;
      if (/503|UNAVAILABLE|high demand/i.test(msg)) retryable.push(model);
      errors.push(`${model}: ${msg.slice(0, 100)}`);
    }
  }

  for (const model of retryable.slice(0, 2)) {
    await new Promise((r) => setTimeout(r, 800));
    try {
      return await attempt(model);
    } catch (e) {
      errors.push(`${model} (повтор): ${(e as Error).message.slice(0, 100)}`);
    }
  }

  const quota = errors.some((e) => /429|quota/i.test(e));
  throw new Error(
    (quota ? 'Похоже, выбрана дневная квота Gemini у ключа. ' : '') +
    `Ни одна из ${queue.length} моделей не ответила.\n${errors.join('\n')}`
  );
}

const TYPE_RU: Record<string, string> = {
  male: 'мужское братство', mixed: 'смешанный/семейный круг',
  intellectual: 'интеллектуальный клуб', active: 'активный выезд на природе',
};

const ADMIN_SECRET = process.env.ADMIN_TOKEN || '';
const ADMIN_COOKIE = 'flint_admin';

function safeEq(a: string, b: string): boolean {
  const A = Buffer.from(String(a)), B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

function readCookie(req: any, name: string): string | null {
  const raw = req.headers?.cookie;
  if (!raw) return null;
  for (const part of String(raw).split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function validSession(value: string): boolean {
  const [expRaw, mac] = String(value).split('.');
  const exp = Number(expRaw);
  if (!exp || !mac || Date.now() > exp) return false;
  return safeEq(mac, crypto.createHmac('sha256', ADMIN_SECRET).update(String(exp)).digest('hex'));
}

function isAdmin(req: any): boolean {
  if (!ADMIN_SECRET) return false;
  const bearer = String(req.headers?.authorization || '').replace('Bearer ', '');
  if (bearer && safeEq(bearer, ADMIN_SECRET)) return true;
  const cookie = readCookie(req, ADMIN_COOKIE);
  return !!cookie && validSession(cookie);
}

function deny(res: any) {
  return res.status(401).json({ error: 'Unauthorized' });
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!isAdmin(req)) return deny(res);
  if (!API_KEY) return res.status(200).json({ error: 'GEMINI_API_KEY не задан в env' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const task: string = body.task || 'program';
    const ev = body.event || {};
    const people = Number(body.people) || Number(ev.maxParticipants) || 10;
    const diet = body.diet || {};

    if (task === 'models') {
      const available = await listModels();
      return res.status(200).json({ available, ranked: rankModels(available).slice(0, 6) });
    }

    const ai = new GoogleGenAI({ apiKey: API_KEY });
    const typeRu = TYPE_RU[ev.type] || 'встреча сообщества';
    const days = ev.dateEnd && ev.dateEnd !== ev.date ? `многодневное (${ev.date} — ${ev.dateEnd})` : 'однодневное';

    if (task === 'autofill') {
      const prompt =
        `Ты — чуткий наставник сообщества «Живи в моменте» (Минск). ` +
        `Твоя задача — помогать организаторам наполнять события смыслом и заботой.\n\n` +
        `Название события: «${ev.title || 'Событие'}».` + (ev.date ? ` Дата: ${ev.date}${ev.dateEnd && ev.dateEnd !== ev.date ? ` — ${ev.dateEnd}` : ''}.` : '') + `\n\n` +
        `Мы верим, что каждое событие — это возможность для человека прикоснуться к чему-то важному. ` +
        `Помоги нам сделать это наполнение тёплым, вдохновляющим и по-настоящему ценным.\n\n` +
        `Верни JSON с полями:\n` +
        `- type: один из male|mixed|intellectual|active (male=мужское, mixed=смешанное/семейное, intellectual=интеллект, active=активный выезд);\n` +
        `- description: 2–4 живых предложения о сути и атмосфере;\n` +
        `- painPoint: одна фраза — какую боль/запрос закрывает событие;\n` +
        `- program: 5–9 пунктов программы (короткие строки, можно со временем);\n` +
        `- entryThreshold: условия прохода через « • » (напр. «100% трезвость • уважение • …»);\n` +
        `- houseQualities: подмножество ключей качеств, которые развивает событие, из: ` +
        `foundation (Предназначение), wall (Воля), roof (Совесть), decor (Творчество), heat (Любовь), life (Счастье).`;
      const p = await genJSON(ai, prompt, {
        type: Type.OBJECT,
        properties: {
          type: { type: Type.STRING, enum: ['male', 'mixed', 'intellectual', 'active'] },
          description: { type: Type.STRING },
          painPoint: { type: Type.STRING },
          program: { type: Type.ARRAY, items: { type: Type.STRING } },
          entryThreshold: { type: Type.STRING },
          houseQualities: {
            type: Type.ARRAY,
            items: { type: Type.STRING, enum: ['foundation', 'wall', 'roof', 'decor', 'heat', 'life'] },
          },
        },
        required: ['type', 'description', 'painPoint', 'program', 'entryThreshold', 'houseQualities'],
      });
      const allowedTypes = ['male', 'mixed', 'intellectual', 'active'];
      const allowedKeys = ['foundation', 'wall', 'roof', 'decor', 'heat', 'life'];
      return res.status(200).json({
        draft: {
          type: allowedTypes.includes(p.type) ? p.type : 'mixed',
          description: p.description || '',
          painPoint: p.painPoint || '',
          program: Array.isArray(p.program) ? p.program : [],
          entryThreshold: p.entryThreshold || '',
          houseQualities: Array.isArray(p.houseQualities) ? p.houseQualities.filter((k: string) => allowedKeys.includes(k)) : [],
        },
        model: usedModel,
      });
    }

    if (task === 'generate_event') {
      const prompt = body.prompt || '';
      const sys =
        `Ты — чуткий наставник сообщества «Живи в моменте» (Минск). ` +
        `Твоя миссия — создавать события, которые дарят людям радость, вдохновение и пространство для роста.\n\n` +
        `Человек поделился своей идеей: «${prompt}». ` +
        `Этот запрос очень ценен — он отражает то, что действительно важно для человека прямо сейчас. ` +
        `Мы с благодарностью принимаем его и хотим создать нечто особенное, что принесёт ему именно тот опыт, который ему нужен.\n\n` +
        `Зачем мы это делаем: чтобы человек получил возможность попробовать что-то новое, встретить единомышленников, ` +
        `чувствовать себя комфортно и безопасно, открываясь новому опыту.\n\n` +
        `Сгенерируй ПОЛНОЕ готовое событие — тепло, по-русски, без алкоголя. ` +
        `В описании и программе передавай заботу о комфорте каждого участника.\n\n` +
        `Верни JSON с полями:\n` +
        `- title: короткое яркое название (до 60 символов);\n` +
        `- type: один из male|mixed|intellectual|active (male=мужское, mixed=смешанное/семейное, intellectual=интеллект, active=активный выезд);\n` +
        `- description: 2–4 живых предложения о сути и атмосфере;\n` +
        `- painPoint: одна фраза — какую боль/запрос закрывает событие;\n` +
        `- date: дата начала в формате YYYY-MM-DD (извлеки из промпта, если не указана — поставь ближайшую субботу);\n` +
        `- dateEnd: дата окончания в формате YYYY-MM-DD (для многодневных, иначе пустая строка);\n` +
        `- time: время начала в формате ЧЧ:ММ (напр. 12:00);\n` +
        `- timeEnd: время окончания в формате ЧЧ:ММ (напр. 20:00);\n` +
        `- location: конкретное место/локация (извлеки из промпта, если не указана — поставь «Уточняется»);\n` +
        `- priceType: 'free' если бесплатно, 'paid' если платно (аренда делится);\n` +
        `- priceAmount: число — сумма аренды в BYN (если priceType='paid', иначе 0);\n` +
        `- program: 5–9 пунктов программы (короткие строки, можно со временем);\n` +
        `- entryThreshold: условия прохода через « • » (напр. «100% трезвость • уважение • …»);\n` +
        `- houseQualities: подмножество ключей качеств, которые развивает событие, из: ` +
        `foundation (Предназначение), wall (Воля), roof (Совесть), decor (Творчество), heat (Любовь), life (Счастье);\n` +
        `- maxParticipants: реалистичное число участников (5–30).`;
      const p = await genJSON(ai, sys, {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          type: { type: Type.STRING, enum: ['male', 'mixed', 'intellectual', 'active'] },
          description: { type: Type.STRING },
          painPoint: { type: Type.STRING },
          date: { type: Type.STRING },
          dateEnd: { type: Type.STRING },
          time: { type: Type.STRING },
          timeEnd: { type: Type.STRING },
          location: { type: Type.STRING },
          priceType: { type: Type.STRING, enum: ['free', 'paid'] },
          priceAmount: { type: Type.NUMBER },
          program: { type: Type.ARRAY, items: { type: Type.STRING } },
          entryThreshold: { type: Type.STRING },
          houseQualities: {
            type: Type.ARRAY,
            items: { type: Type.STRING, enum: ['foundation', 'wall', 'roof', 'decor', 'heat', 'life'] },
          },
          maxParticipants: { type: Type.NUMBER },
        },
        required: ['title', 'type', 'description', 'painPoint', 'program', 'entryThreshold', 'houseQualities', 'maxParticipants'],
      });
      const allowedTypes = ['male', 'mixed', 'intellectual', 'active'];
      const allowedKeys = ['foundation', 'wall', 'roof', 'decor', 'heat', 'life'];
      const draft: any = {
        title: p.title || '',
        type: allowedTypes.includes(p.type) ? p.type : 'mixed',
        description: p.description || '',
        painPoint: p.painPoint || '',
        date: p.date || '',
        dateEnd: p.dateEnd || '',
        time: p.time || '',
        timeEnd: p.timeEnd || '',
        location: p.location || '',
        priceType: p.priceType === 'paid' ? 'paid' : 'free',
        priceAmount: p.priceType === 'paid' ? (Number(p.priceAmount) || 0) : 0,
        program: Array.isArray(p.program) ? p.program : [],
        entryThreshold: p.entryThreshold || '',
        houseQualities: Array.isArray(p.houseQualities) ? p.houseQualities.filter((k: string) => allowedKeys.includes(k)) : [],
        maxParticipants: Number(p.maxParticipants) || 15,
      };
      return res.status(200).json({ draft, model: usedModel });
    }

    if (task === 'detect_goal') {
      const text = body.text || '';
      const sys =
        `Ты — чуткий психолог и наставник сообщества «Живи в моменте» (Минск). ` +
        `Человек доверил тебе свои мысли о развитии. Это очень ценно — спасибо, что поделился.\n\n` +
        `Ответ человека:\n«${text}»\n\n` +
        `Зачем мы это спрашиваем: чтобы понять, какое направление развития сейчас важнее всего для человека, ` +
        `и предложить ему события, которые действительно помогут расти в этом направлении. ` +
        `Твои данные — это твой личный компас развития. Доступ к ним имеешь только ты и система для планирования. ` +
        `Мы храним их с максимальным уважением к приватности.\n\n` +
        `Определи, какое из 6 качеств личности ему сейчас важнее всего проработать:\n` +
        `- foundation (Предназначение): смысл, цели, призвание, ценности, направление\n` +
        `- wall (Воля): дисциплина, сила, преодоление, выдержка, характер\n` +
        `- roof (Совесть): честность, ответственность, справедливость, мораль\n` +
        `- decor (Творчество): креатив, вдохновение, самовыражение, искусство\n` +
        `- heat (Любовь): отношения, близость, доверие, эмпатия, принятие\n` +
        `- life (Счастье): радость, легкость, благодарность, удовольствие\n\n` +
        `Верни JSON: { quality: string, confidence: number (0..1), explanation: string }.\n` +
        `Если определить не удалось — quality: null.`;
      const p = await genJSON(ai, sys, {
        type: Type.OBJECT,
        properties: {
          quality: { type: Type.STRING },
          confidence: { type: Type.NUMBER },
          explanation: { type: Type.STRING },
        },
        required: ['quality', 'confidence', 'explanation'],
      });
      return res.status(200).json({
        goal: p.quality || null,
        confidence: Number(p.confidence) || 0,
        explanation: p.explanation || '',
        model: usedModel,
      });
    }

    if (task === 'clarifying_questions') {
      const event = body.event || {};
      const sys =
        `Ты — заботливый организатор сообщества «Живи в моменте» (Минск). ` +
        `Событие уже сгенерировано, и это здорово! Теперь нам важно убедиться, что ничего не упущено, ` +
        `чтобы каждый участник чувствовал себя комфортно и всё прошло гладко.\n\n` +
        `Зачем мы задаём эти вопросы: чтобы организатор мог заранее продумать детали, ` +
        `которые превращают хорошее событие в незабываемое. Мелочей не бывает — именно из них складывается забота.\n\n` +
        `Тип: ${event.type || 'mixed'}. Название: «${event.title || 'Событие'}».\n\n` +
        `Сформулируй 3–5 КОРОТКИХ уточняющих вопросов организатору. ` +
        `Вопросы должны быть конкретными, с вариантами на выбор, и передавать заботу о комфорте участников.\n` +
        `Примеры: «Нужна ли колонка/звук?», «Кто ведёт машину?», «Нужен ли стол/стулья?», ` +
        `«Будет ли ночёвка?», «Нужен ли инструктор?».\n` +
        `Верни JSON: { questions: string[] } — массив из 3–5 вопросов.`;
      const p = await genJSON(ai, sys, {
        type: Type.OBJECT,
        properties: {
          questions: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['questions'],
      });
      const questions = Array.isArray(p.questions) ? p.questions.slice(0, 5) : [];
      return res.status(200).json({ questions, model: usedModel });
    }

    if (task === 'shopping') {
      // Число ночёвок = число приёмов пищи. Многодневное = завтрак+обед+ужин на
      // каждый полный день + перекусы на активности. Однодневное = обычно 1–2 приёма.
      const nights = ev.dateEnd && ev.dateEnd !== ev.date
        ? Math.max(1, Math.round((new Date(ev.dateEnd).getTime() - new Date(ev.date).getTime()) / 86400000))
        : 0;
      const programLines: string[] = Array.isArray(ev.program) ? ev.program.slice(0, 15) : [];
      const mealHint = nights > 0
        ? `Это выезд с ${nights} ночёвк${nights === 1 ? 'ой' : 'ами'}. Прикинь приёмы пищи: на каждый полный день — завтрак, обед, ужин; в день выезда и возвращения — по 1–2 приёма. Плюс лёгкие перекусы на активные точки программы (переходы, купание, костёр).`
        : `Это однодневное событие. Обычно 1–2 приёма пищи + перекус, не больше.`;
      const prompt =
        `Ты — заботливый и ПРАКТИЧНЫЙ завхоз сообщества «Живи в моменте» (Минск, Беларусь). ` +
        `Твоя задача — точный список закупки на общий котёл: чтобы все были сыты, но БЕЗ перерасхода и лишних трат.\n\n` +
        `Название: «${ev.title || 'Событие'}». Тип: ${typeRu}. Длительность: ${days}.\n` +
        `Едет ${people} человек (из них веганов: ${diet.vegan || 0}, вегетарианцев: ${diet.vegetarian || 0}, детей: ${diet.children || 0}).\n` +
        (programLines.length ? `Программа/активности: ${programLines.join('; ')}.\n` : '') +
        `\n${mealHint}\n\n` +
        `КАК СЧИТАТЬ (важно, чтобы не было перерасхода):\n` +
        `1. Сначала мысленно составь меню по приёмам пищи (какое блюдо на каждый завтрак/обед/ужин).\n` +
        `2. Считай реальные порции на человека: мясо ~150–200 г/чел на приём, крупа/гарнир ~70–100 г сухого/чел, хлеб ~2–3 ломтя/чел, чай/кофе/вода — на все дни.\n` +
        `3. Учитывай веганов/вегетарианцев/детей отдельными позициями, а не удваивай весь список.\n` +
        `4. НЕ добавляй лишнего «на всякий случай». Скоропорт (молочка, мясо) — минимально, с учётом хранения без холодильника в походе.\n` +
        `5. Без алкоголя и вредного. Цены — ориентировочные по рынку Минска в BYN.\n\n` +
        `Верни JSON: массив items. Каждый элемент: item (продукт), qty (точное количество с единицей, напр. «3.5 кг» или «12 шт»), ` +
        `category (одно из: Мясо/рыба, Крупы/гарнир, Овощи/фрукты, Молочка, Хлеб/выпечка, Напитки, Перекусы, Специи/масло, Прочее), ` +
        `note (для какого приёма пищи и примерная цена в BYN).`;
      const parsed = await genJSON(ai, prompt, {
        type: Type.OBJECT,
        properties: {
          items: {
            type: Type.ARRAY,
            items: { type: Type.OBJECT, properties: { item: { type: Type.STRING }, qty: { type: Type.STRING }, category: { type: Type.STRING }, note: { type: Type.STRING } } },
          },
        },
      });
      return res.status(200).json({ items: parsed.items || [] });
    }

    if (task === 'itinerary') {
      const prompt =
        `Ты — организатор сообщества «Живи в моменте» (Минск, Беларусь). ` +
        `Составь МАРШРУТ ДНЯ (таймлайн по точкам) для события.\n\n` +
        `Название: «${ev.title || 'Событие'}». Тип: ${typeRu}. Локация: ${ev.location || 'не указана'}. Длительность: ${days}. Людей: ${people}.\n` +
        (ev.painPoint ? `Смысл/запрос: ${ev.painPoint}.\n` : '') +
        (Array.isArray(ev.program) && ev.program.length ? `Программа: ${ev.program.slice(0, 12).join('; ')}.\n` : '') +
        `\nВерни JSON: массив points из ${Number(body?.count) >= 1 && Number(body?.count) <= 15 ? `РОВНО ${Number(body.count)}` : '4–7'} точек по порядку дня. ` +
        `Каждая точка: time (ЧЧ:ММ), title (короткое название остановки на русском), ` +
        `payment (одно из: self=платит сам, host=за счёт организатора, split=делим поровну, free=бесплатно), ` +
        `price (число BYN, 0 если бесплатно/за счёт организатора), priceNote (за что платит, коротко). ` +
        `Координаты не указывай — их проставит организатор. Цены — ориентировочные по рынку Минска в BYN, реалистичные.`;
      const parsed = await genJSON(ai, prompt, {
        type: Type.OBJECT,
        properties: {
          points: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                time: { type: Type.STRING },
                title: { type: Type.STRING },
                payment: { type: Type.STRING },
                price: { type: Type.NUMBER },
                priceNote: { type: Type.STRING },
              },
              required: ['title'],
            },
          },
        },
        required: ['points'],
      });
      const points = (parsed.points || []).map((p: any) => ({
        time: String(p.time || ''),
        title: String(p.title || ''),
        payment: ['self', 'host', 'split', 'free'].includes(p.payment) ? p.payment : 'self',
        price: Number(p.price) || 0,
        priceNote: String(p.priceNote || ''),
      }));
      return res.status(200).json({ points, model: usedModel });
    }

    // task === 'program'
    const prompt =
      `Ты — чуткий наставник сообщества «Живи в моменте» (Минск). ` +
      `Мы создаём программу для события, и нам важно, чтобы каждый её пункт нёс тепло, ` +
      `вдохновение и пользу для участников.\n\n` +
      `Название: «${ev.title || 'Событие'}». Тип: ${typeRu}. Длительность: ${days}. Ожидается людей: ${people}.\n` +
      (ev.painPoint ? `Смысл/запрос: ${ev.painPoint}.\n` : '') +
      `Зачем мы это делаем: чтобы каждый участник ушёл с чувством, что время прошло не зря — ` +
      `он получил новые впечатления, знания или тёплые воспоминания.\n\n` +
      `Составь ПРОГРАММУ — живо, по-русски, без алкоголя, под тип и длительность. ` +
      // Админ задаёт количество ячеек в форме — генерим ровно столько.
      `Верни JSON: массив program из ${Number(body?.count) >= 1 && Number(body?.count) <= 20 ? `РОВНО ${Number(body.count)}` : '5–9'} пунктов (каждый — короткая строка шага программы, можно со временем).`;
    const parsed = await genJSON(ai, prompt, {
      type: Type.OBJECT,
      properties: { program: { type: Type.ARRAY, items: { type: Type.STRING } } },
      required: ['program'],
    });
    return res.status(200).json({ program: parsed.program || [], model: usedModel });
  } catch (err) {
    return res.status(200).json({ error: (err as Error).message });
  }
}