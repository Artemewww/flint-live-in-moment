/**
 * ПРОВЕРКА ЦЕПОЧКИ БЕЗ МОДЕЛИ: извлечение → запись → подтверждение.
 *
 * Зачем: у Gemini сейчас исчерпана квота на free-тире, и качество ответов модели
 * проверить нельзя. Но вся остальная цепочка (сопоставление имён, дедупликация,
 * запись, подтверждение, сигнал репутации, баллы) от модели не зависит — её и
 * проверяем. Вместо ответа модели подаём заранее известный JSON.
 *
 * Запуск: npx tsx scripts/test-contributions-pipeline.ts
 * Скрипт ПИШЕТ в базу (в этом и смысл) и в конце всё за собой убирает.
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { normalizeExtracted, matchPerson, confirmContribution, rejectContribution } from '../api/_lib/contributions';

const supabase = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');

/** Ответ модели, как он выглядел бы на переписке Bison Race. */
const MOCK_MODEL = {
  contributions: [
    { who: 'Артем', kind: 'role_done', title: 'Собрал команду и вёл выезд как организатор', quote: 'Едем на трёх авто? Или встречаемся на выезде из города', confidence: 0.92 },
    { who: 'Ludmila', kind: 'helped', title: 'Везла людей и держала связь по выезду', quote: 'Я вожу, но адски, т.к. только пересела на механику', confidence: 0.85 },
    { who: 'Аня', kind: 'role_done', title: 'Сняла видео и фото с забега', quote: 'Видео-фото континент - супер', confidence: 0.95 },
    // Ниже порога — должно быть отброшено.
    { who: 'Кто-то', kind: 'helped', title: 'Может быть поможет', quote: 'я готов помочь', confidence: 0.4 },
    // Красный сигнал — в этом словаре его нет вообще, должно отброситься.
    { who: 'Егор', kind: 'no_show', title: 'Не приехал', quote: 'я не приеду', confidence: 0.95 },
    // Выдуманный код.
    { who: 'Егор', kind: 'супергерой', title: 'Спас всех', quote: 'спас всех', confidence: 0.99 },
  ],
};

let fails = 0;
const check = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) fails++;
};

