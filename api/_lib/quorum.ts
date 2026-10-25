/**
 * «СОСТОИТСЯ ПРИ N» — событие с минимальным составом (баня: 10 человек,
 * владельцу нужно ответить за 4 часа до старта, чтобы успели затопить).
 *
 * Раньше это держалось на организаторе: обзвон, личные сообщения, «кто точно
 * идёт?», а за час до старта — отмена, потому что трое передумали. Здесь всё
 * это делает бот, и пишет только по делу (каждое сообщение — максимум раз):
 *
 *   сбор       в карточке и рассылках — «7 из 10, решение в 15:00»;
 *   полпути    набралась половина — записавшимся: «позови друга, гости тоже
 *              в счёт» (кнопка «поделиться» с реф-ссылкой человека);
 *   последний  за 3 ч до решения, если не хватает немного, — один призыв тем,
 *   призыв     кому это правда интересно (были на событиях за полгода, новенькие
 *              или ответили «Подумаю»), а не всему клубу: так бота не блокируют;
 *   ✅ набрали  сразу: записавшимся «состоится», организатору — «звони
 *              владельцу» со списком;
 *   ⏰ дедлайн  не набрали — организатору две кнопки «Проводим / Отменяем»;
 *              нет ответа за час — бот сам сообщает участникам об отмене.
 *
 * Настройка — `events.logistics.quorum = { min, hours }`: поле logistics
 * админка уже сохраняет как есть, миграция базы не нужна. Состояние —
 * app_config `quorum:<eventId>` (как у итогов роликов).
 *
 * Модуль не знает, откуда его зовут: клиент Supabase и отправка в Telegram
 * приходят параметрами — его используют и бот (Vercel), и почасовой
 * scripts/quorum.mts (GitHub Actions).
 */

export interface QuorumCfg { min: number; hours: number }
export type QuorumStage = 'collecting' | 'go' | 'decide' | 'held' | 'cancelled';
export interface QuorumState {
  stage: QuorumStage;
  half?: boolean;       // «полпути» отправлено
  lastcall?: boolean;   // последний призыв отправлен
  decide_at?: string;   // когда спросили организатора
  updated_at?: string;
}

type Send = (chatId: number, text: string, markup?: any) => Promise<any>;

const OWNER_ID = 377551019;
const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || 'campsflint_bot';
const SITE = process.env.APP_URL || 'https://flint-live-in-moment.vercel.app';

const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const plural = (n: number, one: string, few: string, many: string) =>
  n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many;
const people = (n: number) => `${n} ${plural(n, 'человек', 'человека', 'человек')}`;

/** Настройка кворума события или null (обычное событие). */
export function quorumOf(ev: any): QuorumCfg | null {
  const q = ev?.logistics?.quorum;
  const min = Math.round(Number(q?.min) || 0);
  if (min < 2) return null;
  return { min, hours: Math.max(1, Math.min(72, Math.round(Number(q?.hours) || 4))) };
}

/** Старт события по Минску (UTC+3 круглый год) в мс. Без времени — 10:00. */
export function startOf(ev: any): number {
  const d = String(ev?.date || '').slice(0, 10);
  const t = (String(ev?.time || '').match(/(\d{1,2})[:.](\d{2})/) || []);
  const hh = String(t[1] || '10').padStart(2, '0'), mm = t[2] || '00';
  return Date.parse(`${d}T${hh}:${mm}:00+03:00`);
}

/** Когда решаем, состоится ли: старт минус hours. */
export function deadlineOf(ev: any, q: QuorumCfg): number {
  return startOf(ev) - q.hours * 3600_000;
}

