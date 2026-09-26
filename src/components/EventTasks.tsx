import React, { useEffect, useState } from 'react';
import { BellRing, Check, Clock, HandHelping, Loader2, Plus, Trash2, X } from 'lucide-react';
import { getInitData, haptic } from '../telegram';
import Avatar from './Avatar';

type Person = { id: number; name: string; avatar?: string };
type Helper = Person & { note?: string };
type Task = {
  id: number; title: string; done: boolean; dueAt: string | null; assignee: Person | null; mine: boolean; canManage: boolean;
  kind?: string | null; target?: Person | null; helpers?: Helper[];
};

async function call(action: string, extra: Record<string, any>) {
  const r = await fetch('/api/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, initData: getInitData(), ...extra }) });
  return r.json();
}

function dueLabel(iso: string | null, done: boolean): { text: string; cls: string } | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const text = d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  if (done) return { text, cls: 'text-white/35' };
  const h = (d.getTime() - Date.now()) / 3600000;
  if (h < 0) return { text: `просрочено · ${text}`, cls: 'text-rose-300' };
  if (h < 24) return { text: `до ${text}`, cls: 'text-amber-300' };
  return { text: `до ${text}`, cls: 'text-white/50' };
}

/**
 * Задачи события — прямо в карточке: кто что делает и к какому сроку.
 * Два вида: обычная задача (одному, нескольким или «кто возьмёт») и
 * «Подтвердить участие» — выбираешь людей, жмёшь «Пингануть», им в бот
 * приходит «Подтверждаю / Не еду», и задача закрывается сама.
 * Список видят все участники; к любой задаче можно вызваться «🙋 Помогу».
 */
