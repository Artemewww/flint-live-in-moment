/**
 * ПОСТУПКИ С СОБЫТИЙ — «кто что сделал».
 *
 * Задача владельца (28.09, после Bison Race): хорошие дела живут только в
 * переписке. Аня снимала видео, Людмила привезла еду и поделилась бананами,
 * Артём разрулил затор из двух мерседесов и организовал сбор на билет Паше.
 * В базе об этом не остаётся ничего — репутация не растёт, и через месяц уже
 * никто не вспомнит, кто вывез выезд.
 *
 * ЧТО ДЕЛАЕТ МОДУЛЬ. Читает уже накопленную переписку чата (`group_messages`),
 * просит модель вытащить эпизоды и складывает их в `event_contributions` со
 * статусом `pending`. Дальше — организатор.
 *
 * ГЛАВНОЕ ПРАВИЛО: ИИ НИЧЕГО НЕ НАЧИСЛЯЕТ САМ. Модель ошибается и льстит, а
 * цена ошибки здесь — репутация живого человека. Поэтому до подтверждения
 * организатором эпизод не влияет ни на репутацию, ни на баллы. Это же разделение
 * уже заложено в `reputation.ts`: у источника `ai` вес 0.5 — «только повод
 * посмотреть».
 *
 * ПОЧЕМУ ОРГАНИЗАТОР, А НЕ КОСТЯК. Организаторов много. Если на каждом выезде
 * дёргать весь костяк, нагрузка становится невыносимой, а решения — формальными.
 * Уведомление уходит только тому, кто вёл событие (`events.deputy_id`) — он там
 * был и отвечает за свои слова.
 *
 * ЧТО НЕ СЧИТАЕТСЯ ПОСТУПКОМ (просим модель явно):
 *   «я возьму», «могу помочь», «давайте скинемся» — это ОБЕЩАНИЯ. Эпизод
 *   появляется только когда есть факт: «привёз», «снял», «разрулил», «вложил».
 *
 * СТОИМОСТЬ. Работает внутри существующего часового дайджеста — отдельные
 * вызовы Gemini не тратятся. Своих ключей и запросов модуль не заводит:
 * вызывающий код передаёт готовый транскрипт и функцию вызова модели.
 */

import { createClient } from '@supabase/supabase-js';
import { SIGNALS } from './reputation';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
);

/**
 * Что вообще может найти ИИ. Берём ТОЛЬКО зелёные сигналы из общего словаря —
 * репутация не должна ухудшаться по доносу модели. Красное (харассмент,
 * саботаж) находят люди, а не автопарсер переписки.
 *
 * `points` — сколько баллов даём при подтверждении. Ориентир: посещение
 * события даёт 10 баллов, поэтому «вывез выезд» не может стоить меньше.
 */
export const CONTRIBUTION_KINDS: Record<string, { points: number; hint: string }> = {
  role_done:     { points: 10, hint: 'Взял роль и довёл до конца: видеооператор, повар, водитель, ответственный за закупку' },
  helped:        { points: 10, hint: 'Помог другим физически или делом: вытащил, подвёз, починил, делился едой и вещами' },
  calm_conflict: { points: 12, hint: 'Погасил конфликт или разрулил сложную ситуацию, удержал всех в спокойствии' },
  staff_done:    { points: 12, hint: 'Отработал помощником организатора: координировал, считал деньги, держал безопасность' },
  growth:        { points: 10, hint: 'Явный рост: справился с тем, что раньше не получалось, вышел за свой предел' },
  driver:        { points: 8,  hint: 'Вёз людей на своей машине на событие или с события' },
  brought:       { points: 8,  hint: 'Привёл в клуб нового человека, и тот вписался' },
  paid_on_time:  { points: 6,  hint: 'Внёс взнос вовремя и без напоминаний' },
};

/** Порог уверенности. Ниже — не показываем вовсе: лучше пропустить, чем выдумать. */
export const MIN_CONFIDENCE = 0.7;

/** Модель ошибается на коротких транскриптах — на трёх репликах вывода не делаем. */
const MIN_MESSAGES = 8;

