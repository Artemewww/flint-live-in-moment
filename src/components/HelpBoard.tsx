import React, { useEffect, useState } from 'react';
import { HandHeart, Plus, Flag, Loader2 } from 'lucide-react';
import { getInitData, haptic } from '../telegram';

/**
 * Взаимопомощь клуба: «сломался фотоаппарат», «кто посидит с собакой».
 * Только для принятых участников. Без денег и продаж. «Могу помочь» — автор
 * получает контакт в бот; «Помогли» — благодарность (+15 баллов помощнику).
 * Новые просьбы клуб видит в вечернем дайджесте, а не мгновенными рассылками.
 */
type Req = {
  id: string; category: string; categoryLabel: string; text: string; authorName: string; authorHelped: number;
  mine: boolean; status: string; createdAt: number; offers?: { id: number; name: string; username?: string }[];
  offered: boolean; offersCount: number;
};

async function call(action: string, extra: Record<string, unknown> = {}) {
  const r = await fetch('/api/profile', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, initData: getInitData(), ...extra }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

const ago = (t: number) => {
  const h = Math.round((Date.now() - t) / 36e5);
  return h < 1 ? 'только что' : h < 24 ? `${h} ч назад` : `${Math.round(h / 24)} дн назад`;
};

export default function HelpBoard() {
  const [list, setList] = useState<Req[] | null>(null);
  const [cats, setCats] = useState<Record<string, string>>({});
  const [myHelped, setMyHelped] = useState(0);
  const [err, setErr] = useState('');
  const [form, setForm] = useState(false);
  const [cat, setCat] = useState('thing');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState('');

  const load = async () => {
    try {
      const j = await call('help_list');
      setList(j.requests); setCats(j.cats); setMyHelped(j.myHelped || 0); setErr('');
    } catch (e) { setErr((e as Error).message); setList([]); }
  };
  useEffect(() => { load(); }, []);

  const act = async (key: string, fn: () => Promise<unknown>, okHaptic = true) => {
    setBusy(key); setErr('');
    try { await fn(); if (okHaptic) haptic('success'); await load(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(''); }
  };

  if (list === null) return null;
  const open = list.filter((r) => !r.mine);
  const mine = list.filter((r) => r.mine && r.status !== 'closed');

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-black text-lg text-white flex items-center gap-2"><HandHeart className="w-5 h-5 text-brand" /> Взаимопомощь</h3>
          <p className="text-[12px] text-white/50">Попроси клуб или помоги своему. {myHelped > 0 && <span className="text-brand">Ты помог(ла) {myHelped} раз 🙌</span>}</p>
        </div>
        {!form && (
          <button type="button" onClick={() => setForm(true)}
            className="shrink-0 inline-flex items-center gap-1 rounded-xl bg-brand text-black text-xs font-bold px-3 py-2">
            <Plus className="w-4 h-4" /> Попросить
          </button>
        )}
      </div>

      {err && <p className="text-[12px] text-rose-300">{err}</p>}

      {form && (
        <div className="rounded-xl bg-black/40 border border-white/10 p-3 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(cats).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setCat(k)}
                className={`text-[11px] rounded-full px-2.5 py-1.5 border ${cat === k ? 'border-brand text-brand' : 'border-white/10 text-white/60'}`}>{label}</button>
            ))}
          </div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={500} rows={3}
            placeholder="Например: сломался фотоаппарат, нужен на субботу — верну в воскресенье"
            className="w-full bg-black/40 border border-white/10 rounded-lg p-2.5 text-sm text-white" />
          <p className="text-[11px] text-white/40">Без денег, продаж и ссылок. Просьба живёт 7 дней, клуб увидит её в вечернем дайджесте.</p>
          <div className="flex gap-2">
            <button type="button" disabled={busy === 'create' || text.trim().length < 10}
              onClick={() => act('create', async () => { await call('help_create', { category: cat, text }); setText(''); setForm(false); })}
              className="flex-1 rounded-lg bg-brand text-black text-sm font-bold py-2.5 disabled:opacity-40">
              {busy === 'create' ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Отправить клубу'}
            </button>
            <button type="button" onClick={() => setForm(false)} className="rounded-lg bg-white/5 text-white/60 text-sm px-3">Отмена</button>
          </div>
        </div>
      )}

      {mine.map((r) => (
        <div key={r.id} className="rounded-xl border border-brand/30 bg-brand/[0.05] p-3 space-y-2">
          <div className="text-[11px] text-brand">Моя просьба · {r.categoryLabel} · {r.status === 'expired' ? 'срок вышел' : r.status === 'hidden' ? 'скрыта, ждёт костяк' : ago(r.createdAt)}</div>
          <p className="text-sm text-white">{r.text}</p>
          {(r.offers || []).length > 0 ? (
            <div className="space-y-1.5">
              <p className="text-[11px] text-white/50">Откликнулись — кто помог?</p>
              {(r.offers || []).map((o) => (
                <button key={o.id} type="button" disabled={!!busy}
                  onClick={() => act(`close${r.id}`, () => call('help_close', { id: r.id, thankedId: o.id }))}
                  className="w-full flex items-center justify-between rounded-lg bg-black/40 px-3 py-2 text-sm text-white">
                  <span>{o.name}{o.username ? ` · @${o.username}` : ''}</span><span className="text-brand text-xs font-bold">Помог(ла) ✓</span>
                </button>
              ))}
            </div>
          ) : <p className="text-[11px] text-white/40">Пока никто не откликнулся — вечером просьбу увидит весь клуб.</p>}
          <button type="button" disabled={!!busy} onClick={() => act(`close${r.id}`, () => call('help_close', { id: r.id }))}
            className="text-[11px] text-white/50 underline">Уже не актуально — закрыть</button>
        </div>
      ))}

      {open.length === 0 && mine.length === 0 && !form && (
        <p className="text-[12px] text-white/40">Сейчас просьб нет. Если что-то нужно — клуб рядом.</p>
      )}

      {open.map((r) => (
        <div key={r.id} className="rounded-xl bg-black/30 border border-white/10 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2 text-[11px] text-white/50">
            <span>{r.categoryLabel} · <b className="text-white/80">{r.authorName}</b>{r.authorHelped > 0 ? ` · помог(ла) ${r.authorHelped} раз` : ''}</span>
            <span>{ago(r.createdAt)}</span>
          </div>
          <p className="text-sm text-white">{r.text}</p>
          <div className="flex items-center gap-2">
            <button type="button" disabled={r.offered || busy === `offer${r.id}`}
              onClick={() => act(`offer${r.id}`, () => call('help_offer', { id: r.id }))}
              className={`flex-1 rounded-lg text-sm font-bold py-2.5 ${r.offered ? 'bg-white/5 text-brand' : 'bg-brand text-black'}`}>
              {r.offered ? 'Ты откликнулся(ась) — автор напишет' : 'Могу помочь'}
            </button>
            <button type="button" title="Пожаловаться" disabled={!!busy}
              onClick={() => window.confirm('Пожаловаться на просьбу? После двух жалоб её проверит костяк.') && act(`rep${r.id}`, () => call('help_report', { id: r.id }), false)}
              className="rounded-lg bg-white/5 text-white/40 p-2.5"><Flag className="w-4 h-4" /></button>
          </div>
          {r.offersCount > 0 && !r.offered && <p className="text-[11px] text-white/40">Уже откликнулись: {r.offersCount}</p>}
        </div>
      ))}
    </section>
  );
}
