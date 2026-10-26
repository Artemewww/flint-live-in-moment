import { createClient } from '@supabase/supabase-js';
import * as crypto from 'crypto';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

/** Структурированный лог: одна JSON-строка на событие — greppable в Vercel. */
function slog(level: 'info' | 'warn' | 'error', msg: string, err?: any) {
  const line: any = { t: new Date().toISOString(), level, scope: 'admin/registrations', msg };
  if (err !== undefined) line.err = err?.message || String(err);
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(JSON.stringify(line));
}

/**
 * Бан/разбан человека во ВСЕХ Telegram-группах событий.
 * Дублировано из api/_lib/group-ban.ts — Vercel не включает файлы из папок
 * с префиксом «_» в бандл serverless-функции, импорт роняет MODULE_NOT_FOUND.
 */
async function setGroupBan(telegramId: number, ban: boolean) {
  const out = { groups: 0, kicked: 0, failed: [] as string[] };
  if (!BOT_TOKEN || !Number.isFinite(telegramId) || telegramId <= 0) return out;
  let chats: number[] = [];
  try {
    const { data } = await supabase.from('event_groups').select('chat_id').eq('active', true);
    chats = Array.from(new Set((data || [])
      .map((g: any) => Number(g.chat_id))
      .filter((c: number) => Number.isFinite(c) && c !== 0)));
  } catch { return out; }
  out.groups = chats.length;
  const method = ban ? 'banChatMember' : 'unbanChatMember';
  for (const chatId of chats) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, user_id: telegramId, ...(ban ? {} : { only_if_banned: true }) }),
      });
      const j = await r.json();
      if (j?.ok) out.kicked += 1;
      else out.failed.push(`${chatId}: ${j?.description || 'отказ Telegram'}`);
    } catch (e) {
      out.failed.push(`${chatId}: ${(e as Error).message}`);
    }
  }
  if (out.failed.length) slog('warn', `group ${ban ? 'ban' : 'unban'}: часть групп не отработала`, { failed: out.failed });
  return out;
}

/** Начисление баллов участнику (read+update, без RPC). Best-effort. */
/** Начислить баллы и записать причину в журнал — без причины баллы «ни за что». */
async function bumpPoints(tgId: number, n: number, reason: string, description: string, eventId?: string | null) {
  try {
    const { data } = await supabase.from('members').select('points').eq('telegram_id', tgId).maybeSingle();
    const cur = (data as any)?.points || 0;
    await supabase.from('members').update({ points: cur + n }).eq('telegram_id', tgId);
    try {
      await supabase.from('points_log').insert({ telegram_id: tgId, event_id: eventId || null, reason, points: n, description });
    } catch { /* журнал необязателен */ }
  } catch { /* колонка points могла отсутствовать до миграции */ }
}

const POINTS_ATTEND = 100;   // за подтверждённое участие
const POINTS_REFERRAL = 150; // рефереру за первого приведённого

// ─── Админская авторизация ───────────────────────────────────────────────
// Дублируется по файлам сознательно: Vercel не включает в бандл функции
// модули из папок на «_», а импорт из ../src роняет FUNCTION_INVOCATION_FAILED
// (PLAN.md §9). Тот же приём, что с mapEventToCamelCase.
//
// Секрет живёт только в env. Раньше здесь был фолбэк на строку-пароль, и она
// уезжала в публичный JS-бандл вместе с фронтом.
const ADMIN_SECRET = process.env.ADMIN_TOKEN || '';
const ADMIN_COOKIE = 'flint_admin';