/** Потолок эпизодов за один разбор: организатор должен реально их прочитать. */
const MAX_PER_RUN = 12;

export interface ExtractedContribution {
  subjectName: string;
  kind: string;
  title: string;
  quote: string;
  confidence: number;
}

export interface TranscriptMessage {
  telegram_id: number;
  first_name: string;
  text: string;
  created_at?: string;
  message_id?: number;
}

/**
 * Подсказка модели: словарь допустимых поступков + что считать доказательством.
 * Держим в одном месте с `CONTRIBUTION_KINDS`, чтобы промпт и валидация не
 * разъехались.
 */
export function contributionsPrompt(transcript: string, clubName = 'FLINT'): string {
  const kinds = Object.entries(CONTRIBUTION_KINDS)
    .map(([code, v]) => `  "${code}" — ${v.hint}`)
    .join('\n');

  return (
    `Ты разбираешь переписку похода клуба ${clubName} и находишь ЛИЧНЫЕ ПОСТУПКИ участников.\n` +
    'Верни СТРОГО JSON:\n' +
    '{"contributions":[{"who":"имя как в чате","kind":"код","title":"что сделал, до 80 знаков","quote":"цитата из чата","confidence":0.9}]}\n\n' +
    'ДОПУСТИМЫЕ КОДЫ (только они, ничего другого):\n' + kinds + '\n\n' +
    'ГЛАВНОЕ ПРАВИЛО — ФАКТ, А НЕ ОБЕЩАНИЕ.\n' +
    'Поступок есть только там, где человек что-то УЖЕ СДЕЛАЛ или делает прямо сейчас.\n' +
    '«Я возьму», «могу помочь», «давайте скинемся», «я готов» — это НЕ поступок, пропускай.\n' +
    '«Привёз», «снял», «разрулил», «вложил», «забрал», «приготовил», «довёз» — это поступок.\n\n' +
    'ЧТО СЧИТАТЬ ПОСТУПКОМ:\n' +
    '- Организатор собрал людей, придумал выезд, привёз инвентарь, закрыл вопрос деньгами — role_done.\n' +
    '- Кто-то помог другому разрешить проблему, поделился едой, выручил на месте — helped.\n' +
    '- Разрулил сложную ситуацию, в которой другие растерялись или спорили — calm_conflict.\n' +
    '- Человек вышел за свой обычный уровень, справился с тем, что раньше не мог — growth.\n\n' +
    'ПРАВИЛА ЦИТАТЫ (обязательно):\n' +
    '- quote — ДОСЛОВНАЯ фраза из переписки, по которой видно, что это правда.\n' +
    '- Если подтверждения в переписке нет — не добавляй эпизод вообще. Не додумывай.\n\n' +
    'ПРАВИЛА ИМЕНИ:\n' +
    '- who — имя ровно так, как оно подписано в переписке ниже. Люди пишут про третьих лиц\n' +
    '  («спасибо Ане за видео») — это тоже поступок Ани, и who должно быть её именем.\n\n' +
    'ПОЛЯ: title — коротко и по-человечески, без канцелярита. confidence — 0.7..1.0.\n' +
    'Если поступков нет — пустой массив. ЛУЧШЕ ПРОПУСТИТЬ, ЧЕМ ВЫДУМАТЬ.\n' +
    'Пиши по-русски.\n\nПЕРЕПИСКА:\n' + transcript
  );
}

/**
 * Привести ответ модели к списку, который не стыдно показать организатору.
 * Всё, что не проходит проверку, молча отбрасываем — это нормально и ожидаемо:
 * модель отвечает свободным текстом, и часть ответа всегда мусор.
 */
