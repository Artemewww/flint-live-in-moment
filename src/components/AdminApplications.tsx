import React, { useState } from 'react';
import { Check, X, BellRing } from 'lucide-react';
import Avatar from './Avatar';

/**
 * Заявки в клуб — первым блоком админки.
 * Раньше заполненная анкета (status = pending_review) терялась среди всех,
 * кто просто нажал «Старт» в боте, и костяк не видел, что его ждут.
 * Здесь: кто ждёт решения (с фото, телефоном и «зачем в клуб») и кнопки в один тап;
 * ниже — сколько людей открыли бота, но анкету не заполнили, и мягкое напоминание.
 */
type Member = {
  telegramId: string; firstName?: string; username?: string; phone?: string | null; avatar?: string;
  status: string; isCore?: boolean; referredByName?: string | null; joinReason?: string | null;
  appliedAt?: string | null; createdAt?: string; botActive?: boolean;
};

const ago = (iso?: string | null) => {
  if (!iso) return '';
  const h = Math.round((Date.now() - new Date(iso).getTime()) / 36e5);
  if (h < 1) return 'только что';
  if (h < 24) return `${h} ч назад`;
  const d = Math.round(h / 24);
  return `${d} дн назад`;
};

export default function AdminApplications({ members, adminFetch, onChanged, onMsg }: {
  members: Member[] | undefined;
  adminFetch: (url: string, init?: RequestInit) => Promise<Response>;
  onChanged: () => Promise<void> | void;
  onMsg: (m: { ok: boolean; text: string }) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  if (!members) return null;
  const waiting = members
    .filter((m) => m.status === 'pending_review')
    .sort((a, b) => String(b.appliedAt || b.createdAt).localeCompare(String(a.appliedAt || a.createdAt)));
  const noForm = members.filter((m) => m.status === 'pending' && !m.isCore && Number(m.telegramId) > 0 && m.botActive !== false);
  if (!waiting.length && !noForm.length) return null;

  const decide = async (m: Member, status: 'approved' | 'blocked') => {
    if (status === 'blocked' && !window.confirm(`Отклонить заявку ${m.firstName || m.username}?`)) return;
    setBusy(m.telegramId);
    try {
      const r = await adminFetch(`/api/admin/registrations?action=member&telegramId=${m.telegramId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      onMsg({ ok: true, text: status === 'approved' ? `${m.firstName || 'Участник'} принят — бот уже написал ему` : 'Заявка отклонена' });
      await onChanged();
    } catch (e) {
      onMsg({ ok: false, text: `Не получилось: ${(e as Error).message}` });
    } finally { setBusy(null); }
  };

  const nudge = async () => {
    if (!window.confirm(`Напомнить ${noForm.length} людям заполнить анкету? Каждому — не чаще раза в 3 дня.`)) return;
    setBusy('nudge');
    try {
      const r = await adminFetch('/api/admin/registrations?action=nudge_unverified', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegramIds: noForm.map((m) => m.telegramId) }),
      });
      const j = await r.json().catch(() => ({}));
      onMsg({ ok: r.ok && j.ok !== false, text: j.error || (r.ok ? `Напомнили: ${j.sent ?? 0}. Пропущено (писали недавно): ${j.skipped ?? 0}` : `HTTP ${r.status}`) });
    } finally { setBusy(null); }
  };

  return (
    <div className="rounded-2xl border border-brand/40 bg-brand/[0.06] p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-mono uppercase text-brand">Заявки в клуб</span>
        {waiting.length > 0 && <span className="text-[11px] font-bold text-black bg-brand rounded-full px-2 py-0.5">{waiting.length}</span>}
      </div>

      {waiting.map((m) => (
        <div key={m.telegramId} className="rounded-xl bg-black/40 border border-white/10 p-3 space-y-2">
          <div className="flex items-center gap-3">
            <Avatar name={m.firstName || m.username || '?'} src={m.avatar} size={44} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold text-white truncate">{m.firstName || 'Без имени'}</div>
              <div className="text-[11px] text-white/50 truncate">
                {m.username ? <a href={`https://t.me/${m.username}`} target="_blank" rel="noreferrer" className="text-white/70 underline">@{m.username}</a> : 'без ника'}
                {m.phone ? ` · ${m.phone}` : ''} · {ago(m.appliedAt || m.createdAt)}
              </div>
            </div>
          </div>
          {m.joinReason && <p className="text-xs text-white/80 leading-snug">«{m.joinReason}»</p>}
          {m.referredByName && <p className="text-[11px] text-white/50">Пригласил: {m.referredByName}</p>}
          <div className="flex gap-2">
            <button type="button" disabled={busy === m.telegramId} onClick={() => decide(m, 'approved')}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand text-black text-xs font-bold py-2.5 disabled:opacity-50">
              <Check className="w-4 h-4" /> Принять
            </button>
            <button type="button" disabled={busy === m.telegramId} onClick={() => decide(m, 'blocked')}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-white/5 text-white/70 text-xs font-bold px-3 py-2.5 disabled:opacity-50">
              <X className="w-4 h-4" /> Отклонить
            </button>
          </div>
        </div>
      ))}

      {noForm.length > 0 && (
        <div className="flex items-center justify-between gap-2 text-[11px] text-white/60">
          <span>{noForm.length} открыли бота, но не заполнили анкету</span>
          <button type="button" disabled={busy === 'nudge'} onClick={nudge}
            className="inline-flex items-center gap-1 rounded-lg bg-white/5 hover:bg-white/10 text-white/80 px-2 py-1.5 disabled:opacity-50">
            <BellRing className="w-3.5 h-3.5" /> Напомнить
          </button>
        </div>
      )}
    </div>
  );
}
