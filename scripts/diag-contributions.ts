/**
 * ЖИВОЙ ПРОГОН РАЗБОРА ПОСТУПКОВ на реальном чате события.
 *
 * Зачем отдельный скрипт, а не тест: главный риск здесь — не логика, а КАЧЕСТВО
 * ответов модели. Проверить это можно только на настоящей переписке. Скрипт
 * ничего не пишет в базу: вызывает модель, печатает, что нашлось, и на этом всё.
 *
 * Запуск:
 *   npx tsx scripts/diag-contributions.ts "BISON"
 *   npx tsx scripts/diag-contributions.ts "Bison Race"
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { contributionsPrompt, normalizeExtracted, matchPerson } from '../api/_lib/contributions';

const supabase = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');

async function askGemini(prompt: string): Promise<any | null> {
  // Ключ: сначала app_config (его меняют из панели без редеплоя) — как в вебхуке.
  // В проде лежит ключ НОВОГО формата (AQ.Ab8…), в .env может быть старый AIza…:
  // старый Google уже не принимает, и без чтения из БД прогон молча не работает.
  let key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
  try {
    const { data } = await supabase.from('app_config').select('value').eq('key', 'gemini_api_key').maybeSingle();
    if ((data as any)?.value) key = String((data as any).value);
  } catch { /* таблицы нет — работаем на env */ }
  if (!key) throw new Error('GEMINI_API_KEY не задан ни в .env, ни в app_config');
  // Список моделей — как в вебхуке (там он выверен под free-тир: у каждой свой
  // суточный лимит, исчерпали одну — идём к следующей). 2.0-flash и 2.5-flash
  // Google вывел из доступа для новых ключей (404) — держим их в конце как
  // последний шанс для старых проектов.
  const models = ['gemini-flash-latest', 'gemini-3-flash-preview', 'gemini-3.8-flash', 'gemini-flash-lite-latest', 'gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.0-flash'];
  let lastErr = '';
  for (const model of models) {
    // Google отвечает 503 «high demand» всплесками по несколько секунд —
    // в вебхуке это лечится следующей моделью, здесь добавим один повтор,
    // чтобы отличать реальную поломку от короткого всплеска.
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          // thinkingBudget:0 — без него 2.5-модели думают 30+ сек, а вебхук должен
          // уложиться в таймаут функции. Лайт-модели этот параметр не принимают,
          // поэтому для них шлём конфиг без thinkingConfig.
          generationConfig: {
            maxOutputTokens: 2000,
            responseMimeType: 'application/json',
            ...(model.includes('lite') ? {} : { thinkingConfig: { thinkingBudget: 0 } }),
          },
        }),
      });
      if (r.status === 429) { console.log(`   ${model}: квота исчерпана`); break; }
      const j: any = await r.json();
      if (j?.error) {
        lastErr = `${model}: ${j.error.message}`;
        console.log(`   ${lastErr.slice(0, 90)}`);
        if (j.error.code === 503 && attempt === 0) { await new Promise((s) => setTimeout(s, 2500)); continue; }
        break;
      }
      const txt = (j?.candidates?.[0]?.content?.parts || []).map((p: any) => p?.text || '').join('').trim();
      if (!txt) { lastErr = `${model}: пустой ответ`; console.log(`   ${lastErr}`); break; }
      try { return JSON.parse(txt); } catch { const m = txt.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); }
    }
  }
  console.log('   последняя ошибка:', lastErr);
  return null;
}

(async () => {
  const needle = (process.argv[2] || 'BISON').toLowerCase();

  const { data: events } = await supabase.from('events').select('id,title,date,deputy_id').order('date', { ascending: false });
  const ev = (events || []).find((e: any) => String(e.title || '').toLowerCase().includes(needle));
  if (!ev) {
    console.log('Событие не найдено. Доступные:');
    for (const e of events || []) console.log(`  ${e.date} | ${e.id} | ${e.title}`);
    process.exit(1);
  }
  console.log(`\n=== СОБЫТИЕ: ${ev.title} (${ev.id}) ===`);
  console.log(`Организатор (deputy_id): ${ev.deputy_id || '— не назначен —'}`);

  const { data: link } = await supabase.from('event_groups').select('chat_id,chat_title').eq('event_id', ev.id).maybeSingle();
  if (!link) { console.log('Чат события не привязан — разбирать нечего.'); process.exit(0); }
  console.log(`Чат: ${link.chat_title} (${link.chat_id})`);

  const { data: msgs } = await supabase
    .from('group_messages')
    .select('telegram_id,first_name,text,message_id,created_at')
    .eq('chat_id', link.chat_id)
    .order('created_at', { ascending: true })
    .limit(200);

  const rows = (msgs || []).filter((m: any) => Number(m.telegram_id) > 0 && String(m.text || '').trim().length > 15);
  console.log(`Сообщений в разборе: ${rows.length}`);

  const pool = [...new Map((rows as any[]).map((m) => [Number(m.telegram_id), String(m.first_name || '')])).entries()]
    .map(([id, name]) => ({ id, name }))
    .filter((p) => p.name);

  const transcript = rows
    .map((m: any) => `${m.message_id ? `#${m.message_id} ` : ''}${m.first_name}: ${String(m.text).replace(/\s+/g, ' ').trim().slice(0, 250)}`)
    .join('\n')
    .slice(0, 14000);

  console.log('\n--- ПРОМПТ ОТПРАВЛЕН, ЖДУ ОТВЕТ МОДЕЛИ ---\n');
  const raw = await askGemini(contributionsPrompt(transcript));
  if (raw === null) { console.log('Модель не ответила (квота/сеть).'); process.exit(1); }

  console.log('СЫРОЙ ОТВЕТ МОДЕЛИ:');
  console.log(JSON.stringify(raw, null, 2).slice(0, 3000));

  const found = normalizeExtracted(raw);
  console.log(`\n=== ПОСЛЕ ФИЛЬТРА (порог 0.7, только зелёные сигналы): ${found.length} ===`);
  if (!found.length) { console.log('Ничего не прошло фильтр.'); process.exit(0); }

  for (const c of found) {
    const hit = matchPerson(c.subjectName, pool);
    const who = hit.id ? `✓ ${hit.id} (${pool.find((p) => p.id === hit.id)?.name})` : hit.ambiguous ? '⚠ НЕОДНОЗНАЧНО (не запишем)' : '✗ не найден в чате';
    console.log(`\n  ${who}`);
    console.log(`  [${c.kind}] ${c.title}  (уверенность ${c.confidence})`);
    console.log(`  цитата: «${c.quote.slice(0, 160)}»`);
  }

  console.log('\n=== УЧАСТНИКИ ЧАТА (для сопоставления имён) ===');
  console.log(pool.map((p) => `${p.id}=${p.name}`).join(' · '));
})();