export function normalizeExtracted(raw: any): ExtractedContribution[] {
  const list = Array.isArray(raw?.contributions) ? raw.contributions : [];
  const out: ExtractedContribution[] = [];
  for (const c of list.slice(0, MAX_PER_RUN * 2)) {
    const kind = String(c?.kind || '').trim();
    if (!CONTRIBUTION_KINDS[kind]) continue; // красное и выдуманное — мимо
    const subjectName = String(c?.who || '').trim().slice(0, 60);
    const title = String(c?.title || '').trim().slice(0, 120);
    const quote = String(c?.quote || '').trim().slice(0, 300);
    const confidence = Number(c?.confidence);
    if (subjectName.length < 2 || title.length < 5) continue;
    if (!Number.isFinite(confidence) || confidence < MIN_CONFIDENCE) continue;
    out.push({ subjectName, kind, title, quote, confidence: Math.min(1, confidence) });
  }
  return out.slice(0, MAX_PER_RUN);
}

/**
 * КЛЮЧ ИМЕНИ для сравнения: «Ане» -> «аня», «@Alex_Flint_By» -> «alex». Берём
 * только первое слово и только буквы/цифры.
 */
function nameKey(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/^@/, '')
    .split(/\s+/)[0]
    .replace(/[^a-zа-я0-9_]/g, '');
}

/**
 * ТРАНСЛИТ. Ловушка, на которую уже наступили: у Артёма в Telegram имя
 * «ARTDEMENTIEV.BY» (латиница), а модель из переписки зовёт его «Артем»
 * (кириллица). Без транслита они не совпадут НИКОГДА, и организатор увидит
 * «человек не найден» на самом активном участнике выезда.
 */
function translit(s: string): string {
  const map: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i',
    й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's',
    т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
    ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  };
  return String(s || '').toLowerCase().split('').map((ch) => map[ch] ?? ch).join('').replace(/[^a-z0-9]/g, '');
}

/** Обе формы имени: как есть и в транслите. Совпадение — попадание в любую. */
function nameForms(s: string): string[] {
  const k = nameKey(s);
  const t = translit(k);
  return [...new Set([k, t].filter((x) => x.length >= 2))];
}

/**
 * Найти человека в участниках чата по имени, как его написала модель.
 * Возвращает id только при ОДНОЗНАЧНОМ совпадении: если «Александр» подходит
 * двоим, лучше не отметить никого, чем отметить не того.
 */
export function matchPerson(
  name: string,
  pool: Array<{ id: number; name: string }>,
): { id: number | null; ambiguous: boolean } {
  const forms = nameForms(name);
  if (!forms.length) return { id: null, ambiguous: false };

  // 1. Точное совпадение любой из форм (имя или его транслит).
  const exact = pool.filter((p) => {
    const pf = nameForms(p.name);
    return forms.some((f) => pf.includes(f));
  });
  if (exact.length === 1) return { id: exact[0].id, ambiguous: false };
  if (exact.length > 1) return { id: null, ambiguous: true };

  // 2. По началу имени: «Олегу» -> «Олег», «Ане» -> «Аня», «Артем» (artem) -> «ARTDEMENTIEV.BY» (art...).
  // Берём 3 символа префикса. Если на 3 символа претендует больше одного человека (напр. Александр и Алексей),
  // ambiguous=true отсечёт ложное начисление.
  const near = pool.filter((p) => {
    const pf = nameForms(p.name);
    return forms.some((f) => pf.some((q) => {
      const n = 3;
      return f.length >= n && q.length >= n && f.slice(0, n) === q.slice(0, n);
    }));
  });
  const uniq = [...new Map(near.map((p) => [p.id, p])).values()];
  return { id: uniq.length === 1 ? uniq[0].id : null, ambiguous: uniq.length > 1 };
}

/**
 * Извлечь поступки из переписки и записать их кандидатами.
 *
 * `askModel` передаётся снаружи (в вебхуке это geminiJSON): модуль не знает про
 * пул ключей, ротацию и уведомления об исчерпанной квоте — это забота вызывающего.
 * Так модуль остаётся тестируемым и не дублирует логику квот.
 */
