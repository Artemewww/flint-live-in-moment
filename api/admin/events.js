// API для админского управления мероприятиями
// Доступно только с секретным токеном

import { QUALITIES, INITIAL_EVENTS, getToday } from '../../shared/events.data.js';

// В продакшене токен должен храниться в Vercel Environment Variables
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'flint-admin-2026';

// Хранилище событий (в продакшене - Vercel KV)
let eventsStore = [...INITIAL_EVENTS];

export default async function handler(req, res) {
  // Проверка токена
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${ADMIN_TOKEN}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  switch (req.method) {
    case 'GET':
      // Получить все мероприятия
      return res.status(200).json(eventsStore);

    case 'POST':
      // Добавить/обновить мероприятие
      const event = req.body;
      const existingIndex = eventsStore.findIndex(e => e.id === event.id);
      
      if (existingIndex >= 0) {
        eventsStore[existingIndex] = event;
      } else {
        eventsStore.push(event);
      }
      
      return res.status(200).json({ success: true, event });

    case 'DELETE':
      // Удалить мероприятие
      const { eventId } = req.query;
      eventsStore = eventsStore.filter(e => e.id !== eventId);
      return res.status(200).json({ success: true });

    default:
      return res.status(405).json({ error: 'Method not allowed' });
  }
}