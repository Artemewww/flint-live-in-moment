import { createClient } from '@supabase/supabase-js';
import * as crypto from 'crypto';


const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

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
    paymentDetails: event.payment_details || {},
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
    statusReason: event.status_reason,
    decisionDeadline: event.decision_deadline,
    checklist: event.checklist || {},
    isPublic: event.is_public !== false,
    accessCode: event.access_code,
    deputyId: event.deputy_id,
    lockedHint: event.locked_hint,
    program: event.program || [],
    notifications: event.notifications || {},
    programVoting: event.program_voting,
    createdAt: event.created_at,
    updatedAt: event.updated_at
  };
}

// ─── Админская авторизация ───────────────────────────────────────────────
// Дублируется по файлам сознательно: Vercel не включает в бандл функции
// модули из папок на «_», а импорт из ../src роняет FUNCTION_INVOCATION_FAILED
// (PLAN.md §9). Тот же приём, что с mapEventToCamelCase.
//
// Секрет живёт только в env. Раньше здесь был фолбэк на строку-пароль, и она
// уезжала в публичный JS-бандл вместе с фронтом.
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

/** Кука вида <срок>.<подпись>: подпись не даёт продлить срок вручную. */
function validSession(value: string): boolean {
  const [expRaw, mac] = String(value).split('.');
  const exp = Number(expRaw);
  if (!exp || !mac || Date.now() > exp) return false;
  return safeEq(mac, crypto.createHmac('sha256', ADMIN_SECRET).update(String(exp)).digest('hex'));
}

/** Пускать ли запрос: заголовок (крон, curl) или подписанная кука (браузер). */
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

const ADMIN_TTL_MS = 12 * 60 * 60 * 1000;

function passwordMatches(password: string): boolean {
  return !!ADMIN_SECRET && safeEq(String(password || ''), ADMIN_SECRET);
}

function sessionCookie(): string {
  const exp = Date.now() + ADMIN_TTL_MS;
  const mac = crypto.createHmac('sha256', ADMIN_SECRET).update(String(exp)).digest('hex');
  return `${ADMIN_COOKIE}=${encodeURIComponent(`${exp}.${mac}`)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${ADMIN_TTL_MS / 1000}`;
}

function clearCookie(): string {
  return `${ADMIN_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export default async function handler(req: any, res: any) {
  // Вход/выход админки. Пароль сверяется на сервере и обменивается на
  // подписанную httpOnly-куку — в браузер секрет не попадает.
  if (req.method === 'POST' && req.query?.action === 'login') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    if (!passwordMatches(body.password)) {
      return res.status(401).json({ error: 'Неверный пароль' });
    }
    res.setHeader('Set-Cookie', sessionCookie());
    return res.status(200).json({ ok: true });
  }
  if (req.method === 'POST' && req.query?.action === 'logout') {
    res.setHeader('Set-Cookie', clearCookie());
    return res.status(200).json({ ok: true });
  }

  if (!isAdmin(req)) return deny(res);

  if (req.method === 'GET') {
    /**
     * Пульс присутствия: вкладка админки раз в ~20 сек отмечается и получает
     * список тех, кто онлайн. Онлайн = отметился за последние 60 сек.
     *
     * Живёт в bot_sessions, а не в отдельной таблице: это тоже эфемерная
     * сессия, а лишний DDL на прод-базе не нужен. Ключ — отрицательный хеш
     * id вкладки; настоящие telegram_id бота положительные, так что не пересечёмся.
     */
    if (req.query?.action === 'presence') {
      try {
        const id = String(req.query.id || '').slice(0, 64);
        const name = String(req.query.name || 'Админ').slice(0, 40);
        if (!id) return res.status(400).json({ error: 'Missing id' });

        let h = 0;
        for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
        const key = -Math.abs(h) - 1;

        await supabase.from('bot_sessions').upsert(
          { telegram_id: key, state: 'admin_presence', context: { name }, updated_at: new Date().toISOString() },
          { onConflict: 'telegram_id' }
        );

        const cutoff = new Date(Date.now() - 60_000).toISOString();
        const { data: online } = await supabase
          .from('bot_sessions')
          .select('telegram_id,context')
          .eq('state', 'admin_presence')
          .gte('updated_at', cutoff);

        // Подчищаем протухшие отметки, чтобы таблица не росла.
        await supabase
          .from('bot_sessions')
          .delete()
          .eq('state', 'admin_presence')
          .lt('updated_at', new Date(Date.now() - 3600_000).toISOString());

        const users = (online || []).map((r: any) => ({ id: String(r.telegram_id), name: r.context?.name || 'Админ' }));
        return res.status(200).json({ online: users.length, users });
      } catch (error) {
        return res.status(200).json({ online: 1, users: [], error: (error as Error).message });
      }
    }

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

      // Занятые места считаем из registrations — единый источник правды
      // с сайтом и ботом (колонка participants_count — легаси, расходилась).
      const { data: regs } = await supabase
        .from('registrations').select('event_id').neq('status', 'cancelled');
      const counts = new Map<string, number>();
      for (const r of regs || []) counts.set(r.event_id, (counts.get(r.event_id) || 0) + 1);

      const mappedEvents = (events || []).map((e: any) =>
        mapEventToCamelCase({ ...e, participants_count: counts.get(e.id) || 0 }));

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
      if (body.paymentDetails) (eventData as any).payment_details = body.paymentDetails;
      if (body.checklist) (eventData as any).checklist = body.checklist;

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

  if (req.method === 'PATCH') {
    // Точечное обновление события: жизненный цикл, чек-лист, публичность,
    // перенос дат, «под вопросом». Не трогает поля, которых нет в теле.
    try {
      const { eventId } = req.query;
      if (!eventId) return res.status(400).json({ error: 'Missing eventId' });

      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};

      // camelCase → snake_case только для явно переданных ключей.
      const FIELDS: Record<string, string> = {
        status: 'status',
        statusReason: 'status_reason',
        decisionDeadline: 'decision_deadline',
        checklist: 'checklist',
        isPublic: 'is_public',
        accessCode: 'access_code',
        deputyId: 'deputy_id',
        date: 'date',
        dateEnd: 'date_end',
        dateLabel: 'date_label',
        lockedHint: 'locked_hint',
        maxParticipants: 'max_participants',
        paymentDetails: 'payment_details',
        logistics: 'logistics',
      };

      const patch: Record<string, unknown> = {};
      for (const [camel, snake] of Object.entries(FIELDS)) {
        if (body[camel] !== undefined) patch[snake] = body[camel];
      }
      if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Nothing to update' });

      const { data: event, error } = await supabase
        .from('events')
        .update(patch)
        .eq('id', eventId)
        .select()
        .single();

      if (error) {
        console.error('Event patch error:', error);
        return res.status(500).json({ error: 'Failed to update event', details: error.message });
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