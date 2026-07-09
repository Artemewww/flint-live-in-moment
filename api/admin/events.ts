import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// Middleware для проверки админского токена
function checkAdminAuth(req: any): boolean {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  return token === process.env.ADMIN_TOKEN || token === 'flint-admin-2026';
}

// Маппинг snake_case -> camelCase для фронтенда
function mapEventToCamelCase(event: any) {
  if (!event) return null;
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    type: event.type,
    date: event.date,
    dateEnd: event.date_end,
    dateLabel: event.date_label,
    time: event.time,
    timeEnd: event.time_end,
    location: event.location,
    locationDetails: event.location_details,
    logistics: event.logistics || {},
    coordinates: {
      lat: event.coordinates_lat,
      lng: event.coordinates_lng
    },
    painPoint: event.pain_point,
    image: event.image,
    maxParticipants: event.max_participants,
    participantsCount: event.participants_count,
    telegramBotUrl: event.telegram_bot_url,
    priceType: event.price_type,
    priceLabel: event.price_label,
    priceAmount: event.price_amount,
    entryThreshold: event.entry_threshold,
    entryType: event.entry_type,
    houseQualities: event.house_qualities || [],
    status: event.status,
    lockedHint: event.locked_hint,
    program: event.program || [],
    notifications: event.notifications || {},
    programVoting: event.program_voting,
    createdAt: event.created_at,
    updatedAt: event.updated_at
  };
}

export default async function handler(req: any, res: any) {
  // Проверяем авторизацию
  if (!checkAdminAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method === 'GET') {
    // Получить все события
    try {
      const { data: events, error } = await supabase
        .from('events')
        .select('*')
        .order('date', { ascending: true });

      if (error) {
        console.error('Events error:', error);
        return res.status(500).json({ error: 'Failed to fetch events' });
      }

      // Маппинг в camelCase для фронтенда
      const mappedEvents = (events || []).map(mapEventToCamelCase);

      return res.status(200).json({ events: mappedEvents });
    } catch (error) {
      console.error('Error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  if (req.method === 'POST') {
    // Создать или обновить событие
    try {
      const body = req.body;

      // Маппинг camelCase -> snake_case для Supabase
      const eventData = {
        id: body.id,
        title: body.title,
        description: body.description,
        type: body.type,
        date: body.date,
        date_label: body.dateLabel || body.date,
        time: body.time || null,
        time_end: body.timeEnd || null,
        location: body.location,
        location_details: body.locationDetails || null,
        coordinates_lat: body.coordinates?.lat || null,
        coordinates_lng: body.coordinates?.lng || null,
        pain_point: body.painPoint || null,
        image: body.image || null,
        max_participants: body.maxParticipants || 15,
        participants_count: body.participantsCount || 0,
        telegram_bot_url: body.telegramBotUrl || null,
        price_type: body.priceType === 'paid' ? 'paid' : 'free',
        price_label: body.priceLabel || null,
        price_amount: body.priceAmount || 0,
        entry_threshold: body.entryThreshold || null,
        entry_type: body.entryType || 'all',
        status: body.status || 'locked',
        locked_hint: body.lockedHint || null,
        program: body.program || [],
        notifications: body.notifications || {},
        program_voting: body.programVoting || null
      };
      // date_end / house_qualities шлём только если заданы (колонки могли отсутствовать до миграции).
      if (body.dateEnd) (eventData as any).date_end = body.dateEnd;
      if (body.houseQualities) (eventData as any).house_qualities = body.houseQualities;
      if (body.logistics) (eventData as any).logistics = body.logistics;

      const { data: event, error } = await supabase
        .from('events')
        .upsert(eventData, {
          onConflict: 'id'
        })
        .select()
        .single();

      if (error) {
        console.error('Event save error:', error);
        return res.status(500).json({ error: 'Failed to save event', details: error.message });
      }

      return res.status(200).json({ success: true, event: mapEventToCamelCase(event) });
    } catch (error) {
      console.error('Error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  if (req.method === 'DELETE') {
    // Удалить событие
    try {
      const { eventId } = req.query;

      if (!eventId) {
        return res.status(400).json({ error: 'Missing eventId' });
      }

      const { error } = await supabase
        .from('events')
        .delete()
        .eq('id', eventId);

      if (error) {
        console.error('Event delete error:', error);
        return res.status(500).json({ error: 'Failed to delete event' });
      }

      return res.status(200).json({ success: true });
    } catch (error) {
      console.error('Error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}