import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

async function tg(method: string, payload: unknown) {
  if (!BOT_TOKEN) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.json();
  } catch {
    return null;
  }
}

export default async function handler(req: any, res: any) {
  // CRON_SECRET check
  const auth = String(req.headers.authorization || '').replace('Bearer ', '');
  if (process.env.CRON_SECRET && auth !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Get unsent reminders that are due
    const now = new Date().toISOString();
    const { data: reminders, error } = await supabase
      .from('auto_reminders')
      .select('*')
      .eq('sent', false)
      .lt('remind_at', now)
      .lt('attempts', supabase.rpc('coalesce', { x: 'max_attempts', y: 3 }))
      .limit(50);

    if (error) {
      console.error('Error fetching reminders:', error);
      return res.status(500).json({ error: error.message });
    }

    if (!reminders || reminders.length === 0) {
      return res.json({ ok: true, sent: 0 });
    }

    let sent = 0;
    for (const reminder of reminders) {
      try {
        await tg('sendMessage', {
          chat_id: reminder.telegram_id,
          text: reminder.message,
          parse_mode: 'HTML',
        });
        sent++;
      } catch (e) {
        console.error(`Failed to send reminder ${reminder.id}:`, e);
      }

      // Update attempts and mark as sent if max reached
      const newAttempts = (reminder.attempts || 0) + 1;
      const maxAttempts = reminder.max_attempts || 3;
      await supabase
        .from('auto_reminders')
        .update({
          attempts: newAttempts,
          sent: newAttempts >= maxAttempts,
        })
        .eq('id', reminder.id);
    }

    return res.json({ ok: true, sent, total: reminders.length });
  } catch (err: any) {
    console.error('Auto-reminders error:', err);
    return res.status(500).json({ error: err.message });
  }
}