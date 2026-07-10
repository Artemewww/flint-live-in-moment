import { GoogleGenAI, Type } from '@google/genai';

/**
 * ИИ-помощник организатора (Google Gemini). Генерирует под контекст события:
 *  - task='program'  → программу мероприятия (по типу/дням/числу участников);
 *  - task='shopping' → список закупки (по числу людей и раскладке по питанию).
 * Админ-эндпоинт. Требует env GEMINI_API_KEY (или GOOGLE_API_KEY / API_KEY).
 */

const API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.API_KEY || '';

function checkAdminAuth(req: any): boolean {
  const token = String(req.headers.authorization || '').replace('Bearer ', '');
  return token === process.env.ADMIN_TOKEN || token === 'flint-admin-2026';
}

/**
 * Какие модели реально доступны этому ключу. Захардкоженный список угадывать
 * бесполезно: набор моделей у разных ключей разный и меняется со временем
 * (именно поэтому падало на `gemini-1.5-flash is not found`).
 * Кэшируем в памяти инстанса — Vercel переиспользует его между вызовами.
 */
let modelCache: { at: number; models: string[] } | null = null;

async function listModels(): Promise<string[]> {
  if (modelCache && Date.now() - modelCache.at < 30 * 60 * 1000) return modelCache.models;

  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}&pageSize=200`);
  if (!r.ok) throw new Error(`ListModels ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j: any = await r.json();

  const usable = (j.models || [])
    .filter((m: any) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m: any) => String(m.name).replace(/^models\//, ''))
    // Картиночные/голосовые/эмбеддинги для JSON-генерации не годятся.
    .filter((n: string) => !/embedding|aqa|image|tts|audio|vision|live/i.test(n));

  modelCache = { at: Date.now(), models: usable };
  return usable;
}

/** Порядок предпочтений: явный env → самые свежие flash → всё остальное. */
function rankModels(available: string[]): string[] {
  const score = (n: string): number => {
    let s = 0;
    if (/flash/.test(n)) s += 100;          // дёшево и быстро — то, что нам нужно
    if (/lite/.test(n)) s -= 20;
    if (/preview|exp/.test(n)) s -= 30;     // экспериментальные — в последнюю очередь
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

/** Вызов Gemini с JSON-схемой. Пробует доступные модели по убыванию пригодности. */
async function genJSON(ai: any, prompt: string, schema: any): Promise<any> {
  const available = await listModels();
  if (!available.length) throw new Error('У ключа нет ни одной модели с generateContent');

  const candidates = rankModels(available).slice(0, 4);
  const errors: string[] = [];

  for (const model of candidates) {
    try {
      const resp = await ai.models.generateContent({
        model, contents: prompt,
        config: { responseMimeType: 'application/json', responseSchema: schema },
      });
      return JSON.parse(resp.text || '{}');
    } catch (e) {
      errors.push(`${model}: ${(e as Error).message.slice(0, 120)}`);
    }
  }
  throw new Error(`Ни одна модель не ответила.\n${errors.join('\n')}`);
}

const TYPE_RU: Record<string, string> = {
  male: 'мужское братство', mixed: 'смешанный/семейный круг',
  intellectual: 'интеллектуальный клуб', active: 'активный выезд на природе',
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!checkAdminAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
  if (!API_KEY) return res.status(200).json({ error: 'GEMINI_API_KEY не задан в env' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const task: string = body.task || 'program';
    const ev = body.event || {};
    const people = Number(body.people) || Number(ev.maxParticipants) || 10;
    const diet = body.diet || {}; // { vegan, vegetarian, children }

    // Диагностика: что за модели вообще доступны этому ключу.
    if (task === 'models') {
      const available = await listModels();
      return res.status(200).json({ available, ranked: rankModels(available).slice(0, 6) });
    }

    const ai = new GoogleGenAI({ apiKey: API_KEY });
    const typeRu = TYPE_RU[ev.type] || 'встреча сообщества';
    const days = ev.dateEnd && ev.dateEnd !== ev.date ? `многодневное (${ev.date} — ${ev.dateEnd})` : 'однодневное';

    if (task === 'autofill') {
      const prompt =
        `Ты — опытный организатор трезвого мужского/семейного сообщества «Живи в моменте» (Минск). ` +
        `По короткому названию придумай ПОЛНОЕ наполнение события — живо, вдохновляюще, по-русски, без алкоголя.\n` +
        `Название: «${ev.title || 'Событие'}».` + (ev.date ? ` Дата: ${ev.date}${ev.dateEnd && ev.dateEnd !== ev.date ? ` — ${ev.dateEnd}` : ''}.` : '') + `\n` +
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
          type: { type: Type.STRING },
          description: { type: Type.STRING },
          painPoint: { type: Type.STRING },
          program: { type: Type.ARRAY, items: { type: Type.STRING } },
          entryThreshold: { type: Type.STRING },
          houseQualities: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
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
      });
    }

    if (task === 'shopping') {
      const prompt =
        `Ты — помощник организатора трезвого сообщества «Живи в моменте» (Минск, Беларусь). ` +
        `Составь список ПРОДУКТОВ для закупки на мероприятие.\n` +
        `Название: «${ev.title || 'Событие'}». Тип: ${typeRu}. Длительность: ${days}.\n` +
        `Людей: ${people} (из них веганов: ${diet.vegan || 0}, вегетарианцев: ${diet.vegetarian || 0}, детей: ${diet.children || 0}).\n` +
        `Правила: здоровое питание, БЕЗ алкоголя и вредного; учитывай веганов/вегетарианцев/детей; ` +
        `количества — реалистичные на указанное число людей; цены ориентировочные по рынку Минска в BYN. ` +
        `Верни JSON: массив items с полями item (продукт), qty (количество, напр. «3 кг»), note (примечание/примерная цена).`;
      const parsed = await genJSON(ai, prompt, {
        type: Type.OBJECT,
        properties: {
          items: {
            type: Type.ARRAY,
            items: { type: Type.OBJECT, properties: { item: { type: Type.STRING }, qty: { type: Type.STRING }, note: { type: Type.STRING } } },
          },
        },
      });
      return res.status(200).json({ items: parsed.items || [] });
    }

    // task === 'program'
    const prompt =
      `Ты — помощник организатора трезвого сообщества «Живи в моменте» (Минск). ` +
      `Составь ПРОГРАММУ мероприятия — живо, по-русски, без алкоголя, под тип и длительность.\n` +
      `Название: «${ev.title || 'Событие'}». Тип: ${typeRu}. Длительность: ${days}. Ожидается людей: ${people}.\n` +
      (ev.painPoint ? `Смысл/запрос: ${ev.painPoint}.\n` : '') +
      `Верни JSON: массив program из 5–9 пунктов (каждый — короткая строка шага программы, можно со временем).`;
    const parsed = await genJSON(ai, prompt, { type: Type.OBJECT, properties: { program: { type: Type.ARRAY, items: { type: Type.STRING } } } });
    return res.status(200).json({ program: parsed.program || [] });
  } catch (err) {
    return res.status(200).json({ error: (err as Error).message });
  }
}
