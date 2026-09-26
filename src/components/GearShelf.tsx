import React, { useEffect, useState } from 'react';
import { Camera, Loader2, Minus, Plus, Share2, Trash2, X } from 'lucide-react';
import { getInitData, haptic } from '../telegram';
import Avatar from './Avatar';

export type Gear = { id?: number; item: string; quantity: number; category: string; condition: string; price: number; photoUrl: string; description: string; shareable: boolean; owner?: { name: string; username: string; avatar: string } };

const CATEGORIES: { k: string; l: string; e: string }[] = [
  { k: 'tent', l: 'Палатка', e: '⛺' },
  { k: 'sleep', l: 'Сон', e: '🛌' },
  { k: 'kitchen', l: 'Кухня', e: '🍳' },
  { k: 'transport', l: 'Вело / SUP', e: '🚲' },
  { k: 'clothes', l: 'Одежда', e: '🧥' },
  { k: 'tools', l: 'Инструмент', e: '🪓' },
  { k: 'tech', l: 'Техника', e: '🔦' },
  { k: 'other', l: 'Другое', e: '📦' },
];
const CONDITIONS: { k: string; l: string; hint: string; cls: string }[] = [
  { k: 'perfect', l: 'Как новое', hint: 'без следов использования', cls: 'bg-emerald-400/15 text-emerald-300' },
  { k: 'good', l: 'Хорошее', hint: 'следы есть, всё работает', cls: 'bg-sky-400/15 text-sky-300' },
  { k: 'worn', l: 'Поношенное', hint: 'работает, но видно возраст', cls: 'bg-amber-400/15 text-amber-300' },
  { k: 'damaged', l: 'С дефектом', hint: 'опиши, что не так', cls: 'bg-rose-400/15 text-rose-300' },
];
const catOf = (k: string) => CATEGORIES.find((c) => c.k === k) || CATEGORIES[CATEGORIES.length - 1];
const condOf = (k: string) => CONDITIONS.find((c) => c.k === k) || CONDITIONS[1];

async function call(action: string, extra: Record<string, any> = {}) {
  const r = await fetch('/api/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, initData: getInitData(), ...extra }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

/** Фото с телефона → до 1280px JPEG: карточке хватает, грузится быстро. */
function shrink(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('Не удалось прочитать фото'));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Не удалось открыть фото'));
      img.onload = () => {
        const max = 1280; let { width: w, height: h } = img;
        if (Math.max(w, h) > max) { const k = max / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d')?.drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.src = String(fr.result);
    };
    fr.readAsDataURL(file);
  });
}