/** «сегодня в 15:00» / «завтра в 15:00» / «25 октября в 15:00» — по Минску. */
export function whenLabel(ms: number, now = Date.now()): string {
  const m = new Date(ms + 3 * 3600_000), n = new Date(now + 3 * 3600_000);
  const hm = `${String(m.getUTCHours()).padStart(2, '0')}:${String(m.getUTCMinutes()).padStart(2, '0')}`;
  const day = (x: Date) => Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
  const diff = Math.round((day(m) - day(n)) / 86400_000);
  const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const d = diff === 0 ? 'сегодня' : diff === 1 ? 'завтра' : `${m.getUTCDate()} ${MONTHS[m.getUTCMonth()]}`;
  return `${d} в ${hm}`;
}

/** Сколько нас: записавшиеся (не отменившие) + их гости — гости тоже в счёт. */
export async function headcount(db: any, evId: string): Promise<{ total: number; ids: number[]; names: string[] }> {
  const { data } = await db.from('registrations').select('telegram_id,guest_count,name,status')
    .eq('event_id', evId).not('status', 'in', '("cancelled","declined")');
  const rows = data || [];
  const ids = Array.from(new Set(rows.map((r: any) => Number(r.telegram_id)).filter((x: number) => x > 0))) as number[];
  const total = rows.reduce((n: number, r: any) => n + 1 + Math.max(0, Math.min(5, Number(r.guest_count) || 0)), 0);
  const names = rows.map((r: any) => String(r.name || '').trim().split(/\s+/)[0]).filter(Boolean);
  return { total, ids, names };
}

/** Строка прогресса для любых текстов: «🔥 7 из 10 — ещё 3, и баня состоится». */
export function progressLine(total: number, q: QuorumCfg, deadline: number, now = Date.now()): string {
  const left = Math.max(0, q.min - total);
  return left
    ? `🔥 Нас <b>${total} из ${q.min}</b> — ещё ${people(left)}, и всё состоится. Решаем ${whenLabel(deadline, now)}.`
    : `✅ Нас <b>${total}</b> — минимум ${q.min} набран, всё состоится.`;
}

/** «Что входит» — 3–4 пункта прямо в сообщение: внутрь карточки заходят не все. */
export function includedLines(ev: any, max = 4): string {
  const inc = ev?.logistics?.included;
  const list: string[] = (Array.isArray(inc) ? inc : String(inc || '').split(/\n|;|•/))
    .map((x: any) => String(x?.text ?? x).trim().replace(/^[-–•✓✅\s]+/, '')).filter(Boolean);
  if (!list.length) return '';
  return `\n<b>Что входит:</b>\n${list.slice(0, max).map((x) => `✓ ${esc(x)}`).join('\n')}${list.length > max ? '\n…и ещё в карточке' : ''}\n`;
}

async function getState(db: any, evId: string): Promise<QuorumState | null> {
  const { data } = await db.from('app_config').select('value').eq('key', `quorum:${evId}`).maybeSingle();
  const v = (data as any)?.value;
  if (!v) return null;
  try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; }
}
export async function setState(db: any, evId: string, st: QuorumState) {
  st.updated_at = new Date().toISOString();
  await db.from('app_config').upsert({ key: `quorum:${evId}`, value: JSON.stringify(st) }, { onConflict: 'key' });
}

function organizers(ev: any): number[] {
  return Array.from(new Set([Number(ev?.deputy_id) || 0, OWNER_ID].filter(Boolean)));
}
const openBtn = (evId: string) => ({ text: '👀 Открыть событие', web_app: { url: `${SITE}/?ev=${encodeURIComponent(evId)}` } });
const title = (ev: any) => esc(String(ev?.title || 'Событие').split(':')[0].trim());
const place = (ev: any) => esc(String(ev?.location || '').split(',')[0].trim());
const priceOf = (ev: any) => {
  const l = String(ev?.price_label || '');
  if (l && !/отсутств|бесплат|free|^0\b/i.test(l)) return esc(l);
  return Number(ev?.price_amount) ? `${ev.price_amount} BYN` : '';
};

/** Реф-ссылка человека (гость по ней проходит в клуб и записывается). */
async function refLink(db: any, tid: number): Promise<string> {
  const { data } = await db.from('members').select('ref_code').eq('telegram_id', tid).maybeSingle();
  const code = (data as any)?.ref_code;
  return code ? `https://t.me/${BOT_USERNAME}?start=ref_${code}` : `https://t.me/${BOT_USERNAME}`;
}