export async function extractContributions(input: {
  eventId: string;
  chatId: number;
  messages: TranscriptMessage[];
  askModel: (prompt: string) => Promise<any | null>;
  pool: Array<{ id: number; name: string }>;
}): Promise<{ found: number; saved: number; ambiguous: string[]; skippedNoPerson: string[] }> {
  const rows = input.messages
    .filter((m) => Number(m.telegram_id) > 0 && String(m.text || '').trim().length > 15)
    .slice(-150);
  const result = { found: 0, saved: 0, ambiguous: [] as string[], skippedNoPerson: [] as string[] };
  if (rows.length < MIN_MESSAGES) return result;

  const transcript = rows
    .map((m) => {
      // message_id в подписи нужен, чтобы связать эпизод с конкретным
      // сообщением: организатор получит ссылку «открыть сообщение» и проверит.
      const tag = m.message_id ? `#${m.message_id} ` : '';
      return `${tag}${m.first_name || 'кто-то'}: ${String(m.text).replace(/\s+/g, ' ').trim().slice(0, 250)}`;
    })
    .join('\n')
    .slice(0, 14000);

  const parsed = await input.askModel(contributionsPrompt(transcript));
  if (parsed === null) return result; // ключ выдохся — вызывающий сам решит, что делать

  const found = normalizeExtracted(parsed);
  result.found = found.length;
  if (!found.length) return result;

  // Ссылку на сообщение достаём по дословной цитате — она же служит
  // доказательством для организатора. Не нашли цитату — эпизод всё равно
  // сохраняем, но без ссылки: лучше без ссылки, чем потерять поступок.
  const findMessageId = (quote: string): number | null => {
    const q = String(quote).toLowerCase().replace(/\s+/g, ' ').trim();
    if (q.length < 8) return null;
    for (const m of rows) {
      const body = String(m.text).toLowerCase().replace(/\s+/g, ' ');
      if (body.includes(q.slice(0, 40))) return m.message_id || null;
    }
    return null;
  };

  for (const c of found) {
    const hit = matchPerson(c.subjectName, input.pool);
    if (!hit.id) {
      if (hit.ambiguous) result.ambiguous.push(c.subjectName);
      else result.skippedNoPerson.push(c.subjectName);
      continue;
    }
    const messageId = findMessageId(c.quote);
    const { error } = await supabase.from('event_contributions').insert({
      event_id: input.eventId,
      subject_id: hit.id,
      kind: c.kind,
      title: c.title,
      quote: c.quote,
      confidence: c.confidence,
      chat_id: input.chatId,
      message_id: messageId,
      status: 'pending',
    });
    // 23505 = этот эпизод уже находили в прошлый разбор. Не ошибка.
    if (error && !/duplicate key|23505/i.test(error.message)) {
      console.warn('[contributions] insert failed:', error.message);
      continue;
    }
    if (!error) result.saved++;
  }
  return result;
}


/**
 * ПОДТВЕРЖДЕНИЕ — единственное место, где поступок становится репутацией.
 *
 * Сигнал пишем с источником `organizer`: он видел это своими глазами и
 * отвечает за слово. Вес такого сигнала в `summarize` выше анонимного (1.6×),
 * а `ai` был бы 0.5× — ровно чтобы пометка «нашёл парсер» не значила ничего
 * без человека.
 */
