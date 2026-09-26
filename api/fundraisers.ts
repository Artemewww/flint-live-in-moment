import { createClient } from '@supabase/supabase-js';
import * as crypto from 'crypto';

const db = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const ADMIN_SECRET = process.env.ADMIN_TOKEN || '';

// Свежесть подписи: без auth_date перехваченная initData годна вечно (replay).
// Окно 24ч — как в events.ts / register.ts / profile.ts / admin/events.ts.
const INITDATA_MAX_AGE_SEC = 24 * 60 * 60;

function verifyInitData(raw: string): { id: number } | null {
  try {
    if (!raw || !BOT_TOKEN) return null;
    const p = new URLSearchParams(raw); const hash = p.get('hash'); if (!hash) return null; p.delete('hash');
    const data = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    const expected = crypto.createHmac('sha256', secret).update(data).digest('hex');
    const a = Buffer.from(expected), b = Buffer.from(hash);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const authDate = Number(p.get('auth_date') || 0);
    if (!authDate || (Date.now() / 1000 - authDate) > INITDATA_MAX_AGE_SEC) return null;
    const u = JSON.parse(p.get('user') || '{}'); return u?.id ? { id: Number(u.id) } : null;
  } catch { return null; }
}
function admin(req: any): boolean {
  const token = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '');
  if (!ADMIN_SECRET) return false;
  const validSession = (value: string): boolean => {
    const [exp, mac] = String(value).split('.');
    if (!exp || !mac || Number(exp) <= Date.now()) return false;
    const expected = crypto.createHmac('sha256', ADMIN_SECRET).update(exp).digest('hex');
    return mac.length === expected.length && crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
  };
  if (token === ADMIN_SECRET || validSession(token)) return true;
  const cookie = String(req.headers?.cookie || '').split(';').map((x: string) => x.trim()).find((x: string) => x.startsWith('flint_admin='));
  if (cookie) {
    const value = decodeURIComponent(cookie.slice('flint_admin='.length));
    return validSession(value);
  }
  return false;
}
function escHtml(v: any): string { return clean(v, 2000).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function clean(v: any, max = 5000): string { return String(v ?? '').trim().slice(0, max); }

/**
 * Аватарка участника — та же подписанная ссылка на прокси, что в api/events.ts
 * (avatarSig там же; подпись задублирована намеренно — api/_lib/ роняет функции).
 */
function avatarUrl(id: number): string {
  if (!(id > 0) || !BOT_TOKEN) return '';
  const s = crypto.createHmac('sha256', BOT_TOKEN).update(`avatar:${id}`).digest('hex').slice(0, 16);
  return `/api/events?action=avatar&u=${id}&s=${s}`;
}

/**
 * ГОТОВЫЕ СУММЫ, как в переводах банка: человек не придумывает число, а
 * тапает. Сначала — суммы, которые люди уже реально скидывали (так видно
 * «сколько принято»), потом — круглые под размер цели.
 */
function amountOptions(goal: number, pledges: any[]): number[] {
  const base = goal <= 300 ? [5, 10, 20, 50] : goal <= 2000 ? [10, 25, 50, 100] : [20, 50, 100, 200];
  const freq = new Map<number, number>();
  for (const p of pledges) {
    if (p.status === 'rejected') continue;
    const a = Math.round(Number(p.amount));
    if (a > 0) freq.set(a, (freq.get(a) || 0) + 1);
  }
  const popular = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 2).map(([a]) => a);
  return [...new Set([...popular, ...base])].sort((a, b) => a - b).slice(0, 5);
}

/** Имя для уведомления: так, как человек записан в клубе. */
async function memberName(id: number): Promise<{ name: string; username: string }> {
  const { data } = await db.from('members').select('name,first_name,username').eq('telegram_id', id).maybeSingle();
  return { name: String((data as any)?.name || (data as any)?.first_name || (data as any)?.username || `id ${id}`), username: String((data as any)?.username || '') };
}

async function tgSend(chatId: number, text: string, reply_markup?: any): Promise<boolean> {
  if (!BOT_TOKEN || !(chatId > 0)) return false;
  try {
    const j = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...(reply_markup ? { reply_markup } : {}) }),
    }).then((r) => r.json());
    return j?.ok === true;
  } catch { return false; }
}