/**
 * Кому слать последний призыв: принятые участники с живым ботом, не
 * записанные, не выключившие уведомления о событиях и не ответившие «Не смогу»,
 * И при этом «тёплые»: были записаны на что-то за полгода, вступили в клуб за
 * последние 45 дней или ответили на это событие «Подумаю». Холодной базе призыв не шлём — это и есть путь к блоку.
 */
async function warmAudience(db: any, evId: string, exclude: number[]): Promise<number[]> {
  const since = new Date(Date.now() - 180 * 86400_000).toISOString();
  const fresh = Date.now() - 45 * 86400_000;
  const [{ data: mem }, { data: regs }, { data: inv }] = await Promise.all([
    db.from('members').select('telegram_id,bot_active,status,is_core,prefs,created_at').or('status.eq.approved,is_core.eq.true'),
    db.from('registrations').select('telegram_id').gte('created_at', since).neq('status', 'cancelled'),
    db.from('event_invites').select('telegram_id,answer').eq('event_id', evId),
  ]);
  const said = new Map<number, string>((inv || []).map((r: any) => [Number(r.telegram_id), String(r.answer || '')]));
  const warm = new Set<number>((regs || []).map((r: any) => Number(r.telegram_id)));
  for (const [id, a] of said) if (a === 'maybe') warm.add(id);
  // Новенькие (вступили за 45 дней) — ещё не успели никуда записаться, но им интереснее всех.
  for (const m of mem || []) if (Date.parse(m.created_at || '') >= fresh) warm.add(Number(m.telegram_id));
  return (mem || [])
    .filter((m: any) => m.bot_active !== false && m.prefs?.notify?.events !== false)
    .map((m: any) => Number(m.telegram_id))
    .filter((id: number) => id > 0 && warm.has(id) && !exclude.includes(id) && said.get(id) !== 'no');
}

/**
 * Один шаг автомата для события. Зовётся раз в час (scripts/quorum.mts) и
 * сразу после записи — поэтому «набрали» приходит в ту же минуту.
 */
