import { GoogleGenAI, Type } from '@google/genai';
import { createClient } from '@supabase/supabase-js';
import * as crypto from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

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

const ENV_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.API_KEY || '';

// Ключ, изменённый из панели организатора (app_config), имеет приоритет над env —
// так можно сменить ключ на исчерпанной квоте без редеплоя. Кэш 60с.
let keyCache: { key: string; at: number } | null = null;
async function getActiveGeminiKey(): Promise<string> {
  if (keyCache && Date.now() - keyCache.at < 60_000) return keyCache.key;
  let key = ENV_API_KEY;
  try {
    const { data } = await supabase.from('app_config').select('value').eq('key', 'gemini_api_key').maybeSingle();
    if (data?.value) key = data.value;
  } catch { /* таблицы нет — работаем на env */ }
  keyCache = { key, at: Date.now() };
  return key;
}

/**
 * Какие модели реально доступны этому ключу. Захардкоженный список угадывать
 * бесполезно: набор моделей у разных ключей разный и меняется со временем
 * (именно поэтому падало на `gemini-1.5-flash is not found`).
 * Кэшируем в памяти инстанса — Vercel переиспользует его между вызовами.
 */
let modelCache: { at: number; models: string[] } | null = null;

/** Какая модель в итоге ответила — возвращаем клиенту, чтобы отладка не была гаданием. */
let usedModel = '';

