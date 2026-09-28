import React, { useEffect, useState } from 'react';
import { Award, Check, Loader2, X } from 'lucide-react';
import { getInitData, haptic } from '../telegram';
import Avatar from './Avatar';

/**
 * ПОСТУПКИ СОБЫТИЯ — «кто что сделал».
 *
 * После выезда все хорошие дела остаются только в переписке: Аня снимала видео,
 * Людмила привезла еду, Артём разрулил затор из двух мерседесов. Бот вытаскивает
 * такие эпизоды из чата, а здесь организатор их подтверждает.
 *
 * ГЛАВНОЕ: пока организатор не подтвердил, эпизод НЕ влияет ни на репутацию, ни
 * на баллы. Модель ошибается и льстит, а цена ошибки — репутация живого человека.
 * Поэтому в карточке всегда видно ЦИТАТУ из переписки: решение принимают по
 * факту, а не по формулировке ИИ.
 *
 * Кто видит что:
 *   организатор и костяк — всё (в т.ч. ожидающие подтверждения);
 *   участник — только свои подтверждённые поступки.
 */

type Item = {
  id: number;
  subject_id: number;
  subjectName: string;
  kind: string;
  title: string;
  quote?: string | null;
  confidence: number;
  status: 'pending' | 'confirmed' | 'rejected';
  points_awarded: number;
  chat_id?: number | null;
  message_id?: number | null;
  created_at?: string;
};

const KIND_EMOJI: Record<string, string> = {
  role_done: '🎯', helped: '🤝', calm_conflict: '🕊', staff_done: '🎖',
  growth: '📈', driver: '🚗', brought: '🌱', paid_on_time: '💚',
};

/** Ссылка на сообщение в приватной группе: t.me/c/<id без -100>/<message>. */
const msgLink = (it: Item): string => {
  const cid = String(it.chat_id || '');
  if (!it.message_id || !cid.startsWith('-100')) return '';
  return `https://t.me/c/${cid.slice(4)}/${it.message_id}`;
};

export default function EventContributions({ eventId, canReview = false }: { eventId: string; canReview?: boolean }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);

  const load = () =>
    fetch(`/api/events?action=contributions&id=${encodeURIComponent(eventId)}`, {
      headers: { 'x-telegram-init-data': getInitData() },
    })
      .then((r) => r.json())
      .then((j) => { if (Array.isArray(j.items)) setItems(j.items); else setErr(j.error || 'Не получилось'); })
      .catch(() => setErr('Нет связи'));

  useEffect(() => { load(); }, [eventId]);

  const review = async (id: number, decision: 'confirm' | 'reject') => {
    setBusy(id); setNote('');
    try {
      const r = await fetch('/api/events?action=contribution_review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contributionId: id, decision, initData: getInitData() }),
      });
      const j = await r.json();
      if (j?.ok) {
        haptic('success');
        setNote(decision === 'confirm' ? `Записал 🎖 +${j.points || 0} баллов` : 'Отклонил');
        await load();
      } else {
        haptic('error');
        setNote(j?.error === 'organizer_only' ? 'Решает организатор события' : (j?.error || 'Не получилось'));
      }
    } catch { setNote('Нет связи'); } finally { setBusy(null); }
  };

  const pending = (items || []).filter((x) => x.status === 'pending');
  const done = (items || []).filter((x) => x.status === 'confirmed');
  // Участнику показываем только его подтверждённые поступки и не грузим пустотой.
  if (!canReview && !done.length) return null;
  if (!items) return (
    <div className="flex items-center gap-2 text-white/40 text-[10px] font-mono uppercase tracking-widest">
      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Поступки…
    </div>
  );
  if (!pending.length && !done.length) return null;
  if (!canReview && !open) {
    return (
      <button onClick={() => setOpen(true)} className="flex w-full items-center justify-center gap-2 rounded-xl border border-brand/30 bg-brand/10 py-2.5 text-xs font-black uppercase text-brand">
        <Award className="h-4 w-4" /> Мои поступки: {done.length}
      </button>
    );
  }
  return (
    <div className="space-y-3">
      {canReview && pending.length > 0 && (
        <div className="space-y-2 rounded-2xl border border-brand/30 bg-brand/[.06] p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-sm font-bold"><Award className="h-4 w-4 text-brand" /> Кто что сделал</p>
            <span className="rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-black text-black">{pending.length} ждёт</span>
          </div>
          <p className="text-[11px] leading-5 text-white/55">
            Нашёл бот в переписке чата. Подтверди, что так и было — поступок попадёт в репутацию человека и принесёт баллы. Отклони, если модель поняла неверно.
          </p>
        </div>
      )}
      {note && <p className="text-xs text-brand">{note}</p>}
      {err && <p className="text-xs text-rose-300">{err}</p>}

      {(canReview ? [...pending, ...done] : done).map((it) => {
        const link = msgLink(it);
        return (
          <div key={it.id} className={`space-y-2 rounded-2xl border p-3 ${
            it.status === 'confirmed' ? 'border-brand/25 bg-brand/[.04]'
            : 'border-white/15 bg-white/[.03]'}`}>
            <div className="flex items-center gap-3">
              <Avatar name={it.subjectName} size={36} />
              <div className="min-w-0 flex-1">
                <b className="block truncate text-sm">{it.subjectName}</b>
                <span className="text-[11px] text-white/55">{KIND_EMOJI[it.kind] || '🎖'} {it.title}</span>
              </div>
              {it.status === 'confirmed' && (
                <span className="shrink-0 rounded-full bg-brand/15 px-2 py-1 font-mono text-[10px] uppercase text-brand">+{it.points_awarded}</span>
              )}
            </div>
            {it.quote && (
              <p className="border-l-2 border-white/15 pl-2 text-[11px] italic leading-5 text-white/50">
                «{it.quote}»{link && <> · <a href={link} target="_blank" rel="noopener noreferrer" className="not-italic text-brand underline">открыть</a></>}
              </p>
            )}
            {canReview && it.status === 'pending' && (
              <div className="flex gap-2">
                <button disabled={busy === it.id} onClick={() => review(it.id, 'confirm')}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border-0 bg-brand py-2 text-[11px] font-black uppercase text-black disabled:opacity-50">
                  {busy === it.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Так и было
                </button>
                <button disabled={busy === it.id} onClick={() => review(it.id, 'reject')}
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-transparent px-3 py-2 text-[11px] font-bold uppercase text-white/60 disabled:opacity-50">
                  <X className="h-3.5 w-3.5" /> Не было
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

