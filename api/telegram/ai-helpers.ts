/**
 * Компактные ИИ-хелперы для бота: обучение на истории, парсинг задач/закупок/координат.
 * Экономим токены: короткие промпты, кеш контекста, быстрые модели.
 */

import { GoogleGenAI } from '@google/genai';

const API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
const ai = API_KEY ? new GoogleGenAI({ apiKey: API_KEY }) : null;
// gemini-2.0-flash* удалены из API (404); у -latest квота есть (см. geminiJSON в webhook.ts).
const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';

/** Гарантированный JSON от Gemini (REST + фолбэк моделей, как geminiJSON в webhook). */
export async function aiJSON(prompt: string, maxTokens = 512): Promise<any | null> {
  if (!API_KEY) return null;
  const models = [process.env.GEMINI_MODEL, 'gemini-flash-latest', 'gemini-2.5-flash'].filter(Boolean) as string[];
  for (const model of models) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: maxTokens, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } },
        }),
      });
      const j: any = await r.json();
      const txt = (j?.candidates?.[0]?.content?.parts || []).map((p: any) => p?.text || '').join('').trim();
      if (!txt) continue;
      try { return JSON.parse(txt); } catch { const m = txt.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); }
    } catch { /* следующая модель */ }
  }
  return null;
}

/** Быстрый текстовый ответ от ИИ (до 500 символов, экономим токены) */
export async function quickAI(prompt: string): Promise<string> {
  if (!ai) return '';
  try {
    const resp = await ai.models.generateContent({
      model: MODEL,
      contents: prompt,
      config: { 
        maxOutputTokens: 256,
        temperature: 0.7,
        thinkingConfig: { thinkingBudget: 0 }
      }
    });
    return (resp.text || '').trim().slice(0, 500);
  } catch {
    return '';
  }
}

/** Парсинг свободного текста задачи → структура */
export async function parseTask(text: string): Promise<{
  title: string;
  needsAuto: boolean;
  time?: string;
  location?: string;
}> {
  const prompt =
    `Извлеки из задачи: заголовок (30 символов), нужен ли автомобиль, время, место.\n` +
    `Текст: "${text.slice(0, 300)}"\n` +
    `JSON: {title, needsAuto:bool, time?, location?}`;
  
  try {
    const resp = await ai?.models.generateContent({
      model: MODEL,
      contents: prompt,
      config: { 
        responseMimeType: 'application/json',
        maxOutputTokens: 128,
        thinkingConfig: { thinkingBudget: 0 }
      }
    });
    return JSON.parse(resp?.text || '{}');
  } catch {
    return { title: text.slice(0, 50), needsAuto: false };
  }
}

