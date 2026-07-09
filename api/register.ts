import { createClient } from '@supabase/supabase-js';
import * as crypto from 'crypto';

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

/** Проверка подписи Telegram WebApp initData → достоверные id и username. */
function verifyInitData(initData: string): { id: number; username?: string; first_name?: string } | null {
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

/** Числовой telegram_id из ника (отрицательный — чтобы не пересечься с реальными). */
function idFromHandle(handle: string): number {
  let h = 0;
  for (let i = 0; i < handle.length; i++) h = (h * 31 + handle.charCodeAt(i)) | 0;
  return -Math.abs(h) - 1;
}

function esc(s: string): string {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const { eventId, eventTitle, name, telegram, phone, inviter, source, initData } = body;

    if (!eventId || !name || !telegram) {
      return res.status(400).json({ error: 'Missing required fields', delivered: false });
    }

    // Достоверная личность из Telegram (если заявка из Mini App).
    const verified = initData ? verifyInitData(initData) : null;
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

    // 3) Уведомление организатору (best-effort, не роняет заявку).
    let delivered = false;
    if (BOT_TOKEN && ADMIN_CHAT_ID) {
      try {
        const text =
          `🟢 <b>Новая заявка</b> • 💾 в базе\n\n` +
          `<b>Событие:</b> ${esc(eventTitle || eventId)}\n` +
          `<b>Имя:</b> ${esc(name)}\n` +
          `<b>Telegram:</b> ${esc(telegram)}\n` +
          `<b>Телефон:</b> ${esc(phone || '—')}\n` +
          `<b>Пригласил:</b> ${esc(inviter || '—')}\n` +
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
