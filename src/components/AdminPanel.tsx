import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { X, Lock, Unlock, Calendar, Users, Edit, Save, Plus, Trash2, Eye, EyeOff, Shield, RefreshCw, Send, CheckCircle, XCircle, BarChart3, MapPin, Package, DollarSign, Clock, FileText, Settings, Bell, UserCheck, UserX, ClipboardList, Truck, Flag, Play, Pause, X as XIcon, RotateCcw, ShoppingCart, ChefHat, Tent, Navigation, Award, MessageSquare, Star, UserPlus, UserMinus, Globe, Key, CheckSquare, Square, Activity, Heart, Vote, BookOpen, ChevronLeft, CornerUpLeft, Archive, Mail } from 'lucide-react';
import { CommunityEvent, HouseQuality, UserProfile } from '../types';
import { getInitData, isInsideTelegram } from '../telegram';
import { HOUSE_QUALITIES, qualitiesFromKeys } from '../houseQualities';
import { analyzeCommunityRequests, formatQualityDistribution, QUALITY_MAP } from '../development';
import { EVENT_TEMPLATES, EventTemplate } from '../data/eventTemplates';
import { generateProgram, generateThreshold } from '../eventGuide';

const API_BASE = typeof window !== 'undefined' ? window.location.origin + '/api' : '';

/**
 * Секрета в браузере больше нет: сервер выдаёт подписанную httpOnly-куку,
 * fetch подставляет её сам (credentials по умолчанию 'same-origin').
 * Раньше здесь лежал пароль, и он уезжал в публичный JS-бандл.
 */

/** ИИ-генерация программы (Gemini). Возвращает null при ошибке/без ключа — тогда фолбэк на локальный генератор.
 *  instruction + current → режим правки: ИИ редактирует текущую программу (перенос дат, пожелания). */
async function aiProgram(ev: any, instruction?: string, current?: string[]): Promise<string[] | null> {
  try {
    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // count: сколько ячеек программы админ создал — столько пунктов и генерим.
      body: JSON.stringify({ task: 'program', event: ev, people: ev.maxParticipants, count: Array.isArray(ev.program) ? ev.program.length : undefined, instruction: instruction || undefined, current: current && current.length ? current : undefined }),
    });
    const j = await res.json();
    return Array.isArray(j.program) && j.program.length ? j.program : null;
  } catch { return null; }
}

/** ИИ-генерация памятки участнику (logistics.prep): правила, сезон, снаряжение, протоколы. */
async function aiPrep(ev: any): Promise<string | null> {
  try {
    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: 'prep', event: ev, people: ev.maxParticipants }),
    });
    const j = await res.json();
    return typeof j.prep === 'string' && j.prep.trim() ? j.prep : null;
  } catch { return null; }
}

/** ИИ-генерация точек маршрута дня (logistics.itinerary). */
async function aiItinerary(ev: any, count?: number): Promise<any[] | null> {
  try {
    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: 'itinerary', event: ev, people: ev.maxParticipants, count }),
    });
    const j = await res.json();
    return Array.isArray(j.points) && j.points.length ? j.points : null;
  } catch { return null; }
}

/** Нормализация времени: "1800" → "18:00", пусто → "". */
function normalizeTime(t: string): string {
  if (!t) return '';
  const cleaned = t.replace(/[^0-9]/g, '');
  if (cleaned.length === 4) return `${cleaned.slice(0, 2)}:${cleaned.slice(2)}`;
  if (cleaned.length === 3) return `0${cleaned.slice(0, 1)}:${cleaned.slice(1)}`;
  return t;
}

/** ИИ-генерация обложки события (Gemini/Imagen). Возвращает data-URL или null. */
async function aiGenerateImage(title: string, description: string): Promise<string | null> {
  try {
    const prompt = `${title}: ${description}. Highly commercial, cinematic lighting, hyper-realistic photography, cinematic style, 8k, professional color grading, editorial look, clean composition, NO visual noise, premium quality`;
    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: 'generate_image', prompt }),
    });
    const j = await res.json();
    return j.imageUrl || j.dataUrl || null;
  } catch { return null; }
}

/** ИИ-генерация полного события по промпту. Сначала контент, потом обложка, потом уточняющие вопросы. */
async function aiGenerateFullEvent(prompt: string, onProgress: (step: string) => void): Promise<{ draft?: any; questions?: string[]; error?: string }> {
  onProgress('🤖 ИИ анализирует идею…');
  try {
    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: 'generate_event', prompt }),
    });
    const j = await res.json();
    if (j.draft) {
      onProgress('✍️ Формирование описания и тегов…');
      await new Promise(r => setTimeout(r, 300));
      if (j.draft.title) {
        onProgress('🎨 Создание кинематографичной обложки…');
        const imgUrl = await aiGenerateImage(j.draft.title, j.draft.description || '');
        if (imgUrl) j.draft.image = imgUrl;
      }
      // После генерации события запрашиваем уточняющие вопросы
      onProgress('💬 Формирование рекомендаций…');
      await new Promise(r => setTimeout(r, 200));
      const qRes = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: 'clarifying_questions', event: j.draft }),
      });
      const qJ = await qRes.json();
      if (qJ.questions && Array.isArray(qJ.questions)) {
        j.draft._questions = qJ.questions;
      }
      return { draft: j.draft };
    }
    return { error: j.error || `HTTP ${res.status}` };
  } catch (e) {
    return { error: (e as Error).message };
  }
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
  const addBlock = () => {
    const day = Math.floor(items.length / 5) + 1;
    const time = items.length % 5 === 0 ? '10:00' : '';
    onChange([...items, `[День ${day}] ${time ? time + ' — ' : ''}`]);
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
        <div className="flex gap-2">
          <button type="button" onClick={() => onChange([...items, ''])} className="flex-1 text-[11px] text-white/50 hover:text-white border border-dashed border-white/15 hover:border-white/30 rounded-lg px-2 py-1.5 cursor-pointer bg-transparent transition-colors">
            ＋ Пункт
          </button>
          <button type="button" onClick={addBlock} className="text-[11px] text-brand hover:text-brand-hover border border-brand/20 hover:border-brand/40 rounded-lg px-2 py-1.5 cursor-pointer bg-transparent transition-colors">
            ＋ День
          </button>
        </div>
      </div>
    </div>
  );
}

/** ИИ-список закупки: по числу участников и раскладке по питанию (Gemini). */
function ShoppingGenerator({ event, registrations }: { event: any; registrations: any[] }) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState('');
  // Реальный счёт ртов = сами участники + их гости (+N). Гости без анкеты —
  // считаем всеядными, но в общий счёт людей включаем, иначе будет недозакуп.
  const guests = registrations.reduce((s, r) => s + (r.guestCount || 0), 0);
  const people = (registrations.length + guests) || event.maxParticipants || 10;
  const diet = {
    vegan: registrations.filter((r) => r.dietary === 'vegan').length,
    vegetarian: registrations.filter((r) => r.dietary === 'vegetarian').length,
    children: registrations.reduce((s, r) => s + (r.childrenCount || 0), 0),
  };

  // Загрузка сохранённого списка при открытии события
  useEffect(() => {
    if (event?.shopping?.items) {
      setItems(Array.isArray(event.shopping.items) ? event.shopping.items : []);
    }
  }, [event?.id]);

  const gen = async () => {
    setLoading(true); setErr('');
    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: 'shopping', event, people, diet, guests }),
      });
      const j = await res.json();
      if (j.error) setErr(j.error); else setItems(j.items || []);
    } catch (e) { setErr((e as Error).message); }
    setLoading(false);
  };

  const save = async () => {
    try {
      // Query-форма (?eventId=) — путь-форма /events/:id на Vercel даёт 404 (нет [id]-роута).
      const res = await adminFetch(`/api/admin/events?eventId=${encodeURIComponent(event.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopping: { ...event.shopping, items, updated_at: new Date().toISOString() } }),
      });
      if (!res.ok) throw new Error('Ошибка сохранения');
      alert('✅ Список сохранён');
    } catch (e) { setErr((e as Error).message); }
  };

  const send = async () => {
    setSending(true);
    try {
      const res = await adminFetch(`/api/admin/events?action=shopping_send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: event.id, shopping: { ...event.shopping, items } }),
      });
      if (!res.ok) throw new Error('Ошибка отправки');
      alert('✅ Отправлено на согласование');
    } catch (e) { setErr((e as Error).message); }
    setSending(false);
  };

  // Запуск закупки: список уходит назначенному закупщику с кнопкой «сделано».
  const launch = async () => {
    if (!event?.shopping?.buyer_id) { setErr('Сначала выбери закупщика ниже'); return; }
    if (!items.length) { setErr('Список пуст — сгенерируй или добавь товары'); return; }
    setSending(true); setErr('');
    try {
      const res = await adminFetch(`/api/admin/events?action=shopping_launch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: event.id, shopping: { ...event.shopping, items } }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Ошибка запуска');
      alert(j.sent ? '🛒 Список отправлен закупщику!' : '⚠️ Закупщик не в боте — список сохранён, но сообщение не дошло');
    } catch (e) { setErr((e as Error).message); }
    setSending(false);
  };

  const approved = Array.isArray(event?.shopping?.approved_by) ? event.shopping.approved_by.length : 0;
  const estimate = Number(event?.shopping?.estimate) || 0;
  const buyerId = event?.shopping?.buyer_id;
  const buyer = registrations.find((r: any) => r.telegramId === buyerId);
  const notDrivers = registrations.filter((r: any) => !r.hasTransport);

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-bold uppercase flex items-center gap-2">
          <ShoppingCart className="w-4 h-4 text-brand" /> Список закупки · {people} чел
          {approved > 0 && <span className="text-[9px] text-green-400 ml-2">✅ согласили: {approved}</span>}
          {buyer && <span className="text-[9px] text-blue-400 ml-2">🛒 закупщик: {buyer.name}</span>}
        </h4>
        <button type="button" onClick={gen} disabled={loading} className="text-[10px] font-bold text-brand bg-brand/10 border border-brand/30 rounded-lg px-2 py-1 cursor-pointer hover:bg-brand/20 disabled:opacity-60 shrink-0">
          {loading ? '⏳ Считаю…' : '🤖 Сгенерировать'}
        </button>
      </div>
      <p className="text-[9px] text-white/35 font-mono">
        {registrations.length} запис.{guests > 0 ? ` + ${guests} гост.` : ''} · веган: {diet.vegan} · вегет.: {diet.vegetarian} · детей: {diet.children}
      </p>
      {err && <p className="text-[11px] text-red-400">{err}</p>}

      {items.length > 0 && (
        <div className="space-y-2">
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {items.map((it, i) => (
              <div key={i} className="flex justify-between gap-3 text-xs border-b border-white/5 py-1 items-center">
                <input
                  type="text"
                  value={it.item || ''}
                  onChange={(e) => {
                    const next = [...items];
                    next[i] = { ...next[i], item: e.target.value };
                    setItems(next);
                  }}
                  placeholder="Товар"
                  className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1 text-white text-xs placeholder:text-white/30"
                />
                <input
                  type="text"
                  value={it.qty || ''}
                  onChange={(e) => {
                    const next = [...items];
                    next[i] = { ...next[i], qty: e.target.value };
                    setItems(next);
                  }}
                  placeholder="Кол-во"
                  className="w-20 bg-white/5 border border-white/10 rounded px-2 py-1 text-white text-xs placeholder:text-white/30 text-right"
                />
                <button
                  type="button"
                  onClick={() => setItems(items.filter((_, idx) => idx !== i))}
                  className="text-red-400/60 hover:text-red-400 cursor-pointer text-xs"
                >✕</button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setItems([...items, { item: '', qty: '' }])}
            className="text-[10px] text-brand hover:text-brand/80 cursor-pointer"
          >+ Добавить товар</button>
        </div>
      )}

      {estimate > 0 && <p className="text-[10px] text-white/50">💰 Примерная сумма: <b>{estimate} BYN</b></p>}

      {/* Замечания участников к закупке (кнопка «Есть замечания» в боте) */}
      {Array.isArray(event?.shopping?.objections) && event.shopping.objections.length > 0 && (
        <div className="bg-yellow-400/5 border border-yellow-400/20 rounded-lg p-2 space-y-1">
          <p className="text-[9px] text-yellow-400 uppercase">✏️ Замечания ({event.shopping.objections.length})</p>
          {event.shopping.objections.slice(-6).map((o: any, i: number) => (
            <p key={i} className="text-[10px] text-white/70"><b>{o.name || o.tg_id}</b>: {o.text}</p>
          ))}
        </div>
      )}

      {/* Выбор закупщика */}
      <div className="bg-white/5 rounded-lg p-2 border border-white/10">
        <p className="text-[9px] text-white/50 uppercase mb-1">🛒 Закупщик события</p>
        <select
          value={buyerId || ''}
          onChange={async (e) => {
            const newBuyerId = e.target.value ? Number(e.target.value) : null;
            try {
              await adminFetch(`/api/admin/events?eventId=${encodeURIComponent(event.id)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ shopping: { ...event.shopping, buyer_id: newBuyerId } }),
              });
            } catch { /* no-op */ }
          }}
          className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-white text-xs placeholder:text-white/30"
        >
          <option value="">— не выбран —</option>
          {notDrivers.map((r: any) => (
            <option key={r.telegramId} value={r.telegramId} className="bg-[#121212]">
              {r.name} {r.status === 'confirmed' ? '✅' : '⏳'}
            </option>
          ))}
        </select>
        {!notDrivers.length && <p className="text-[9px] text-white/40 mt-1">Все участники водители — выбери из них или назначь организатора</p>}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={loading}
          className="text-[10px] font-bold text-green-400 bg-green-400/10 border border-green-400/30 rounded-lg px-3 py-1 cursor-pointer hover:bg-green-400/20 disabled:opacity-60 flex-1"
        >💾 Сохранить</button>
        <button
          type="button"
          onClick={send}
          disabled={sending || items.length === 0}
          className="text-[10px] font-bold text-blue-400 bg-blue-400/10 border border-blue-400/30 rounded-lg px-3 py-1 cursor-pointer hover:bg-blue-400/20 disabled:opacity-60 flex-1"
        >{sending ? '⏳ Отправляю…' : '📤 На согласование'}</button>
      </div>

      {/* Запуск закупки — список уходит закупщику, ждать крон не нужно */}
      <button
        type="button"
        onClick={launch}
        disabled={sending || items.length === 0 || !buyerId}
        className="w-full text-xs font-black uppercase text-black bg-brand rounded-lg px-3 py-2.5 cursor-pointer hover:bg-brand/80 disabled:opacity-40 disabled:cursor-not-allowed"
        title={!buyerId ? 'Сначала выбери закупщика' : 'Отправить список закупщику'}
      >🛒 Запустить закупку {buyerId ? '' : '(выбери закупщика)'}</button>
      {event?.shopping?.status === 'buying' && <p className="text-[10px] text-yellow-400 text-center">⏳ Закупщик закупается…</p>}
      {event?.shopping?.status === 'bought' && <p className="text-[10px] text-green-400 text-center">✅ Закупка выполнена</p>}
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
function LogisticsEditor({ value, onChange, event }: { value: any; onChange: (v: any) => void; event?: any }) {
  const v = value || {};
  const set = (k: string, val: any) => onChange({ ...v, [k]: val });
  const [prepGen, setPrepGen] = useState(false);
  const inp = 'w-full bg-white/5 border border-white/10 rounded-lg p-2 text-white text-sm placeholder:text-white/30';
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-3 space-y-2">
      <label className="text-[10px] text-white/40 uppercase font-mono block">🚗 Логистика / как добраться</label>
      <input value={v.assemblyPoint || ''} onChange={(e) => set('assemblyPoint', e.target.value)} placeholder="Точка сбора / выезда (напр. м. Каменная Горка)" className={inp} />
      <div className="grid grid-cols-2 gap-2">
        <input value={v.departureTime || ''} onChange={(e) => set('departureTime', e.target.value)} placeholder="Время выезда (18:30)" className={inp} />
        <input type="number" value={v.fuelCost || ''} onChange={(e) => set('fuelCost', parseInt(e.target.value) || 0)} placeholder="Бензин Br/чел" className={inp} />
      </div>
      <input value={v.returnInfo || ''} onChange={(e) => set('returnInfo', e.target.value)} placeholder="Обратная дорога (напр. ~22:00 обратно к метро)" className={inp} />
      <textarea value={v.notes || ''} onChange={(e) => set('notes', e.target.value)} placeholder="Как добраться / доп. детали" rows={2} className={inp} />

      {/* Мед-показания — НЕ прячем за кнопку «Как готовиться»: человек с
          противопоказанием обязан увидеть их ДО записи, а не после. */}
      <label className="text-[10px] text-white/40 uppercase font-mono block pt-1">🩺 Мед-показания: кому нельзя / с чем осторожно</label>
      <textarea
        value={v.medical || ''}
        onChange={(e) => set('medical', e.target.value)}
        placeholder={'Напр.: голодание не подходит при диабете и беременности; баня — при давлении и сердце.\nПоказывается прямо в карточке события, до кнопки записи.'}
        rows={2}
        className={inp}
      />

      {/* Короткие предупреждения-флаги: они меняют не подготовку, а ожидания. */}
      <div className="flex flex-wrap gap-2 pt-1">
        {[
          { k: 'detox', l: '📵 Цифровой детокс (без телефонов)' },
          { k: 'nosignal', l: '📡 Плохая связь / нет интернета' },
        ].map((f) => {
          const on = !!v[f.k];
          return (
            <button
              key={f.k}
              type="button"
              onClick={() => set(f.k, !on)}
              className={`px-3 py-2 rounded-xl border text-xs font-mono transition-colors cursor-pointer ${on ? 'border-[#E6FD3A]/60 text-[#E6FD3A] bg-[#E6FD3A]/10' : 'border-white/10 text-white/40 bg-transparent'}`}
            >
              {on ? '✓ ' : '– '}{f.l}
            </button>
          );
        })}
      </div>
      {/* Памятка: правила места, юридика, безопасность, снаряжение. Бот показывает
          кнопкой «Как готовиться» и прикладывает к чек-листу за день до выезда. */}
      <div className="flex items-center justify-between pt-1">
        <label className="text-[10px] text-white/40 uppercase font-mono block">📖 Памятка участнику (подготовка · правила · безопасность)</label>
        {event && (
          <button
            type="button"
            disabled={prepGen}
            onClick={async () => {
              setPrepGen(true);
              const prep = await aiPrep(event);
              if (prep) set('prep', prep);
              setPrepGen(false);
            }}
            className="text-[10px] font-bold text-brand bg-brand/10 border border-brand/30 rounded-lg px-2 py-1 cursor-pointer hover:bg-brand/20 disabled:opacity-60 shrink-0"
          >{prepGen ? '⏳ Пишу…' : '🤖 Сгенерировать'}</button>
        )}
      </div>
      <textarea value={v.prep || ''} onChange={(e) => set('prep', e.target.value)} placeholder={'Что взять, правила локации, штрафы, протокол при проверках, погода…\nУчастники увидят это в боте кнопкой «Как готовиться».'} rows={6} className={inp} />
    </div>
  );
}

/**
 * Редактор «Маршрута дня» — многоточечный план события (logistics.itinerary).
 * Бот показывает точки в карточке (itineraryBlock), строит маршрут в
 * Яндекс.Картах по координатам (нужно ≥2 точки с lat/lng) и шлёт таймлайн утром.
 * Структура точки: { time, title, lat, lng, payment, price, priceNote }.
 * payment: self (плачу сам) | host (организатор) | split (делим) | free.
 */
