import { createClient } from '@supabase/supabase-js';
import * as crypto from 'crypto';

/**
 * Закрытый клуб — единый эндпоинт (экономим функции Vercel).
 *  POST { action: 'gate',    ref?, initData }        → { valid, inviterName? }
 *  POST { action: 'profile', initData, op?:'rotate' } → { ok, profile }
 */

const supabase = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || 'campsflint_bot';

function verifyInitData(initData: string): any | null {
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

async function ensureRefCode(telegramId: number, force = false): Promise<string | null> {
  const { data: m } = await supabase.from('members').select('ref_code').eq('telegram_id', telegramId).maybeSingle();
  if (m?.ref_code && !force) return m.ref_code;
  for (let i = 0; i < 5; i++) {
    const code = Math.random().toString(36).slice(2, 9);
    const { error } = await supabase.from('members').update({ ref_code: code }).eq('telegram_id', telegramId);
    if (!error) return code;
  }
  return m?.ref_code || null;
}

async function handleGate(body: any, res: any) {
  // 1) Уже одобренный участник внутри Telegram — без кода.
  const user = verifyInitData(body.initData);
  if (user) {
    const { data: me } = await supabase.from('members').select('status,is_core').eq('telegram_id', user.id).maybeSingle();
    if (me && (me.status === 'approved' || me.is_core)) return res.status(200).json({ valid: true, reason: 'member' });
  }
  // 2) Валидный реферальный код.
  const ref = String(body.ref || '').trim();
  if (ref) {
    const { data: inviter } = await supabase.from('members').select('first_name,username').eq('ref_code', ref).maybeSingle();
    if (inviter) return res.status(200).json({ valid: true, reason: 'ref', inviterName: inviter.first_name || inviter.username || 'участник клуба' });
  }
  return res.status(200).json({ valid: false });
}

async function handleProfile(body: any, res: any) {
  const user = verifyInitData(body.initData);
  if (!user) return res.status(200).json({ ok: false, error: 'not-in-telegram' });

  await supabase.from('members').upsert(
    { telegram_id: user.id, username: user.username || null, first_name: user.first_name || null },
    { onConflict: 'telegram_id' }
  );

  const refCode = await ensureRefCode(user.id, body.op === 'rotate');

  const { data: me } = await supabase
    .from('members')
    .select('telegram_id,username,first_name,status,is_core,role,points')
    .eq('telegram_id', user.id)
    .maybeSingle();

  const { count } = await supabase
    .from('members')
    .select('telegram_id', { count: 'exact', head: true })
    .eq('referred_by', user.id);

  return res.status(200).json({
    ok: true,
    profile: {
      telegramId: user.id,
      firstName: me?.first_name || user.first_name || '',
      username: me?.username || user.username || '',
      status: me?.status || 'pending',
      isCore: !!me?.is_core,
      role: me?.role || 'member',
      points: me?.points || 0,
      refCode,
      refLink: refCode ? `https://t.me/${BOT_USERNAME}?start=ref_${refCode}` : null,
      referralsCount: count || 0,
    },
  });
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    if (body.action === 'profile') return await handleProfile(body, res);
    return await handleGate(body, res);
  } catch (err) {
    return res.status(200).json({ valid: false, ok: false, error: (err as Error).message });
  }
}
