import React, { useEffect, useState } from 'react';
import { ArrowLeft, Heart, Send, X } from 'lucide-react';
import { getInitData } from '../telegram';

export type Fundraiser = { id?: string; slug: string; title: string; summary: string; story: string; goalAmount: number; deadline: string; recipientName: string; paymentCard: string; paymentNote: string; pointsPer100: number; organizerName?: string; costBreakdown?: string; legalNote?: string; reportNote?: string; reportUrl?: string; imageUrl?: string; imageCaption?: string; confirmedAmount: number; confirmedCount: number; status?: string; pledges?: any[] };
type Member = { id: number; name: string; isCore: boolean };
const money = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} BYN`;
const headers = () => { const token = localStorage.getItem('flint_admin_token') || ''; return token ? { Authorization: `Bearer ${token}` } : {}; };

export function FundraiserCard({ fund, preview = false }: { fund: Fundraiser; preview?: boolean }) {
  const progress = Math.min(100, (fund.confirmedAmount / Math.max(fund.goalAmount, 1)) * 100);
  return <section className="space-y-5 rounded-2xl border border-white/10 bg-white/[.03] p-5 md:p-8">{preview && <p className="rounded-lg border border-brand/30 bg-brand/10 p-3 text-xs text-brand">Предпросмотр: этот сбор ещё не виден участникам.</p>}<div><p className="font-mono text-[10px] uppercase tracking-widest text-brand">Командный сбор</p><h1 className="mt-2 font-display text-3xl font-black uppercase md:text-5xl">{fund.title || 'Без названия'}</h1><p className="mt-3 text-white/60">{fund.summary}</p></div><div><div className="flex justify-between text-sm"><b>{money(fund.confirmedAmount)}</b><span className="text-white/50">из {money(fund.goalAmount)}</span></div><div className="mt-2 h-3 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-brand" style={{ width: `${progress}%` }} /></div><p className="mt-2 text-[11px] text-white/40">Поддержали: {fund.confirmedCount} · сбор до {fund.deadline}</p></div>{fund.imageUrl && <figure className="space-y-2 border-t border-white/10 pt-5"><img src={fund.imageUrl} alt={fund.imageCaption || fund.title} className="w-full rounded-xl border border-white/10" /><figcaption className="text-[11px] text-white/50">{fund.imageCaption}</figcaption></figure>}<div className="whitespace-pre-wrap text-sm leading-6 text-white/75">{fund.story}</div>{fund.costBreakdown && <div className="border-t border-white/10 pt-5"><p className="font-mono text-xs uppercase text-white/50">Из чего складывается сумма</p><div className="mt-2 whitespace-pre-wrap rounded-xl bg-black/20 p-4 text-sm leading-6 text-white/75">{fund.costBreakdown}</div></div>}<p className="text-xs text-white/50">Получатель: <b className="text-white/75">{fund.recipientName}</b></p></section>;
}

export function FundraiserPage({ slug, onClose }: { slug: string; onClose?: () => void }) {
  const [fund, setFund] = useState<Fundraiser | null>(null); const [amount, setAmount] = useState('10'); const [note, setNote] = useState(''); const [sent, setSent] = useState(false); const [error, setError] = useState('');
  useEffect(() => { fetch(`/api/fundraisers?slug=${encodeURIComponent(slug)}`).then((r) => r.json()).then((j) => setFund(j.fundraiser || null)).catch(() => setError('Не удалось загрузить сбор')); }, [slug]);
  const submit = async () => { setError(''); const r = await fetch('/api/fundraisers?action=pledge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug, amount: Number(amount), note, initData: getInitData() }) }); const j = await r.json(); if (!r.ok) return setError(j.error || 'Не удалось записать вклад'); setSent(true); };
  if (!fund) return <div className="flex min-h-screen items-center justify-center bg-[#0A0A0A] p-6 text-white">{error || 'Загрузка…'}</div>;
  return <div className="min-h-screen bg-[#0A0A0A] p-4 text-white md:p-10"><main className="mx-auto max-w-2xl space-y-5"><button onClick={onClose} className="flex items-center gap-2 border-0 bg-transparent p-0 text-white/50"><ArrowLeft className="h-4 w-4" /> В афишу FLINT</button><FundraiserCard fund={fund} /><section className="space-y-3 rounded-2xl border border-brand/20 bg-brand/5 p-5"><p className="flex items-center gap-2 font-bold"><Heart className="h-4 w-4 text-brand" /> Поддержать команду</p>{sent ? <p className="text-sm text-brand">Спасибо! Вклад отправлен костяку на подтверждение.</p> : <><input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" min="1" className="w-32 rounded-xl border border-white/10 bg-white/10 p-3 text-white" /><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Комментарий (необязательно)" className="w-full rounded-xl border border-white/10 bg-white/10 p-3 text-white" /><button onClick={submit} className="rounded-xl bg-brand px-5 py-3 font-black uppercase text-black">Я поддержу</button>{error && <p className="text-sm text-rose-300">{error}</p>}</>}</section></main></div>;
}

/**
 * Пустой бланк нового сбора.
 * Раньше здесь был ЗАХАРДКОЖЕННЫЙ сбор на манишки для Bison Race: кнопка
 * «+ Новый сбор» подставляла чужую цель, сумму, текст и картинку, и любой
 * новый сбор начинался с чужой истории, которую надо было вычищать руками.
 */
const blank = (): Fundraiser => ({
  slug: '', title: '', summary: '', story: '',
  goalAmount: 0, deadline: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
  recipientName: '', paymentCard: '', paymentNote: '', pointsPer100: 1,
  organizerName: 'Костяк клуба FLINT', costBreakdown: '', legalNote: '',
  reportNote: '', reportUrl: '', imageUrl: '', imageCaption: '',
  confirmedAmount: 0, confirmedCount: 0, status: 'draft', pledges: [],
});

export function FundraiserAdmin({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<Fundraiser[]>([]); const [editing, setEditing] = useState<Fundraiser>(blank); const [members, setMembers] = useState<Member[]>([]); const [audience, setAudience] = useState('core'); const [selected, setSelected] = useState<number[]>([]); const [preview, setPreview] = useState(false); const [message, setMessage] = useState(''); const [uploading, setUploading] = useState(false);
  const load = () => fetch('/api/fundraisers?action=admin', { headers: headers() }).then((r) => r.json()).then((j) => setItems(j.fundraisers || []));
  useEffect(() => { load(); fetch('/api/fundraisers?action=audience', { headers: headers() }).then((r) => r.json()).then((j) => setMembers(j.members || [])).catch(() => {}); }, []);
  const patch = (key: keyof Fundraiser, value: any) => setEditing((x) => ({ ...x, [key]: value }));
  const save = async (status?: string) => { const r = await fetch('/api/fundraisers?action=save', { method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify({ fundraiser: status ? { ...editing, status } : editing }) }); const j = await r.json(); if (r.ok) { setEditing(j.fundraiser); setMessage(status === 'published' ? 'Опубликовано' : 'Сохранено'); load(); } else setMessage(j.error || 'Ошибка'); };
  const send = async () => { if (audience === 'none') return setMessage('Сохранено без рассылки'); const body = { id: editing.id, audience, memberIds: selected }; const dry = await fetch('/api/fundraisers?action=broadcast', { method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json()); if (!dry.ok) return setMessage(dry.error || 'Ошибка'); if (!window.confirm(`Получателей: ${dry.wouldSend}. Отправить?`)) return; const result = await fetch('/api/fundraisers?action=broadcast', { method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, confirm: true }) }).then((r) => r.json()); setMessage(result.ok ? `Отправлено: ${result.sent}` : result.error || 'Ошибка рассылки'); };
  /**
   * Вклады участников. В админке их не было видно ВООБЩЕ: кто перевёл деньги,
   * сколько и подтвердил ли это кто-нибудь — выяснялось только через базу.
   * А сбор без подтверждения — это доверие на слово: любой мог написать
   * «я скинул 50», и сумма росла сама. Подтверждает костяк, и только после
   * этого вклад попадает в собранное и приносит баллы.
   */
  const pledgeAct = async (pledgeId: string, status: 'confirmed' | 'rejected' | 'pending') => {
    const r = await fetch('/api/fundraisers?action=pledge_status', { method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify({ pledgeId, status }) });
    const j = await r.json();
    setMessage(r.ok ? (status === 'confirmed' ? `Подтверждено · +${j.points} баллов` : 'Статус обновлён') : (j.error || 'Ошибка'));
    await refresh();
  };
  const pledgeDelete = async (pledgeId: string) => {
    if (!window.confirm('Удалить этот вклад? Если он был подтверждён, баллы за него снимутся.')) return;
    const r = await fetch('/api/fundraisers?action=pledge_delete', { method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify({ pledgeId }) });
    const j = await r.json();
    setMessage(r.ok ? 'Вклад удалён' : (j.error || 'Ошибка'));
    await refresh();
  };
  const removeFund = async () => {
    if (!editing.id) return;
    if (!window.confirm(`Удалить сбор «${editing.title}»? Это необратимо.`)) return;
    const r = await fetch('/api/fundraisers?action=delete', { method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify({ id: editing.id }) });
    const j = await r.json();
    if (!r.ok) return setMessage(j.error || 'Ошибка');
    setMessage('Сбор удалён'); setEditing(blank()); load();
  };
  /** Перечитать список и подтянуть свежие вклады в открытый сбор. */
  const refresh = async () => {
    const j = await fetch('/api/fundraisers?action=admin', { headers: headers() }).then((r) => r.json());
    const list: Fundraiser[] = j.fundraisers || [];
    setItems(list);
    setEditing((cur) => { const fresh = list.find((x) => x.id === cur.id); return fresh || cur; });
  };
  const memberName = (tgId: any) => members.find((m) => Number(m.id) === Number(tgId))?.name || `id ${tgId}`;

  const compressImage = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result || '');
      // Небольшие файлы уходят как есть: PNG с текстом остаётся резким.
      if (file.size <= 2_600_000) return resolve(raw);
      const img = new Image();
      img.onload = () => {
        const max = 1600; let w = img.width, h = img.height;
        if (Math.max(w, h) > max) { const k = max / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
        const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
        canvas.getContext('2d')?.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.87));
      };
      img.onerror = () => reject(new Error('Не удалось прочитать картинку'));
      img.src = raw;
    };
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
    reader.readAsDataURL(file);
  });
  const pickImage = async (file?: File | null) => {
    if (!file) return;
    if (!/^image\//.test(file.type)) return setMessage('Это не картинка: выбери PNG, JPEG или WebP');
    setMessage('Загружаю фотографию…'); setUploading(true);
    try {
      const dataUrl = await compressImage(file);
      const r = await fetch('/api/fundraisers?action=upload_image', { method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify({ dataUrl, slug: editing.slug }) });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || 'Не удалось загрузить фотографию');
      patch('imageUrl', j.url);
      setMessage('Фотография загружена — не забудь нажать «Сохранить».');
    } catch (e: any) { setMessage(e.message || 'Ошибка загрузки'); } finally { setUploading(false); }
  };
  const input = (key: keyof Fundraiser) => <input value={(editing[key] as string) || ''} onChange={(e) => patch(key, e.target.value)} placeholder={key} className="w-full rounded-lg border border-white/10 bg-white/5 p-3 text-white" />;
  return <div className="fixed inset-0 z-[70] overflow-y-auto bg-[#0A0A0A] p-4 text-white md:p-8"><div className="mx-auto max-w-6xl"><header className="mb-6 flex justify-between"><div><p className="font-mono text-xs uppercase text-brand">Костяк · командные сборы</p><h2 className="font-display text-2xl font-black uppercase">Сборы и поддержка</h2></div><button onClick={onClose} className="border-0 bg-white/10 p-2 text-white"><X /></button></header><div className="grid gap-5 md:grid-cols-2"><section className="space-y-3 rounded-2xl border border-white/10 p-5"><h3 className="font-bold">Редактирование</h3>{(['title','slug','summary','recipientName','paymentCard','paymentNote'] as (keyof Fundraiser)[]).map(input)}<textarea value={editing.story} onChange={(e) => patch('story', e.target.value)} rows={7} className="w-full rounded-lg border border-white/10 bg-white/5 p-3 text-white" />{input('costBreakdown')}<div className="space-y-2 rounded-lg border border-white/10 bg-white/5 p-3">
  <p className="font-mono text-[10px] uppercase tracking-widest text-white/50">Картинка сбора</p>
  {editing.imageUrl ? <img src={editing.imageUrl} alt="Картинка сбора" className="max-h-44 w-full rounded-lg border border-white/10 object-cover" /> : <p className="text-xs text-white/40">Пока без картинки — участники увидят только текст.</p>}
  <div className="flex flex-wrap items-center gap-2">
    <label className={`cursor-pointer rounded-lg px-3 py-2 text-sm ${uploading ? 'bg-white/5 text-white/40' : 'bg-white/10 text-white'}`}>{uploading ? 'Загружаю…' : 'Выбрать фотографию…'}<input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" disabled={uploading} onChange={(e) => { pickImage(e.target.files?.[0]); e.currentTarget.value = ''; }} /></label>
    {editing.imageUrl && <button type="button" onClick={() => patch('imageUrl', '')} className="rounded-lg bg-white/5 px-3 py-2 text-sm text-white/60">Убрать</button>}
  </div>
  <input value={editing.imageUrl || ''} onChange={(e) => patch('imageUrl', e.target.value)} placeholder="или вставь ссылку на картинку (URL)" className="w-full rounded-lg border border-white/10 bg-black/20 p-2 text-xs text-white" />
  <input value={editing.imageCaption || ''} onChange={(e) => patch('imageCaption', e.target.value)} placeholder="Подпись под картинкой (необязательно)" className="w-full rounded-lg border border-white/10 bg-black/20 p-2 text-xs text-white" />
  <p className="text-[11px] text-white/40">PNG/JPEG/WebP до ~2,5 МБ уходят как есть, крупные сжимаются до 1600px. Результат проверь в «Предпросмотре».</p>
</div><div className="grid grid-cols-2 gap-3"><input type="number" value={editing.goalAmount} onChange={(e) => patch('goalAmount', Number(e.target.value))} className="rounded-lg border border-white/10 bg-white/5 p-3 text-white" /><input type="date" value={editing.deadline} onChange={(e) => patch('deadline', e.target.value)} className="rounded-lg border border-white/10 bg-white/5 p-3 text-white" /></div><select value={editing.status} onChange={(e) => patch('status', e.target.value)} className="w-full rounded-lg border border-white/10 bg-white/5 p-3 text-white"><option value="draft">Черновик</option><option value="review">На проверке костяком</option><option value="published">Опубликован</option><option value="closed">Завершён</option></select><div className="grid grid-cols-2 gap-2"><button onClick={() => setPreview(true)} className="rounded-xl bg-white/10 py-3 font-bold">Предпросмотр</button><button onClick={() => save()} className="rounded-xl bg-brand py-3 font-black text-black">Сохранить</button></div>{editing.status !== 'published' && <button onClick={() => save('published')} className="w-full rounded-xl border border-brand/40 bg-brand/15 py-3 font-black text-brand">Опубликовать</button>}{message && <p className="text-sm text-brand">{message}</p>}</section><section className="space-y-3"><div className="rounded-2xl border border-white/10 p-5"><h3 className="mb-3 font-bold">Существующие сборы</h3>{items.map((x) => <button key={x.id} onClick={() => setEditing(x)} className="block w-full border-b border-white/10 bg-transparent py-3 text-left text-white"><b>{x.title}</b><span className="block text-xs text-white/45">{x.status} · {money(x.confirmedAmount)} / {money(x.goalAmount)}</span></button>)}<button onClick={() => setEditing(blank())} className="mt-3 border-0 bg-transparent text-brand">+ Новый сбор</button></div>{editing.id && <div className="space-y-3 rounded-2xl border border-white/10 p-5">
  <div className="flex items-center justify-between gap-2">
    <h3 className="font-bold">Вклады ({(editing.pledges || []).length})</h3>
    <span className="font-mono text-[11px] text-white/45">подтверждено {money(editing.confirmedAmount)}</span>
  </div>
  {!(editing.pledges || []).length && <p className="text-xs text-white/40">Пока никто не поддержал. Вклад появляется здесь сразу, как участник нажал «Я поддержу» — и ждёт твоего подтверждения.</p>}
  {(editing.pledges || []).map((pl: any) => (
    <div key={pl.id} className="space-y-2 rounded-xl border border-white/10 bg-black/20 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <b className="block truncate text-sm">{memberName(pl.telegram_id)}</b>
          <span className="font-mono text-[11px] text-white/45">{money(Number(pl.amount))} · {new Date(pl.created_at).toLocaleDateString('ru-RU')}</span>
          {pl.note && <p className="mt-1 text-[11px] text-white/55">«{pl.note}»</p>}
        </div>
        <span className={`shrink-0 rounded-full px-2 py-1 font-mono text-[10px] uppercase ${
          pl.status === 'confirmed' ? 'bg-brand/15 text-brand'
          : pl.status === 'rejected' ? 'bg-rose-500/15 text-rose-300'
          : 'bg-amber-400/15 text-amber-300'}`}>
          {pl.status === 'confirmed' ? 'подтверждён' : pl.status === 'rejected' ? 'отклонён' : 'ждёт'}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {pl.status !== 'confirmed' && <button onClick={() => pledgeAct(pl.id, 'confirmed')} className="rounded-lg bg-brand px-3 py-1.5 text-[11px] font-black uppercase text-black">Деньги пришли</button>}
        {pl.status !== 'rejected' && <button onClick={() => pledgeAct(pl.id, 'rejected')} className="rounded-lg border border-white/15 bg-transparent px-3 py-1.5 text-[11px] font-bold uppercase text-white/60">Отклонить</button>}
        {pl.status !== 'pending' && <button onClick={() => pledgeAct(pl.id, 'pending')} className="rounded-lg border border-white/15 bg-transparent px-3 py-1.5 text-[11px] font-bold uppercase text-white/60">Вернуть в ожидание</button>}
        <button onClick={() => pledgeDelete(pl.id)} className="rounded-lg border border-rose-400/25 bg-transparent px-3 py-1.5 text-[11px] font-bold uppercase text-rose-300">Удалить</button>
      </div>
    </div>
  ))}
  <p className="text-[11px] text-white/35">Подтверждает костяк — вклад попадает в собранное и приносит баллы только после этого. Отмена подтверждения снимает баллы обратно.</p>
</div>}

{editing.id && <div className="space-y-3 rounded-2xl border border-rose-400/20 p-5">
  <h3 className="font-bold text-rose-200">Удалить сбор</h3>
  <p className="text-[11px] text-white/45">Сбор с подтверждёнными вкладами удалить нельзя: люди отдали деньги, и запись об этом — их гарантия. Такой сбор закрывается статусом «Завершён», отчёт остаётся на странице.</p>
  <button onClick={removeFund} className="w-full rounded-xl border border-rose-400/30 bg-rose-500/10 py-3 font-black uppercase text-rose-200">Удалить сбор</button>
</div>}

{editing.id && <div className="space-y-3 rounded-2xl border border-white/10 p-5"><h3 className="font-bold">Рассылка после публикации</h3><select value={audience} onChange={(e) => setAudience(e.target.value)} className="w-full rounded-lg border border-white/10 bg-white/5 p-3 text-white"><option value="none">Не приглашать</option><option value="core">Только костяк</option><option value="all">Весь одобренный клуб</option><option value="selected">Выбрать участников</option></select>{audience === 'selected' && <div className="max-h-48 space-y-2 overflow-y-auto">{members.map((m) => <label key={m.id} className="block text-sm"><input type="checkbox" checked={selected.includes(m.id)} onChange={() => setSelected((x) => x.includes(m.id) ? x.filter((id) => id !== m.id) : [...x, m.id])} /> <span className="ml-2">{m.name}{m.isCore ? ' · костяк' : ''}</span></label>)}</div>}<button onClick={send} disabled={editing.status !== 'published'} className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-3 font-black text-black disabled:opacity-40"><Send className="h-4 w-4" /> Отправить</button>{editing.status !== 'published' && <p className="text-xs text-white/45">Сначала опубликуйте сбор.</p>}</div>}</section></div></div>{preview && <div className="fixed inset-0 z-[90] overflow-y-auto bg-black/90 p-4 md:p-10"><div className="mx-auto max-w-2xl"><button onClick={() => setPreview(false)} className="mb-4 rounded-lg border-0 bg-white/10 px-4 py-2 text-white">Закрыть</button><FundraiserCard fund={editing} preview /></div></div>}</div>;
}