function ItineraryEditor({ value, onChange, event }: { value: any[]; onChange: (v: any[]) => void; event?: any }) {
  const pts: any[] = Array.isArray(value) ? value : [];
  const [gen, setGen] = useState(false);
  const inp = 'bg-white/5 border border-white/10 rounded-lg p-2 text-white text-sm placeholder:text-white/30';
  const PAY: [string, string][] = [['self', 'Плачу сам'], ['host', 'Организатор'], ['split', 'Делим поровну'], ['free', 'Бесплатно']];

  const upd = (i: number, patch: any) => onChange(pts.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  const add = () => onChange([...pts, { title: '', time: '', payment: 'self' }]);
  const generate = async () => {
    if (!event) return;
    setGen(true);
    // Координаты у ИИ-точек пустые — сохраняем уже проставленные, если совпадает порядок.
    const ai = await aiItinerary(event, pts.length || undefined);
    setGen(false);
    if (ai) onChange(ai.map((p: any, i: number) => ({ ...p, lat: pts[i]?.lat, lng: pts[i]?.lng })));
    else alert('Не удалось сгенерировать маршрут. Попробуй ещё раз или добавь точки вручную.');
  };
  const del = (i: number) => onChange(pts.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= pts.length) return;
    const next = [...pts];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-3 space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-[10px] text-white/40 uppercase font-mono">🧭 Маршрут дня — точки по времени</label>
        <div className="flex items-center gap-3">
          {event && (
            <button type="button" onClick={generate} disabled={gen} className="text-[11px] font-bold text-brand hover:text-brand/80 cursor-pointer disabled:opacity-50">
              {gen ? '⏳ Генерирую…' : '🤖 Сгенерировать'}
            </button>
          )}
          <button type="button" onClick={add} className="text-[11px] font-bold text-brand hover:text-brand/80 cursor-pointer">+ точка</button>
        </div>
      </div>
      {pts.length === 0 && (
        <p className="text-white/30 text-xs">Пока нет точек. Добавь остановки — бот покажет их в карточке и построит маршрут в Яндекс.Картах (нужны координаты у 2+ точек).</p>
      )}
      {pts.map((p, i) => {
        const showPrice = p.payment !== 'host' && p.payment !== 'free';
        return (
          <div key={i} className="bg-black/30 border border-white/10 rounded-lg p-2 space-y-2">
            <div className="flex gap-2 items-center">
              <input value={p.time || ''} onChange={(e) => upd(i, { time: e.target.value })} placeholder="10:00" className={`w-16 ${inp}`} />
              <input value={p.title || ''} onChange={(e) => upd(i, { title: e.target.value })} placeholder="Название точки (напр. Баня)" className={`flex-1 ${inp}`} />
              <button type="button" onClick={() => move(i, -1)} title="Выше" className="text-white/40 hover:text-white px-1 cursor-pointer">↑</button>
              <button type="button" onClick={() => move(i, 1)} title="Ниже" className="text-white/40 hover:text-white px-1 cursor-pointer">↓</button>
              <button type="button" onClick={() => del(i)} title="Удалить" className="text-red-400/70 hover:text-red-400 px-1 cursor-pointer">✕</button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {/* Вставка «53.28, 24.51» одной строкой (из Яндекс.Карт) раскидывается на оба поля */}
              <input type="text" inputMode="decimal" value={p.lat ?? ''} onChange={(e) => {
                const v = e.target.value.trim();
                const pair = v.match(/^(-?\d+(?:[.,]\d+)?)[,;\s]+(-?\d+(?:[.,]\d+)?)$/);
                if (pair) { upd(i, { lat: parseFloat(pair[1].replace(',', '.')), lng: parseFloat(pair[2].replace(',', '.')) }); return; }
                upd(i, { lat: v === '' ? undefined : parseFloat(v.replace(',', '.')) || undefined });
              }} placeholder="Широта или «lat, lng»" className={inp} />
              <input type="text" inputMode="decimal" value={p.lng ?? ''} onChange={(e) => upd(i, { lng: e.target.value === '' ? undefined : parseFloat(e.target.value.replace(',', '.')) || undefined })} placeholder="Долгота (lng)" className={inp} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <select value={p.payment || 'self'} onChange={(e) => upd(i, { payment: e.target.value })} className={inp}>
                {PAY.map(([k, l]) => <option key={k} value={k} className="bg-[#121212]">{l}</option>)}
              </select>
              {showPrice ? (
                <>
                  <input type="number" value={p.price || ''} onChange={(e) => upd(i, { price: parseInt(e.target.value) || 0 })} placeholder="BYN" className={inp} />
                  <input value={p.priceNote || ''} onChange={(e) => upd(i, { priceNote: e.target.value })} placeholder="за что" className={inp} />
                </>
              ) : <div className="col-span-2 flex items-center text-white/30 text-xs">без оплаты участником</div>}
            </div>
          </div>
        );
      })}
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

/**
 * Списочные поля заявки в БД лежат в ДВУХ форматах: массив (новые записи) и
 * строка через запятую (legacy — так писал старый онбординг бота). Интерфейс
 * зовёт на них .slice().map(), и одна legacy-строка роняла ВСЮ вкладку
 * «Участники» в белый экран (`inventory.slice(...).map is not a function`) —
 * организатор не мог посмотреть состав события. Приводим к массиву здесь,
 * чтобы ниже по коду формат был ровно один.
 */
function toList(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x) => x != null).map((x) => String(x));
  if (typeof v === 'string') return v.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
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
    inventory: toList(r.inventory),
    inviter: r.inviter || '',
    category: r.category || '',
    dietary: r.dietary || '',
    guestCount: r.guest_count || 0,
    childrenCount: r.children_count || 0,
    foodOptout: r.food_optout || false,
    attended: r.attended || false,
    equipment: toList(r.equipment),
    roles: toList(r.roles),
    days: toList(r.days),
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
    tents: [] as any[],
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
  /** Открыть главную афишу как админ (минуя шлюз-приглашение). */
  onViewSite?: () => void;
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

/** Метка времени сообщения: «14:32» сегодня, иначе «22.07 14:32». */
function fmtMsgTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (sameDay) return `${hh}:${mm}`;
  const dd = String(d.getDate()).padStart(2, '0');
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mo} ${hh}:${mm}`;
}

/** Дата вступления «22.07.26». */
function fmtJoinDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(2);
  return `${dd}.${mo}.${yy}`;
}
/** Сколько дней человек в боте (с даты вступления). */
function daysInBot(iso?: string): number {
  if (!iso) return 0;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}

/** Короткая метка отсчёта для админки: «сегодня», «завтра», «через 5 дн.», «прошло». */
function countdownLabel(date?: string, dateEnd?: string): string {
  const n = daysUntil(date);
  if (n === null) return '';
  // Идущее многодневное: старт уже прошёл, но последний день ещё не наступил.
  // Без учёта dateEnd такое событие подписывалось «прошло», хотя люди на месте.
  if (n < 0) {
    const end = daysUntil(dateEnd || date);
    return end !== null && end >= 0 ? 'идёт' : 'прошло';
  }
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
const ADMIN_TOKEN_KEY = 'flint_admin_token';

/**
 * Запрос к админ-API. ВСЕГДА подставляет `Authorization: Bearer` из
 * localStorage.
 *
 * Почему нельзя полагаться на куку: сессия ставится как `SameSite=Strict`, а
 * админку открывают ВНУТРИ Telegram Mini App — там страница живёт во встроенном
 * контексте, запросы считаются сторонними, и такая кука к ним не прикладывается.
 * Сервер отвечает 401, разделы (аудитория, переписка, инвентарь) просто не
 * открываются, и по виду это неотличимо от «сломалось».
 *
 * Кука при этом остаётся рабочей в обычном браузере — сервер принимает и её,
 * и Bearer, поэтому заголовок ничего не ломает, а лишь закрывает дыру.
 * ЕДИНАЯ точка: любые новые вызовы `/api/admin/*` делать через неё, иначе
 * дыра вернётся в следующем разделе.
 */
function adminFetch(input: string, init?: RequestInit): Promise<Response> {
  let token = '';
  try { token = localStorage.getItem(ADMIN_TOKEN_KEY) || ''; } catch { /* приватный режим */ }
  const headers = new Headers(init?.headers || {});
  if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}
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

