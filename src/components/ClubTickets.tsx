import React, { useEffect, useState } from 'react';

/**
 * ПРИГЛАСИТЕЛЬНЫЕ КЛУБА в админке события.
 * Пул билетов (заводит scripts/club-tickets-setup.ts) → кому выдан каждый →
 * дошёл ли в личку → забрал ли сам (нажал «прислать») → прошёл ли на входе.
 * Выдача впечатывает имя/@ник/код в низ билета и шлёт PDF от бота.
 */
type Ticket = {
  no: number; code: string; number?: string; series?: string;
  assignedTo?: number; assignedName?: string; assignedUsername?: string; assignedAt?: string;
  sentAt?: string; sendError?: string; resentCount?: number; openedAt?: string; usedAt?: string;
};
type Candidate = { telegramId: number; name: string; username: string };

/** Ссылка «забрать пригласительный»: бот пришлёт билет после «Старт». */
const TICKET_LINK = 'https://t.me/campsflint_bot?start=ticket';
/** Человек не нажимал «Старт» — бот не может написать первым. */
const noChat = (e?: string) => /initiate conversation|PEER_ID_INVALID|chat not found|blocked/i.test(String(e || ''));
const copyLink = async (onMsg: (m: { ok: boolean; text: string }) => void) => {
  try { await navigator.clipboard.writeText(TICKET_LINK); onMsg({ ok: true, text: `Ссылка скопирована: ${TICKET_LINK} — отправь человеку, он нажмёт «Старт» и билет придёт сам` }); }
  catch { onMsg({ ok: true, text: `Отправь человеку ссылку: ${TICKET_LINK}` }); }
};

const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

