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
    const { eventId, eventTitle, telegramId } = req.body;

    if (!eventId || !eventTitle) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Store interest signal
    // In a real app, you'd have an interests table
    console.log('Interest signal received:', { eventId, eventTitle, telegramId });

    // TODO: Send notification to admins about interest
    // await sendTelegramNotification(ADMIN_CHAT_ID, `Интерес к событию: ${eventTitle}`);

    return res.status(200).json({
      success: true,
      message: 'Interest recorded'
    });

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}