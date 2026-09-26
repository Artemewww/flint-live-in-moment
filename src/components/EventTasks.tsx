import React, { useEffect, useState } from 'react';
import { Check, Clock, Loader2, Plus, Trash2, X } from 'lucide-react';
import { getInitData, haptic } from '../telegram';
import Avatar from './Avatar';

type Person = { id: number; name: string; avatar?: string };
type Task = { id: number; title: string; done: boolean; dueAt: string | null; assignee: Person | null; mine: boolean; canManage: boolean };

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
 * Организатор (и любой участник) ставит задачу человеку из состава с
 * дедлайном; назначенному приходит сообщение в бот, в чат события — «📌».
 * Все участники видят общий список: что сделано, что горит, что просрочено.
 */
export default function EventTasks({ eventId }: { eventId: string }) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState<number | null>(null);
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState<number | 'add' | null>(null);
  const [err, setErr] = useState('');
  const apply = (j: any) => { if (j?.ok) { setTasks(j.tasks || []); setPeople(j.people || []); } else setErr(j?.error || 'Не получилось'); };
  useEffect(() => { call('event_tasks', { eventId }).then(apply).catch(() => setErr('Нет связи')); }, [eventId]);

  const add = async () => {
    if (!title.trim()) return setErr('Что нужно сделать?');
    setBusy('add'); setErr('');
    const j = await call('event_task_add', { eventId, title, assignee, dueAt: due ? new Date(due).toISOString() : null }).catch(() => null);
    setBusy(null);
    if (j?.ok) { haptic('success'); setTitle(''); setAssignee(null); setDue(''); setAdding(false); }
    apply(j);
  };
  const upd = async (taskId: number, op: string) => {
    if (op === 'delete' && !window.confirm('Удалить задачу?')) return;
    setBusy(taskId); setErr('');
    const j = await call('event_task_update', { eventId, taskId, op }).catch(() => null);
    setBusy(null);
    if (j?.ok) haptic('success');
    apply(j);
  };

  if (tasks === null && !err) return null;
  const open = (tasks || []).filter((t) => !t.done);
  const done = (tasks || []).filter((t) => t.done);
  return (
    <div id="sect-tasks" className="scroll-mt-4 space-y-2.5 rounded-2xl border border-white/10 bg-white/[.03] p-4">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono uppercase tracking-widest text-white/45">📋 Задачи события{open.length ? ` · ${open.length}` : ''}</span>
        {!adding && <button type="button" onClick={() => setAdding(true)} className="flex items-center gap-1 rounded-full border-0 bg-brand px-3 py-1.5 text-[11px] font-black uppercase text-black"><Plus className="h-3.5 w-3.5" /> Задача</button>}
      </div>

      {adding && (
        <div className="space-y-2 rounded-xl border border-brand/30 bg-brand/[.05] p-3">
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Что сделать? (купить уголь, забрать сап)" className="w-full rounded-xl border border-white/10 bg-black/30 p-2.5 text-sm text-white" />
          <div>
            <span className="mb-1 block text-[11px] text-white/50">Кому</span>
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
              <button type="button" onClick={() => setAssignee(null)} className={`flex shrink-0 flex-col items-center gap-1 rounded-xl border-0 bg-transparent p-1 ${assignee === null ? 'opacity-100' : 'opacity-50'}`}>
                <span className={`flex h-10 w-10 items-center justify-center rounded-full text-lg ${assignee === null ? 'bg-brand text-black' : 'bg-white/10 text-white'}`}>?</span>
                <span className="text-[10px] text-white/70">Кто возьмёт</span>
              </button>
              {people.map((p) => (
                <button key={p.id} type="button" onClick={() => setAssignee(p.id)} className={`flex w-14 shrink-0 flex-col items-center gap-1 rounded-xl border-0 bg-transparent p-1 ${assignee === p.id ? 'opacity-100' : 'opacity-55'}`}>
                  <span className={`rounded-full ${assignee === p.id ? 'ring-2 ring-brand ring-offset-2 ring-offset-[#151515]' : ''}`}><Avatar name={p.name} src={p.avatar} size={40} /></span>
                  <span className="w-full truncate text-center text-[10px] text-white/70">{p.name}</span>
                </button>
              ))}
            </div>
          </div>
          <label className="block space-y-1">
            <span className="text-[11px] text-white/50">Срок (необязательно)</span>
            <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} className="w-full min-w-0 rounded-xl border border-white/10 bg-black/30 p-2.5 text-sm text-white" />
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={() => { setAdding(false); setErr(''); }} className="rounded-xl border border-white/15 bg-transparent px-4 text-white/60"><X className="h-4 w-4" /></button>
            <button type="button" onClick={add} disabled={busy === 'add'} className="flex flex-1 items-center justify-center rounded-xl border-0 bg-brand py-2.5 text-xs font-black uppercase text-black disabled:opacity-60">
              {busy === 'add' ? <Loader2 className="h-4 w-4 animate-spin" /> : assignee ? 'Назначить' : 'Добавить'}
            </button>
          </div>
        </div>
      )}

      {err && <p className="text-[11px] text-rose-300">{err}</p>}
      {tasks && !tasks.length && !adding && <p className="text-[12px] text-white/40">Пока задач нет. Поставь первую — человек получит её в бот.</p>}

      {[...open, ...done].map((t) => {
        const dl = dueLabel(t.dueAt, t.done);
        return (
          <div key={t.id} className={`flex items-start gap-3 rounded-xl border p-2.5 ${t.done ? 'border-white/5 bg-transparent opacity-60' : t.mine ? 'border-brand/30 bg-brand/[.05]' : 'border-white/10 bg-black/20'}`}>
            {t.assignee ? <Avatar name={t.assignee.name} src={t.assignee.avatar} size={34} /> : <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full border border-dashed border-white/25 text-white/40">?</span>}
            <div className="min-w-0 flex-1">
              <p className={`text-[13px] leading-snug text-white ${t.done ? 'line-through' : ''}`}>{t.title}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] text-white/45">
                <span>{t.assignee ? (t.mine ? 'на тебе' : t.assignee.name) : 'свободна'}</span>
                {dl && <span className={`flex items-center gap-1 ${dl.cls}`}><Clock className="h-3 w-3" />{dl.text}</span>}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {!t.done && !t.assignee && <button type="button" disabled={busy === t.id} onClick={() => upd(t.id, 'take')} className="rounded-lg border-0 bg-brand px-2.5 py-1 text-[10px] font-black uppercase text-black">Беру</button>}
                {!t.done && (t.mine || t.canManage) && t.assignee && <button type="button" disabled={busy === t.id} onClick={() => upd(t.id, 'done')} className="flex items-center gap-1 rounded-lg border-0 bg-emerald-500/20 px-2.5 py-1 text-[10px] font-black uppercase text-emerald-300"><Check className="h-3 w-3" /> Готово</button>}
                {!t.done && t.mine && <button type="button" disabled={busy === t.id} onClick={() => upd(t.id, 'drop')} className="rounded-lg border-0 bg-white/10 px-2.5 py-1 text-[10px] font-bold uppercase text-white/60">Не смогу</button>}
                {t.done && t.canManage && <button type="button" disabled={busy === t.id} onClick={() => upd(t.id, 'undo')} className="rounded-lg border-0 bg-white/10 px-2.5 py-1 text-[10px] font-bold uppercase text-white/60">Вернуть</button>}
                {t.canManage && <button type="button" disabled={busy === t.id} onClick={() => upd(t.id, 'delete')} className="rounded-lg border-0 bg-transparent px-1.5 py-1 text-rose-300/70"><Trash2 className="h-3.5 w-3.5" /></button>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