/** Панель меню питания события */
function MenuPanel({ eventId }: { eventId: string }) {
  const [menu, setMenu] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [err, setErr] = useState('');

  const loadMenu = async () => {
    setLoading(true);
    setErr('');
    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'menu', eventId }),
      });
      const data = await res.json();
      setMenu(data.menu || []);
    } catch (e) {
      setErr('Не удалось загрузить меню');
    }
    setLoading(false);
  };

  const generateMenu = async () => {
    setGenerating(true);
    setErr('');
    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generate', eventId }),
      });
      const data = await res.json();
      if (data.ok) {
        setMenu(data.menu || []);
      } else {
        setErr(data.error || 'Ошибка генерации');
      }
    } catch (e) {
      setErr('Ошибка сети');
    }
    setGenerating(false);
  };

  useEffect(() => { loadMenu(); }, [eventId]);

  const mealLabels: Record<string, string> = {
    breakfast: 'Завтрак',
    lunch: 'Обед',
    dinner: 'Ужин',
    snack: 'Перекус',
  };

  const days = [...new Set(menu.map((m: any) => m.day))].sort();

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-bold uppercase flex items-center gap-2">
          <ChefHat className="w-4 h-4 text-brand" /> Меню питания
        </h4>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={loadMenu}
            disabled={loading}
            className="text-[10px] font-bold text-white/70 bg-white/5 border border-white/10 rounded-lg px-2 py-1 cursor-pointer hover:bg-white/10 disabled:opacity-60"
          >
            {loading ? '⏳' : '🔄 Обновить'}
          </button>
          <button
            type="button"
            onClick={generateMenu}
            disabled={generating}
            className="text-[10px] font-bold text-brand bg-brand/10 border border-brand/30 rounded-lg px-2 py-1 cursor-pointer hover:bg-brand/20 disabled:opacity-60"
          >
            {generating ? '⏳ Генерирую…' : '🤖 Сгенерировать меню'}
          </button>
        </div>
      </div>
      {err && <p className="text-[11px] text-red-400">{err}</p>}
      {loading && <p className="text-[11px] text-white/40">Загрузка…</p>}
      {!loading && menu.length === 0 && (
        <p className="text-[11px] text-white/40">Меню ещё не создано. Нажми «Сгенерировать меню» — ИИ подберёт блюда под профили участников.</p>
      )}
      {days.map((day: number) => (
        <div key={day}>
          <h5 className="text-[10px] font-bold uppercase text-brand mb-2">День {day}</h5>
          <div className="space-y-2">
            {['breakfast', 'lunch', 'dinner', 'snack'].map((mt) => {
              const items = menu.filter((m: any) => m.day === day && m.meal_type === mt);
              if (items.length === 0) return null;
              return (
                <div key={mt} className="bg-black/20 border border-white/10 rounded-lg p-2.5">
                  <p className="text-[9px] font-bold uppercase text-white/50 mb-1">{mealLabels[mt] || mt}</p>
                  {items.map((item: any, i: number) => (
                    <div key={i} className="flex items-start justify-between gap-2 text-xs">
                      <span className="text-white/90">{item.dish}</span>
                      {item.assigned_to && (
                        <span className="text-[9px] text-brand shrink-0">готовит: id{item.assigned_to}</span>
                      )}
                    </div>
                  ))}
                  {items[0]?.cooking_notes && (
                    <p className="text-[9px] text-white/40 mt-1 italic">{items[0].cooking_notes}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// Пост-сверка общих расходов события: делёж по головам + матрица «кто кому».
function ExpenseSplitter({ registrations, event }: { registrations: any[]; event?: any }) {
  // Сохранённые расходы из бота (кнопка «💸 Добавить расход» у участников).
  const saved: any[] = Array.isArray(event?.shopping?.expenses) ? event.shopping.expenses : [];
  const [splitBusy, setSplitBusy] = useState(false);
  const [splitResult, setSplitResult] = useState<string>('');
  const [live, setLive] = useState<any>(null);
  const [liveBusy, setLiveBusy] = useState(false);
  const refreshStatus = async () => {
    setLiveBusy(true);
    try {
      const res = await adminFetch(`/api/admin/events?action=split_status`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: event.id }),
      });
      const j = await res.json();
      if (res.ok && j.ok) setLive(j);
    } catch { /* no-op */ }
    setLiveBusy(false);
  };
  const sendSplit = async () => {
    if (!window.confirm('Разослать каждому участнику его долю и кому переводить?')) return;
    setSplitBusy(true); setSplitResult('');
    try {
      const res = await adminFetch(`/api/admin/events?action=split_send`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: event.id }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Ошибка');
      setSplitResult(`✅ Разослано ${j.sent} участникам · всего ${j.total} BYN\n` + (j.transfers || []).join('\n'));
    } catch (e) { setSplitResult(`❌ ${(e as Error).message}`); }
    setSplitBusy(false);
  };

  const attended = registrations.filter((r) => r.attended);
  const confirmed = registrations.filter((r) => r.status === 'confirmed');
  const base = (attended.length ? attended : confirmed.length ? confirmed : registrations).map((r) => r.name || 'Гость');
  // Уникализируем совпадающие имена (Гость, Гость → Гость, Гость 2).
  const seen: Record<string, number> = {};
  const people = base.map((n) => { seen[n] = (seen[n] || 0) + 1; return seen[n] > 1 ? `${n} ${seen[n]}` : n; });

  const [expenses, setExpenses] = useState<{ payer: string; label: string; amount: number }[]>([]);
  const addExpense = () => setExpenses((e) => [...e, { payer: people[0] || '', label: '', amount: 0 }]);
  const upd = (i: number, patch: Partial<{ payer: string; label: string; amount: number }>) =>
    setExpenses((e) => e.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const rm = (i: number) => setExpenses((e) => e.filter((_, idx) => idx !== i));

  const total = expenses.reduce((s, e) => s + (e.amount || 0), 0);
  const share = people.length ? total / people.length : 0;
  const balance: Record<string, number> = {};
  people.forEach((p) => (balance[p] = -share));
  expenses.forEach((e) => { if (balance[e.payer] !== undefined) balance[e.payer] += e.amount || 0; });

  // Матрица переводов — жадно минимизируем число транзакций.
  const creditors = people.filter((p) => balance[p] > 0.5).map((p) => ({ p, amt: balance[p] })).sort((a, b) => b.amt - a.amt);
  const debtors = people.filter((p) => balance[p] < -0.5).map((p) => ({ p, amt: -balance[p] })).sort((a, b) => b.amt - a.amt);
  const transfers: { from: string; to: string; amount: number }[] = [];
  let di = 0, ci = 0;
  while (di < debtors.length && ci < creditors.length) {
    const pay = Math.min(debtors[di].amt, creditors[ci].amt);
    if (pay > 0.5) transfers.push({ from: debtors[di].p, to: creditors[ci].p, amount: Math.round(pay) });
    debtors[di].amt -= pay; creditors[ci].amt -= pay;
    if (debtors[di].amt < 0.5) di++;
    if (creditors[ci].amt < 0.5) ci++;
  }

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
      <h4 className="text-xs font-bold uppercase flex items-center gap-2">
        <DollarSign className="w-4 h-4 text-brand" /> Делёж расходов · {people.length} чел · доля {Math.round(share)} Br
      </h4>

      {/* Расходы, внесённые участниками через бота (с чеками и отказами) */}
      {saved.length > 0 && (
        <div className="bg-white/5 border border-white/10 rounded-lg p-2 space-y-1">
          <p className="text-[9px] text-brand uppercase font-bold">💸 Из бота ({saved.length}) · всего {Math.round(saved.reduce((s, x) => s + (Number(x.amount) || 0), 0) * 100) / 100} BYN</p>
          {saved.map((x: any, i: number) => (
            <p key={i} className="text-[10px] text-white/70">
              <b>{x.title}</b> — {x.amount} BYN · {x.by_name}
              {x.photo ? ' · 🧾 чек' : ''}
              {Array.isArray(x.optout) && x.optout.length > 0 ? ` · 🚫 отказов: ${x.optout.length}` : ''}
            </p>
          ))}
          <button
            type="button"
            onClick={sendSplit}
            disabled={splitBusy}
            className="w-full mt-1 text-[10px] font-black uppercase text-black bg-brand rounded-lg px-3 py-2 cursor-pointer hover:bg-brand/80 disabled:opacity-50"
          >{splitBusy ? '⏳ Считаю…' : '📤 Разослать сплит в бот (по ртам: участник + гости)'}</button>
          {splitResult && <pre className="text-[9px] text-white/60 whitespace-pre-wrap mt-1">{splitResult}</pre>}

          {/* Должники / статус оплат: живой (по кнопке «обновить») или из загруженного события */}
          {(() => {
            const tr = (live?.transfers ?? event?.shopping?.split?.transfers);
            const hasTr = Array.isArray(tr) && tr.length > 0;
            return (
              <div className="mt-2 space-y-0.5">
                <div className="flex items-center justify-between">
                  <p className="text-[9px] text-white/50 uppercase font-bold">
                    Должники{hasTr ? ` (${tr.filter((t: any) => t.status !== 'confirmed').length} открыто)` : ''}
                  </p>
                  <button type="button" onClick={refreshStatus} disabled={liveBusy}
                    className="flex items-center gap-1 text-[9px] text-brand hover:text-brand-hover font-bold uppercase border-none bg-transparent cursor-pointer">
                    <RefreshCw className={`w-3 h-3 ${liveBusy ? 'animate-spin' : ''}`} /> Обновить
                  </button>
                </div>
                {live && (
                  <p className="text-[9px] text-white/40 font-mono">
                    Расходы: {live.expensesTotal} BYN · закрыто {live.confirmedSum} · висит {live.pendingSum}
                  </p>
                )}
                {!hasTr ? (
                  <p className="text-[10px] text-white/40">Сплит ещё не рассылали.</p>
                ) : tr.map((t: any, i: number) => (
                  <p key={i} className="text-[10px] text-white/70">
                    {t.status === 'confirmed' ? '✅' : t.status === 'sent' ? '🔵' : '🟡'} {t.from_name} → {t.to_name}: <b>{t.amount} BYN</b>
                    {t.reason ? <span className="text-white/35"> ({t.reason})</span> : null}
                    <span className="text-white/40"> · {t.status === 'confirmed' ? 'подтверждено' : t.status === 'sent' ? 'ждёт подтверждения' : 'висит'}</span>
                  </p>
                ))}
              </div>
            );
          })()}
        </div>
      )}

      {expenses.length === 0 && (
        <p className="text-[11px] text-white/40 italic">Добавь общие покупки (мясо, угли, аренда) — кто платил и сколько. Поделим поровну и покажем, кто кому переводит. Участники также сами вносят расходы с чеками в боте: «Логистика → 💸 Добавить расход».</p>
      )}
      {expenses.map((e, i) => (
        <div key={i} className="bg-black/20 border border-white/10 rounded-lg p-2.5 space-y-2">
          <div className="flex gap-2">
            <select value={e.payer} onChange={(ev) => upd(i, { payer: ev.target.value })} className="flex-1 bg-white/5 border border-white/10 rounded-lg p-2 text-white text-xs">
              {people.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <button type="button" onClick={() => rm(i)} className="text-white/40 hover:text-red-400 border-none bg-transparent cursor-pointer" aria-label="Удалить"><Trash2 className="w-4 h-4" /></button>
          </div>
          <div className="flex gap-2">
            <input type="text" value={e.label} onChange={(ev) => upd(i, { label: ev.target.value })} placeholder="За что (мясо, угли…)" className="flex-1 bg-white/5 border border-white/10 rounded-lg p-2 text-white text-xs placeholder:text-white/30" />
            <input type="number" value={e.amount || ''} onChange={(ev) => upd(i, { amount: parseInt(ev.target.value) || 0 })} placeholder="Br" className="w-24 bg-white/5 border border-white/10 rounded-lg p-2 text-white text-xs placeholder:text-white/30" />
          </div>
        </div>
      ))}
      <button type="button" onClick={addExpense} className="flex items-center gap-1.5 text-[11px] text-brand hover:text-brand-hover font-bold uppercase border-none bg-transparent cursor-pointer">
        <Plus className="w-3.5 h-3.5" /> Добавить расход
      </button>
      {transfers.length > 0 && (
        <div className="mt-2 pt-3 border-t border-white/10 space-y-2">
          <p className="text-[10px] text-white/40 uppercase font-mono">Итого {total} Br · доля {Math.round(share)} Br · кто кому:</p>
          {transfers.map((t, i) => (
            <div key={i} className="flex items-center justify-between bg-brand/5 border border-brand/15 rounded-lg px-3 py-2 text-xs">
              <span><b>{t.from}</b> → {t.to}</span>
              <span className="text-brand font-black">{t.amount} Br</span>
            </div>
          ))}
        </div>
      )}
      {expenses.length > 0 && transfers.length === 0 && total > 0 && (
        <p className="text-[11px] text-white/40 italic">Все в расчёте — переводить никому не нужно.</p>
      )}
    </div>
  );
}

export default function AdminPanel({ events, onUpdateEvent, onAddEvent, onDeleteEvent, onClose, onViewSite }: AdminPanelProps) {
  const [isAuthenticated, setIsAuthenticated] = useState(readSession);
  const [onlineAdmins, setOnlineAdmins] = useState<{ id: string; name: string }[]>([]);
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CommunityEvent | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  /** Прошедшие события скрыты за «Архивом»: в рабочем списке только актуальные. */
  const [showArchived, setShowArchived] = useState(false);
  /**
   * Архивным считаем событие, у которого прошёл ПОСЛЕДНИЙ день (dateEnd), —
   * по одному `date` многодневный выезд уезжал бы в архив на своём же втором дне.
   */
  const archiveSplit = React.useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const past: CommunityEvent[] = [], active: CommunityEvent[] = [];
    for (const e of events) ((e.dateEnd || e.date) < today ? past : active).push(e);
    return { past, active };
  }, [events]);
  const activeEvents = archiveSplit.active;
  const archivedEvents = archiveSplit.past;
  const [broadcasting, setBroadcasting] = useState<string | null>(null);
  const [broadcastResult, setBroadcastResult] = useState<{eventId: string, success: boolean, message: string} | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<CommunityEvent | null>(null);
  const [eventStats, setEventStats] = useState<any>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'participants' | 'logistics' | 'settings'>('overview');
  const [showTemplates, setShowTemplates] = useState(false);
  /** Дата события при создании из шаблона (§12.1: выбор пресета → дата → событие). */
  const [templateDate, setTemplateDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().split('T')[0];
  });
  /** Тост результата последнего действия админа (сохранение, рассылка). */
  const [actionMsg, setActionMsg] = useState<{ ok: boolean; text: string } | null>(null);
  /** Вкладка «Участники»: показывать всех или только тех, кто реально приехал. */
  const [onlyAttended, setOnlyAttended] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  /** Фильтр списка участников. Клик по карточке на «Обзоре» ставит нужный. */
  const [partFilter, setPartFilter] = useState<'all' | 'confirmed' | 'pending' | 'paid'>('all');
  /** Какая панель раскрыта во вкладке «Логистика». */
  const [logiPanel, setLogiPanel] = useState<'shopping' | 'cooking' | 'gear' | 'split' | 'menu' | null>(null);
  /** Модалка ввода вместо системных window.prompt (даты, причины, объявления). */
  const [inputModal, setInputModal] = useState<InputModalSpec | null>(null);
  /** Аудитория клуба (все участники, не по событию). */
  const [showAudience, setShowAudience] = useState(false);
  const [audience, setAudience] = useState<any>(null);
  /** Поиск по аудитории (имя / @ник). */
  const [audienceQuery, setAudienceQuery] = useState('');
  /** Фильтр аудитории по категории. */
  const [audienceFilter, setAudienceFilter] = useState<'all' | 'core' | 'blocked'>('all');
  /** Сортировка аудитории. */
  const [audienceSort, setAudienceSort] = useState<'default' | 'points' | 'attended' | 'name'>('default');

  /** Инвентарь клуба: список активов, кто держит, сколько дней. */
  const [showAssets, setShowAssets] = useState(false);
  const [assets, setAssets] = useState<any[] | null>(null);
  const [assetsNeedMigration, setAssetsNeedMigration] = useState(false);
  const loadAssets = async () => {
    try {
      const res = await adminFetch('/api/admin/registrations?action=assets');
      if (res.status === 401) { handleLogout(); return; }
      if (!res.ok) { setActionMsg({ ok: false, text: `Ошибка загрузки инвентаря: HTTP ${res.status}` }); return; }
      const j = await res.json();
      setAssets(j.assets || []);
      setAssetsNeedMigration(!!j.needsMigration);
    } catch (e) { setActionMsg({ ok: false, text: `Не удалось загрузить инвентарь: ${(e as Error).message}` }); }
  };
  const changeAssetHolder = async (a: any) => {
    const holderName = window.prompt(`У кого теперь «${a.name}»? Впиши имя нового держателя.`, a.holderName || '');
    if (holderName === null) return;
    try {
      const res = await adminFetch(`/api/admin/registrations?action=asset&assetId=${encodeURIComponent(a.id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ holderName: holderName.trim() }),
      });
      if (res.status === 401) { handleLogout(); return; }
      if (!res.ok) { setActionMsg({ ok: false, text: 'Не удалось обновить' }); return; }
      await loadAssets();
      setActionMsg({ ok: true, text: 'Держатель обновлён' });
    } catch { setActionMsg({ ok: false, text: 'Ошибка сети' }); }
  };

  /**
   * Персональные приглашения на событие. Раньше единственной рассылкой был
   * анонс «всем одобрённым» — на закрытый состав (мужское, по интересам,
   * ограниченные места) приглашать точечно было нечем.
   */
  const [invitingEvent, setInvitingEvent] = useState<CommunityEvent | null>(null);
  const [inviteIds, setInviteIds] = useState<string[]>([]);
  const [inviteQuery, setInviteQuery] = useState('');
  const [inviteSending, setInviteSending] = useState(false);

  /** Открыть выбор приглашённых: подтягиваем аудиторию, если ещё не загружена. */
  const openInvite = (event: CommunityEvent) => {
    setInvitingEvent(event);
    setInviteIds([]);
    setInviteQuery('');
    if (!audience) loadAudience();
  };

  /**
   * Кого вообще можно пригласить: одобренные члены клуба с настоящим Telegram id
   * (веб-заявки без бота имеют отрицательный хеш — им доставить нечем).
   */
  const inviteCandidates = React.useMemo(() => {
    const q = inviteQuery.trim().toLowerCase();
    return ((audience?.members || []) as any[])
      .filter((m) => m.status === 'approved' && Number(m.telegramId) > 0)
      .filter((m) => !q
        || String(m.firstName || '').toLowerCase().includes(q)
        || String(m.username || '').toLowerCase().includes(q));
  }, [audience, inviteQuery]);

  const sendInvites = async () => {
    if (!invitingEvent || inviteIds.length === 0 || inviteSending) return;
    setInviteSending(true);
    try {
      const res = await adminFetch('/api/admin/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: invitingEvent.id,
          audience: 'picked',
          telegramIds: inviteIds.map(Number),
        }),
      });
      if (res.status === 401) { handleLogout(); return; }
      const j = await res.json();
      if (j.ok) {
        setActionMsg({ ok: true, text: `Приглашения отправлены: ${j.sent} из ${j.total}${j.blocked ? ` · ${j.blocked} заблокировали бота` : ''}` });
        setInvitingEvent(null);
      } else {
        setActionMsg({ ok: false, text: j.message || j.error || 'Не удалось отправить приглашения' });
      }
    } catch {
      setActionMsg({ ok: false, text: 'Нет связи с сервером' });
    }
    setInviteSending(false);
  };

  /** Переписка поддержки: список диалогов и открытый тред. */
  const [showChats, setShowChats] = useState(false);
  const [conversations, setConversations] = useState<any[] | null>(null);
  const [activeThread, setActiveThread] = useState<any | null>(null);
  const [replyText, setReplyText] = useState('');
  const [replySending, setReplySending] = useState(false);
  const replyRef = useRef<HTMLTextAreaElement | null>(null);

  /**
   * «Ответить» на КОНКРЕТНОЕ сообщение: цитата + фокус в поле ответа. Одного
   * поля внизу треда не хватало — при длинной переписке было непонятно, на
   * какое сообщение отвечает костяк, а участник видел ответ без контекста.
   */
  const quoteMessage = (m: any) => {
    const raw = String(m?.text || '');
    const quote = raw.split('\n').slice(0, 3).join(' ').slice(0, 140);
    setReplyText(`> ${quote}${raw.length > 140 ? '…' : ''}\n\n`);
    // Фокус — сразу (узел textarea не пересоздаётся), каретка — после того как
    // React закоммитит новое значение, иначе она встанет по старой длине.
    replyRef.current?.focus();
    requestAnimationFrame(() => {
      const el = replyRef.current;
      if (el) el.setSelectionRange(el.value.length, el.value.length);
    });
  };

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
      const res = await adminFetch('/api/admin/registrations?action=members');
      if (res.status === 401) { handleLogout(); return; }
      if (!res.ok) { setActionMsg({ ok: false, text: `Ошибка загрузки участников: HTTP ${res.status}` }); return; }
      const j = await res.json();
      setAudience(j);
    } catch (e) {
      setActionMsg({ ok: false, text: `Не удалось загрузить участников: ${(e as Error).message}` });
    }
  };

  /** Переписка: список диалогов «костяк ↔ участник». */
  const loadConversations = async () => {
    try {
      const res = await adminFetch('/api/admin/registrations?action=conversations');
      if (res.status === 401) { handleLogout(); return; }
      if (!res.ok) { setActionMsg({ ok: false, text: `Ошибка загрузки переписки: HTTP ${res.status}` }); return; }
      const j = await res.json();
      setConversations(j.conversations || []);
    } catch (e) { setActionMsg({ ok: false, text: `Не удалось загрузить переписку: ${(e as Error).message}` }); }
  };

  /** Открыть полную ленту одного собеседника. */
  const openThread = async (tid: string, name?: string, username?: string) => {
    setActiveThread({ telegramId: tid, firstName: name, username, messages: null });
    setReplyText('');
    try {
      const res = await adminFetch(`/api/admin/registrations?action=conversation&tid=${encodeURIComponent(tid)}`);
      if (res.status === 401) { handleLogout(); return; }
      const j = await res.json();
      setActiveThread(j);
    } catch { setActionMsg({ ok: false, text: 'Не удалось открыть диалог' }); }
  };

  /** Ответить участнику прямо из админки (бот доставит + запишем в ленту). */
  const sendReply = async () => {
    const tid = activeThread?.telegramId;
    const text = replyText.trim();
    if (!tid || !text || replySending) return;
    if (Number(tid) <= 0) { setActionMsg({ ok: false, text: 'Веб-заявка без Telegram — ответить нельзя' }); return; }
    setReplySending(true);
    try {
      const res = await adminFetch('/api/admin/registrations?action=reply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegramId: Number(tid), text }),
      });
      if (res.status === 401) { handleLogout(); return; }
      const j = await res.json();
      if (j.ok) {
        setReplyText('');
        await openThread(String(tid), activeThread?.firstName, activeThread?.username);
        loadConversations();
        setActionMsg({ ok: true, text: 'Ответ отправлен' });
      } else {
        setActionMsg({ ok: false, text: j.error || 'Не отправлено' });
      }
    } catch { setActionMsg({ ok: false, text: 'Ошибка сети' }); }
    finally { setReplySending(false); }
  };

  /** Ручная правка «от кого пришёл»: защита очков (ссылку могли переслать). */
  /**
   * Пол по кругу: мужчина → женщина → не указан. Прompt здесь лишний — вариантов
   * всего три, а заполнять приходится пачкой у легаси-участников.
   */
  const cycleGender = async (m: any) => {
    const next = m.gender === 'male' ? 'female' : m.gender === 'female' ? null : 'male';
    await patchMember(m.telegramId, { gender: next });
  };

  const editReferrer = async (m: any) => {
    const input = window.prompt(
      `От кого пришёл ${m.firstName || m.username || 'участник'}?\nВведи @ник или Telegram id пригласившего. Пусто — очистить.`,
      m.username && m.referredByName ? '' : ''
    );
    if (input === null) return;
    const val = input.trim();
    let refId: number | null = null;
    if (val) {
      if (/^-?\d+$/.test(val)) refId = Number(val);
      else {
        const uname = val.replace(/^@/, '').toLowerCase();
        const found = ((audience?.members) || []).find((x: any) => String(x.username || '').toLowerCase() === uname);
        if (!found) { setActionMsg({ ok: false, text: `@${uname} не найден в аудитории` }); return; }
        refId = Number(found.telegramId);
      }
      if (refId === Number(m.telegramId)) { setActionMsg({ ok: false, text: 'Нельзя указать самого себя' }); return; }
    }
    await patchMember(Number(m.telegramId), { referredBy: refId });
  };

  /** Изменить права участника (костяк/статус/реферер) и обновить список аудитории. */
  const patchMember = async (telegramId: number, patch: { isCore?: boolean; status?: string; role?: string; referredBy?: number | null; gender?: string | null }) => {
    try {
      const res = await adminFetch(`/api/admin/registrations?action=member&telegramId=${telegramId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (res.status === 401) { handleLogout(); return; }
      if (!res.ok) { setActionMsg({ ok: false, text: 'Не удалось изменить права участника' }); return; }
      const j = await res.json().catch(() => ({}));
      await loadAudience();
      /**
       * Про группы говорим отдельно и честно. Если бот не админ в чате, Telegram
       * откажет — и забаненный ОСТАНЕТСЯ в группе события. Молчать об этом
       * нельзя: организатор будет думать, что человек изолирован.
       */
      const gk = j?.groupKick;
      if (gk && gk.groups > 0 && gk.failed?.length) {
        setActionMsg({
          ok: false,
          text: `Права обновлены, но в ${gk.failed.length} из ${gk.groups} групп не сработало — человек мог остаться в чате. Проверь, что бот админ группы. (${gk.failed[0]})`,
        });
      } else if (gk && gk.kicked > 0) {
        setActionMsg({ ok: true, text: `Права обновлены · группы события: ${gk.kicked} из ${gk.groups}` });
      } else {
        setActionMsg({ ok: true, text: 'Права участника обновлены' });
      }
    } catch {
      setActionMsg({ ok: false, text: 'Ошибка сети' });
    }
  };

  /** Отфильтрованный+отсортированный список аудитории (общий для рендера и экспорта). */
  const visibleAudience = (): any[] => {
    const q = audienceQuery.trim().toLowerCase();
    let list = ((audience?.members) || []).filter((m: any) => {
      if (audienceFilter === 'core' && !m.isCore) return false;
      if (audienceFilter === 'blocked' && m.status !== 'blocked') return false;
      if (q && !((m.firstName || '').toLowerCase().includes(q) || (m.username || '').toLowerCase().includes(q))) return false;
      return true;
    });
    if (audienceSort === 'points') list = [...list].sort((a: any, b: any) => (b.points || 0) - (a.points || 0));
    else if (audienceSort === 'attended') list = [...list].sort((a: any, b: any) => (b.attendedCount || 0) - (a.attendedCount || 0));
    else if (audienceSort === 'name') list = [...list].sort((a: any, b: any) => (a.firstName || '').localeCompare(b.firstName || ''));
    return list;
  };

  /** Скопировать текущий список аудитории в буфер (для выгрузки организатором). */
  const copyAudience = async () => {
    const list = visibleAudience();
    const text = list
      .map((m: any) => `${m.firstName || 'Без имени'}${m.username ? ' @' + m.username : ''} · ${m.points || 0} баллов · был ${m.attendedCount || 0} · привёл ${m.invitedCount || 0}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setActionMsg({ ok: true, text: `Скопировано: ${list.length} участников` });
    } catch {
      setActionMsg({ ok: false, text: 'Не удалось скопировать (буфер недоступен)' });
    }
  };

  /** Скопировать список участников события (с учётом активного фильтра) — контакты + логистика. */
  const copyParticipants = async () => {
    const regs = ((eventStats?.registrations) || []).filter((r: any) =>
      onlyAttended ? r.attended
      : partFilter === 'pending' ? r.status === 'pending'
      : partFilter === 'confirmed' ? r.status === 'confirmed'
      : partFilter === 'paid' ? r.paymentStatus === 'paid'
      : true);
    const statusRu = (r: any) => r.status === 'confirmed' ? 'подтверждён' : r.status === 'pending' ? 'ждёт' : (r.status || '');
    const text = regs.map((r: any) => {
      const parts: string[] = [r.name || 'Гость'];
      if (r.telegram) parts.push(/^[\d@]/.test(r.telegram) ? r.telegram : '@' + r.telegram);
      if (r.phone) parts.push(r.phone);
      parts.push(statusRu(r));
      if (r.hasTransport) parts.push(r.transportSeats ? `🚗 ${r.transportSeats} мест` : '🚗');
      return parts.join(' · ');
    }).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setActionMsg({ ok: true, text: `Скопировано: ${regs.length} участников` });
    } catch {
      setActionMsg({ ok: false, text: 'Не удалось скопировать (буфер недоступен)' });
    }
  };

  /**
   * Успех гаснет сам, ОШИБКА — нет. «Человек мог остаться в группе», «рассылка
   * не ушла» и подобное организатор обязан увидеть и осознанно закрыть: за 4
   * секунды такое сообщение легко пропустить, а последствия молчаливые.
   */
  useEffect(() => {
    if (!actionMsg || !actionMsg.ok) return;
    const t = setTimeout(() => setActionMsg(null), 4000);
    return () => clearTimeout(t);
  }, [actionMsg]);


  const createFromTemplate = (template: EventTemplate) => {
    const date = templateDate;
    // Многодневный шаблон → dateEnd от выбранной даты.
    let dateEnd = '';
    if (template.durationDays && template.durationDays > 1) {
      const end = new Date(`${date}T00:00:00`);
      end.setDate(end.getDate() + template.durationDays - 1);
      dateEnd = end.toISOString().split('T')[0];
    }

    const newEvent: CommunityEvent = {
      id: `event-${Date.now()}`,
      title: template.title,
      description: template.description,
      type: template.type,
      date,
      dateEnd: dateEnd || undefined,
      dateLabel: buildDateLabel(date, dateEnd, template.time),
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
      const res = await adminFetch('/api/admin/events?action=login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const j = await res.json();
      if (!res.ok) {
        setLoginError(j.error || (res.status === 401 ? 'Неверный пароль' : `Ошибка входа (${res.status})`));
        return;
      }
      // Сама сессия — в httpOnly-куке. Здесь только пометка, чтобы не мигать формой.
      try { localStorage.setItem(SESSION_KEY, JSON.stringify({ at: Date.now() })); } catch { /* приватный режим */ }
      // Сохраняем токен для API-запросов (снаряжение, профиль)
      if (j.token) try { localStorage.setItem(ADMIN_TOKEN_KEY, j.token); } catch {}
      setIsAuthenticated(true);
      setPassword('');
      // Кука получена — афиша в App теперь доступна, перезагружаем список.
      window.dispatchEvent(new Event('flint:events-refetch'));
    } catch (e) {
      setLoginError((e as Error).message);
    } finally {
      setLoggingIn(false);
    }
  };

  /** Вход костяка по Telegram-подписи (без пароля). Возвращает true при успехе. */
  const handleTelegramLogin = async (silent = false): Promise<boolean> => {
    const initData = getInitData();
    if (!initData) { if (!silent) setLoginError('Открой админку внутри Telegram, чтобы войти по подписи.'); return false; }
    if (!silent) { setLoginError(''); setLoggingIn(true); }
    try {
      const res = await adminFetch('/api/admin/events?action=login_telegram', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData }),
      });
      if (!res.ok) {
        // Тихую попытку не превращаем в ошибку — просто покажем обычную форму пароля.
        if (!silent) setLoginError(res.status === 403 ? 'Ты не в костяке клуба' : 'Подпись Telegram не подтверждена');
        return false;
      }
      const j = await res.json().catch(() => ({}));
      try { localStorage.setItem(SESSION_KEY, JSON.stringify({ at: Date.now() })); } catch { /* приватный режим */ }
      // Сохраняем токен для API-запросов — без него аудитория, переписка и инвентарь не работают.
      if (j.token) try { localStorage.setItem(ADMIN_TOKEN_KEY, j.token); } catch {}
      setIsAuthenticated(true);
      window.dispatchEvent(new Event('flint:events-refetch'));
      return true;
    } catch {
      if (!silent) setLoginError('Ошибка сети');
      return false;
    } finally {
      if (!silent) setLoggingIn(false);
    }
  };

  // Автовход костяка: внутри Telegram пробуем подпись сразу, без пароля.
  useEffect(() => {
    if (isAuthenticated || !isInsideTelegram()) return;
    handleTelegramLogin(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Веб-вход через Telegram (обычный браузер, где нет initData): сайт открывает
  // бота по одноразовому nonce, костяк подтверждает в боте, сайт опрашивает статус.
  const [webTgPolling, setWebTgPolling] = useState(false);
  const webTgTimer = useRef<any>(null);
  useEffect(() => () => { if (webTgTimer.current) clearInterval(webTgTimer.current); }, []);
  const handleWebTelegramLogin = () => {
    setLoginError('');
    // Криптостойкий nonce (64 hex).
    const buf = new Uint8Array(32);
    (window.crypto || (window as any).msCrypto).getRandomValues(buf);
    const nonce = Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join('');
    window.open(`https://t.me/campsflint_bot?start=weblogin_${nonce}`, '_blank', 'noopener');
    setWebTgPolling(true);
    let tries = 0;
    if (webTgTimer.current) clearInterval(webTgTimer.current);
    webTgTimer.current = setInterval(async () => {
      tries++;
      if (tries > 60) { clearInterval(webTgTimer.current); setWebTgPolling(false); setLoginError('Время вышло. Нажми ещё раз и подтверди в боте.'); return; }
      try {
        const res = await adminFetch(`/api/admin/events?action=weblogin_check&nonce=${nonce}`);
        if (res.status === 403) { clearInterval(webTgTimer.current); setWebTgPolling(false); setLoginError('Ты не в костяке клуба'); return; }
        const j = await res.json().catch(() => ({}));
        if (j.ok) {
          clearInterval(webTgTimer.current);
          setWebTgPolling(false);
          try { localStorage.setItem(SESSION_KEY, JSON.stringify({ at: Date.now() })); } catch { /* no-op */ }
          // Сохраняем токен для API-запросов — без него аудитория, переписка и инвентарь не работают.
          if (j.token) try { localStorage.setItem(ADMIN_TOKEN_KEY, j.token); } catch {}
          setIsAuthenticated(true);
          window.dispatchEvent(new Event('flint:events-refetch'));
        }
      } catch { /* сеть — продолжаем опрос */ }
    }, 2000);
  };

  // «Забыли пароль» — вход по коду из Telegram (OTP): @ник → код в личку → ввод.
  const [codeMode, setCodeMode] = useState(false);
  const [codeUser, setCodeUser] = useState('');
  const [codeVal, setCodeVal] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [codeBusy, setCodeBusy] = useState(false);
  const requestLoginCode = async () => {
    if (!codeUser.trim()) { setLoginError('Введи свой @ник в Telegram'); return; }
    setLoginError(''); setCodeBusy(true);
    try {
      const res = await adminFetch('/api/admin/events?action=request_login_code', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: codeUser.trim() }),
      });
      if (res.status === 429) { setLoginError('Слишком много попыток, попробуй позже.'); return; }
      setCodeSent(true);
    } catch { setLoginError('Ошибка сети'); }
    finally { setCodeBusy(false); }
  };
  const verifyLoginCode = async () => {
    if (codeVal.replace(/\D/g, '').length !== 6) { setLoginError('Код — 6 цифр'); return; }
    setLoginError(''); setCodeBusy(true);
    try {
      const res = await adminFetch('/api/admin/events?action=verify_login_code', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: codeUser.trim(), code: codeVal.trim() }),
      });
      const j = await res.json().catch(() => ({}));
      if (j.ok) {
        try { localStorage.setItem(SESSION_KEY, JSON.stringify({ at: Date.now() })); } catch { /* no-op */ }
        if (j.token) try { localStorage.setItem(ADMIN_TOKEN_KEY, j.token); } catch {}
        setIsAuthenticated(true);
        window.dispatchEvent(new Event('flint:events-refetch'));
      } else {
        setLoginError(j.error || 'Неверный код');
      }
    } catch { setLoginError('Ошибка сети'); }
    finally { setCodeBusy(false); }
  };

  const handleLogout = async () => {
    try { localStorage.removeItem(SESSION_KEY); } catch { /* no-op */ }
    try { localStorage.removeItem(ADMIN_TOKEN_KEY); } catch { /* no-op */ }
    try { await adminFetch('/api/admin/events?action=logout', { method: 'POST' }); } catch { /* no-op */ }
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
        const res = await adminFetch(`/api/admin/events?action=presence&id=${encodeURIComponent(tabId())}&name=${encodeURIComponent(name)}`, {
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
      const res = await adminFetch(`/api/admin/registrations?eventId=${encodeURIComponent(event.id)}`);
      // Кука протухла (12 ч) — просим войти заново, а не показываем пустые данные.
      if (res.status === 401) { handleLogout(); return false; }
      if (res.ok) {
        const data = await res.json();
        const regs = (data.registrations || []).map(mapRegistration);
        setEventStats(buildStats(regs, {
          rides: data.rides || [],
          tents: data.tents || [],
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
      const res = await adminFetch(`/api/admin/events?eventId=${encodeURIComponent(selectedEvent.id)}`, {
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
      const res = await adminFetch('/api/admin/broadcast', {
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
    // Выбор аудитории: всем в базе клуба (анонс) или только записанным на событие.
    const toAll = window.confirm(
      'Кому разослать?\n\nОК — ВСЕМ членам клуба в базе (анонс события).\nОтмена — только записанным на это событие.'
    );
    if (broadcasting) return;
    setBroadcasting(event.id);
    setBroadcastResult(null);
    try {
      // Рассылка идёт на сервере (токен бота не в браузере, безопасно).
      const res = await adminFetch('/api/admin/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: event.id, audience: toAll ? 'all' : 'event' }),
      });
      if (res.status === 401) { handleLogout(); return; }
      const data = await res.json().catch(() => ({}));
      setBroadcastResult({
        eventId: event.id,
        success: !!data.ok,
        message: data.ok
          ? `Отправлено ${data.sent}/${data.total} ${toAll ? 'членам клуба' : 'участникам'}`
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
      await adminFetch(`/api/admin/registrations?registrationId=${encodeURIComponent(reg.id)}`, {
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
            {codeMode ? (
              <>
                <p className="text-[11px] text-white/50 text-center">Вход по коду из Telegram — на случай, если забыл пароль.</p>
                <input
                  type="text"
                  value={codeUser}
                  onChange={(e) => { setCodeUser(e.target.value); setLoginError(''); }}
                  placeholder="Твой @ник в Telegram"
                  autoFocus
                  disabled={codeSent}
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white text-sm focus:outline-none focus:border-brand/40 disabled:opacity-60"
                  onKeyDown={(e) => e.key === 'Enter' && !codeSent && requestLoginCode()}
                />
                {!codeSent ? (
                  <button
                    onClick={requestLoginCode}
                    disabled={codeBusy || !codeUser.trim()}
                    className="w-full bg-brand hover:bg-brand-hover text-black py-3 rounded-xl text-xs font-bold uppercase tracking-widest disabled:opacity-50 cursor-pointer border-none"
                  >
                    {codeBusy ? 'Отправляю…' : 'Получить код в Telegram'}
                  </button>
                ) : (
                  <>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={codeVal}
                      onChange={(e) => { setCodeVal(e.target.value.replace(/\D/g, '').slice(0, 6)); setLoginError(''); }}
                      placeholder="6-значный код из бота"
                      autoFocus
                      className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white text-center text-lg tracking-[0.4em] font-mono focus:outline-none focus:border-brand/40"
                      onKeyDown={(e) => e.key === 'Enter' && verifyLoginCode()}
                    />
                    <button
                      onClick={verifyLoginCode}
                      disabled={codeBusy || codeVal.length !== 6}
                      className="w-full bg-brand hover:bg-brand-hover text-black py-3 rounded-xl text-xs font-bold uppercase tracking-widest disabled:opacity-50 cursor-pointer border-none"
                    >
                      {codeBusy ? 'Проверяю…' : 'Войти'}
                    </button>
                    <button onClick={() => { setCodeSent(false); setCodeVal(''); setLoginError(''); }} className="w-full text-white/40 text-[11px] cursor-pointer bg-transparent border-none">
                      Отправить код заново
                    </button>
                  </>
                )}
                {loginError && <p className="text-[11px] text-rose-400 text-center">{loginError}</p>}
                <button onClick={() => { setCodeMode(false); setCodeSent(false); setCodeVal(''); setLoginError(''); }} className="w-full text-white/50 text-[11px] uppercase tracking-wider cursor-pointer bg-transparent border-none">
                  ← Назад ко входу
                </button>
              </>
            ) : (
            <>
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
            <button onClick={() => { setCodeMode(true); setLoginError(''); }} className="w-full text-white/50 text-[11px] cursor-pointer bg-transparent border-none hover:text-white/80">
              Забыли пароль? Войти по коду из Telegram
            </button>

            <div className="flex items-center gap-2 my-1">
              <span className="h-px flex-1 bg-white/10" />
              <span className="text-[9px] text-white/30 uppercase font-mono">или</span>
              <span className="h-px flex-1 bg-white/10" />
            </div>
            {isInsideTelegram() ? (
              <>
                <button
                  onClick={() => handleTelegramLogin(false)}
                  disabled={loggingIn}
                  className="w-full bg-white/5 hover:bg-white/10 border border-white/10 text-white py-3 rounded-xl text-xs font-bold uppercase tracking-widest disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
                >
                  <Shield className="w-4 h-4 text-brand" />
                  Войти как костяк (Telegram)
                </button>
                <p className="text-[10px] text-white/35 text-center">Костяку пароль не нужен — вход по Telegram-подписи</p>
              </>
            ) : (
              <>
                <button
                  onClick={handleWebTelegramLogin}
                  disabled={webTgPolling}
                  className="w-full bg-white/5 hover:bg-white/10 border border-white/10 text-white py-3 rounded-xl text-xs font-bold uppercase tracking-widest disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
                >
                  <Shield className="w-4 h-4 text-brand" />
                  {webTgPolling ? 'Подтверди в Telegram…' : 'Войти через Telegram'}
                </button>
                <p className="text-[10px] text-white/35 text-center">
                  {webTgPolling ? 'Открыл бота — нажми «Да, это я». Вход выполнится сам.' : 'Костяку пароль не нужен — подтверди вход в боте'}
                </p>
              </>
            )}
            </>
            )}
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
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={() => { setShowAudience(true); loadAudience(); }}
                className="text-[11px] text-brand font-mono uppercase hover:underline cursor-pointer bg-transparent border-none p-0"
              >
                👥 Аудитория клуба →
              </button>
              <button
                onClick={() => { setShowChats(true); setActiveThread(null); loadConversations(); }}
                className="text-[11px] text-brand font-mono uppercase hover:underline cursor-pointer bg-transparent border-none p-0"
              >
                💬 Переписка →
              </button>
              <button
                onClick={() => { setShowAssets(true); loadAssets(); }}
                className="text-[11px] text-brand font-mono uppercase hover:underline cursor-pointer bg-transparent border-none p-0"
              >
                🎒 Инвентарь →
              </button>
            </div>
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
            {onViewSite && (
              <button
                onClick={onViewSite}
                className="text-[10px] font-mono uppercase text-black bg-brand hover:bg-brand/80 border-none rounded-full px-3 py-2 cursor-pointer font-bold whitespace-nowrap"
                title="Открыть афишу сообщества"
              >
                На главную →
              </button>
            )}
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
        {/* Результат действия — ПОВЕРХ всех оверлеев (аудитория/переписка/
            приглашения идут на z-[80..85]). Раньше баннер жил в теле панели и
            прятался под открытой модалкой: сообщение «человек мог остаться в
            группе» не доходило до организатора вообще.
            Портал в body обязателен: сама панель создаёт стекинг-контекст, и
            внутри него никакой z-index не поднимает тост над бэкдропом модалки
            (проверено — перекрывал `absolute inset-0 bg-black/95`). */}
        {actionMsg && createPortal(
          <div className="fixed inset-x-0 top-0 z-[95] flex justify-center px-3 pt-3 pointer-events-none">
            <div className={`pointer-events-auto max-w-2xl w-full px-4 py-2.5 rounded-xl text-xs flex items-start gap-2 border shadow-2xl backdrop-blur ${actionMsg.ok ? 'bg-[#14210a]/95 text-brand border-brand/30' : 'bg-[#2a0d12]/95 text-rose-300 border-rose-500/40'}`}>
              {actionMsg.ok ? <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" /> : <XCircle className="w-4 h-4 shrink-0 mt-0.5" />}
              <span className="leading-snug flex-1">{actionMsg.text}</span>
              {/* Ошибку закрывает только человек — см. таймер выше. */}
              {!actionMsg.ok && (
                <button
                  onClick={() => setActionMsg(null)}
                  className="shrink-0 p-0.5 rounded bg-white/10 hover:bg-white/20 border-none cursor-pointer text-rose-200"
                  title="Понятно, закрыть"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>,
          document.body,
        )}

        <div className="flex flex-col md:flex-row flex-1 overflow-hidden min-h-0">
          {/* Список событий. На мобильном прячется, когда открыто конкретное событие. */}
          {/* На мобильном колонка обязана быть flex-элементом с min-h-0, иначе
              shrink-0 + overflow-hidden родителя обрезали список и он НЕ скроллился. */}
          <div className={`w-full md:w-80 flex-1 md:flex-none md:shrink-0 min-h-0 border-b md:border-b-0 md:border-r border-white/10 overflow-y-auto p-4 space-y-3 md:max-h-none ${selectedEvent ? 'hidden md:block' : 'block'}`}>
            <div className="flex items-center justify-between mb-4">
              <span className="text-white/40 text-[10px] uppercase font-mono">
                {showArchived ? `Архив: ${archivedEvents.length}` : `Активные: ${activeEvents.length}`}
              </span>
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

            {/* Прошедшие события уходят в архив и не мешают работе по текущим.
                Удалять их нельзя — на них висят регистрации, расходы и отзывы. */}
            {archivedEvents.length > 0 && (
              <button
                onClick={() => setShowArchived((v) => !v)}
                className={`w-full mb-1 px-3 py-2 rounded-xl text-[10px] font-mono uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer border transition-all ${
                  showArchived ? 'bg-brand/10 border-brand/30 text-brand' : 'bg-white/5 border-white/10 text-white/50 hover:text-white'
                }`}
              >
                <Archive className="w-3.5 h-3.5" />
                {showArchived ? '← К активным' : `Архив (${archivedEvents.length})`}
              </button>
            )}

            {(showArchived ? archivedEvents : activeEvents).length === 0 && (
              <p className="text-white/35 text-[11px] font-mono text-center py-6">
                {showArchived ? 'Архив пуст.' : 'Активных мероприятий нет — создай новое кнопкой «+».'}
              </p>
            )}

            {sortByNearest(showArchived ? archivedEvents : activeEvents).map(event => {
              const cd = countdownLabel(event.date, event.dateEnd);
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

            {/* Event Details Panel. На мобильном без выбранного события панель-заглушку
              скрываем — иначе она отбирала половину высоты у списка мероприятий. */}
          <div className={`flex-1 overflow-y-auto p-4 md:p-6 min-h-0 ${selectedEvent ? 'block' : 'hidden md:block'}`}>
            {/* Кнопка «← Все события» — всегда видна, если выбрано событие */}
            {selectedEvent && (
              <button
                onClick={() => { setSelectedEvent(null); setEventStats(null); }}
                className="mb-3 flex items-center gap-1 text-xs text-white/60 hover:text-white bg-white/5 rounded-lg px-3 py-2 cursor-pointer border-none"
              >
                ← Все события
              </button>
            )}
            {!selectedEvent ? (
              (() => {
                const today = new Date().toISOString().slice(0, 10);
                const total = events.length;
                const open = events.filter(e => e.status === 'open').length;
                const upcoming = events.filter(e => e.date >= today).length;
                const totalParticipants = events.reduce((s, e) => s + (e.participantsCount || 0), 0);
                const totalCapacity = events.reduce((s, e) => s + (e.maxParticipants || 0), 0);
                const fill = totalCapacity > 0 ? Math.round((totalParticipants / totalCapacity) * 100) : 0;
                const cards: { icon: any; label: string; value: string | number; sub?: string; bar?: number }[] = [
                  { icon: Calendar, label: 'Событий всего', value: total, sub: `${open} открыто · ${upcoming} впереди` },
                  { icon: Users, label: 'Участников', value: totalParticipants, sub: `из ${totalCapacity} мест по всем событиям` },
                  { icon: Activity, label: 'Заполненность', value: `${fill}%`, bar: fill },
                  { icon: Clock, label: 'Предстоящих', value: upcoming, sub: `${total - upcoming} завершено` },
                ];
                return (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <BarChart3 className="w-5 h-5 text-brand" />
                      <h3 className="font-display font-black text-lg uppercase">Сводка по всем событиям</h3>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {cards.map((c, i) => {
                        const Icon = c.icon;
                        return (
                          <div key={i} className="bg-white/5 border border-white/10 rounded-xl p-4">
                            <div className="flex items-center gap-2 mb-2">
                              <Icon className="w-4 h-4 text-brand" />
                              <span className="text-[10px] text-white/60 uppercase font-mono">{c.label}</span>
                            </div>
                            <p className="text-2xl font-black">{c.value}</p>
                            {c.bar !== undefined ? (
                              <div className="w-full bg-white/10 rounded-full h-2 mt-2">
                                <div className="bg-brand h-2 rounded-full transition-all" style={{ width: `${Math.min(100, c.bar)}%` }} />
                              </div>
                            ) : (
                              <p className="text-xs text-white/40">{c.sub}</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-xs text-white/40 flex items-center gap-2 pt-1">
                      <Calendar className="w-4 h-4 shrink-0" /> Выбери мероприятие слева — детальная статистика, участники и логистика.
                    </p>
                  </div>
                );
              })()
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
                      {countdownLabel(selectedEvent.date, selectedEvent.dateEnd) && <span className="text-brand"> · {countdownLabel(selectedEvent.date, selectedEvent.dateEnd)}</span>}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {/* Точечное приглашение — не только при создании события:
                        добрать людей нужно и позже, когда мест не хватило. */}
                    <button
                      onClick={() => openInvite(selectedEvent)}
                      className="bg-white/5 hover:bg-white/10 border border-white/10 text-white px-4 py-2 rounded-xl text-xs font-bold uppercase flex items-center gap-2 cursor-pointer"
                    >
                      <Mail className="w-4 h-4 text-brand" />
                      Пригласить
                    </button>
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
                        <p className="text-xs text-white/40">{eventStats.totalAmount} Br · показать оплативших</p>
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

                    {/* Статус участников перед событием */}
                    {(() => {
                      const regs = eventStats.registrations || [];
                      const withFood = regs.filter((r: any) => r.dietary || r.food_optout).length;
                      const withEquipment = regs.filter((r: any) => Array.isArray(r.equipment) && r.equipment.length > 0).length;
                      const withRoles = regs.filter((r: any) => Array.isArray(r.roles) && r.roles.length > 0).length;
                      const inRides = regs.filter((r: any) => r.has_transport || (r.registeredRides && r.registeredRides.length > 0)).length;
                      const unconfirmed = regs.filter((r: any) => r.status !== 'confirmed').length;
                      return (
                        <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                          <h4 className="text-xs font-bold uppercase mb-3 flex items-center gap-2">
                            <Users className="w-4 h-4 text-brand" />
                            Статус участников перед событием
                          </h4>
                          <div className="space-y-2 text-xs">
                            <div className="flex justify-between items-center p-2 rounded-lg bg-white/5">
                              <span className="text-white/70">🍽 Питание указано</span>
                              <span className="font-mono text-brand">{withFood}/{regs.length}</span>
                              {withFood < regs.length && <span className="text-[9px] text-red-400 ml-auto">⚠️ {regs.length - withFood} не выбрали</span>}
                            </div>
                            <div className="flex justify-between items-center p-2 rounded-lg bg-white/5">
                              <span className="text-white/70">🧳 Снаряжение указано</span>
                              <span className="font-mono text-brand">{withEquipment}/{regs.length}</span>
                              {withEquipment < regs.length && <span className="text-[9px] text-red-400 ml-auto">⚠️ {regs.length - withEquipment} не выбрали</span>}
                            </div>
                            <div className="flex justify-between items-center p-2 rounded-lg bg-white/5">
                              <span className="text-white/70">🤝 Роли указаны</span>
                              <span className="font-mono text-brand">{withRoles}/{regs.length}</span>
                              {withRoles < regs.length && <span className="text-[9px] text-red-400 ml-auto">⚠️ {regs.length - withRoles} не выбрали</span>}
                            </div>
                            <div className="flex justify-between items-center p-2 rounded-lg bg-white/5">
                              <span className="text-white/70">🚗 В логистике</span>
                              <span className="font-mono text-brand">{inRides}/{regs.length}</span>
                              {inRides < regs.length && <span className="text-[9px] text-red-400 ml-auto">⚠️ {regs.length - inRides} без машины</span>}
                            </div>
                            {unconfirmed > 0 && (
                              <div className="flex justify-between items-center p-2 rounded-lg bg-red-500/10 border border-red-500/30">
                                <span className="text-red-400">⏳ Не подтверждены</span>
                                <span className="font-mono text-red-400">{unconfirmed}</span>
                              </div>
                            )}
                          </div>
                          {(withFood < regs.length || withEquipment < regs.length || withRoles < regs.length || unconfirmed > 0) && (
                            <button
                              onClick={async () => {
                                const msg = `📣 <b>Проверка перед событием «${selectedEvent.title}»</b>\n\n`;
                                const missing = [];
                                if (withFood < regs.length) missing.push(`🍽 Выбери питание (${regs.length - withFood} человек не выбрали)`);
                                if (withEquipment < regs.length) missing.push(`🧳 Укажи снаряжение (${regs.length - withEquipment} не выбрали)`);
                                if (withRoles < regs.length) missing.push(`🤝 Выбери роль (${regs.length - withRoles} не выбрали)`);
                                if (unconfirmed > 0) missing.push(`✅ Подтверди участие (${unconfirmed} не подтвердили)`);
                                if (missing.length === 0) { alert('Все участники готовы!'); return; }
                                setBroadcasting(selectedEvent.id);
                                try {
                                  await sendMessageToAll(msg + missing.map(m => `• ${m}`).join('\n'));
                                  setActionMsg({ ok: true, text: 'Напоминание отправлено всем' });
                                } catch (e) {
                                  setActionMsg({ ok: false, text: 'Ошибка рассылки' });
                                } finally {
                                  setBroadcasting(null);
                                }
                              }}
                              disabled={broadcasting === selectedEvent.id}
                              className="w-full mt-3 bg-brand/20 border border-brand/50 text-brand text-xs font-bold py-2 rounded-lg hover:bg-brand/30 disabled:opacity-50 cursor-pointer"
                            >
                              📤 Напомнить о пропусках
                            </button>
                          )}
                        </div>
                      );
                    })()}
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
                                <span className="text-white/90 text-xs font-medium">{f.author_name || `id${f.telegram_id}`}</span>
                                <span className="text-brand text-xs">{'★'.repeat(f.rating || 0)}</span>
                              </div>
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-[9px] text-white/40 font-mono">
                                  {f.created_at ? new Date(f.created_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}
                                </span>
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
                      <div className="p-3 border-b border-white/10 flex items-center justify-between gap-2">
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
                        <button
                          onClick={copyParticipants}
                          className="text-[10px] px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 font-bold uppercase cursor-pointer border-none shrink-0"
                        >
                          📋 Копировать
                        </button>
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
                                {/* Клик — правка транспорта руками: участник мог не заполнить в боте
                                    или сообщить детали голосом («у Саши 4-местный седан»). */}
                                <div
                                  onClick={async () => {
                                    const has = window.confirm(`У «${reg.name}» есть автомобиль?\n\nОК — есть, Отмена — нет/пешком.`);
                                    let body: any;
                                    if (has) {
                                      const car = window.prompt('Марка и цвет авто (чтобы находили на точке сбора):', reg.transportDetails && reg.transportDetails !== 'Свой автомобиль' ? reg.transportDetails : '') || '';
                                      const seats = window.prompt('Свободных мест (без водителя):', String(reg.transportSeats || 0)) || '0';
                                      body = { hasTransport: true, transportDetails: car.trim() || 'Свой автомобиль', transportSeats: parseInt(seats, 10) || 0 };
                                    } else {
                                      body = { hasTransport: false, transportDetails: null, transportSeats: 0 };
                                    }
                                    try {
                                      const res = await adminFetch(`/api/admin/registrations?registrationId=${encodeURIComponent(reg.id)}`, {
                                        method: 'PATCH',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify(body),
                                      });
                                      if (!res.ok) throw new Error(`HTTP ${res.status}`);
                                      setActionMsg({ ok: true, text: `Транспорт «${reg.name}» обновлён` });
                                    } catch (err) {
                                      setActionMsg({ ok: false, text: `Не удалось обновить транспорт: ${(err as Error).message}` });
                                    }
                                    await refreshStats(selectedEvent);
                                  }}
                                  title="Нажми, чтобы указать авто, марку/цвет и число мест"
                                  className={`p-2 rounded-lg border cursor-pointer hover:border-brand/60 transition-colors ${
                                  reg.hasTransport ? 'bg-brand/10 border-brand/30' : 'bg-white/5 border-white/10'
                                }`}>
                                  <div className="flex items-center gap-1 mb-1">
                                    <Truck className="w-3 h-3 text-brand" />
                                    <span className="text-[9px] font-bold uppercase">Транспорт ✏️</span>
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
                                      const res = await adminFetch(`/api/admin/registrations?registrationId=${encodeURIComponent(reg.id)}`, {
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
                    {(() => {
                      const regs = eventStats.registrations || [];
                      const cars = regs.filter((r: any) => r.hasTransport);
                      const seats = cars.reduce((s: number, r: any) => s + (r.transportSeats || 0), 0);
                      const gear = regs.flatMap((r: any) => r.inventory || []);
                      const tents = regs.filter((r: any) => (r.inventory || []).some((i: string) => /палат|тент/i.test(i))).length;
                      return (
                        <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                          <p className="text-[10px] text-white/40 uppercase font-mono mb-3">Сводка логистики</p>
                          <div className="grid grid-cols-3 gap-2 text-center">
                            <div><p className="text-2xl font-black">{cars.length}</p><p className="text-[9px] text-white/50 uppercase leading-tight">машин · {seats} мест</p></div>
                            <div><p className="text-2xl font-black">{tents}</p><p className="text-[9px] text-white/50 uppercase leading-tight">с палаткой</p></div>
                            <div><p className="text-2xl font-black">{gear.length}</p><p className="text-[9px] text-white/50 uppercase leading-tight">единиц снаряж.</p></div>
                          </div>
                          {gear.length > 0 && <p className="text-[10px] text-white/60 mt-3">🎒 {[...new Set(gear)].join(', ')}</p>}
                        </div>
                      );
                    })()}
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
                        onClick={() => setLogiPanel(logiPanel === 'menu' ? null : 'menu')}
                        className={`border rounded-xl p-4 text-left transition-all cursor-pointer ${logiPanel === 'menu' ? 'bg-brand/10 border-brand/30' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}
                      >
                        <ChefHat className="w-6 h-6 text-brand mb-2" />
                        <p className="text-xs font-bold uppercase">Меню питания</p>
                        <p className="text-[10px] text-white/40 mt-1">ИИ подберёт под профили</p>
                      </button>

                      <button
                        onClick={() => setLogiPanel(logiPanel === 'split' ? null : 'split')}
                        className={`border rounded-xl p-4 text-left transition-all cursor-pointer ${logiPanel === 'split' ? 'bg-brand/10 border-brand/30' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}
                      >
                        <DollarSign className="w-6 h-6 text-brand mb-2" />
                        <p className="text-xs font-bold uppercase">Делёж расходов</p>
                        <p className="text-[10px] text-white/40 mt-1">Свести чеки по головам</p>
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

                      <button
                        onClick={async () => {
                          const prog = selectedEvent.program || [];
                          if (!prog.length) { alert('Программа пока не добавлена'); return; }
                          if (!window.confirm('Разослать программу всем участникам события в Telegram?')) return;
                          setBroadcasting(selectedEvent.id);
                          try {
                            const msg = `📋 <b>Программа: ${selectedEvent.title}</b>\n\n${prog.map((p: any, i: number) => `${i + 1}. ${p.time || '—'} <b>${p.title || 'Точка'}</b>\n${p.description || ''}`).join('\n\n')}`;
                            await sendMessageToAll(msg);
                            setActionMsg({ ok: true, text: 'Программа разослана' });
                          } catch (e) {
                            setActionMsg({ ok: false, text: 'Ошибка рассылки' });
                          } finally {
                            setBroadcasting(null);
                          }
                        }}
                        disabled={broadcasting === selectedEvent.id}
                        className="bg-white/5 border border-white/10 rounded-xl p-4 text-left hover:bg-white/10 transition-all cursor-pointer disabled:opacity-50"
                      >
                        <BookOpen className="w-6 h-6 text-brand mb-2" />
                        <p className="text-xs font-bold uppercase">Разослать программу</p>
                        <p className="text-[10px] text-white/40 mt-1">Всем участникам в бот</p>
                      </button>

                      <button
                        onClick={async () => {
                          const unpaid = (eventStats.registrations || []).filter((r: any) => r.paymentStatus !== 'paid');
                          if (!unpaid.length) { alert('Все оплатили!'); return; }
                          if (!window.confirm(`Напомнить об оплате ${unpaid.length} участникам?`)) return;
                          setBroadcasting(selectedEvent.id);
                          try {
                            const details = selectedEvent.paymentDetails || {};
                            let msg = `💳 <b>Напоминание об оплате: ${selectedEvent.title}</b>\n\n`;
                            if (details.erip) msg += `ЕРИП: ${details.erip}\n`;
                            if (details.card) msg += `Карта: ${details.card}\n`;
                            if (details.method) msg += `${details.method}\n`;
                            msg += `\n👉 Раздел «Мои события» → событие → «💳 Оплатить»`;
                            await sendMessageToAll(msg);
                            setActionMsg({ ok: true, text: 'Напоминание отправлено' });
                          } catch (e) {
                            setActionMsg({ ok: false, text: 'Ошибка рассылки' });
                          } finally {
                            setBroadcasting(null);
                          }
                        }}
                        disabled={broadcasting === selectedEvent.id}
                        className="bg-white/5 border border-white/10 rounded-xl p-4 text-left hover:bg-white/10 transition-all cursor-pointer disabled:opacity-50"
                      >
                        <DollarSign className="w-6 h-6 text-brand mb-2" />
                        <p className="text-xs font-bold uppercase">Напомнить об оплате</p>
                        <p className="text-[10px] text-white/40 mt-1">Кто ещё не оплатил</p>
                      </button>

                      <button
                        onClick={async () => {
                          const needsRide = (eventStats.registrations || []).filter((r: any) => !r.hasTransport);
                          if (!needsRide.length) { alert('Все участники имеют транспорт'); return; }
                          if (!window.confirm(`Отправить список машин ${needsRide.length} участникам без транспорта?`)) return;
                          setBroadcasting(selectedEvent.id);
                          try {
                            const res = await adminFetch(`/api/admin/events?action=rides_send`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ eventId: selectedEvent.id }),
                            });
                            const j = await res.json();
                            if (j.ok) {
                              setActionMsg({ ok: true, text: `Отправлено ${j.sent}/${j.total} участникам (${j.rides} машин со свободными местами)` });
                            } else {
                              setActionMsg({ ok: false, text: j.message || 'Ошибка' });
                            }
                          } catch (e) {
                            setActionMsg({ ok: false, text: 'Ошибка рассылки' });
                          } finally {
                            setBroadcasting(null);
                          }
                        }}
                        disabled={broadcasting === selectedEvent.id}
                        className="bg-white/5 border border-white/10 rounded-xl p-4 text-left hover:bg-white/10 transition-all cursor-pointer disabled:opacity-50"
                      >
                        <Truck className="w-6 h-6 text-brand mb-2" />
                        <p className="text-xs font-bold uppercase">Разослать список машин</p>
                        <p className="text-[10px] text-white/40 mt-1">Тем, кто без транспорта</p>
                      </button>

                      <button
                        onClick={async () => {
                          const incomplete = (eventStats.registrations || []).filter((r: any) => !r.dietary || !r.equipment || !r.roles);
                          if (!incomplete.length) { alert('Все участники заполнили анкету!'); return; }
                          if (!window.confirm(`Отправить напоминание ${incomplete.length} участникам дополнить анкету?`)) return;
                          setBroadcasting(selectedEvent.id);
                          try {
                            const msg = `📋 <b>Дополни профиль!</b>\n\nЧтобы организаторы знали:\n🍽 Что ты ешь (веган/вегетарианец)\n🎒 Что везёшь (палатка, спальник и т.д.)\n🙌 Чем ты полезен (готовка, аптечка и т.д.)\n\nЭто помогает подготовить событие под каждого.\n\n👉 Открой событие в боте и заполни все пункты в меню регистрации.`;
                            await sendMessageToAll(msg);
                            setActionMsg({ ok: true, text: `Напоминание отправлено ${incomplete.length} участникам` });
                          } catch (e) {
                            setActionMsg({ ok: false, text: 'Ошибка рассылки' });
                          } finally {
                            setBroadcasting(null);
                          }
                        }}
                        disabled={broadcasting === selectedEvent.id}
                        className="bg-white/5 border border-white/10 rounded-xl p-4 text-left hover:bg-white/10 transition-all cursor-pointer disabled:opacity-50"
                      >
                        <ClipboardList className="w-6 h-6 text-brand mb-2" />
                        <p className="text-xs font-bold uppercase">Напомнить заполнить анкету</p>
                        <p className="text-[10px] text-white/40 mt-1">Тем, кто не дополнил</p>
                      </button>

                      <button
                        onClick={async () => {
                          if (!window.confirm('Разослать меню всем участникам события в Telegram?')) return;
                          setBroadcasting(selectedEvent.id);
                          try {
                            const menuRes = await fetch('/api/profile', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ action: 'menu', eventId: selectedEvent.id }),
                            });
                            const menuData = await menuRes.json();
                            const menu = menuData.menu || [];
                            if (menu.length === 0) {
                              setActionMsg({ ok: false, text: 'Меню ещё не сгенерировано' });
                              return;
                            }
                            const days = [...new Set(menu.map((m: any) => m.day))].sort();
                            let msg = `🍽 <b>Меню: ${selectedEvent.title}</b>\n\n`;
                            for (const day of days) {
                              msg += `<b>День ${day}</b>\n`;
                              const dayItems = menu.filter((m: any) => m.day === day);
                              for (const item of dayItems) {
                                const mealLabels: Record<string, string> = { breakfast: 'Завтрак', lunch: 'Обед', dinner: 'Ужин', snack: 'Перекус' };
                                msg += `${mealLabels[item.meal_type as keyof typeof mealLabels] || item.meal_type}: ${item.dish}\n`;
                                if (item.cooking_notes) msg += `   ${item.cooking_notes}\n`;
                              }
                              msg += '\n';
                            }
                            await sendMessageToAll(msg);
                            setActionMsg({ ok: true, text: 'Меню разослано участникам' });
                          } catch (e) {
                            setActionMsg({ ok: false, text: 'Ошибка рассылки меню' });
                          } finally {
                            setBroadcasting(null);
                          }
                        }}
                        disabled={broadcasting === selectedEvent.id}
                        className="bg-white/5 border border-white/10 rounded-xl p-4 text-left hover:bg-white/10 transition-all cursor-pointer disabled:opacity-50"
                      >
                        <ChefHat className="w-6 h-6 text-brand mb-2" />
                        <p className="text-xs font-bold uppercase">Разослать меню</p>
                        <p className="text-[10px] text-white/40 mt-1">Всем участникам в бот</p>
                      </button>

                      <button
                        onClick={async () => {
                          if (!window.confirm('Создать групповой чат для этого мероприятия?')) return;
                          setBroadcasting(selectedEvent.id);
                          try {
                            const res = await fetch('/api/profile', {
                              method: 'POST',
                              headers: {
                                'Content-Type': 'application/json',
                                Authorization: `Bearer ${localStorage.getItem('flint_admin_token')}`,
                              },
                              body: JSON.stringify({
                                action: 'create_event_chat',
                                eventId: selectedEvent.id,
                                chatId: 0, // Заглушка, в реальности нужно создавать чат через Telegram API
                                chatType: 'group',
                                inviteLink: 'https://t.me/+placeholder',
                              }),
                            });
                            const data = await res.json();
                            if (data.ok) {
                              setActionMsg({ ok: true, text: 'Групповой чат создан (заглушка)' });
                            } else {
                              setActionMsg({ ok: false, text: data.error || 'Ошибка создания чата' });
                            }
                          } catch (e) {
                            setActionMsg({ ok: false, text: 'Ошибка создания чата' });
                          } finally {
                            setBroadcasting(null);
                          }
                        }}
                        disabled={broadcasting === selectedEvent.id}
                        className="bg-white/5 border border-white/10 rounded-xl p-4 text-left hover:bg-white/10 transition-all cursor-pointer disabled:opacity-50"
                      >
                        <MessageSquare className="w-6 h-6 text-brand mb-2" />
                        <p className="text-xs font-bold uppercase">Создать чат</p>
                        <p className="text-[10px] text-white/40 mt-1">Группа для участников</p>
                      </button>

                      <button
                        onClick={async () => {
                          const candidates = eventStats?.registrations || [];
                          if (!candidates.length) { setActionMsg({ ok: false, text: 'Нет участников' }); return; }
                          setInputModal({
                            title: 'Начислить баллы',
                            submitLabel: 'Начислить',
                            fields: [
                              { key: 'telegramId', label: 'Участник', type: 'select', required: true, options: candidates.map((r: any) => ({ value: String(r.telegramId || r.telegram_id || ''), label: r.name || 'Гость' })) },
                              { key: 'points', label: 'Баллы', type: 'text', required: true, placeholder: 'напр. 50' },
                              { key: 'reason', label: 'Причина', type: 'text', required: true, placeholder: 'role / feedback / bonus' },
                              { key: 'description', label: 'Описание', type: 'text', placeholder: 'за что' },
                            ],
                            onSubmit: async (v) => {
                              await fetch('/api/profile', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('flint_admin_token')}` },
                                body: JSON.stringify({ action: 'add_points', telegramId: Number(v.telegramId), eventId: selectedEvent.id, reason: v.reason, points: Number(v.points), description: v.description }),
                              });
                              setActionMsg({ ok: true, text: 'Баллы начислены' });
                            },
                          });
                        }}
                        className="bg-white/5 border border-white/10 rounded-xl p-4 text-left hover:bg-white/10 transition-all cursor-pointer"
                      >
                        <Award className="w-6 h-6 text-brand mb-2" />
                        <p className="text-xs font-bold uppercase">Баллы</p>
                        <p className="text-[10px] text-white/40 mt-1">Ручное начисление</p>
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

                    {logiPanel === 'menu' && selectedEvent && (
                      <MenuPanel eventId={selectedEvent.id} />
                    )}

                    {logiPanel === 'split' && (
                      <ExpenseSplitter registrations={eventStats.registrations || []} event={selectedEvent} />
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
                                      {ride.fuel_cost ? `⛽ ${ride.fuel_cost} Br/чел` : '⛽ бесплатно'}
                                    </p>
                                  </div>
                                  <div className="text-right shrink-0">
                                    <p className="text-xs font-bold text-brand">{free} своб.</p>
                                    <p className="text-[9px] text-white/40">из {ride.seats_total || 0}</p>
                                  </div>
                                </div>
                                {/* Места визуально: зелёный квадрат = занято, пустой = свободно. */}
                                {(ride.seats_total || 0) > 0 && (
                                  <div className="flex flex-wrap gap-1 mt-2" title={`${ride.seats_taken || 0} занято, ${free} свободно`}>
                                    {Array.from({ length: ride.seats_total || 0 }).map((_, i) => (
                                      <span
                                        key={i}
                                        className={`w-4 h-4 rounded ${i < (ride.seats_taken || 0) ? 'bg-brand border border-brand' : 'bg-transparent border border-white/25'}`}
                                      />
                                    ))}
                                  </div>
                                )}
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

                    {/* Палатки — те же rides с kind='tent' */}
                    {eventStats.tents.length > 0 && (
                      <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                        <h4 className="text-xs font-bold uppercase mb-3 flex items-center gap-2">
                          <Tent className="w-4 h-4 text-brand" />
                          Палатки ({eventStats.tents.length})
                        </h4>
                        <div className="space-y-2">
                          {eventStats.tents.map((t: any) => {
                            const free = Math.max(0, (t.seats_total || 0) - (t.seats_taken || 0));
                            const gr = t.gender_rule === 'male' ? '♂ М' : t.gender_rule === 'female' ? '♀ Ж' : '👥 любые';
                            return (
                              <div key={t.id} className="bg-white/5 rounded-lg p-3">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="text-xs font-bold">⛺ {t.driver_name || 'Хозяин'}</p>
                                    <p className="text-[10px] text-white/40">подселение: {gr}</p>
                                  </div>
                                  <div className="text-right shrink-0">
                                    <p className="text-xs font-bold text-brand">{free} своб.</p>
                                    <p className="text-[9px] text-white/40">из {t.seats_total || 0}</p>
                                  </div>
                                </div>
                                {t.passengers?.length > 0 && (
                                  <p className="text-[10px] text-white/60 mt-2 pt-2 border-t border-white/5">
                                    В палатке: {t.passengers.map((p: any) => p.passenger_name).join(', ')}
                                  </p>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Инвентарь без машины — распределяем по водителям равномерно */}
                    {(() => {
                      const needCarry = (eventStats.registrations || []).filter((r: any) => (r.inventory || []).length > 0 && !r.hasTransport);
                      if (needCarry.length === 0) return null;
                      const cars = (eventStats.rides || []);
                      return (
                        <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4">
                          <h4 className="text-xs font-bold uppercase mb-3 flex items-center gap-2 text-amber-300">
                            <Package className="w-4 h-4" /> Инвентарь без машины ({needCarry.length})
                          </h4>
                          <div className="space-y-2">
                            {needCarry.map((r: any, i: number) => {
                              const driver = cars.length ? cars[i % cars.length] : null;   // равномерно по машинам
                              return (
                                <div key={r.id || i} className="text-[11px] text-white/80 bg-white/5 rounded-lg p-2">
                                  🎒 <b>{r.name}</b>: {(r.inventory || []).join(', ')}
                                  <span className="text-white/50">
                                    {' → '}{driver ? `подвезёт 🚗 ${driver.driver_name || 'Водитель'}` : 'нет свободной машины — нужен водитель'}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                          <p className="text-[9px] text-white/40 mt-2 italic">Предложение по равномерному распределению — согласуйте с водителями.</p>
                        </div>
                      );
                    })()}

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

      {/* Инвентарь клуба — кто чем владеет, у кого на руках, сколько держит */}
      <AnimatePresence>
        {showAssets && (
          <div className="fixed inset-0 z-[80] flex items-end md:items-center justify-center md:p-4">
            <div className="absolute inset-0 bg-black/95 backdrop-blur-sm" onClick={() => setShowAssets(false)} />
            <motion.div
              initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 40 }}
              className="bg-[#121212] md:rounded-3xl rounded-t-3xl w-full max-w-2xl relative z-10 border border-white/10 flex flex-col h-[90dvh] md:max-h-[85vh] text-white"
            >
              <div className="p-4 md:p-6 border-b border-white/10 flex items-center justify-between">
                <div>
                  <h3 className="font-display font-black text-lg uppercase">🎒 Инвентарь клуба</h3>
                  <p className="text-[11px] text-white/50 font-mono">{assets ? `${assets.length} позиций` : '…'}</p>
                </div>
                <button onClick={() => setShowAssets(false)} className="p-2 rounded-full bg-white/5 hover:bg-white/10 cursor-pointer border-none text-white"><X className="w-5 h-5" /></button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {assets === null ? (
                  <p className="text-white/40 text-xs text-center py-8">Загрузка…</p>
                ) : assetsNeedMigration ? (
                  <div className="text-center py-8 px-4">
                    <p className="text-white/60 text-sm">Таблица инвентаря ещё не создана.</p>
                    <p className="text-white/40 text-xs mt-2 font-mono">Накати миграцию <b>supabase/migrations/2026-club-assets.sql</b> в Supabase SQL Editor — появится весь список.</p>
                  </div>
                ) : assets.length === 0 ? (
                  <p className="text-white/40 text-xs text-center py-8">Пусто. Накати миграцию с сидом или добавь позиции.</p>
                ) : assets.map((a: any) => (
                  <div key={a.id} className="bg-white/5 border border-white/10 rounded-xl p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-sm">{a.name}</span>
                          {a.qty > 1 && <span className="text-[10px] bg-white/10 text-white/60 px-1.5 py-0.5 rounded font-mono">×{a.qty}</span>}
                          <span className="text-[9px] bg-white/5 text-white/40 px-1.5 py-0.5 rounded font-mono">{a.category}</span>
                          {a.isShared && <span className="text-[9px] bg-amber-500/15 text-amber-400 px-1.5 py-0.5 rounded font-mono">складчина</span>}
                        </div>
                        <div className="text-[11px] text-white/60 font-mono mt-1">
                          Владелец: <b className="text-white/80">{a.ownerName || '—'}</b>
                        </div>
                        <div className="text-[11px] text-white/60 font-mono">
                          🖐 У кого сейчас: <b className="text-brand">{a.holderName || '—'}</b>
                          {a.daysHeld !== null && <span className="text-white/40"> · {a.daysHeld === 0 ? 'сегодня взял' : `${a.daysHeld} дн на руках`}</span>}
                        </div>
                        {a.notes && <div className="text-[10px] text-white/40 mt-1 italic">{a.notes}</div>}
                      </div>
                      <button
                        onClick={() => changeAssetHolder(a)}
                        className="text-[10px] px-2 py-1 rounded-lg font-bold uppercase bg-brand/15 text-brand hover:bg-brand/25 cursor-pointer border-none shrink-0"
                        title="Передать / сменить держателя"
                      >
                        Передать
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Переписка поддержки — лента «костяк ↔ участник», ответ из админки */}
      <AnimatePresence>
        {showChats && (
          <div className="fixed inset-0 z-[80] flex items-end md:items-center justify-center md:p-4">
            <div className="absolute inset-0 bg-black/95 backdrop-blur-sm" onClick={() => { setShowChats(false); setActiveThread(null); }} />
            <motion.div
              initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 40 }}
              className="bg-[#121212] md:rounded-3xl rounded-t-3xl w-full max-w-2xl relative z-10 border border-white/10 flex flex-col h-[90dvh] md:max-h-[85vh] text-white"
            >
              {/* Header */}
              <div className="p-4 md:p-6 border-b border-white/10 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {activeThread && (
                    <button onClick={() => setActiveThread(null)} className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 cursor-pointer border-none text-white shrink-0" title="К списку">
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                  )}
                  <div className="min-w-0">
                    <h3 className="font-display font-black text-lg uppercase truncate">
                      {activeThread ? (activeThread.firstName || `id ${activeThread.telegramId}`) : 'Переписка'}
                    </h3>
                    <p className="text-[11px] text-white/50 font-mono truncate">
                      {activeThread
                        ? (activeThread.username ? '@' + activeThread.username : `id ${activeThread.telegramId}`)
                        : `диалогов: ${conversations?.length ?? '…'}`}
                    </p>
                  </div>
                </div>
                <button onClick={() => { setShowChats(false); setActiveThread(null); }} className="p-2 rounded-full bg-white/5 hover:bg-white/10 cursor-pointer border-none text-white shrink-0">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Список диалогов */}
              {!activeThread ? (
                <div className="flex-1 overflow-y-auto p-4 space-y-2">
                  {conversations === null ? (
                    <p className="text-white/40 text-xs text-center py-8">Загрузка…</p>
                  ) : conversations.length === 0 ? (
                    <p className="text-white/40 text-xs text-center py-8">Переписки пока нет. Сообщения из «💬 Поддержка» появятся здесь.</p>
                  ) : conversations.map((c: any) => (
                    <button
                      key={c.telegramId}
                      onClick={() => openThread(c.telegramId, c.firstName, c.username)}
                      className="w-full text-left bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl p-3 cursor-pointer transition-all flex items-start gap-3"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm truncate">{c.firstName || `id ${c.telegramId}`}</span>
                          {c.username && <span className="text-[11px] text-white/40 font-mono truncate">@{c.username}</span>}
                        </div>
                        <p className="text-xs text-white/60 truncate mt-0.5">
                          {c.lastDirection === 'out' ? '↩ ' : ''}{c.lastText}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span className="text-[9px] text-white/30 font-mono">{fmtMsgTime(c.lastAt)}</span>
                        {c.unanswered > 0 && (
                          <span className="bg-brand text-black text-[10px] font-black rounded-full px-1.5 min-w-5 h-5 flex items-center justify-center">{c.unanswered}</span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <>
                  {/* Лента одного собеседника */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
                    {activeThread.messages === null ? (
                      <p className="text-white/40 text-xs text-center py-8">Загрузка…</p>
                    ) : activeThread.messages.length === 0 ? (
                      <p className="text-white/40 text-xs text-center py-8">Сообщений нет.</p>
                    ) : activeThread.messages.map((m: any) => (
                      <div key={m.id} className={`flex items-end gap-1.5 ${m.direction === 'out' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 ${m.direction === 'out' ? 'bg-brand text-black rounded-br-sm order-2' : 'bg-white/10 text-white rounded-bl-sm'}`}>
                          <p className="text-sm whitespace-pre-wrap break-words">{m.text}</p>
                          <span className={`text-[9px] font-mono block mt-1 ${m.direction === 'out' ? 'text-black/50' : 'text-white/40'}`}>
                            {m.from_name ? `${m.from_name} · ` : ''}{fmtMsgTime(m.created_at)}
                          </span>
                        </div>
                        {/* Ответ на любое сообщение в ленте, включая свои
                            (бывает нужно дополнить сказанное). */}
                        <button
                          onClick={() => quoteMessage(m)}
                          title="Ответить на это сообщение"
                          className={`shrink-0 p-1.5 rounded-lg bg-white/5 hover:bg-white/15 text-white/50 hover:text-white cursor-pointer border-none ${m.direction === 'out' ? 'order-1' : ''}`}
                        >
                          <CornerUpLeft className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                  {/* Ответ */}
                  <div className="p-3 md:p-4 border-t border-white/10 flex items-end gap-2">
                    <textarea
                      ref={replyRef}
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendReply(); } }}
                      rows={1}
                      placeholder="Ответ участнику… (Ctrl+Enter — отправить)"
                      className="flex-1 bg-white/5 border border-white/10 rounded-xl p-2.5 text-white text-sm placeholder:text-white/30 focus:border-brand outline-none resize-none max-h-32"
                    />
                    <button
                      onClick={sendReply}
                      disabled={replySending || !replyText.trim() || Number(activeThread.telegramId) <= 0}
                      className="bg-brand hover:bg-brand-hover text-black font-black rounded-xl px-4 py-2.5 cursor-pointer border-none uppercase text-xs tracking-wider disabled:opacity-40 shrink-0"
                    >
                      {replySending ? '…' : 'Отпр.'}
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          </div>
        )}
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
                <div className="flex items-center gap-2 shrink-0">
                  {audience && (audience.members || []).length > 0 && (
                    <button
                      onClick={copyAudience}
                      className="text-[10px] px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 font-bold uppercase cursor-pointer border-none"
                    >
                      📋 Копировать
                    </button>
                  )}
                  <button onClick={() => setShowAudience(false)} className="p-2 rounded-full bg-white/5 hover:bg-white/10 cursor-pointer border-none text-white">
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>
              {audience && (audience.members || []).length > 0 && (
                <div className="px-4 md:px-6 pt-3 space-y-2">
                  <input
                    type="text"
                    value={audienceQuery}
                    onChange={(e) => setAudienceQuery(e.target.value)}
                    placeholder="Поиск по имени или @нику"
                    className="w-full bg-white/5 border border-white/10 rounded-xl p-2.5 text-white text-sm placeholder:text-white/30 focus:border-brand outline-none"
                  />
                  <div className="flex gap-2">
                    {([['all', 'Все'], ['core', 'Костяк'], ['blocked', 'Заблокированные']] as const).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setAudienceFilter(key)}
                        className={`text-[10px] px-2.5 py-1 rounded-lg font-bold uppercase transition-all cursor-pointer border-none ${audienceFilter === key ? 'bg-brand text-black' : 'bg-white/5 text-white/50 hover:bg-white/10'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2 items-center">
                    <span className="text-[9px] text-white/30 uppercase font-mono">Сортировка:</span>
                    {([['default', 'По умолч.'], ['points', 'Баллы'], ['attended', 'Визиты'], ['name', 'Имя']] as const).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setAudienceSort(key)}
                        className={`text-[10px] px-2 py-1 rounded-lg font-bold uppercase transition-all cursor-pointer border-none ${audienceSort === key ? 'bg-white/20 text-white' : 'bg-white/5 text-white/50 hover:bg-white/10'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {!audience ? (
                  <p className="text-white/40 text-xs text-center py-8">Загрузка…</p>
                ) : audience.members?.length === 0 ? (
                  <p className="text-white/40 text-xs text-center py-8">Пока только ты.</p>
                ) : (() => {
                  const list = visibleAudience();
                  if (list.length === 0) {
                    return <p className="text-white/40 text-xs text-center py-8">Никого не нашлось{audienceQuery ? ` по «${audienceQuery}»` : ''}.</p>;
                  }
                  return list.map((m: any) => (
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
                          {m.referredBy && (
                            <div className="text-[9px] text-white/45 font-mono mt-1">
                              ← пришёл от: {m.referredByName || (() => {
                                const inv = ((audience?.members) || []).find((x: any) => String(x.telegramId) === String(m.referredBy));
                                return inv ? (inv.firstName || (inv.username ? '@' + inv.username : `id${m.referredBy}`)) : `id${m.referredBy}`;
                              })()}
                            </div>
                          )}
                          <div className="text-[9px] text-white/40 font-mono mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                            {m.phone && <span>📞 {m.phone}</span>}
                            {m.createdAt && <span>в клубе с {fmtJoinDate(m.createdAt)} ({daysInBot(m.createdAt)} дн)</span>}
                          </div>
                          {/* Контроль состава: пол нужен для расселения по палаткам,
                              согласие на фото/видео — чтобы законно публиковать
                              галерею, правила — чтобы знать, кто их реально принял,
                              а не проскочил. Незаполненное подсвечиваем. */}
                          <div className="text-[9px] font-mono mt-1 flex flex-wrap gap-1.5">
                            <span className={`px-1.5 py-0.5 rounded ${m.gender ? 'bg-white/10 text-white/60' : 'bg-amber-500/15 text-amber-300'}`}>
                              {m.gender === 'male' ? '♂ мужчина' : m.gender === 'female' ? '♀ женщина' : '⚠ пол не указан'}
                            </span>
                            <span className={`px-1.5 py-0.5 rounded ${
                              m.mediaConsent === 'yes' ? 'bg-brand/15 text-brand'
                                : m.mediaConsent === 'no' ? 'bg-rose-500/15 text-rose-400'
                                : 'bg-amber-500/15 text-amber-300'
                            }`}>
                              {m.mediaConsent === 'yes' ? '📸 согласие есть' : m.mediaConsent === 'no' ? '📸 запретил съёмку' : '📸 не спрашивали'}
                            </span>
                            <span className={`px-1.5 py-0.5 rounded ${m.rulesAccepted ? 'bg-brand/15 text-brand' : 'bg-white/10 text-white/40'}`}>
                              {m.rulesAccepted ? `📜 правила приняты ${fmtJoinDate(m.rulesAccepted)}` : '📜 правила не приняты'}
                            </span>
                            {m.dietary && (
                              <span className="px-1.5 py-0.5 rounded bg-white/10 text-white/60">
                                🍽 {m.dietary === 'vegan' ? 'веган' : m.dietary === 'vegetarian' ? 'вегетарианец' : 'всё ест'}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-brand font-black text-sm">{m.points} 🏅</p>
                          <p className="text-[9px] text-white/40 font-mono">был: {m.attendedCount} · привёл: {m.invitedCount}</p>
                        </div>
                      </div>
                      <div className="mt-2 pt-2 border-t border-white/5 flex flex-wrap gap-2">
                        {m.realTelegram && (
                          <button
                            type="button"
                            onClick={() => { setShowAudience(false); setShowChats(true); setActiveThread(null); openThread(String(m.telegramId), m.firstName, m.username); loadConversations(); }}
                            className="text-[10px] px-2 py-1 rounded-lg font-bold uppercase transition-all cursor-pointer border-none bg-brand/15 text-brand hover:bg-brand/25"
                            title="Открыть переписку с участником"
                          >
                            ✍️ Написать
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => editReferrer(m)}
                          className="text-[10px] px-2 py-1 rounded-lg font-bold uppercase transition-all cursor-pointer border-none bg-white/10 text-white/70 hover:bg-white/20"
                          title="Изменить, от кого пришёл (защита баллов)"
                        >
                          ✎ Реферер
                        </button>
                        {/* Пол правим вручную: у легаси-участников его нет, а без
                            него не разложить по палаткам и не посчитать М/Ж. */}
                        <button
                          type="button"
                          onClick={() => cycleGender(m)}
                          className={`text-[10px] px-2 py-1 rounded-lg font-bold uppercase transition-all cursor-pointer border-none ${
                            m.gender ? 'bg-white/10 text-white/70 hover:bg-white/20' : 'bg-amber-500/15 text-amber-300 hover:bg-amber-500/25'
                          }`}
                          title="Переключить пол: мужчина → женщина → не указан"
                        >
                          ✎ Пол
                        </button>
                        <button
                          type="button"
                          onClick={() => patchMember(m.telegramId, { isCore: !m.isCore })}
                          className={`text-[10px] px-2 py-1 rounded-lg font-bold uppercase transition-all cursor-pointer border-none ${m.isCore ? 'bg-white/10 text-white/60 hover:bg-white/20' : 'bg-brand/15 text-brand hover:bg-brand/25'}`}
                        >
                          {m.isCore ? 'Убрать из костяка' : '★ Сделать костяком'}
                        </button>
                        <button
                          type="button"
                          onClick={() => patchMember(m.telegramId, { status: m.status === 'blocked' ? 'approved' : 'blocked' })}
                          className={`text-[10px] px-2 py-1 rounded-lg font-bold uppercase transition-all cursor-pointer border-none ${m.status === 'blocked' ? 'bg-brand/15 text-brand hover:bg-brand/25' : 'bg-rose-500/15 text-rose-400 hover:bg-rose-500/25'}`}
                        >
                          {m.status === 'blocked' ? 'Разблокировать' : 'Заблокировать'}
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            const reason = window.prompt('Причина удаления (будет отправлена пользователю в Telegram):');
                            if (reason === null) return; // отмена
                            if (reason.trim()) {
                              if (!window.confirm(`Удалить пользователя ${m.firstName || m.username} навсегда с отправкой причины? Он сможет заново зарегистрироваться.`)) return;
                              try {
                                const res = await adminFetch(`/api/admin/registrations?action=member&telegramId=${m.telegramId}`, {
                                  method: 'DELETE',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ reason: reason.trim() }),
                                });
                                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                                setActionMsg({ ok: true, text: `Пользователь удалён. Причина отправлена.` });
                                await loadAudience();
                              } catch (err) {
                                setActionMsg({ ok: false, text: `Ошибка: ${(err as Error).message}` });
                              }
                            }
                          }}
                          className="text-[10px] px-2 py-1 rounded-lg font-bold uppercase transition-all cursor-pointer border-none bg-rose-500/15 text-rose-400 hover:bg-rose-500/25"
                          title="Удалить навсегда с пояснением"
                        >
                          Удалить с пояснением
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            if (!window.confirm(`Удалить пользователя ${m.firstName || m.username} навсегда БЕЗ пояснения? Он сможет заново зарегистрироваться.`)) return;
                            try {
                              const res = await adminFetch(`/api/admin/registrations?action=member&telegramId=${m.telegramId}`, {
                                method: 'DELETE',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({}),
                              });
                              if (!res.ok) throw new Error(`HTTP ${res.status}`);
                              setActionMsg({ ok: true, text: `Пользователь удалён без пояснения.` });
                              await loadAudience();
                            } catch (err) {
                              setActionMsg({ ok: false, text: `Ошибка: ${(err as Error).message}` });
                            }
                          }}
                          className="text-[10px] px-2 py-1 rounded-lg font-bold uppercase transition-all cursor-pointer border-none bg-rose-500/15 text-rose-400 hover:bg-rose-500/25"
                          title="Удалить навсегда без пояснения"
                        >
                          Удалить без пояснения
                        </button>
                      </div>
                    </div>
                  ));
                })()}
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
              // Сразу предлагаем позвать людей: событие без участников никому не
              // видно, а вспомнить про приглашения потом — отдельный шаг, который
              // владелец и просил убрать.
              openInvite(newEvent);
            }}
          />
        )}
      </AnimatePresence>

      {/* Выбор приглашённых на событие */}
      <AnimatePresence>
        {invitingEvent && (
          <div className="fixed inset-0 z-[85] flex items-end md:items-center justify-center md:p-4">
            <div className="absolute inset-0 bg-black/95 backdrop-blur-sm" onClick={() => setInvitingEvent(null)} />
            <motion.div
              initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 40 }}
              className="bg-[#121212] md:rounded-3xl rounded-t-3xl w-full max-w-lg relative z-10 border border-white/10 flex flex-col h-[90dvh] md:max-h-[85vh] text-white"
            >
              <div className="p-4 md:p-6 border-b border-white/10 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-display font-black text-lg uppercase truncate">Кого пригласить</h3>
                  <p className="text-[11px] text-white/50 font-mono truncate">{invitingEvent.title}</p>
                </div>
                <button onClick={() => setInvitingEvent(null)} className="p-2 rounded-full bg-white/5 hover:bg-white/10 cursor-pointer border-none text-white shrink-0">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-4 pb-2 space-y-2 shrink-0">
                <input
                  value={inviteQuery}
                  onChange={(e) => setInviteQuery(e.target.value)}
                  placeholder="Поиск по имени или @нику…"
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-2.5 text-white text-sm placeholder:text-white/30 outline-none focus:border-brand"
                />
                {(() => {
                  const list = inviteCandidates;
                  const allPicked = list.length > 0 && list.every((m) => inviteIds.includes(m.telegramId));
                  return (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] text-white/40 font-mono uppercase">
                        выбрано {inviteIds.length} из {list.length}
                      </span>
                      <button
                        onClick={() => setInviteIds(allPicked ? [] : list.map((m) => m.telegramId))}
                        disabled={list.length === 0}
                        className="text-[10px] px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 font-bold uppercase cursor-pointer border-none disabled:opacity-40"
                      >
                        {allPicked ? 'Снять всех' : 'Выбрать всех'}
                      </button>
                    </div>
                  );
                })()}
              </div>

              <div className="flex-1 overflow-y-auto px-4 space-y-1.5 min-h-0">
                {audience === null ? (
                  <p className="text-white/40 text-xs text-center py-8">Загрузка аудитории…</p>
                ) : inviteCandidates.length === 0 ? (
                  <p className="text-white/40 text-xs text-center py-8">
                    Некого приглашать: нет одобрённых участников с Telegram (или все отфильтрованы поиском).
                  </p>
                ) : inviteCandidates.map((m: any) => {
                  const picked = inviteIds.includes(m.telegramId);
                  return (
                    <button
                      key={m.telegramId}
                      onClick={() => setInviteIds((s) => picked ? s.filter((id) => id !== m.telegramId) : [...s, m.telegramId])}
                      className={`w-full text-left rounded-xl p-3 cursor-pointer border transition-all flex items-center gap-3 ${
                        picked ? 'bg-brand/10 border-brand/30' : 'bg-white/5 border-white/10 hover:bg-white/10'
                      }`}
                    >
                      {picked ? <CheckSquare className="w-4 h-4 text-brand shrink-0" /> : <Square className="w-4 h-4 text-white/30 shrink-0" />}
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-bold truncate">{m.firstName || `id ${m.telegramId}`}</span>
                        <span className="block text-[10px] text-white/40 font-mono truncate">
                          {m.username ? '@' + m.username : `id ${m.telegramId}`}
                          {m.isCore ? ' · костяк' : ''}
                          {m.botActive === false ? ' · бот остановлен' : ''}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="p-4 border-t border-white/10 shrink-0">
                <button
                  onClick={sendInvites}
                  disabled={inviteSending || inviteIds.length === 0}
                  className="w-full bg-brand hover:bg-brand-hover text-black font-black py-3 rounded-xl uppercase text-xs tracking-wider cursor-pointer border-none disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  <Mail className="w-4 h-4" />
                  {inviteSending ? 'Отправляем…' : `Пригласить (${inviteIds.length})`}
                </button>
                <p className="text-[9px] text-white/30 font-mono mt-2 text-center">
                  Уйдёт личное сообщение в бот с кнопкой записи. Заблокированным и остановившим бота не шлётся.
                </p>
              </div>
            </motion.div>
          </div>
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

              <p className="text-xs text-white/60 mb-2">Выберите дату и шаблон — событие сразу попадёт в календарь</p>

              <div className="flex items-center gap-3 mb-4">
                <label className="text-[10px] text-white/40 uppercase font-mono shrink-0">Дата события</label>
                <input
                  type="date"
                  value={templateDate}
                  min={new Date().toISOString().split('T')[0]}
                  onChange={(e) => setTemplateDate(e.target.value)}
                  className="bg-white/5 border border-white/10 rounded-xl p-2.5 text-white text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3 max-h-[60vh] overflow-y-auto">
                {EVENT_TEMPLATES.map((template, idx) => (
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
                      {template.durationDays && template.durationDays > 1 && (
                        <span className="text-brand/70">• {template.durationDays} дн.</span>
                      )}
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
/**
 * Тумблеры функций события. Выключено — раздела нет в боте (готовка при
 * записи, машины/попутки, палатки); включил — процесс сразу доступен.
 * Без явного флага поведение определяется типом события (как раньше).
 */
function FeatureToggles({ value, type, onChange }: {
  value: Record<string, any>;
  type: string;
  onChange: (v: Record<string, any>) => void;
}) {
  // Формат события задаёт, какие блоки вообще имеют смысл: онлайну не нужны
  // машины, палатки и совместная готовка. Хранится в notifications._format
  // (jsonb, без миграции — тот же приём, что с feat_* и _heatCount).
  const format: string = value?._format || 'offline';
  const online = format === 'online';
  const defFood = !online && ['active', 'male', 'mixed'].includes(type);
  const defLogi = !online && type !== 'intellectual';
  const items = [
    { key: 'feat_food', label: '🍽 Готовка и меню', def: defFood },
    { key: 'feat_rides', label: '🚗 Машины и попутки', def: defLogi },
    { key: 'feat_tents', label: '⛺ Палатки', def: defLogi },
  ];
  const FORMATS = [
    { k: 'offline', l: '📍 Вживую' },
    { k: 'online', l: '💻 Онлайн' },
    { k: 'hybrid', l: '🔀 Гибрид' },
  ];
  return (
    <div>
      <label className="text-[11px] uppercase tracking-widest text-white/40 block mb-2">Формат</label>
      <div className="flex flex-wrap gap-2 mb-3">
        {FORMATS.map((f) => (
          <button
            key={f.k}
            type="button"
            onClick={() => {
              const next: Record<string, any> = { ...value, _format: f.k };
              if (f.k === 'online') {
                // Онлайн гасит логистику: держать её включённой у созвона —
                // источник мусорных вопросов участникам.
                next.feat_rides = false; next.feat_tents = false; next.feat_food = false;
              } else if (online) {
                // Возврат из онлайна СБРАСЫВАЕТ флаги к умолчаниям по типу.
                // Иначе выключенные «из-за онлайна» блоки молча оставались бы
                // выключенными у выездного события — организатор считает, что
                // логистика есть, а её нет.
                delete next.feat_rides; delete next.feat_tents; delete next.feat_food;
              }
              onChange(next);
            }}
            className={`px-3 py-2 rounded-xl border text-xs font-mono transition-colors cursor-pointer ${format === f.k ? 'border-[#E6FD3A]/60 text-[#E6FD3A] bg-[#E6FD3A]/10' : 'border-white/10 text-white/40 bg-transparent'}`}
          >
            {f.l}
          </button>
        ))}
      </div>
      <label className="text-[11px] uppercase tracking-widest text-white/40 block mb-2">Функции события</label>
      {online && (
        <p className="text-[10px] text-white/35 font-mono mb-2">
          Онлайн: логистика и готовка отключены — участникам никуда не ехать.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {items.map((it) => {
          const on = typeof value?.[it.key] === 'boolean' ? value[it.key] : it.def;
          return (
            <button
              key={it.key}
              type="button"
              onClick={() => onChange({ ...value, [it.key]: !on })}
              className={`px-3 py-2 rounded-xl border text-xs font-mono transition-colors cursor-pointer ${on ? 'border-[#E6FD3A]/60 text-[#E6FD3A] bg-[#E6FD3A]/10' : 'border-white/10 text-white/40 bg-transparent'}`}
            >
              {on ? '✓ ' : '– '}{it.label}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-white/30 mt-1.5">Выключено — раздела нет в боте. Включил — участники сразу могут пользоваться.</p>
    </div>
  );
}

function EditEventModal({ event, onClose, onSave }: {
  event: CommunityEvent;
  onClose: () => void;
  onSave: (event: CommunityEvent) => void;
}) {
  const [generatingCover, setGeneratingCover] = useState(false);
  // Правка программы промптом + пересчёт при смене даты (правки из PDF 16.07).
  const [progPrompt, setProgPrompt] = useState('');
  const [progBusy, setProgBusy] = useState(false);
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
    telegramImage: event.telegramImage || '',
    painPoint: event.painPoint || '',
    maxParticipants: event.maxParticipants,
    participantsCount: event.participantsCount,
    status: event.status || 'open',
    priceType: (event.priceType === 'paid' ? 'paid' : 'free') as 'free' | 'paid',
    priceLabel: event.priceLabel || 'Взнос отсутствует',
    priceAmount: event.priceAmount || 0,
    entryThreshold: event.entryThreshold || '',
    entryType: event.entryType || 'all',
    program: (event.program || []) as string[],
    logistics: (event.logistics || {}) as Record<string, any>,
    paymentDetails: (event.paymentDetails || {}) as Record<string, any>,
    houseQualities: (event.houseQualities || []) as HouseQuality[],
    notifications: ((event as any).notifications || {}) as Record<string, any>
  });


  // Гибкая цена: бесплатно / на совесть / платно (аренда делится поровну на всех).
  const computedPriceLabel = () => {
    if (formData.priceType === 'free') return 'Взнос отсутствует';
    if (formData.priceType === 'paid' && formData.priceAmount > 0) {
      const per = formData.maxParticipants
        ? ` • при ${formData.maxParticipants} ≈ ${Math.round(formData.priceAmount / formData.maxParticipants)} Br/чел`
        : '';
      return `Аренда ${formData.priceAmount} Br — делится поровну на всех${per}`;
    }
    return 'Взнос отсутствует';
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
      telegramImage: formData.telegramImage,
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
      houseQualities: formData.houseQualities,
      notifications: formData.notifications
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

          <LogisticsEditor value={formData.logistics} onChange={(v) => setFormData({ ...formData, logistics: v })} event={formData} />

          <ItineraryEditor
            value={formData.logistics?.itinerary || []}
            onChange={(itinerary) => setFormData({ ...formData, logistics: { ...(formData.logistics || {}), itinerary } })}
            event={formData}
          />

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

          <div className="mt-2">
            <label className="text-[10px] text-white/40 uppercase font-mono block mb-1">Вертикальная афиша для Telegram</label>
            <ImageUploadField value={formData.telegramImage || ''} onChange={(url) => setFormData({...formData, telegramImage: url})} />
            <p className="text-[9px] text-white/30 mt-1">Вертикальная картинка (афиша) для рассылок в Telegram. Если не задана — используется основная.</p>
          </div>

          {/* AI-генерация обложки с лоадером */}
          <button
            type="button"
            disabled={!formData.title.trim() || generatingCover}
            onClick={async () => {
              setGeneratingCover(true);
              try {
                const url = await aiGenerateImage(formData.title, formData.description);
                if (url) setFormData({...formData, image: url});
                else alert('ИИ не смог сгенерировать обложку. Попробуй позже или загрузи свою.');
              } catch (e) {
                console.error('AI generate_image error:', e);
                alert('Ошибка генерации: ' + (e as Error).message);
              } finally {
                setGeneratingCover(false);
              }
            }}
            className="w-full bg-brand/10 border border-brand/40 text-brand font-bold text-sm py-2 rounded-xl cursor-pointer hover:bg-brand/20 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {generatingCover ? (
              <>
                <span className="w-4 h-4 border-2 border-brand/30 border-t-brand rounded-full animate-spin" />
                Генерация…
              </>
            ) : (
              '🎨 Сгенерировать обложку'
            )}
          </button>

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
                <option value="free">Взнос отсутствует</option>
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
                Сумма аренды (Br) — делится поровну на всех
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

          {/* Дата/время изменились, а программа осталась — предлагаем пересчитать (ИИ перенесёт дни и время). */}
          {(formData.date !== event.date || formData.dateEnd !== (event.dateEnd || '') || formData.time !== (event.time || '')) && formData.program.length > 0 && (
            <div className="bg-yellow-400/10 border border-yellow-400/30 rounded-xl p-3 flex items-center justify-between gap-2">
              <p className="text-[11px] text-yellow-400">⚠️ Даты изменились — программа может ссылаться на старые дни/время.</p>
              <button
                type="button"
                disabled={progBusy}
                onClick={async () => {
                  setProgBusy(true);
                  const ai = await aiProgram({ ...formData, type: event.type }, `Событие перенесено: начало ${formData.date}${formData.time ? ` в ${formData.time}` : ''}${formData.dateEnd ? `, окончание ${formData.dateEnd}` : ''}. Пересчитай все дни недели, даты и время в пунктах.`, formData.program);
                  if (ai) setFormData({ ...formData, program: ai });
                  setProgBusy(false);
                }}
                className="text-[10px] font-bold text-black bg-yellow-400 rounded-lg px-3 py-1.5 cursor-pointer hover:bg-yellow-300 disabled:opacity-60 shrink-0"
              >{progBusy ? '⏳…' : '🤖 Пересчитать'}</button>
            </div>
          )}

          {/* Правка программы промптом: «стартуем в 19:00», «добавь игры у костра» и т.п. */}
          <div className="flex gap-2">
            <input
              value={progPrompt}
              onChange={(e) => setProgPrompt(e.target.value)}
              placeholder="✏️ Что поменять в программе? (промптом)"
              className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-white text-sm placeholder:text-white/30"
            />
            <button
              type="button"
              disabled={progBusy || !progPrompt.trim() || !formData.program.length}
              onClick={async () => {
                setProgBusy(true);
                const ai = await aiProgram({ ...formData, type: event.type }, progPrompt.trim(), formData.program);
                if (ai) { setFormData({ ...formData, program: ai }); setProgPrompt(''); }
                setProgBusy(false);
              }}
              className="text-[10px] font-bold text-brand bg-brand/10 border border-brand/30 rounded-lg px-3 cursor-pointer hover:bg-brand/20 disabled:opacity-50 shrink-0"
            >{progBusy ? '⏳' : 'Применить'}</button>
          </div>

          {/* ИИ раскидывает ответственных по пунктам из реальных участников (имя + роли из анкет) */}
          <button
            type="button"
            disabled={progBusy || !formData.program.length}
            onClick={async () => {
              setProgBusy(true);
              try {
                const res = await adminFetch(`/api/admin/registrations?eventId=${encodeURIComponent(event.id)}`);
                const j = await res.json();
                const regs: any[] = j.registrations || [];
                const roster = regs
                  .filter((r: any) => r.status !== 'cancelled')
                  .map((r: any) => {
                    const roles = Array.isArray(r.roles) ? r.roles.join(', ') : String(r.roles || '');
                    return `${r.name}${roles ? ` (${roles})` : ''}`;
                  })
                  .slice(0, 30).join('; ');
                if (!roster) { alert('Нет участников — некому назначать'); setProgBusy(false); return; }
                const ai = await aiProgram(
                  { ...formData, type: event.type },
                  `Добавь к каждому пункту программы ответственного в конце строки в формате «— отв. Имя». Участники (имя и чем готовы помочь): ${roster}. Распредели нагрузку равномерно, учитывай роли (готовка → кто указал готовку и т.п.). Текст пунктов не меняй.`,
                  formData.program
                );
                if (ai) setFormData({ ...formData, program: ai });
              } catch { alert('Не удалось получить участников'); }
              setProgBusy(false);
            }}
            className="w-full text-[10px] font-bold text-brand bg-brand/10 border border-brand/30 rounded-lg px-3 py-2 cursor-pointer hover:bg-brand/20 disabled:opacity-50"
          >{progBusy ? '⏳…' : '🙌 Назначить ответственных по пунктам (ИИ, по ролям участников)'}</button>

          <ListEditor
            label="Порог входа (условия прохода)"
            placeholder="Условие"
            items={formData.entryThreshold ? formData.entryThreshold.split(/\s*[•·]\s*/).filter(Boolean) : []}
            onChange={(v) => setFormData({...formData, entryThreshold: v.join(' • ')})}
            onGenerate={() => setFormData({...formData, entryThreshold: generateThreshold({ ...formData, type: event.type }).join(' • ')})}
          />

          <FeatureToggles
            value={formData.notifications}
            type={event.type}
            onChange={(v) => setFormData({ ...formData, notifications: v })}
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

// Add Event Modal — бесшовный ИИ-флоу
function AddEventModal({ onClose, onAdd }: {
  onClose: () => void;
  onAdd: (event: CommunityEvent) => void;
}) {
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiProgress, setAiProgress] = useState<string | null>(null);
  const [aiStage, setAiStage] = useState<'prompt' | 'filled' | 'preview'>('prompt');
  const [questions, setQuestions] = useState<string[]>([]);
  const [geoLoading, setGeoLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    date: '',
    dateEnd: '',
    dateLabel: '',
    time: '',
    timeEnd: '',
    location: '',
    locationDetails: '',
    coordinates: { lat: 0, lng: 0 } as { lat: number; lng: number },
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
    houseQualities: [] as HouseQuality[],
    distanceFromMinsk: 0 as number | undefined,
    travelTime: 0 as number | undefined,
    notifications: {} as Record<string, any>,
  });

  const isMinsk = formData.location && /^минск|мнск/i.test(formData.location.replace(/[^а-яА-Яa-zA-Z]/g, ''));

  /** Геокодирование локации + расчёт расстояния и времени в пути. */
  const geocodeLocation = async (location: string) => {
    if (!location || location.trim().length < 3) return;
    setGeoLoading(true);
    try {
      const { geocode, calcDistance } = await import('../geo');
      const coords = await geocode(location);
      if (coords) {
        const dist = calcDistance(coords.lat, coords.lng);
        setFormData((f) => ({
          ...f,
          coordinates: coords,
          distanceFromMinsk: dist,
          travelTime: dist,
        }));
      }
    } catch (e) {
      console.warn('Геокодирование не удалось:', e);
    } finally {
      setGeoLoading(false);
    }
  };

  /** Авто-маппинг полей из черновика ИИ + геокодирование */
  const autoFillFromDraft = async (d: any) => {
    const updates: any = {
      title: d.title || formData.title,
      description: d.description || formData.description,
      type: d.type || formData.type,
      date: d.date || formData.date,
      dateEnd: d.dateEnd || formData.dateEnd,
      painPoint: d.painPoint || formData.painPoint,
      time: d.time ? normalizeTime(d.time) : formData.time,
      timeEnd: d.timeEnd ? normalizeTime(d.timeEnd) : formData.timeEnd,
      location: d.location || formData.location,
      priceType: d.priceType === 'paid' ? 'paid' : 'free',
      priceAmount: d.priceType === 'paid' ? (Number(d.priceAmount) || 0) : 0,
      maxParticipants: d.maxParticipants || formData.maxParticipants,
      program: (d.program && d.program.length) ? d.program : formData.program,
      entryThreshold: d.entryThreshold || formData.entryThreshold,
      houseQualities: (d.houseQualities && d.houseQualities.length) ? qualitiesFromKeys(d.houseQualities) : formData.houseQualities,
      image: d.image || formData.image,
    };
    /**
     * Адаптивная структура: ИИ по сути идеи решает формат (офлайн/онлайн/гибрид)
     * и какие блоки нужны. Онлайн-встрече не нужны машины, палатки и готовка —
     * раньше это выключалось руками, а чаще не выключалось вовсе, и участники
     * получали логистику по зуму. Организатор может переключить любой тумблер
     * после генерации — решение ИИ это подсказка, а не запрет.
     */
    if (d.format || d.features) {
      updates.notifications = {
        ...(formData.notifications || {}),
        ...(d.features || {}),
        ...(d.format ? { _format: d.format } : {}),
      };
    }
    setFormData((f) => ({ ...f, ...updates }));

    // У онлайна нет физической локации — геокодить «Zoom» бессмысленно.
    if (d.format !== 'online' && d.location && d.location !== formData.location) {
      await geocodeLocation(d.location);
    }
  };

  const handleGenerate = async () => {
    if (!aiPrompt.trim()) return;
    setAiProgress('🤖 ИИ анализирует идею…');
    setAiStage('prompt');
    try {
      const { draft: d, error } = await aiGenerateFullEvent(aiPrompt.trim(), setAiProgress);
      if (d) {
        await autoFillFromDraft(d);
        setQuestions(d._questions || []);
        setAiProgress('');
        setAiStage('filled');
      } else {
        alert(`ИИ не ответил:\n${error || 'неизвестная ошибка'}`);
        setAiProgress('');
      }
    } catch (e) {
      alert(`Ошибка: ${(e as Error).message}`);
      setAiProgress('');
    }
  };

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
      locationDetails: formData.locationDetails,
      coordinates: formData.coordinates.lat ? formData.coordinates : undefined,
      painPoint: formData.painPoint,
      houseQualities: formData.houseQualities,
      image: formData.image || '',
      maxParticipants: formData.maxParticipants,
      participantsCount: 0,
      telegramBotUrl: 'https://t.me/campsflint_bot',
      priceType: formData.priceType,
      priceLabel: formData.priceType === 'paid' && formData.priceAmount > 0
        ? `Аренда ${formData.priceAmount} Br — делится поровну на всех`
        : 'Взнос отсутствует',
      priceAmount: formData.priceType === 'free' ? 0 : formData.priceAmount,
      entryThreshold: formData.entryThreshold,
      entryType: formData.entryType,
      status: 'locked',
      program: formData.program,
      logistics: formData.logistics,
      paymentDetails: formData.paymentDetails,
      distanceFromMinsk: formData.distanceFromMinsk,
      travelTime: formData.travelTime,
      notifications: { reminder7d: true, reminder3d: true, reminder1d: true, reminder3h: true, reminder1h: true, ...formData.notifications }
    };
    onAdd(newEvent);
  };

  const inp = 'w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white placeholder:text-white/30';

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" id="add-event-modal">
      <div className="absolute inset-0 bg-black/95" onClick={onClose} />

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-[#121212] rounded-3xl w-full max-w-md shadow-2xl relative z-10 border border-white/10 p-6 space-y-4 max-h-[90vh] overflow-y-auto"
      >
        <h3 className="font-bold text-lg uppercase">Новое мероприятие</h3>

        {/* ШАГ 1: Промпт ИИ (всегда виден) */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-3 space-y-2">
          <label className="text-[10px] text-white/40 uppercase font-mono block">🧠 ИИ-Ассистент</label>
          <textarea
            placeholder="Опиши идею одной фразой…&#10;Пример: Кайтсерфинг на Минском море, 16-17 июля, старт 12:00, 15 чел, платно 500 BYN"
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            rows={3}
            disabled={!!aiProgress}
            className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-white text-sm placeholder:text-white/30 disabled:opacity-50"
          />
          {aiProgress && (
            <div className="bg-black/30 rounded-lg p-2 flex items-center gap-2 text-[11px] text-white/80">
              <span className="w-3 h-3 border-2 border-brand/30 border-t-brand rounded-full animate-spin shrink-0" />
              <span>{aiProgress}</span>
            </div>
          )}
          <button
            type="button"
            disabled={!aiPrompt.trim() || !!aiProgress}
            onClick={handleGenerate}
            className="w-full bg-brand hover:bg-brand-hover text-black font-bold text-sm py-3 rounded-xl cursor-pointer transition-colors disabled:opacity-50 border-none"
          >
            {aiProgress ? 'Генерация…' : '🚀 Сгенерировать и заполнить'}
          </button>
        </div>

        {/* ШАГ 2: Превью + редактор */}
        {aiStage !== 'prompt' && (
          <div className="space-y-3">
            {/* Превью мини-карточки */}
            <div
              className="bg-white/5 border border-white/10 rounded-xl p-4 cursor-pointer hover:border-brand/30 transition-all"
              onClick={() => setEditing(!editing)}
            >
              <div className="flex items-center gap-3 mb-3">
                {formData.image ? (
                  <img src={formData.image} alt="" className="w-16 h-16 rounded-xl object-cover border border-white/10" />
                ) : (
                  <div className="w-16 h-16 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-2xl">📅</div>
                )}
                <div className="min-w-0 flex-1">
                  <h4 className="font-bold text-sm uppercase">{formData.title || 'Без названия'}</h4>
                  <p className="text-[10px] text-white/50 font-mono">
                    {formData.date ? buildDateLabel(formData.date, formData.dateEnd, formData.time) : 'Дата не указана'}
                  </p>
                  {formData.location && (
                    <p className="text-[10px] text-white/50 font-mono flex items-center gap-1">
                      📍 {formData.location}
                      {/* Условие обязано быть булевым: при distanceFromMinsk === 0
                          JSX печатал сам ноль, и в превью выходило «Zoom0». */}
                      {!isMinsk && (formData.distanceFromMinsk ?? 0) > 5 && (
                        <span className="text-brand"> · {formData.distanceFromMinsk} км</span>
                      )}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-1 mb-2">
                <span className={`text-[9px] px-2 py-0.5 rounded font-mono ${formData.priceType === 'paid' ? 'bg-brand/15 text-brand' : 'bg-white/10 text-white/50'}`}>
                  {formData.priceType === 'paid' ? `💰 ${formData.priceAmount} Br` : '🆓 Бесплатно'}
                </span>
                <span className="text-[9px] bg-white/10 text-white/50 px-2 py-0.5 rounded font-mono">
                  {formData.type === 'male' ? '♂ Мужское' : formData.type === 'mixed' ? '👥 Смешанное' : formData.type === 'intellectual' ? '🧠 Интеллект' : '🏕 Активный'}
                </span>
                <span className="text-[9px] bg-white/10 text-white/50 px-2 py-0.5 rounded font-mono">👥 до {formData.maxParticipants}</span>
              </div>
              <p className="text-[10px] text-white/60 leading-relaxed line-clamp-2">{formData.description}</p>
              {!editing && <p className="text-[9px] text-white/40 mt-1">👆 Нажми, чтобы отредактировать</p>}
            </div>

            {/* Уточняющие вопросы */}
            {questions.length > 0 && (
              <div className="bg-brand/5 border border-brand/20 rounded-xl p-3 space-y-2">
                <label className="text-[10px] text-brand uppercase font-mono block">💡 Рекомендации</label>
                <div className="space-y-1.5">
                  {questions.map((q, i) => (
                    <label key={i} className="flex items-start gap-2 text-[11px] text-white/80 cursor-pointer hover:text-white/90 transition-colors">
                      <input type="checkbox" className="mt-0.5 accent-brand" />
                      <span>{q}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Расширенный редактор (режим "Редактирование") */}
            {editing && (
              <div className="space-y-3 border-t border-white/10 pt-3">
                <input type="text" placeholder="Название *" value={formData.title} onChange={(e) => setFormData({...formData, title: e.target.value})} className={inp} />
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="text-[9px] text-white/40 uppercase font-mono block mb-1">Дата начала *</label><input type="date" value={formData.date} onChange={(e) => setFormData({...formData, date: e.target.value})} className={inp} /></div>
                  <div><label className="text-[9px] text-white/40 uppercase font-mono block mb-1">Дата окончания</label><input type="date" value={formData.dateEnd} min={formData.date} onChange={(e) => setFormData({...formData, dateEnd: e.target.value})} className={inp} /></div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input type="text" placeholder="Время начала (19:00)" value={formData.time} onChange={(e) => setFormData({...formData, time: e.target.value})} className={inp} />
                  <input type="text" placeholder="Время окончания (23:00)" value={formData.timeEnd} onChange={(e) => setFormData({...formData, timeEnd: e.target.value})} className={inp} />
                </div>

                {/* Цена: conditional — если free, поле скрыто */}
                <div className="grid grid-cols-2 gap-2">
                  <select value={formData.priceType} onChange={(e) => setFormData({...formData, priceType: e.target.value as 'free' | 'paid'})} className={inp}>
                    <option value="free">🆓 Бесплатно</option>
                    <option value="paid">💰 Платно</option>
                  </select>
                  {formData.priceType === 'paid' && (
                    <input type="number" placeholder="Сумма аренды (Br)" value={formData.priceAmount || ''} onChange={(e) => setFormData({...formData, priceAmount: parseInt(e.target.value) || 0})} className={inp} />
                  )}
                </div>
                {formData.priceType === 'free' && <p className="text-[9px] text-white/40 font-mono -mt-1">Событие бесплатное для участников.</p>}

                <input type="text" placeholder="Локация" value={formData.location} onChange={(e) => setFormData({...formData, location: e.target.value})} className={inp} />

                {/* Удаленность — только если НЕ Минск */}
                {!isMinsk && formData.distanceFromMinsk !== undefined && formData.distanceFromMinsk > 5 && (
                  <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                    <label className="text-[10px] text-white/40 uppercase font-mono block mb-1">🚗 Логистика</label>
                    <div className="flex gap-2 items-center">
                      <input type="number" placeholder="км от Минска" value={formData.distanceFromMinsk || ''} onChange={(e) => setFormData({...formData, distanceFromMinsk: parseInt(e.target.value) || 0})} className="flex-1 bg-white/5 border border-white/10 rounded-lg p-2 text-white text-sm placeholder:text-white/30" />
                      <span className="text-[10px] text-white/40 shrink-0">{formData.travelTime ? `~${formData.travelTime} мин` : ''}</span>
                      <button type="button" onClick={() => window.open(`https://yandex.ru/maps/?text=${encodeURIComponent(formData.location || 'Минск')}`, '_blank')} className="text-[10px] text-brand border border-brand/20 rounded-lg px-2 py-1.5 cursor-pointer bg-transparent hover:border-brand/40 shrink-0">🗺</button>
                    </div>
                  </div>
                )}

                {formData.priceType === 'paid' && <PaymentDetailsEditor value={formData.paymentDetails} onChange={(v) => setFormData({...formData, paymentDetails: v})} />}
                <LogisticsEditor value={formData.logistics} onChange={(v) => setFormData({ ...formData, logistics: v })} event={formData} />
                <ItineraryEditor
                  value={formData.logistics?.itinerary || []}
                  onChange={(itinerary) => setFormData({ ...formData, logistics: { ...(formData.logistics || {}), itinerary } })}
                  event={formData}
                />
                <ImageUploadField value={formData.image} onChange={(url) => setFormData({...formData, image: url})} />
                <textarea placeholder="Описание" value={formData.description} onChange={(e) => setFormData({...formData, description: e.target.value})} className={inp} rows={3} />

                <div className="grid grid-cols-2 gap-2">
                  <input type="number" placeholder="Макс. участников" value={formData.maxParticipants} onChange={(e) => setFormData({...formData, maxParticipants: parseInt(e.target.value)})} className={inp} />
                  <select value={formData.type} onChange={(e) => setFormData({...formData, type: e.target.value as any})} className={inp}>
                    <option value="male">♂ Мужское</option>
                    <option value="mixed">👥 Смешанное</option>
                    <option value="intellectual">🧠 Интеллект</option>
                    <option value="active">🏕 Активный</option>
                  </select>
                </div>

                <QualityChips selected={formData.houseQualities} onChange={(q) => setFormData({...formData, houseQualities: q})} />
                <ListEditor label="Программа" placeholder="Шаг" items={formData.program} aiHint onChange={(v) => setFormData({...formData, program: v})} onGenerate={async () => { const ai = await aiProgram(formData); setFormData({...formData, program: ai || generateProgram(formData)}); }} />

                <ListEditor label="Порог входа" placeholder="Условие" items={formData.entryThreshold ? formData.entryThreshold.split(/\s*[•·]\s*/).filter(Boolean) : []} onChange={(v) => setFormData({...formData, entryThreshold: v.join(' • ')})} onGenerate={() => setFormData({...formData, entryThreshold: generateThreshold(formData).join(' • ')})} />
                <FeatureToggles value={formData.notifications} type={formData.type} onChange={(v) => setFormData({ ...formData, notifications: v })} />
              </div>
            )}
          </div>
        )}

        {/* КНОПКИ */}
        <div className="flex gap-2 pt-2">
          <button onClick={handleAdd} disabled={!formData.title || !formData.date} className="flex-1 bg-brand hover:bg-brand-hover text-black py-3 rounded-xl text-xs font-bold uppercase disabled:opacity-50 cursor-pointer border-none">
            ✅ Создать
          </button>
          <button onClick={onClose} className="flex-1 border border-white/10 py-3 rounded-xl text-xs font-bold uppercase text-white/60 cursor-pointer bg-transparent hover:bg-white/5">
            Отмена
          </button>
        </div>
      </motion.div>
    </div>
  );
}
