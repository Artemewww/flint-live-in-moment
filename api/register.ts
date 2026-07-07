import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { eventId, name, telegram, phone, inviter, source, ...registrationData } = req.body;

    if (!eventId || !name || !telegram) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Get or create member
    const telegramUsername = telegram.replace('@', '');
    const { data: member, error: memberError } = await supabase
      .from('members')
      .upsert({
        telegram_id: parseInt(telegramUsername) || telegramUsername,
        username: telegramUsername,
        first_name: name,
        phone: phone || null
      }, {
        onConflict: 'telegram_id'
      })
      .select()
      .single();

    if (memberError) {
      console.error('Member error:', memberError);
      return res.status(500).json({ error: 'Failed to create member' });
    }

    // Create registration
    const registrationId = `reg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const { data: registration, error: regError } = await supabase
      .from('registrations')
      .insert({
        id: registrationId,
        event_id: eventId,
        telegram_id: member.telegram_id,
        name,
        phone: phone || null,
        inviter: inviter || null,
        source: source || 'website',
        ...registrationData
      })
      .select()
      .single();

    if (regError) {
      console.error('Registration error:', regError);
      return res.status(500).json({ error: 'Failed to create registration' });
    }

    // Increment participants count
    await supabase.rpc('increment_participants', { event_id: eventId });

    return res.status(200).json({
      success: true,
      registration,
      message: 'Registration successful'
    });

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}