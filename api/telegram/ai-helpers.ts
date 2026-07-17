/**
 * Компактные ИИ-хелперы для бота: обучение на истории, парсинг задач/закупок/координат.
 * Экономим токены: короткие промпты, кеш контекста, быстрые модели.
 */

import { GoogleGenAI } from '@google/genai';

const API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
const ai = API_KEY ? new GoogleGenAI({ apiKey: API_KEY }) : null;

/** Быстрый текстовый ответ от ИИ (до 500 символов, экономим токены) */
export async function quickAI(prompt: string): Promise<string> {
  if (!ai) return '';
  try {
    const resp = await ai.models.generateContent({
      model: 'gemini-2.0-flash-exp',
      contents: prompt,
      config: { 
        maxOutputTokens: 256,
        temperature: 0.7,
        thinkingConfig: { thinkingBudget: 0 } // без CoT для скорости
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
      model: 'gemini-2.0-flash-exp',
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
      model: 'gemini-2.0-flash-exp',
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
      model: 'gemini-2.0-flash-exp',
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

/** Извлечь координаты из текста (только цифры!) */
export function parseCoordinates(text: string): { lat?: number; lon?: number } {
  // 53.9045, 27.5615 или 53.9045 27.5615
  const m = text.match(/(\d{1,2}\.\d{4,7})[,\s]+(\d{1,2}\.\d{4,7})/);
  if (m) return { lat: parseFloat(m[1]), lon: parseFloat(m[2]) };
  return {};
}

/** Извлечь время из текста */
export function parseTime(text: string): string | null {
  // "завтра в 9:00", "15.07 14:30", "через час"
  const patterns = [
    /(\d{1,2}):(\d{2})/,  // 9:00
    /(\d{1,2})\.(\d{1,2})\s+(\d{1,2}):(\d{2})/, // 15.07 14:30
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
      model: 'gemini-2.0-flash-exp',
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
