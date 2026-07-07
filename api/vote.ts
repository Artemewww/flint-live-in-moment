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
    const { eventId, option, telegramId } = req.body;

    if (!eventId || !option) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Store vote (in a real app, you'd have a votes table)
    // For now, we'll just log it and return success
    console.log('Vote received:', { eventId, option, telegramId });

    return res.status(200).json({
      success: true,
      message: 'Vote recorded'
    });

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}