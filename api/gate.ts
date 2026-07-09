import { createClient } from '@supabase/supabase-js';
import * as crypto from 'crypto';

/**
 * Шлюз закрытого клуба: проверяет валидность реферального кода / принадлежность
 * к клубу. Двери открываются если:
 *  - внутри Telegram: пользователь уже одобренный участник (initData), ИЛИ
 *  - передан валидный ref-код существующего участника.
 * Активацию шлюза на сайте включает флаг VITE_GATE_ENABLED (фронт) — здесь
 * только проверка, эндпоинт всегда доступен.
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

    // 1) Уже одобренный участник внутри Telegram — пускаем без кода.
    const user = verifyInitData(body.initData);
    if (user) {
      const { data: me } = await supabase
        .from('members')
        .select('status,is_core')
        .eq('telegram_id', user.id)
        .maybeSingle();
      if (me && (me.status === 'approved' || me.is_core)) {
        return res.status(200).json({ valid: true, reason: 'member' });
      }
    }

    // 2) Валидный реферальный код существующего участника.
    const ref = String(body.ref || '').trim();
    if (ref) {
      const { data: inviter } = await supabase
        .from('members')
        .select('telegram_id,first_name,username')
        .eq('ref_code', ref)
        .maybeSingle();
      if (inviter) {
        return res.status(200).json({
          valid: true,
          reason: 'ref',
          inviterName: inviter.first_name || inviter.username || 'участник клуба',
        });
      }
    }

    return res.status(200).json({ valid: false });
  } catch (err) {
    return res.status(200).json({ valid: false, error: (err as Error).message });
  }
}