export default function ClubTickets({ eventId, onMsg, adminFetch }: {
  eventId: string;
  onMsg: (m: { ok: boolean; text: string }) => void;
  adminFetch: (input: string, init?: RequestInit) => Promise<Response>;
}) {
  const [pool, setPool] = useState<{ total: number; tickets: Ticket[] } | null | undefined>(undefined);
  const [cands, setCands] = useState<Candidate[]>([]);
  const [busy, setBusy] = useState('');
  const [picking, setPicking] = useState(false);

  const load = () => adminFetch(`/api/admin/registrations?action=tickets&eventId=${encodeURIComponent(eventId)}`)
    .then((r) => r.json()).then((j) => { setPool(j.pool || null); setCands(j.candidates || []); })
    .catch(() => setPool(null));
  useEffect(() => { setPool(undefined); load(); }, [eventId]);

  const act = async (action: string, payload: Record<string, unknown>, label: string) => {
    if (busy) return;
    setBusy(label);
    try {
      const r = await adminFetch(`/api/admin/registrations?action=${action}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, ...payload }),
      });
      const j = await r.json();
      if (action === 'ticket_issue_all' && j.ok) {
        onMsg({ ok: true, text: `Выдано ${j.issued}, дошло в личку ${j.delivered}${j.failed?.length ? ` · не дошло: ${j.failed.join('; ')}` : ''}${j.waiting ? ` · ${j.waiting} записавшимся не хватило` : ''}` });
      } else if (action === 'ticket_issue' && j.ok) {
        onMsg({ ok: j.delivered, text: j.delivered ? 'Пригласительный выдан и отправлен в личку 🎟'
          : noChat(j.error) ? `Билет выписан, но человек ещё не открывал бота — Telegram не даёт боту написать первым. Билет придёт сам, как только он нажмёт «Старт». Отправь ему ссылку: ${TICKET_LINK}`
          : `Выдан, но в личку не дошёл: ${j.error}` });
      } else {
        onMsg({ ok: !!j.ok, text: j.ok ? 'Готово' : (j.error || 'Не удалось') });
      }
      await load();
    } catch { onMsg({ ok: false, text: 'Нет связи с сервером' }); }
    finally { setBusy(''); }
  };

  if (pool === undefined) return <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-xs text-white/40">🎟 Пригласительные: загрузка…</div>;
  if (pool === null) return null; // у события нет пула — блока нет

  const issued = pool.tickets.filter((t) => t.assignedTo);
  const free = pool.total - issued.length;
  const n = (f: (t: Ticket) => boolean) => pool.tickets.filter(f).length;

  return (
    <div className="space-y-3 rounded-xl border border-brand/30 bg-brand/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] font-mono uppercase tracking-widest text-brand/80">🎟 Пригласительные клуба</span>
        <button type="button" onClick={load} className="cursor-pointer border-none bg-transparent text-[10px] text-white/40 hover:text-white">↻ обновить</button>
      </div>
      <div className="grid grid-cols-4 gap-2 text-center">
        {([['Выдано', issued.length], ['Дошло', n((t) => !!t.sentAt)], ['Забрали', n((t) => !!t.openedAt)], ['Прошли', n((t) => !!t.usedAt)]] as const).map(([l, v]) => (
          <div key={l} className="rounded-lg bg-black/25 py-2">
            <div className="text-lg font-black text-white">{v}<span className="text-[11px] text-white/35">/{pool.total}</span></div>
            <div className="text-[9px] uppercase text-white/45">{l}</div>
          </div>
        ))}
      </div>

      {free > 0 && (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!!busy} onClick={() => act('ticket_issue_all', {}, 'all')}
            className="flex-1 rounded-lg border-none bg-brand px-3 py-2 text-[11px] font-black uppercase text-black cursor-pointer disabled:opacity-40">
            {busy === 'all' ? 'Раздаю…' : `🎟 Раздать записавшимся (${Math.min(free, cands.length)})`}
          </button>
          <button type="button" disabled={!!busy || cands.length === 0} onClick={() => setPicking((p) => !p)}
            className="rounded-lg border-none bg-white/10 px-3 py-2 text-[11px] font-bold uppercase text-white/80 cursor-pointer disabled:opacity-40">
            ✍️ Выдать одному
          </button>
        </div>
      )}
      {free > 0 && cands.length === 0 && (
        <p className="text-[11px] text-white/45">Все записавшиеся уже с билетами. Новые записи появятся здесь — раздавай по мере записи.</p>
      )}
      {picking && (
        <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg bg-black/25 p-2">
          {cands.map((c) => (
            <button key={c.telegramId} type="button" disabled={!!busy}
              onClick={() => { setPicking(false); act('ticket_issue', { telegramId: c.telegramId }, `p${c.telegramId}`); }}
              className="flex w-full items-center justify-between rounded-md border-none bg-transparent px-2 py-1.5 text-left text-[12px] text-white hover:bg-white/10 cursor-pointer">
              <span>{c.name}{c.username && <span className="ml-1.5 text-[10px] text-white/40">@{c.username}</span>}</span>
              <span className="text-[10px] text-brand">выдать →</span>
            </button>
          ))}
        </div>
      )}
      <p className="text-[10px] leading-snug text-white/40">
        Организатор получает билет первым, дальше — записавшиеся по порядку записи. Билет приходит в личку от бота;
        потерял — жмёт «Прислать ещё раз» в боте, в карточке события или пишет /ticket.
      </p>

      <div className="space-y-1.5">
        {pool.tickets.map((t) => (
          <div key={t.no} className={`rounded-lg px-2.5 py-2 ${t.assignedTo ? 'bg-black/25' : 'bg-black/10 border border-dashed border-white/10'}`}>
            <div className="flex items-center gap-2">
              <span className="w-9 shrink-0 font-display text-sm font-black text-brand">№{t.no}</span>
              <div className="min-w-0 flex-1">
                {t.assignedTo ? (
                  <>
                    <div className="truncate text-[13px] font-bold text-white">{t.assignedName}{t.assignedUsername && <span className="ml-1.5 font-mono text-[10px] font-normal text-white/40">@{t.assignedUsername}</span>}</div>
                    <div className="text-[10px] text-white/45">
                      {t.usedAt ? `✅ прошёл ${fmt(t.usedAt)}`
                        : t.openedAt ? `📥 забрал ${fmt(t.openedAt)}`
                        : t.sentAt ? `📨 в личке с ${fmt(t.sentAt)}`
                        : noChat(t.sendError) ? '⏳ ждёт «Старт» в боте — придёт сам'
                        : `⚠️ не дошёл${t.sendError ? `: ${t.sendError.slice(0, 40)}` : ''}`}
                      {` · код ${t.code}`}{t.series ? ` · серия ${t.series}` : ''}
                    </div>
                  </>
                ) : (
                  <div className="text-[12px] text-white/40">свободен · код {t.code}</div>
                )}
              </div>
            </div>
            {t.assignedTo && (
              <div className="mt-1.5 flex flex-wrap gap-1.5 pl-11">
                <button type="button" disabled={!!busy} onClick={() => act('ticket_used', { no: t.no, used: !t.usedAt }, `u${t.no}`)}
                  className={`rounded-md border-none px-2 py-1 text-[10px] font-bold cursor-pointer disabled:opacity-40 ${t.usedAt ? 'bg-white/10 text-white/60' : 'bg-brand/20 text-brand'}`}>
                  {t.usedAt ? '↩︎ не прошёл' : '✅ прошёл на входе'}
                </button>
                {!t.sentAt && (
                  <button type="button" onClick={() => copyLink(onMsg)}
                    className="rounded-md border-none bg-amber-500/20 px-2 py-1 text-[10px] font-bold text-amber-200 cursor-pointer">🔗 ссылка для него</button>
                )}
                <button type="button" disabled={!!busy} onClick={() => act('ticket_resend', { no: t.no }, `r${t.no}`)}
                  className="rounded-md border-none bg-white/10 px-2 py-1 text-[10px] font-bold text-white/70 cursor-pointer disabled:opacity-40">📨 прислать снова</button>
                <button type="button" disabled={!!busy}
                  onClick={() => { if (window.confirm(`Отозвать билет № ${t.no} у ${t.assignedName}? Файл у него останется, но место освободится для другого. Штрих-код проходит один раз — новый держатель должен пройти первым.`)) act('ticket_revoke', { no: t.no }, `x${t.no}`); }}
                  className="rounded-md border-none bg-rose-500/10 px-2 py-1 text-[10px] font-bold text-rose-300 cursor-pointer disabled:opacity-40">отозвать</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
