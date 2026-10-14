/**
 * ВОССТАНОВЛЕНИЕ ЖУРНАЛА БАЛЛОВ — задним числом, БАЛЛЫ НЕ МЕНЯЕТ.
 *
 * До октября 2026 баллы за участие (100), приведённого друга (150), машину,
 * палатку и чек-ины начислялись без записи в points_log. В рейтинге у людей
 * стояли цифры, которые нельзя было открыть и понять. Скрипт раскладывает
 * необъяснённый остаток каждого участника:
 *   1) по посещениям (registrations.attended) — 100 за каждое, с названием события;
 *   2) по засчитанным приглашениям (referrals.rewarded) — 150 за каждого;
 *   3) остаток — одной строкой «начислено до ведения журнала».
 * Повторный запуск безопасен: считает только то, что ещё не объяснено.
 *
 * Запуск:  npx tsx scripts/backfill-points-log.ts          — показать план
 *          npx tsx scripts/backfill-points-log.ts --apply  — записать
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config({ path: '.env', quiet: true } as any);
const s = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APPLY = process.argv.includes('--apply');

(async () => {
  const { data: ms } = await s.from('members').select('telegram_id,first_name,points').gt('points', 0);
  const { data: pl } = await s.from('points_log').select('telegram_id,points,reason,event_id').limit(10000);
  const { data: att } = await s.from('registrations').select('telegram_id,event_id').eq('attended', true).limit(10000);
  const { data: refs } = await s.from('referrals').select('inviter_id,invited_id,rewarded').eq('rewarded', true);
  const { data: evs } = await s.from('events').select('id,title');
  const { data: names } = await s.from('members').select('telegram_id,first_name');
  const title = new Map((evs || []).map((e: any) => [String(e.id), e.title]));
  const nameOf = new Map((names || []).map((m: any) => [Number(m.telegram_id), m.first_name]));

  const rows: any[] = [];
  for (const m of ms || []) {
    const id = Number((m as any).telegram_id);
    const mine = (pl || []).filter((r: any) => Number(r.telegram_id) === id);
    let left = Number((m as any).points) - mine.reduce((a: number, r: any) => a + Number(r.points), 0);
    const loggedAttend = new Set(mine.filter((r: any) => r.reason === 'attend').map((r: any) => String(r.event_id)));
    for (const a of (att || []).filter((r: any) => Number(r.telegram_id) === id)) {
      if (left < 100 || loggedAttend.has(String(a.event_id))) continue;
      rows.push({ telegram_id: id, event_id: a.event_id, reason: 'attend', points: 100, description: `Участие: ${title.get(String(a.event_id)) || 'событие'}` });
      left -= 100;
    }
    const loggedRef = mine.filter((r: any) => r.reason === 'referral').length;
    for (const r of (refs || []).filter((x: any) => Number(x.inviter_id) === id).slice(loggedRef)) {
      if (left < 150) break;
      rows.push({ telegram_id: id, event_id: null, reason: 'referral', points: 150, description: `Привёл друга: ${nameOf.get(Number(r.invited_id)) || 'участник'} побывал на первом событии` });
      left -= 150;
    }
    if (left > 0) {
      rows.push({ telegram_id: id, event_id: null, reason: 'legacy', points: left, description: 'Начислено до ведения журнала (чек-ины, машины, палатки, ручные начисления)' });
    }
  }
  const by: Record<string, number> = {};
  for (const r of rows) by[r.reason] = (by[r.reason] || 0) + 1;
  console.log(`Строк к записи: ${rows.length}`, by);
  if (!APPLY) { console.log('Это план. Для записи: --apply'); return; }
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await s.from('points_log').insert(rows.slice(i, i + 200));
    if (error) { console.error('Ошибка:', error.message); process.exit(1); }
  }
  console.log('Готово.');
})();
