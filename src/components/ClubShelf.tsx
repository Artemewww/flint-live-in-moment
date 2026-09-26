import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, Loader2, Plus, Search, Trash2, X } from 'lucide-react';
import { getInitData, haptic } from '../telegram';
import Avatar, { AvatarStack } from './Avatar';

type Person = { id: number | null; name: string; username?: string; avatar?: string };
type ClubItem = {
  id: string; title: string; kind: 'club' | 'shared' | 'personal'; qty: number;
  holder?: Person | null; owner?: Person | null; holderId?: number | null; ownerId?: number | null;
  contributors?: { name: string; tgId?: number | null; amount?: number | null; paid?: boolean; avatar?: string }[];
  note?: string | null; returned?: boolean; mine?: boolean;
};

const KIND: Record<string, { label: string; cls: string }> = {
  club: { label: 'клубное', cls: 'bg-brand/15 text-brand' },
  shared: { label: 'складчина', cls: 'bg-emerald-500/15 text-emerald-300' },
  personal: { label: 'личное · передали', cls: 'bg-sky-500/15 text-sky-300' },
};

async function call(action: string, extra: Record<string, any> = {}) {
  const r = await fetch('/api/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, initData: getInitData(), ...extra }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

function PersonLine({ label, p }: { label: string; p?: Person | null }) {
  if (!p) return null;
  const inner = <><Avatar name={p.name} src={p.avatar} size={22} /><span className="truncate">{p.name}</span></>;
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span className="w-20 shrink-0 text-white/40">{label}</span>
      {p.username
        ? <a href={`https://t.me/${p.username}`} target="_blank" rel="noopener noreferrer" className="flex min-w-0 items-center gap-1.5 text-white/85 no-underline">{inner}</a>
        : <span className="flex min-w-0 items-center gap-1.5 text-white/85">{inner}</span>}
    </div>
  );
}

function ItemCard({ it, onEdit }: { it: ClubItem; onEdit: () => void }) {
  const k = KIND[it.kind] || KIND.club;
  const contrib = it.contributors || [];
  const total = contrib.reduce((s, c) => s + (Number(c.amount) || 0), 0);
  return (
    <button type="button" onClick={onEdit} className={`w-full space-y-2.5 rounded-2xl border p-3.5 text-left text-white ${it.mine ? 'border-brand/35 bg-brand/[.05]' : 'border-white/10 bg-white/[.03]'}`}>
      <div className="flex items-start justify-between gap-2">
        <b className="text-[14px] leading-snug">{it.title}{it.qty > 1 ? <span className="text-white/45"> ×{it.qty}</span> : null}</b>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${k.cls}`}>{k.label}</span>
      </div>
      <div className="space-y-1.5">
        <PersonLine label="Сейчас у" p={it.holder} />
        {it.owner && it.owner.id !== it.holder?.id && <PersonLine label="Чья" p={it.owner} />}
      </div>
      {contrib.length > 0 && (
        <div className="flex items-center gap-2 border-t border-white/5 pt-2">
          <AvatarStack people={contrib.map((c) => ({ name: c.name, avatar: c.avatar }))} size={22} max={5} />
          <span className="min-w-0 truncate text-[11px] text-white/55">
            Вложились: {contrib.map((c) => `${c.name}${c.amount ? ` ${c.amount}` : ''}`).join(', ')}{total ? ` · всего ${Math.round(total * 100) / 100} BYN` : ''}
          </span>
        </div>
      )}
      {it.note && <p className="text-[11px] text-white/45">{it.note}</p>}
    </button>
  );
}

function PeoplePick({ people, value, onChange, placeholder }: { people: Person[]; value: number | null; onChange: (id: number | null) => void; placeholder: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const sel = people.find((p) => p.id === value);
  const list = people.filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase())).slice(0, 60);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-2.5 text-left text-sm text-white">
        {sel ? <><Avatar name={sel.name} src={sel.avatar} size={26} /><span className="truncate">{sel.name}</span></> : <span className="text-white/40">{placeholder}</span>}
      </button>
      {open && (
        <div className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-white/10 bg-[#1a1a1a] p-1.5 shadow-xl">
          <label className="mb-1 flex items-center gap-2 rounded-lg bg-white/5 px-2"><Search className="h-3.5 w-3.5 text-white/40" /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Имя" className="w-full border-0 bg-transparent py-2 text-sm text-white outline-none" /></label>
          {value && <button type="button" onClick={() => { onChange(null); setOpen(false); }} className="w-full rounded-lg border-0 bg-transparent p-2 text-left text-xs text-white/50">— не указывать</button>}
          {list.map((p) => (
            <button key={String(p.id)} type="button" onClick={() => { onChange(p.id); setOpen(false); setQ(''); }} className="flex w-full items-center gap-2 rounded-lg border-0 bg-transparent p-1.5 text-left text-sm text-white hover:bg-white/5">
              <Avatar name={p.name} src={p.avatar} size={26} /><span className="truncate">{p.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ItemSheet({ initial, people, myId, onClose, onSaved }: { initial: Partial<ClubItem>; people: Person[]; myId: number; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(initial.title || '');
  const [qty, setQty] = useState(initial.qty || 1);
  const [holderId, setHolderId] = useState<number | null>(Number(initial.holderId || initial.holder?.id) || myId);
  const [ownerId, setOwnerId] = useState<number | null>(Number(initial.ownerId || initial.owner?.id) || null);
  const [kind, setKind] = useState<ClubItem['kind']>(initial.kind || 'personal');
  const [contrib, setContrib] = useState<{ tgId: number | null; name: string; amount: number | null }[]>(
    (initial.contributors || []).map((c) => ({ tgId: c.tgId || null, name: c.name, amount: c.amount || null })));
  const [note, setNote] = useState(initial.note || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    if (!title.trim()) return setErr('Что это за вещь?');
    setBusy(true); setErr('');
    try {
      await call('gear_club_save', { item: { id: initial.id, title, qty, holderId, ownerId, kind, note,
        contributors: contrib.filter((c) => c.name).map((c) => ({ ...c })) } });
      haptic('success'); onSaved();
    } catch (e) { haptic('error'); setErr((e as Error).message); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!initial.id || !window.confirm(`Убрать «${initial.title}» из реестра?`)) return;
    setBusy(true);
    try { await call('gear_club_delete', { id: initial.id }); onSaved(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/80 sm:items-center" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-md space-y-3 overflow-y-auto rounded-t-3xl border border-white/10 bg-[#141414] p-4 pb-6 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><b className="text-white">{initial.id ? 'Вещь в реестре' : 'Вещь у меня на руках'}</b><button type="button" onClick={onClose} className="rounded-full border-0 bg-white/10 p-1.5 text-white"><X className="h-4 w-4" /></button></div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Что это? (Ракетка для тенниса)" className="w-full rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white" />
        <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[.03] p-2.5 text-sm text-white/80">
          Количество
          <span className="flex items-center gap-3"><button type="button" onClick={() => setQty(Math.max(1, qty - 1))} className="h-7 w-7 rounded-full border-0 bg-white/10 text-white">−</button><b className="w-5 text-center text-white">{qty}</b><button type="button" onClick={() => setQty(Math.min(99, qty + 1))} className="h-7 w-7 rounded-full border-0 bg-white/10 text-white">+</button></span>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {(['personal', 'shared', 'club'] as const).map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)} className={`rounded-xl border p-2 text-[11px] font-bold ${kind === k ? 'border-brand bg-brand/10 text-brand' : 'border-white/10 bg-transparent text-white/60'}`}>
              {k === 'personal' ? 'Чужая, передали' : k === 'shared' ? 'Складчина' : 'Клубная'}
            </button>
          ))}
        </div>
        <div className="space-y-1"><span className="text-[11px] text-white/50">У кого сейчас</span><PeoplePick people={people} value={holderId} onChange={setHolderId} placeholder="Выбрать" /></div>
        {kind === 'personal' && <div className="space-y-1"><span className="text-[11px] text-white/50">Чья вещь (кто передал)</span><PeoplePick people={people} value={ownerId} onChange={setOwnerId} placeholder="Например, Олег" /></div>}
        {kind === 'shared' && (
          <div className="space-y-1.5">
            <span className="text-[11px] text-white/50">Кто вложился и сколько</span>
            {contrib.map((c, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <div className="min-w-0 flex-1"><PeoplePick people={people} value={c.tgId} onChange={(id) => setContrib(contrib.map((x, k) => k === i ? { ...x, tgId: id, name: people.find((p) => p.id === id)?.name || x.name } : x))} placeholder="Кто" /></div>
                <input type="number" value={c.amount ?? ''} onChange={(e) => setContrib(contrib.map((x, k) => k === i ? { ...x, amount: Number(e.target.value) || null } : x))} placeholder="BYN" className="w-20 rounded-xl border border-white/10 bg-white/5 p-2.5 text-sm text-white" />
                <button type="button" onClick={() => setContrib(contrib.filter((_, k) => k !== i))} className="border-0 bg-transparent px-1 text-rose-400/70">✕</button>
              </div>
            ))}
            <button type="button" onClick={() => setContrib([...contrib, { tgId: null, name: '', amount: null }])} className="flex w-full items-center justify-center gap-1 rounded-xl border border-dashed border-white/15 bg-transparent py-2 text-[11px] text-white/50"><Plus className="h-3 w-3" /> Кто вложился</button>
          </div>
        )}
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Заметка (в сумке, комплект полный)" className="w-full rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white" />
        {err && <p className="text-sm text-rose-300">{err}</p>}
        <div className="flex gap-2">
          {initial.id && <button type="button" onClick={remove} disabled={busy} className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 text-rose-300"><Trash2 className="h-5 w-5" /></button>}
          <button type="button" onClick={save} disabled={busy} className="flex flex-1 items-center justify-center rounded-2xl border-0 bg-brand py-3.5 font-black uppercase text-black disabled:opacity-60">{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Сохранить'}</button>
        </div>
      </div>
    </div>
  );
}

/**
 * Имущество клуба и вещи на руках. Раньше реестр был списком строк без
 * людей: не видно, у кого сейчас мангал, чья ракетка и кто скидывался на
 * термос. Теперь у каждой вещи — фото того, у кого она, владельца и
 * вкладчиков; сверху — «Сейчас у тебя». Отметить вещь может сам участник.
 */
export default function ClubShelf({ myId }: { myId: number }) {
  const [items, setItems] = useState<ClubItem[] | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [edit, setEdit] = useState<Partial<ClubItem> | null>(null);
  const [err, setErr] = useState('');
  const load = () => call('gear_circle').then((j) => { setItems(j.club || []); setPeople(j.people || []); }).catch((e) => { setErr(e.message); setItems([]); });
  useEffect(() => { load(); }, []);
  const mine = useMemo(() => (items || []).filter((i) => Number(i.holderId || i.holder?.id) === myId && !i.returned), [items, myId]);
  const rest = useMemo(() => (items || []).filter((i) => !mine.includes(i)), [items, mine]);
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-black uppercase text-white">Имущество клуба</h3>
        <button type="button" onClick={() => setEdit({ kind: 'personal', holderId: myId })} className="flex items-center gap-1 rounded-full border-0 bg-white/10 px-3 py-1.5 text-[11px] font-bold text-white"><ArrowRightLeft className="h-3.5 w-3.5" /> Вещь у меня</button>
      </div>
      {err && <p className="text-xs text-rose-300">{err}</p>}
      {items === null && <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-white/40" /></div>}
      {mine.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-mono uppercase tracking-widest text-brand">Сейчас у тебя · {mine.length}</p>
          {mine.map((it) => <React.Fragment key={it.id}><ItemCard it={it} onEdit={() => setEdit(it)} /></React.Fragment>)}
        </div>
      )}
      {rest.length > 0 && (
        <div className="space-y-2">
          {mine.length > 0 && <p className="pt-1 text-[10px] font-mono uppercase tracking-widest text-white/40">Остальное</p>}
          {rest.map((it) => <React.Fragment key={it.id}><ItemCard it={it} onEdit={() => setEdit(it)} /></React.Fragment>)}
        </div>
      )}
      {items && !items.length && <p className="text-xs text-white/40">Реестр пуст. Передали вещь — отметь «Вещь у меня».</p>}
      {edit && <ItemSheet initial={edit} people={people} myId={myId} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </section>
  );
}
