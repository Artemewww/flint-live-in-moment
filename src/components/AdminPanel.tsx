import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Lock, Unlock, Calendar, Users, Edit, Save, Plus, Trash2, Eye, EyeOff, Shield, RefreshCw, Send, CheckCircle, XCircle, BarChart3, MapPin, Package, DollarSign, Clock, FileText, Settings, Bell, UserCheck, UserX, ClipboardList, Truck, Flag, Play, Pause, X as XIcon, RotateCcw, ShoppingCart, ChefHat, Tent, Navigation, Award, MessageSquare, Star, UserPlus, UserMinus, Globe, Key, CheckSquare, Square, Activity, Heart, Vote } from 'lucide-react';
import { CommunityEvent, HouseQuality } from '../types';
import { HOUSE_QUALITIES, qualitiesFromKeys } from '../houseQualities';
import { generateProgram, generateThreshold } from '../eventGuide';

const API_BASE = typeof window !== 'undefined' ? window.location.origin + '/api' : '';

/**
 * Секрета в браузере больше нет: сервер выдаёт подписанную httpOnly-куку,
 * fetch подставляет её сам (credentials по умолчанию 'same-origin').
 * Раньше здесь лежал пароль, и он уезжал в публичный JS-бандл.
 */

/** ИИ-генерация программы (Gemini). Возвращает null при ошибке/без ключа — тогда фолбэк на локальный генератор. */
async function aiProgram(ev: any): Promise<string[] | null> {
  try {
    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: 'program', event: ev, people: ev.maxParticipants }),
    });
    const j = await res.json();
    return Array.isArray(j.program) && j.program.length ? j.program : null;
  } catch { return null; }
}

/** ИИ-автозаполнение всего события по названию (Gemini). Возвращает {draft?, error?}. */
async function aiAutofill(ev: any): Promise<{ draft?: any; error?: string }> {
  try {
    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: 'autofill', event: ev }),
    });
    const j = await res.json();
    if (j.draft) return { draft: j.draft };
    return { error: j.error || `HTTP ${res.status}` };
  } catch (e) { return { error: (e as Error).message }; }
}

/** Редактор списка (программа / порог входа): генерация, правка, ↑↓, удаление, добавление. */
function ListEditor({ label, items, onChange, onGenerate, placeholder, aiHint }: {
  label: string; items: string[]; onChange: (v: string[]) => void; onGenerate: () => void | Promise<void>; placeholder?: string; aiHint?: boolean;
}) {
  const [gen, setGen] = useState(false);
  const upd = (i: number, val: string) => { const c = [...items]; c[i] = val; onChange(c); };
  const del = (i: number) => onChange(items.filter((_, x) => x !== i));
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const c = [...items];
    [c[i], c[j]] = [c[j], c[i]];
    onChange(c);
  };
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-[10px] text-white/40 uppercase font-mono">{label}</label>
        <button type="button" disabled={gen} onClick={async () => { setGen(true); try { await onGenerate(); } finally { setGen(false); } }} className="text-[10px] font-bold text-brand bg-brand/10 border border-brand/30 rounded-lg px-2 py-1 cursor-pointer hover:bg-brand/20 transition-colors disabled:opacity-60">
          {gen ? '⏳ Генерирую…' : `${aiHint ? '🤖' : '⚡'} ${items.length ? 'Перегенерировать' : 'Сгенерировать'}`}
        </button>
      </div>
      <div className="space-y-1.5">
        {items.map((it, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span className="text-[10px] text-white/30 font-mono w-4 shrink-0">{i + 1}</span>
            <input value={it} placeholder={placeholder} onChange={(e) => upd(i, e.target.value)} className="flex-1 bg-white/5 border border-white/10 rounded-lg p-2 text-white text-sm" />
            <button type="button" onClick={() => move(i, -1)} className="text-white/40 hover:text-white px-1 cursor-pointer bg-transparent border-none" title="Вверх">↑</button>
            <button type="button" onClick={() => move(i, 1)} className="text-white/40 hover:text-white px-1 cursor-pointer bg-transparent border-none" title="Вниз">↓</button>
            <button type="button" onClick={() => del(i)} className="text-red-400/70 hover:text-red-400 px-1 cursor-pointer bg-transparent border-none" title="Удалить">✕</button>
          </div>
        ))}
        <button type="button" onClick={() => onChange([...items, ''])} className="text-[11px] text-white/50 hover:text-white border border-dashed border-white/15 hover:border-white/30 rounded-lg px-2 py-1.5 w-full cursor-pointer bg-transparent transition-colors">
          ＋ Добавить пункт
        </button>
      </div>
    </div>
  );
}

/** ИИ-список закупки: по числу участников и раскладке по питанию (Gemini). */
function ShoppingGenerator({ event, registrations }: { event: any; registrations: any[] }) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const people = registrations.length || event.maxParticipants || 10;
  const diet = {
    vegan: registrations.filter((r) => r.dietary === 'vegan').length,
    vegetarian: registrations.filter((r) => r.dietary === 'vegetarian').length,
    children: registrations.reduce((s, r) => s + (r.childrenCount || 0), 0),
  };
  const gen = async () => {
    setLoading(true); setErr('');
    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: 'shopping', event, people, diet }),
      });
      const j = await res.json();
      if (j.error) setErr(j.error); else setItems(j.items || []);
    } catch (e) { setErr((e as Error).message); }
    setLoading(false);
  };
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-bold uppercase flex items-center gap-2"><ShoppingCart className="w-4 h-4 text-brand" /> Список закупки (ИИ) · {people} чел</h4>
        <button type="button" onClick={gen} disabled={loading} className="text-[10px] font-bold text-brand bg-brand/10 border border-brand/30 rounded-lg px-2 py-1 cursor-pointer hover:bg-brand/20 disabled:opacity-60 shrink-0">
          {loading ? '⏳ Считаю…' : '🤖 Сгенерировать'}
        </button>
      </div>
      <p className="text-[9px] text-white/35 font-mono">Веган: {diet.vegan} · вегет.: {diet.vegetarian} · детей: {diet.children}. Пересчитывается под текущее число участников.</p>
      {err && <p className="text-[11px] text-red-400">{err}</p>}
      {items.length > 0 && (
        <div className="space-y-1">
          {items.map((it, i) => (
            <div key={i} className="flex justify-between gap-3 text-xs border-b border-white/5 py-1">
              <span className="text-white/85">{it.item}</span>
              <span className="text-white/45 font-mono text-right shrink-0">{it.qty}{it.note ? ` · ${it.note}` : ''}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Реквизиты оплаты события (ЕРИП / карта / способ) — показывается для платных. */
function PaymentDetailsEditor({ value, onChange }: { value: any; onChange: (v: any) => void }) {
  const v = value || {};
  const set = (k: string, val: any) => onChange({ ...v, [k]: val });
  const inp = 'w-full bg-white/5 border border-white/10 rounded-lg p-2 text-white text-sm placeholder:text-white/30';
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-3 space-y-2">
      <label className="text-[10px] text-white/40 uppercase font-mono block">💳 Реквизиты оплаты</label>
      <input value={v.erip || ''} onChange={(e) => set('erip', e.target.value)} placeholder="ЕРИП / номер услуги" className={inp} />
      <input value={v.card || ''} onChange={(e) => set('card', e.target.value)} placeholder="Номер карты" className={inp} />
      <input value={v.method || ''} onChange={(e) => set('method', e.target.value)} placeholder="Способ / комментарий (напр. перевод по номеру телефона)" className={inp} />
    </div>
  );
}

/** Структурный редактор логистики события (точка/время выезда, бензин, обратная дорога). */
function LogisticsEditor({ value, onChange }: { value: any; onChange: (v: any) => void }) {
  const v = value || {};
  const set = (k: string, val: any) => onChange({ ...v, [k]: val });
  const inp = 'w-full bg-white/5 border border-white/10 rounded-lg p-2 text-white text-sm placeholder:text-white/30';
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-3 space-y-2">
      <label className="text-[10px] text-white/40 uppercase font-mono block">🚗 Логистика / как добраться</label>
      <input value={v.assemblyPoint || ''} onChange={(e) => set('assemblyPoint', e.target.value)} placeholder="Точка сбора / выезда (напр. м. Каменная Горка)" className={inp} />
      <div className="grid grid-cols-2 gap-2">
        <input value={v.departureTime || ''} onChange={(e) => set('departureTime', e.target.value)} placeholder="Время выезда (18:30)" className={inp} />
        <input type="number" value={v.fuelCost || ''} onChange={(e) => set('fuelCost', parseInt(e.target.value) || 0)} placeholder="Бензин ₽/чел" className={inp} />
      </div>
      <input value={v.returnInfo || ''} onChange={(e) => set('returnInfo', e.target.value)} placeholder="Обратная дорога (напр. ~22:00 обратно к метро)" className={inp} />
      <textarea value={v.notes || ''} onChange={(e) => set('notes', e.target.value)} placeholder="Как добраться / доп. детали" rows={2} className={inp} />
    </div>
  );
}

/** Кликабельные теги 6 качеств «Дома Личности». Выбранные «горят». */
function QualityChips({ selected, onChange }: { selected: HouseQuality[]; onChange: (q: HouseQuality[]) => void }) {
  const keys = new Set<HouseQuality['key']>((selected || []).map(q => q.key));
  const toggle = (key: HouseQuality['key']) => {
    const next = new Set(keys);
    if (next.has(key)) next.delete(key); else next.add(key);
    onChange(qualitiesFromKeys([...next]));
  };
  return (
    <div>
      <label className="text-[10px] text-white/40 uppercase font-mono block mb-1">Качества «Дома Личности» — что развивает событие</label>
      <div className="flex flex-wrap gap-2">
        {HOUSE_QUALITIES.map(q => {
          const on = keys.has(q.key);
          return (
            <button
              key={q.key}
              type="button"
              onClick={() => toggle(q.key)}
              title={q.description}
              className={`px-3 py-1.5 rounded-xl text-[11px] font-bold border transition-all cursor-pointer flex items-center gap-1.5 ${on ? 'bg-brand/15 border-brand/40 text-brand shadow-[0_0_10px_rgba(230,253,58,0.15)]' : 'bg-white/5 border-white/10 text-white/40 hover:border-white/25'}`}
            >
              <span>{q.emoji}</span>{q.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Загрузка картинки файлом: сжатие в браузере → data-URL прямо в поле (без Storage/RLS). */
function ImageUploadField({ value, onChange }: { value: string; onChange: (url: string) => void }) {
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  /** Читает файл, ужимает до макс. 1280px и JPEG q0.82 — обычно <200 КБ. */
  const compress = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Не удалось открыть изображение'));
      img.onload = () => {
        const max = 1280;
        let { width, height } = img;
        if (width > max || height > max) {
          const k = Math.min(max / width, max / height);
          width = Math.round(width * k);
          height = Math.round(height * k);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('Canvas недоступен'));
        ctx.drawImage(img, 0, 0, width, height);
        // SVG/прозрачность → оставляем как есть; иначе JPEG для лёгкости.
        const out = file.type === 'image/svg+xml' ? String(reader.result) : canvas.toDataURL('image/jpeg', 0.82);
        resolve(out);
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });

  const handleFile = async (file: File) => {
    if (!file) return;
    setErr('');
    setUploading(true);
    try {
      const dataUrl = await compress(file);
      onChange(dataUrl);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <label className="text-[10px] text-white/40 uppercase font-mono block mb-1">Картинка события</label>
      {value ? (
        <div className="relative">
          <img src={value} alt="" className="w-full h-32 object-cover rounded-xl border border-white/10" onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0.3'; }} />
          <button type="button" onClick={() => onChange('')} className="absolute top-2 right-2 bg-black/70 hover:bg-red-500/80 text-white rounded-lg px-2 py-1 text-xs cursor-pointer border-none" title="Удалить картинку">✕ Удалить</button>
          <button type="button" onClick={() => inputRef.current?.click()} className="absolute bottom-2 right-2 bg-black/70 hover:bg-brand/80 hover:text-black text-white rounded-lg px-2 py-1 text-[10px] cursor-pointer border-none" title="Заменить">Заменить</button>
        </div>
      ) : (
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }}
          className="w-full h-32 rounded-xl border-2 border-dashed border-white/15 hover:border-brand/40 bg-white/5 flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors text-white/40"
        >
          <span className="text-2xl">🖼️</span>
          <span className="text-[11px] font-mono">{uploading ? 'Загрузка…' : 'Нажми или перетащи файл'}</span>
          <span className="text-[9px] text-white/25">PNG / JPG / WEBP, до 6 МБ</span>
        </div>
      )}
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />
      {err && <p className="text-[10px] text-red-400 mt-1">{err}</p>}
    </div>
  );
}

// Приводим заявку из БД (snake_case) к виду, который ждёт интерфейс (camelCase).
function mapRegistration(r: any) {
  return {
    id: r.id,
    name: r.name || 'Гость',
    telegram: r.username || (r.telegram_id != null ? String(r.telegram_id) : ''),
    telegramId: r.telegram_id,
    phone: r.phone || '',
    status: r.status || 'pending',
    paymentStatus: r.payment_status || 'pending',
    paymentAmount: r.payment_amount || 0,
    hasTransport: r.has_transport || false,
    transportDetails: r.transport_details || '',
    transportSeats: r.transport_seats || 0,
    inventory: r.inventory || [],
    inviter: r.inviter || '',
    category: r.category || '',
    dietary: r.dietary || '',
    guestCount: r.guest_count || 0,
    childrenCount: r.children_count || 0,
    foodOptout: r.food_optout || false,
    attended: r.attended || false,
    equipment: r.equipment || [],
    roles: r.roles || [],
    days: r.days || [],
    source: r.source || '',
  };
}

// Считаем статистику по заявкам единообразно на клиенте.
function buildStats(regs: any[], extra: Record<string, any> = {}) {
  return {
    total: regs.length,
    confirmed: regs.filter((r) => r.status === 'confirmed').length,
    pending: regs.filter((r) => r.status === 'pending').length,
    payments: regs.filter((r) => r.paymentStatus === 'paid').length,
    attended: regs.filter((r) => r.attended).length,
    totalAmount: regs.reduce((s, r) => s + (r.paymentAmount || 0), 0),
    registrations: regs,
    rides: [] as any[],
    rideRequests: [] as any[],
    feedback: [] as any[],
    interestCount: 0,
    voteTally: {} as Record<string, number>,
    ...extra,
  };
}

/** Поле модалки ввода. Нативные пикеры даты/времени вместо системного prompt. */
interface InputField {
  key: string;
  label: string;
  type: 'text' | 'date' | 'time' | 'textarea' | 'select' | 'checkbox';
  value?: string;
  placeholder?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  hint?: string;
}
interface InputModalSpec {
  title: string;
  fields: InputField[];
  submitLabel?: string;
  onSubmit: (values: Record<string, string>) => void;
}

/** Аккуратная модалка ввода: даты через нативный date-picker, а не белый prompt. */
function InputModal({ spec, onClose }: { spec: InputModalSpec; onClose: () => void }) {
  const [vals, setVals] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of spec.fields) init[f.key] = f.value ?? (f.type === 'checkbox' ? '' : '');
    return init;
  });
  const [err, setErr] = useState('');
  const inp = 'w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white text-sm focus:outline-none focus:border-brand/40';

  const submit = () => {
    for (const f of spec.fields) {
      if (f.required && f.type !== 'checkbox' && !vals[f.key]?.trim()) { setErr(`Заполни: ${f.label}`); return; }
    }
    spec.onSubmit(vals);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-end md:items-center justify-center md:p-4">
      <div className="absolute inset-0 bg-black/95 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }}
        className="bg-[#161616] md:rounded-3xl rounded-t-3xl w-full max-w-md relative z-10 border border-white/10 p-5 space-y-4 text-white"
      >
        <h3 className="font-display font-black text-lg uppercase">{spec.title}</h3>
        {spec.fields.map((f) => (
          <div key={f.key} className="space-y-1">
            {f.type !== 'checkbox' && <label className="text-[10px] text-white/40 uppercase font-mono block">{f.label}</label>}
            {f.type === 'textarea' ? (
              <textarea value={vals[f.key]} placeholder={f.placeholder} rows={3} onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))} className={inp} />
            ) : f.type === 'select' ? (
              <select value={vals[f.key]} onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))} className={inp}>
                <option value="">— выбери —</option>
                {(f.options || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : f.type === 'checkbox' ? (
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={vals[f.key] === '1'} onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.checked ? '1' : '' }))} className="w-4 h-4 accent-brand" />
                <span className="text-sm text-white/80">{f.label}</span>
              </label>
            ) : (
              <input type={f.type} value={vals[f.key]} placeholder={f.placeholder} onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))} className={inp} />
            )}
            {f.hint && <p className="text-[10px] text-white/30">{f.hint}</p>}
          </div>
        ))}
        {err && <p className="text-[11px] text-rose-400">{err}</p>}
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 bg-white/5 hover:bg-white/10 text-white/70 py-3 rounded-xl text-xs font-bold uppercase cursor-pointer border-none">Отмена</button>
          <button onClick={submit} className="flex-1 bg-brand hover:bg-brand-hover text-black py-3 rounded-xl text-xs font-bold uppercase cursor-pointer border-none">{spec.submitLabel || 'Готово'}</button>
        </div>
      </motion.div>
    </div>
  );
}