export default function EventTasks({ eventId }: { eventId: string }) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [me, setMe] = useState(0);
  const [adding, setAdding] = useState(false);
  const [mode, setMode] = useState<'task' | 'confirm'>('task');
  const [title, setTitle] = useState('');
  const [picked, setPicked] = useState<number[]>([]);
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState<number | 'add' | null>(null);
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  const apply = (j: any) => { if (j?.ok) { setTasks(j.tasks || []); setPeople(j.people || []); if (j.me) setMe(Number(j.me)); } else setErr(j?.error || 'Не получилось'); };
  useEffect(() => { call('event_tasks', { eventId }).then(apply).catch(() => setErr('Нет связи')); }, [eventId]);

  const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const reset = () => { setTitle(''); setPicked([]); setDue(''); setAdding(false); setMode('task'); };

  const add = async () => {
    if (mode === 'task' && !title.trim()) return setErr('Что нужно сделать?');
    if (mode === 'confirm' && !picked.length) return setErr('Выбери, чьё участие подтвердить');
    setBusy('add'); setErr(''); setInfo('');
    const j = await call('event_task_add', {
      eventId, title, assignees: picked, kind: mode === 'confirm' ? 'confirm' : undefined,
      dueAt: due ? new Date(due).toISOString() : null,
    }).catch(() => null);
    setBusy(null);
    if (j?.ok) { haptic('success'); reset(); if (mode === 'confirm') setInfo('Готово. Теперь жми «📲 Пингануть» — человеку придёт кнопка «Подтверждаю».'); }
    apply(j);
  };
  const upd = async (taskId: number, op: string, extra: Record<string, any> = {}) => {
    if (op === 'delete' && !window.confirm('Удалить задачу?')) return;
    setBusy(taskId); setErr(''); setInfo('');
    const j = await call('event_task_update', { eventId, taskId, op, ...extra }).catch(() => null);
    setBusy(null);
    if (j?.ok) { haptic('success'); if (op === 'ping') setInfo('Отправил. Как ответит — задача закроется сама, тебе придёт сообщение.'); }
    apply(j);
  };
  const help = (t: Task) => {
    const already = (t.helpers || []).some((h) => h.id === me);
    if (already) return upd(t.id, 'help');
    const note = window.prompt('Чем поможешь? (например: «докуплю воду», «подвезу на машине»)', '');
    if (note === null) return;
    upd(t.id, 'help', { note });
  };

  if (tasks === null && !err) return null;
  const open = (tasks || []).filter((t) => !t.done);
  const done = (tasks || []).filter((t) => t.done);
  const btn = 'rounded-lg border-0 px-2.5 py-1 text-[10px] font-black uppercase';
  return (
    <div id="sect-tasks" className="scroll-mt-4 space-y-2.5 rounded-2xl border border-white/10 bg-white/[.03] p-4">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono uppercase tracking-widest text-white/45">📋 Задачи события{open.length ? ` · ${open.length}` : ''}</span>
        {!adding && <button type="button" onClick={() => setAdding(true)} className="flex items-center gap-1 rounded-full border-0 bg-brand px-3 py-1.5 text-[11px] font-black uppercase text-black"><Plus className="h-3.5 w-3.5" /> Задача</button>}
      </div>

      {adding && (
        <div className="space-y-2.5 rounded-xl border border-brand/30 bg-brand/[.05] p-3">
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-black/30 p-1">
            {([['task', '📌 Задача'], ['confirm', '✅ Подтвердить участие']] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => { setMode(k); setPicked([]); }}
                className={`rounded-lg border-0 py-2 text-[11px] font-bold ${mode === k ? 'bg-brand text-black' : 'bg-transparent text-white/60'}`}>{l}</button>
            ))}
          </div>
          {mode === 'task'
            ? <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Что сделать? (купить еду, забрать сап)" className="w-full rounded-xl border border-white/10 bg-black/30 p-2.5 text-sm text-white" />
            : <p className="text-[11px] leading-snug text-white/55">Отметь людей, чьё участие надо подтвердить. Потом «📲 Пингануть» — им придёт кнопка «Подтверждаю / Не еду», задача закроется сама.</p>}
          <div>
            <span className="mb-1 flex items-center justify-between text-[11px] text-white/50">
              <span>{mode === 'confirm' ? 'Кого подтвердить' : 'Кому (можно несколько)'}{picked.length ? ` · ${picked.length}` : ''}</span>
              {people.length > 1 && <button type="button" onClick={() => setPicked(picked.length === people.length ? [] : people.map((p) => p.id))} className="border-0 bg-transparent p-0 text-[11px] text-brand">{picked.length === people.length ? 'Снять всех' : 'Выбрать всех'}</button>}
            </span>
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
              {mode === 'task' && (
                <button type="button" onClick={() => setPicked([])} className={`flex shrink-0 flex-col items-center gap-1 rounded-xl border-0 bg-transparent p-1 ${!picked.length ? 'opacity-100' : 'opacity-50'}`}>
                  <span className={`flex h-10 w-10 items-center justify-center rounded-full text-lg ${!picked.length ? 'bg-brand text-black' : 'bg-white/10 text-white'}`}>?</span>
                  <span className="text-[10px] text-white/70">Кто возьмёт</span>
                </button>
              )}
              {people.map((p) => {
                const on = picked.includes(p.id);
                return (
                  <button key={p.id} type="button" onClick={() => toggle(p.id)} className={`relative flex w-14 shrink-0 flex-col items-center gap-1 rounded-xl border-0 bg-transparent p-1 ${on ? 'opacity-100' : 'opacity-55'}`}>
                    <span className={`rounded-full ${on ? 'ring-2 ring-brand ring-offset-2 ring-offset-[#151515]' : ''}`}><Avatar name={p.name} src={p.avatar} size={40} /></span>
                    {on && <span className="absolute right-1 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-brand text-black"><Check className="h-3 w-3" /></span>}
                    <span className="w-full truncate text-center text-[10px] text-white/70">{p.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <label className="block space-y-1">
            <span className="text-[11px] text-white/50">Срок (необязательно)</span>
            <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} className="w-full min-w-0 rounded-xl border border-white/10 bg-black/30 p-2.5 text-sm text-white" />
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={() => { reset(); setErr(''); }} className="rounded-xl border border-white/15 bg-transparent px-4 text-white/60"><X className="h-4 w-4" /></button>
            <button type="button" onClick={add} disabled={busy === 'add'} className="flex flex-1 items-center justify-center rounded-xl border-0 bg-brand py-2.5 text-xs font-black uppercase text-black disabled:opacity-60">
              {busy === 'add' ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === 'confirm' ? `Создать${picked.length > 1 ? ` (${picked.length})` : ''}` : picked.length ? `Назначить${picked.length > 1 ? ` (${picked.length})` : ''}` : 'Добавить'}
            </button>
          </div>
        </div>
      )}

      {err && <p className="text-[11px] text-rose-300">{err}</p>}
      {info && <p className="text-[11px] text-emerald-300">{info}</p>}
      {tasks && !tasks.length && !adding && <p className="text-[12px] text-white/40">Пока задач нет. Поставь первую — человек получит её в бот.</p>}

      {[...open, ...done].map((t) => {
        const dl = dueLabel(t.dueAt, t.done);
        const confirm = t.kind === 'confirm';
        const face = confirm ? t.target : t.assignee;
        const helpers = t.helpers || [];
        const iHelp = helpers.some((h) => h.id === me);
        return (
          <div key={t.id} className={`flex items-start gap-3 rounded-xl border p-2.5 ${t.done ? 'border-white/5 bg-transparent opacity-60' : t.mine ? 'border-brand/30 bg-brand/[.05]' : 'border-white/10 bg-black/20'}`}>
            {face ? <Avatar name={face.name} src={face.avatar} size={34} /> : <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full border border-dashed border-white/25 text-white/40">?</span>}
            <div className="min-w-0 flex-1">
              <p className={`text-[13px] leading-snug text-white ${t.done ? 'line-through' : ''}`}>{confirm && !t.done ? '⏳ ' : ''}{t.title}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] text-white/45">
                <span>{confirm ? (t.done ? 'ответ получен' : `ждём ответа · ведёт ${t.mine ? 'ты' : t.assignee?.name || '—'}`) : t.assignee ? (t.mine ? 'на тебе' : t.assignee.name) : 'свободна'}</span>
                {dl && <span className={`flex items-center gap-1 ${dl.cls}`}><Clock className="h-3 w-3" />{dl.text}</span>}
              </p>
              {helpers.length > 0 && (
                <div className="mt-1.5 space-y-1">
                  {helpers.map((h) => (
                    <div key={h.id} className="flex items-center gap-1.5 text-[11px] text-white/60">
                      <Avatar name={h.name} src={h.avatar} size={18} />
                      <span className="min-w-0 truncate">🙋 <b className="text-white/80">{h.name}</b>{h.note ? ` — ${h.note}` : ' поможет'}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {!t.done && confirm && (t.mine || t.canManage) && <button type="button" disabled={busy === t.id} onClick={() => upd(t.id, 'ping')} className={`${btn} flex items-center gap-1 bg-brand text-black`}><BellRing className="h-3 w-3" /> Пингануть</button>}
                {!t.done && !confirm && !t.assignee && <button type="button" disabled={busy === t.id} onClick={() => upd(t.id, 'take')} className={`${btn} bg-brand text-black`}>Беру</button>}
                {!t.done && (t.mine || t.canManage) && t.assignee && <button type="button" disabled={busy === t.id} onClick={() => upd(t.id, 'done')} className={`${btn} flex items-center gap-1 bg-emerald-500/20 text-emerald-300`}><Check className="h-3 w-3" /> {confirm ? 'Подтвердил' : 'Готово'}</button>}
                {!t.done && !confirm && !t.mine && <button type="button" disabled={busy === t.id} onClick={() => help(t)} className={`${btn} flex items-center gap-1 ${iHelp ? 'bg-sky-500/25 text-sky-200' : 'bg-white/10 text-white/70'}`}><HandHelping className="h-3 w-3" /> {iHelp ? 'Помогаю ✓' : 'Помогу'}</button>}
                {!t.done && !confirm && t.mine && <button type="button" disabled={busy === t.id} onClick={() => upd(t.id, 'drop')} className={`${btn} bg-white/10 font-bold text-white/60`}>Не смогу</button>}
                {t.done && t.canManage && <button type="button" disabled={busy === t.id} onClick={() => upd(t.id, 'undo')} className={`${btn} bg-white/10 font-bold text-white/60`}>Вернуть</button>}
                {t.canManage && <button type="button" disabled={busy === t.id} onClick={() => upd(t.id, 'delete')} className="rounded-lg border-0 bg-transparent px-1.5 py-1 text-rose-300/70"><Trash2 className="h-3.5 w-3.5" /></button>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
