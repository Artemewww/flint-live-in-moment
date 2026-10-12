import React, { useEffect, useState } from 'react';
import { Camera, Loader2, Minus, Plus, Share2, Trash2, X } from 'lucide-react';
import { getInitData, haptic } from '../telegram';
import Avatar from './Avatar';
import { LogoEmblem } from './VectorIcons';

export type Gear = { id?: number; item: string; quantity: number; category: string; condition: string; price: number; photoUrl: string; description: string; shareable: boolean; owner?: { id: number; name: string; username: string; avatar: string } };

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
        {/* ФОТО — компактной строкой. Раньше оно занимало отдельный блок 4:3 и
            съедало пол-шторки: до названия вещи нужно было прокручивать.
            Теперь это квадрат 72×72 рядом с названием. */}
        <div className="mb-3 flex gap-3">
          <label className="relative flex h-[72px] w-[72px] shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-white/15 bg-white/[.03]">
            {shown
              ? <img src={shown} alt="" className="h-full w-full object-cover" />
              : <Camera className="h-6 w-6 text-white/45" />}
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { try { setPhoto(await shrink(f)); } catch (x) { setErr((x as Error).message); } } }} />
          </label>
          <div className="min-w-0 flex-1 space-y-2">
            <input value={g.item} onChange={(e) => set('item', e.target.value)} placeholder="Что это? Например: Палатка Naturehike на 2" className="w-full rounded-xl border border-white/10 bg-white/5 p-2.5 text-sm text-white" />
            <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-white/45">
              <Camera className="h-3.5 w-3.5" /> {shown ? 'Заменить фото' : 'Приложить фото'}
            </label>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <span className="mb-1 block text-[11px] text-white/50">Категория</span>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map((c) => (
                <button key={c.k} type="button" onClick={() => set('category', c.k)} className={`rounded-full border px-2.5 py-1 text-xs font-bold ${g.category === c.k ? 'border-brand bg-brand text-black' : 'border-white/10 bg-white/5 text-white/75'}`}>{c.e} {c.l}</button>
              ))}
            </div>
          </div>
          <div>
            <span className="mb-1 block text-[11px] text-white/50">Состояние</span>
            <div className="grid grid-cols-4 gap-1">
              {CONDITIONS.map((c) => (
                <button key={c.k} type="button" onClick={() => set('condition', c.k)} className={`rounded-lg border px-1.5 py-1.5 text-center text-[11px] font-bold ${g.condition === c.k ? 'border-brand bg-brand text-black' : 'border-white/10 bg-white/[.03] text-white/70'}`}>
                  {c.l}
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
/**
 * Правка предмета склада клуба.
 *
 * Отдельная форма от GearSheet, потому что предметы лежат в другой структуре
 * (club_inventory, а не member_equipment): название, количество, у кого на
 * руках, чей это предмет и пометка. Без неё термос, который клуб больше не
 * держит, было невозможно ни исправить, ни убрать — а он годами висел в
 * списке как живой.
 */
function ClubItemSheet({ initial, onClose, onSaved }: { initial: any; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(String(initial.title || initial.item || ''));
  const [qty, setQty] = useState(Number(initial.qty) || 1);
  const [note, setNote] = useState(String(initial.note || ''));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    if (!title.trim()) return setErr('Назови вещь');
    setBusy(true); setErr('');
    try {
      await call('gear_club_save', {
        item: {
          id: initial.id, title: title.trim(), qty,
          kind: initial.kind || 'club',
          holderId: initial.holderId ?? null,
          ownerId: initial.ownerId ?? null,
          note,
        },
      });
      haptic('success'); onSaved();
    } catch (e) { haptic('error'); setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/80 p-0 sm:p-4" onClick={onClose}>
      <div
        className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl border border-white/10 bg-[#121212] p-5 space-y-3 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <b className="text-sm font-black uppercase text-white">Вещь склада клуба</b>
          <button type="button" onClick={onClose} className="rounded-full border-0 bg-white/10 p-1.5 text-white cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Что это, например «Мангал»"
          className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-white outline-none focus:border-brand/50"
        />
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono uppercase tracking-widest text-white/40">Количество</span>
          <button type="button" onClick={() => setQty((v) => Math.max(1, v - 1))} className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-white cursor-pointer"><Minus className="w-4 h-4" /></button>
          <span className="font-mono text-sm text-white w-8 text-center">{qty}</span>
          <button type="button" onClick={() => setQty((v) => Math.min(99, v + 1))} className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-white cursor-pointer"><Plus className="w-4 h-4" /></button>
        </div>
        {(initial.holderName || initial.ownerName) && (
          <p className="text-[11px] text-white/45">
            Сейчас: у {initial.holderName || initial.ownerName}
          </p>
        )}
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Пометка, например «остался один комплект»"
          className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-white outline-none focus:border-brand/50"
        />
        {err && <p className="text-[11px] text-rose-300">{err}</p>}
        <button
          type="button"
          disabled={busy}
          onClick={save}
          className="w-full rounded-xl bg-brand text-black py-3.5 text-xs font-black uppercase tracking-widest disabled:opacity-60 cursor-pointer"
        >
          {busy ? 'Сохраняем…' : 'Сохранить'}
        </button>
      </div>
    </div>
  );
}

export default function GearShelf() {
  const [mine, setMine] = useState<Gear[] | null>(null);
  const [circle, setCircle] = useState<Gear[]>([]);
  const [club, setClub] = useState<any[]>([]);
  const [reqs, setReqs] = useState<{ incoming: any[]; outgoing: any[] }>({ incoming: [], outgoing: [] });
  const [edit, setEdit] = useState<Gear | null>(null);
  const [clubEdit, setClubEdit] = useState<any | null>(null);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState('all');
  const [tab, setTab] = useState<'all' | 'club' | 'mine' | 'circle'>('all');

  /**
   * Перезагрузка всех источников разом.
   *
   * Раньше каждый блок тянулся своим запросом при монтировании, а после
   * сохранения вещи обновлялся ТОЛЬКО список «Моё». Вкладка «У круга» и
   * «Склад клуба» оставались старыми — человек добавлял вещь, переходил в
   * «У круга» и её там не находил. Отсюда и было «я добавил, а в круге не
   * отобразилось»: вещь сохранялась, но второй список просто не перечитывался.
   */
  const reload = async () => {
    const [m, c, r] = await Promise.allSettled([
      call('gear_mine'), call('gear_circle'), call('gear_requests'),
    ]);
    if (m.status === 'fulfilled') setMine((m.value as any).items || []);
    if (m.status === 'rejected') { setErr((m.reason as Error).message); setMine([]); }
    if (c.status === 'fulfilled') {
      const j = c.value as any;
      // Круг и склад клуба лежат в РАЗНЫХ хранилищах: club_inventory и
      // member_equipment, поэтому предмет не может оказаться в обоих списках
      // сразу. Дублировалось другое — экран, а не данные: вкладка «Всё»
      // показывала и то, и то подряд, и склада не отличить от круга.
      setCircle(j.shared || []);
      setClub(j.club || []);
    }
    if (r.status === 'fulfilled') {
      const j = r.value as any;
      setReqs({ incoming: j.incoming || [], outgoing: j.outgoing || [] });
    }
  };

  useEffect(() => { void reload(); }, []);

  /**
   * «Попросить»: уходит владельцу вещи, и у него в Telegram появляется
   * уведомление — дальше он решает, делиться или нет.
   */
  /** «Взять»: принимает вещь сразу в запрос и пишет владельцу в бот. */
  const take = async (g: Gear) => {
    if (!g.id) return;
    const ok = window.confirm(`Взять «${g.item}» у ${g.owner?.name || 'владельца'}?\n\nОн узнает, что ты её возьмёшь, и его придётся понять сразу вам.`);
    if (!ok) return;
    try {
      await call('gear_take', { equipmentId: g.id, note: '' });
      haptic('success');
      alert('Готово. Владельцу пришла сообщение в бот.');
      void reload();
    } catch (e) {
      haptic('error');
      alert((e as Error).message);
    }
  };

  const ask = async (g: Gear) => {
    if (!g.owner?.name) return;
    const note = window.prompt(`Кого просишь? ${g.owner.name} увидит сообщение и ответит в Telegram.\n\nМожно дописать, зачем нужна вещь:`);
    if (note === null) return;
    try {
      const j = await call('gear_request', { equipmentId: g.id, ownerId: g.owner.id, itemName: g.item, note });
      setErr(j.already ? 'Ты уже просил эту вещь — жди ответа' : '');
      call('gear_requests').then((x) => setReqs({ incoming: x.incoming || [], outgoing: x.outgoing || [] })).catch(() => {});
    } catch (e) { setErr((e as Error).message); }
  };

  const answer = async (id: number, accept: boolean) => {
    try {
      await call('gear_request_respond', { id, accept });
      setReqs((r) => ({ ...r, incoming: r.incoming.filter((x) => x.id !== id) }));
      // Ответ «Да» переводит вещь к новому владельцу, поэтому круг и склад
      // после ответа меняются — их надо перечитать.
      void reload();
      haptic(accept ? 'success' : 'error');
    } catch (e) { setErr((e as Error).message); }
  };

  /** Фильтр по категории работает сразу для всех трёх блоков. */
  const match = (g: { category?: string }) => filter === 'all' || (g.category || 'other') === filter;
  const mineShown = (mine || []).filter(match);
  const circleShown = circle.filter(match);
  /**
   * Склад клуба фильтром по категориям НЕ трогается.
   *
   * Раньше он фильтровался так же, как личные вещи, и при выборе «Палатки»
   * весь склад исчезал: у club_inventory категории не было, и предмет уезжал
   * в «Другое». Человек думал, что склад пуст. Категории — это про вещи
   * участников; склад от них не зависит.
   */
  const clubShown = club;
  // Категории собираем из всех источников разом, иначе фильтр «палатки»
  // прятал бы то, что лежит на складе клуба.
  const cats = CATEGORIES.filter((c) =>
    (mine || []).some((g) => g.category === c.k) ||
    circle.some((g) => g.category === c.k) ||
    club.some((x) => (x.category || x.kind) === c.k));

  const TABS = [
    { k: 'all' as const, l: 'Всё', n: mineShown.length + circleShown.length + clubShown.length },
    { k: 'club' as const, l: 'Склад клуба', n: clubShown.length },
    { k: 'mine' as const, l: 'Моё', n: mineShown.length },
    { k: 'circle' as const, l: 'У круга', n: circleShown.length },
  ];
  return (
    <div className="space-y-4">
      {/* Вкладки и фильтр — узкой строкой: раньше блок съедал пол-экрана */}
      <div className="flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button key={t.k} type="button" onClick={() => setTab(t.k)}
            className={`rounded-full border px-3 py-1.5 text-xs font-bold ${tab === t.k ? 'border-brand bg-brand text-black' : 'border-white/10 bg-white/5 text-white/70'}`}>
            {t.l}{t.n ? ` · ${t.n}` : ''}
          </button>
        ))}
      </div>
      {cats.length > 1 && (
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
          <button type="button" onClick={() => setFilter('all')} className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold ${filter === 'all' ? 'border-brand bg-brand text-black' : 'border-white/10 bg-white/5 text-white/70'}`}>Все категории</button>
          {cats.map((c) => <button key={c.k} type="button" onClick={() => setFilter(c.k)} className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold ${filter === c.k ? 'border-brand bg-brand text-black' : 'border-white/10 bg-white/5 text-white/70'}`}>{c.e} {c.l}</button>)}
        </div>
      )}
      {err && <p className="text-xs text-rose-300">{err}</p>}

      {/* Просьбы, ждущие моего ответа */}
      {reqs.incoming.length > 0 && (
        <section className="rounded-2xl border border-brand/30 bg-brand/5 p-3">
          <h3 className="mb-2 text-xs font-black uppercase text-brand">Просят тебя поделиться</h3>
          <div className="space-y-2">
            {reqs.incoming.map((r) => (
              <div key={r.id} className="flex items-center gap-2 rounded-xl bg-white/5 p-2">
                <Avatar name={r.from.name} src={r.from.avatar} size={28} />
                <b className="min-w-0 flex-1 truncate text-xs text-white">{r.from.name} — {r.item}</b>
                <button type="button" onClick={() => answer(r.id, true)} className="rounded-full border-0 bg-brand px-2.5 py-1 text-[10px] font-black text-black">Да</button>
                <button type="button" onClick={() => answer(r.id, false)} className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[10px] font-black text-white/70">Нет</button>
              </div>
            ))}
          </div>
        </section>
      )}
      {reqs.outgoing.length > 0 && (
        <section className="rounded-2xl border border-white/10 bg-white/[.03] p-3">
          <h3 className="mb-2 text-xs font-black uppercase text-white/60">Твои просьбы</h3>
          <div className="flex flex-wrap gap-1.5">
            {reqs.outgoing.map((r) => (
              <span key={r.id} className="rounded-full bg-white/5 px-2.5 py-1 text-[10px] text-white/70">{r.item} → {r.to.name}</span>
            ))}
          </div>
        </section>
      )}

      {/* 1) СКЛАД КЛУБА. Эти данные сервер и раньше отдавал в gear_circle,
          но экран их не рисовал — общее имущество было видно только в боте. */}
      {(tab === 'all' || tab === 'club') && clubShown.length > 0 && (
        <section>
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h3 className="text-xs font-black uppercase text-white">Склад клуба · {clubShown.length}</h3>
            {filter !== 'all' && (
              <span className="text-[10px] font-mono uppercase tracking-wider text-white/30">без фильтра</span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {clubShown.map((c) => (
              <div key={c.id} className="overflow-hidden rounded-2xl border border-white/10 bg-white/[.03]">
                {/**
                 * Фирменный знак, а не фото и не иконка предмета.
                 *
                 * Склад клуба — это не витрина вещей участников: там мангал,
                 * тент, колонка. Иконка категории у всех была одна и та же, и
                 * список читался как «палатка, палатка, палатка». Знак FLINT
                 * делает блок узнаваемым и переносит внимание на название.
                 */}
                <div className="relative flex aspect-square items-center justify-center bg-white/[.04]">
                  <LogoEmblem size={56} className="text-white/25" />
                  {Number(c.qty) > 1 && (
                    <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-black">×{c.qty}</span>
                  )}
                </div>
                <div className="space-y-1 p-2.5">
                  <b className="block truncate text-[13px] text-white">{c.title || c.item}</b>
                  {(c.holderName || c.ownerName) && (
                    <span className="block truncate text-[11px] text-white/55">у {c.holderName || c.ownerName}</span>
                  )}
                  {c.note && <span className="block truncate text-[10px] text-white/35">{c.note}</span>}
                  {!c.mine && (
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const j = await call('gear_club_request', { id: c.id });
                          setErr(j?.ok ? '' : (j?.error || 'Не получилось'));
                        } catch (e) { setErr((e as Error).message); }
                      }}
                      className="mt-1 w-full rounded-lg border border-brand/40 bg-brand/10 py-1.5 text-[11px] font-black text-brand transition-colors hover:bg-brand/20"
                    >
                      Запросить
                    </button>
                  )}
                  {/**
                   * Правка и удаление. Термос, который俱乐部 больше не держит,
                   * должен исчезать одним нажатием — иначе склад годами
                   * показывает вещи, которых физически нет. Править может тот,
                   * у кого вещь, её владелец или костяк (проверка на сервере).
                   */}
                  <div className="mt-1 flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => setClubEdit(c)}
                      className="flex-1 rounded-lg border border-white/15 bg-white/5 py-1.5 text-[11px] font-black text-white/75"
                    >
                      Изменить
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!window.confirm(`Убрать «${c.title || c.item}» из склада клуба?`)) return;
                        try {
                          await call('gear_club_delete', { id: c.id });
                          await reload();
                        } catch (e) { setErr((e as Error).message); }
                      }}
                      className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 text-[11px] font-black text-rose-300"
                      title="Убрать из склада"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 2) Моё */}
      {(tab === 'all' || tab === 'mine') && (
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-black uppercase text-white">Моё снаряжение{mineShown.length ? ` · ${mineShown.length}` : ''}</h3>
            <button type="button" onClick={() => setEdit(empty())} className="flex items-center gap-1 rounded-full border-0 bg-brand px-3 py-1.5 text-xs font-black text-black"><Plus className="h-4 w-4" /> Добавить</button>
          </div>
          {mine === null && <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-white/40" /></div>}
          {mine && !mine.length && (
            <button type="button" onClick={() => setEdit(empty())} className="flex w-full flex-col items-center gap-1.5 rounded-2xl border-2 border-dashed border-white/15 bg-transparent p-5 text-center text-white/60">
              <Camera className="h-6 w-6 text-brand" />
              <b className="text-sm text-white">Заведи первую вещь</b>
              <span className="text-xs">Сфоткай палатку или спальник — 20 секунд. Так её увидит круг.</span>
            </button>
          )}
          {!!mineShown.length && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {mineShown.map((g) => <GearCard key={g.id} g={g} onClick={() => setEdit(g)} />)}
            </div>
          )}
        </section>
      )}

      {/* 3) У круга — с кнопкой «Попросить» */}
      {(tab === 'all' || tab === 'circle') && (
        <section>
          <h3 className="text-xs font-black uppercase text-white">У круга · {circleShown.length}</h3>
          {circleShown.length === 0 ? (
            <p className="mt-2 text-[11px] text-white/45">Пока никто не открыл свои вещи. Поставь галочку «готов делиться» — и вещь появится здесь.</p>
          ) : (
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {circleShown.map((g) => (
                <div key={g.id} className="overflow-hidden rounded-2xl border border-white/10 bg-white/[.03]">
                  <div className="relative aspect-square bg-white/[.04]">
                    {g.photoUrl
                      ? <img src={g.photoUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                      : <span className="flex h-full w-full items-center justify-center text-4xl opacity-60">{catOf(g.category).e}</span>}
                    <span className="absolute left-2 top-2 rounded-full bg-brand px-2 py-0.5 text-[9px] font-black text-black">делюсь</span>
                  </div>
                  <div className="space-y-1.5 p-2">
                    <b className="block truncate text-[13px] text-white">{g.item}</b>
                    {g.owner && (
                      <span className="flex items-center gap-1.5 text-[11px] text-white/55">
                        <Avatar name={g.owner.name} src={g.owner.avatar} size={18} />
                        <span className="truncate">{g.owner.name}</span>
                      </span>
                    )}
                    {/**
                     * Две действия, а не одна кнопка.
                     *
                     * Раньше был только «Попросить»: у вещи шесть одна кнопка,
                     * давали три списка, но получить было некому. Или
                     * не получилось — падало пропала. Теперь прямой «Взять».
                     */}
                    <div className="mt-1 grid grid-cols-2 gap-1.5">
                      <button type="button" onClick={() => ask(g)}
                        className="rounded-lg border border-white/15 bg-white/[.04] py-1.5 text-[11px] font-black text-white/70 transition-colors hover:bg-white/10">
                        Попросить
                      </button>
                      <button type="button" onClick={() => take(g)}
                        className="rounded-lg border border-brand/40 bg-brand/10 py-1.5 text-[11px] font-black text-brand transition-colors hover:bg-brand/20">
                        Взять
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {clubEdit && (
        <ClubItemSheet
          initial={clubEdit}
          onClose={() => setClubEdit(null)}
          onSaved={() => { setClubEdit(null); void reload(); }}
        />
      )}

      {edit && (
        <GearSheet
          initial={edit}
          onClose={() => setEdit(null)}
          onSaved={(g) => { setMine((l) => [g, ...(l || []).filter((x) => x.id !== g.id)]); setEdit(null); void reload(); }}
          onDeleted={(id) => { setMine((l) => (l || []).filter((x) => x.id !== id)); setEdit(null); void reload(); }}
        />
      )}
    </div>
  );
}