/** Средняя оценка по отзывам, одна цифра после запятой. */
function avgRating(feedback: any[]): string {
  if (!feedback.length) return '—';
  return (feedback.reduce((s, f) => s + (f.rating || 0), 0) / feedback.length).toFixed(1);
}

/** Пункты чек-листа готовности. Ключи уходят в events.checklist как есть. */
const CHECKLIST_ITEMS: { key: string; label: string }[] = [
  { key: 'voting', label: 'Голосование за программу завершено' },
  { key: 'program', label: 'Программа согласована и разослана' },
  { key: 'menu', label: 'Меню питания утверждено' },
  { key: 'buyer', label: 'Закупщик найден или закупка распределена' },
  { key: 'bought', label: 'Закупка выполнена и подтверждена' },
  { key: 'coords', label: 'Координаты лагеря разосланы участникам' },
  { key: 'started', label: 'Мероприятие стартовало' },
  { key: 'finished', label: 'Мероприятие завершено' },
  { key: 'feedback', label: 'Отзывы собраны' },
];

interface AdminPanelProps {
  events: CommunityEvent[];
  onUpdateEvent: (event: CommunityEvent) => void;
  onAddEvent: (event: CommunityEvent) => void;
  onDeleteEvent: (eventId: string) => void;
  onClose: () => void;
}

const MONTHS_RU = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const DOW_RU = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];

/** Сколько дней до старта (0 = сегодня, отрицательное = прошло). */
function daysUntil(date?: string): number | null {
  if (!date) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(`${date}T00:00:00`);
  if (isNaN(d.getTime())) return null;
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

/** Короткая метка отсчёта для админки: «сегодня», «завтра», «через 5 дн.», «прошло». */
function countdownLabel(date?: string): string {
  const n = daysUntil(date);
  if (n === null) return '';
  if (n < 0) return 'прошло';
  if (n === 0) return 'сегодня';
  if (n === 1) return 'завтра';
  return `через ${n} дн.`;
}

/** События по близости старта: ближайшие вверху, прошедшие в конце. */
function sortByNearest(list: any[]): any[] {
  return [...list].sort((a, b) => {
    const da = daysUntil(a.date), db = daysUntil(b.date);
    const ka = da === null ? 1e9 : da < 0 ? 1e8 - da : da;   // прошедшие — в самый низ
    const kb = db === null ? 1e9 : db < 0 ? 1e8 - db : db;
    return ka - kb;
  });
}

/** Человекочитаемая подпись даты: один день или диапазон (многодневное). */
function buildDateLabel(date: string, dateEnd: string, time: string): string {
  if (!date) return '';
  const d = new Date(date + 'T00:00:00');
  const day = d.getDate();
  const mon = MONTHS_RU[d.getMonth()];
  const t = time ? `, ${time}` : '';
  if (dateEnd && dateEnd !== date) {
    const e = new Date(dateEnd + 'T00:00:00');
    const left = e.getMonth() === d.getMonth() ? `${day}` : `${day} ${mon}`;
    return `${left}–${e.getDate()} ${MONTHS_RU[e.getMonth()]}${t}`;
  }
  return `${day} ${mon} (${DOW_RU[d.getDay()]})${t}`;
}

/** Сессия админки живёт 12 часов — чтобы не вводить пароль на каждой перезагрузке. */
const SESSION_KEY = 'flint_admin_session';
const SESSION_TTL = 12 * 60 * 60 * 1000;

function readSession(): boolean {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return false;
    const { at } = JSON.parse(raw);
    if (Date.now() - at > SESSION_TTL) { localStorage.removeItem(SESSION_KEY); return false; }
    return true;
  } catch { return false; }
}

/** Стабильный id вкладки — по нему считается присутствие в админке. */
function tabId(): string {
  try {
    let id = sessionStorage.getItem('flint_admin_tab');
    if (!id) { id = Math.random().toString(36).slice(2, 12); sessionStorage.setItem('flint_admin_tab', id); }
    return id;
  } catch { return 'anon'; }
}

