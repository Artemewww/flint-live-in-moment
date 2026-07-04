// Единый источник мероприятий вынесен в ../shared/events.data.js —
// им пользуются И сайт (этот re-export), И serverless-API /api/events (для бота).
// Файл сделан на чистом JS, чтобы рантайм Vercel надёжно его бандлил в функцию.
import type { CommunityEvent, HouseQuality } from './types';
import { QUALITIES as SHARED_QUALITIES, INITIAL_EVENTS as SHARED_EVENTS } from '../shared/events.data.js';

// Данные в JS-модуле корректны; типы задаёт TS-контракт CommunityEvent.
export const QUALITIES = SHARED_QUALITIES as unknown as Record<string, HouseQuality>;
export const INITIAL_EVENTS = SHARED_EVENTS as unknown as CommunityEvent[];
