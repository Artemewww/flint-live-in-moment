import { createClient } from '@supabase/supabase-js';
import * as crypto from 'crypto';


const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

/** Начисление баллов участнику (read+update, без RPC). Best-effort. */
async function bumpPoints(tgId: number, n: number) {
  try {
    const { data } = await supabase.from('members').select('points').eq('telegram_id', tgId).maybeSingle();
    const cur = (data as any)?.points || 0;
    await supabase.from('members').update({ points: cur + n }).eq('telegram_id', tgId);
  } catch { /* колонка points могла отсутствовать до миграции */ }
}

const POINTS_ATTEND = 100;   // за подтверждённое участие
const POINTS_REFERRAL = 150; // рефереру за первого приведённого

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

export default async function handler(req: any, res: any) {
  if (!isAdmin(req)) return deny(res);

  /**
   * Аудитория клуба: кто есть, кто активен в боте, кто кого привёл,
   * сколько событий реально посетил. Основа для статистики результативности.
   */
  if (req.method === 'GET' && req.query?.action === 'members') {
    try {
      const { data: members } = await supabase
        .from('members')
        .select('telegram_id,username,first_name,status,is_core,role,referred_by,points,bot_active,last_seen_at,created_at')
        .order('points', { ascending: false });

      const { data: attended } = await supabase
        .from('registrations').select('telegram_id').eq('attended', true);
      const { data: regs } = await supabase
        .from('registrations').select('telegram_id').neq('status', 'cancelled');

      const countBy = (rows: any[]) => {
        const m = new Map<string, number>();
        for (const r of rows || []) {
          const k = String(r.telegram_id);
          m.set(k, (m.get(k) || 0) + 1);
        }
        return m;
      };
      const attendedBy = countBy(attended || []);
      const regsBy = countBy(regs || []);
      const invitedBy = countBy((members || []).filter((m: any) => m.referred_by).map((m: any) => ({ telegram_id: m.referred_by })));

      const list = (members || []).map((m: any) => ({
        telegramId: String(m.telegram_id),
        username: m.username,
        firstName: m.first_name,
        status: m.status || 'pending',
        isCore: !!m.is_core,
        role: m.role || 'member',
        referredBy: m.referred_by ? String(m.referred_by) : null,
        points: m.points || 0,
        botActive: m.bot_active !== false,
        lastSeenAt: m.last_seen_at,
        // Веб-заявки без Telegram имеют отрицательный хеш вместо id.
        realTelegram: Number(m.telegram_id) > 0,
        attendedCount: attendedBy.get(String(m.telegram_id)) || 0,
        registeredCount: regsBy.get(String(m.telegram_id)) || 0,
        invitedCount: invitedBy.get(String(m.telegram_id)) || 0,
      }));

      const reachable = list.filter((m) => m.realTelegram && m.botActive).length;
      return res.status(200).json({
        members: list,
        summary: {
          total: list.length,
          approved: list.filter((m) => m.status === 'approved').length,
          core: list.filter((m) => m.isCore).length,
          reachable,
          blocked: list.filter((m) => m.realTelegram && !m.botActive).length,
        },
      });
    } catch (error) {
      return res.status(500).json({ error: (error as Error).message });
    }
  }

  /** Права участника: костяк, статус, роль. */
  if (req.method === 'PATCH' && req.query?.action === 'member') {
    try {
      const telegramId = Number(req.query.telegramId);
      if (!telegramId) return res.status(400).json({ error: 'Missing telegramId' });
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};

      const patch: Record<string, unknown> = {};
      if (body.isCore !== undefined) patch.is_core = !!body.isCore;
      if (body.status !== undefined) patch.status = body.status;
      if (body.role !== undefined) patch.role = body.role;
      if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update' });

      const { error } = await supabase.from('members').update(patch).eq('telegram_id', telegramId);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ success: true });
    } catch (error) {
      return res.status(500).json({ error: (error as Error).message });
    }
  }

  if (req.method === 'GET') {
    // Получить регистрации для события
    try {
      const { eventId } = req.query;

      if (!eventId) {
        return res.status(400).json({ error: 'Missing eventId' });
      }

      // Получаем регистрации
      const { data: registrations, error } = await supabase
        .from('registrations')
        .select('*')
        .eq('event_id', eventId)
        .order('registered_at', { ascending: false });

      if (error) {
        console.error('Registrations error:', error);
        return res.status(500).json({ error: 'Failed to fetch registrations' });
      }

      // Получаем статистику
      const { data: statsData } = await supabase.rpc('get_event_stats', { event_id: eventId });

      const stats = statsData || {
        total: registrations.length,
        confirmed: registrations.filter(r => r.status === 'confirmed').length,
        pending: registrations.filter(r => r.status === 'pending').length,
        payments: registrations.filter(r => r.payment_status === 'paid').length,
        total_amount: registrations.reduce((sum, r) => sum + (r.payment_amount || 0), 0)
      };

      // Живая логистика: машины, которые участники заявили сами, их пассажиры и
      // SOS-заявки. Это не то же, что has_transport из анкеты — это реальные брони.
      const { data: rides } = await supabase
        .from('rides').select('*').eq('event_id', eventId).eq('active', true).order('created_at');

      const rideIds = (rides || []).map((r: any) => r.id);
      const { data: bookings } = rideIds.length
        ? await supabase.from('ride_bookings').select('*').in('ride_id', rideIds)
        : { data: [] as any[] };

      const { data: rideRequests } = await supabase
        .from('ride_requests').select('*').eq('event_id', eventId).eq('active', true);

      const { data: feedback } = await supabase
        .from('feedback').select('*').eq('event_id', eventId).order('created_at', { ascending: false });

      const { count: interestCount } = await supabase
        .from('interests').select('id', { count: 'exact', head: true }).eq('event_id', eventId);

      const { data: programVotes } = await supabase
        .from('program_votes').select('option').eq('event_id', eventId);

      const voteTally: Record<string, number> = {};
      for (const v of programVotes || []) {
        const opt = (v as any).option;
        voteTally[opt] = (voteTally[opt] || 0) + 1;
      }

      const withPax = (rides || []).map((r: any) => ({
        ...r,
        passengers: (bookings || []).filter((b: any) => b.ride_id === r.id),
      }));
      // Палатки живут в той же таблице rides (kind='tent') — разделяем для админки.
      const ridesWithPax = withPax.filter((r: any) => r.kind !== 'tent');
      const tentsWithPax = withPax.filter((r: any) => r.kind === 'tent');

      return res.status(200).json({
        registrations: registrations || [],
        stats,
        rides: ridesWithPax,
        tents: tentsWithPax,
        rideRequests: rideRequests || [],
        feedback: feedback || [],
        interestCount: interestCount || 0,
        voteTally,
      });
    } catch (error) {
      console.error('Error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  if (req.method === 'DELETE' && req.query?.action === 'member') {
    // Полное удаление пользователя: сброс статуса, чтобы мог заново зарегистрироваться
    try {
      const telegramId = Number(req.query.telegramId);
      if (!telegramId) return res.status(400).json({ error: 'Missing telegramId' });

      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const reason = String(body.reason || '').trim();

      // Если указана причина — отправляем сообщение пользователю перед удалением
      if (reason) {
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        if (botToken) {
          try {
            const msg = `❌ <b>Вы были удалены из клуба «Живи в моменте»</b>\n\nПричина: ${reason}\n\nЕсли хотите подать заявку заново — напишите в бота.`;
            await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: telegramId, text: msg, parse_mode: 'HTML' }),
            });
          } catch {}
        }
      }

      // Сбрасываем пользователя: очищаем telegram_id, статус, реф-код, чтобы мог заново注册иться
      const { error: updateError } = await supabase
        .from('members')
        .update({
          status: 'pending',
          referred_by: null,
          ref_code: null,
          bot_active: true,
          phone: null,
          first_name: null,
          username: null,
        })
        .eq('telegram_id', telegramId);

      if (updateError) {
        return res.status(500).json({ error: updateError.message });
      }

      // Удаляем все регистрации пользователя
      await supabase.from('registrations').delete().eq('telegram_id', telegramId);
      // Удаляем реферальные связи
      await supabase.from('referrals').delete().or(`inviter_id.eq.${telegramId},invited_id.eq.${telegramId}`);
      // Удаляем голоса, отзывы, интересы
      await supabase.from('program_votes').delete().eq('telegram_id', telegramId);
      await supabase.from('feedback').delete().eq('telegram_id', telegramId);
      await supabase.from('interests').delete().eq('telegram_id', telegramId);
      await supabase.from('bot_sessions').delete().eq('telegram_id', telegramId);

      return res.status(200).json({ success: true, notified: !!reason });
    } catch (error) {
      return res.status(500).json({ error: (error as Error).message });
    }
  }

  if (req.method === 'DELETE') {
    // Удалить регистрацию
    try {
      const { registrationId } = req.query;

      if (!registrationId) {
        return res.status(400).json({ error: 'Missing registrationId' });
      }

      // Получаем event_id перед удалением
      const { data: reg, error: fetchError } = await supabase
        .from('registrations')
        .select('event_id')
        .eq('id', registrationId)
        .single();

      if (fetchError || !reg) {
        console.error('Registration not found:', fetchError);
        return res.status(404).json({ error: 'Registration not found' });
      }

      // Удаляем регистрацию
      const { error } = await supabase
        .from('registrations')
        .delete()
        .eq('id', registrationId);

      if (error) {
        console.error('Registration delete error:', error);
        return res.status(500).json({ error: 'Failed to delete registration' });
      }

      // Уменьшаем счётчик участников
      await supabase.rpc('decrement_participants', { event_id: reg.event_id });

      return res.status(200).json({ success: true });
    } catch (error) {
      console.error('Error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  if (req.method === 'PATCH') {
    // Обновить статус регистрации
    try {
      const { registrationId } = req.query;
      const { status, paymentStatus, paymentAmount, attended } = req.body;

      if (!registrationId) {
        return res.status(400).json({ error: 'Missing registrationId' });
      }

      // Текущее состояние — чтобы поймать переход «не был» → «был» (для баллов).
      const { data: before } = await supabase
        .from('registrations')
        .select('status,attended,telegram_id')
        .eq('id', registrationId)
        .single();

      const updateData: any = {};
      if (status) updateData.status = status;
      if (paymentStatus) updateData.payment_status = paymentStatus;
      if (paymentAmount !== undefined) updateData.payment_amount = paymentAmount;
      if (attended !== undefined) updateData.attended = !!attended;

      const { data: registration, error } = await supabase
        .from('registrations')
        .update(updateData)
        .eq('id', registrationId)
        .select()
        .single();

      if (error) {
        console.error('Registration update error:', error);
        return res.status(500).json({ error: 'Failed to update registration' });
      }

      // Баллы — ТОЛЬКО за достижение: человек реально пришёл и админ это отметил.
      // Регистрация и подтверждение статуса баллов не дают (PLAN.md §5.3).
      if (attended === true && before && before.attended !== true && before.telegram_id) {
        const memberId = Number(before.telegram_id);
        await bumpPoints(memberId, POINTS_ATTEND);
        try {
          // Первое посещённое событие участника → награда пригласившему.
          const { count } = await supabase
            .from('registrations')
            .select('id', { count: 'exact', head: true })
            .eq('telegram_id', memberId)
            .eq('attended', true)
            .neq('id', registrationId);
          if (!count) {
            const { data: m } = await supabase.from('members').select('referred_by').eq('telegram_id', memberId).maybeSingle();
            const inviter = (m as any)?.referred_by;
            if (inviter) {
              await bumpPoints(Number(inviter), POINTS_REFERRAL);
              await supabase.from('referrals').update({ rewarded: true }).eq('invited_id', memberId).eq('inviter_id', inviter);
            }
          }
        } catch { /* реф-награда best-effort */ }
      }

      return res.status(200).json({ success: true, registration });
    } catch (error) {
      console.error('Error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}