/** Ключ Gemini: сначала app_config (его меняют из панели без редеплоя), иначе env. */
async function geminiKey(): Promise<string> {
  let key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.API_KEY || '';
  try {
    const { data } = await db.from('app_config').select('value').eq('key', 'gemini_api_key').maybeSingle();
    if ((data as any)?.value) key = (data as any).value;
  } catch { /* таблицы нет — работаем на env */ }
  return key;
}
function shape(row: any, pledges: any[] = []) {
  const confirmed = pledges.filter((p) => p.status === 'confirmed');
  return { ...row, goalAmount: Number(row.goal_amount), deadline: row.deadline,
    recipientName: row.recipient_name, paymentCard: row.payment_card, paymentNote: row.payment_note,
    organizerName: row.organizer_name || '', costBreakdown: row.cost_breakdown || '',
    legalNote: row.legal_note || '', reportNote: row.report_note || '', reportUrl: row.report_url || '',
    imageUrl: row.image_url || '', imageCaption: row.image_caption || '',
    createdBy: row.created_by ? Number(row.created_by) : null,
    pointsPer100: Number(row.points_per_100), confirmedAmount: confirmed.reduce((s, p) => s + Number(p.amount), 0),
    confirmedCount: confirmed.length, pledges: pledges.map((p) => ({ ...p, amount: Number(p.amount) })) };
}

/**
 * «ДЕНЕЖКА ПРИЛЕТЕЛА».
 * Раньше организатор узнавал о вкладе, только если сам заходил в админку и
 * листал список. Теперь ему приходит сообщение в Telegram — кто, сколько, с
 * каким комментарием — и две кнопки: «✅ Деньги пришли» / «❌ Не пришли».
 * Кнопки обрабатывает бот (api/telegram/webhook.ts, fpok_/fpno_).
 * Организатор — fundraisers.created_by; не назначен — пишем костяку.
 */
async function notifyOrganizer(fundId: string, pledge: any, fromId: number, updated: boolean) {
  const { data: f } = await db.from('fundraisers').select('title,created_by,goal_amount').eq('id', fundId).maybeSingle();
  if (!f) return;
  let targets: number[] = [];
  if (Number((f as any).created_by) > 0) targets = [Number((f as any).created_by)];
  else {
    const { data: core } = await db.from('members').select('telegram_id,is_core,role,bot_active').or('is_core.eq.true,role.eq.owner');
    targets = (core || []).filter((m: any) => m.bot_active !== false).map((m: any) => Number(m.telegram_id)).filter((id: number) => id > 0);
  }
  if (!targets.length) return;
  const who = await memberName(fromId);
  const { data: all } = await db.from('fundraiser_pledges').select('amount,status').eq('fundraiser_id', fundId);
  const confirmed = (all || []).filter((p: any) => p.status === 'confirmed').reduce((s: number, p: any) => s + Number(p.amount), 0);
  const whoHtml = who.username ? `<a href="https://t.me/${escHtml(who.username)}">${escHtml(who.name)}</a>` : `<b>${escHtml(who.name)}</b>`;
  const text =
    `💸 ${updated ? 'Вклад изменён' : 'Новый вклад'} в сбор «<b>${escHtml((f as any).title)}</b>»\n\n` +
    `${whoHtml} — <b>${Math.round(Number(pledge.amount))} BYN</b>` +
    (pledge.note ? `\n«${escHtml(pledge.note)}»` : '') +
    `\n\nПодтверждено сейчас: ${Math.round(confirmed)} из ${Math.round(Number((f as any).goal_amount))} BYN.\n` +
    `Проверь поступление и отметь — после подтверждения вклад попадёт в собранное и принесёт баллы.`;
  const kb = { inline_keyboard: [[
    { text: '✅ Деньги пришли', callback_data: `fpok_${pledge.id}` },
    { text: '❌ Не пришли', callback_data: `fpno_${pledge.id}` },
  ]] };
  await Promise.all(targets.slice(0, 10).map((id) => tgSend(id, text, kb)));
}

