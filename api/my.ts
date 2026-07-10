import { createClient } from '@supabase/supabase-js';
import * as crypto from 'crypto';

/**
 * Мои заявки: внутри Telegram Mini App возвращает регистрации текущего
 * пользователя из БД (по проверенному initData). Так «Мои Участия» работают
 * на телефоне, даже если человек записывался через бота, а не с сайта.
 */

const supabase = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

function verifyInitData(initData: string): { id: number } | null {
  if (!initData || !BOT_TOKEN) return null;
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');
    const dcs = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    if (crypto.createHmac('sha256', secret).update(dcs).digest('hex') !== hash) return null;
    const u = JSON.parse(params.get('user') || '{}');
    return u && u.id ? u : null;
  } catch {
    return null;
  }
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const user = verifyInitData(body.initData);
    if (!user) return res.status(200).json({ ok: true, registrations: [] });

    const { data } = await supabase
      .from('registrations')
      .select('*')
      .eq('telegram_id', user.id)
      .neq('status', 'cancelled');

    const registrations = (data || []).map((r: any) => ({
      id: r.id,
      eventId: r.event_id,
      paymentAmount: r.payment_amount || 0,
      name: r.name,
      phone: r.phone,
      status: r.status,
      paymentStatus: r.payment_status,
      hasTransport: r.has_transport,
      transportSeats: r.transport_seats,
      dietary: r.dietary,
      registeredAt: r.registered_at,
      // Данные регистрации 2.0 — без них «Мои участия» показывают половину анкеты.
      days: r.days || [],
      guestCount: r.guest_count || 0,
      childrenCount: r.children_count || 0,
      foodOptout: !!r.food_optout,
      equipment: r.equipment || [],
      roles: r.roles || [],
      attended: !!r.attended,
    }));

    res.status(200).json({ ok: true, registrations });
  } catch (err) {
    res.status(200).json({ ok: true, registrations: [], error: (err as Error).message });
  }
}
