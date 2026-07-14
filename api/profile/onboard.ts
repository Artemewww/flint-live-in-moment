/**
 * API-эндпоинт для завершения онбординга профиля развития.
 * POST /api/profile/onboard
 * 
 * Принимает: { telegramId, dreams, interests, skills, developmentGoal }
 * Сохраняет в БД: members.dreams, members.interests, members.skills,
 *   members.development_goal, members.is_profile_completed = true
 * 
 * Требует авторизации (ADMIN_TOKEN).
 */

import * as crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
const ADMIN_SECRET = process.env.ADMIN_TOKEN || '';

function safeEq(a: string, b: string): boolean {
  const A = Buffer.from(String(a)), B = Buffer.from(String(b));
  return A.length === B.length && A.length > 0 && crypto.timingSafeEqual(A, B);
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const bearer = String(req.headers?.authorization || '').replace('Bearer ', '');
  if (!bearer || !safeEq(bearer, ADMIN_SECRET)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(200).json({ error: 'Supabase не настроен' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { telegramId, dreams, interests, skills, developmentGoal } = body;

    if (!telegramId) {
      return res.status(400).json({ error: 'telegramId обязателен' });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    const updateData: Record<string, any> = {
      is_profile_completed: true,
      updated_at: new Date().toISOString(),
    };
    if (dreams !== undefined) updateData.dreams = String(dreams);
    if (interests !== undefined) updateData.interests = JSON.stringify(interests);
    if (skills !== undefined) updateData.skills = JSON.stringify(skills);
    if (developmentGoal !== undefined) updateData.development_goal = String(developmentGoal);

    const { error } = await supabase
      .from('members')
      .update(updateData)
      .eq('telegram_id', Number(telegramId));

    if (error) {
      return res.status(200).json({ error: error.message });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(200).json({ error: (err as Error).message });
  }
}