async function listModels(apiKey: string): Promise<string[]> {
  if (modelCache && Date.now() - modelCache.at < 30 * 60 * 1000) return modelCache.models;

  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=200`);
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

async function genJSON(ai: any, apiKey: string, prompt: string, schema: any): Promise<any> {
  const available = await listModels(apiKey);
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
  if (quota) await notifyQuotaExhausted();
  throw new Error(
    (quota ? 'Похоже, выбрана дневная квота Gemini у ключа. ' : '') +
    `Ни одна из ${queue.length} моделей не ответила.\n${errors.join('\n')}`
  );
}

/** Уведомить админа о закончившейся квоте — не чаще раза в 2 часа (throttle в app_config). */
async function notifyQuotaExhausted() {
  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
  const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID || '-1003935660570';
  if (!BOT_TOKEN) return;
  try {
    const { data } = await supabase.from('app_config').select('value').eq('key', 'gemini_quota_notified_at').maybeSingle();
    const last = data?.value ? new Date(data.value).getTime() : 0;
    if (Date.now() - last < 2 * 3600 * 1000) return;
    await supabase.from('app_config').upsert({ key: 'gemini_quota_notified_at', value: new Date().toISOString() }, { onConflict: 'key' });
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: ADMIN_CHAT_ID, parse_mode: 'HTML',
        text: '⚠️ <b>Квота Gemini API закончилась</b>\n\nИИ-функции сейчас не отвечают — идёт безопасный фолбэк.\nВставь новый ключ: панель организатора → 🔑 ИИ-ключ (Gemini).',
      }),
    });
  } catch { /* best-effort, таблицы может не быть */ }
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
  const apiKey = await getActiveGeminiKey();
  if (!apiKey) return res.status(200).json({ error: 'GEMINI_API_KEY не задан' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const task: string = body.task || 'program';
    const ev = body.event || {};
    const people = Number(body.people) || Number(ev.maxParticipants) || 10;
    const diet = body.diet || {};

    if (task === 'models') {
      const available = await listModels(apiKey);
      return res.status(200).json({ available, ranked: rankModels(available).slice(0, 6) });
    }

    const ai = new GoogleGenAI({ apiKey });
    const typeRu = TYPE_RU[ev.type] || 'встреча сообщества';
    const days = ev.dateEnd && ev.dateEnd !== ev.date ? `многодневное (${ev.date} — ${ev.dateEnd})` : 'однодневное';

    // Свободный текст участника → готовое голосование (вопрос + варианты).
    // Пример: «предлагаю кино ночью, у меня проектор» → «Смотрим кино ночью?» [Да/Нет].
    if (task === 'poll') {
      const freeText = String(body.text || '').slice(0, 800);
      const prompt =
        `Ты — помощник сообщества «Живи в моменте». Участник предлагает что-то на голосование ` +
        `на событии «${ev.title || 'событие'}» (${typeRu}).\n\n` +
        `Его сообщение (свободный текст): «${freeText}»\n\n` +
        `Сформулируй ЧЁТКОЕ голосование:\n` +
        `- question: короткий вопрос (напр. «Смотрим кино ночью у костра?»).\n` +
        `- options: 2–5 конкретных вариантов ответа. Если это «да/нет» — верни [«Да, за», «Нет»]. ` +
        `Если предложены конкретные альтернативы (фильмы, места) — сделай их вариантами.\n` +
        `- topic: одно-два слова темы (кино, поездка, еда, программа…).\n` +
        `- summary: одна строка пояснения для участников (что именно предлагают и детали: инвентарь, цена, время).\n\n` +
        `Пиши по-русски, дружелюбно. Верни JSON: { question, options: [строки], topic, summary }.`;
      const parsed = await genJSON(ai, apiKey, prompt, {
        type: Type.OBJECT,
        properties: {
          question: { type: Type.STRING },
          options: { type: Type.ARRAY, items: { type: Type.STRING } },
          topic: { type: Type.STRING },
          summary: { type: Type.STRING },
        },
        required: ['question', 'options'],
      });
      const options = (parsed.options || []).map((s: any) => String(s).slice(0, 100)).filter(Boolean).slice(0, 5);
      return res.status(200).json({
        question: String(parsed.question || 'Голосование').slice(0, 200),
        options: options.length >= 2 ? options : ['Да, за', 'Нет'],
        topic: String(parsed.topic || '').slice(0, 40),
        summary: String(parsed.summary || '').slice(0, 300),
        model: usedModel,
      });
    }

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
      const p = await genJSON(ai, apiKey, prompt, {
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
        `- maxParticipants: реалистичное число участников (5–30);\n` +
        `- format: 'offline' (встречаемся вживую), 'online' (созвон/зум, никто никуда не едет) ` +
        `или 'hybrid' (часть онлайн, часть вживую). Определи по сути идеи: голодание/марафон/разбор ` +
        `по видеосвязи — это online, выезд/баня/поход — offline;\n` +
        `- needsFood: true, если на событии совместная еда/готовка (для выездов почти всегда true, ` +
        `для онлайна — false);\n` +
        `- needsRides: true, если участникам надо ДОБИРАТЬСЯ до места (машины, попутки). ` +
        `Для online всегда false;\n` +
        `- needsTents: true, только если событие с ночёвкой в палатках. Для однодневных и online — false.`;
      const p = await genJSON(ai, apiKey, sys, {
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
          format: { type: Type.STRING, enum: ['offline', 'online', 'hybrid'] },
          needsFood: { type: Type.BOOLEAN },
          needsRides: { type: Type.BOOLEAN },
          needsTents: { type: Type.BOOLEAN },
        },
        required: ['title', 'type', 'description', 'painPoint', 'program', 'entryThreshold', 'houseQualities', 'maxParticipants', 'format'],
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
      /**
       * Адаптивная структура: блоки события зависят от его сути, а не от типа.
       * Онлайн-встрече не нужны машины, палатки и совместная готовка — раньше
       * организатор выключал их руками (а чаще забывал, и участники получали
       * логистику по зуму).
       *
       * Онлайн жёстко перекрывает ответ модели: даже если она поставит
       * needsRides=true, добираться никуда не надо — это противоречие в её
       * ответе, а не пожелание организатора.
       */
      const format = ['offline', 'online', 'hybrid'].includes(p.format) ? p.format : 'offline';
      const online = format === 'online';
      draft.format = format;
      draft.features = {
        feat_food: online ? false : p.needsFood !== false,
        feat_rides: online ? false : p.needsRides !== false,
        feat_tents: online ? false : p.needsTents === true,
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
      const p = await genJSON(ai, apiKey, sys, {
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
      const p = await genJSON(ai, apiKey, sys, {
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
        `4. НЕ добавляй лишнего «на всякий случай». Скоропорт (молочка, мясо, колбасы) — минимально или исключи: в походе нет холодильника и жара. База — крупы, макароны, консервы (тушёнка в жести), ультрапастеризованное молоко, сухофрукты.\n` +
        `5. Питьевая вода ОБЯЗАТЕЛЬНО: 4 литра на человека в СУТКИ (готовка+питьё), в канистрах — вода на месте может быть непригодна. Посчитай точно на всех и на все дни.\n` +
        `6. Хозтовары ОБЯЗАТЕЛЬНО (категория «Прочее»): газовые баллоны для горелок, туалетная бумага, мусорные пакеты (с запасом — вывозим и чужой мусор), средство для мытья посуды + губки, розжиг/спички, салфетки, антисептик.\n` +
        `7. Без алкоголя и вредного. Цены — ориентировочные по рынку Минска в BYN.\n\n` +
        `Верни JSON: массив items. Каждый элемент: item (продукт), qty (точное количество с единицей, напр. «3.5 кг» или «12 шт»), ` +
        `category (одно из: Мясо/рыба, Крупы/гарнир, Овощи/фрукты, Молочка, Хлеб/выпечка, Напитки, Перекусы, Специи/масло, Прочее), ` +
        `note (для какого приёма пищи и примерная цена в BYN).`;
      const parsed = await genJSON(ai, apiKey, prompt, {
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
      const parsed = await genJSON(ai, apiKey, prompt, {
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

    if (task === 'prep') {
      // Памятка участнику: правила локации, юридика РБ, сезон, снаряжение,
      // еда/вода, протокол при проверках. Хранится в logistics.prep,
      // бот показывает кнопкой «Как готовиться».
      const month = (() => { try { return new Date(ev.date).getMonth() + 1; } catch { return 0; } })();
      const season = month >= 6 && month <= 8 ? 'лето' : month >= 3 && month <= 5 ? 'весна' : month >= 9 && month <= 11 ? 'осень' : 'зима';
      const outdoors = ['hiking', 'camp', 'active', 'mixed'].includes(String(ev.type)) || (ev.dateEnd && ev.dateEnd !== ev.date);
      const prompt =
        `Ты — опытный координатор выездов сообщества «Живи в моменте» (Минск, Беларусь; 100% трезвость, экологичность). ` +
        `Составь ПАМЯТКУ УЧАСТНИКУ для события — конкретную, практичную, без воды.\n\n` +
        `Название: «${ev.title || 'Событие'}». Тип: ${typeRu}. Локация: ${ev.location || 'не указана'}. ` +
        `Даты: ${ev.date || '—'}${ev.dateEnd && ev.dateEnd !== ev.date ? ` — ${ev.dateEnd}` : ''} (${season}). Длительность: ${days}. Людей: ${people}.\n` +
        (ev.description ? `Описание: ${String(ev.description).slice(0, 300)}.\n` : '') +
        (Array.isArray(ev.program) && ev.program.length ? `Программа: ${ev.program.slice(0, 10).join('; ')}.\n` : '') +
        `\nСтруктура памятки (заголовки с эмодзи, пункты с «•», чек-лист с «☐»):\n` +
        `1. 🏕 ЛОКАЦИЯ И ПРАВИЛА — специфика места и правовые рамки РБ: где купание запрещено (ст. 24.42 КоАП), костры только в кострищах/на мангале (при пожарной опасности — только газ), машины не ближе 30 м от воды, не повреждать грунт/деревья. Только то, что относится к типу события.\n` +
        `2. 🌦 СЕЗОН — чего ждать от погоды (${season}) и как адаптироваться (одежда, обувь, защита вещей).\n` +
        `3. 🎒 СНАРЯЖЕНИЕ КАЖДОМУ — чек-лист «☐» под тип события${outdoors ? ' (палатка 2-слойная от 3000 мм, спальник по сезону, каремат от 10 мм, фонарь+батарейки, посуда, дождевик, гермомешок, паспорт, лекарства, термос)' : ' (по ситуации: удобная обувь, вода, паспорт)'}.\n` +
        (outdoors ? `4. 🍲 ЕДА И ВОДА — общий котёл, без скоропорта, вода 4 л/чел/сутки в канистрах.\n5. 👮 ЕСЛИ ПРОВЕРКА — один переговорщик, показать огнетушитель/порядок, машины вне водоохранной зоны, эко-мешки (вывозим свой и чужой мусор).\n` : `4. 🍲 ЕДА И ВОДА — что взять с собой или как устроено питание.\n`) +
        `В конце: «🚭 Формат клуба: 100% трезвость, экологичность, взаимопомощь.»\n` +
        `Объём 1200–2200 символов. Верни JSON: { prep: "текст памятки" }.`;
      const parsed = await genJSON(ai, apiKey, prompt, {
        type: Type.OBJECT,
        properties: { prep: { type: Type.STRING } },
        required: ['prep'],
      });
      return res.status(200).json({ prep: String(parsed.prep || ''), model: usedModel });
    }

    // task === 'program'
    // Режим правки: instruction (что поменять / новая дата) + current (текущая
    // программа) — ИИ переносит время/даты и правит только нужное.
    const instruction = String(body?.instruction || '').slice(0, 800);
    const current: string[] = Array.isArray(body?.current) ? body.current.slice(0, 20).map((s: any) => String(s)) : [];
    const prompt =
      `Ты — чуткий наставник сообщества «Живи в моменте» (Минск). ` +
      `Мы создаём программу для события, и нам важно, чтобы каждый её пункт нёс тепло, ` +
      `вдохновение и пользу для участников.\n\n` +
      `Название: «${ev.title || 'Событие'}». Тип: ${typeRu}. Длительность: ${days}. Ожидается людей: ${people}.\n` +
      (ev.date ? `Дата начала: ${ev.date}${ev.time ? `, старт ${ev.time}` : ''}${ev.dateEnd && ev.dateEnd !== ev.date ? `, окончание ${ev.dateEnd}` : ''}.\n` : '') +
      (ev.painPoint ? `Смысл/запрос: ${ev.painPoint}.\n` : '') +
      (current.length
        ? `\nТЕКУЩАЯ ПРОГРАММА:\n${current.map((p, i) => `${i + 1}. ${p}`).join('\n')}\n\n` +
          `ЗАДАЧА: отредактируй текущую программу${instruction ? ` по инструкции: «${instruction}»` : ''}. ` +
          `Сохрани смысл и структуру пунктов, но пересчитай ВСЕ дни недели, даты и время под актуальные даты события — несоответствий остаться не должно. ` +
          `Меняй только то, что требует инструкция или новые даты.\n`
        : `Зачем мы это делаем: чтобы каждый участник ушёл с чувством, что время прошло не зря — ` +
          `он получил новые впечатления, знания или тёплые воспоминания.\n\n` +
          `Составь ПРОГРАММУ — живо, по-русски, без алкоголя, под тип и длительность. `) +
      // Полнота: многодневным — почасовая детализация на каждый день.
      `ФОРМАТ КАЖДОГО ПУНКТА: «ДД месяц, ЧЧ:ММ — что делаем (конкретно: какие игры/активности), ключевые моменты» — дата И время обязательны в каждом пункте (дни путать нельзя).\n` +
      `Верни JSON: массив program из ${Number(body?.count) >= 1 && Number(body?.count) <= 40 ? `РОВНО ${Number(body.count)}` : current.length ? `не меньше ${current.length}` : (ev.dateEnd && ev.dateEnd !== ev.date ? '10–14 пунктов НА КАЖДЫЙ день (почасовая программа: подъём, еда, активности, вечер)' : '8–12')} пунктов.`;
    const parsed = await genJSON(ai, apiKey, prompt, {
      type: Type.OBJECT,
      properties: { program: { type: Type.ARRAY, items: { type: Type.STRING } } },
      required: ['program'],
    });
    return res.status(200).json({ program: parsed.program || [], model: usedModel });
  } catch (err) {
    return res.status(200).json({ error: (err as Error).message });
  }
}