export default async function handler(req: any, res: any) {
  try {
    const action = String(req.query?.action || 'public');
    if (req.method === 'GET' && action === 'admin') {
      if (!admin(req)) return res.status(401).json({ error: 'Unauthorized' });
      const { data, error } = await db.from('fundraisers').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      const ids = (data || []).map((x: any) => x.id);
      const { data: ps } = ids.length ? await db.from('fundraiser_pledges').select('*').in('fundraiser_id', ids).order('created_at', { ascending: false }) : { data: [] };
      return res.json({ fundraisers: (data || []).map((x: any) => shape(x, (ps || []).filter((p: any) => p.fundraiser_id === x.id))) });
    }
    if (req.method === 'GET' && action === 'audience') {
      if (!admin(req)) return res.status(401).json({ error: 'Unauthorized' });
      const { data, error } = await db.from('members').select('telegram_id,name,username,status,is_core,role,bot_active').order('name', { ascending: true });
      if (error) throw error;
      return res.json({ members: (data || []).filter((m: any) => Number(m.telegram_id) > 0 && m.bot_active !== false).map((m: any) => ({
        id: Number(m.telegram_id), name: m.name || m.username || `Участник ${m.telegram_id}`,
        username: m.username || '', status: m.status || '', isCore: m.is_core === true || ['owner', 'organizer'].includes(m.role),
        avatar: avatarUrl(Number(m.telegram_id)),
      })) });
    }
    if (req.method === 'GET') {
      const slug = clean(req.query?.slug || req.query?.id, 120);
      const query = db.from('fundraisers').select('*').eq('status', 'published');
      const { data, error } = slug
        ? await query.eq('slug', slug).maybeSingle()
        : await query.order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (error) throw error; if (!data) return res.status(404).json({ error: 'Not found' });
      const { data: ps } = await db.from('fundraiser_pledges').select('amount,status,telegram_id,created_at').eq('fundraiser_id', data.id).order('created_at', { ascending: false });
      const rows = ps || [];
      // Кружки поддержавших: только подтверждённые, последние сверху. Имя — лишь
      // первое (для буквы, если фото скрыто); суммы по людям публично не светим.
      const confirmedIds = [...new Set(rows.filter((p: any) => p.status === 'confirmed').map((p: any) => Number(p.telegram_id)))].slice(0, 12);
      const { data: mem } = confirmedIds.length ? await db.from('members').select('telegram_id,first_name').in('telegram_id', confirmedIds) : { data: [] };
      const firstName = new Map((mem || []).map((m: any) => [Number(m.telegram_id), String(m.first_name || '')]));
      const supporters = confirmedIds.map((id) => ({ name: firstName.get(id) || '•', avatar: avatarUrl(id) }));
      // Публичной странице не нужны telegram_id вкладчиков — shape получает только суммы.
      const fund = shape(data, rows.map((p: any) => ({ amount: p.amount, status: p.status })));
      return res.json({ fundraiser: { ...fund, pledges: undefined, supporters, amountOptions: amountOptions(fund.goalAmount, rows) } });
    }
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    if (action === 'pledge') {
      const user = verifyInitData(body.initData); if (!user) return res.status(401).json({ error: 'Открой страницу из Telegram' });
      const slug = clean(body.slug, 120); const amount = Number(body.amount);
      if (!slug || !Number.isFinite(amount) || amount <= 0 || amount > 100000) return res.status(400).json({ error: 'Некорректная сумма' });
      const { data: f } = await db.from('fundraisers').select('id,deadline,status').eq('slug', slug).maybeSingle();
      if (!f || f.status !== 'published' || String(f.deadline) < new Date().toISOString().slice(0, 10)) return res.status(400).json({ error: 'Сбор завершён' });
      const { data: existing } = await db.from('fundraiser_pledges').select('id,status,amount').eq('fundraiser_id', f.id).eq('telegram_id', user.id).eq('status', 'pending').maybeSingle();
      const query = existing
        ? db.from('fundraiser_pledges').update({ amount, note: clean(body.note, 300) }).eq('id', existing.id)
        : db.from('fundraiser_pledges').insert({ fundraiser_id: f.id, telegram_id: user.id, amount, note: clean(body.note, 300), status: 'pending' });
      const { data, error } = await query.select().single();
      if (error) throw error;
      // Пишем организатору о новом вкладе или изменённой сумме — повторное
      // нажатие с той же суммой не должно слать ему дубль.
      if (!existing || Number((existing as any).amount) !== amount) {
        await notifyOrganizer(f.id, data, user.id, !!existing).catch((e) => console.error('[fundraisers] notify failed:', e));
      }
      return res.json({ ok: true, pledge: data });
    }
    if (!admin(req)) return res.status(401).json({ error: 'Unauthorized' });
    /**
     * СБОР ОДНИМ СООБЩЕНИЕМ.
     * Форма из десятка полей («slug», «paymentNote», «costBreakdown»…) не
     * заполнялась: организатор держит сбор в голове одной историей. Теперь он
     * пишет её как есть — «собираем на манишки к Bison Race, 600 BYN до 10
     * октября, карта Альфы 4255…, получатель Артём» — а поля раскладывает ИИ.
     * Результат не сохраняется сам: организатор видит его и правит.
     */
    if (action === 'ai_parse') {
      const text = clean(body.text, 6000);
      if (text.length < 10) return res.status(400).json({ error: 'Опиши сбор хотя бы парой предложений' });
      const key = await geminiKey();
      if (!key) return res.status(200).json({ ok: false, error: 'Ключ Gemini не задан. Вставь его в панели «🔑 ИИ-ключ».' });
      const today = new Date().toISOString().slice(0, 10);
      const prompt =
        `Ты помогаешь организатору клуба FLINT (Беларусь, валюта BYN) оформить командный денежный сбор.\n` +
        `Сегодня ${today}. Разбери текст организатора и верни СТРОГО JSON со полями:\n` +
        `title — короткое цепкое название (до 60 символов);\n` +
        `summary — 1–2 предложения: на что и зачем;\n` +
        `story — живой текст для участников (3–8 предложений, от лица команды, без канцелярита, без выдуманных фактов);\n` +
        `goalAmount — число, цель в BYN (0, если не указана);\n` +
        `deadline — дата YYYY-MM-DD (если не указана — через 14 дней от сегодня; «до пятницы» и т.п. переведи в дату);\n` +
        `recipientName — кто получает деньги;\n` +
        `paymentCard — номер карты / счёт / телефон для перевода, как в тексте;\n` +
        `paymentNote — что написать в назначении перевода (если есть);\n` +
        `costBreakdown — из чего складывается сумма, построчно «позиция — сумма» (если есть данные);\n` +
        `slug — латиницей через дефис, 2–5 слов, для ссылки;\n` +
        `imagePrompt — одна фраза, что изобразить на обложке (без текста на картинке).\n` +
        `Нет данных для поля — пустая строка. Ничего не придумывай про суммы, карты и людей.\n\n` +
        `Текст организатора:\n"""${text}"""`;
      const models = [process.env.GEMINI_MODEL, 'gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-2.5-flash'].filter(Boolean) as string[];
      let parsed: any = null; let lastErr = '';
      for (const model of models) {
        try {
          const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.4 } }),
          });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) { lastErr = String(j?.error?.message || `HTTP ${r.status}`); continue; }
          const out = (j?.candidates?.[0]?.content?.parts || []).map((p: any) => p?.text || '').join('');
          parsed = JSON.parse(out.replace(/^```(?:json)?\s*|\s*```$/g, ''));
          if (parsed && typeof parsed === 'object') break;
        } catch (e: any) { lastErr = e?.message || 'parse'; parsed = null; }
      }
      if (!parsed) return res.status(200).json({ ok: false, error: `ИИ не ответил: ${lastErr || 'неизвестная ошибка'}. Попробуй ещё раз или заполни поля вручную.` });
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(parsed.deadline || '')) ? String(parsed.deadline) : new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
      const slug = clean(parsed.slug, 60).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || `sbor-${Date.now().toString(36)}`;
      return res.json({ ok: true, fields: {
        title: clean(parsed.title, 180), summary: clean(parsed.summary, 500), story: clean(parsed.story, 12000),
        goalAmount: Math.max(0, Math.round(Number(parsed.goalAmount) || 0)), deadline: date,
        recipientName: clean(parsed.recipientName, 180), paymentCard: clean(parsed.paymentCard, 80),
        paymentNote: clean(parsed.paymentNote, 500), costBreakdown: clean(parsed.costBreakdown, 4000), slug,
      }, imagePrompt: clean(parsed.imagePrompt, 400) });
    }
    if (action === 'save') {
      const f = body.fundraiser || {}; const payload: any = { slug: clean(f.slug, 120).toLowerCase().replace(/[^a-z0-9-_]+/g, '-'), title: clean(f.title, 180), summary: clean(f.summary, 500), story: clean(f.story, 12000), goal_amount: Number(f.goalAmount) || 0, deadline: clean(f.deadline, 10), recipient_name: clean(f.recipientName, 180), payment_card: clean(f.paymentCard, 80), payment_note: clean(f.paymentNote, 500), points_per_100: Number(f.pointsPer100) || 1, status: ['draft','review','published','closed'].includes(f.status) ? f.status : 'draft',
        organizer_name: clean(f.organizerName, 180), cost_breakdown: clean(f.costBreakdown, 4000),
        legal_note: clean(f.legalNote, 4000), report_note: clean(f.reportNote, 4000), report_url: clean(f.reportUrl, 400),
        image_url: clean(f.imageUrl, 500), image_caption: clean(f.imageCaption, 500),
        // Организатор — ему в Telegram приходят уведомления о вкладах. Колонка
        // created_by есть с первой миграции сборов, новая не нужна.
        created_by: Number(f.createdBy) > 0 ? Number(f.createdBy) : null };
      if (!payload.slug || !payload.title || !payload.deadline || payload.goal_amount <= 0) return res.status(400).json({ error: 'Заполни название, slug, цель и дедлайн' });
      const { data, error } = await db.from('fundraisers').upsert(f.id ? { ...payload, id: f.id } : payload).select().single();
      if (error) {
        // Схема может быть без новых полей (миграции 2026-09-15-fundraisers-legal.sql
        // и 2026-09-15-fundraisers-image.sql ещё не применены) — сохраняем основные
        // данные, а не роняем весь сбор.
        const { cost_breakdown, legal_note, report_note, report_url, organizer_name, image_url, image_caption, ...core } = payload;
        if (!/column|schema cache/i.test(String(error.message))) throw error;
        console.warn('[fundraisers] новые поля недоступны, сохраняем базовый набор:', error.message);
        const retry = await db.from('fundraisers').upsert(f.id ? { ...core, id: f.id } : core).select().single();
        if (retry.error) throw retry.error;
        return res.json({ ok: true, fundraiser: shape(retry.data), legalFieldsMissing: true });
      }
      return res.json({ ok: true, fundraiser: shape(data) });
    }
    if (action === 'pledge_status') {
      const status = ['pending','confirmed','rejected'].includes(body.status) ? body.status : null; if (!status || !body.pledgeId) return res.status(400).json({ error: 'Некорректный статус' });
      const { data: p } = await db.from('fundraiser_pledges').select('telegram_id,amount,fundraiser_id,status').eq('id', body.pledgeId).single(); if (!p) return res.status(404).json({ error: 'Вклад не найден' });
      if (p.status === status) return res.json({ ok: true, unchanged: true });
      const { error } = await db.from('fundraiser_pledges').update({ status, confirmed_at: status === 'confirmed' ? new Date().toISOString() : null }).eq('id', body.pledgeId); if (error) throw error;
      let awarded = 0;
      if (status === 'confirmed') {
        const { data: f } = await db.from('fundraisers').select('points_per_100').eq('id', p.fundraiser_id).single();
        const { data: m } = await db.from('members').select('points').eq('telegram_id', p.telegram_id).maybeSingle();
        awarded = Math.max(1, Math.round(Number(p.amount) * Number(f?.points_per_100 || 1)));
        if (m) {
          const { error: pointsError } = await db.from('members').update({ points: Number(m.points || 0) + awarded }).eq('telegram_id', p.telegram_id);
          if (pointsError) console.error('[fundraisers] points update failed:', pointsError.message);
        }
        // Журнал необязателен: таблица points_log может отсутствовать до применения миграции.
        const { error: logError } = await db.from('points_log').insert({ telegram_id: p.telegram_id, event_id: null, reason: 'fundraiser', points: awarded, description: 'Подтверждённый вклад в командный сбор' });
        if (logError) console.error('[fundraisers] points_log skipped:', logError.message);
      } else if (p.status === 'confirmed') {
        // Откат: вклад подтвердили, баллы начислили, потом решение отменили.
        // Без этого участник оставлял бы баллы за отклонённый вклад.
        const { data: f } = await db.from('fundraisers').select('points_per_100').eq('id', p.fundraiser_id).single();
        const { data: m } = await db.from('members').select('points').eq('telegram_id', p.telegram_id).maybeSingle();
        awarded = -Math.max(1, Math.round(Number(p.amount) * Number(f?.points_per_100 || 1)));
        if (m) {
          const next = Math.max(0, Number(m.points || 0) + awarded);
          const { error: pointsError } = await db.from('members').update({ points: next }).eq('telegram_id', p.telegram_id);
          if (pointsError) console.error('[fundraisers] points rollback failed:', pointsError.message);
        }
        const { error: logError } = await db.from('points_log').insert({ telegram_id: p.telegram_id, event_id: null, reason: 'fundraiser-rollback', points: awarded, description: 'Отменён подтверждённый вклад в сбор' });
        if (logError) console.error('[fundraisers] points_log skipped:', logError.message);
      }
      return res.json({ ok: true, points: awarded });
    }
    /**
     * УДАЛЕНИЕ ВКЛАДА.
     * В админке вкладов вообще не было видно: подтвердить, отклонить или
     * убрать чужую запись было нечем, хотя pledge_status уже умел всё,
     * кроме удаления. Ошибочную или фейковую запись надо уметь стирать.
     * Подтверждённый вклад перед удалением откатывает баллы — иначе человек
     * оставался бы с баллами за вклад, которого больше нет.
     */
    if (action === 'pledge_delete') {
      if (!admin(req)) return res.status(401).json({ error: 'Unauthorized' });
      if (!body.pledgeId) return res.status(400).json({ error: 'Не указан вклад' });
      const { data: p } = await db.from('fundraiser_pledges')
        .select('telegram_id,amount,fundraiser_id,status').eq('id', body.pledgeId).single();
      if (!p) return res.status(404).json({ error: 'Вклад не найден' });
      if (p.status === 'confirmed') {
        const { data: f } = await db.from('fundraisers').select('points_per_100').eq('id', p.fundraiser_id).single();
        const { data: m } = await db.from('members').select('points').eq('telegram_id', p.telegram_id).maybeSingle();
        const back = Math.max(1, Math.round(Number(p.amount) * Number(f?.points_per_100 || 1)));
        if (m) {
          const { error: pe } = await db.from('members')
            .update({ points: Math.max(0, Number(m.points || 0) - back) }).eq('telegram_id', p.telegram_id);
          if (pe) console.error('[fundraisers] points rollback failed:', pe.message);
        }
      }
      const { error } = await db.from('fundraiser_pledges').delete().eq('id', body.pledgeId);
      if (error) throw error;
      return res.json({ ok: true });
    }

    /**
     * УДАЛЕНИЕ СБОРА.
     * Черновик или сбор, который никто не поддержал, стирается целиком.
     * А вот сбор с ПОДТВЕРЖДЁННЫМИ вкладами удалить нельзя: люди отдали
     * деньги, и запись об этом — их гарантия, а не мусор в базе. Такой сбор
     * закрывается статусом «Завершён», отчёт остаётся на странице.
     */
    if (action === 'delete') {
      if (!admin(req)) return res.status(401).json({ error: 'Unauthorized' });
      if (!body.id) return res.status(400).json({ error: 'Не указан сбор' });
      const { data: ps } = await db.from('fundraiser_pledges').select('id,status').eq('fundraiser_id', body.id);
      const confirmed = (ps || []).filter((x: any) => x.status === 'confirmed').length;
      if (confirmed > 0) {
        return res.status(400).json({
          error: `Сбор нельзя удалить: ${confirmed} подтверждённых вклад(ов). Люди отдали деньги, и запись об этом — их гарантия. Закрой сбор статусом «Завершён».`,
        });
      }
      await db.from('fundraiser_pledges').delete().eq('fundraiser_id', body.id);
      const { error } = await db.from('fundraisers').delete().eq('id', body.id);
      if (error) throw error;
      return res.json({ ok: true });
    }

    if (action === 'broadcast') {
      const { data: f } = await db.from('fundraisers').select('title,summary,slug,status').eq('id', body.id).eq('status', 'published').single(); if (!f) return res.status(404).json({ error: 'Разослать можно только опубликованный сбор' });
      // Реальная рассылка идёт по базе, поэтому по умолчанию — ТОЛЬКО костяк
      // (is_core / role owner-organizer), а не все approved: сбор — внутренняя
      // история костяка, и уведомлять о нём весь клуб не нужно.
      // Явное { audience: 'all' } рассылает всем одобрённым, как в admin/broadcast.
      const audience = ['none', 'core', 'all', 'selected'].includes(body.audience) ? body.audience : 'core';
      if (audience === 'none') return res.json({ ok: true, sent: 0, total: 0, skipped: true });
      const toAll = audience === 'all';
      const selectedIds = new Set((Array.isArray(body.memberIds) ? body.memberIds : []).map(Number).filter((id: number) => id > 0));
      const { data: pool } = await db
        .from('members')
        .select('telegram_id,status,is_core,role,bot_active')
        .eq('bot_active', true);
      const ids = (pool || [])
        .filter((m: any) => Number(m.telegram_id) > 0)
        .filter((m: any) => audience === 'selected' ? selectedIds.has(Number(m.telegram_id)) : (toAll ? m.status === 'approved' : (m.is_core === true || m.role === 'owner' || m.role === 'organizer')))
        .map((m: any) => Number(m.telegram_id));
      if (body.confirm !== true) {
        return res.json({ ok: true, dryRun: true, audience, wouldSend: ids.length, hint: 'Повторите с confirm:true, чтобы разослать' });
      }
      const site = `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
      const text = `🔥 <b>${escHtml(f.title)}</b>\n\n${escHtml(f.summary)}\n\n<a href="${site}/?fund=${encodeURIComponent(f.slug)}">Открыть сбор и поддержать</a>`;

      // Telegram держит ~30 сообщений/сек на бота: шлём пачками по 20, чтобы
      // не собирать 429 и не терять часть участников при большой базе.
      const sendOne = (chatId: number) => fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: false }) })
        .then((r) => r.json()).then((j) => ({ chatId, ok: j?.ok === true, code: j?.error_code, desc: j?.description })).catch(() => ({ chatId, ok: false, code: 0, desc: 'network' }));

      const results: any[] = [];
      for (let i = 0; i < ids.length; i += 20) {
        results.push(...await Promise.all(ids.slice(i, i + 20).map(sendOne)));
        if (i + 20 < ids.length) await new Promise((r) => setTimeout(r, 1100));
      }

      const sent = results.filter((r) => r.ok).length;
      // Кто заблокировал бота — помечаем, чтобы он не попадал в следующие рассылки.
      const blocked = results.filter((r) => !r.ok && (r.code === 403 || /blocked|deactivated/i.test(String(r.desc || '')))).map((r) => r.chatId);
      if (blocked.length) await db.from('members').update({ bot_active: false }).in('telegram_id', blocked);

      return res.json({ ok: sent > 0, sent, total: ids.length, blocked: blocked.length, failed: results.length - sent - blocked.length });
    }
    if (action === 'upload_image') {
      // Картинка сбора: фронт присылает dataURL (большие файлы уже сжаты на клиенте),
      // сервер кладёт файл в публичный бакет event-images — как обложки событий в admin/events.ts.
      const dataUrl = String(body.dataUrl || '');
      const m = /^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
      if (!m) return res.status(400).json({ error: 'Ожидалась картинка PNG/JPEG/WebP' });
      const bin = Buffer.from(m[2], 'base64');
      if (bin.length < 1024) return res.status(400).json({ error: 'Файл пустой или повреждён' });
      // Лимит Vercel на тело запроса ~4.5 МБ — клиент сжимает заранее, здесь только страховка.
      if (bin.length > 4_000_000) return res.status(400).json({ error: 'Файл больше 4 МБ — выбери поменьше' });
      const slug = clean(body.slug, 120).toLowerCase().replace(/[^a-z0-9-_]+/g, '-') || 'fundraiser';
      const ext = m[1] === 'image/png' ? 'png' : /jpe?g/.test(m[1]) ? 'jpg' : 'webp';
      const path = `fundraisers/${slug}-${Date.now().toString(36)}.${ext}`;
      const up = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/event-images/${path}`, {
        method: 'POST',
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY || ''}`,
          'Content-Type': m[1],
          'x-upsert': 'true',
        },
        body: bin,
      });
      if (!up.ok) {
        const t = await up.text().catch(() => '');
        console.error('[fundraisers] storage upload failed:', t.slice(0, 200));
        return res.status(500).json({ error: 'Не удалось сохранить картинку в хранилище' });
      }
      const url = `${process.env.SUPABASE_URL}/storage/v1/object/public/event-images/${path}`;
      return res.json({ ok: true, url, bytes: bin.length });
    }
    return res.status(400).json({ error: 'Unknown action' });
  } catch (e: any) { console.error('[fundraisers]', e); return res.status(500).json({ error: 'Internal server error' }); }
}