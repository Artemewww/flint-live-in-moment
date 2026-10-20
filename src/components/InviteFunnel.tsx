import React, { useEffect, useState } from 'react';

/**
 * ВОРОНКА ПРИГЛАШЕНИЙ события: кому отправили → кому дошло → кто открыл →
 * кто что ответил → кто записался. Плюс список людей и дожим «подумаю» /
 * молчащих одной кнопкой (автоматически то же делает ежедневный крон).
 *
 * «Прочитал» Telegram ботам не сообщает, поэтому «открыл» = нажал любую
 * кнопку под приглашением. Это честный сигнал, а не догадка.
 */
type Person = {
  telegramId: number; name: string; username: string; delivered: boolean; error: string;
  openedAt?: string; answer: 'yes' | 'maybe' | 'no' | null; answeredAt?: string;
  remindedAt?: string; remindCount: number; registered: boolean; sentAt: string;
};
type Stats = {
  ok: boolean; needsMigration?: boolean; error?: string;
  summary?: { sent: number; delivered: number; opened: number; yes: number; maybe: number; no: number; silent: number; registered: number };
  people?: Person[];
};

const ANSWER: Record<string, { label: string; cls: string }> = {
  yes: { label: '✅ Буду', cls: 'bg-brand/15 text-brand' },
  maybe: { label: '🤔 Подумаю', cls: 'bg-amber-500/15 text-amber-300' },
  no: { label: '❌ Не сможет', cls: 'bg-rose-500/15 text-rose-300' },
};

const ago = (iso?: string) => {
  if (!iso) return '';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 60) return `${Math.max(1, m)} мин назад`;
  if (m < 1440) return `${Math.round(m / 60)} ч назад`;
  return `${Math.round(m / 1440)} дн назад`;
};