export async function stepQuorum(db: any, send: Send, ev: any, now = Date.now()): Promise<string> {
  const q = quorumOf(ev);
  if (!q || ev?.status === 'draft' || ev?.status === 'cancelled') return 'skip';
  const start = startOf(ev), deadline = deadlineOf(ev, q);
  if (!Number.isFinite(start) || now > start) return 'past';
  const st: QuorumState = (await getState(db, ev.id)) || { stage: 'collecting' };
  if (st.stage === 'held' || st.stage === 'cancelled' || st.stage === 'go') return st.stage;
  const hc = await headcount(db, ev.id);
  const name = title(ev);
  const when = whenLabel(start, now);

  // ✅ Набрали — в любой момент до старта (и даже пока орг думает над «decide»).
  if (hc.total >= q.min) {
    for (const id of hc.ids) {
      await send(id, `🔥 <b>${name}</b> — состоится. Нас уже ${people(hc.total)}.\n\n` +
        `Встречаемся ${when}${ev.location ? `, ${esc(String(ev.location).split(',')[0])}` : ''}.\n` +
        `Если планы поменяются — отпишись заранее в карточке: на тебя рассчитывают ещё ${people(hc.total - 1)}.`,
        { inline_keyboard: [[openBtn(ev.id)]] });
    }
    for (const id of organizers(ev)) {
      await send(id, `✅ <b>Кворум набран: ${name}</b> — ${hc.total} из ${q.min}.\n\n` +
        `Можно подтверждать площадке${now < deadline ? ` (крайний срок — ${whenLabel(deadline, now)})` : ''}.\n` +
        (hc.names.length ? `Идут: ${esc(hc.names.slice(0, 20).join(', '))}${hc.names.length > 20 ? '…' : ''}` : ''));
    }
    await setState(db, ev.id, { ...st, stage: 'go' });
    return 'go';
  }

  // ⏰ Дедлайн без кворума — решает организатор, молчит час — отменяем сами.
  if (now >= deadline) {
    if (st.stage === 'collecting') {
      for (const id of organizers(ev)) {
        await send(id, `⏰ <b>${name}</b>: время решать — нас ${hc.total} из ${q.min}.\n\n` +
          `Проводим с теми, кто есть, или отменяем? Если не ответишь за час, я сам напишу участникам, что отменяем, и ты сможешь предупредить площадку.`,
          { inline_keyboard: [[{ text: `✅ Проводим (${hc.total})`, callback_data: `qgo_${ev.id}` }, { text: '❌ Отменяем', callback_data: `qno_${ev.id}` }]] });
      }
      await setState(db, ev.id, { ...st, stage: 'decide', decide_at: new Date(now).toISOString() });
      return 'decide';
    }
    if (st.stage === 'decide' && now - Date.parse(st.decide_at || '') >= 3600_000) {
      await cancelQuorum(db, send, ev, hc.total, q);
      return 'cancelled';
    }
    return st.stage;
  }

  // Полпути: записавшимся — «позови друга», гости в счёт.
  if (!st.half && hc.total >= Math.ceil(q.min / 2)) {
    for (const id of hc.ids) {
      const link = await refLink(db, id);
      const share = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(`Пойдём со мной: ${String(ev.title || '').split(':')[0]}, ${when}`)}`;
      await send(id, `🔥 <b>${name}</b>: нас уже ${hc.total} из ${q.min}.\n\n` +
        `Не хватает ${people(q.min - hc.total)}. Позови друга — гости тоже идут в счёт: добавить «+1» можно в карточке события.`,
        { inline_keyboard: [[{ text: '📨 Позвать друга', url: share }], [openBtn(ev.id)]] });
    }
    st.half = true;
    await setState(db, ev.id, st);
  }

  // Последний призыв: за 3 ч до решения, если не хватает немного (≤ 40 %).
  const missing = q.min - hc.total;
  if (!st.lastcall && now >= deadline - 3 * 3600_000 && missing <= Math.ceil(q.min * 0.4)) {
    const aud = await warmAudience(db, ev.id, hc.ids);
    for (const id of aud) {
      // Коротко, как у сервисов записи на игры: что/когда → где/сколько/цена → что входит → одна кнопка.
      await send(id, `🔥 <b>${name} · ${when}</b>\n` +
        [place(ev), `нас ${hc.total} из ${q.min}`, `ещё ${missing} — и состоится`, priceOf(ev)].filter(Boolean).join(' · ') + '\n' +
        includedLines(ev) + `\n<i>Решаем ${whenLabel(deadline, now)}. Гости «+1» тоже в счёт.</i>`,
        { inline_keyboard: [[{ text: '✅ Записаться', callback_data: `inv_y_${ev.id}` }], [openBtn(ev.id)]] });
    }
    st.lastcall = true;
    await setState(db, ev.id, st);
    return `lastcall:${aud.length}`;
  }
  return 'collecting';
}

/** Отмена из-за кворума: участникам — по-человечески, организатору — что сделать. */
export async function cancelQuorum(db: any, send: Send, ev: any, total: number, q: QuorumCfg) {
  const { ids } = await headcount(db, ev.id);
  const name = title(ev);
  for (const id of ids) {
    await send(id, `😕 <b>${name}</b> в этот раз не собралась: нас ${total} из ${q.min} нужных.\n\n` +
      `Ты ничего не теряешь — оплаты не было. Новую дату пришлю первым, и ты будешь в списке одним тапом.`);
  }
  for (const id of organizers(ev)) {
    await send(id, `❌ <b>${name}</b> отменена: ${total} из ${q.min}. Участникам я написал — осталось предупредить площадку.`);
  }
  await setState(db, ev.id, { stage: 'cancelled' });
}
