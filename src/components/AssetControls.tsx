import React, { useMemo, useState } from 'react';
import { Plus, ArrowRightLeft, Undo2 } from 'lucide-react';
import Avatar from './Avatar';

/**
 * Учёт вещей клуба в админке: «отдал Анне манишку 20 октября».
 * Выдача записывается сразу (админ — свидетель), дату можно поставить задним числом,
 * человек выбирается из списка по фото, а не вводом @ника.
 */
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
type Msg = (m: { ok: boolean; text: string }) => void;
const today = () => new Date().toISOString().slice(0, 10);

async function post(adminFetch: Fetch, action: string, body: unknown) {
  const r = await adminFetch(`/api/admin/registrations?action=${action}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

export function AssetAdd({ adminFetch, onDone, onMsg }: { adminFetch: Fetch; onDone: () => void; onMsg: Msg }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-dashed border-white/20 text-white/70 hover:text-white hover:border-white/40 py-3 text-xs font-bold">
        <Plus className="w-4 h-4" /> Новая вещь
      </button>
    );
  }
  return (
    <div className="rounded-xl bg-white/5 border border-white/10 p-3 flex flex-wrap gap-2 items-center">
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Манишка FLINT, палатка…"
        className="flex-1 min-w-[160px] bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
      <input type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value) || 1)}
        className="w-16 bg-black/40 border border-white/10 rounded-lg px-2 py-2 text-sm text-white" aria-label="Количество" />
      <button type="button" disabled={busy || name.trim().length < 2}
        onClick={async () => {
          setBusy(true);
          try { await post(adminFetch, 'asset_create', { name, qty }); onMsg({ ok: true, text: `«${name}» добавлено` }); setName(''); setQty(1); setOpen(false); onDone(); }
          catch (e) { onMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
        }}
        className="rounded-lg bg-brand text-black text-xs font-bold px-3 py-2 disabled:opacity-40">Добавить</button>
    </div>
  );
}

export function AssetGive({ asset, members, adminFetch, onDone, onMsg }: {
  asset: any; members: any[] | undefined; adminFetch: Fetch; onDone: () => void; onMsg: Msg;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [who, setWho] = useState<any>(null);
  const [at, setAt] = useState(today());
  const [busy, setBusy] = useState(false);
  const atOwner = !asset.holderName || asset.holderName === asset.ownerName;
  const found = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s || !members) return [];
    return members.filter((m) => m.status === 'approved' || m.isCore)
      .filter((m) => `${m.firstName || ''} ${m.username || ''}`.toLowerCase().includes(s)).slice(0, 6);
  }, [q, members]);

  const give = async () => {
    setBusy(true);
    try {
      await post(adminFetch, 'asset_give', { assetId: asset.id, toId: Number(who.telegramId), at });
      onMsg({ ok: true, text: `${asset.name} → ${who.firstName || '@' + who.username} с ${new Date(at).toLocaleDateString('ru-RU')}` });
      setOpen(false); setWho(null); setQ(''); onDone();
    } catch (e) { onMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  };
  const giveBack = async () => {
    if (!window.confirm(`${asset.holderName} вернул(а) «${asset.name}»?`)) return;
    setBusy(true);
    try { await post(adminFetch, 'asset_return', { assetId: asset.id }); onMsg({ ok: true, text: `«${asset.name}» снова у владельца` }); onDone(); }
    catch (e) { onMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  };

  return (
    <div className="mt-2 space-y-2">
      <div className="flex gap-2">
        <button type="button" onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 text-[11px] px-3 py-2 rounded-lg font-bold bg-brand/15 text-brand hover:bg-brand/25">
          <ArrowRightLeft className="w-3.5 h-3.5" /> Выдать
        </button>
        {!atOwner && (
          <button type="button" disabled={busy} onClick={giveBack}
            className="inline-flex items-center gap-1.5 text-[11px] px-3 py-2 rounded-lg font-bold bg-white/5 text-white/70 hover:bg-white/10 disabled:opacity-40">
            <Undo2 className="w-3.5 h-3.5" /> Вернул
          </button>
        )}
      </div>
      {open && (
        <div className="rounded-xl bg-black/40 border border-white/10 p-3 space-y-2">
          {!who ? (
            <>
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Кому: имя или @ник"
                className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
              {found.map((m) => (
                <button key={m.telegramId} type="button" onClick={() => setWho(m)}
                  className="w-full flex items-center gap-2 rounded-lg hover:bg-white/5 p-1.5 text-left">
                  <Avatar name={m.firstName || m.username || '?'} src={m.avatar} size={32} />
                  <span className="text-sm text-white">{m.firstName}</span>
                  {m.username && <span className="text-[11px] text-white/40">@{m.username}</span>}
                </button>
              ))}
              {!members && <p className="text-[11px] text-white/40">Загружаю участников…</p>}
            </>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Avatar name={who.firstName || who.username || '?'} src={who.avatar} size={32} />
              <span className="text-sm text-white flex-1">{who.firstName}</span>
              <label className="text-[11px] text-white/50">с
                <input type="date" value={at} max={today()} onChange={(e) => setAt(e.target.value)}
                  className="ml-2 bg-black/40 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white" />
              </label>
              <button type="button" disabled={busy} onClick={give}
                className="rounded-lg bg-brand text-black text-xs font-bold px-3 py-2 disabled:opacity-40">Записать</button>
              <button type="button" onClick={() => setWho(null)} className="text-[11px] text-white/50 underline">другой человек</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
