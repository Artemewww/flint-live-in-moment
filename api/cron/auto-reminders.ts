/**
 * Cron: автоматические напоминания (техника безопасности, гости, координаты, дедлайны)
 * Запускается каждые 15 минут, отправляет напоминания до получения ответа
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

function tg(method: string, payload: unknown) {
  return fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => r.json());
}

export default async function handler(req: any, res: any) {
  // Защита: только cron или админ
  const auth = req.headers.authorization;
  if (auth !== `Bearer ${process.env.CRON_SECRET || process.env.ADMIN_TOKEN || ''}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const now = new Date().toISOString();
  const sent: string[] = [];

  try {
    // 1. Отправить запланированные напоминания
    const { data: reminders } = await supabase
      .from('auto_reminders')
      .select('*')
      .lte('remind_at', now)
      .eq('sent', false)
      .lt('attempts', 3)
      .limit(50);

    for (const r of reminders || []) {
      try {
        await tg('sendMessage', {
          chat_id: r.telegram_id,
          parse_mode: 'HTML',
          text: r.message,
        });
        
        await supabase
          .from('auto_reminders')
          .update({ sent: true, attempts: r.attempts + 1 })
          .eq('id', r.id);
        
        sent.push(`${r.reminder_type}:${r.telegram_id}`);
      } catch (e) {
        // Если бот заблокирован — увеличиваем attempts, но не падаем
        await supabase
          .from('auto_reminders')
          .update({ attempts: r.attempts + 1 })
          .eq('id', r.id);
      }
    }

    // 2. Создать напоминания для неподтверждённых пунктов (за 24ч до события)
    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
    const { data: upcomingEvents } = await supabase
      .from('events')
      .select('id,title,date')
      .eq('status', 'open')
      .eq('date', tomorrow);

    for (const ev of upcomingEvents || []) {
      // Техника безопасности
      const { data: unconfirmedSafety } = await supabase.rpc('get_unconfirmed_safety', {
        p_event_id: ev.id,
      });

      for (const u of unconfirmedSafety || []) {
        const exists = await supabase
          .from('auto_reminders')
          .select('id')
          .eq('event_id', ev.id)
          .eq('telegram_id', u.telegram_id)
          .eq('reminder_type', 'safety_confirm')
          .eq('sent', false)
          .maybeSingle();

        if (!exists.data) {
          await supabase.rpc('create_reminder', {
            p_event_id: ev.id,
            p_telegram_id: u.telegram_id,
            p_type: 'safety_confirm',
            p_message: `⚠️ <b>${ev.title}</b> — завтра!\n\nПодтверди, что ознакомился с <b>техникой безопасности</b>. Это важно для всех.\n\n/start → выбери событие → «✅ Правила безопасности»`,
            p_remind_at: new Date(Date.now() + 3600 * 1000).toISOString(), // через час
          });
        }
      }

      // Гости (кто указал guest_count > 0, но не детализировал)
      const { data: unclearGuests } = await supabase
        .from('registrations')
        .select('telegram_id,name,guest_count')
        .eq('event_id', ev.id)
        .eq('status', 'approved')
        .gt('guest_count', 0);

      for (const g of unclearGuests || []) {
        if (!g.telegram_id) continue;
        const { data: details } = await supabase
          .from('registrations')
          .select('guest_details')
          .eq('event_id', ev.id)
          .eq('telegram_id', g.telegram_id)
          .maybeSingle();

        if (!details?.guest_details || !details.guest_details.count) {
          const exists = await supabase
            .from('auto_reminders')
            .select('id')
            .eq('event_id', ev.id)
            .eq('telegram_id', g.telegram_id)
            .eq('reminder_type', 'guest_update')
            .eq('sent', false)
            .maybeSingle();

          if (!exists.data) {
            await supabase.rpc('create_reminder', {
              p_event_id: ev.id,
              p_telegram_id: g.telegram_id,
              p_type: 'guest_update',
              p_message: `👥 <b>${ev.title}</b> — завтра!\n\nТы указал гостей: <b>${g.guest_count} чел</b>. Уточни, сколько точно едет и как их зовут — это нужно для логистики.\n\n/start → событие → «Обновить гостей»`,
              p_remind_at: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
            });
          }
        }
      }
    }

    return res.status(200).json({
      ok: true,
      sent: sent.length,
      reminders: sent,
      timestamp: now,
    });
  } catch (error) {
    console.error('Auto-reminders error:', error);
    return res.status(500).json({ error: String(error) });
  }
}
