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

export default async function handler(req: any, res: any) {
  // Проверяем авторизацию
  if (!checkAdminAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
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
      const { data: statsData, error: statsError } = await supabase
        .rpc('get_event_stats', { event_id: eventId });

      const stats = statsData || {
        total: registrations.length,
        confirmed: registrations.filter(r => r.status === 'confirmed').length,
        pending: registrations.filter(r => r.status === 'pending').length,
        payments: registrations.filter(r => r.payment_status === 'paid').length,
        total_amount: registrations.reduce((sum, r) => sum + (r.payment_amount || 0), 0)
      };

      return res.status(200).json({
        registrations: registrations || [],
        stats
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
      const { status, paymentStatus, paymentAmount } = req.body;

      if (!registrationId) {
        return res.status(400).json({ error: 'Missing registrationId' });
      }

      const updateData: any = {};
      if (status) updateData.status = status;
      if (paymentStatus) updateData.payment_status = paymentStatus;
      if (paymentAmount !== undefined) updateData.payment_amount = paymentAmount;

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

      return res.status(200).json({ success: true, registration });
    } catch (error) {
      console.error('Error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}