export default function AdminPanel({ events, onUpdateEvent, onAddEvent, onDeleteEvent, onClose }: AdminPanelProps) {
  const [isAuthenticated, setIsAuthenticated] = useState(readSession);
  const [onlineAdmins, setOnlineAdmins] = useState<{ id: string; name: string }[]>([]);
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CommunityEvent | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [broadcasting, setBroadcasting] = useState<string | null>(null);
  const [broadcastResult, setBroadcastResult] = useState<{eventId: string, success: boolean, message: string} | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<CommunityEvent | null>(null);
  const [eventStats, setEventStats] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'participants' | 'logistics' | 'settings'>('overview');
  const [showTemplates, setShowTemplates] = useState(false);
  /** Тост результата последнего действия админа (сохранение, рассылка). */
  const [actionMsg, setActionMsg] = useState<{ ok: boolean; text: string } | null>(null);
  /** Вкладка «Участники»: показывать всех или только тех, кто реально приехал. */
  const [onlyAttended, setOnlyAttended] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  /** Фильтр списка участников. Клик по карточке на «Обзоре» ставит нужный. */
  const [partFilter, setPartFilter] = useState<'all' | 'confirmed' | 'pending' | 'paid'>('all');
  /** Какая панель раскрыта во вкладке «Логистика». */
  const [logiPanel, setLogiPanel] = useState<'shopping' | 'cooking' | 'gear' | null>(null);
  /** Модалка ввода вместо системных window.prompt (даты, причины, объявления). */
  const [inputModal, setInputModal] = useState<InputModalSpec | null>(null);
  /** Аудитория клуба (все участники, не по событию). */
  const [showAudience, setShowAudience] = useState(false);
  const [audience, setAudience] = useState<any>(null);

  /** Открыть вкладку участников с готовым фильтром (клик по карточке статистики). */
  const openParticipants = (filter: typeof partFilter, attended = false) => {
    setPartFilter(filter);
    setOnlyAttended(attended);
    setShowFeedback(false);
    setActiveTab('participants');
  };

  /** Загрузка всей аудитории клуба (эндпоинт ?action=members). */
  const loadAudience = async () => {
    try {
      const res = await fetch('/api/admin/registrations?action=members');
      if (res.status === 401) { handleLogout(); return; }
      const j = await res.json();
      setAudience(j);
    } catch (e) {
      setActionMsg({ ok: false, text: 'Не удалось загрузить участников' });
    }
  };

  // Тост гаснет сам — чтобы не копился поверх интерфейса.
  useEffect(() => {
    if (!actionMsg) return;
    const t = setTimeout(() => setActionMsg(null), 4000);
    return () => clearTimeout(t);
  }, [actionMsg]);

  // Шаблоны мероприятий
  const eventTemplates = [
    {
      title: 'Мужская баня FLINT',
      type: 'male' as const,
      time: '19:00',
      timeEnd: '23:00',
      maxParticipants: 12,
      priceLabel: 'Аренда делится на всех • при 10+ ≈ 50 ₽/чел',
      priceAmount: 500,
      entryThreshold: 'Только мужчины • 100% трезвость • личный веник',
      entryType: 'male' as const,
      description: 'Каноническая перезагрузка ума и тела. Профессиональный пар, закалка ледяной купелью, глубокий прогрев дубовыми вениками и честные разговоры по душам у открытого камина.',
      image: '/assets/images/nano_banya_flint_1780473778276.png',
      program: [
        '18:30 - Сбор, знакомство',
        '19:00 - Парилка (дубовые веники)',
        '20:30 - Перекус, чай',
        '21:00 - Честные разговоры у камина',
        '23:00 - Завершение'
      ]
    },
    {
      title: 'Гиревой вояж у воды',
      type: 'active' as const,
      time: '10:00',
      timeEnd: '12:00',
      maxParticipants: 15,
      priceLabel: 'Свободный вход',
      priceAmount: 0,
      entryThreshold: '100% трезвость • спортивная форма',
      entryType: 'all' as const,
      description: 'Утренняя силовая пробежка у Минского моря. Гири, зарядка, свежий воздух.',
      image: '/assets/images/kettlebell_walk.png',
      program: [
        '10:00 - Сбор, разминка',
        '10:15 - Силовая тренировка',
        '11:30 - Закалка, купание',
        '12:00 - Завершение'
      ]
    },
    {
      title: 'Экзистенциальный Кинотеатр',
      type: 'intellectual' as const,
      time: '19:30',
      timeEnd: '22:00',
      maxParticipants: 20,
      priceLabel: 'Свободный вход',
      priceAmount: 0,
      entryThreshold: '100% трезвость',
      entryType: 'all' as const,
      description: 'Рефлексия и глубокий разбор великих кинокартин. Философские дискуссии после просмотра.',
      image: '/assets/images/cinema.png',
      program: [
        '19:30 - Знакомство',
        '19:45 - Просмотр фильма',
        '21:30 - Философская дискуссия',
        '22:00 - Завершение'
      ]
    },
    {
      title: 'Читательский круг "Смыслы"',
      type: 'intellectual' as const,
      time: '16:00',
      timeEnd: '19:00',
      maxParticipants: 15,
      priceLabel: 'Свободный вход',
      priceAmount: 0,
      entryThreshold: '100% трезвость • книга прочитана',
      entryType: 'all' as const,
      description: 'Интеллектуальный разбор психологических трудов. Глубокие вопросы и честные ответы.',
      image: '/assets/images/reading.png',
      program: [
        '16:00 - Знакомство',
        '16:15 - Обсуждение книги',
        '17:30 - Глубокие вопросы',
        '19:00 - Завершение'
      ]
    },
    {
      title: 'Лесной поход к Ислочи',
      type: 'active' as const,
      time: '08:00',
      timeEnd: '20:00',
      maxParticipants: 12,
      priceLabel: 'Аренда делится на всех',
      priceAmount: 300,
      entryThreshold: '100% трезвость • спортивная форма • палатка',
      entryType: 'all' as const,
      description: 'Проводники, дикий костер и лесные переходы. Полный день на природе.',
      image: '/assets/images/hiking.png',
      program: [
        '08:00 - Сбор, выезд',
        '10:00 - Начало перехода',
        '13:00 - Обед у костра',
        '16:00 - Осмотр достопримечательностей',
        '18:00 - Возвращение',
        '20:00 - Завершение'
      ]
    },
    {
      title: 'Покерный заезд "Трезвый круг"',
      type: 'mixed' as const,
      time: '18:00',
      timeEnd: '23:00',
      maxParticipants: 16,
      priceLabel: 'Свободный вход',
      priceAmount: 0,
      entryThreshold: '100% трезвость',
      entryType: 'all' as const,
      description: 'Тлеющие угольки, мандарины, апельсиновый сок и глубокая математика.',
      image: '/assets/images/poker.png',
      program: [
        '18:00 - Знакомство, раздача карт',
        '18:30 - Турнир',
        '21:00 - Перерыв, угощения',
        '21:30 - Финальный стол',
        '23:00 - Завершение'
      ]
    }
  ];

  const createFromTemplate = (template: typeof eventTemplates[0]) => {
    const eventDate = new Date();
    eventDate.setDate(eventDate.getDate() + 7); // +7 дней
    
    const newEvent: CommunityEvent = {
      id: `event-${Date.now()}`,
      title: template.title,
      description: template.description,
      type: template.type,
      date: eventDate.toISOString().split('T')[0],
      dateLabel: `Через 7 дней (${eventDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' })})`,
      time: template.time || '19:00',
      timeEnd: template.timeEnd || '23:00',
      location: 'Уточняется',
      painPoint: '',
      houseQualities: [],
      image: template.image || '/assets/images/default_event.png',
      maxParticipants: template.maxParticipants,
      participantsCount: 0,
      telegramBotUrl: 'https://t.me/campsflint_bot',
      priceType: template.priceAmount > 0 ? 'paid' : 'free',
      priceLabel: template.priceLabel,
      priceAmount: template.priceAmount,
      entryThreshold: template.entryThreshold,
      entryType: template.entryType,
      status: 'locked',
      program: template.program,
      notifications: {
        reminder7d: true,
        reminder3d: true,
        reminder1d: true,
        reminder3h: true,
        reminder1h: true
      }
    };
    onAddEvent(newEvent);
    setShowTemplates(false);
  };

  const handleLogin = async () => {
    setLoginError('');
    setLoggingIn(true);
    try {
      const res = await fetch('/api/admin/events?action=login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        setLoginError(res.status === 401 ? 'Неверный пароль' : `Ошибка входа (${res.status})`);
        return;
      }
      // Сама сессия — в httpOnly-куке. Здесь только пометка, чтобы не мигать формой.
      try { localStorage.setItem(SESSION_KEY, JSON.stringify({ at: Date.now() })); } catch { /* приватный режим */ }
      setIsAuthenticated(true);
      setPassword('');
    } catch (e) {
      setLoginError((e as Error).message);
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try { localStorage.removeItem(SESSION_KEY); } catch { /* no-op */ }
    try { await fetch('/api/admin/events?action=logout', { method: 'POST' }); } catch { /* no-op */ }
    setIsAuthenticated(false);
    setPassword('');
  };

  // Пульс присутствия: кто ещё сидит в админке прямо сейчас.
  useEffect(() => {
    if (!isAuthenticated) return;
    const name = (() => {
      try { return localStorage.getItem('flint_admin_name') || 'Админ'; } catch { return 'Админ'; }
    })();
    let alive = true;
    const beat = async () => {
      try {
        const res = await fetch(`/api/admin/events?action=presence&id=${encodeURIComponent(tabId())}&name=${encodeURIComponent(name)}`, {
                  });
        const data = await res.json();
        if (alive && Array.isArray(data.users)) setOnlineAdmins(data.users);
      } catch { /* офлайн — просто не обновляем */ }
    };
    beat();
    const t = setInterval(beat, 20000);
    return () => { alive = false; clearInterval(t); };
  }, [isAuthenticated]);

  const toggleEventStatus = (event: CommunityEvent) => {
    const newStatus = event.status === 'open' ? 'locked' : 'open';
    onUpdateEvent({ ...event, status: newStatus });
  };

  const updateParticipants = (event: CommunityEvent, count: number) => {
    onUpdateEvent({ ...event, participantsCount: count });
  };

  /** Перезагрузить данные события, не сбрасывая активную вкладку. */
  const refreshStats = async (event: CommunityEvent) => {
    try {
      const res = await fetch(`/api/admin/registrations?eventId=${encodeURIComponent(event.id)}`);
      // Кука протухла (12 ч) — просим войти заново, а не показываем пустые данные.
      if (res.status === 401) { handleLogout(); return false; }
      if (res.ok) {
        const data = await res.json();
        const regs = (data.registrations || []).map(mapRegistration);
        setEventStats(buildStats(regs, {
          rides: data.rides || [],
          rideRequests: data.rideRequests || [],
          feedback: data.feedback || [],
          interestCount: data.interestCount || 0,
          voteTally: data.voteTally || {},
        }));
        return true;
      }
    } catch (err) {
      console.error('Не удалось загрузить данные события:', err);
    }
    return false;
  };

  const loadEventStats = async (event: CommunityEvent) => {
    setSelectedEvent(event);
    const ok = await refreshStats(event);
    if (!ok) setEventStats(buildStats([]));
    setActiveTab('overview');
  };

  /**
   * Точечное обновление события (жизненный цикл, чек-лист, публичность).
   * PATCH не перезаписывает поля, которых нет в теле, — в отличие от POST-upsert.
   */
  const patchEvent = async (patch: Record<string, unknown>) => {
    if (!selectedEvent) return;
    try {
      const res = await fetch(`/api/admin/events?eventId=${encodeURIComponent(selectedEvent.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setActionMsg({ ok: false, text: data.details || data.error || 'Не удалось сохранить' });
        return;
      }
      const merged = { ...selectedEvent, ...(patch as any) } as CommunityEvent;
      setSelectedEvent(merged);
      onUpdateEvent(merged);
      setActionMsg({ ok: true, text: 'Сохранено' });
    } catch (err) {
      setActionMsg({ ok: false, text: (err as Error).message });
    }
  };

  /** Отправить участникам произвольный текст в Telegram (через серверную рассылку). */
  const sendMessageToAll = async (message: string) => {
    if (!selectedEvent) return;
    setBroadcasting(selectedEvent.id);
    try {
      const res = await fetch('/api/admin/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: selectedEvent.id, message }),
      });
      const data = await res.json().catch(() => ({}));
      setActionMsg({
        ok: !!data.ok,
        text: data.ok ? `Отправлено ${data.sent}/${data.total}` : (data.message || data.error || 'Некому слать'),
      });
    } catch (err) {
      setActionMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBroadcasting(null);
    }
  };

  const broadcastEvent = async (event: CommunityEvent) => {
    setBroadcasting(event.id);
    setBroadcastResult(null);
    try {
      // Рассылка идёт на сервере (токен бота не в браузере, безопасно).
      const res = await fetch('/api/admin/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: event.id }),
      });
      const data = await res.json().catch(() => ({}));
      setBroadcastResult({
        eventId: event.id,
        success: !!data.ok,
        message: data.ok
          ? `Отправлено ${data.sent}/${data.total} участникам`
          : (data.message || data.error || 'Некому слать (нет Telegram-получателей)'),
      });
      setTimeout(() => setBroadcastResult(null), 6000);
    } catch (error) {
      setBroadcastResult({ eventId: event.id, success: false, message: 'Ошибка рассылки' });
    } finally {
      setBroadcasting(null);
    }
  };

  // Обновить статус/оплату/явку участника и перечитать список.
  const patchRegistration = async (reg: any, patch: Record<string, unknown>) => {
    try {
      await fetch(`/api/admin/registrations?registrationId=${encodeURIComponent(reg.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
    } catch (err) {
      setActionMsg({ ok: false, text: 'Ошибка обновления участника' });
    }
    if (selectedEvent) await refreshStats(selectedEvent);
  };

  if (!isAuthenticated) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" id="admin-panel-root">
        <div className="absolute inset-0 bg-black/90 backdrop-blur-md" onClick={onClose} />

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-[#121212] rounded-3xl w-full max-w-sm shadow-2xl relative z-10 border border-white/10 p-6 space-y-4 text-white"
        >
          <h2 className="font-display font-black text-xl uppercase text-center">Админ-панель</h2>

          <div className="space-y-3">
            <input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setLoginError(''); }}
              placeholder="Пароль"
              autoFocus
              className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white text-sm focus:outline-none focus:border-brand/40"
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
            />
            {loginError && <p className="text-[11px] text-rose-400">{loginError}</p>}
            <p className="text-[10px] text-white/35 text-center">Вход запомнится на 12 часов</p>
            <button
              onClick={handleLogin}
              disabled={loggingIn || !password}
              className="w-full bg-brand hover:bg-brand-hover text-black py-3 rounded-xl text-xs font-bold uppercase tracking-widest disabled:opacity-50 cursor-pointer border-none"
            >
              {loggingIn ? 'Проверяю…' : 'Войти'}
            </button>
          </div>

          <button
            onClick={onClose}
            className="w-full text-white/60 text-xs uppercase tracking-wider"
          >
            Отмена
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center md:p-4" id="admin-panel-root">
      <div className="absolute inset-0 bg-black/90 backdrop-blur-md" onClick={onClose} />

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-[#121212] md:rounded-3xl w-full max-w-6xl shadow-2xl relative z-10 border border-white/10 flex flex-col h-[100dvh] md:h-auto md:max-h-[92vh] text-white"
      >
        {/* Header */}
        <div className="p-4 md:p-6 border-b border-white/10 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display font-black text-lg md:text-2xl uppercase">Админка</h2>
            <button
              onClick={() => { setShowAudience(true); loadAudience(); }}
              className="text-[11px] text-brand font-mono uppercase hover:underline cursor-pointer bg-transparent border-none p-0"
            >
              👥 Аудитория клуба →
            </button>
          </div>
          <div className="flex items-center gap-2">
            <div
              className="flex items-center gap-1.5 bg-white/5 border border-white/10 rounded-full px-3 py-1.5"
              title={onlineAdmins.length ? onlineAdmins.map((u) => u.name).join(', ') : 'Только ты'}
            >
              <span className="w-2 h-2 rounded-full bg-brand animate-pulse" />
              <span className="text-[10px] font-mono text-white/70">
                в админке: {onlineAdmins.length || 1}
              </span>
            </div>
            <button
              onClick={handleLogout}
              className="text-[10px] font-mono uppercase text-white/50 hover:text-white bg-white/5 hover:bg-white/10 border-none rounded-full px-3 py-2 cursor-pointer"
              title="Выйти и забыть сессию"
            >
              Выйти
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-full bg-white/5 hover:bg-white/10 cursor-pointer border-none text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Результат последнего действия — иначе кнопки «молчат» и непонятно, сработали ли */}
        {actionMsg && (
          <div className={`px-6 py-2 text-xs flex items-center gap-2 border-b ${actionMsg.ok ? 'bg-brand/10 text-brand border-brand/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'}`}>
            {actionMsg.ok ? <CheckCircle className="w-4 h-4 shrink-0" /> : <XCircle className="w-4 h-4 shrink-0" />}
            <span>{actionMsg.text}</span>
          </div>
        )}

        <div className="flex flex-col md:flex-row flex-1 overflow-hidden min-h-0">
          {/* Список событий. На мобильном прячется, когда открыто конкретное событие. */}
          <div className={`w-full md:w-80 shrink-0 border-b md:border-b-0 md:border-r border-white/10 overflow-y-auto p-4 space-y-3 md:max-h-none ${selectedEvent ? 'hidden md:block' : 'block'}`}>
            <div className="flex items-center justify-between mb-4">
              <span className="text-white/40 text-[10px] uppercase font-mono">Мероприятия: {events.length}</span>
              <div className="flex gap-1">
                <button
                  onClick={() => setShowTemplates(true)}
                  className="bg-white/5 hover:bg-white/10 text-white/60 hover:text-white p-2 rounded-lg"
                  title="Шаблоны"
                >
                  <FileText className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setShowAddForm(true)}
                  className="bg-brand hover:bg-brand-hover text-black p-2 rounded-lg"
                  title="Добавить мероприятие"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            {sortByNearest(events).map(event => {
              const cd = countdownLabel(event.date);
              const soon = (daysUntil(event.date) ?? 99) <= 3 && (daysUntil(event.date) ?? -1) >= 0;
              return (
              <div
                key={event.id}
                className={`p-3 rounded-xl border cursor-pointer transition-all ${
                  selectedEvent?.id === event.id
                    ? 'bg-brand/10 border-brand/30'
                    : 'bg-white/5 border-white/10 hover:bg-white/10'
                }`}
                onClick={() => loadEventStats(event)}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h3 className="font-bold text-xs uppercase leading-tight">{event.title}</h3>
                  <span className={`text-[9px] px-2 py-0.5 rounded-full font-mono uppercase shrink-0 ${
                    event.status === 'open' ? 'bg-brand/20 text-brand' :
                    event.status === 'closed' ? 'bg-rose-500/20 text-rose-400' :
                    'bg-white/10 text-white/40'
                  }`}>
                    {event.status === 'open' ? 'Набор открыт' : event.status === 'closed' ? 'Завершено' : 'Набор закрыт'}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2 mb-2">
                  <p className="text-[10px] text-white/60">{event.dateLabel}</p>
                  {cd && (
                    <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded-full shrink-0 ${soon ? 'bg-rose-500/20 text-rose-300' : cd === 'прошло' ? 'bg-white/5 text-white/30' : 'bg-brand/15 text-brand'}`}>
                      {cd}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1 text-[10px] text-white/50 mb-2">
                  <Users className="w-3 h-3" />
                  <span>{event.participantsCount}/{event.maxParticipants}</span>
                </div>

                <div className="flex gap-1">
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleEventStatus(event); }}
                    className={`flex-1 p-1.5 rounded-lg transition-all ${event.status === 'open' ? 'bg-brand/20 text-brand hover:bg-brand/30' : 'bg-white/5 hover:bg-white/10 text-white/60 hover:text-white'}`}
                    title={event.status === 'open' ? 'Набор открыт — нажми, чтобы закрыть' : 'Набор закрыт — нажми, чтобы открыть'}
                  >
                    {event.status === 'open' ? <Unlock className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                  </button>
                  
                  <button
                    onClick={(e) => { e.stopPropagation(); broadcastEvent(event); }}
                    disabled={broadcasting === event.id}
                    className="flex-1 bg-brand/20 hover:bg-brand/30 text-brand p-1.5 rounded-lg transition-all disabled:opacity-50"
                    title="Разослать уведомление"
                  >
                    {broadcasting === event.id ? (
                      <RefreshCw className="w-3 h-3 animate-spin" />
                    ) : (
                      <Send className="w-3 h-3" />
                    )}
                  </button>

                  <button
                    onClick={(e) => { e.stopPropagation(); setEditingEvent(event); }}
                    className="flex-1 bg-white/5 hover:bg-white/10 text-white/60 hover:text-white p-1.5 rounded-lg transition-all"
                    title="Редактировать"
                  >
                    <Edit className="w-3 h-3" />
                  </button>

                  <button
                    onClick={(e) => { e.stopPropagation(); if (window.confirm(`Удалить событие «${event.title}»? Действие необратимо.`)) onDeleteEvent(event.id); }}
                    className="flex-1 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 p-1.5 rounded-lg transition-all"
                    title="Удалить событие"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>

                {broadcastResult && broadcastResult.eventId === event.id && (
                  <div className={`mt-2 flex items-center gap-1 p-1.5 rounded-lg text-[10px] ${
                    broadcastResult.success ? 'bg-brand/10 text-brand' : 'bg-rose-500/10 text-rose-400'
                  }`}>
                    {broadcastResult.success ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                    <span>{broadcastResult.message}</span>
                  </div>
                )}
              </div>
            );})}
          </div>

          {/* Event Details Panel */}
          <div className="flex-1 overflow-y-auto p-4 md:p-6 min-h-0">
            {!selectedEvent ? (
              <div className="flex flex-col items-center justify-center h-full text-white/40">
                <Calendar className="w-16 h-16 mb-4" />
                <p className="text-sm">Выберите мероприятие для управления</p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* На мобильном — вернуться к списку событий */}
                <button
                  onClick={() => setSelectedEvent(null)}
                  className="md:hidden flex items-center gap-1 text-xs text-white/60 hover:text-white bg-white/5 rounded-lg px-3 py-2 cursor-pointer border-none"
                >
                  ← Все события
                </button>
                {/* Event Header */}
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <h3 className="font-display font-black text-xl uppercase mb-1">{selectedEvent.title}</h3>
                    <p className="text-xs text-white/60">
                      {selectedEvent.dateLabel}{selectedEvent.location ? ` • ${selectedEvent.location}` : ''}
                      {countdownLabel(selectedEvent.date) && <span className="text-brand"> · {countdownLabel(selectedEvent.date)}</span>}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => broadcastEvent(selectedEvent)}
                      disabled={broadcasting === selectedEvent.id}
                      className="bg-brand hover:bg-brand-hover text-black px-4 py-2 rounded-xl text-xs font-bold uppercase flex items-center gap-2 disabled:opacity-50"
                    >
                      {broadcasting === selectedEvent.id ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : (
                        <Send className="w-4 h-4" />
                      )}
                      Разослать
                    </button>
                  </div>
                </div>

                {/* Tabs */}
                <div className="flex flex-wrap gap-2 border-b border-white/10 pb-3">
                  <button
                    onClick={() => setActiveTab('overview')}
                    className={`px-4 py-2 rounded-lg text-xs font-bold uppercase transition-all ${
                      activeTab === 'overview' ? 'bg-brand text-black' : 'bg-white/5 text-white/60 hover:bg-white/10'
                    }`}
                  >
                    <BarChart3 className="w-4 h-4 inline mr-1" />
                    Обзор
                  </button>
                  <button
                    onClick={() => setActiveTab('participants')}
                    className={`px-4 py-2 rounded-lg text-xs font-bold uppercase transition-all ${
                      activeTab === 'participants' ? 'bg-brand text-black' : 'bg-white/5 text-white/60 hover:bg-white/10'
                    }`}
                  >
                    <Users className="w-4 h-4 inline mr-1" />
                    Участники
                  </button>
                  <button
                    onClick={() => setActiveTab('logistics')}
                    className={`px-4 py-2 rounded-lg text-xs font-bold uppercase transition-all ${
                      activeTab === 'logistics' ? 'bg-brand text-black' : 'bg-white/5 text-white/60 hover:bg-white/10'
                    }`}
                  >
                    <Truck className="w-4 h-4 inline mr-1" />
                    Логистика
                  </button>
                  <button
                    onClick={() => setActiveTab('settings')}
                    className={`px-4 py-2 rounded-lg text-xs font-bold uppercase transition-all ${
                      activeTab === 'settings' ? 'bg-brand text-black' : 'bg-white/5 text-white/60 hover:bg-white/10'
                    }`}
                  >
                    <Settings className="w-4 h-4 inline mr-1" />
                    Настройки
                  </button>
                </div>

                {/* Tab Content */}
                {activeTab === 'overview' && eventStats && (
                  <div className="space-y-4">
                    <p className="text-[10px] text-white/30 font-mono uppercase">Нажми на карточку — откроется список</p>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => openParticipants('all')}
                        className="text-left bg-white/5 border border-white/10 rounded-xl p-4 hover:bg-white/10 hover:border-brand/30 transition-all cursor-pointer"
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <Users className="w-4 h-4 text-brand" />
                          <span className="text-[10px] text-white/60 uppercase font-mono">Участники</span>
                        </div>
                        <p className="text-2xl font-black">{eventStats.total}</p>
                        <p className="text-xs text-white/40">из {selectedEvent.maxParticipants} мест · показать всех</p>
                      </button>

                      <button
                        type="button"
                        onClick={() => openParticipants('paid')}
                        className="text-left bg-white/5 border border-white/10 rounded-xl p-4 hover:bg-white/10 hover:border-brand/30 transition-all cursor-pointer"
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <DollarSign className="w-4 h-4 text-brand" />
                          <span className="text-[10px] text-white/60 uppercase font-mono">Оплата</span>
                        </div>
                        <p className="text-2xl font-black">{eventStats.payments}</p>
                        <p className="text-xs text-white/40">{eventStats.totalAmount} ₽ · показать оплативших</p>
                      </button>

                      <button
                        type="button"
                        onClick={() => openParticipants('pending')}
                        className="text-left bg-white/5 border border-white/10 rounded-xl p-4 hover:bg-white/10 hover:border-brand/30 transition-all cursor-pointer"
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <CheckSquare className="w-4 h-4 text-brand" />
                          <span className="text-[10px] text-white/60 uppercase font-mono">Подтверждено</span>
                        </div>
                        <p className="text-2xl font-black">{eventStats.confirmed}</p>
                        <p className="text-xs text-white/40">{eventStats.pending} ждут — показать их</p>
                      </button>

                      <button
                        type="button"
                        onClick={() => openParticipants('all', true)}
                        className="text-left bg-white/5 border border-white/10 rounded-xl p-4 hover:bg-white/10 hover:border-brand/30 transition-all cursor-pointer"
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <Activity className="w-4 h-4 text-brand" />
                          <span className="text-[10px] text-white/60 uppercase font-mono">Готовность</span>
                        </div>
                        <p className="text-2xl font-black">{Math.round((eventStats.confirmed / (selectedEvent.maxParticipants || 1)) * 100)}%</p>
                        <div className="w-full bg-white/10 rounded-full h-2 mt-2">
                          <div
                            className="bg-brand h-2 rounded-full transition-all"
                            style={{ width: `${Math.min(100, (eventStats.confirmed / (selectedEvent.maxParticipants || 1)) * 100)}%` }}
                          />
                        </div>
                      </button>
                    </div>

                    {/* Спрос и голоса — то, что раньше молча терялось в console.log */}
                    {(eventStats.interestCount > 0 || Object.keys(eventStats.voteTally || {}).length > 0) && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {eventStats.interestCount > 0 && (
                          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                            <div className="flex items-center gap-2 mb-2">
                              <Heart className="w-4 h-4 text-brand" />
                              <span className="text-[10px] text-white/60 uppercase font-mono">Мне интересно</span>
                            </div>
                            <p className="text-2xl font-black">{eventStats.interestCount}</p>
                            <p className="text-xs text-white/40">сигналов спроса</p>
                          </div>
                        )}
                        {Object.keys(eventStats.voteTally || {}).length > 0 && (
                          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                            <div className="flex items-center gap-2 mb-2">
                              <Vote className="w-4 h-4 text-brand" />
                              <span className="text-[10px] text-white/60 uppercase font-mono">Голоса за программу</span>
                            </div>
                            <div className="space-y-1 mt-2">
                              {Object.entries(eventStats.voteTally as Record<string, number>)
                                .sort((a, b) => b[1] - a[1])
                                .map(([opt, n]) => (
                                  <div key={opt} className="flex justify-between gap-2 text-xs">
                                    <span className="text-white/80 truncate">{opt}</span>
                                    <span className="text-brand font-mono shrink-0">{n}</span>
                                  </div>
                                ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Checklist — состояние живёт в events.checklist */}
                    <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                      <h4 className="text-xs font-bold uppercase mb-3 flex items-center gap-2">
                        <CheckSquare className="w-4 h-4 text-brand" />
                        Готовность мероприятия
                        <span className="text-[10px] text-white/40 font-mono normal-case ml-auto">
                          {CHECKLIST_ITEMS.filter((i) => selectedEvent.checklist?.[i.key]).length}/{CHECKLIST_ITEMS.length}
                        </span>
                      </h4>
                      <div className="space-y-1">
                        {CHECKLIST_ITEMS.map((item) => {
                          const done = !!selectedEvent.checklist?.[item.key];
                          return (
                            <button
                              key={item.key}
                              type="button"
                              onClick={() => patchEvent({ checklist: { ...(selectedEvent.checklist || {}), [item.key]: !done } })}
                              className="flex items-center gap-2 text-xs w-full text-left p-1.5 rounded-lg hover:bg-white/5 cursor-pointer bg-transparent border-none transition-colors"
                            >
                              {done
                                ? <CheckSquare className="w-4 h-4 text-brand shrink-0" />
                                : <Square className="w-4 h-4 text-white/30 shrink-0" />}
                              <span className={done ? 'text-white/90' : 'text-white/60'}>{item.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'participants' && eventStats && (
                  <div className="space-y-4">
                    {/* Быстрый фильтр по статусу заявки — синхронизирован с карточками «Обзора» */}
                    <div className="flex flex-wrap gap-2">
                      {([
                        ['all', `Все · ${eventStats.total}`],
                        ['pending', `Ждут · ${eventStats.pending}`],
                        ['confirmed', `Подтверждены · ${eventStats.confirmed}`],
                        ['paid', `Оплатили · ${eventStats.payments}`],
                      ] as const).map(([key, label]) => (
                        <button
                          key={key}
                          onClick={() => { setPartFilter(key); setOnlyAttended(false); }}
                          className={`px-3 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer border-none transition-all ${partFilter === key && !onlyAttended ? 'bg-brand text-black' : 'bg-white/5 text-white/60 hover:bg-white/10'}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-2 mb-4">
                      <button
                        onClick={() => setOnlyAttended(!onlyAttended)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer border-none transition-all ${onlyAttended ? 'bg-brand/20 text-brand' : 'bg-white/5 text-white/60 hover:bg-white/10'}`}
                        title="Показать только тех, кто отмечен как приехавший"
                      >
                        <UserCheck className="w-3 h-3" />
                        Кто приехал ({eventStats.attended})
                      </button>
                      <button
                        onClick={() => setShowFeedback(!showFeedback)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer border-none transition-all ${showFeedback ? 'bg-brand/20 text-brand' : 'bg-white/5 text-white/60 hover:bg-white/10'}`}
                      >
                        <Star className="w-3 h-3" />
                        Отзывы ({eventStats.feedback.length}) · {avgRating(eventStats.feedback)}
                      </button>
                      <button
                        onClick={async () => {
                          const toMark = eventStats.registrations.filter((r: any) => r.status === 'confirmed' && !r.attended);
                          if (!toMark.length) { setActionMsg({ ok: false, text: 'Нет подтверждённых без отметки явки' }); return; }
                          if (!window.confirm(`Отметить явку у ${toMark.length} подтверждённых участников? Каждому начислятся баллы.`)) return;
                          for (const r of toMark) await patchRegistration(r, { attended: true });
                          setActionMsg({ ok: true, text: `Явка отмечена: ${toMark.length}` });
                        }}
                        className="bg-white/5 text-white/60 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 hover:bg-white/10 cursor-pointer border-none"
                        title="Отметить явку всем подтверждённым разом"
                      >
                        <CheckSquare className="w-3 h-3" />
                        Подтвердить явку всем
                      </button>
                    </div>

                    {showFeedback && (
                      <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-2">
                        <h4 className="text-xs font-bold uppercase flex items-center gap-2">
                          <Star className="w-4 h-4 text-brand" />
                          Отзывы · средняя оценка {avgRating(eventStats.feedback)}
                        </h4>
                        {eventStats.feedback.length === 0 ? (
                          <p className="text-[10px] text-white/40">Отзывов пока нет. Бот попросит их на следующий день после события.</p>
                        ) : (
                          eventStats.feedback.map((f: any) => (
                            <div key={f.id} className="bg-white/5 rounded-lg p-3">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-brand text-xs">{'★'.repeat(f.rating || 0)}</span>
                                <span className={`text-[9px] font-mono ${f.would_return ? 'text-brand' : 'text-rose-400'}`}>
                                  {f.would_return ? 'придёт снова' : 'не придёт'}
                                </span>
                              </div>
                              {f.comment && <p className="text-[11px] text-white/70 leading-relaxed">{f.comment}</p>}
                            </div>
                          ))
                        )}
                      </div>
                    )}

                    <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                      <div className="p-3 border-b border-white/10">
                        <h4 className="text-xs font-bold uppercase">
                          {onlyAttended ? 'Кто приехал' : partFilter === 'pending' ? 'Ждут подтверждения'
                            : partFilter === 'confirmed' ? 'Подтверждённые' : partFilter === 'paid' ? 'Оплатившие' : 'Все участники'}
                          {' '}({(() => {
                            const v = eventStats.registrations.filter((r: any) =>
                              onlyAttended ? r.attended
                              : partFilter === 'pending' ? r.status === 'pending'
                              : partFilter === 'confirmed' ? r.status === 'confirmed'
                              : partFilter === 'paid' ? r.paymentStatus === 'paid'
                              : true);
                            return v.length;
                          })()})
                        </h4>
                      </div>
                      <div className="max-h-96 overflow-y-auto">
                        {(() => {
                          const visible = eventStats.registrations.filter((r: any) =>
                            onlyAttended ? r.attended
                            : partFilter === 'pending' ? r.status === 'pending'
                            : partFilter === 'confirmed' ? r.status === 'confirmed'
                            : partFilter === 'paid' ? r.paymentStatus === 'paid'
                            : true);
                          return visible.length === 0 ? (
                          <div className="p-6 text-center text-white/40 text-xs">
                            {onlyAttended ? 'Никто ещё не отмечен как приехавший' : 'Пока нет зарегистрированных участников'}
                          </div>
                        ) : (
                          visible.map((reg: any, idx: number) => (
                            <div key={idx} className="p-3 border-b border-white/5 hover:bg-white/5">
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex-1">
                                  <p className="text-sm font-bold">{reg.name || 'Гость'}</p>
                                  <p className="text-[10px] text-white/60">@{reg.telegram}</p>
                                  {reg.inviter && (
                                    <p className="text-[10px] text-brand">Пригласил: {reg.inviter}</p>
                                  )}
                                </div>
                                <span className={`text-[9px] px-2 py-1 rounded-full font-mono ${
                                  reg.status === 'confirmed' ? 'bg-brand/20 text-brand' :
                                  reg.status === 'pending' ? 'bg-white/10 text-white/40' :
                                  'bg-rose-500/20 text-rose-400'
                                }`}>
                                  {reg.status === 'confirmed' ? 'Подтвержден' : reg.status === 'pending' ? 'Ожидает' : 'Отклонен'}
                                </span>
                              </div>
                              
                              {/* Транспорт и инвентарь */}
                              <div className="grid grid-cols-2 gap-2 mt-2">
                                <div className={`p-2 rounded-lg border ${
                                  reg.hasTransport ? 'bg-brand/10 border-brand/30' : 'bg-white/5 border-white/10'
                                }`}>
                                  <div className="flex items-center gap-1 mb-1">
                                    <Truck className="w-3 h-3 text-brand" />
                                    <span className="text-[9px] font-bold uppercase">Транспорт</span>
                                  </div>
                                  {reg.hasTransport ? (
                                    <div>
                                      <p className="text-[10px] text-white/80">{reg.transportDetails || 'Автомобиль'}</p>
                                      <p className="text-[9px] text-white/60">Мест: {reg.transportSeats || 0}</p>
                                    </div>
                                  ) : (
                                    <p className="text-[9px] text-white/40">Нет транспорта</p>
                                  )}
                                </div>

                                <div className={`p-2 rounded-lg border ${
                                  reg.inventory && reg.inventory.length > 0 ? 'bg-brand/10 border-brand/30' : 'bg-white/5 border-white/10'
                                }`}>
                                  <div className="flex items-center gap-1 mb-1">
                                    <Package className="w-3 h-3 text-brand" />
                                    <span className="text-[9px] font-bold uppercase">Инвентарь</span>
                                  </div>
                                  {reg.inventory && reg.inventory.length > 0 ? (
                                    <div className="flex flex-wrap gap-1">
                                      {reg.inventory.slice(0, 2).map((item: string, i: number) => (
                                        <span key={i} className="text-[9px] bg-white/10 px-1.5 py-0.5 rounded">{item}</span>
                                      ))}
                                      {reg.inventory.length > 2 && (
                                        <span className="text-[9px] text-white/60">+{reg.inventory.length - 2}</span>
                                      )}
                                    </div>
                                  ) : (
                                    <p className="text-[9px] text-white/40">Нет инвентаря</p>
                                  )}
                                </div>
                              </div>

                              {/* Что человек берёт и чем помогает — из чек-листов бота */}
                              {(reg.equipment.length > 0 || reg.roles.length > 0 || reg.guestCount > 0 || reg.childrenCount > 0 || reg.foodOptout) && (
                                <div className="flex flex-wrap gap-1 mt-2">
                                  {reg.guestCount > 0 && <span className="text-[9px] bg-white/10 px-1.5 py-0.5 rounded">+{reg.guestCount} гост.</span>}
                                  {reg.childrenCount > 0 && <span className="text-[9px] bg-white/10 px-1.5 py-0.5 rounded">+{reg.childrenCount} дет.</span>}
                                  {reg.foodOptout && <span className="text-[9px] bg-amber-500/15 text-amber-300 px-1.5 py-0.5 rounded">своя еда</span>}
                                  {reg.dietary && reg.dietary !== 'all' && <span className="text-[9px] bg-emerald-500/15 text-emerald-300 px-1.5 py-0.5 rounded">{reg.dietary}</span>}
                                  {reg.roles.map((r: string) => <span key={r} className="text-[9px] bg-brand/15 text-brand px-1.5 py-0.5 rounded">{r}</span>)}
                                  {reg.equipment.map((e: string) => <span key={e} className="text-[9px] bg-white/10 px-1.5 py-0.5 rounded">{e}</span>)}
                                </div>
                              )}

                              <div className="flex gap-1 mt-2">
                                <button
                                  onClick={() => patchRegistration(reg, { status: reg.status === 'confirmed' ? 'pending' : 'confirmed' })}
                                  className={`flex-1 p-1.5 rounded-lg text-[9px] font-bold uppercase transition-all cursor-pointer border-none ${reg.status === 'confirmed' ? 'bg-brand/20 text-brand' : 'bg-white/5 hover:bg-white/10 text-white/60 hover:text-white'}`}
                                  title="Подтвердить участие"
                                >
                                  {reg.status === 'confirmed' ? '✓ Подтверждён' : 'Подтвердить'}
                                </button>
                                <button
                                  onClick={() => patchRegistration(reg, { paymentStatus: reg.paymentStatus === 'paid' ? 'pending' : 'paid' })}
                                  className={`flex-1 p-1.5 rounded-lg text-[9px] font-bold uppercase transition-all cursor-pointer border-none ${reg.paymentStatus === 'paid' ? 'bg-brand/20 text-brand' : 'bg-white/5 hover:bg-white/10 text-white/60 hover:text-white'}`}
                                  title="Отметить оплату"
                                >
                                  {reg.paymentStatus === 'paid' ? '✓ Оплачено' : 'Оплата'}
                                </button>
                                <button
                                  onClick={() => patchRegistration(reg, { attended: !reg.attended })}
                                  className={`flex-1 p-1.5 rounded-lg text-[9px] font-bold uppercase transition-all cursor-pointer border-none ${reg.attended ? 'bg-brand/20 text-brand' : 'bg-white/5 hover:bg-white/10 text-white/60 hover:text-white'}`}
                                  title="Отметить, что человек реально приехал. За это начисляются баллы."
                                >
                                  {reg.attended ? '✓ Был' : 'Явка'}
                                </button>
                                <button
                                  onClick={async () => {
                                    if (!window.confirm(`Удалить участника ${reg.name}? Действие необратимо.`)) return;
                                    try {
                                      const res = await fetch(`/api/admin/registrations?registrationId=${encodeURIComponent(reg.id)}`, {
                                        method: 'DELETE',
                                                                      });
                                      if (!res.ok) throw new Error(`HTTP ${res.status}`);
                                      setActionMsg({ ok: true, text: 'Участник удалён' });
                                    } catch (err) {
                                      setActionMsg({ ok: false, text: `Не удалось удалить: ${(err as Error).message}` });
                                    }
                                    await refreshStats(selectedEvent);
                                  }}
                                  className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 cursor-pointer border-none"
                                  title="Принудительно удалить"
                                >
                                  <UserMinus className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          ))
                        );
                        })()}
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'logistics' && eventStats && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => setLogiPanel(logiPanel === 'shopping' ? null : 'shopping')}
                        className={`border rounded-xl p-4 text-left transition-all cursor-pointer ${logiPanel === 'shopping' ? 'bg-brand/10 border-brand/30' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}
                      >
                        <ShoppingCart className="w-6 h-6 text-brand mb-2" />
                        <p className="text-xs font-bold uppercase">Список закупки</p>
                        <p className="text-[10px] text-white/40 mt-1">ИИ считает под состав</p>
                      </button>

                      <button
                        onClick={() => setLogiPanel(logiPanel === 'cooking' ? null : 'cooking')}
                        className={`border rounded-xl p-4 text-left transition-all cursor-pointer ${logiPanel === 'cooking' ? 'bg-brand/10 border-brand/30' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}
                      >
                        <ChefHat className="w-6 h-6 text-brand mb-2" />
                        <p className="text-xs font-bold uppercase">Кто на ролях</p>
                        <p className="text-[10px] text-white/40 mt-1">Готовка, костёр, аптечка</p>
                      </button>

                      <button
                        onClick={() => setLogiPanel(logiPanel === 'gear' ? null : 'gear')}
                        className={`border rounded-xl p-4 text-left transition-all cursor-pointer ${logiPanel === 'gear' ? 'bg-brand/10 border-brand/30' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}
                      >
                        <Package className="w-6 h-6 text-brand mb-2" />
                        <p className="text-xs font-bold uppercase">Общее снаряжение</p>
                        <p className="text-[10px] text-white/40 mt-1">Кто что везёт</p>
                      </button>

                      <button
                        onClick={async () => {
                          const coords = selectedEvent.coordinates;
                          const detail = selectedEvent.locationDetails || selectedEvent.location;
                          const mapLink = coords?.lat
                            ? `\n🗺 https://yandex.ru/maps/?pt=${coords.lng},${coords.lat}&z=16&l=map`
                            : '';
                          const text = `📍 <b>Точка сбора: ${selectedEvent.title}</b>\n\n${detail}${mapLink}`;
                          if (!window.confirm('Разослать координаты всем участникам события в Telegram?')) return;
                          await sendMessageToAll(text);
                          await patchEvent({ checklist: { ...(selectedEvent.checklist || {}), coords: true } });
                        }}
                        disabled={broadcasting === selectedEvent.id}
                        className="bg-white/5 border border-white/10 rounded-xl p-4 text-left hover:bg-white/10 transition-all cursor-pointer disabled:opacity-50"
                      >
                        <MapPin className="w-6 h-6 text-brand mb-2" />
                        <p className="text-xs font-bold uppercase">Отправить координаты</p>
                        <p className="text-[10px] text-white/40 mt-1">Всем участникам в бот</p>
                      </button>
                    </div>

                    {logiPanel === 'shopping' && selectedEvent.type !== 'intellectual' && (
                      <ShoppingGenerator event={selectedEvent} registrations={eventStats.registrations || []} />
                    )}
                    {logiPanel === 'shopping' && selectedEvent.type === 'intellectual' && (
                      <p className="text-[11px] text-white/40 bg-white/5 border border-white/10 rounded-xl p-4">
                        Для интеллектуальных событий закупка не нужна.
                      </p>
                    )}

                    {logiPanel === 'cooking' && (
                      <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                        <h4 className="text-xs font-bold uppercase mb-3 flex items-center gap-2">
                          <ChefHat className="w-4 h-4 text-brand" /> Роли участников
                        </h4>
                        {(() => {
                          const byRole: Record<string, string[]> = {};
                          for (const r of eventStats.registrations) {
                            for (const role of r.roles || []) (byRole[role] ||= []).push(r.name);
                          }
                          const roles = Object.keys(byRole);
                          if (!roles.length) return <p className="text-[10px] text-white/40">Никто ещё не выбрал роль в боте («📋 Организация» → «Чем буду полезен»).</p>;
                          return (
                            <div className="space-y-2">
                              {roles.map((role) => (
                                <div key={role} className="bg-white/5 rounded-lg p-2">
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="text-xs font-bold">{role}</span>
                                    <span className="text-[10px] text-brand font-mono">{byRole[role].length} чел.</span>
                                  </div>
                                  <p className="text-[10px] text-white/60">{byRole[role].join(', ')}</p>
                                </div>
                              ))}
                            </div>
                          );
                        })()}
                      </div>
                    )}

                    {logiPanel === 'gear' && (
                      <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                        <h4 className="text-xs font-bold uppercase mb-3 flex items-center gap-2">
                          <Package className="w-4 h-4 text-brand" /> Общее снаряжение
                        </h4>
                        {(() => {
                          // Снаряжение из чек-листа бота + легаси-поле inventory.
                          const all = eventStats.registrations.flatMap((r: any) => [...(r.equipment || []), ...(r.inventory || [])]);
                          if (!all.length) return <p className="text-[10px] text-white/40">Пока никто не отметил снаряжение.</p>;
                          const counts = new Map<string, number>();
                          for (const item of all) counts.set(item, (counts.get(item) || 0) + 1);
                          return (
                            <div className="space-y-1">
                              {[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([item, n]) => (
                                <div key={item} className="bg-white/5 rounded-lg p-2 flex items-center justify-between">
                                  <span className="text-xs">{item}</span>
                                  <span className="text-[10px] text-brand font-mono">{n} шт.</span>
                                </div>
                              ))}
                            </div>
                          );
                        })()}
                      </div>
                    )}

                    {/* Транспортный план — из таблицы rides, а не из анкеты */}
                    <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                      <h4 className="text-xs font-bold uppercase mb-3 flex items-center gap-2">
                        <Truck className="w-4 h-4 text-brand" />
                        Кто едет ({eventStats.rides.length} машин)
                      </h4>
                      <div className="space-y-2">
                        {eventStats.rides.length === 0 ? (
                          <p className="text-[10px] text-white/40">
                            Никто ещё не заявил машину. Участники делают это сами в боте: «🚗 Логистика и брони».
                          </p>
                        ) : (
                          eventStats.rides.map((ride: any) => {
                            const free = Math.max(0, (ride.seats_total || 0) - (ride.seats_taken || 0));
                            return (
                              <div key={ride.id} className="bg-white/5 rounded-lg p-3">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="text-xs font-bold">🚗 {ride.driver_name || 'Водитель'}</p>
                                    <p className="text-[10px] text-white/60">
                                      {ride.from_point || '—'} · {ride.depart_text || '—'}
                                    </p>
                                    <p className="text-[10px] text-white/40">
                                      {ride.fuel_cost ? `⛽ ${ride.fuel_cost} ₽/чел` : '⛽ бесплатно'}
                                    </p>
                                  </div>
                                  <div className="text-right shrink-0">
                                    <p className="text-xs font-bold text-brand">{free} своб.</p>
                                    <p className="text-[9px] text-white/40">из {ride.seats_total || 0}</p>
                                  </div>
                                </div>
                                {ride.passengers?.length > 0 && (
                                  <p className="text-[10px] text-white/60 mt-2 pt-2 border-t border-white/5">
                                    Пассажиры: {ride.passengers.map((p: any) => p.passenger_name).join(', ')}
                                  </p>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>

                    {/* SOS: кому нужна попутка */}
                    {eventStats.rideRequests.length > 0 && (
                      <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4">
                        <h4 className="text-xs font-bold uppercase mb-3 flex items-center gap-2 text-amber-300">
                          <Navigation className="w-4 h-4" />
                          Ищут попутку ({eventStats.rideRequests.length})
                        </h4>
                        <div className="space-y-1">
                          {eventStats.rideRequests.map((r: any) => (
                            <div key={r.id} className="text-xs text-white/80">
                              🚶 {r.passenger_name}{r.from_area ? ` — ${r.from_area}` : ''}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {activeTab === 'settings' && (
                  <div className="space-y-4">
                    <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
                      <h4 className="text-xs font-bold uppercase mb-1">Управление мероприятием</h4>
                      <p className="text-[10px] text-white/40 mb-2">
                        Сейчас: <span className="text-brand font-mono">
                          {selectedEvent.status === 'open' ? 'набор открыт' : selectedEvent.status === 'closed' ? 'завершено' : 'набор закрыт'}
                        </span>
                      </p>

                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => patchEvent({ status: 'open', statusReason: null })}
                          disabled={selectedEvent.status === 'open'}
                          className="bg-white/5 hover:bg-white/10 text-white/60 hover:text-white p-3 rounded-lg text-xs font-bold uppercase flex items-center justify-center gap-2 cursor-pointer border-none disabled:opacity-40 disabled:cursor-default"
                          title="Открыть набор участников"
                        >
                          <Play className="w-4 h-4" />
                          Стартовать
                        </button>
                        <button
                          onClick={() => patchEvent({ status: 'locked' })}
                          disabled={selectedEvent.status === 'locked'}
                          className="bg-white/5 hover:bg-white/10 text-white/60 hover:text-white p-3 rounded-lg text-xs font-bold uppercase flex items-center justify-center gap-2 cursor-pointer border-none disabled:opacity-40 disabled:cursor-default"
                          title="Закрыть набор, событие остаётся в афише «под замком»"
                        >
                          <Pause className="w-4 h-4" />
                          Приостановить
                        </button>
                        <button
                          onClick={async () => {
                            if (!window.confirm('Завершить мероприятие? Набор закроется, бот попросит у участников отзывы на следующий день.')) return;
                            await patchEvent({ status: 'closed', checklist: { ...(selectedEvent.checklist || {}), finished: true } });
                          }}
                          className="bg-brand/20 hover:bg-brand/30 text-brand p-3 rounded-lg text-xs font-bold uppercase flex items-center justify-center gap-2 cursor-pointer border-none"
                        >
                          <CheckCircle className="w-4 h-4" />
                          Завершить
                        </button>
                        <button
                          onClick={() => setInputModal({
                            title: 'Отменить событие',
                            submitLabel: 'Отменить и уведомить',
                            fields: [{ key: 'reason', label: 'Причина отмены', type: 'textarea', required: true, hint: 'Уйдёт всем участникам в Telegram' }],
                            onSubmit: async (v) => {
                              await patchEvent({ status: 'closed', statusReason: v.reason });
                              await sendMessageToAll(`❌ <b>${selectedEvent.title}</b> отменяется.\n\n${v.reason}`);
                            },
                          })}
                          className="bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 p-3 rounded-lg text-xs font-bold uppercase flex items-center justify-center gap-2 cursor-pointer border-none"
                          title="Отменить и уведомить участников"
                        >
                          <XIcon className="w-4 h-4" />
                          Отменить
                        </button>
                      </div>
                    </div>

                    {/* «Под вопросом» + перенос дат — Фаза 6 */}
                    <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
                      <h4 className="text-xs font-bold uppercase mb-1">Под вопросом и перенос</h4>

                      {selectedEvent.statusReason && (
                        <p className="text-[10px] text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2">
                          ⚠️ {selectedEvent.statusReason}
                          {selectedEvent.decisionDeadline && ` · решение до ${selectedEvent.decisionDeadline}`}
                        </p>
                      )}

                      <button
                        onClick={() => {
                          if (selectedEvent.statusReason) { patchEvent({ statusReason: null, decisionDeadline: null }); return; }
                          setInputModal({
                            title: 'Событие под вопросом',
                            submitLabel: 'Пометить',
                            fields: [
                              { key: 'reason', label: 'Причина', type: 'text', required: true, placeholder: 'напр. нужно ещё 4 человека' },
                              { key: 'deadline', label: 'Дедлайн решения', type: 'date', value: selectedEvent.decisionDeadline || '', hint: 'необязательно' },
                            ],
                            onSubmit: (v) => patchEvent({ statusReason: v.reason, decisionDeadline: v.deadline || null }),
                          });
                        }}
                        className="w-full bg-white/5 hover:bg-white/10 text-white/60 hover:text-white p-3 rounded-lg text-xs font-bold uppercase flex items-center justify-center gap-2 cursor-pointer border-none"
                      >
                        <Flag className="w-4 h-4" />
                        {selectedEvent.statusReason ? 'Снять «под вопросом»' : 'Пометить «под вопросом»'}
                      </button>

                      <button
                        onClick={() => {
                          setInputModal({
                            title: 'Перенести даты',
                            submitLabel: 'Перенести',
                            fields: [
                              { key: 'date', label: 'Новая дата начала', type: 'date', value: selectedEvent.date, required: true },
                              { key: 'time', label: 'Время начала', type: 'time', value: selectedEvent.time || '' },
                              { key: 'dateEnd', label: 'Дата окончания', type: 'date', value: selectedEvent.dateEnd || '', hint: 'пусто = однодневное' },
                              { key: 'notify', label: 'Уведомить участников о переносе', type: 'checkbox', value: '1' },
                            ],
                            onSubmit: async (v) => {
                              const dateLabel = buildDateLabel(v.date, v.dateEnd || '', v.time || '');
                              await patchEvent({ date: v.date, dateEnd: v.dateEnd || null, time: v.time || null, dateLabel });
                              if (v.notify === '1') await sendMessageToAll(`📅 <b>${selectedEvent.title}</b> переносится.\n\nНовые даты: ${dateLabel}\n\nЕсли планы поменялись — напиши сюда.`);
                            },
                          });
                        }}
                        className="w-full bg-white/5 hover:bg-white/10 text-white/60 hover:text-white p-3 rounded-lg text-xs font-bold uppercase flex items-center justify-center gap-2 cursor-pointer border-none"
                      >
                        <Clock className="w-4 h-4" />
                        Перенести даты
                      </button>
                    </div>

                    <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
                      <h4 className="text-xs font-bold uppercase mb-1">Доступ и публичность</h4>
                      <p className="text-[10px] text-white/40 mb-2">
                        {selectedEvent.isPublic === false
                          ? `Закрытое${selectedEvent.accessCode ? ` · код: ${selectedEvent.accessCode}` : ''}`
                          : 'Публичное — видно всем в афише'}
                      </p>

                      <button
                        onClick={() => patchEvent({ isPublic: selectedEvent.isPublic === false })}
                        className="w-full bg-white/5 hover:bg-white/10 text-white/60 hover:text-white p-3 rounded-lg text-xs font-bold uppercase flex items-center justify-center gap-2 cursor-pointer border-none"
                      >
                        <Globe className="w-4 h-4" />
                        {selectedEvent.isPublic === false ? 'Сделать публичным' : 'Сделать закрытым'}
                      </button>

                      <button
                        onClick={() => {
                          const code = Math.random().toString(36).slice(2, 8).toUpperCase();
                          if (!window.confirm(`Новый код доступа: ${code}\n\nСтарый перестанет работать. Применить?`)) return;
                          patchEvent({ accessCode: code, isPublic: false });
                        }}
                        className="w-full bg-white/5 hover:bg-white/10 text-white/60 hover:text-white p-3 rounded-lg text-xs font-bold uppercase flex items-center justify-center gap-2 cursor-pointer border-none"
                      >
                        <Key className="w-4 h-4" />
                        Сменить код доступа
                      </button>

                      <button
                        onClick={() => {
                          const candidates = (eventStats?.registrations || []).filter((r: any) => Number(r.telegramId) > 0);
                          if (!candidates.length) { setActionMsg({ ok: false, text: 'Нет участников с Telegram-id' }); return; }
                          setInputModal({
                            title: 'Заместитель на событие',
                            submitLabel: 'Назначить',
                            fields: [{
                              key: 'deputy', label: 'Кто помогает вести событие', type: 'select', required: true,
                              value: selectedEvent.deputyId ? String(selectedEvent.deputyId) : '',
                              options: candidates.map((r: any) => ({ value: String(r.telegramId), label: `${r.name}${r.telegram ? ` @${r.telegram}` : ''}` })),
                            }],
                            onSubmit: (v) => patchEvent({ deputyId: Number(v.deputy) }),
                          });
                        }}
                        className="w-full bg-white/5 hover:bg-white/10 text-white/60 hover:text-white p-3 rounded-lg text-xs font-bold uppercase flex items-center justify-center gap-2 cursor-pointer border-none"
                      >
                        <UserPlus className="w-4 h-4" />
                        {selectedEvent.deputyId ? `Заместитель: ${selectedEvent.deputyId}` : 'Заместитель на мероприятие'}
                      </button>
                    </div>

                    <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
                      <h4 className="text-xs font-bold uppercase mb-1">Участники</h4>

                      <button
                        onClick={() => setInputModal({
                          title: 'Объявление всем участникам',
                          submitLabel: 'Разослать',
                          fields: [{ key: 'text', label: 'Текст — уйдёт в Telegram', type: 'textarea', required: true, placeholder: 'Важное про событие…' }],
                          onSubmit: (v) => sendMessageToAll(`📢 <b>${selectedEvent.title}</b>\n\n${v.text.trim()}`),
                        })}
                        disabled={broadcasting === selectedEvent.id}
                        className="w-full bg-white/5 hover:bg-white/10 text-white/60 hover:text-white p-3 rounded-lg text-xs font-bold uppercase flex items-center justify-center gap-2 cursor-pointer border-none disabled:opacity-50"
                      >
                        <MessageSquare className="w-4 h-4" />
                        Важное объявление всем
                      </button>

                      <p className="text-[10px] text-white/40">
                        Удаление конкретного участника — на вкладке «Участники», кнопка с иконкой.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </motion.div>

      {/* Модалка ввода (даты/причины/объявления) вместо системного prompt */}
      <AnimatePresence>
        {inputModal && <InputModal spec={inputModal} onClose={() => setInputModal(null)} />}
      </AnimatePresence>

      {/* Аудитория клуба — все участники, кто активен, кто кого привёл */}
      <AnimatePresence>
        {showAudience && (
          <div className="fixed inset-0 z-[80] flex items-end md:items-center justify-center md:p-4">
            <div className="absolute inset-0 bg-black/95 backdrop-blur-sm" onClick={() => setShowAudience(false)} />
            <motion.div
              initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 40 }}
              className="bg-[#121212] md:rounded-3xl rounded-t-3xl w-full max-w-3xl relative z-10 border border-white/10 flex flex-col h-[90dvh] md:max-h-[85vh] text-white"
            >
              <div className="p-4 md:p-6 border-b border-white/10 flex items-center justify-between">
                <div>
                  <h3 className="font-display font-black text-lg uppercase">Аудитория клуба</h3>
                  {audience?.summary && (
                    <p className="text-[11px] text-white/50 font-mono">
                      всего {audience.summary.total} · костяк {audience.summary.core} · получат рассылку {audience.summary.reachable}
                      {audience.summary.blocked ? ` · заблокировали ${audience.summary.blocked}` : ''}
                    </p>
                  )}
                </div>
                <button onClick={() => setShowAudience(false)} className="p-2 rounded-full bg-white/5 hover:bg-white/10 cursor-pointer border-none text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {!audience ? (
                  <p className="text-white/40 text-xs text-center py-8">Загрузка…</p>
                ) : audience.members?.length === 0 ? (
                  <p className="text-white/40 text-xs text-center py-8">Пока только ты.</p>
                ) : (
                  (audience.members || []).map((m: any) => (
                    <div key={m.telegramId} className="bg-white/5 border border-white/10 rounded-xl p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-sm">{m.firstName || 'Без имени'}</span>
                            {m.username && <span className="text-[10px] text-white/50 font-mono">@{m.username}</span>}
                            {m.isCore && <span className="text-[9px] bg-brand/20 text-brand px-1.5 py-0.5 rounded font-mono">костяк</span>}
                          </div>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${m.status === 'approved' ? 'bg-brand/15 text-brand' : m.status === 'blocked' ? 'bg-rose-500/15 text-rose-400' : 'bg-white/10 text-white/50'}`}>
                              {m.status === 'approved' ? 'в клубе' : m.status === 'pending_review' ? 'на модерации' : m.status === 'blocked' ? 'отклонён' : 'новичок'}
                            </span>
                            {m.realTelegram && (
                              <span className={`text-[9px] font-mono ${m.botActive ? 'text-white/40' : 'text-rose-400'}`}>
                                {m.botActive ? '🟢 бот активен' : '⛔ заблокировал бота'}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-brand font-black text-sm">{m.points} 🏅</p>
                          <p className="text-[9px] text-white/40 font-mono">был: {m.attendedCount} · привёл: {m.invitedCount}</p>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Edit Modal */}
      <AnimatePresence>
        {editingEvent && (
          <EditEventModal
            event={editingEvent}
            onClose={() => setEditingEvent(null)}
            onSave={(updated) => {
              onUpdateEvent(updated);
              setEditingEvent(null);
              if (selectedEvent?.id === updated.id) {
                setSelectedEvent(updated);
              }
            }}
          />
        )}
      </AnimatePresence>

      {/* Add Event Modal */}
      <AnimatePresence>
        {showAddForm && (
          <AddEventModal
            onClose={() => setShowAddForm(false)}
            onAdd={(newEvent) => {
              onAddEvent(newEvent);
              setShowAddForm(false);
            }}
          />
        )}
      </AnimatePresence>

      {/* Templates Modal */}
      <AnimatePresence>
        {showTemplates && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" id="templates-modal">
            <div className="absolute inset-0 bg-black/95" onClick={() => setShowTemplates(false)} />

            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-[#121212] rounded-3xl w-full max-w-2xl shadow-2xl relative z-10 border border-white/10 p-6 space-y-4"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-display font-black text-xl uppercase">Шаблоны мероприятий</h3>
                <button
                  onClick={() => setShowTemplates(false)}
                  className="p-2 rounded-full bg-white/5 hover:bg-white/10"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <p className="text-xs text-white/60 mb-4">Выберите шаблон для быстрого создания мероприятия</p>

              <div className="grid grid-cols-2 gap-3 max-h-[60vh] overflow-y-auto">
                {eventTemplates.map((template, idx) => (
                  <button
                    key={idx}
                    onClick={() => createFromTemplate(template)}
                    className="bg-white/5 border border-white/10 rounded-xl p-4 text-left hover:bg-white/10 hover:border-brand/30 transition-all"
                  >
                    <h4 className="font-bold text-sm uppercase mb-2">{template.title}</h4>
                    <p className="text-[10px] text-white/60 mb-3 line-clamp-2">{template.description}</p>
                    <div className="flex items-center gap-2 text-[10px] text-white/40">
                      <Clock className="w-3 h-3" />
                      <span>{template.time}</span>
                      <Users className="w-3 h-3 ml-2" />
                      <span>до {template.maxParticipants}</span>
                    </div>
                  </button>
                ))}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Edit Event Modal
function EditEventModal({ event, onClose, onSave }: {
  event: CommunityEvent;
  onClose: () => void;
  onSave: (event: CommunityEvent) => void;
}) {
  const [formData, setFormData] = useState({
    title: event.title,
    description: event.description,
    date: event.date,
    dateEnd: event.dateEnd || '',
    dateLabel: event.dateLabel,
    time: event.time || '',
    timeEnd: event.timeEnd || '',
    location: event.location,
    locationDetails: event.locationDetails || '',
    coordinates: event.coordinates || { lat: 0, lng: 0 },
    image: event.image || '',
    painPoint: event.painPoint || '',
    maxParticipants: event.maxParticipants,
    participantsCount: event.participantsCount,
    status: event.status || 'open',
    priceType: (event.priceType === 'paid' ? 'paid' : 'free') as 'free' | 'paid',
    priceLabel: event.priceLabel || 'Бесплатно',
    priceAmount: event.priceAmount || 0,
    entryThreshold: event.entryThreshold || '',
    entryType: event.entryType || 'all',
    program: (event.program || []) as string[],
    logistics: (event.logistics || {}) as Record<string, any>,
    paymentDetails: (event.paymentDetails || {}) as Record<string, any>,
    houseQualities: (event.houseQualities || []) as HouseQuality[]
  });

  // Гибкая цена: бесплатно / на совесть / платно (аренда делится поровну на всех).
  const computedPriceLabel = () => {
    if (formData.priceType === 'free') return 'Бесплатно';
    if (formData.priceType === 'paid' && formData.priceAmount > 0) {
      const per = formData.maxParticipants
        ? ` • при ${formData.maxParticipants} ≈ ${Math.round(formData.priceAmount / formData.maxParticipants)} ₽/чел`
        : '';
      return `Аренда ${formData.priceAmount} ₽ — делится поровну на всех${per}`;
    }
    return 'Бесплатно';
  };

  const handleSave = () => {
    onSave({
      ...event,
      title: formData.title,
      description: formData.description,
      date: formData.date,
      dateEnd: formData.dateEnd,
      dateLabel: buildDateLabel(formData.date, formData.dateEnd, formData.time),
      time: formData.time,
      timeEnd: formData.timeEnd,
      location: formData.location,
      locationDetails: formData.locationDetails,
      coordinates: formData.coordinates,
      image: formData.image,
      painPoint: formData.painPoint,
      maxParticipants: formData.maxParticipants,
      participantsCount: formData.participantsCount,
      status: formData.status,
      priceType: formData.priceType,
      priceLabel: computedPriceLabel(),
      priceAmount: formData.priceType === 'free' ? 0 : formData.priceAmount,
      entryThreshold: formData.entryThreshold,
      entryType: formData.entryType,
      program: formData.program,
      logistics: formData.logistics,
      paymentDetails: formData.paymentDetails,
      houseQualities: formData.houseQualities
    });
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" id="edit-event-modal">
      <div className="absolute inset-0 bg-black/95" onClick={onClose} />

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-[#121212] rounded-3xl w-full max-w-md shadow-2xl relative z-10 border border-white/10 p-6 space-y-4"
      >
        <h3 className="font-bold text-lg uppercase">Редактировать: {event.title}</h3>

        <div className="space-y-3 max-h-[60vh] overflow-y-auto">
          <div>
            <label className="text-[10px] text-white/40 uppercase font-mono block mb-1">
              Название *
            </label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({...formData, title: e.target.value})}
              className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white"
              placeholder="Например: Мужская баня FLINT"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-white/40 uppercase font-mono block mb-1">
                Дата начала *
              </label>
              <input
                type="date"
                value={formData.date}
                onChange={(e) => setFormData({...formData, date: e.target.value})}
                className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white"
              />
            </div>
            <div>
              <label className="text-[10px] text-white/40 uppercase font-mono block mb-1">
                Дата окончания
              </label>
              <input
                type="date"
                value={formData.dateEnd}
                min={formData.date}
                onChange={(e) => setFormData({...formData, dateEnd: e.target.value})}
                className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white"
              />
            </div>
          </div>
          <p className="text-[9px] text-white/40 -mt-2 mb-1">Для многодневных (поход, кемпинг) укажи дату окончания — подпись станет диапазоном автоматически.</p>


          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-white/40 uppercase font-mono block mb-1">
                Время начала
              </label>
              <input
                type="time"
                value={formData.time}
                onChange={(e) => setFormData({...formData, time: e.target.value})}
                className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white"
              />
            </div>

            <div>
              <label className="text-[10px] text-white/40 uppercase font-mono block mb-1">
                Время окончания
              </label>
              <input
                type="time"
                value={formData.timeEnd}
                onChange={(e) => setFormData({...formData, timeEnd: e.target.value})}
                className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white"
              />
            </div>
          </div>

          <div>
            <label className="text-[10px] text-white/40 uppercase font-mono block mb-1">
              Локация *
            </label>
            <input
              type="text"
              value={formData.location}
              onChange={(e) => setFormData({...formData, location: e.target.value})}
              className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white"
              placeholder="Например: Баня «Рыжий кот»"
            />
          </div>

          <div>
            <label className="text-[10px] text-white/40 uppercase font-mono block mb-1">
              Координаты (широта, долгота)
            </label>
            <input
              type="text"
              value={`${formData.coordinates.lat}, ${formData.coordinates.lng}`}
              onChange={(e) => {
                const parts = e.target.value.split(',').map(s => parseFloat(s.trim()));
                setFormData({...formData, coordinates: { lat: parts[0] || 0, lng: parts[1] || 0 }});
              }}
              className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white"
              placeholder="53.964962, 27.644397"
            />
          </div>

          {formData.priceType === 'paid' && (
            <PaymentDetailsEditor value={formData.paymentDetails} onChange={(v) => setFormData({...formData, paymentDetails: v})} />
          )}


          <div>
            <label className="text-[10px] text-white/40 uppercase font-mono block mb-1">
              Описание
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({...formData, description: e.target.value})}
              className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white"
              placeholder="Полное описание мероприятия..."
              rows={4}
            />
          </div>

          <ImageUploadField value={formData.image} onChange={(url) => setFormData({...formData, image: url})} />

          <div>
            <label className="text-[10px] text-white/40 uppercase font-mono block mb-1">
              Решаемая проблема / смысл (что закрывает событие)
            </label>
            <input
              type="text"
              value={formData.painPoint}
              onChange={(e) => setFormData({...formData, painPoint: e.target.value})}
              className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white"
              placeholder="Например: перезагрузка тела и ума, честный мужской круг"
            />
          </div>

          <QualityChips selected={formData.houseQualities} onChange={(q) => setFormData({...formData, houseQualities: q})} />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-white/40 uppercase font-mono block mb-1">
                Участники
              </label>
              <input
                type="number"
                value={formData.participantsCount}
                onChange={(e) => setFormData({...formData, participantsCount: parseInt(e.target.value)})}
                className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white"
              />
            </div>

            <div>
              <label className="text-[10px] text-white/40 uppercase font-mono block mb-1">
                Максимум мест
              </label>
              <input
                type="number"
                value={formData.maxParticipants}
                onChange={(e) => setFormData({...formData, maxParticipants: parseInt(e.target.value)})}
                className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-white/40 uppercase font-mono block mb-1">
                Тип цены
              </label>
              <select
                value={formData.priceType}
                onChange={(e) => setFormData({...formData, priceType: e.target.value as any})}
                className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white"
              >
                <option value="free">Бесплатно</option>
                <option value="paid">Платно (аренда делится)</option>
              </select>
            </div>

            <div>
              <label className="text-[10px] text-white/40 uppercase font-mono block mb-1">
                Кто может участвовать
              </label>
              <select
                value={formData.entryType}
                onChange={(e) => setFormData({...formData, entryType: e.target.value as any})}
                className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white"
              >
                <option value="all">Все</option>
                <option value="male">Только мужчины</option>
                <option value="female">Только женщины</option>
              </select>
            </div>
          </div>

          {formData.priceType === 'paid' && (
            <div>
              <label className="text-[10px] text-white/40 uppercase font-mono block mb-1">
                Сумма аренды (₽) — делится поровну на всех
              </label>
              <input
                type="number"
                value={formData.priceAmount}
                onChange={(e) => setFormData({...formData, priceAmount: parseInt(e.target.value) || 0})}
                className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white"
                placeholder="500"
              />
            </div>
          )}

          <div className="bg-white/5 border border-white/10 rounded-xl p-3">
            <p className="text-[10px] text-white/40 uppercase font-mono mb-1">Как увидят цену участники</p>
            <p className="text-sm text-brand font-bold">{computedPriceLabel()}</p>
            {formData.priceType === 'paid' && (
              <p className="text-[9px] text-white/40 mt-1 italic">
                Итоговая доля пересчитывается по числу участников. Если не набрался минимум — оплата возвращается.
              </p>
            )}
          </div>

          <ListEditor
            label="Программа события (🤖 ИИ)"
            placeholder="Шаг программы"
            items={formData.program}
            aiHint
            onChange={(v) => setFormData({...formData, program: v})}
            onGenerate={async () => { const ctx = { ...formData, type: event.type }; const ai = await aiProgram(ctx); setFormData({...formData, program: ai || generateProgram(ctx)}); }}
          />

          <ListEditor
            label="Порог входа (условия прохода)"
            placeholder="Условие"
            items={formData.entryThreshold ? formData.entryThreshold.split(/\s*[•·]\s*/).filter(Boolean) : []}
            onChange={(v) => setFormData({...formData, entryThreshold: v.join(' • ')})}
            onGenerate={() => setFormData({...formData, entryThreshold: generateThreshold({ ...formData, type: event.type }).join(' • ')})}
          />

          <div>
            <label className="text-[10px] text-white/40 uppercase font-mono block mb-1">
              Статус
            </label>
            <select
              value={formData.status}
              onChange={(e) => setFormData({...formData, status: e.target.value as any})}
              className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white"
            >
              <option value="open">Открыто</option>
              <option value="locked">Закрыто</option>
              <option value="closed">Завершено</option>
            </select>
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <button
            onClick={handleSave}
            className="flex-1 bg-brand hover:bg-brand-hover text-black py-3 rounded-xl text-xs font-bold uppercase"
          >
            Сохранить
          </button>
          <button
            onClick={onClose}
            className="flex-1 border border-white/10 py-3 rounded-xl text-xs font-bold uppercase text-white/60"
          >
            Отмена
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// Add Event Modal
function AddEventModal({ onClose, onAdd }: {
  onClose: () => void;
  onAdd: (event: CommunityEvent) => void;
}) {
  const [autoFilling, setAutoFilling] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    date: '',
    dateEnd: '',
    dateLabel: '',
    time: '',
    timeEnd: '',
    location: '',
    image: '',
    painPoint: '',
    type: 'mixed' as CommunityEvent['type'],
    maxParticipants: 15,
    description: '',
    priceType: 'free' as 'free' | 'paid',
    priceLabel: 'Свободный вход',
    priceAmount: 0,
    entryThreshold: '100% Трезвость',
    entryType: 'all' as 'male' | 'female' | 'all',
    program: [] as string[],
    logistics: {} as Record<string, any>,
    paymentDetails: {} as Record<string, any>,
    houseQualities: [] as HouseQuality[]
  });

  const handleAdd = () => {
    if (!formData.title || !formData.date) return;

    const newEvent: CommunityEvent = {
      id: `event-${Date.now()}`,
      title: formData.title,
      description: formData.description || 'Описание будет добавлено позже',
      type: formData.type,
      date: formData.date,
      dateEnd: formData.dateEnd,
      dateLabel: buildDateLabel(formData.date, formData.dateEnd, formData.time),
      time: formData.time,
      timeEnd: formData.timeEnd,
      location: formData.location,
      painPoint: formData.painPoint,
      houseQualities: formData.houseQualities,
      image: formData.image || '',
      maxParticipants: formData.maxParticipants,
      participantsCount: 0,
      telegramBotUrl: 'https://t.me/campsflint_bot',
      priceType: formData.priceType,
      priceLabel: formData.priceType === 'paid' && formData.priceAmount > 0
        ? `Аренда ${formData.priceAmount} ₽ — делится поровну на всех`
        : 'Бесплатно',
      priceAmount: formData.priceType === 'free' ? 0 : formData.priceAmount,
      entryThreshold: formData.entryThreshold,
      entryType: formData.entryType,
      status: 'locked',
      program: formData.program,
      logistics: formData.logistics,
      paymentDetails: formData.paymentDetails,
      notifications: {
        reminder7d: true,
        reminder3d: true,
        reminder1d: true,
        reminder3h: true,
        reminder1h: true
      }
    };

    onAdd(newEvent);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" id="add-event-modal">
      <div className="absolute inset-0 bg-black/95" onClick={onClose} />

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-[#121212] rounded-3xl w-full max-w-md shadow-2xl relative z-10 border border-white/10 p-6 space-y-4 max-h-[90vh] overflow-y-auto"
      >
        <h3 className="font-bold text-lg uppercase">Новое мероприятие</h3>

        <div className="space-y-3">
          <input
            type="text"
            placeholder="Название *"
            value={formData.title}
            onChange={(e) => setFormData({...formData, title: e.target.value})}
            className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white placeholder:text-white/30"
          />

          <button
            type="button"
            disabled={autoFilling || !formData.title.trim()}
            onClick={async () => {
              setAutoFilling(true);
              const { draft: d, error } = await aiAutofill({ title: formData.title, date: formData.date, dateEnd: formData.dateEnd });
              if (d) {
                setFormData((f) => ({
                  ...f,
                  type: d.type || f.type,
                  description: d.description || f.description,
                  painPoint: d.painPoint || f.painPoint,
                  program: (d.program && d.program.length) ? d.program : f.program,
                  entryThreshold: d.entryThreshold || f.entryThreshold,
                  houseQualities: (d.houseQualities && d.houseQualities.length) ? qualitiesFromKeys(d.houseQualities) : f.houseQualities,
                }));
              } else {
                alert(`ИИ не ответил:\n${error || 'неизвестная ошибка'}`);
              }
              setAutoFilling(false);
            }}
            className="w-full bg-brand/15 border border-brand/40 text-brand font-bold text-sm py-3 rounded-xl cursor-pointer hover:bg-brand/25 transition-colors disabled:opacity-50"
          >
            {autoFilling ? '⏳ ИИ придумывает событие…' : '🤖 Заполнить всё за меня'}
          </button>
          <p className="text-[9px] text-white/35 font-mono -mt-1">Введи название — ИИ придумает тип, описание, смысл, программу, порог и качества. Останется проверить.</p>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[9px] text-white/40 uppercase font-mono block mb-1">Дата начала *</label>
              <input
                type="date"
                value={formData.date}
                onChange={(e) => setFormData({...formData, date: e.target.value})}
                className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white"
              />
            </div>
            <div>
              <label className="text-[9px] text-white/40 uppercase font-mono block mb-1">Дата окончания</label>
              <input
                type="date"
                value={formData.dateEnd}
                min={formData.date}
                onChange={(e) => setFormData({...formData, dateEnd: e.target.value})}
                className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white"
              />
            </div>
          </div>
          <p className="text-[9px] text-white/40">Для многодневных укажи дату окончания — подпись станет диапазоном.</p>

          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              placeholder="Время начала (19:00)"
              value={formData.time}
              onChange={(e) => setFormData({...formData, time: e.target.value})}
              className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white placeholder:text-white/30"
            />
            <input
              type="text"
              placeholder="Время окончания (23:00)"
              value={formData.timeEnd}
              onChange={(e) => setFormData({...formData, timeEnd: e.target.value})}
              className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white placeholder:text-white/30"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <select
              value={formData.priceType}
              onChange={(e) => setFormData({...formData, priceType: e.target.value as 'free' | 'paid'})}
              className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white"
            >
              <option value="free">Бесплатно</option>
              <option value="paid">Платно (аренда делится)</option>
            </select>
            {formData.priceType === 'paid' ? (
              <input
                type="number"
                placeholder="Сумма аренды (₽)"
                value={formData.priceAmount || ''}
                onChange={(e) => setFormData({...formData, priceAmount: parseInt(e.target.value) || 0})}
                className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white placeholder:text-white/30"
              />
            ) : (
              <div className="flex items-center px-3 text-[11px] text-white/40 font-mono">Свободное участие</div>
            )}
          </div>
          {formData.priceType === 'paid' && formData.priceAmount > 0 && (
            <p className="text-[10px] text-brand font-mono">
              Аренда {formData.priceAmount} ₽ делится поровну — при {formData.maxParticipants} ≈ {Math.round(formData.priceAmount / (formData.maxParticipants || 1))} ₽/чел
            </p>
          )}

          <input
            type="text"
            placeholder="Локация"
            value={formData.location}
            onChange={(e) => setFormData({...formData, location: e.target.value})}
            className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white placeholder:text-white/30"
          />

          {formData.priceType === 'paid' && (
            <PaymentDetailsEditor value={formData.paymentDetails} onChange={(v) => setFormData({...formData, paymentDetails: v})} />
          )}

          <ImageUploadField value={formData.image} onChange={(url) => setFormData({...formData, image: url})} />

          <textarea
            placeholder="Описание мероприятия"
            value={formData.description}
            onChange={(e) => setFormData({...formData, description: e.target.value})}
            className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white placeholder:text-white/30"
            rows={3}
          />

          <div className="grid grid-cols-2 gap-2">
            <input
              type="number"
              placeholder="Макс. участников"
              value={formData.maxParticipants}
              onChange={(e) => setFormData({...formData, maxParticipants: parseInt(e.target.value)})}
              className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white"
            />

            <select
              value={formData.type}
              onChange={(e) => setFormData({...formData, type: e.target.value as any})}
              className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white"
            >
              <option value="male">Мужское Братство</option>
              <option value="mixed">Смешанный Круг</option>
              <option value="intellectual">Интеллектуальный Клуб</option>
              <option value="active">Активный Выезд</option>
            </select>
          </div>

          <div>
            <label className="text-[10px] text-white/40 uppercase font-mono block mb-1">Кто может участвовать</label>
            <select
              value={formData.entryType}
              onChange={(e) => setFormData({...formData, entryType: e.target.value as any})}
              className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white"
            >
              <option value="all">Все</option>
              <option value="male">Только мужчины</option>
              <option value="female">Только женщины</option>
            </select>
          </div>

          <QualityChips selected={formData.houseQualities} onChange={(q) => setFormData({...formData, houseQualities: q})} />

          <ListEditor
            label="Программа события (🤖 ИИ)"
            placeholder="Шаг программы"
            items={formData.program}
            aiHint
            onChange={(v) => setFormData({...formData, program: v})}
            onGenerate={async () => { const ai = await aiProgram(formData); setFormData({...formData, program: ai || generateProgram(formData)}); }}
          />

          <ListEditor
            label="Порог входа (условия прохода)"
            placeholder="Условие"
            items={formData.entryThreshold ? formData.entryThreshold.split(/\s*[•·]\s*/).filter(Boolean) : []}
            onChange={(v) => setFormData({...formData, entryThreshold: v.join(' • ')})}
            onGenerate={() => setFormData({...formData, entryThreshold: generateThreshold(formData).join(' • ')})}
          />
        </div>

        <div className="flex gap-2 pt-2">
          <button
            onClick={handleAdd}
            disabled={!formData.title || !formData.date}
            className="flex-1 bg-brand hover:bg-brand-hover text-black py-3 rounded-xl text-xs font-bold uppercase disabled:opacity-50"
          >
            Создать
          </button>
          <button
            onClick={onClose}
            className="flex-1 border border-white/10 py-3 rounded-xl text-xs font-bold uppercase text-white/60"
          >
            Отмена
          </button>
        </div>
      </motion.div>
    </div>
  );
}