/** Парсинг снаряжения: "2 стула стол проектор" → [{item, qty}] */
export async function parseEquipment(text: string): Promise<Array<{item: string; qty: number}>> {
  const prompt =
    `Список снаряжения → JSON массив {item, qty}.\n` +
    `Вход: "${text.slice(0, 400)}"\n` +
    `Выход: [{item:"стул",qty:2},{item:"стол",qty:1},{item:"проектор",qty:1}]`;
  
  try {
    const resp = await ai?.models.generateContent({
      model: MODEL,
      contents: prompt,
      config: { 
        responseMimeType: 'application/json',
        maxOutputTokens: 256,
        thinkingConfig: { thinkingBudget: 0 }
      }
    });
    const parsed = JSON.parse(resp?.text || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [{ item: text.slice(0, 50), qty: 1 }];
  }
}

/** Парсинг пожеланий к закупке → категории */
export async function parseShoppingPrefs(text: string): Promise<{
  categories: string[];
  items: string[];
}> {
  const prompt =
    `Пожелания к закупке → категории (dairy/sweets/fruits/drinks/snacks/meat) + конкретные продукты.\n` +
    `Текст: "${text.slice(0, 300)}"\n` +
    `JSON: {categories:[...], items:[...]}`;
  
  try {
    const resp = await ai?.models.generateContent({
      model: MODEL,
      contents: prompt,
      config: { 
        responseMimeType: 'application/json',
        maxOutputTokens: 128,
        thinkingConfig: { thinkingBudget: 0 }
      }
    });
    return JSON.parse(resp?.text || '{"categories":[],"items":[]}');
  } catch {
    return { categories: [], items: [text] };
  }
}

/** ИИ-парсинг расхода из свободного текста: «Мясо 80 маршмелоу 18 и огурцы 1 кг — 5 BYN» → [{title, amount}] */
export async function parseExpenseAI(text: string): Promise<Array<{title: string; amount: number}>> {
  const prompt =
    `Раздели текст на ОТДЕЛЬНЫЕ покупки. КАЖДАЯ покупка = название + сумма.\n` +
    `Текст: "${text.slice(0, 400)}"\n` +
    `Верни ТОЛЬКО JSON: {"items":[{"title":"название","amount":число}]}\n` +
    `Правила:\n` +
    `1. Разделяй по запятым, "и", "плюс".\n` +
    `2. КАЖДАЯ позиция отдельно: "Мясо 80, маршмелоу 18" → [{"title":"Мясо","amount":80},{"title":"Маршмелоу","amount":18}]\n` +
    `3. "Мясо 80 маршмелоу 18 и огурцы 1 кг — 5 BYN" → [{"title":"Мясо","amount":80},{"title":"Маршмелоу","amount":18},{"title":"Огурцы 1 кг","amount":5}]\n` +
    `4. Одна позиция = один item.\n` +
    `5. Если не разобрал → {"items":[]}`;

  try {
    const resp = await ai?.models.generateContent({
      model: MODEL,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        maxOutputTokens: 256,
        thinkingConfig: { thinkingBudget: 0 }
      }
    });
    const parsed = JSON.parse(resp?.text || '{}');
    const items = Array.isArray(parsed?.items) ? parsed.items : (Array.isArray(parsed) ? parsed : []);
    return items
      .map((i: any) => ({ title: String(i.title || '').slice(0, 50), amount: Number(i.amount) || 0 }))
      .filter((i: any) => i.title && i.amount > 0);
  } catch {
    return [];
  }
}

/** Извлечь координаты из текста (только цифры!) */
export function parseCoordinates(text: string): { lat?: number; lon?: number } {
  const m = text.match(/(\d{1,2}\.\d{4,7})[,\s]+(\d{1,2}\.\d{4,7})/);
  if (m) return { lat: parseFloat(m[1]), lon: parseFloat(m[2]) };
  return {};
}

/** Извлечь время из текста */
export function parseTime(text: string): string | null {
  const patterns = [
    /(\d{1,2}):(\d{2})/,
    /(\d{1,2})\.(\d{1,2})\s+(\d{1,2}):(\d{2})/,
    /(завтра|сегодня|послезавтра)/i
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[0];
  }
  return null;
}

/** ИИ анализ истории чата → что нужно сделать (обучение в моменте) */
export async function analyzeChat(messages: Array<{text: string; from: string}>, eventCtx: string): Promise<{
  action: 'create_task' | 'suggest_ride' | 'answer_info' | 'group_shopping' | 'silent';
  reason: string;
  data?: any;
}> {
  const history = messages.slice(-10).map(m => `${m.from}: ${m.text}`).join('\n');
  const prompt =
    `Событие: ${eventCtx}\n` +
    `Последние 10 сообщений чата:\n${history}\n\n` +
    `Определи ОДНО действие:\n` +
    `- create_task: кто-то вызвался что-то сделать ("я возьму проектор", "заберу вещи")\n` +
    `- suggest_ride: кто-то ищет место в машине или предлагает подвезти\n` +
    `- group_shopping: предложение закупки ("купим мороженое", "кто за еду?")\n` +
    `- answer_info: вопрос о событии (время, место, кто едет)\n` +
    `- silent: обычная беседа, бот молчит\n\n` +
    `JSON: {action, reason:"почему", data?:{task_title?, ride_from?, shopping_title?}}`;
  
  try {
    const resp = await ai?.models.generateContent({
      model: MODEL,
      contents: prompt,
      config: { 
        responseMimeType: 'application/json',
        maxOutputTokens: 256,
        thinkingConfig: { thinkingBudget: 0 }
      }
    });
    return JSON.parse(resp?.text || '{"action":"silent","reason":""}');
  } catch {
    return { action: 'silent', reason: '' };
  }
}

// Библиотечный модуль: прямой HTTP-вызов не предусмотрен (без этого Vercel 500-ил).
export default async function handler(_req: any, res: any) {
  return res.status(404).json({ error: 'Not an endpoint' });
}