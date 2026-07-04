import type { VercelRequest, VercelResponse } from '@vercel/node';
import { INITIAL_EVENTS } from '../src/data';
import { getEventPhase } from '../src/types';

/**
 * Единый источник правды о мероприятиях для Telegram-бота.
 *
 * Бот делает GET /api/events и всегда показывает те же события и статусы,
 * что и сайт. Заблокированные («под замочком») события приходят с
 * phase === 'locked' — бот показывает их как «скоро откроется».
 *
 * Так сайт и бот работают на одних данных: меняете src/data.ts —
 * обновляется и сайт, и то, что отдаётся боту.
 */
export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const events = INITIAL_EVENTS.map((e) => {
    const phase = getEventPhase(e);
    return {
      id: e.id,
      title: e.title,
      type: e.type,
      date: e.date,
      dateLabel: e.dateLabel,
      time: e.time,
      location: e.location,
      priceLabel: e.priceLabel,
      entryThreshold: e.entryThreshold,
      maxParticipants: e.maxParticipants ?? null,
      participantsCount: e.participantsCount,
      phase, // 'past' | 'locked' | 'open' | 'full' | 'closed'
      isOpen: phase === 'open',
      lockedHint: e.lockedHint ?? null,
      botDeepLink: `https://t.me/LiveInMomentBot?start=event_${e.id}`,
    };
  });

  res.status(200).json({
    updatedAt: new Date().toISOString(),
    count: events.length,
    events,
  });
}
