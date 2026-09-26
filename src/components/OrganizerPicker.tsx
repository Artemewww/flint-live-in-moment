import React, { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import Avatar from './Avatar';

export type ClubMember = { telegramId: string; firstName?: string; username?: string; isCore?: boolean; role?: string; status?: string; avatar?: string };

let cache: ClubMember[] | null = null;
/** Аудитория клуба с фото — одна загрузка на всю админку. */
export async function loadClubMembers(): Promise<ClubMember[]> {
  if (cache) return cache;
  let token = '';
  try { token = localStorage.getItem('flint_admin_token') || ''; } catch { /* приватный режим */ }
  const r = await fetch('/api/admin/registrations?action=members', {
    credentials: 'include', headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  cache = (j.members || j.list || []).filter((m: ClubMember) => Number(m.telegramId) > 0);
  return cache!;
}

export const memberLabel = (m?: ClubMember | null) => (m ? (m.firstName || (m.username ? `@${m.username}` : `id ${m.telegramId}`)) : '');

/**
 * Выбор организатора — по лицам, а не по id.
 * Раньше «заместителя» выбирали из выпадающего списка имён среди записавшихся,
 * и в админке светился голый telegram_id. Теперь — весь клуб, с фото из
 * Telegram и поиском; костяк и организаторы сверху.
 */
export default function OrganizerPicker({
  value, onChange, required = true, label = 'Организатор',
}: {
  value?: number | null;
  onChange: (id: number, member: ClubMember) => void;
  required?: boolean;
  label?: string;
}) {
  const [members, setMembers] = useState<ClubMember[]>(cache || []);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { loadClubMembers().then(setMembers).catch((e) => setError(`Не загрузился список людей: ${e.message}`)); }, []);
  const selected = members.find((m) => Number(m.telegramId) === Number(value));
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rank = (m: ClubMember) => (m.isCore ? 0 : ['owner', 'organizer'].includes(m.role || '') ? 1 : m.status === 'approved' ? 2 : 3);
    return members
      .filter((m) => !needle || `${m.firstName || ''} ${m.username || ''}`.toLowerCase().includes(needle))
      .sort((a, b) => rank(a) - rank(b) || memberLabel(a).localeCompare(memberLabel(b)));
  }, [members, q]);
  const missing = required && !value;
  return (
    <div className="space-y-1.5">
      <span className="block text-[10px] font-mono uppercase text-white/40">{label}{required && ' *'}</span>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`flex w-full items-center gap-3 rounded-xl border p-2.5 text-left text-white ${missing ? 'border-rose-400/50 bg-rose-500/10' : 'border-white/10 bg-white/5'}`}
      >
        {selected ? <Avatar name={memberLabel(selected)} src={selected.avatar} size={40} ring={selected.isCore ? 'brand' : 'none'} /> : <Avatar name="?" size={40} />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold">{selected ? memberLabel(selected) : value ? `id ${value}` : 'Не выбран'}</span>
          <span className={`block truncate text-[11px] ${missing ? 'text-rose-300' : 'text-white/45'}`}>
            {missing ? 'Без организатора событие не создаётся' : selected?.username ? `@${selected.username}` : 'Отвечает за событие'}
          </span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-white/40" />
      </button>
      {open && (
        <div className="fixed inset-0 z-[95] flex items-end justify-center bg-black/80 sm:items-center" onClick={() => setOpen(false)}>
          <div className="flex max-h-[80vh] w-full max-w-md flex-col rounded-t-3xl border border-white/10 bg-[#141414] sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 pb-2">
              <b className="text-white">Кто отвечает за событие</b>
              <button type="button" onClick={() => setOpen(false)} className="rounded-full border-0 bg-white/10 p-1.5 text-white"><X className="h-4 w-4" /></button>
            </div>
            <label className="mx-4 mb-2 flex items-center gap-2 rounded-xl bg-white/5 px-3">
              <Search className="h-4 w-4 text-white/40" />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Имя или @ник" className="w-full border-0 bg-transparent py-2.5 text-sm text-white outline-none" />
            </label>
            {error && <p className="px-4 text-xs text-rose-300">{error}</p>}
            <div className="flex-1 overflow-y-auto px-2 pb-4">
              {list.map((m) => {
                const on = Number(m.telegramId) === Number(value);
                return (
                  <button key={m.telegramId} type="button" onClick={() => { onChange(Number(m.telegramId), m); setOpen(false); }}
                    className={`flex w-full items-center gap-3 rounded-2xl border-0 p-2 text-left text-white ${on ? 'bg-brand/10' : 'bg-transparent hover:bg-white/5'}`}>
                    <Avatar name={memberLabel(m)} src={m.avatar} size={40} ring={m.isCore ? 'brand' : 'none'} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold">{memberLabel(m)}</span>
                      <span className="block truncate text-[11px] text-white/45">{[m.username && `@${m.username}`, m.isCore && 'костяк', m.role === 'organizer' && 'организатор'].filter(Boolean).join(' · ') || 'участник'}</span>
                    </span>
                    {on && <Check className="h-4 w-4 text-brand" />}
                  </button>
                );
              })}
              {!list.length && !error && <p className="p-4 text-center text-xs text-white/40">{members.length ? 'Никого не нашли' : 'Загружаю…'}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
