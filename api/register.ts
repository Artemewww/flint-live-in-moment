import { createClient } from '@supabase/supabase-js';
import * as crypto from 'crypto';

// Хелперы задублированы с api/events.ts НАМЕРЕННО: общий api/_lib/ роняет
// функции на Vercel в рантайме (FUNCTION_INVOCATION_FAILED — импорт соседнего
// файла не резолвится в собранной функции). Не выносить обратно.

/** Подпись Telegram WebApp initData → достоверный telegram_id. */
function verifyInitData(initData: string, botToken: string): { id: number; username?: string; first_name?: string } | null {
  if (!initData || !botToken) return null;
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');
    const dcs = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    if (crypto.createHmac('sha256', secret).update(dcs).digest('hex') !== hash) return null;
    const u = JSON.parse(params.get('user') || '{}');
    return u && u.id ? u : null;
  } catch {
    return null;
  }
}

/** Стабильный отрицательный id из ника — для веб-заявок без Telegram. */
function idFromHandle(handle: string): number {
  let hash = 0;
  for (let i = 0; i < handle.length; i++) {
    hash = (hash * 31 + handle.charCodeAt(i)) | 0;
  }
  return -Math.abs(hash) - 1;
}

function escapeHtml(text: string): string {
  return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// In-memory rate limit. Без setInterval: serverless-инстансы замораживаются,
// таймеры бессмысленны — чистим просроченные ключи при каждом обращении.
const rlStore = new Map<string, { count: number; resetAt: number }>();
function isRateLimited(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  for (const [k, e] of rlStore) if (e.resetAt < now) rlStore.delete(k);
  const e = rlStore.get(key);
  if (!e) { rlStore.set(key, { count: 1, resetAt: now + windowMs }); return false; }
  if (e.count >= limit) return true;
  e.count++;
  return false;
}

function getClientIp(req: any): string {
  return (
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.headers['x-real-ip'] ||
    req.connection?.remoteAddress ||
    'unknown'
  );
}

/**
 * Регистрация на мероприятие.
 * 1) upsert участника в members (telegram_id — ВСЕГДА число: реальный id из
 *    Telegram initData, либо число из ника, либо стабильный отрицательный хеш
 *    ника — чтобы веб-заявки без Telegram тоже сохранялись и не конфликтовали
 *    с реальными Telegram-id);
 * 2) insert заявки в registrations по БЕЛОМУ СПИСКУ колонок (без лишних полей);
 * 3) доставка уведомления организатору в группу заявок (best-effort).
 */

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID || '-1003935660570';

/** IP клиента за прокси Vercel. Дублируется по файлам (импорт из _lib роняет функции). */
function clientIp(req: any): string {
  const xf = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || String(req.headers?.['x-real-ip'] || '') || 'unknown';
}

/** Rate-limit на Supabase (кросс-инстанс). Бакет в bot_sessions под хеш-ключом. */
async function rateLimit(scope: string, ident: string, max: number, windowMs: number): Promise<{ allowed: boolean; retryAfter: number }> {
  try {
    const raw = `rl:${scope}:${ident}`;
    let h = 0;
    for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) | 0;
    const key = -Math.abs(h) - 100000;
    const now = Date.now();
    const { data } = await supabase.from('bot_sessions').select('context').eq('telegram_id', key).maybeSingle();
    const ctx: any = (data as any)?.context || {};
    const windowStart = Number(ctx.ws) || 0;
    let count = Number(ctx.n) || 0;
    if (now - windowStart > windowMs) {
      await supabase.from('bot_sessions').upsert(
        { telegram_id: key, state: 'ratelimit', context: { ws: now, n: 1 }, updated_at: new Date().toISOString() },
        { onConflict: 'telegram_id' }
      );
      return { allowed: true, retryAfter: 0 };
    }
    if (count >= max) return { allowed: false, retryAfter: Math.ceil((windowStart + windowMs - now) / 1000) };
    count += 1;
    await supabase.from('bot_sessions').upsert(
      { telegram_id: key, state: 'ratelimit', context: { ws: windowStart, n: count }, updated_at: new Date().toISOString() },
      { onConflict: 'telegram_id' }
    );
    return { allowed: true, retryAfter: 0 };
  } catch {
    return { allowed: true, retryAfter: 0 };
  }
}

