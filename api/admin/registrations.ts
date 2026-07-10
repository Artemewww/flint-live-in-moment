import { createClient } from '@supabase/supabase-js';
import { isAdmin, deny } from '../_lib/auth';

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

export default async function handler(req: any, res: any) {
  if (!isAdmin(req)) return deny(res);

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

      const ridesWithPax = (rides || []).map((r: any) => ({
        ...r,
        passengers: (bookings || []).filter((b: any) => b.ride_id === r.id),
      }));

      return res.status(200).json({
        registrations: registrations || [],
        stats,
        rides: ridesWithPax,
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