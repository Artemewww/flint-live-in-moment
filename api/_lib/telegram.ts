/**
 * Общие утилиты для работы с Telegram API.
 * Файлы с префиксом `_` не считаются Serverless Functions в Vercel.
 */

import * as crypto from 'crypto';

/**
 * Проверка подписи Telegram WebApp initData.
 * Возвращает достоверные данные пользователя из Telegram Mini App.
 * 
 * @param initData - строка initData из window.Telegram.WebApp
 * @param botToken - токен бота из process.env.TELEGRAM_BOT_TOKEN
 * @returns объект с id, username, first_name или null если подпись недействительна
 */
export function verifyInitData(
  initData: string,
  botToken: string
): { id: number; username?: string; first_name?: string } | null {
  if (!initData || !botToken) return null;
  
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    
    params.delete('hash');
    
    // Собираем data-check-string: сортированные пары ключ=значение через \n
    const dataCheckString = [...params.entries()]
      .map(([k, v]) => `${k}=${v}`)
      .sort()
      .join('\n');
    
    // Создаём секретный ключ через HMAC-SHA256 от 'WebAppData' и токена бота
    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(botToken)
      .digest();
    
    // Вычисляем хеш от data-check-string через секретный ключ
    const computedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');
    
    // Сверяем полученный хеш с переданным
    if (computedHash !== hash) return null;
    
    // Проверка свежести данных (защита от replay-атак)
    const authDate = Number(params.get('auth_date') || 0);
    const ageSeconds = Date.now() / 1000 - authDate;
    if (ageSeconds > 3600) {
      // initData старше 1 часа — отклоняем (рекомендация Telegram)
      return null;
    }
    
    // Парсим объект user
    const userJson = params.get('user');
    if (!userJson) return null;
    
    const user = JSON.parse(userJson);
    return user && user.id ? user : null;
  } catch (error) {
    // Ошибка парсинга или криптографии — не валидные данные
    return null;
  }
}

/**
 * Генерирует стабильный отрицательный telegram_id из строки (для веб-заявок без Telegram).
 * Отрицательное значение гарантирует отсутствие конфликта с реальными Telegram ID.
 */
export function idFromHandle(handle: string): number {
  let hash = 0;
  for (let i = 0; i < handle.length; i++) {
    hash = (hash * 31 + handle.charCodeAt(i)) | 0;
  }
  return -Math.abs(hash) - 1;
}

/**
 * Экранирует HTML-специальные символы для безопасной вставки в Telegram HTML-сообщения.
 */
export function escapeHtml(text: string): string {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Отправляет сообщение через Telegram Bot API.
 * 
 * @param botToken - токен бота
 * @param method - метод API (sendMessage, editMessageText, etc.)
 * @param payload - параметры запроса
 * @returns Promise с результатом от Telegram API
 */
export async function telegramApiCall(
  botToken: string,
  method: string,
  payload: Record<string, unknown>
): Promise<any> {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  
  return response.json();
}