export default function InviteFunnel({ eventId, onMsg, adminFetch }: {
  eventId: string;
  onMsg: (m: { ok: boolean; text: string }) => void;
  /** Запрос с токеном админки (живёт в AdminPanel). */
  adminFetch: (input: string, init?: RequestInit) => Promise<Response>;
}) {
  const [st, setSt] = useState<Stats | null>(null);
  const [filter, setFilter] = useState<'all' | 'yes' | 'maybe' | 'no' | 'opened' | 'silent' | 'failed'>('all');
  const [busy, setBusy] = useState(false);

  const load = () => {
    adminFetch(`/api/admin/broadcast?action=invite_stats&eventId=${encodeURIComponent(eventId)}`)
      .then((r) => r.json()).then(setSt).catch(() => setSt({ ok: false, error: 'Нет связи' }));
  };
  useEffect(() => { setSt(null); load(); }, [eventId]);

  const remind = async (target: 'maybe' | 'silent' | 'opened' | 'both') => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await adminFetch('/api/admin/broadcast', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, action: 'invite_remind', target }),
      });
      const j = await r.json();
      onMsg({ ok: !!j.ok, text: j.ok ? `Напоминание ушло: ${j.sent} из ${j.total}` : (j.error || 'Не удалось') });
      load();
    } catch { onMsg({ ok: false, text: 'Нет связи с сервером' }); }
    finally { setBusy(false); }
  };

  if (!st) return <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-xs text-white/40">📨 Приглашения: загрузка…</div>;
  if (!st.ok) {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-[11px] text-amber-200">
        📨 Статистика приглашений {st.needsMigration
          ? <>ещё не включена: примени в Supabase → SQL Editor файл <code>supabase/migrations/2026-10-event-invites.sql</code>.</>
          : <>недоступна: {st.error}</>}
      </div>
    );
  }
  const s = st.summary!;
  const people = (st.people || []).filter((p) =>
    filter === 'all' ? true
      : filter === 'silent' ? p.delivered && !p.answer
      : filter === 'opened' ? !!p.openedAt && !p.answer
      : filter === 'failed' ? !p.delivered
      : p.answer === filter);
  const pct = (n: number) => (s.sent ? Math.round((n / s.sent) * 100) : 0);
  // Посмотрели приглашение, но не нажали ни «Буду», ни «Нет» — самые тёплые для дожима.
  const openedSilent = (st.people || []).filter((p) => !!p.openedAt && !p.answer).length;
  const steps: [string, number][] = [['Отправлено', s.sent], ['Дошло', s.delivered], ['Открыли', s.opened], ['Ответили', s.yes + s.maybe + s.no], ['Записались', s.registered]];

  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-mono uppercase tracking-widest text-white/40">📨 Приглашения — воронка</span>
        <button type="button" onClick={load} className="cursor-pointer border-none bg-transparent text-[10px] text-white/40 hover:text-white">↻ обновить</button>
      </div>
      {s.sent === 0 ? (
        <p className="text-[11px] text-white/40">Персональных приглашений по этому событию ещё не было. Отправь их кнопкой «Пригласить».</p>
      ) : (
        <>
          <div className="space-y-1.5">
            {steps.map(([label, n]) => (
              <div key={label} className="flex items-center gap-2 text-[11px]">
                <span className="w-20 shrink-0 text-white/50">{label}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
                  <div className="h-2 rounded-full bg-brand" style={{ width: `${pct(n)}%` }} />
                </div>
                <span className="w-14 shrink-0 text-right font-mono text-white/80">{n} · {pct(n)}%</span>
              </div>
            ))}
          </div>
          <div className="flex flex-nowrap gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {([['all', `Все ${s.sent}`], ['yes', `✅ Буду ${s.yes}`], ['maybe', `🤔 Подумают ${s.maybe}`], ['no', `❌ Нет ${s.no}`], ['opened', `👀 Открыли, без ответа ${openedSilent}`], ['silent', `🤐 Молчат ${s.silent}`], ['failed', `⚠️ Не дошло ${s.sent - s.delivered}`]] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setFilter(k)}
                className={`shrink-0 whitespace-nowrap rounded-lg border-none px-2.5 py-1 text-[10px] font-bold uppercase cursor-pointer ${filter === k ? 'bg-brand text-black' : 'bg-white/5 text-white/50 hover:bg-white/10'}`}>{l}</button>
            ))}
          </div>
          {(s.maybe > 0 || s.silent > 0 || openedSilent > 0) && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-black/20 p-2.5">
              <span className="flex-1 text-[11px] text-white/60">Бот сам напомнит через 2 дня. Можно дожать сейчас:</span>
              {s.maybe > 0 && <button type="button" disabled={busy} onClick={() => remind('maybe')} className="rounded-lg border-none bg-amber-500/20 px-2.5 py-1.5 text-[10px] font-bold uppercase text-amber-200 cursor-pointer disabled:opacity-40">🤔 Подумавшим ({s.maybe})</button>}
              {openedSilent > 0 && <button type="button" disabled={busy} onClick={() => remind('opened')} className="rounded-lg border-none bg-sky-500/20 px-2.5 py-1.5 text-[10px] font-bold uppercase text-sky-200 cursor-pointer disabled:opacity-40">👀 Открывшим ({openedSilent})</button>}
              {s.silent > 0 && <button type="button" disabled={busy} onClick={() => remind('silent')} className="rounded-lg border-none bg-white/10 px-2.5 py-1.5 text-[10px] font-bold uppercase text-white/80 cursor-pointer disabled:opacity-40">🤐 Молчащим ({s.silent})</button>}
            </div>
          )}
          <div className="max-h-80 space-y-1.5 overflow-y-auto">
            {people.map((p) => (
              <div key={p.telegramId} className="flex items-center gap-2 rounded-lg bg-black/20 px-2.5 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-bold">{p.name}{p.username && <span className="ml-1.5 font-mono text-[10px] font-normal text-white/40">@{p.username}</span>}</div>
                  <div className="text-[10px] text-white/40">
                    {!p.delivered ? `⚠️ не дошло${p.error ? `: ${p.error.slice(0, 50)}` : ''}`
                      : p.answer ? `ответил ${ago(p.answeredAt)}`
                      : p.openedAt ? `открыл ${ago(p.openedAt)}, не ответил`
                      : `дошло ${ago(p.sentAt)}, не открывал`}
                    {p.remindCount > 0 && ` · напоминаний: ${p.remindCount}`}
                  </div>
                </div>
                {p.registered && <span className="shrink-0 rounded bg-brand/20 px-1.5 py-0.5 font-mono text-[9px] text-brand">записан</span>}
                {p.answer && <span className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] ${ANSWER[p.answer].cls}`}>{ANSWER[p.answer].label}</span>}
              </div>
            ))}
            {people.length === 0 && <p className="py-3 text-center text-[11px] text-white/40">Никого в этом фильтре.</p>}
          </div>
        </>
      )}
    </div>
  );
}
