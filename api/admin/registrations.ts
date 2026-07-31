import { createClient } from '@supabase/supabase-js';
import * as crypto from 'crypto';
import { setGroupBan as banInEventGroups } from '../_lib/group-ban';


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

/** Бан/разбан в группах событий — общий хелпер (см. api/_lib/group-ban.ts). */
async function setGroupBan(telegramId: number, ban: boolean) {
  const r = await banInEventGroups(supabase, BOT_TOKEN, telegramId, ban);
  if (r.failed.length) slog('warn', `group ${ban ? 'ban' : 'unban'}: часть групп не отработала`, { failed: r.failed });
  return r;
}

/** Начисление баллов участнику (read+update, без RPC). Best-effort. */
async function bumpPoints(tgId: number, n: number) {
  try {
    const { data } = await supabase.from('members').select('points').eq('telegram_id', tgId).maybeSingle();
    const cur = (data as any)?.points || 0;
    await supabase.from('members').update({ points: cur + n }).eq('telegram_id', tgId);
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

export default async function handler(req: any, res: any) {
  if (!isAdmin(req)) return deny(res);

  /**
   * Аудитория клуба: кто есть, кто активен в боте, кто кого привёл,
   * сколько событий реально посетил. Основа для статистики результативности.
   */
  if (req.method === 'GET' && req.query?.action === 'members') {
    try {
      const { data: membersRaw } = await supabase
        .from('members')
        .select('telegram_id,username,first_name,status,is_core,role,referred_by,points,bot_active,last_seen_at,created_at,phone,gender,dietary,prefs')
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

      const list = (members || []).map((m: any) => ({
        telegramId: String(m.telegram_id),
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
        dietary: m.dietary || null,
        mediaConsent: m.prefs?.media_consent
          ? (m.prefs.media_consent.agreed ? 'yes' : 'no')
          : 'unknown',
        rulesAccepted: m.prefs?.rules_accepted?.at || null,
        botActive: m.bot_active !== false,
        lastSeenAt: m.last_seen_at,
        createdAt: m.created_at,
        // Веб-заявки без Telegram имеют отрицательный хеш вместо id.
        realTelegram: Number(m.telegram_id) > 0,
        attendedCount: attendedBy.get(String(m.telegram_id)) || 0,
        registeredCount: regsBy.get(String(m.telegram_id)) || 0,
        invitedCount: invitedBy.get(String(m.telegram_id)) || 0,
      }));

      const reachable = list.filter((m) => m.realTelegram && m.botActive).length;
      return res.status(200).json({
        members: list,
        summary: {
          total: list.length,
          approved: list.filter((m) => m.status === 'approved').length,
          core: list.filter((m) => m.isCore).length,
          reachable,
          blocked: list.filter((m) => m.realTelegram && !m.botActive).length,
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
        .select('status,attended,telegram_id')
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
        await bumpPoints(memberId, POINTS_ATTEND);
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
              await bumpPoints(Number(inviter), POINTS_REFERRAL);
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