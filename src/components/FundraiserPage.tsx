import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, ChevronDown, Copy, Heart, ImagePlus, Loader2, Send, Sparkles, Wand2, X } from 'lucide-react';
import { getInitData, haptic } from '../telegram';
import Avatar from './Avatar';

export type Fundraiser = { id?: string; slug: string; title: string; summary: string; story: string; goalAmount: number; deadline: string; recipientName: string; paymentCard: string; paymentNote: string; pointsPer100: number; organizerName?: string; costBreakdown?: string; legalNote?: string; reportNote?: string; reportUrl?: string; imageUrl?: string; imageCaption?: string; createdBy?: number | null; confirmedAmount: number; confirmedCount: number; status?: string; pledges?: any[]; supporters?: { name: string; avatar?: string }[]; amountOptions?: number[] };
type Member = { id: number; name: string; isCore: boolean; avatar?: string };
const money = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} BYN`;
const dayMonth = (iso: string) => { const d = new Date(`${iso}T12:00:00`); return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }); };
const daysLeft = (iso: string) => Math.ceil((new Date(`${iso}T23:59:59`).getTime() - Date.now()) / 86400000);
const headers = () => { const token = localStorage.getItem('flint_admin_token') || ''; return token ? { Authorization: `Bearer ${token}` } : {}; };

/** Кружки поддержавших внахлёст — как «уже скинулись» в банковских сборах. */
function SupportersRow({ fund }: { fund: Fundraiser }) {
  const list = fund.supporters || [];
  if (!fund.confirmedCount) return <p className="text-xs text-white/45">Стань первым, кто поддержит</p>;
  return (
    <div className="flex items-center gap-3">
      <div className="flex -space-x-2.5">
        {list.slice(0, 6).map((s, i) => <span key={i} className="inline-flex"><Avatar name={s.name} src={s.avatar} size={30} className="ring-2 ring-[#111]" /></span>)}
      </div>
      <span className="text-xs text-white/60">{fund.confirmedCount} {fund.confirmedCount % 10 === 1 && fund.confirmedCount % 100 !== 11 ? 'человек поддержал' : 'поддержали'}</span>
    </div>
  );
}

/** Шапка сбора: обложка, крупная сумма, прогресс и кто уже скинулся. */
export function FundraiserCard({ fund, preview = false }: { fund: Fundraiser; preview?: boolean }) {
  const progress = Math.min(100, (fund.confirmedAmount / Math.max(fund.goalAmount, 1)) * 100);
  const left = daysLeft(fund.deadline);
  return (
    <section className="overflow-hidden rounded-3xl border border-white/10 bg-[#111]">
      {preview && <p className="m-4 rounded-lg border border-brand/30 bg-brand/10 p-3 text-xs text-brand">Предпросмотр: этот сбор ещё не виден участникам.</p>}
      {fund.imageUrl && <img src={fund.imageUrl} alt={fund.imageCaption || fund.title} className="aspect-[16/9] w-full object-cover" />}
      <div className="space-y-5 p-5 md:p-7">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-brand">Командный сбор</p>
          <h1 className="mt-1.5 font-display text-2xl font-black uppercase leading-tight md:text-4xl">{fund.title || 'Без названия'}</h1>
          {fund.summary && <p className="mt-2 text-sm leading-6 text-white/65">{fund.summary}</p>}
        </div>
        <div className="space-y-3 rounded-2xl bg-white/[.04] p-4">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[11px] text-white/45">Собрано</p>
              <p className="font-display text-3xl font-black leading-none">{money(fund.confirmedAmount)}</p>
            </div>
            <p className="pb-0.5 text-right text-xs text-white/50">из {money(fund.goalAmount)}</p>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-brand transition-all" style={{ width: `${progress}%` }} /></div>
          <div className="flex items-center justify-between gap-2 text-[11px] text-white/50">
            <span>{fund.goalAmount > fund.confirmedAmount ? `Осталось ${money(fund.goalAmount - fund.confirmedAmount)}` : 'Цель собрана 🎉'}</span>
            <span>{left > 0 ? `до ${dayMonth(fund.deadline)} · ${left} дн.` : `до ${dayMonth(fund.deadline)}`}</span>
          </div>
          <SupportersRow fund={fund} />
        </div>
      </div>
    </section>
  );
}

/** История, расклад суммы и получатель — то, что читают после решения «скинуть». */
function FundraiserStory({ fund }: { fund: Fundraiser }) {
  if (!fund.story && !fund.costBreakdown && !fund.imageCaption) return null;
  return (
    <section className="space-y-4 rounded-3xl border border-white/10 bg-[#111] p-5 md:p-7">
      {fund.imageCaption && <p className="text-[11px] text-white/45">{fund.imageCaption}</p>}
      {fund.story && <div className="whitespace-pre-wrap text-sm leading-6 text-white/75">{fund.story}</div>}
      {fund.costBreakdown && <div className="border-t border-white/10 pt-4"><p className="font-mono text-[10px] uppercase tracking-widest text-white/45">Из чего складывается сумма</p><div className="mt-2 whitespace-pre-wrap rounded-xl bg-black/30 p-4 text-sm leading-6 text-white/75">{fund.costBreakdown}</div></div>}
      {fund.reportUrl && <a href={fund.reportUrl} target="_blank" rel="noopener noreferrer" className="block text-sm text-brand underline">Отчёт по сбору</a>}
    </section>
  );
}

export function FundraiserPage({ slug, onClose }: { slug: string; onClose?: () => void }) {
  const [fund, setFund] = useState<Fundraiser | null>(null); const [amount, setAmount] = useState(''); const [note, setNote] = useState(''); const [sent, setSent] = useState(false); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [copied, setCopied] = useState(false);
  useEffect(() => { fetch(`/api/fundraisers?slug=${encodeURIComponent(slug)}`).then((r) => r.json()).then((j) => { setFund(j.fundraiser || null); if (!j.fundraiser) setError('Сбор не найден'); }).catch(() => setError('Не удалось загрузить сбор')); }, [slug]);
  const remaining = fund ? Math.max(0, Math.round(fund.goalAmount - fund.confirmedAmount)) : 0;
  const options = fund?.amountOptions?.length ? fund.amountOptions : [10, 20, 50, 100];
  // Предвыбор — самая частая/средняя сумма: пустое поле заставляет думать.
  useEffect(() => { if (fund && !amount) setAmount(String(options[Math.min(1, options.length - 1)])); }, [fund]); // eslint-disable-line react-hooks/exhaustive-deps
  const value = Number(amount) || 0;
  const copyCard = async () => {
    if (!fund?.paymentCard) return;
    try { await navigator.clipboard.writeText(fund.paymentCard.replace(/\s+/g, '')); setCopied(true); haptic('success'); setTimeout(() => setCopied(false), 1800); } catch { setError('Не получилось скопировать — выдели номер вручную'); }
  };
  const submit = async () => {
    if (value <= 0) return setError('Выбери или впиши сумму');
    setError(''); setBusy(true);
    try {
      const r = await fetch('/api/fundraisers?action=pledge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug, amount: value, note, initData: getInitData() }) });
      const j = await r.json(); if (!r.ok) { haptic('error'); return setError(j.error || 'Не удалось записать вклад'); }
      haptic('success'); setSent(true);
    } finally { setBusy(false); }
  };
  if (!fund) return <div className="flex min-h-screen items-center justify-center bg-[#0A0A0A] p-6 text-white">{error || <Loader2 className="h-6 w-6 animate-spin text-white/40" />}</div>;
  return (
    <div className="min-h-screen bg-[#0A0A0A] px-4 pb-10 pt-4 text-white md:p-10">
      <main className="mx-auto max-w-xl space-y-4">
        <button onClick={onClose} className="flex items-center gap-2 border-0 bg-transparent p-0 text-sm text-white/50"><ArrowLeft className="h-4 w-4" /> В афишу FLINT</button>
        <FundraiserCard fund={fund} />

        {/* Поддержать — по образцу перевода в банке: крупная сумма, быстрые
            суммы чипами, реквизиты с копированием в один тап. */}
        <section className="space-y-5 rounded-3xl border border-brand/25 bg-gradient-to-b from-brand/[.08] to-[#111] p-5 md:p-7">
          <p className="flex items-center gap-2 font-bold"><Heart className="h-4 w-4 text-brand" /> Поддержать команду</p>
          {sent ? (
            <div className="space-y-3 py-4 text-center">
              <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand text-black"><Check className="h-7 w-7" /></span>
              <p className="font-display text-xl font-black">Спасибо! {money(value)}</p>
              <p className="text-sm leading-6 text-white/60">Организатор уже получил уведомление. Как только увидит перевод — отметит, сумма появится в собранном, а тебе придут баллы.</p>
            </div>
          ) : (
            <>
              <div className="text-center">
                <p className="text-[11px] text-white/45">Сколько скинешь</p>
                <label className="mt-1 flex items-baseline justify-center gap-2">
                  <input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, '').slice(0, 6))}
                    inputMode="numeric"
                    aria-label="Сумма в BYN"
                    className="w-[5ch] min-w-0 border-0 bg-transparent p-0 text-right font-display text-5xl font-black text-white outline-none"
                    style={{ width: `${Math.max(1, amount.length) + 0.5}ch` }}
                  />
                  <span className="font-display text-2xl font-black text-white/40">BYN</span>
                </label>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {options.map((o) => (
                  <button key={o} type="button" onClick={() => { setAmount(String(o)); haptic('success'); }}
                    className={`rounded-full px-4 py-2 text-sm font-bold transition ${value === o ? 'bg-brand text-black' : 'bg-white/10 text-white hover:bg-white/15'}`}>{o}</button>
                ))}
                {remaining > 0 && !options.includes(remaining) && remaining <= Math.max(...options) * 5 && (
                  <button type="button" onClick={() => setAmount(String(remaining))}
                    className={`rounded-full px-4 py-2 text-sm font-bold transition ${value === remaining ? 'bg-brand text-black' : 'border border-brand/40 bg-transparent text-brand'}`}>Закрыть сбор · {remaining}</button>
                )}
              </div>

              {(fund.paymentCard || fund.recipientName) && (
                <div className="space-y-2 rounded-2xl bg-black/40 p-4">
                  <p className="text-[11px] text-white/45">1. Переведи {value > 0 ? money(value) : 'сумму'} — тапни, чтобы скопировать номер</p>
                  {fund.paymentCard && (
                    <button type="button" onClick={copyCard} className="flex w-full items-center justify-between gap-3 rounded-xl bg-white/[.06] px-4 py-3 text-left">
                      <span className="min-w-0">
                        <span className="block break-all font-mono text-[15px] font-bold">{fund.paymentCard}</span>
                        {fund.recipientName && <span className="block truncate text-xs text-white/50">{fund.recipientName}</span>}
                      </span>
                      <span aria-label={copied ? 'Скопировано' : 'Скопировать номер'} className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${copied ? 'bg-brand text-black' : 'bg-white/10 text-white/70'}`}>{copied ? <Check className="h-5 w-5" /> : <Copy className="h-5 w-5" />}</span>
                    </button>
                  )}
                  {!fund.paymentCard && fund.recipientName && <p className="text-sm">Получатель: <b>{fund.recipientName}</b></p>}
                  {fund.paymentNote && <p className="text-xs text-white/55">Назначение: {fund.paymentNote}</p>}
                  <p className="pt-1 text-[11px] text-white/45">2. Нажми кнопку ниже — организатору придёт уведомление</p>
                </div>
              )}
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Комментарий организатору (необязательно)" className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white" />
              <button onClick={submit} disabled={busy || value <= 0} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand py-4 font-black uppercase text-black disabled:opacity-50">
                {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <>Я перевёл{value > 0 ? ` ${money(value)}` : ''}</>}
              </button>
              {error && <p className="text-center text-sm text-rose-300">{error}</p>}
            </>
          )}
        </section>

        <FundraiserStory fund={fund} />
      </main>
    </div>
  );
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
  reportNote: '', reportUrl: '', imageUrl: '', imageCaption: '', createdBy: null,
  confirmedAmount: 0, confirmedCount: 0, status: 'draft', pledges: [],
});