export async function confirmContribution(
  id: number,
  byId: number,
): Promise<{ ok: boolean; error?: string; points?: number; already?: boolean }> {
  const { data: row } = await supabase
    .from('event_contributions')
    .select('id,event_id,subject_id,kind,title,quote,status,points_awarded')
    .eq('id', id)
    .maybeSingle();
  if (!row) return { ok: false, error: 'not-found' };
  const c = row as any;
  if (c.status === 'confirmed') return { ok: true, already: true, points: Number(c.points_awarded) || 0 };

  // Подтверждать не может сам автор поступка: иначе человек находит добрые
  // дела про себя и «подтверждает» их себе же.
  if (Number(c.subject_id) === Number(byId)) return { ok: false, error: 'self' };

  const def = CONTRIBUTION_KINDS[c.kind];
  if (!def) return { ok: false, error: 'unknown-kind' };

  // 1. Сигнал репутации. Пишем напрямую в reputation_events — в вебхуке и
  //    events.ts стоит такая же вставка (импорт из api/_lib/ роняет функции на
  //    Vercel). Вес берём из общего словаря, источник — 'organizer': он там был
  //    и отвечает за слово, тогда как 'ai' весит втрое меньше.
  const sigDef = SIGNALS[c.kind];
  if (sigDef) {
    const { error: sigErr } = await supabase.from('reputation_events').insert({
      subject_id: Number(c.subject_id),
      author_id: byId,
      event_id: String(c.event_id),
      kind: c.kind,
      polarity: sigDef.polarity,
      weight: sigDef.weight,
      source: 'organizer',
      note: String(c.title).slice(0, 1000),
    });
    // 23505 = сигнал уже был (напр. добавили вручную) — не повод падать.
    if (sigErr && !/duplicate key|23505/i.test(sigErr.message)) {
      return { ok: false, error: sigErr.message };
    }
  }

  // 2. Баллы. Ниже 5 не даём: поступок не может весить меньше, чем просто
  //    приехать на событие (посещение = 10).
  const points = Math.max(5, Number(def.points) || 5);
  const { data: m } = await supabase
    .from('members')
    .select('points')
    .eq('telegram_id', Number(c.subject_id))
    .maybeSingle();
  if (m) {
    await supabase
      .from('members')
      .update({ points: Number((m as any).points || 0) + points })
      .eq('telegram_id', Number(c.subject_id));
    const { error: logErr } = await supabase.from('points_log').insert({
      telegram_id: Number(c.subject_id),
      event_id: c.event_id,
      reason: 'contribution',
      points,
      description: `Поступок на событии: ${c.title}`,
    });
    if (logErr) console.warn('[contributions] points_log skipped:', logErr.message);
  }

  // 3. Фиксируем, что сигнал ушёл — по этой ссылке эпизод можно откатить.
  const { data: sigRow } = await supabase
    .from('reputation_events')
    .select('id')
    .eq('subject_id', Number(c.subject_id))
    .eq('event_id', c.event_id)
    .eq('kind', c.kind)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  await supabase
    .from('event_contributions')
    .update({
      status: 'confirmed',
      reviewed_by: byId,
      reviewed_at: new Date().toISOString(),
      points_awarded: points,
      reputation_event_id: (sigRow as any)?.id || null,
    })
    .eq('id', id);

  return { ok: true, points };
}

/**
 * ОТКЛОНЕНИЕ. Модель нашла не то или посчитала обещание поступком — организатор
 * говорит «нет», и эпизод уходит из очереди. Строку НЕ удаляем: при следующем
 * разборе тех же сообщений она удержит эпизод от повторного появления
 * (unique-индекс), и организатора не спросят дважды об одном и том же.
 */
export async function rejectContribution(
  id: number,
  byId: number,
): Promise<{ ok: boolean; error?: string }> {
  const { data: row } = await supabase
    .from('event_contributions')
    .select('id,status')
    .eq('id', id)
    .maybeSingle();
  if (!row) return { ok: false, error: 'not-found' };
  if ((row as any).status === 'confirmed') return { ok: false, error: 'already-confirmed' };

  const { error } = await supabase
    .from('event_contributions')
    .update({ status: 'rejected', reviewed_by: byId, reviewed_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Эпизоды, ждущие организатора. Для уведомления в боте и блока в админке. */
export async function loadPending(eventId: string): Promise<any[]> {
  const { data } = await supabase
    .from('event_contributions')
    .select('*')
    .eq('event_id', eventId)
    .eq('status', 'pending')
    .order('confidence', { ascending: false })
    .limit(MAX_PER_RUN);
  return data || [];
}

/** Человеческая строка для сообщения в боте и для админки. */
export function contributionLine(c: any, subjectName: string): string {
  const def = CONTRIBUTION_KINDS[c.kind];
  const emoji = SIGNALS[c.kind]?.emoji || '🎖';
  return `${emoji} <b>${subjectName}</b> — ${c.title}${def ? ` (+${def.points})` : ''}`;
}