(async () => {
  console.log('\n=== 1. ФИЛЬТР ОТВЕТА МОДЕЛИ ===');
  const found = normalizeExtracted(MOCK_MODEL);
  check('осталось 3 эпизода (мусор отброшен)', found.length === 3, `получено ${found.length}`);
  check('нет красного сигнала no_show', !found.some((f) => f.kind === 'no_show'));
  check('нет выдуманного кода', !found.some((f) => f.kind === 'супергерой'));
  check('нет низкой уверенности 0.4', !found.some((f) => f.confidence < 0.7));

  console.log('\n=== 2. СОПОСТАВЛЕНИЕ ИМЁН ===');
  const pool = [
    { id: 377551019, name: 'ARTDEMENTIEV.BY' },
    { id: 697938932, name: 'Ludmila' },
    { id: 1413612030, name: 'Александр' },
  ];
  check('«Артем» → ARTDEMENTIEV.BY по началу имени', matchPerson('Артем', pool).id === 377551019);
  check('«Ludmila» → точное совпадение', matchPerson('Ludmila', pool).id === 697938932);
  check('«Аня» нет в чате → null без додумывания', matchPerson('Аня', pool).id === null);
  const dup = [...pool, { id: 999, name: 'Александр П' }];
  check('двойное совпадение → null (не угадываем)', matchPerson('Александр', dup).id === null);


  console.log('\n=== 3. ЗАПИСЬ И ПОДТВЕРЖДЕНИЕ В БАЗЕ ===');
  const evId = 'event-1785353774067'; // Bison Race
  const chatId = -1004320022019;
  const created: number[] = [];

  // Пишем ровно то, что прошло фильтр и нашло человека.
  for (const c of found) {
    const hit = matchPerson(c.subjectName, pool);
    if (!hit.id) continue;
    const { data, error } = await supabase.from('event_contributions').insert({
      event_id: evId, subject_id: hit.id, kind: c.kind, title: `[ТЕСТ] ${c.title}`,
      quote: c.quote, confidence: c.confidence, chat_id: chatId, message_id: 999000 + created.length,
      status: 'pending',
    }).select('id').maybeSingle();
    if (error) { console.log('    insert error:', error.message); continue; }
    if (data) created.push(Number((data as any).id));
  }
  check('записано 2 эпизода (Аня не найдена — пропущена)', created.length === 2, `записано ${created.length}`);

  // Дедупликация: тот же эпизод повторно не должен пройти.
  const dupInsert = await supabase.from('event_contributions').insert({
    event_id: evId, subject_id: 377551019, kind: 'role_done', title: '[ТЕСТ] дубль',
    quote: 'x', confidence: 0.9, chat_id: chatId, message_id: 999000, status: 'pending',
  });
  check('повторный разбор не дублирует эпизод', !!dupInsert.error && /23505|duplicate/i.test(dupInsert.error.message), dupInsert.error?.message?.slice(0, 45));

  // Подтверждает другой организатор/человек (не сам себе): например, ID 999999
  const r1 = await confirmContribution(created[0], 999999);
  check('подтверждение прошло', r1.ok === true, JSON.stringify(r1));
  check('начислено 10 баллов за role_done', r1.points === 10, `points=${r1.points}`);

  const { data: mAfter } = await supabase.from('members').select('points').eq('telegram_id', 377551019).maybeSingle();
  check('баллы в members.points записаны', Number((mAfter as any)?.points || 0) > 0, `points=${(mAfter as any)?.points}`);

  const { data: sig } = await supabase.from('reputation_events')
    .select('id,kind,source,weight').eq('subject_id', 377551019).eq('event_id', evId).eq('kind', 'role_done').maybeSingle();
  check('сигнал репутации записан с source=organizer', (sig as any)?.source === 'organizer', JSON.stringify(sig));

  const { data: logged } = await supabase.from('points_log')
    .select('points,reason').eq('telegram_id', 377551019).eq('reason', 'contribution').eq('event_id', evId).limit(1).maybeSingle();
  check('запись в points_log с reason=contribution', (logged as any)?.reason === 'contribution');

  const r2 = await confirmContribution(created[1], 697938932);
  check('нельзя подтвердить свой поступок', r2.ok === false && r2.error === 'self', JSON.stringify(r2));

  const r3 = await confirmContribution(created[0], 999999);
  check('повторное подтверждение идемпотентно', r3.ok === true && r3.already === true);

  const r4 = await rejectContribution(created[1], 377551019);
  check('отклонение работает', r4.ok === true, JSON.stringify(r4));

  console.log('\n=== 4. УБОРКА ТЕСТОВЫХ ДАННЫХ ===');
  await supabase.from('event_contributions').delete().in('id', created);
  await supabase.from('reputation_events').delete().eq('subject_id', 377551019).eq('event_id', evId).eq('kind', 'role_done').eq('source', 'organizer');
  await supabase.from('points_log').delete().eq('telegram_id', 377551019).eq('reason', 'contribution').eq('event_id', evId);
  // Баллы возвращаем только если начисление реально произошло
  if (r1.ok && r1.points) {
    const { data: mNow } = await supabase.from('members').select('points').eq('telegram_id', 377551019).maybeSingle();
    await supabase.from('members').update({ points: Math.max(0, Number((mNow as any)?.points || 0) - r1.points) }).eq('telegram_id', 377551019);
  }
  console.log('  ✓ тестовые эпизоды, сигнал, журнал и баллы убраны');

  console.log(`\n${fails === 0 ? '✅ ВСЕ ПРОВЕРКИ ПРОШЛИ' : `❌ ПРОВАЛОВ: ${fails}`}\n`);
  process.exit(fails === 0 ? 0 : 1);
})();