const STATUS_LABEL: Record<string, string> = { draft: 'черновик', review: 'на проверке', published: 'опубликован', closed: 'завершён' };

export function FundraiserAdmin({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<Fundraiser[]>([]); const [editing, setEditing] = useState<Fundraiser>(blank); const [members, setMembers] = useState<Member[]>([]); const [audience, setAudience] = useState('core'); const [selected, setSelected] = useState<number[]>([]); const [preview, setPreview] = useState(false); const [message, setMessage] = useState(''); const [uploading, setUploading] = useState(false);
  const [aiText, setAiText] = useState(''); const [aiBusy, setAiBusy] = useState(false); const [imagePrompt, setImagePrompt] = useState(''); const [drawing, setDrawing] = useState(false);
  const load = () => fetch('/api/fundraisers?action=admin', { headers: headers() }).then((r) => r.json()).then((j) => setItems(j.fundraisers || []));
  useEffect(() => { load(); fetch('/api/fundraisers?action=audience', { headers: headers() }).then((r) => r.json()).then((j) => setMembers(j.members || [])).catch(() => {}); }, []);
  const patch = (key: keyof Fundraiser, value: any) => setEditing((x) => ({ ...x, [key]: value }));
  const save = async (status?: string) => { const r = await fetch('/api/fundraisers?action=save', { method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify({ fundraiser: status ? { ...editing, status } : editing }) }); const j = await r.json(); if (r.ok) { setEditing(j.fundraiser); setMessage(status === 'published' ? 'Опубликовано' : 'Сохранено'); load(); } else setMessage(j.error || 'Ошибка'); };
  const send = async () => { if (audience === 'none') return setMessage('Сохранено без рассылки'); const body = { id: editing.id, audience, memberIds: selected }; const dry = await fetch('/api/fundraisers?action=broadcast', { method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json()); if (!dry.ok) return setMessage(dry.error || 'Ошибка'); if (!window.confirm(`Получателей: ${dry.wouldSend}. Отправить?`)) return; const result = await fetch('/api/fundraisers?action=broadcast', { method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, confirm: true }) }).then((r) => r.json()); setMessage(result.ok ? `Отправлено: ${result.sent}` : result.error || 'Ошибка рассылки'); };

  /**
   * Сбор одним сообщением: организатор пишет как думает, ИИ раскладывает
   * по полям. Уже загруженную картинку, организатора и статус не трогаем —
   * ИИ заполняет только текст и цифры.
   */
  const aiParse = async () => {
    if (aiText.trim().length < 10) return setMessage('Опиши сбор хотя бы парой предложений');
    setAiBusy(true); setMessage('');
    try {
      const r = await fetch('/api/fundraisers?action=ai_parse', { method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify({ text: aiText }) });
      const j = await r.json();
      if (!r.ok || !j.ok) return setMessage(j.error || 'ИИ не справился — попробуй ещё раз');
      const f = j.fields || {};
      setEditing((cur) => {
        const next: any = { ...cur };
        for (const [k, v] of Object.entries(f)) if (v !== '' && v !== 0 && v != null) next[k] = v;
        // У существующего сбора ссылку не меняем — она уже разослана людям.
        if (cur.id && cur.slug) next.slug = cur.slug;
        return next;
      });
      setImagePrompt(j.imagePrompt || '');
      setMessage('Готово — проверь поля ниже и нажми «Сохранить»');
    } catch { setMessage('Сеть подвела — попробуй ещё раз'); } finally { setAiBusy(false); }
  };
  const drawImage = async () => {
    if (!editing.title) return setMessage('Сначала название — от него рисуется картинка');
    setDrawing(true); setMessage('Рисую картинку… 10–30 секунд');
    try {
      const r = await fetch('/api/admin/events?action=gen_cover', { credentials: 'include', method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify({ title: editing.title, description: imagePrompt || editing.summary }) });
      const j = await r.json();
      if (j.ok && j.url) { patch('imageUrl', j.url); setMessage(j.source === 'free' ? 'Картинка готова (бесплатный генератор — качество попроще). Не забудь «Сохранить».' : 'Картинка готова. Не забудь «Сохранить».'); }
      else setMessage(j.error || 'Не получилось нарисовать');
    } catch { setMessage('Не получилось нарисовать'); } finally { setDrawing(false); }
  };

  /**
   * Вклады участников. Подтверждает костяк или организатор — прямо здесь
   * или кнопкой в уведомлении бота. Только после этого вклад попадает в
   * собранное и приносит баллы.
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
    setMessage('Сбор удалён'); setEditing(blank()); setAiText(''); load();
  };
  /** Перечитать список и подтянуть свежие вклады в открытый сбор. */
  const refresh = async () => {
    const j = await fetch('/api/fundraisers?action=admin', { headers: headers() }).then((r) => r.json());
    const list: Fundraiser[] = j.fundraisers || [];
    setItems(list);
    setEditing((cur) => { const fresh = list.find((x) => x.id === cur.id); return fresh || cur; });
  };
  const memberOf = (tgId: any) => members.find((m) => Number(m.id) === Number(tgId));
  const organizers = useMemo(() => [...members].sort((a, b) => Number(b.isCore) - Number(a.isCore) || a.name.localeCompare(b.name)), [members]);

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

  const field = (label: string, key: keyof Fundraiser, opts: { type?: string; area?: number; placeholder?: string } = {}) => (
    <label className="block space-y-1">
      <span className="text-[11px] text-white/50">{label}</span>
      {opts.area
        ? <textarea value={(editing[key] as string) || ''} onChange={(e) => patch(key, e.target.value)} rows={opts.area} placeholder={opts.placeholder} className="w-full rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white" />
        : <input type={opts.type || 'text'} value={(editing[key] as any) ?? ''} onChange={(e) => patch(key, opts.type === 'number' ? Number(e.target.value) : e.target.value)} placeholder={opts.placeholder} className="w-full rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white" />}
    </label>
  );
  const hasContent = !!(editing.id || editing.title);

  return <div className="fixed inset-0 z-[70] overflow-y-auto bg-[#0A0A0A] p-4 text-white md:p-8"><div className="mx-auto max-w-6xl">
    <header className="mb-6 flex justify-between"><div><p className="font-mono text-xs uppercase text-brand">Костяк · командные сборы</p><h2 className="font-display text-2xl font-black uppercase">Сборы и поддержка</h2></div><button onClick={onClose} className="border-0 bg-white/10 p-2 text-white"><X /></button></header>
    <div className="grid gap-5 md:grid-cols-[1.15fr_1fr]">
      <section className="min-w-0 space-y-4">
        {/* 1. Одно поле — ИИ раскладывает по полям. */}
        <div className="space-y-3 rounded-3xl border border-brand/30 bg-gradient-to-b from-brand/[.08] to-transparent p-5">
          <p className="flex items-center gap-2 font-bold"><Sparkles className="h-4 w-4 text-brand" /> {editing.id ? 'Переписать сбор одним сообщением' : 'Новый сбор одним сообщением'}</p>
          <textarea value={aiText} onChange={(e) => setAiText(e.target.value)} rows={5}
            placeholder={'Напиши как есть, например:\nСобираем на манишки к Bison Race — 20 штук по 30 BYN, всего 600. До 10 октября. Кидайте на карту Альфы 4255 1900 1234 5678, Артём Д. В назначении «манишки».'}
            className="w-full rounded-2xl border border-white/10 bg-black/40 p-4 text-sm leading-6 text-white" />
          <button onClick={aiParse} disabled={aiBusy} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand py-3.5 font-black uppercase text-black disabled:opacity-60">
            {aiBusy ? <><Loader2 className="h-4 w-4 animate-spin" /> Разбираю…</> : <><Wand2 className="h-4 w-4" /> Разобрать по полям</>}
          </button>
        </div>

        {hasContent && <div className="space-y-4 rounded-3xl border border-white/10 p-5">
          {/* 2. Главное — то, без чего сбор не опубликовать. */}
          <div className="flex items-center justify-between gap-2"><h3 className="font-bold">Проверь главное</h3>{editing.status && <span className="rounded-full bg-white/10 px-2.5 py-1 font-mono text-[10px] uppercase text-white/60">{STATUS_LABEL[editing.status] || editing.status}</span>}</div>
          {field('Название', 'title')}
          <div className="grid grid-cols-2 gap-3">{field('Цель, BYN', 'goalAmount', { type: 'number' })}{field('Собираем до', 'deadline', { type: 'date' })}</div>
          {field('Карта / реквизиты', 'paymentCard', { placeholder: '4255 1900 …' })}
          {field('Получатель', 'recipientName')}

          {/* 3. Картинка — по желанию: загрузить свою или нарисовать ИИ. */}
          <div className="space-y-2">
            <span className="text-[11px] text-white/50">Картинка (по желанию)</span>
            {editing.imageUrl
              ? <div className="relative"><img src={editing.imageUrl} alt="Картинка сбора" className="aspect-[16/9] w-full rounded-2xl border border-white/10 object-cover" /><button type="button" onClick={() => patch('imageUrl', '')} className="absolute right-2 top-2 rounded-full border-0 bg-black/70 p-1.5 text-white" aria-label="Убрать картинку"><X className="h-4 w-4" /></button></div>
              : null}
            <div className="grid grid-cols-2 gap-2">
              <label className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold ${uploading ? 'bg-white/5 text-white/40' : 'bg-white/10 text-white'}`}>{uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />} Своё фото<input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" disabled={uploading} onChange={(e) => { pickImage(e.target.files?.[0]); e.currentTarget.value = ''; }} /></label>
              <button type="button" onClick={drawImage} disabled={drawing} className="flex items-center justify-center gap-2 rounded-xl border-0 bg-white/10 py-3 text-sm font-bold text-white disabled:opacity-50">{drawing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Нарисовать ИИ</button>
            </div>
          </div>

          {/* 4. Кому летят уведомления «денежка пришла». */}
          <label className="block space-y-1">
            <span className="text-[11px] text-white/50">Организатор — ему в Telegram придёт уведомление о каждом вкладе</span>
            <div className="flex items-center gap-3">
              {editing.createdBy && memberOf(editing.createdBy) ? <Avatar name={memberOf(editing.createdBy)!.name} src={memberOf(editing.createdBy)!.avatar} size={40} /> : <Avatar name="?" size={40} />}
              <select value={editing.createdBy ? String(editing.createdBy) : ''} onChange={(e) => { const id = Number(e.target.value) || null; patch('createdBy', id); const m = id ? memberOf(id) : null; if (m) patch('organizerName', m.name); }} className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white">
                <option value="">Не выбран — напишем всему костяку</option>
                {organizers.map((m) => <option key={m.id} value={m.id}>{m.name}{m.isCore ? ' · костяк' : ''}</option>)}
              </select>
            </div>
          </label>

          {/* 5. Остальное — свернуто: ИИ заполнил, трогать нужно редко. */}
          <details className="group rounded-2xl border border-white/10 bg-white/[.02]">
            <summary className="flex cursor-pointer list-none items-center justify-between p-4 text-sm font-bold text-white/70">Тексты и детали <ChevronDown className="h-4 w-4 transition group-open:rotate-180" /></summary>
            <div className="space-y-3 px-4 pb-4">
              {field('Коротко (под названием)', 'summary', { area: 2 })}
              {field('История для участников', 'story', { area: 7 })}
              {field('Из чего складывается сумма', 'costBreakdown', { area: 3 })}
              {field('Назначение перевода', 'paymentNote')}
              {field('Подпись под картинкой', 'imageCaption')}
              <div className="grid grid-cols-2 gap-3">{field('Ссылка (латиница)', 'slug')}{field('Баллов за 1 BYN', 'pointsPer100', { type: 'number' })}</div>
              {field('Ссылка на отчёт', 'reportUrl')}
              <label className="block space-y-1"><span className="text-[11px] text-white/50">Статус</span><select value={editing.status} onChange={(e) => patch('status', e.target.value)} className="w-full rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white"><option value="draft">Черновик</option><option value="review">На проверке костяком</option><option value="published">Опубликован</option><option value="closed">Завершён</option></select></label>
            </div>
          </details>

          <div className="grid grid-cols-2 gap-2"><button onClick={() => setPreview(true)} className="rounded-xl border-0 bg-white/10 py-3 font-bold text-white">Предпросмотр</button><button onClick={() => save()} className="rounded-xl border-0 bg-brand py-3 font-black text-black">Сохранить</button></div>
          {editing.status !== 'published' && <button onClick={() => save('published')} className="w-full rounded-xl border border-brand/40 bg-brand/15 py-3 font-black text-brand">Опубликовать</button>}
        </div>}
        {message && <p className="text-sm text-brand">{message}</p>}
      </section>

      <section className="min-w-0 space-y-4">
        <div className="rounded-3xl border border-white/10 p-5"><h3 className="mb-3 font-bold">Сборы</h3>
          {items.map((x) => { const pct = Math.min(100, (x.confirmedAmount / Math.max(x.goalAmount, 1)) * 100); const waiting = (x.pledges || []).filter((p: any) => p.status === 'pending').length; return (
            <button key={x.id} onClick={() => { setEditing(x); setAiText(''); setImagePrompt(''); }} className={`mb-2 block w-full rounded-2xl border p-3 text-left text-white ${editing.id === x.id ? 'border-brand/50 bg-brand/[.06]' : 'border-white/10 bg-transparent'}`}>
              <span className="flex items-center justify-between gap-2"><b className="truncate">{x.title}</b>{waiting > 0 && <span className="shrink-0 rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-black text-black">{waiting} ждёт</span>}</span>
              <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-white/10"><span className="block h-full bg-brand" style={{ width: `${pct}%` }} /></span>
              <span className="mt-1 block text-[11px] text-white/45">{STATUS_LABEL[x.status || ''] || x.status} · {money(x.confirmedAmount)} из {money(x.goalAmount)}</span>
            </button>); })}
          <button onClick={() => { setEditing(blank()); setAiText(''); setImagePrompt(''); setMessage(''); }} className="mt-1 border-0 bg-transparent font-bold text-brand">+ Новый сбор</button>
        </div>

        {editing.id && <div className="space-y-3 rounded-3xl border border-white/10 p-5">
          <div className="flex items-center justify-between gap-2"><h3 className="font-bold">Вклады ({(editing.pledges || []).length})</h3><span className="font-mono text-[11px] text-white/45">подтверждено {money(editing.confirmedAmount)}</span></div>
          {!(editing.pledges || []).length && <p className="text-xs text-white/40">Пока никто не поддержал. Как только участник нажмёт «Я перевёл», организатору придёт уведомление в бот с кнопками «Деньги пришли / Не пришли».</p>}
          {(editing.pledges || []).map((pl: any) => { const m = memberOf(pl.telegram_id); return (
            <div key={pl.id} className="space-y-2 rounded-2xl border border-white/10 bg-black/20 p-3">
              <div className="flex items-center gap-3">
                <Avatar name={m?.name || '?'} src={m?.avatar} size={38} />
                <div className="min-w-0 flex-1">
                  <b className="block truncate text-sm">{m?.name || `id ${pl.telegram_id}`}</b>
                  <span className="font-mono text-[11px] text-white/45">{money(Number(pl.amount))} · {new Date(pl.created_at).toLocaleDateString('ru-RU')}</span>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-1 font-mono text-[10px] uppercase ${pl.status === 'confirmed' ? 'bg-brand/15 text-brand' : pl.status === 'rejected' ? 'bg-rose-500/15 text-rose-300' : 'bg-amber-400/15 text-amber-300'}`}>{pl.status === 'confirmed' ? 'подтверждён' : pl.status === 'rejected' ? 'отклонён' : 'ждёт'}</span>
              </div>
              {pl.note && <p className="text-[11px] text-white/55">«{pl.note}»</p>}
              <div className="flex flex-wrap gap-2">
                {pl.status !== 'confirmed' && <button onClick={() => pledgeAct(pl.id, 'confirmed')} className="rounded-lg border-0 bg-brand px-3 py-1.5 text-[11px] font-black uppercase text-black">Деньги пришли</button>}
                {pl.status !== 'rejected' && <button onClick={() => pledgeAct(pl.id, 'rejected')} className="rounded-lg border border-white/15 bg-transparent px-3 py-1.5 text-[11px] font-bold uppercase text-white/60">Отклонить</button>}
                {pl.status !== 'pending' && <button onClick={() => pledgeAct(pl.id, 'pending')} className="rounded-lg border border-white/15 bg-transparent px-3 py-1.5 text-[11px] font-bold uppercase text-white/60">Вернуть в ожидание</button>}
                <button onClick={() => pledgeDelete(pl.id)} className="rounded-lg border border-rose-400/25 bg-transparent px-3 py-1.5 text-[11px] font-bold uppercase text-rose-300">Удалить</button>
              </div>
            </div>); })}
          <p className="text-[11px] text-white/35">Вклад попадает в собранное и приносит баллы только после подтверждения. Отмена подтверждения снимает баллы обратно.</p>
        </div>}

        {editing.id && <div className="space-y-3 rounded-3xl border border-white/10 p-5"><h3 className="font-bold">Рассылка после публикации</h3><select value={audience} onChange={(e) => setAudience(e.target.value)} className="w-full rounded-xl border border-white/10 bg-white/5 p-3 text-white"><option value="none">Не приглашать</option><option value="core">Только костяк</option><option value="all">Весь одобренный клуб</option><option value="selected">Выбрать участников</option></select>{audience === 'selected' && <div className="max-h-56 space-y-1 overflow-y-auto">{members.map((m) => <label key={m.id} className="flex items-center gap-3 rounded-xl p-1.5 text-sm hover:bg-white/5"><input type="checkbox" checked={selected.includes(m.id)} onChange={() => setSelected((x) => x.includes(m.id) ? x.filter((id) => id !== m.id) : [...x, m.id])} /><Avatar name={m.name} src={m.avatar} size={28} /><span>{m.name}{m.isCore ? ' · костяк' : ''}</span></label>)}</div>}<button onClick={send} disabled={editing.status !== 'published'} className="flex w-full items-center justify-center gap-2 rounded-xl border-0 bg-brand py-3 font-black text-black disabled:opacity-40"><Send className="h-4 w-4" /> Отправить</button>{editing.status !== 'published' && <p className="text-xs text-white/45">Сначала опубликуйте сбор.</p>}</div>}

        {editing.id && <div className="space-y-3 rounded-3xl border border-rose-400/20 p-5">
          <h3 className="font-bold text-rose-200">Удалить сбор</h3>
          <p className="text-[11px] text-white/45">Сбор с подтверждёнными вкладами удалить нельзя: люди отдали деньги, и запись об этом — их гарантия. Такой сбор закрывается статусом «Завершён», отчёт остаётся на странице.</p>
          <button onClick={removeFund} className="w-full rounded-xl border border-rose-400/30 bg-rose-500/10 py-3 font-black uppercase text-rose-200">Удалить сбор</button>
        </div>}
      </section>
    </div>
  </div>{preview && <div className="fixed inset-0 z-[90] overflow-y-auto bg-black/90 p-4 md:p-10"><div className="mx-auto max-w-xl space-y-4"><button onClick={() => setPreview(false)} className="rounded-lg border-0 bg-white/10 px-4 py-2 text-white">Закрыть</button><FundraiserCard fund={editing} preview /><FundraiserStory fund={editing} /></div></div>}</div>;
}
