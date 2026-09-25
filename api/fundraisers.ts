import { createClient } from '@supabase/supabase-js';
import * as crypto from 'crypto';

const db = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const ADMIN_SECRET = process.env.ADMIN_TOKEN || '';

function verifyInitData(raw: string): { id: number } | null {
  try {
    if (!raw || !BOT_TOKEN) return null;
    const p = new URLSearchParams(raw); const hash = p.get('hash'); if (!hash) return null; p.delete('hash');
    const data = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    const expected = crypto.createHmac('sha256', secret).update(data).digest('hex');
    const a = Buffer.from(expected), b = Buffer.from(hash);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
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
function shape(row: any, pledges: any[] = []) {
  const confirmed = pledges.filter((p) => p.status === 'confirmed');
  return { ...row, goalAmount: Number(row.goal_amount), deadline: row.deadline,
    recipientName: row.recipient_name, paymentCard: row.payment_card, paymentNote: row.payment_note,
    organizerName: row.organizer_name || '', costBreakdown: row.cost_breakdown || '',
    legalNote: row.legal_note || '', reportNote: row.report_note || '', reportUrl: row.report_url || '',
    imageUrl: row.image_url || '', imageCaption: row.image_caption || '',
    pointsPer100: Number(row.points_per_100), confirmedAmount: confirmed.reduce((s, p) => s + Number(p.amount), 0),
    confirmedCount: confirmed.length, pledges: pledges.map((p) => ({ ...p, amount: Number(p.amount) })) };
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
      })) });
    }
    if (req.method === 'GET') {
      const slug = clean(req.query?.slug || req.query?.id, 120);
      const query = db.from('fundraisers').select('*').eq('status', 'published');
      const { data, error } = slug
        ? await query.eq('slug', slug).maybeSingle()
        : await query.order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (error) throw error; if (!data) return res.status(404).json({ error: 'Not found' });
      const { data: ps } = await db.from('fundraiser_pledges').select('amount,status').eq('fundraiser_id', data.id);
      return res.json({ fundraiser: shape(data, ps || []) });
    }
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    if (action === 'pledge') {
      const user = verifyInitData(body.initData); if (!user) return res.status(401).json({ error: 'Открой страницу из Telegram' });
      const slug = clean(body.slug, 120); const amount = Number(body.amount);
      if (!slug || !Number.isFinite(amount) || amount <= 0 || amount > 100000) return res.status(400).json({ error: 'Некорректная сумма' });
      const { data: f } = await db.from('fundraisers').select('id,deadline,status').eq('slug', slug).maybeSingle();
      if (!f || f.status !== 'published' || String(f.deadline) < new Date().toISOString().slice(0, 10)) return res.status(400).json({ error: 'Сбор завершён' });
      const { data: existing } = await db.from('fundraiser_pledges').select('id,status').eq('fundraiser_id', f.id).eq('telegram_id', user.id).eq('status', 'pending').maybeSingle();
      const query = existing
        ? db.from('fundraiser_pledges').update({ amount, note: clean(body.note, 300) }).eq('id', existing.id)
        : db.from('fundraiser_pledges').insert({ fundraiser_id: f.id, telegram_id: user.id, amount, note: clean(body.note, 300), status: 'pending' });
      const { data, error } = await query.select().single();
      if (error) throw error; return res.json({ ok: true, pledge: data });
    }
    if (!admin(req)) return res.status(401).json({ error: 'Unauthorized' });
    if (action === 'save') {
      const f = body.fundraiser || {}; const payload: any = { slug: clean(f.slug, 120).toLowerCase().replace(/[^a-z0-9-_]+/g, '-'), title: clean(f.title, 180), summary: clean(f.summary, 500), story: clean(f.story, 12000), goal_amount: Number(f.goalAmount) || 0, deadline: clean(f.deadline, 10), recipient_name: clean(f.recipientName, 180), payment_card: clean(f.paymentCard, 80), payment_note: clean(f.paymentNote, 500), points_per_100: Number(f.pointsPer100) || 1, status: ['draft','review','published','closed'].includes(f.status) ? f.status : 'draft',
        organizer_name: clean(f.organizerName, 180), cost_breakdown: clean(f.costBreakdown, 4000),
        legal_note: clean(f.legalNote, 4000), report_note: clean(f.reportNote, 4000), report_url: clean(f.reportUrl, 400),
        image_url: clean(f.imageUrl, 500), image_caption: clean(f.imageCaption, 500) };
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