function GearCard({ g, onClick, showOwner }: { g: Gear; onClick?: () => void; showOwner?: boolean }) {
  const cat = catOf(g.category), cond = condOf(g.condition);
  return (
    <button type="button" onClick={onClick} className="group overflow-hidden rounded-2xl border border-white/10 bg-white/[.03] p-0 text-left text-white">
      <div className="relative aspect-square bg-white/[.04]">
        {g.photoUrl
          ? <img src={g.photoUrl} alt={g.item} loading="lazy" className="h-full w-full object-cover" />
          : <span className="flex h-full w-full items-center justify-center text-4xl opacity-60">{cat.e}</span>}
        {g.quantity > 1 && <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-black">×{g.quantity}</span>}
        {g.shareable && !showOwner && <span className="absolute right-2 top-2 rounded-full bg-brand px-2 py-0.5 text-[9px] font-black uppercase text-black">делюсь</span>}
      </div>
      <div className="space-y-1.5 p-2.5">
        <b className="block truncate text-[13px]">{g.item}</b>
        <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${cond.cls}`}>{cond.l}</span>
        {showOwner && g.owner && (
          <span className="flex items-center gap-1.5 pt-0.5 text-[11px] text-white/55">
            <Avatar name={g.owner.name} src={g.owner.avatar} size={18} />
            <span className="truncate">{g.owner.name}</span>
          </span>
        )}
      </div>
    </button>
  );
}

const empty = (): Gear => ({ item: '', quantity: 1, category: 'tent', condition: 'good', price: 0, photoUrl: '', description: '', shareable: true });

/** Форма вещи — шторкой снизу: фото, что это, в каком состоянии, делюсь ли. */
function GearSheet({ initial, onClose, onSaved, onDeleted }: { initial: Gear; onClose: () => void; onSaved: (g: Gear) => void; onDeleted: (id: number) => void }) {
  const [g, setG] = useState<Gear>(initial);
  const [photo, setPhoto] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k: keyof Gear, v: any) => setG((x) => ({ ...x, [k]: v }));
  const save = async () => {
    if (!g.item.trim()) return setErr('Назови вещь — например «Палатка Naturehike на 2»');
    setBusy(true); setErr('');
    try { const j = await call('gear_save', { gear: { ...g, photo } }); haptic('success'); onSaved(j.item); }
    catch (e) { haptic('error'); setErr((e as Error).message); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!g.id || !window.confirm(`Удалить «${g.item}»?`)) return;
    setBusy(true);
    try { await call('gear_delete', { id: g.id }); onDeleted(g.id); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const shown = photo || g.photoUrl;
  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/80 sm:items-center" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-white/10 bg-[#141414] p-4 pb-6 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <b className="text-white">{g.id ? 'Вещь' : 'Добавить снаряжение'}</b>
          <button type="button" onClick={onClose} className="rounded-full border-0 bg-white/10 p-1.5 text-white"><X className="h-4 w-4" /></button>
        </div>
        <label className="relative mb-4 flex aspect-[4/3] cursor-pointer items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-white/15 bg-white/[.03]">
          {shown
            ? <img src={shown} alt="" className="h-full w-full object-cover" />
            : <span className="flex flex-col items-center gap-2 text-white/45"><Camera className="h-8 w-8" /><span className="text-xs">Сфотографируй вещь</span></span>}
          {shown && <span className="absolute bottom-2 right-2 rounded-full bg-black/70 px-3 py-1 text-[11px] font-bold text-white">Заменить</span>}
          <input type="file" accept="image/*" capture="environment" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { try { setPhoto(await shrink(f)); } catch (x) { setErr((x as Error).message); } } }} />
        </label>

        <div className="space-y-4">
          <input value={g.item} onChange={(e) => set('item', e.target.value)} placeholder="Что это? (Палатка Naturehike на 2)" className="w-full rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white" />
          <div>
            <span className="mb-1.5 block text-[11px] text-white/50">Категория</span>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map((c) => (
                <button key={c.k} type="button" onClick={() => set('category', c.k)} className={`rounded-full border px-3 py-1.5 text-xs font-bold ${g.category === c.k ? 'border-brand bg-brand text-black' : 'border-white/10 bg-white/5 text-white/75'}`}>{c.e} {c.l}</button>
              ))}
            </div>
          </div>
          <div>
            <span className="mb-1.5 block text-[11px] text-white/50">Состояние</span>
            <div className="grid grid-cols-2 gap-1.5">
              {CONDITIONS.map((c) => (
                <button key={c.k} type="button" onClick={() => set('condition', c.k)} className={`rounded-xl border p-2.5 text-left ${g.condition === c.k ? 'border-brand bg-brand/10' : 'border-white/10 bg-white/[.03]'}`}>
                  <b className="block text-xs text-white">{c.l}</b>
                  <span className="text-[10px] text-white/45">{c.hint}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[.03] p-2.5">
            <span className="text-sm text-white/80">Количество</span>
            <span className="flex items-center gap-3">
              <button type="button" onClick={() => set('quantity', Math.max(1, g.quantity - 1))} className="rounded-full border-0 bg-white/10 p-1.5 text-white"><Minus className="h-4 w-4" /></button>
              <b className="w-5 text-center text-white">{g.quantity}</b>
              <button type="button" onClick={() => set('quantity', Math.min(99, g.quantity + 1))} className="rounded-full border-0 bg-white/10 p-1.5 text-white"><Plus className="h-4 w-4" /></button>
            </span>
          </div>
          <button type="button" onClick={() => set('shareable', !g.shareable)} className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left ${g.shareable ? 'border-brand/50 bg-brand/10' : 'border-white/10 bg-white/[.03]'}`}>
            <Share2 className={`h-5 w-5 shrink-0 ${g.shareable ? 'text-brand' : 'text-white/40'}`} />
            <span className="min-w-0 flex-1">
              <b className="block text-sm text-white">Готов делиться с кругом</b>
              <span className="text-[11px] text-white/50">Вещь увидят в «Что есть у круга» — не повезут вторую такую же, могут попросить на выезд</span>
            </span>
            <span className={`h-6 w-10 shrink-0 rounded-full p-0.5 transition ${g.shareable ? 'bg-brand' : 'bg-white/15'}`}><span className={`block h-5 w-5 rounded-full bg-white transition ${g.shareable ? 'translate-x-4' : ''}`} /></span>
          </button>
          <textarea value={g.description} onChange={(e) => set('description', e.target.value)} rows={2} placeholder="Комплектность, нюансы (колышков 8/8, есть тент)" className="w-full rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white" />
          <label className="flex items-center gap-2 text-[11px] text-white/50">
            Оценочная стоимость, BYN
            <input type="number" min={0} value={g.price || ''} onChange={(e) => set('price', Number(e.target.value) || 0)} className="w-24 rounded-lg border border-white/10 bg-white/5 p-2 text-sm text-white" />
            <span className="text-white/35">— на случай поломки</span>
          </label>
        </div>

        {err && <p className="mt-3 text-sm text-rose-300">{err}</p>}
        <div className="mt-4 flex gap-2">
          {g.id && <button type="button" onClick={remove} disabled={busy} className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 text-rose-300"><Trash2 className="h-5 w-5" /></button>}
          <button type="button" onClick={save} disabled={busy} className="flex flex-1 items-center justify-center gap-2 rounded-2xl border-0 bg-brand py-3.5 font-black uppercase text-black disabled:opacity-60">
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Снаряжение участника — витриной с фото, как объявления на маркетплейсе:
 * своё сверху (с кнопкой «добавить»), ниже — что есть у круга, чтобы перед
 * покупкой или выездом посмотреть, у кого уже есть палатка.
 */
export default function GearShelf() {
  const [mine, setMine] = useState<Gear[] | null>(null);
  const [circle, setCircle] = useState<Gear[]>([]);
  const [edit, setEdit] = useState<Gear | null>(null);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState('all');
  useEffect(() => {
    call('gear_mine').then((j) => setMine(j.items || [])).catch((e) => { setErr(e.message); setMine([]); });
    call('gear_circle').then((j) => setCircle(j.shared || [])).catch(() => {});
  }, []);
  const circleShown = circle.filter((g) => filter === 'all' || g.category === filter);
  const circleCats = CATEGORIES.filter((c) => circle.some((g) => g.category === c.k));
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black uppercase text-white">Моё снаряжение{mine?.length ? ` · ${mine.length}` : ''}</h3>
          <button type="button" onClick={() => setEdit(empty())} className="flex items-center gap-1 rounded-full border-0 bg-brand px-3.5 py-2 text-xs font-black uppercase text-black"><Plus className="h-4 w-4" /> Добавить</button>
        </div>
        {err && <p className="text-xs text-rose-300">{err}</p>}
        {mine === null && <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-white/40" /></div>}
        {mine && !mine.length && (
          <button type="button" onClick={() => setEdit(empty())} className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-white/15 bg-transparent p-6 text-center text-white/60">
            <Camera className="h-7 w-7 text-brand" />
            <b className="text-sm text-white">Заведи первую вещь</b>
            <span className="text-xs">Сфоткай палатку, спальник или сап — 20 секунд. Организатор увидит, что у тебя есть, и не попросит везти лишнее.</span>
          </button>
        )}
        {!!mine?.length && (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {mine.map((g) => <React.Fragment key={g.id}><GearCard g={g} onClick={() => setEdit(g)} /></React.Fragment>)}
          </div>
        )}
      </section>

      {circle.length > 0 && (
        <section className="space-y-3">
          <div>
            <h3 className="text-sm font-black uppercase text-white">Что есть у круга · {circle.length}</h3>
            <p className="text-[11px] text-white/45">Прежде чем покупать — посмотри, у кого уже есть. Напиши владельцу, если нужно на выезд.</p>
          </div>
          {circleCats.length > 1 && (
            <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
              <button type="button" onClick={() => setFilter('all')} className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold ${filter === 'all' ? 'border-brand bg-brand text-black' : 'border-white/10 bg-white/5 text-white/70'}`}>Всё</button>
              {circleCats.map((c) => <button key={c.k} type="button" onClick={() => setFilter(c.k)} className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold ${filter === c.k ? 'border-brand bg-brand text-black' : 'border-white/10 bg-white/5 text-white/70'}`}>{c.e} {c.l}</button>)}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {circleShown.map((g) => (
              <React.Fragment key={g.id}>
                <GearCard g={g} showOwner onClick={() => g.owner?.username && window.open(`https://t.me/${g.owner.username}`, '_blank')} />
              </React.Fragment>
            ))}
          </div>
        </section>
      )}

      {edit && (
        <GearSheet
          initial={edit}
          onClose={() => setEdit(null)}
          onSaved={(g) => { setMine((l) => [g, ...(l || []).filter((x) => x.id !== g.id)]); setEdit(null); }}
          onDeleted={(id) => { setMine((l) => (l || []).filter((x) => x.id !== id)); setEdit(null); }}
        />
      )}
    </div>
  );
}
