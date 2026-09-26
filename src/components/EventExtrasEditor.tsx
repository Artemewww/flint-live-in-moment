import React, { useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ImagePlus, Loader2, Plus, X } from 'lucide-react';

export type EventFaq = { q: string; a: string };

/** Сжимает фото до 1600px JPEG — галерее хватает, а грузится быстро. */
function compress(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Не удалось открыть изображение'));
      img.onload = () => {
        const max = 1600;
        let { width, height } = img;
        if (width > max || height > max) { const k = Math.min(max / width, max / height); width = Math.round(width * k); height = Math.round(height * k); }
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        canvas.getContext('2d')?.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

async function uploadPhoto(file: File): Promise<string> {
  const dataUrl = await compress(file);
  let token = '';
  try { token = localStorage.getItem('flint_admin_token') || ''; } catch { /* приватный режим */ }
  const r = await fetch('/api/admin/events?action=upload_image', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ dataUrl }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.url) throw new Error(j.error || `HTTP ${r.status}`);
  return j.url;
}

function Lines({ label, hint, items, onChange }: { label: string; hint: string; items: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="space-y-1.5">
      <span className="text-[10px] font-mono uppercase text-white/40">{label}</span>
      {items.map((it, i) => (
        <div key={i} className="flex gap-1.5">
          <input value={it} placeholder={hint} onChange={(e) => onChange(items.map((x, k) => (k === i ? e.target.value : x)))} className="flex-1 rounded-lg border border-white/10 bg-white/5 p-2 text-sm text-white" />
          <button type="button" onClick={() => onChange(items.filter((_, k) => k !== i))} className="border-0 bg-transparent px-1 text-rose-400/70" aria-label="Удалить">✕</button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...items, ''])} className="w-full rounded-lg border border-dashed border-white/15 bg-transparent py-1.5 text-[11px] text-white/50">＋ Пункт</button>
    </div>
  );
}

/**
 * Витрина события: галерея, «что включено / не включено» и частые вопросы.
 * Страница события была одной обложкой и текстом — по ней нельзя понять,
 * как там будет. Живые фото места и честный список «что входит» решают
 * «ехать или нет» быстрее любого описания. Всё хранится в events.logistics
 * (jsonb уже есть), миграция не нужна; фото — в хранилище, не в базе.
 */
export default function EventExtrasEditor({ value, onChange }: { value: any; onChange: (v: any) => void }) {
  const v = value || {};
  const gallery: string[] = Array.isArray(v.gallery) ? v.gallery : [];
  const included: string[] = Array.isArray(v.included) ? v.included : [];
  const notIncluded: string[] = Array.isArray(v.notIncluded) ? v.notIncluded : [];
  const faq: EventFaq[] = Array.isArray(v.faq) ? v.faq : [];
  const set = (k: string, val: any) => onChange({ ...v, [k]: val });
  const [busy, setBusy] = useState(0);
  const [err, setErr] = useState('');
  const input = useRef<HTMLInputElement>(null);

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setErr('');
    const list = Array.from(files).filter((f) => /^image\//.test(f.type)).slice(0, 12 - gallery.length);
    setBusy(list.length);
    const urls: string[] = [];
    for (const f of list) {
      try { urls.push(await uploadPhoto(f)); } catch (e) { setErr((e as Error).message); }
      setBusy((n) => n - 1);
    }
    if (urls.length) set('gallery', [...gallery, ...urls]);
  };
  const move = (i: number, d: number) => {
    const j = i + d; if (j < 0 || j >= gallery.length) return;
    const c = [...gallery]; [c[i], c[j]] = [c[j], c[i]]; set('gallery', c);
  };

  return (
    <div className="space-y-4 rounded-xl border border-white/10 bg-white/5 p-3">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono uppercase text-white/40">📸 Галерея места ({gallery.length}/12)</span>
          <span className="text-[10px] text-white/30">листается на обложке</span>
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {gallery.map((url, i) => (
            <div key={url} className="group relative aspect-square overflow-hidden rounded-lg border border-white/10">
              <img src={url} alt="" className="h-full w-full object-cover" />
              <div className="absolute inset-x-0 bottom-0 flex justify-between bg-black/60 p-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
                <button type="button" onClick={() => move(i, -1)} className="border-0 bg-transparent p-0.5 text-white"><ArrowLeft className="h-3 w-3" /></button>
                <button type="button" onClick={() => set('gallery', gallery.filter((_, k) => k !== i))} className="border-0 bg-transparent p-0.5 text-rose-300"><X className="h-3 w-3" /></button>
                <button type="button" onClick={() => move(i, 1)} className="border-0 bg-transparent p-0.5 text-white"><ArrowRight className="h-3 w-3" /></button>
              </div>
            </div>
          ))}
          {gallery.length < 12 && (
            <button type="button" onClick={() => input.current?.click()} disabled={busy > 0}
              className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-white/15 bg-transparent text-white/40">
              {busy > 0 ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
              <span className="text-[9px]">{busy > 0 ? `ещё ${busy}` : 'Фото'}</span>
            </button>
          )}
        </div>
        <input ref={input} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
        {err && <p className="text-[10px] text-rose-400">{err}</p>}
      </div>

      {/* Как делим деньги и что нужно на общее — отсюда анкета записи задаёт
          понятные вопросы, а бот раскладывает «кто что везёт». */}
      <div className="space-y-2">
        <span className="text-[10px] font-mono uppercase text-white/40">💳 Как делим деньги</span>
        <div className="grid grid-cols-2 gap-1.5">
          {([
            ['self', 'Каждый за себя'],
            ['pool', 'Общий взнос'],
            ['food_share', 'Общий стол (еда вскладчину)'],
            ['bring_own', 'Каждый везёт своё'],
          ] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => set('costModel', k)}
              className={`rounded-lg border p-2 text-left text-[11px] font-bold ${v.costModel === k ? 'border-brand bg-brand/10 text-brand' : 'border-white/10 bg-transparent text-white/60'}`}>{l}</button>
          ))}
        </div>
        <input value={v.costNote || ''} onChange={(e) => set('costNote', e.target.value)} placeholder="Пояснение (баня 300 BYN делим на всех, продукты ~25 BYN/чел)" className="w-full rounded-lg border border-white/10 bg-white/5 p-2 text-sm text-white" />
      </div>
      <Lines label="🎒 Что нужно привезти на общее (бот распределит)" hint="Мангал, котёл, колонка, веники" items={Array.isArray(v.needs) ? v.needs : []} onChange={(x) => set('needs', x)} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Lines label="✅ Что включено" hint="Трансфер из Минска" items={included} onChange={(x) => set('included', x)} />
        <Lines label="➖ Не включено" hint="Питание в кафе" items={notIncluded} onChange={(x) => set('notIncluded', x)} />
      </div>

      <div className="space-y-1.5">
        <span className="text-[10px] font-mono uppercase text-white/40">❓ Частые вопросы</span>
        {faq.map((f, i) => (
          <div key={i} className="space-y-1 rounded-lg border border-white/10 p-2">
            <div className="flex gap-1.5">
              <input value={f.q} placeholder="Вопрос" onChange={(e) => set('faq', faq.map((x, k) => (k === i ? { ...x, q: e.target.value } : x)))} className="flex-1 rounded-lg border border-white/10 bg-white/5 p-2 text-sm font-bold text-white" />
              <button type="button" onClick={() => set('faq', faq.filter((_, k) => k !== i))} className="border-0 bg-transparent px-1 text-rose-400/70">✕</button>
            </div>
            <textarea value={f.a} placeholder="Ответ" rows={2} onChange={(e) => set('faq', faq.map((x, k) => (k === i ? { ...x, a: e.target.value } : x)))} className="w-full rounded-lg border border-white/10 bg-white/5 p-2 text-sm text-white" />
          </div>
        ))}
        <button type="button" onClick={() => set('faq', [...faq, { q: '', a: '' }])} className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-white/15 bg-transparent py-1.5 text-[11px] text-white/50"><Plus className="h-3 w-3" /> Вопрос</button>
      </div>
    </div>
  );
}