// Колонки registrations, которые разрешено принимать из тела запроса.
const REG_FIELDS = [
  'status', 'payment_status', 'payment_amount', 'donation_amount',
  'has_transport', 'transport_details', 'transport_seats', 'inventory',
  'category', 'dietary', 'guest_count', 'equipment', 'roles', 'notes',
];

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Анти-спам регистраций: не больше 15 с одного IP за 10 минут.
  const rl = await rateLimit('register', clientIp(req), 15, 10 * 60 * 1000);
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfter));
    return res.status(429).json({ error: 'Слишком много запросов, попробуй позже.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const { eventId, eventTitle, name, telegram, phone, inviter, source, initData } = body;

    if (!eventId || !name || !telegram) {
      return res.status(400).json({ error: 'Missing required fields', delivered: false });
    }

    // Rate limiting: 5 заявок за 15 минут с одного IP (защита от спам-ботов).
    const clientIp = getClientIp(req);
    if (isRateLimited(`register:${clientIp}`, 5, 15 * 60 * 1000)) {
      return res.status(429).json({ 
        error: 'Слишком много заявок. Попробуйте позже.', 
        delivered: false 
      });
    }

    // Гейт закрытого события: без верного кода доступа заявку не принимаем.
    // Проверка ТОЛЬКО серверная — сам код на публичный фронт не отдаётся.
    const { data: evGate } = await supabase
      .from('events')
      .select('is_public, access_code')
      .eq('id', eventId)
      .maybeSingle();
    if (evGate && evGate.is_public === false && evGate.access_code) {
      const provided = String(body.accessCode || '').trim().toLowerCase();
      const expected = String(evGate.access_code).trim().toLowerCase();
      if (!provided || provided !== expected) {
        return res.status(403).json({
          error: 'Неверный код доступа к закрытому событию',
          code: 'access_denied',
          delivered: false,
        });
      }
    }

    // Достоверная личность из Telegram (если заявка из Mini App).
    const verified = initData ? verifyInitData(initData, BOT_TOKEN) : null;
    const handle = String(telegram).replace(/^@/, '').trim();
    const telegramId = verified?.id
      ? verified.id
      : /^\d+$/.test(handle)
        ? Number(handle)
        : idFromHandle(handle || name);
    const username = verified?.username || handle || null;

    // 1) Участник (upsert по telegram_id).
    const { data: member, error: memberError } = await supabase
      .from('members')
      .upsert(
        {
          telegram_id: telegramId,
          username,
          first_name: verified?.first_name || name,
          phone: phone || null,
          category: body.category || null,
          dietary: body.dietary || null,
        },
        { onConflict: 'telegram_id' }
      )
      .select()
      .single();

    if (memberError) {
      console.error('Member error:', memberError);
      return res.status(500).json({ error: 'Failed to create member', details: memberError.message, delivered: false });
    }

    // Реф-система (best-effort): личный ref_code + фиксация пригласившего (однократно).
    try {
      if (!(member as any).ref_code) {
        for (let i = 0; i < 5; i++) {
          const c = Math.random().toString(36).slice(2, 9);
          const { error } = await supabase.from('members').update({ ref_code: c }).eq('telegram_id', member.telegram_id);
          if (!error) break;
        }
      }
      if (body.refCode && !(member as any).referred_by) {
        const { data: inv } = await supabase.from('members').select('telegram_id').eq('ref_code', body.refCode).maybeSingle();
        if (inv && inv.telegram_id !== member.telegram_id) {
          await supabase.from('members').update({ referred_by: inv.telegram_id }).eq('telegram_id', member.telegram_id);
          await supabase.from('referrals').insert({ ref_code: body.refCode, inviter_id: inv.telegram_id, invited_id: member.telegram_id, event_id: eventId });
        }
      }
    } catch (e) { console.error('referral bind skipped:', e); }

    // 2) Анти-дубль: одна активная заявка на событие от одного человека.
    const { data: existingReg } = await supabase
      .from('registrations')
      .select('id')
      .eq('event_id', eventId)
      .eq('telegram_id', member.telegram_id)
      .neq('status', 'cancelled')
      .maybeSingle();
    if (existingReg) {
      return res.status(200).json({
        success: true,
        ok: true,
        alreadyRegistered: true,
        delivered: false,
        message: 'Вы уже записаны на это мероприятие.',
      });
    }

    // 3) Заявка (белый список колонок).
    const registration: Record<string, unknown> = {
      id: `reg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      event_id: eventId,
      telegram_id: member.telegram_id,
      name,
      phone: phone || null,
      inviter: inviter || null,
      source: source || 'website',
    };
    for (const f of REG_FIELDS) if (body[f] !== undefined) registration[f] = body[f];

    const { data: created, error: regError } = await supabase
      .from('registrations')
      .insert(registration)
      .select()
      .single();

    if (regError) {
      console.error('Registration error:', regError);
      return res.status(500).json({ error: 'Failed to create registration', details: regError.message, delivered: false });
    }

    // Счётчик участников (не критично, если RPC нет).
    try { await supabase.rpc('increment_participants', { event_id: eventId }); } catch {}

    // Водитель из регистрации → строка в rides, чтобы машина была ВИДНА везде:
    // бот «Кто едет», статистика события и админ-логистика читают таблицу rides.
    // Раньше has_transport оставался невидимым — rides создавал только бот-флоу
    // ridenew. Одна активная машина на человека на событие (повтор = правка).
    try {
      const seats = Number(body.transport_seats) || 0;
      if (body.has_transport && seats > 0) {
        const { data: existing } = await supabase
          .from('rides').select('id,kind')
          .eq('event_id', eventId).eq('driver_id', member.telegram_id).eq('active', true);
        const car = (existing || []).find((r: any) => r.kind !== 'tent');
        const rideRow: Record<string, unknown> = {
          event_id: eventId,
          driver_id: member.telegram_id,
          driver_name: name || 'Водитель',
          from_point: body.transport_details || 'по договорённости',
          seats_total: seats,
          kind: 'car',
          active: true,
        };
        if (car) await supabase.from('rides').update(rideRow).eq('id', (car as any).id);
        else await supabase.from('rides').insert(rideRow);
      }
    } catch { /* синхронизация rides не критична для заявки */ }

    // 3) Уведомление организатору (best-effort, не роняет заявку).
    let delivered = false;
    if (BOT_TOKEN && ADMIN_CHAT_ID) {
      try {
        const text =
          `🟢 <b>Новая заявка</b> • 💾 в базе\n\n` +
          `<b>Событие:</b> ${escapeHtml(eventTitle || eventId)}\n` +
          `<b>Имя:</b> ${escapeHtml(name)}\n` +
          `<b>Telegram:</b> ${escapeHtml(telegram)}\n` +
          `<b>Телефон:</b> ${escapeHtml(phone || '—')}\n` +
          `<b>Пригласил:</b> ${escapeHtml(inviter || '—')}\n` +
          `<b>Верификация:</b> ${verified ? '✅ Telegram подтверждён' : 'веб-форма'}`;
        const tg = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: ADMIN_CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true }),
        });
        delivered = (await tg.json()).ok === true;
      } catch (e) {
        console.error('Telegram notify failed:', e);
      }
    }

    return res.status(200).json({ success: true, ok: true, delivered, registration: created });
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: 'Internal server error', delivered: false });
  }
}