function safeEq(a: string, b: string): boolean {
  const A = Buffer.from(String(a)), B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

function readCookie(req: any, name: string): string | null {
  const raw = req.headers?.cookie;
  if (!raw) return null;
  for (const part of String(raw).split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

/** Кука вида <срок>.<подпись>: подпись не даёт продлить срок вручную. */
function validSession(value: string): boolean {
  const [expRaw, mac] = String(value).split('.');
  const exp = Number(expRaw);
  if (!exp || !mac || Date.now() > exp) return false;
  return safeEq(mac, crypto.createHmac('sha256', ADMIN_SECRET).update(String(exp)).digest('hex'));
}

/** Пускать ли запрос: заголовок (крон, curl) или подписанная кука (браузер). */
function isAdmin(req: any): boolean {
  if (!ADMIN_SECRET) return false;
  const bearer = String(req.headers?.authorization || '').replace('Bearer ', '');
  // ADMIN_SECRET — для крона/curl. Браузер и Mini App шлют СЕССИОННЫЙ токен
  // (тот же exp.mac, что в куке): в Mini App кука SameSite=Strict не доходит,
  // поэтому заголовок — единственный рабочий путь.
  if (bearer && (safeEq(bearer, ADMIN_SECRET) || validSession(bearer))) return true;
  const cookie = readCookie(req, ADMIN_COOKIE);
  return !!cookie && validSession(cookie);
}

function deny(res: any) {
  return res.status(401).json({ error: 'Unauthorized' });
}


// ─── ПРИГЛАСИТЕЛЬНЫЕ КЛУБА ───────────────────────────────────────────────
// Пул билетов события лежит в app_config под ключом club_tickets:<eventId>
// (заводит scripts/club-tickets-setup.ts), PDF — в приватном бакете
// club-tickets. Один билет — один человек: код FL-XXXX и имя впечатываются
// в низ билета при выдаче, файл приходит человеку в личку от бота.
// Код живёт здесь целиком: общий api/_lib/ на Vercel падает в рантайме.
const TICKET_BUCKET = 'club-tickets';
type ClubTicket = {
  no: number; file: string; base: string; number?: string; series?: string; code: string;
  assignedTo?: number | null; assignedName?: string; assignedUsername?: string; assignedAt?: string;
  issued?: string; sentAt?: string; sendError?: string; resentCount?: number; openedAt?: string; usedAt?: string;
};
type TicketPool = { eventId: string; total: number; tickets: ClubTicket[] };

async function loadPool(eventId: string): Promise<TicketPool | null> {
  const { data } = await supabase.from('app_config').select('value').eq('key', `club_tickets:${eventId}`).maybeSingle();
  if (!(data as any)?.value) return null;
  try { return JSON.parse((data as any).value); } catch { return null; }
}
async function savePool(pool: TicketPool) {
  await supabase.from('app_config').upsert({ key: `club_tickets:${pool.eventId}`, value: JSON.stringify(pool) }, { onConflict: 'key' });
}
async function storageBytes(path: string): Promise<Uint8Array> {
  const { data, error } = await supabase.storage.from(TICKET_BUCKET).download(path);
  if (error || !data) throw new Error(`Нет файла ${path}: ${error?.message || ''}`);
  return new Uint8Array(await data.arrayBuffer());
}

/** Плашка «чей пригласительный» — только в нижней полосе под баннером. */
async function stampTicket(i: { base: Uint8Array; name: string; username?: string; no: number; total: number; code: string; issuedAt: Date }): Promise<Uint8Array> {
  const [fontBold, fontMed, logoPng] = await Promise.all([
    storageBytes('_assets/bold.ttf'), storageBytes('_assets/medium.ttf'), storageBytes('_assets/logo.png'),
  ]);
  const doc = await PDFDocument.load(i.base);
  doc.registerFontkit(fontkit);
  const B = await doc.embedFont(fontBold, { subset: true });
  const M = await doc.embedFont(fontMed, { subset: true });
  const logo = await doc.embedPng(logoPng);
  const page = doc.getPage(0);
  const { width: W } = page.getSize();
  // Полоса под баннером организатора: баннер кончается на y≈109 от низа листа.
  const x0 = 14.16, x1 = W - 19.92, y0 = 16, y1 = 100;
  const ink = rgb(0.07, 0.07, 0.07), soft = rgb(0.42, 0.42, 0.42), line = rgb(0.86, 0.86, 0.86);
  page.drawRectangle({ x: x0, y: y0, width: x1 - x0, height: y1 - y0, borderColor: line, borderWidth: 0.8, color: rgb(1, 1, 1) });
  page.drawRectangle({ x: x0, y: y0, width: 4, height: y1 - y0, color: ink });
  const fit = (txt: string, font: any, size: number, max: number) => {
    let t = txt;
    while (t.length > 1 && font.widthOfTextAtSize(t, size) > max) t = t.slice(0, -2) + '…';
    return t;
  };
  const spaced = (txt: string, font: any, size: number, x: number, y: number, color: any, track = 0.9) => {
    let cx = x;
    for (const ch of txt) { page.drawText(ch, { x: cx, y, size, font, color }); cx += font.widthOfTextAtSize(ch, size) + track; }
  };
  const L = x0 + 16, maxL = 330;
  spaced(`ПРИГЛАШЕНИЕ КЛУБА «ЖИВИ В МОМЕНТЕ»  ·  № ${i.no} ИЗ ${i.total}`, B, 6.4, L, y1 - 15, soft);
  // Имя — главное на именном билете: сначала уменьшаем кегль (до 12), и
  // только если и так не влезает — режем.
  let ns = 17;
  while (ns > 12 && B.widthOfTextAtSize(i.name, ns) > maxL) ns -= 0.5;
  page.drawText(fit(i.name, B, ns, maxL), { x: L, y: y1 - 36, size: ns, font: B, color: ink });
  const dt = i.issuedAt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Minsk' });
  page.drawText(fit([i.username ? `@${i.username}` : '', `выдан ${dt}`, `код ${i.code}`].filter(Boolean).join('  ·  '), M, 8, maxL),
    { x: L, y: y1 - 49, size: 8, font: M, color: soft });
  [
    'Врывайся в поток AI: заряжайся идеями, перезагружай мышление, расти в масштабе.',
    'Мы находим такие возможности и дарим их своим — это твой шаг к эволюции.',
  ].forEach((t, k) => page.drawText(fit(t, M, 7.6, maxL + 10), { x: L, y: y1 - 64 - k * 10.5, size: 7.6, font: M, color: ink }));
  const lw = 168, lh = lw * logo.height / logo.width;
  page.drawImage(logo, { x: x1 - 14 - lw, y: y1 - 18 - lh, width: lw, height: lh });
  for (const [t, y] of [['Именной · передавать нельзя', y0 + 22], ['Предъяви на входе QR выше', y0 + 12]] as const) {
    page.drawText(t, { x: x1 - 14 - M.widthOfTextAtSize(t, 6.8), y, size: 6.8, font: M, color: soft });
  }
  return doc.save();
}

/** Подпись к файлу в личке — фирменным голосом клуба. */
function ticketCaption(ev: any, t: ClubTicket, total: number): string {
  const e = (v: string) => String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `🎟 <b>Твой пригласительный — ${e(ev?.title || 'событие')}</b>\n` +
    `№ ${t.no} из ${total} · именной · код <code>${t.code}</code>\n\n` +
    `Врывайся в поток. Заряжайся идеями, перезагружай мышление, сверяй свой стержень с масштабом, который задают лучшие. ` +
    `Клуб находит такие возможности и дарит их своим — это и есть наша эволюция.\n\n` +
    (ev?.date_label ? `📆 ${e(ev.date_label)}\n` : '') + (ev?.location ? `📍 ${e(ev.location)}\n` : '') +
    `\nНа входе покажи QR из файла — с телефона или распечатанный. Билет одноразовый: проходит первый скан, ` +
    `поэтому не пересылай его никому.\nПотерял файл или почистил чат — нажми кнопку ниже, пришлю снова.`;
}

async function sendTicketDoc(chatId: number, bytes: Uint8Array, filename: string, caption: string, eventId: string): Promise<{ ok: boolean; error?: string }> {
  if (!BOT_TOKEN) return { ok: false, error: 'нет TELEGRAM_BOT_TOKEN' };
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('caption', caption.slice(0, 1024));
  form.append('parse_mode', 'HTML');
  form.append('reply_markup', JSON.stringify({ inline_keyboard: [[{ text: '🎟 Прислать пригласительный ещё раз', callback_data: `tkt_${eventId}` }]] }));
  form.append('document', new Blob([bytes], { type: 'application/pdf' }), filename);
  try {
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, { method: 'POST', body: form });
    const j: any = await r.json();
    return j?.ok ? { ok: true } : { ok: false, error: String(j?.description || r.status) };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

/** Кто держит билет: имя как в анкете записи, иначе как в профиле. */
async function holderOf(eventId: string, tgId: number): Promise<{ name: string; username: string }> {
  const { data: reg } = await supabase.from('registrations').select('name').eq('event_id', eventId).eq('telegram_id', tgId).neq('status', 'cancelled').maybeSingle();
  const { data: m } = await supabase.from('members').select('first_name,last_name,username').eq('telegram_id', tgId).maybeSingle();
  const profile = [(m as any)?.first_name, (m as any)?.last_name].filter(Boolean).join(' ').trim();
  const regName = String((reg as any)?.name || '').trim();
  // Анкета записи обычно с фамилией — она точнее для именного билета.
  const name = regName.split(/\s+/).length >= 2 ? regName : (profile || regName || ((m as any)?.username ? '@' + (m as any).username : `Участник ${tgId}`));
  return { name, username: String((m as any)?.username || '') };
}

/** Выдать билет t человеку tgId: штамп, файл в хранилище, отправка в личку. */
async function issueTicket(pool: TicketPool, t: ClubTicket, tgId: number, ev: any): Promise<{ ok: boolean; error?: string }> {
  const who = await holderOf(pool.eventId, tgId);
  const at = new Date();
  const bytes = await stampTicket({ base: await storageBytes(t.base), name: who.name, username: who.username, no: t.no, total: pool.total, code: t.code, issuedAt: at });
  const issued = `${pool.eventId}/issued/${t.no}-${tgId}.pdf`;
  const { error: upErr } = await supabase.storage.from(TICKET_BUCKET).upload(issued, bytes, { contentType: 'application/pdf', upsert: true });
  if (upErr) return { ok: false, error: upErr.message };
  Object.assign(t, { assignedTo: tgId, assignedName: who.name, assignedUsername: who.username, assignedAt: at.toISOString(), issued, usedAt: undefined, openedAt: undefined });
  const sent = await sendTicketDoc(tgId, bytes, `Пригласительный_${t.no}_${t.code}.pdf`, ticketCaption(ev, t, pool.total), pool.eventId);
  if (sent.ok) { t.sentAt = at.toISOString(); t.sendError = undefined; } else t.sendError = sent.error;
  return sent;
}

export default async function handler(req: any, res: any) {
  if (!isAdmin(req)) return deny(res);

  /**
   * Аудитория клуба: кто есть, кто активен в боте, кто кого привёл,
   * сколько событий реально посетил. Основа для статистики результативности.
   */

  /**
   * ПРИГЛАСИТЕЛЬНЫЕ: состояние пула + кандидаты (записавшиеся без билета).
   */
  if (req.method === 'GET' && req.query?.action === 'tickets') {
    const eventId = String(req.query?.eventId || '');
    const pool = await loadPool(eventId);
    if (!pool) return res.status(200).json({ ok: true, pool: null });
    const { data: regs } = await supabase.from('registrations').select('telegram_id,name,registered_at,status')
      .eq('event_id', eventId).neq('status', 'cancelled').order('registered_at', { ascending: true });
    const holders = new Set(pool.tickets.map((t) => Number(t.assignedTo)).filter(Boolean));
    const ids = [...new Set((regs || []).map((r: any) => Number(r.telegram_id)).filter((n: number) => n > 0))];
    const { data: ms } = ids.length ? await supabase.from('members').select('telegram_id,first_name,username').in('telegram_id', ids) : { data: [] as any[] };
    const mm = new Map((ms || []).map((m: any) => [Number(m.telegram_id), m]));
    const candidates = ids.filter((id) => !holders.has(id)).map((id) => {
      const r: any = (regs || []).find((x: any) => Number(x.telegram_id) === id) || {};
      const m: any = mm.get(id) || {};
      return { telegramId: id, name: r.name || m.first_name || `id${id}`, username: m.username || '' };
    });
    return res.status(200).json({ ok: true, pool, candidates });
  }

  if (req.method === 'POST' && String(req.query?.action || '').startsWith('ticket_')) {
    const action = String(req.query.action);
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const eventId = String(body.eventId || '');
    const pool = await loadPool(eventId);
    if (!pool) return res.status(404).json({ error: 'У события нет пула пригласительных' });
    const { data: ev } = await supabase.from('events').select('id,title,date_label,location,deputy_id').eq('id', eventId).maybeSingle();
    const byNo = (n: number) => pool.tickets.find((t) => t.no === Number(n));
    try {
      if (action === 'ticket_issue') {
        const tgId = Number(body.telegramId) || 0;
        if (!tgId) return res.status(400).json({ error: 'Кому выдать?' });
        if (pool.tickets.some((t) => Number(t.assignedTo) === tgId)) return res.status(200).json({ ok: false, error: 'У человека уже есть билет на это событие' });
        const t = body.no ? byNo(body.no) : pool.tickets.find((x) => !x.assignedTo);
        if (!t) return res.status(200).json({ ok: false, error: 'Свободных пригласительных нет' });
        if (t.assignedTo) return res.status(200).json({ ok: false, error: `Билет № ${t.no} уже выдан` });
        const r = await issueTicket(pool, t, tgId, ev);
        await savePool(pool);
        return res.status(200).json({ ok: true, delivered: r.ok, error: r.error, pool });
      }
      if (action === 'ticket_issue_all') {
        // Организатор — первым (он ведёт группу и должен попасть точно),
        // дальше записавшиеся в порядке записи. Отказавшиеся не участвуют.
        const { data: regs } = await supabase.from('registrations').select('telegram_id,registered_at')
          .eq('event_id', eventId).neq('status', 'cancelled').order('registered_at', { ascending: true });
        const queue = [Number((ev as any)?.deputy_id) || 0, ...(regs || []).map((r: any) => Number(r.telegram_id))]
          .filter((id, i, a) => id > 0 && a.indexOf(id) === i)
          .filter((id) => !pool.tickets.some((t) => Number(t.assignedTo) === id));
        let issued = 0, delivered = 0;
        const failed: string[] = [];
        for (const id of queue) {
          const t = pool.tickets.find((x) => !x.assignedTo);
          if (!t) break;
          const r = await issueTicket(pool, t, id, ev);
          issued++; if (r.ok) delivered++; else failed.push(`${t.assignedName}: ${r.error}`);
        }
        await savePool(pool);
        return res.status(200).json({ ok: true, issued, delivered, failed, left: pool.tickets.filter((t) => !t.assignedTo).length, waiting: Math.max(0, queue.length - issued), pool });
      }
      const t = byNo(body.no);
      if (!t) return res.status(404).json({ error: 'Нет такого билета' });
      if (action === 'ticket_resend') {
        if (!t.assignedTo || !t.issued) return res.status(200).json({ ok: false, error: 'Билет ещё не выдан' });
        const r = await sendTicketDoc(Number(t.assignedTo), await storageBytes(t.issued), `Пригласительный_${t.no}_${t.code}.pdf`, ticketCaption(ev, t, pool.total), eventId);
        if (r.ok) { t.sentAt = new Date().toISOString(); t.sendError = undefined; t.resentCount = (t.resentCount || 0) + 1; } else t.sendError = r.error;
        await savePool(pool);
        return res.status(200).json({ ok: r.ok, error: r.error, pool });
      }
      if (action === 'ticket_revoke') {
        // Освобождаем номер. Сам файл у человека остаётся — штрих-код
        // проходит один раз, поэтому новый держатель должен пройти раньше
        // или организатор предупреждает контроль. Об этом пишем в админке.
        if (t.issued) { try { await supabase.storage.from(TICKET_BUCKET).remove([t.issued]); } catch { /* no-op */ } }
        const prev = Number(t.assignedTo) || 0;
        for (const k of ['assignedTo', 'assignedName', 'assignedUsername', 'assignedAt', 'issued', 'sentAt', 'sendError', 'resentCount', 'openedAt', 'usedAt'] as const) delete (t as any)[k];
        await savePool(pool);
        if (prev && BOT_TOKEN) {
          try {
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: prev, parse_mode: 'HTML', text: `🎟 Пригласительный № ${t.no} на «${String((ev as any)?.title || 'событие')}» передан другому участнику. Если это ошибка — напиши организатору.` }),
            });
          } catch { /* no-op */ }
        }
        return res.status(200).json({ ok: true, pool });
      }
      if (action === 'ticket_used') {
        t.usedAt = body.used === false ? undefined : new Date().toISOString();
        await savePool(pool);
        return res.status(200).json({ ok: true, pool });
      }
      return res.status(400).json({ error: 'Неизвестное действие' });
    } catch (e) {
      return res.status(500).json({ error: (e as Error).message });
    }
  }

  // Журнал баллов участника: «за что у него столько» — по одной строке на начисление.
  if (req.method === 'GET' && req.query?.action === 'points_log') {
    const tid = Number(req.query?.telegramId) || 0;
    if (!tid) return res.status(400).json({ error: 'telegramId обязателен' });
    const { data, error } = await supabase.from('points_log')
      .select('points,reason,description,created_at,event_id').eq('telegram_id', tid)
      .order('created_at', { ascending: false }).limit(200);
    if (error) return res.status(200).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, rows: data || [] });
  }

  if (req.method === 'GET' && req.query?.action === 'members') {
    try {
      const { data: membersRaw } = await supabase
        .from('members')
        .select('telegram_id,username,first_name,status,is_core,role,referred_by,points,bot_active,last_seen_at,created_at,phone,gender,birthday,dietary,prefs')
        .order('points', { ascending: false });
      // Служебные Telegram-боты (анонимный админ группы, каналы, сервис) не участники —
      // не показываем их в аудитории, чтобы список был «чётким» (жалоба владельца).
      const SERVICE_BOT_IDS = new Set([1087968824, 136817688, 777000, 93372553]);
      const members = (membersRaw || []).filter((m: any) =>
        !SERVICE_BOT_IDS.has(Number(m.telegram_id)) &&
        String(m.username || '').toLowerCase() !== 'groupanonymousbot'
      );

      const { data: attended } = await supabase
        .from('registrations').select('telegram_id').eq('attended', true);
      const { data: regs } = await supabase
        .from('registrations').select('telegram_id').neq('status', 'cancelled');

      const countBy = (rows: any[]) => {
        const m = new Map<string, number>();
        for (const r of rows || []) {
          const k = String(r.telegram_id);
          m.set(k, (m.get(k) || 0) + 1);
        }
        return m;
      };
      const attendedBy = countBy(attended || []);
      const regsBy = countBy(regs || []);
      const invitedBy = countBy((members || []).filter((m: any) => m.referred_by).map((m: any) => ({ telegram_id: m.referred_by })));
      // Имя пригласившего по id (из полного списка, чтобы резолвить даже отфильтрованных).
      const nameById = new Map<string, string>();
      for (const m of membersRaw || []) {
        nameById.set(String((m as any).telegram_id), (m as any).first_name || ((m as any).username ? '@' + (m as any).username : ''));
      }

      // Фото из Telegram — чтобы в админке узнавать людей в лицо (прокси и
      // подпись — как в api/events.ts avatarUrl; задублировано намеренно).
      const avatarOf = (id: number) => id > 0 && BOT_TOKEN
        ? `/api/events?action=avatar&u=${id}&s=${crypto.createHmac('sha256', BOT_TOKEN).update(`avatar:${id}`).digest('hex').slice(0, 16)}`
        : '';
      const list = (members || []).map((m: any) => ({
        telegramId: String(m.telegram_id),
        avatar: avatarOf(Number(m.telegram_id)),
        username: m.username,
        firstName: m.first_name,
        phone: m.phone || null,
        status: m.status || 'pending',
        isCore: !!m.is_core,
        role: m.role || 'member',
        referredBy: m.referred_by ? String(m.referred_by) : null,
        referredByName: m.referred_by ? (nameById.get(String(m.referred_by)) || `id ${m.referred_by}`) : null,
        points: m.points || 0,
        // Данные, которых костяку не хватало для контроля состава:
        // пол (расселение по палаткам), согласие на фото/видео (закон РБ —
        // без него нельзя публиковать галерею) и принятие правил клуба.
        gender: m.gender || null,
        birthday: m.birthday || null,
        dietary: m.dietary || null,
        mediaConsent: m.prefs?.media_consent
          ? (m.prefs.media_consent.agreed ? 'yes' : 'no')
          : 'unknown',
        rulesAccepted: m.prefs?.rules_accepted?.at || null,
        // Зачем человек идёт в клуб (его слова) и подтвердил ли он, что
        // разделяет ценности. Раньше костяк решал по имени и телефону, а мотив
        // выяснялся уже на выезде — там же, где и цена ошибки.
        joinReason: m.prefs?.join_reason?.text || null,
        joinReasonAt: m.prefs?.join_reason?.at || null,
        valuesConfirmed: m.prefs?.values_confirmed?.at || null,
        botActive: m.bot_active !== false,
        lastSeenAt: m.last_seen_at,
        createdAt: m.created_at,
        // Когда подана заявка: анкета ставит отметки в prefs, created_at — это первое «Старт».
        appliedAt: m.prefs?.rules_accepted?.at || m.prefs?.join_reason?.at || null,
        // Веб-заявки без Telegram имеют отрицательный хеш вместо id.
        realTelegram: Number(m.telegram_id) > 0,
        attendedCount: attendedBy.get(String(m.telegram_id)) || 0,
        registeredCount: regsBy.get(String(m.telegram_id)) || 0,
        invitedCount: invitedBy.get(String(m.telegram_id)) || 0,
      }));

      const reachable = list.filter((m) => m.realTelegram && m.botActive).length;
      // Пол: для расселения по палаткам и контроля состава. Считаем по всем,
      // у кого пол указан; «не указан» — отдельно, чтобы костяк видел пробел.
      const male = list.filter((m) => m.gender === 'male').length;
      const female = list.filter((m) => m.gender === 'female').length;
      const noGender = list.filter((m) => !m.gender).length;
      return res.status(200).json({
        members: list,
        summary: {
          total: list.length,
          approved: list.filter((m) => m.status === 'approved').length,
          core: list.filter((m) => m.isCore).length,
          reachable,
          blocked: list.filter((m) => m.realTelegram && !m.botActive).length,
          male,
          female,
          noGender,
        },
      });
    } catch (error) {
      return res.status(500).json({ error: (error as Error).message });
    }
  }

  // ─── Инвентарь клуба: кто чем владеет, у кого на руках, сколько держит ──────
  if (req.method === 'GET' && req.query?.action === 'assets') {
    try {
      const { data } = await supabase.from('club_assets').select('*').order('category', { ascending: true });
      // Ожидающие подтверждения передачи (note='pending') — чтобы показать «⏳ ждёт X».
      const pendById = new Map<string, string>();
      try {
        const { data: pend } = await supabase.from('asset_handoffs').select('asset_id,to_name,note').eq('note', 'pending');
        for (const h of pend || []) pendById.set(String((h as any).asset_id), (h as any).to_name || '');
      } catch { /* no-op */ }
      const list = (data || []).map((a: any) => ({
        id: a.id, name: a.name, category: a.category || 'прочее',
        ownerName: a.owner_name || null, holderName: a.holder_name || null, holderId: a.holder_id || null,
        takenAt: a.taken_at || null, qty: a.qty || 1, isShared: !!a.is_shared,
        location: a.location || null, notes: a.notes || null,
        daysHeld: a.taken_at ? Math.floor((Date.now() - new Date(a.taken_at).getTime()) / 86400000) : null,
        pendingTo: pendById.get(String(a.id)) || null,
      }));
      return res.status(200).json({ assets: list });
    } catch (error) {
      // Таблицы может не быть до миграции — не роняем админку.
      return res.status(200).json({ assets: [], needsMigration: true });
    }
  }
  // Передача актива С ПОДТВЕРЖДЕНИЕМ: получателю прилетает кнопка «Принял».
  // Держатель меняется только после его подтверждения (см. assetok_ в webhook).
  if (req.method === 'POST' && req.query?.action === 'asset_transfer') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const assetId = String(body.assetId || '');
      const uname = String(body.username || '').replace(/^@/, '').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 32);
      if (!assetId || uname.length < 3) return res.status(400).json({ error: 'Нужен actив и @ник получателя' });
      const { data: asset } = await supabase.from('club_assets').select('name,holder_name,holder_id').eq('id', assetId).maybeSingle();
      if (!asset) return res.status(404).json({ error: 'Актив не найден' });
      const { data: rcpt } = await supabase.from('members').select('telegram_id,first_name,username').ilike('username', uname).maybeSingle();
      if (!rcpt || Number((rcpt as any).telegram_id) <= 0) return res.status(400).json({ error: `Участник @${uname} не найден (или без Telegram)` });
      const toId = Number((rcpt as any).telegram_id);
      const toName = (rcpt as any).first_name || ('@' + (rcpt as any).username);
      // Снимаем прежние pending по этому активу, чтобы не плодить.
      await supabase.from('asset_handoffs').update({ note: 'cancelled' }).eq('asset_id', assetId).eq('note', 'pending');
      const { data: hoff } = await supabase.from('asset_handoffs').insert({
        asset_id: assetId, from_name: (asset as any).holder_name || null, from_id: (asset as any).holder_id || null,
        to_id: toId, to_name: toName, note: 'pending',
      }).select('id').single();
      const hid = (hoff as any)?.id;
      if (BOT_TOKEN && hid) {
        const esc = (s: string) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: toId, parse_mode: 'HTML',
            text: `🎒 <b>Тебе передают снаряжение клуба</b>\n\n<b>${esc((asset as any).name)}</b>\nОт: ${esc((asset as any).holder_name || 'клуб')}\n\nПодтверди, что забрал и берёшь ответственность за хранение:`,
            reply_markup: { inline_keyboard: [[
              { text: '✅ Принял', callback_data: `assetok_${hid}` },
              { text: '❌ Не приму', callback_data: `assetno_${hid}` },
            ]] },
          }),
        });
      }
      return res.status(200).json({ ok: true, pendingTo: toName });
    } catch (error) {
      return res.status(500).json({ error: (error as Error).message });
    }
  }
  // ─── Учёт вещей из админки: завести вещь, выдать человеку с датой, принять обратно ──
  // «Отдал Анне манишку 20 октября» — записывается сразу (админ свидетель),
  // дата может быть задним числом; человеку приходит короткое уведомление.
  if (req.method === 'POST' && req.query?.action === 'asset_create') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const name = String(body.name || '').trim().slice(0, 80);
      if (name.length < 2) return res.status(400).json({ error: 'Нужно название вещи' });
      const qty = Math.max(1, Math.min(500, Number(body.qty) || 1));
      const id = 'ast-' + crypto.randomBytes(5).toString('hex');
      const owner = String(body.ownerName || 'Клуб FLINT').trim().slice(0, 60);
      const { error } = await supabase.from('club_assets').insert({
        id, name, qty, category: String(body.category || 'прочее').slice(0, 30),
        owner_name: owner, holder_name: owner, notes: body.notes ? String(body.notes).slice(0, 300) : null,
      });
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true, id });
    } catch (error) { return res.status(500).json({ error: (error as Error).message }); }
  }
  if (req.method === 'POST' && (req.query?.action === 'asset_give' || req.query?.action === 'asset_return')) {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const assetId = String(body.assetId || '');
      const { data: asset } = await supabase.from('club_assets').select('name,owner_name,holder_name,holder_id').eq('id', assetId).maybeSingle();
      if (!asset) return res.status(404).json({ error: 'Вещь не найдена' });
      const day = /^\d{4}-\d{2}-\d{2}$/.test(String(body.at || '')) ? String(body.at) : new Date().toISOString().slice(0, 10);
      const at = new Date(`${day}T12:00:00+03:00`);
      if (at.getTime() > Date.now() + 864e5) return res.status(400).json({ error: 'Дата выдачи не может быть в будущем' });
      const giving = req.query.action === 'asset_give';
      let toId: number | null = null;
      let toName: string;
      if (giving) {
        toId = Number(body.toId);
        const { data: m } = await supabase.from('members').select('telegram_id,first_name,username').eq('telegram_id', toId).maybeSingle();
        if (!m) return res.status(400).json({ error: 'Участник не найден' });
        toName = (m as any).first_name || ('@' + (m as any).username);
      } else {
        toName = (asset as any).owner_name || 'Клуб FLINT';
      }
      await supabase.from('asset_handoffs').update({ note: 'cancelled' }).eq('asset_id', assetId).eq('note', 'pending');
      await supabase.from('asset_handoffs').insert({
        asset_id: assetId, at: at.toISOString(),
        from_name: (asset as any).holder_name || null, from_id: (asset as any).holder_id || null,
        to_id: toId, to_name: toName, note: giving ? 'admin_give' : 'admin_return',
      });
      const { error } = await supabase.from('club_assets').update({
        holder_name: toName, holder_id: toId, taken_at: giving ? at.toISOString() : null, updated_at: new Date().toISOString(),
      }).eq('id', assetId);
      if (error) return res.status(500).json({ error: error.message });
      if (giving && body.notify !== false && BOT_TOKEN && toId && toId > 0) {
        const esc = (x: string) => String(x || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const d = at.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Europe/Minsk' });
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: toId, parse_mode: 'HTML',
            text: `🎒 За тобой записана вещь клуба: <b>${esc((asset as any).name)}</b> — с ${d}.\nБереги её и захвати, когда попросят 🙌` }),
        }).catch(() => null);
      }
      return res.status(200).json({ ok: true, holder: toName });
    } catch (error) { return res.status(500).json({ error: (error as Error).message }); }
  }
  // Правка инвентаря: держатель/владелец/заметка (+ таймстемп взятия при смене держателя).
  if (req.method === 'PATCH' && req.query?.action === 'asset') {
    try {
      const id = String(req.query.assetId || '');
      if (!id) return res.status(400).json({ error: 'Missing assetId' });
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (body.holderName !== undefined) { patch.holder_name = body.holderName || null; patch.taken_at = new Date().toISOString(); }
      if (body.ownerName !== undefined) patch.owner_name = body.ownerName || null;
      if (body.location !== undefined) patch.location = body.location || null;
      if (body.notes !== undefined) patch.notes = body.notes || null;
      const { error } = await supabase.from('club_assets').update(patch).eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    } catch (error) {
      return res.status(500).json({ error: (error as Error).message });
    }
  }

  /**
   * Разослать «Правила участника» тем, кто их ещё не принял.
   * Кодекс принимается при первой записи на событие, но 29 из 43 одобренных
   * членов до записи так и не дошли — правил они не видели. Организатору нужно
   * уметь послать их адресно и повторять, пока человек не нажмёт «Принимаю».
   */
  /**
   * ДОЖАТЬ АНКЕТУ УЧАСТНИКА: пол, дата рождения, телефон.
   *
   * В базе десятки людей без этих данных — регистрация их никогда не
   * требовала. Из-за этого клуб не знает, кто к нему ездит: нельзя отличить
   * мужской выезд от смешанного, нельзя поздравить с днём рождения, нельзя
   * подтвердить совершеннолетие на событии 18+ и некуда позвонить, если
   * человек не вышел на связь на маршруте.
   *
   * Спрашиваем по одному вопросу за раз (обработчик pfill в вебхуке): анкета
   * на три экрана в мессенджере не заполняется, её закрывают.
   */
  if (req.method === 'POST' && req.query?.action === 'ask_profile') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const ids = (Array.isArray(body.telegramIds) ? body.telegramIds : [])
        .map((v: unknown) => Number(v))
        .filter((id: number) => Number.isFinite(id) && id > 0);
      if (!ids.length) return res.status(400).json({ error: 'Не выбран ни один участник' });
      const BOT = process.env.TELEGRAM_BOT_TOKEN || '';
      if (!BOT) return res.status(200).json({ ok: false, error: 'TELEGRAM_BOT_TOKEN не задан' });

      const text =
        '📇 <b>Пара вопросов о тебе</b>\n\n' +
        'Клуб до сих пор не знает о тебе базовых вещей, и из-за этого:\n' +
        '• нельзя позвать тебя на выезд, где состав по полу;\n' +
        '• некому поздравить тебя с днём рождения;\n' +
        '• на событиях 18+ нечем подтвердить возраст;\n' +
        '• если ты не вышел на связь на маршруте — некуда позвонить.\n\n' +
        'Это три коротких вопроса, меньше минуты. ' +
        'Данные видит только костяк клуба и использует их ровно для этого — ' +
        'ни рекламы, ни передачи третьим лицам. Передумаешь — скажи, и мы их удалим.';

      let sent = 0;
      const failed: number[] = [];
      for (const id of ids) {
        try {
          const r = await fetch(`https://api.telegram.org/bot${BOT}/sendMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: id, parse_mode: 'HTML', text, disable_web_page_preview: true,
              reply_markup: { inline_keyboard: [[{ text: '📇 Ответить (минута)', callback_data: 'pfill' }]] },
            }),
          });
          const j = await r.json();
          if (j?.ok) sent++; else failed.push(id);
        } catch { failed.push(id); }
      }
      return res.status(200).json({ ok: sent > 0, sent, total: ids.length, failed: failed.length });
    } catch (error) {
      return res.status(500).json({ error: (error as Error).message });
    }
  }

  /**
   * ДОЖАТЬ «НЕ ПРОШЕДШИХ»: нажали «Старт» в боте, но анкету не заполнили и в
   * клуб не вступили. Пишем каждому лично, с кнопкой заявки. Статус
   * перепроверяем здесь, а не верим списку из админки, — принятому или
   * отклонённому такое письмо уйти не должно. Не чаще раза в 3 дня одному
   * человеку: напоминание, а не спам.
   */
  if (req.method === 'POST' && req.query?.action === 'nudge_unverified') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const ids = (Array.isArray(body.telegramIds) ? body.telegramIds : [])
        .map((v: unknown) => Number(v))
        .filter((id: number) => Number.isFinite(id) && id > 0);
      if (!ids.length) return res.status(400).json({ error: 'Не выбран ни один человек' });
      const BOT = process.env.TELEGRAM_BOT_TOKEN || '';
      if (!BOT) return res.status(200).json({ ok: false, error: 'TELEGRAM_BOT_TOKEN не задан' });

      const { data: rows } = await supabase.from('members')
        .select('telegram_id,first_name,status,is_core,referred_by,prefs').in('telegram_id', ids);
      const COOLDOWN = 3 * 864e5;
      const targets = (rows || []).filter((m: any) =>
        !m.is_core && !['approved', 'pending_review', 'blocked'].includes(String(m.status || 'pending')));
      const fresh = targets.filter((m: any) => {
        const t = Date.parse(m.prefs?.verify_nudged_at || '');
        return !(Number.isFinite(t) && Date.now() - t < COOLDOWN);
      });

      // Имена пригласивших — одним запросом: «тебя позвал Олег» работает лучше безличного письма.
      const invIds = [...new Set(fresh.map((m: any) => Number(m.referred_by)).filter((n: number) => n > 0))];
      const invName = new Map<number, string>();
      if (invIds.length) {
        const { data: invs } = await supabase.from('members').select('telegram_id,first_name').in('telegram_id', invIds);
        for (const i of invs || []) if ((i as any).first_name) invName.set(Number((i as any).telegram_id), String((i as any).first_name));
      }
      const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

      let sent = 0;
      const failed: number[] = [];
      for (const m of fresh as any[]) {
        const name = m.first_name ? `, ${esc(String(m.first_name))}` : '';
        const by = invName.get(Number(m.referred_by));
        const text =
          `👋 <b>Привет${name}!</b>\n\n` +
          (by ? `Тебя позвал в клуб <b>${esc(by)}</b>. ` : 'Ты заглядывал в бот клуба «Живи в моменте». ') +
          'Ты остановился в шаге от входа — анкета так и не дошла до костяка.\n\n' +
          'Это 2–3 минуты: кодекс клуба, пара слов о себе и данные для логистики. ' +
          'После этого костяк посмотрит заявку и ответит сюда.\n\n' +
          'Если передумал — просто не отвечай, больше не потревожим.';
        try {
          const r = await fetch(`https://api.telegram.org/bot${BOT}/sendMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: m.telegram_id, parse_mode: 'HTML', text, disable_web_page_preview: true,
              reply_markup: { inline_keyboard: [[{ text: '✅ Заполнить анкету', callback_data: 'verify_start' }]] },
            }),
          });
          const j = await r.json();
          if (j?.ok) {
            sent++;
            await supabase.from('members')
              .update({ prefs: { ...(m.prefs || {}), verify_nudged_at: new Date().toISOString() } })
              .eq('telegram_id', m.telegram_id);
          } else failed.push(m.telegram_id);
        } catch { failed.push(m.telegram_id); }
      }
      return res.status(200).json({
        ok: sent > 0, sent, total: ids.length,
        skipped: targets.length - fresh.length,   // писали меньше 3 дней назад
        notEligible: ids.length - targets.length, // уже приняты/на модерации/отклонены
        failed: failed.length,
      });
    } catch (error) {
      return res.status(500).json({ error: (error as Error).message });
    }
  }

  if (req.method === 'POST' && req.query?.action === 'send_rules') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const ids = (Array.isArray(body.telegramIds) ? body.telegramIds : [])
        .map((v: unknown) => Number(v))
        .filter((id: number) => Number.isFinite(id) && id > 0);
      if (!ids.length) return res.status(400).json({ error: 'Не выбран ни один участник' });
      const BOT = process.env.TELEGRAM_BOT_TOKEN || '';
      if (!BOT) return res.status(200).json({ ok: false, error: 'TELEGRAM_BOT_TOKEN не задан' });

      const text =
        '📜 <b>Правила участника FLINT</b>\n\n' +
        '<b>1. Философия круга.</b> Только живое общение, без масок. Приходим расти и отдавать.\n' +
        '<b>2. 100% трезвость.</b> Без алкоголя и любых веществ — до и во время встречи.\n' +
        '<b>3. Уважение и приватность.</b> Все равны. «Нет» уважается сразу. Сказанное в кругу остаётся в кругу.\n' +
        '<b>4. Программа события.</b> Её собирает организатор — соблюдаем время и порядок. Хочешь изменить — предложи, не меняй самовольно.\n' +
        '<b>5. Ответственность.</b> За своё здоровье, снаряжение и безопасность отвечаешь сам. Взял задачу — доводишь или заранее ищешь замену.\n' +
        '<b>6. Природа.</b> Убираем за собой полностью, огонь — только по правилам.\n' +
        '<b>7. Бади.</b> На событии у каждого есть напарник-бади: держит тебя в поле зрения и решает с тобой бытовые и спорные вопросы. Сломал чужое — возмещаешь сам; спор ведут бади сторон.\n' +
        '<b>8. Гости и деньги.</b> За гостя отвечаешь и платишь ты. Расходы делим честно и прозрачно. Несогласие обсуждаем с организатором напрямую, а не в кулуарах.\n' +
        '<b>9. Фото и видео.</b> Без согласия человека его снимки не публикуются.\n\n' +
        'Нажми кнопку — это и есть принятие правил. Без него запись на события закрыта.';

      let sent = 0;
      const failed: number[] = [];
      for (const id of ids) {
        try {
          const r = await fetch(`https://api.telegram.org/bot${BOT}/sendMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: id, parse_mode: 'HTML', text, disable_web_page_preview: true,
              reply_markup: { inline_keyboard: [
                [{ text: '✅ Принимаю правила', callback_data: 'rulesok' }],
                [{ text: '✍️ Задать вопрос', callback_data: 'usreply' }],
              ] },
            }),
          });
          const j = await r.json();
          if (j?.ok) sent++; else failed.push(id);
        } catch { failed.push(id); }
      }
      return res.status(200).json({ ok: sent > 0, sent, total: ids.length, failed: failed.length });
    } catch (error) {
      return res.status(500).json({ error: (error as Error).message });
    }
  }

  /**
   * Правка машины из админки: свободные места и точка старта.
   * Понадобилось после «Danil — 8980 своб. из 8980, старт: Mini Cooper серый»:
   * кривые данные из анкеты организатор мог поправить только через базу.
   * Места режем 0…8, чтобы через админку нельзя было завести ту же дичь.
   */
  if (req.method === 'PATCH' && req.query?.action === 'ride') {
    try {
      const id = Number(req.query.rideId || 0);
      if (!id) return res.status(400).json({ error: 'Missing rideId' });
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const patch: Record<string, unknown> = {};
      if (body.seatsTotal !== undefined) {
        patch.seats_total = Math.max(0, Math.min(8, Math.trunc(Number(body.seatsTotal) || 0)));
      }
      if (body.fromPoint !== undefined) patch.from_point = String(body.fromPoint || '').slice(0, 200);
      if (body.active !== undefined) patch.active = !!body.active;
      if (!Object.keys(patch).length) return res.status(400).json({ error: 'Нечего менять' });
      const { data, error } = await supabase.from('rides').update(patch).eq('id', id).select('*').maybeSingle();
      if (error) return res.status(500).json({ error: error.message });
      // Мест не может быть меньше, чем уже занято, — иначе счётчики врут.
      if (data && Number((data as any).seats_taken) > Number((data as any).seats_total)) {
        return res.status(200).json({ ok: true, warning: `Занято ${(data as any).seats_taken} мест — это больше нового лимита.` });
      }
      return res.status(200).json({ ok: true });
    } catch (error) {
      return res.status(500).json({ error: (error as Error).message });
    }
  }

  // ─── Переписка поддержки: лента «костяк ↔ участник» ────────────────────────
  // Список диалогов: по каждому собеседнику — последнее сообщение, счётчик,
  // сколько входящих без ответа. Имя тянем из members.
  if (req.method === 'GET' && req.query?.action === 'conversations') {
    try {
      const { data: msgs } = await supabase
        .from('support_messages')
        .select('telegram_id,direction,text,from_name,created_at')
        .order('created_at', { ascending: false })
        .limit(2000);
      const rows = msgs || [];
      const nameMap = new Map<string, { first_name?: string; username?: string }>();
      const ids = Array.from(new Set(rows.map((m: any) => Number(m.telegram_id))));
      if (ids.length) {
        const { data: mem } = await supabase
          .from('members').select('telegram_id,first_name,username').in('telegram_id', ids);
        for (const m of mem || []) nameMap.set(String((m as any).telegram_id), m as any);
      }
      const threads = new Map<string, any>();
      for (const m of rows) {
        const key = String(m.telegram_id);
        let t = threads.get(key);
        if (!t) {
          const nm = nameMap.get(key);
          t = {
            telegramId: key,
            firstName: nm?.first_name || null,
            username: nm?.username || null,
            lastText: m.text,
            lastDirection: m.direction,
            lastAt: m.created_at,
            count: 0,
            unanswered: 0,
          };
          threads.set(key, t);
        }
        t.count += 1;
      }
      // Непрочитанные: входящие, пришедшие после последнего исходящего.
      for (const [key, t] of threads) {
        const thread = rows.filter((m: any) => String(m.telegram_id) === key); // desc
        let unanswered = 0;
        for (const m of thread) {
          if (m.direction === 'out') break;
          unanswered += 1;
        }
        t.unanswered = unanswered;
      }
      const list = Array.from(threads.values())
        .sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());
      return res.status(200).json({ conversations: list });
    } catch (error) {
      return res.status(500).json({ error: (error as Error).message });
    }
  }

  // Полная лента одного собеседника (по возрастанию времени).
  if (req.method === 'GET' && req.query?.action === 'conversation') {
    try {
      const tid = Number(req.query.tid);
      if (!Number.isFinite(tid)) return res.status(400).json({ error: 'bad tid' });
      const { data: msgs } = await supabase
        .from('support_messages')
        .select('id,direction,text,from_name,created_at')
        .eq('telegram_id', tid)
        .order('created_at', { ascending: true })
        .limit(500);
      const { data: mem } = await supabase
        .from('members').select('first_name,username').eq('telegram_id', tid).maybeSingle();
      return res.status(200).json({
        telegramId: String(tid),
        firstName: (mem as any)?.first_name || null,
        username: (mem as any)?.username || null,
        messages: msgs || [],
      });
    } catch (error) {
      return res.status(500).json({ error: (error as Error).message });
    }
  }

  // Ответ участнику прямо из админки: шлём в бот + пишем в ленту.
  if (req.method === 'POST' && req.query?.action === 'reply') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const tid = Number(body.telegramId);
      const text = String(body.text || '').trim();
      if (!Number.isFinite(tid) || tid <= 0) return res.status(400).json({ error: 'Нужен реальный Telegram id' });
      if (!text) return res.status(400).json({ error: 'Пустой ответ' });
      if (!BOT_TOKEN) return res.status(200).json({ ok: false, error: 'TELEGRAM_BOT_TOKEN не задан' });
      const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: tid, parse_mode: 'HTML',
          text: `💬 <b>Ответ организатора:</b>\n\n${esc(text.slice(0, 2000))}`,
          // Без этой кнопки переписка односторонняя: участник получал ответ и
          // не мог ответить, не вспомнив про /start → «Написать в поддержку».
          reply_markup: { inline_keyboard: [[{ text: '✍️ Ответить', callback_data: 'usreply' }]] },
        }),
      });
      const tgj = await r.json().catch(() => ({ ok: false }));
      if (!tgj.ok) return res.status(200).json({ ok: false, error: 'Не доставлено — участник мог остановить бота' });
      await supabase.from('support_messages').insert({
        telegram_id: tid, direction: 'out', text: text.slice(0, 4000), from_name: 'Организатор (админка)',
      });
      return res.status(200).json({ ok: true });
    } catch (error) {
      return res.status(500).json({ error: (error as Error).message });
    }
  }

  /** Права участника: костяк, статус, роль. */
  if (req.method === 'PATCH' && req.query?.action === 'member') {
    try {
      const telegramId = Number(req.query.telegramId);
      if (!telegramId) return res.status(400).json({ error: 'Missing telegramId' });
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};

      const patch: Record<string, unknown> = {};
      if (body.isCore !== undefined) patch.is_core = !!body.isCore;
      if (body.status !== undefined) patch.status = body.status;
      if (body.role !== undefined) patch.role = body.role;
      if (body.gender !== undefined) patch.gender = body.gender === 'female' ? 'female' : body.gender === 'male' ? 'male' : null;
      // Ручная правка «от кого пришёл» (защита очков: ссылку могли переслать).
      if (body.referredBy !== undefined) patch.referred_by = body.referredBy ? Number(body.referredBy) : null;
      if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update' });

      const { error } = await supabase.from('members').update(patch).eq('telegram_id', telegramId);
      if (error) return res.status(500).json({ error: error.message });
      // Принят из админки — то же, что кнопка «Принять» в боте: кнопка приложения
      // и поздравление. Раньше человек, принятый здесь, ничего не узнавал.
      if (body.status === 'approved' && BOT_TOKEN && telegramId > 0) {
        const site = process.env.SITE_URL || 'https://flint-live-in-moment.vercel.app';
        const call = (method: string, payload: unknown) => fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        }).catch(() => null);
        await call('setChatMenuButton', { chat_id: telegramId, menu_button: { type: 'web_app', text: 'Приложение', web_app: { url: site } } });
        await call('sendMessage', {
          chat_id: telegramId, parse_mode: 'HTML',
          text: '🎉 <b>Тебя приняли в клуб!</b>\n\nАфиша, запись и логистика — в приложении.',
          reply_markup: { inline_keyboard: [[{ text: 'Открыть приложение', web_app: { url: site } }]] },
        });
      }
      // Блокировка = полная изоляция: отменяем активные регистрации (иначе
      // рассылки/напоминания бьют по registrations и доходят до заблокированного)
      // и убираем кнопку афиши из его бота.
      let groupKick: { groups: number; kicked: number; failed: string[] } | null = null;
      if (body.status === 'blocked') {
        try {
          await supabase.from('registrations').update({ status: 'cancelled' })
            .eq('telegram_id', telegramId).neq('status', 'cancelled');
        } catch { /* no-op */ }
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        if (botToken) {
          try {
            await fetch(`https://api.telegram.org/bot${botToken}/setChatMenuButton`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: telegramId, menu_button: { type: 'default' } }),
            });
          } catch { /* no-op */ }
        }
        // Последняя дыра в «бан = полная изоляция»: отменённые регистрации и
        // снятое меню не выкидывают человека из Telegram-ГРУПП событий — он
        // продолжал читать переписку и локации. Выкидываем из всех активных.
        groupKick = await setGroupBan(Number(telegramId), true);
      }
      // Разблокировка обязана снимать и бан в группах, иначе человек формально
      // в клубе, но вернуться в чаты не может — и это молча.
      if (body.status && body.status !== 'blocked') {
        groupKick = await setGroupBan(Number(telegramId), false);
      }
      return res.status(200).json({ success: true, groupKick });
    } catch (error) {
      return res.status(500).json({ error: (error as Error).message });
    }
  }

  if (req.method === 'GET') {
    // Получить регистрации для события
    try {
      const { eventId } = req.query;

      if (!eventId) {
        return res.status(400).json({ error: 'Missing eventId' });
      }

      // Получаем регистрации
      const { data: registrations, error } = await supabase
        .from('registrations')
        .select('*')
        .eq('event_id', eventId)
        .order('registered_at', { ascending: false });

      if (error) {
        slog('error', 'Registrations error', error);
        return res.status(500).json({ error: 'Failed to fetch registrations' });
      }

      /**
       * Обогащаем заявки профилем из members. Без этого организатор не мог
       * связаться с человеком: в registrations нет username (в карточке
       * показывался голый telegram_id вместо @ника), а имя в анкете часто
       * другое, чем в Telegram («Анастасия Ламковская» в заявке vs
       * «Анастасия @Stasla» в аудитории) — человека буквально не находили.
       * Телефон берём из заявки, а если там пусто — из профиля клуба.
       */
      const regIds = Array.from(new Set(
        (registrations || []).map((r: any) => Number(r.telegram_id)).filter((id: number) => Number.isFinite(id) && id > 0)
      ));
      const { data: regMembers } = regIds.length
        ? await supabase.from('members')
            .select('telegram_id,username,first_name,phone,gender,status,is_core,bot_active')
            .in('telegram_id', regIds)
        : { data: [] as any[] };
      const memberOf = new Map((regMembers || []).map((m: any) => [Number(m.telegram_id), m]));
      for (const r of registrations || []) {
        const m: any = memberOf.get(Number(r.telegram_id));
        if (!m) continue;
        (r as any).username = m.username || null;
        (r as any).member_name = m.first_name || null;
        (r as any).phone = r.phone || m.phone || null;
        (r as any).gender = (r as any).gender || m.gender || null;
        (r as any).member_status = m.status || null;
        (r as any).is_core = !!m.is_core;
        (r as any).bot_active = m.bot_active !== false;
      }

      // Получаем статистику
      const { data: statsData } = await supabase.rpc('get_event_stats', { event_id: eventId });

      const stats = statsData || {
        total: registrations.length,
        confirmed: registrations.filter(r => r.status === 'confirmed').length,
        pending: registrations.filter(r => r.status === 'pending').length,
        payments: registrations.filter(r => r.payment_status === 'paid').length,
        total_amount: registrations.reduce((sum, r) => sum + (r.payment_amount || 0), 0)
      };

      // Бэкфилл: водители из анкеты (has_transport) без строки в rides. Раньше
      // rides создавал только бот-флоу, поэтому веб-водители (напр. София с
      // авто и 2 местами) были невидимы. Самолечение при открытии события —
      // идемпотентно (создаём только если активной машины ещё нет).
      try {
        const drivers = (registrations || []).filter(
          (r: any) => r.has_transport && Number(r.transport_seats) > 0
        );
        if (drivers.length) {
          const { data: existingRides } = await supabase
            .from('rides').select('driver_id,kind').eq('event_id', eventId).eq('active', true);
          const carDrivers = new Set(
            (existingRides || []).filter((r: any) => r.kind !== 'tent').map((r: any) => String(r.driver_id))
          );
          const toCreate = drivers
            .filter((r: any) => !carDrivers.has(String(r.telegram_id)))
            .map((r: any) => ({
              event_id: eventId,
              driver_id: r.telegram_id,
              driver_name: r.name || r.first_name || 'Водитель',
              from_point: r.transport_details || 'по договорённости',
              seats_total: Number(r.transport_seats) || 0,
              kind: 'car',
              active: true,
            }));
          if (toCreate.length) await supabase.from('rides').insert(toCreate);
        }
      } catch { /* бэкфилл не критичен */ }

      // Живая логистика: машины (реальные брони + синхронизированные из анкет).
      const { data: rides } = await supabase
        .from('rides').select('*').eq('event_id', eventId).eq('active', true).order('created_at');

      const rideIds = (rides || []).map((r: any) => r.id);
      const { data: bookings } = rideIds.length
        ? await supabase.from('ride_bookings').select('*').in('ride_id', rideIds)
        : { data: [] as any[] };

      const { data: rideRequests } = await supabase
        .from('ride_requests').select('*').eq('event_id', eventId).eq('active', true);

      const { data: feedbackRaw } = await supabase
        .from('feedback').select('*').eq('event_id', eventId).order('created_at', { ascending: false });
      // Кто оставил отзыв: резолвим имя по members (в feedback только telegram_id).
      const fbIds = Array.from(new Set((feedbackRaw || []).map((f: any) => Number(f.telegram_id)).filter((id: number) => id > 0)));
      const { data: fbMembers } = fbIds.length
        ? await supabase.from('members').select('telegram_id,first_name,username').in('telegram_id', fbIds)
        : { data: [] as any[] };
      const nameOf = new Map((fbMembers || []).map((m: any) => [Number(m.telegram_id), m.first_name || (m.username ? '@' + m.username : `id${m.telegram_id}`)]));
      const feedback = (feedbackRaw || []).map((f: any) => ({ ...f, author_name: nameOf.get(Number(f.telegram_id)) || `id${f.telegram_id}` }));

      const { count: interestCount } = await supabase
        .from('interests').select('id', { count: 'exact', head: true }).eq('event_id', eventId);

      const { data: programVotes } = await supabase
        .from('program_votes').select('option').eq('event_id', eventId);

      const voteTally: Record<string, number> = {};
      for (const v of programVotes || []) {
        const opt = (v as any).option;
        voteTally[opt] = (voteTally[opt] || 0) + 1;
      }

      const withPax = (rides || []).map((r: any) => ({
        ...r,
        passengers: (bookings || []).filter((b: any) => b.ride_id === r.id),
      }));
      // Палатки живут в той же таблице rides (kind='tent') — разделяем для админки.
      const ridesWithPax = withPax.filter((r: any) => r.kind !== 'tent');
      const tentsWithPax = withPax.filter((r: any) => r.kind === 'tent');

      return res.status(200).json({
        registrations: registrations || [],
        stats,
        rides: ridesWithPax,
        tents: tentsWithPax,
        rideRequests: rideRequests || [],
        feedback: feedback || [],
        interestCount: interestCount || 0,
        voteTally,
      });
    } catch (error) {
      slog('error', 'Error', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  if (req.method === 'DELETE' && req.query?.action === 'member') {
    // Полное удаление пользователя: сброс статуса, чтобы мог заново зарегистрироваться
    try {
      const telegramId = Number(req.query.telegramId);
      if (!telegramId) return res.status(400).json({ error: 'Missing telegramId' });

      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const reason = String(body.reason || '').trim();

      // Если указана причина — отправляем сообщение пользователю перед удалением
      if (reason) {
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        if (botToken) {
          try {
            const msg = `❌ <b>Вы были удалены из клуба «Живи в моменте»</b>\n\nПричина: ${reason}\n\nЕсли хотите подать заявку заново — напишите в бота.`;
            await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: telegramId, text: msg, parse_mode: 'HTML' }),
            });
          } catch {}
        }
      }

      // Удаляем связанные данные, затем САМУ запись участника. Раньше здесь был
      // лишь сброс в status='pending' с обнулением имени — из-за этого «удалённый»
      // висел призраком «Без имени», счётчики не менялись (жалоба владельца).
      await supabase.from('registrations').delete().eq('telegram_id', telegramId);
      await supabase.from('referrals').delete().or(`inviter_id.eq.${telegramId},invited_id.eq.${telegramId}`);
      await supabase.from('program_votes').delete().eq('telegram_id', telegramId);
      await supabase.from('feedback').delete().eq('telegram_id', telegramId);
      await supabase.from('interests').delete().eq('telegram_id', telegramId);
      await supabase.from('bot_sessions').delete().eq('telegram_id', telegramId);
      try { await supabase.from('support_messages').delete().eq('telegram_id', telegramId); } catch { /* таблицы может не быть */ }
      // Чужой referred_by, указывавший на удалённого, обнуляем — иначе повиснет
      // ссылка на несуществующего пригласителя.
      await supabase.from('members').update({ referred_by: null }).eq('referred_by', telegramId);

      const { error: delError } = await supabase.from('members').delete().eq('telegram_id', telegramId);
      if (delError) {
        return res.status(500).json({ error: delError.message });
      }

      return res.status(200).json({ success: true, deleted: true, notified: !!reason });
    } catch (error) {
      return res.status(500).json({ error: (error as Error).message });
    }
  }

  if (req.method === 'DELETE') {
    // Удалить регистрацию
    try {
      const { registrationId } = req.query;

      if (!registrationId) {
        return res.status(400).json({ error: 'Missing registrationId' });
      }

      // Получаем event_id перед удалением
      const { data: reg, error: fetchError } = await supabase
        .from('registrations')
        .select('event_id')
        .eq('id', registrationId)
        .single();

      if (fetchError || !reg) {
        slog('error', 'Registration not found', fetchError);
        return res.status(404).json({ error: 'Registration not found' });
      }

      // Удаляем регистрацию
      const { error } = await supabase
        .from('registrations')
        .delete()
        .eq('id', registrationId);

      if (error) {
        slog('error', 'Registration delete error', error);
        return res.status(500).json({ error: 'Failed to delete registration' });
      }

      // Уменьшаем счётчик участников
      await supabase.rpc('decrement_participants', { event_id: reg.event_id });

      return res.status(200).json({ success: true });
    } catch (error) {
      slog('error', 'Error', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  if (req.method === 'PATCH') {
    // Обновить статус регистрации
    try {
      const { registrationId } = req.query;
      const { status, paymentStatus, paymentAmount, attended, hasTransport, transportSeats, transportDetails, guestCount } = req.body;

      if (!registrationId) {
        return res.status(400).json({ error: 'Missing registrationId' });
      }

      // Текущее состояние — чтобы поймать переход «не был» → «был» (для баллов).
      const { data: before } = await supabase
        .from('registrations')
        .select('status,attended,telegram_id,event_id')
        .eq('id', registrationId)
        .single();

      const updateData: any = {};
      if (status) updateData.status = status;
      if (paymentStatus) updateData.payment_status = paymentStatus;
      if (paymentAmount !== undefined) updateData.payment_amount = paymentAmount;
      if (attended !== undefined) updateData.attended = !!attended;
      // Транспорт и гости: админ правит руками, когда участник заполнил не всё
      // (или сообщил детали голосом/в чате). Марка+цвет — в transport_details.
      if (hasTransport !== undefined) updateData.has_transport = hasTransport === null ? null : !!hasTransport;
      if (transportSeats !== undefined) updateData.transport_seats = Number(transportSeats) || 0;
      if (transportDetails !== undefined) updateData.transport_details = String(transportDetails || '').slice(0, 200) || null;
      if (guestCount !== undefined) updateData.guest_count = Math.max(0, Math.min(50, Number(guestCount) || 0));

      const { data: registration, error } = await supabase
        .from('registrations')
        .update(updateData)
        .eq('id', registrationId)
        .select()
        .single();

      if (error) {
        slog('error', 'Registration update error', error);
        return res.status(500).json({ error: 'Failed to update registration' });
      }

      // Баллы — ТОЛЬКО за достижение: человек реально пришёл и админ это отметил.
      // Регистрация и подтверждение статуса баллов не дают (PLAN.md §5.3).
      if (attended === true && before && before.attended !== true && before.telegram_id) {
        const memberId = Number(before.telegram_id);
        const { data: evT } = await supabase.from('events').select('title').eq('id', before.event_id).maybeSingle();
        await bumpPoints(memberId, POINTS_ATTEND, 'attend', `Участие: ${(evT as any)?.title || 'событие'}`, before.event_id);
        try {
          // Первое посещённое событие участника → награда пригласившему.
          const { count } = await supabase
            .from('registrations')
            .select('id', { count: 'exact', head: true })
            .eq('telegram_id', memberId)
            .eq('attended', true)
            .neq('id', registrationId);
          if (!count) {
            const { data: m } = await supabase.from('members').select('referred_by').eq('telegram_id', memberId).maybeSingle();
            const inviter = (m as any)?.referred_by;
            if (inviter) {
              const { data: newbie } = await supabase.from('members').select('first_name,username').eq('telegram_id', memberId).maybeSingle();
              await bumpPoints(Number(inviter), POINTS_REFERRAL, 'referral',
                `Привёл друга: ${(newbie as any)?.first_name || ((newbie as any)?.username ? '@' + (newbie as any).username : 'новый участник')} побывал на первом событии`, before.event_id);
              await supabase.from('referrals').update({ rewarded: true }).eq('invited_id', memberId).eq('inviter_id', inviter);
            }
          }
        } catch { /* реф-награда best-effort */ }
      }

      return res.status(200).json({ success: true, registration });
    } catch (error) {
      slog('error', 'Error', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}