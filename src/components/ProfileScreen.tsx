import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  X, Bell, Trophy, Star, Flame, Zap, Target, Award, Users, Copy, Check, AlertTriangle,
  Calendar, MapPin, CreditCard, Truck, Package, UtensilsCrossed, Settings as SettingsIcon,
  Loader2, ShieldCheck, Clock, ArrowRightLeft, Save, Send, Reply, BookOpen,
} from 'lucide-react';
import { getInitData, isInsideTelegram, haptic } from '../telegram';
import EquipmentPanel from './EquipmentPanel';
import FoodSelectionPanel from './FoodSelectionPanel';
import CampingChecklist from './CampingChecklist';

/**
 * Личный кабинет участника. Акценты сверху вниз (пожелание владельца — «как на
 * мировом уровне»): сначала то, что ТРЕБУЕТ ДЕЙСТВИЯ (долг по взносу, незаданная
 * логистика), затем ближайшее событие, затем уведомления, и только потом статус,
 * награды и архив. Редкое (снаряжение, питание, настройки) — во вкладках.
 *
 * Данные — одним запросом ?action=profile_full (мобильная сеть: пять запросов
 * заметно медленнее). Настройки сохраняются через ?action=save_settings.
 */

type Tab = 'overview' | 'events' | 'gear' | 'kb' | 'settings';

const RU_MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso);
  return `${d.getDate()} ${RU_MON[d.getMonth()]}`;
}
function daysUntil(iso?: string | null): number | null {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00`).getTime();
  if (Number.isNaN(d)) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((d - today.getTime()) / 86400000);
}
function fmtWhen(at?: string | null): string {
  if (!at) return '';
  const t = new Date(at).getTime();
  if (Number.isNaN(t)) return '';
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return 'только что';
  if (mins < 60) return `${mins} мин назад`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} ч назад`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d} дн назад` : new Date(at).toLocaleDateString('ru-RU');
}

const DIET_RU: Record<string, string> = { omnivore: 'Всё ем', vegetarian: 'Вегетарианец', vegan: 'Веган' };

export default function ProfileScreen({ onClose, initialTab }: { onClose: () => void; initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab || 'overview');
  // Чек-лист по умолчанию свёрнут: длинный список мешал видеть складчину.
  const [showChecklist, setShowChecklist] = useState(false);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  // База знаний: грузим ТОЛЬКО по открытию вкладки и ТОЛЬКО с сервера.
  // Держать методики в бандле нельзя — фронт скачивает кто угодно, а раздел
  // закрытый: доступ проверяется по initData на сервере (api/profile ?action=kb).
  const [kbSections, setKbSections] = useState<Array<{ key: string; title: string; body: string }> | null>(null);
  const [kbError, setKbError] = useState('');

  /** Ответ организаторам прямо из ленты уведомлений. */
  const [msgText, setMsgText] = useState('');
  const [msgSending, setMsgSending] = useState(false);
  const [msgNote, setMsgNote] = useState('');
  const [showAllNotif, setShowAllNotif] = useState(false);
  const msgRef = useRef<HTMLTextAreaElement | null>(null);

  const load = async () => {
    const initData = getInitData();
    if (!initData) {
      setError('Профиль доступен внутри Telegram — открой афишу через @campsflint_bot.');
      setLoading(false);
      return;
    }
    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'profile_full', initData }),
      });
      const j = await res.json();
      if (j.ok) setData(j);
      else setError(j.error === 'not-in-telegram' ? 'Профиль доступен внутри Telegram.' : (j.error || 'Не удалось загрузить профиль'));
    } catch (e) {
      setError('Нет связи с сервером. Попробуй ещё раз.');
    }
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const p = data?.profile;
  const events: any[] = data?.events || [];
  const notifications: any[] = data?.notifications || [];
  const upcoming = useMemo(() => events.filter((e) => e.upcoming), [events]);
  const past = useMemo(() => events.filter((e) => !e.upcoming), [events]);
  const nearest = upcoming.length ? [...upcoming].sort((a, b) => String(a.date).localeCompare(String(b.date)))[0] : null;

  const level = (p?.attended || 0) > 0 ? Math.floor((p?.points || 0) / 500) + 1 : 1;
  const levelTitle = (p?.attended || 0) === 0 ? 'Не начато'
    : level <= 2 ? 'Новичок' : level <= 5 ? 'Участник' : level <= 10 ? 'Ветеран' : 'Мастер';

  /**
   * ПРИОРИТЕТ №1 — то, из-за чего человек и открывает профиль. Не «красивая
   * статистика», а список незакрытых дел: без этого он узнаёт о долге по взносу
   * от организатора вручную.
   */
  const todo = useMemo(() => {
    const out: { key: string; text: string; sub?: string; tone: 'warn' | 'info' }[] = [];
    for (const e of upcoming) {
      if (e.paymentStatus !== 'paid' && (e.priceAmount || e.paymentAmount)) {
        out.push({
          key: `pay-${e.eventId}`, tone: 'warn',
          text: `Взнос за «${e.title}» не внесён`,
          sub: e.priceLabel || (e.priceAmount ? `${e.priceAmount} Br` : undefined),
        });
      }
      if (!e.hasTransport && !e.transportDetails) {
        out.push({ key: `tr-${e.eventId}`, tone: 'info', text: `Не указано, как добираешься на «${e.title}»` });
      }
    }
    if (p && !p.phone) out.push({ key: 'phone', tone: 'info', text: 'Не указан телефон для связи', sub: 'Вкладка «Настройки»' });
    if (p && !p.gender) out.push({ key: 'gender', tone: 'info', text: 'Не указан пол', sub: 'Нужен для расселения по палаткам' });
    // День рождения — ОБЯЗАТЕЛЬНОЕ поле: без него тебя не будет на доске дней
    // рождения, а организаторы не смогут оценить возраст. Подсвечиваем ЖЁЛТЫМ +
    // колокольчик: это не блокирующее, но важное действие.
    if (p && !p.birthday) out.push({
      key: 'birthday', tone: 'warn',
      text: '🎂 Не указан день рождения',
      sub: 'Ты не попадёшь на доску именинников и в рассылку с поздравлением',
    });
    return out;
  }, [upcoming, p]);

  const achievements = [
    { id: 'first', name: 'Первый шаг', desc: 'Побывать на первом', icon: Star, unlocked: (p?.attended || 0) >= 1 },
    { id: 'three', name: 'Регулярный', desc: 'Побывать на 3', icon: Flame, unlocked: (p?.attended || 0) >= 3 },
    { id: 'five', name: 'Активный', desc: 'Побывать на 5', icon: Zap, unlocked: (p?.attended || 0) >= 5 },
    { id: 'ten', name: 'Ветеран', desc: 'Побывать на 10', icon: Trophy, unlocked: (p?.attended || 0) >= 10 },
    { id: 'inviter', name: 'Проводник', desc: 'Привести друга', icon: Target, unlocked: (p?.referralsCount || 0) >= 1 },
    { id: 'level5', name: 'Эксперт', desc: 'Достичь 5 уровня', icon: Award, unlocked: level >= 5 },
  ];

  /** Отправить организаторам. Пишется в тот же тред, что и переписка в боте. */
  const sendMessage = async () => {
    const text = msgText.trim();
    if (!text) return;
    setMsgSending(true); setMsgNote('');
    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send_message', initData: getInitData(), text }),
      });
      const j = await res.json();
      if (j.ok) {
        setMsgText('');
        // Не обещаем быстрый ответ, если уведомить организаторов не удалось —
        // сообщение сохранено, но никто о нём пока не знает.
        setMsgNote(j.notified > 0
          ? 'Отправлено — ответ придёт в бот и сюда'
          : 'Сохранено, но организаторов уведомить не удалось. Если срочно — напиши в чат клуба.');
        haptic('success');
        load(); // подтягиваем своё сообщение в ленту, чтобы было видно, что ушло
      } else { setMsgNote(j.error || 'Не удалось отправить'); haptic('error'); }
    } catch { setMsgNote('Нет связи с сервером'); haptic('error'); }
    setMsgSending(false);
  };

  /** «Ответить» на конкретное сообщение: цитата + фокус в поле. */
  const quoteReply = (n: any) => {
    const quote = String(n.text || '').split('\n').slice(0, 3).join(' ').slice(0, 120);
    setMsgText(`> ${quote}${String(n.text || '').length > 120 ? '…' : ''}\n\n`);
    haptic('success');
    // Фокус — сразу (узел не пересоздаётся), каретка — после коммита React,
    // иначе она встанет по старой длине значения.
    msgRef.current?.focus();
    msgRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    requestAnimationFrame(() => {
      const len = msgRef.current?.value.length ?? 0;
      msgRef.current?.setSelectionRange(len, len);
    });
  };

  const copyRef = async () => {
    if (!p?.refLink) return;
    try { await navigator.clipboard.writeText(p.refLink); setCopied(true); haptic('success'); setTimeout(() => setCopied(false), 1500); } catch { /* no-op */ }
  };

  // Кто ведёт события — тот и видит базу знаний. Участнику вкладка не
  // показывается вовсе, а сервер всё равно проверяет права ещё раз.
  const canLead = !!(p?.isCore || p?.role === 'organizer' || p?.role === 'owner');

  useEffect(() => {
    if (tab !== 'kb' || kbSections || kbError) return;
    const initData = getInitData();
    if (!initData) { setKbError('База знаний открывается только внутри Telegram.'); return; }
    fetch('/api/profile', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'kb', initData }),
    })
      .then((r) => r.json())
      .then((j) => (j.ok ? setKbSections(j.sections || []) : setKbError(j.error || 'Раздел закрыт')))
      .catch(() => setKbError('Не удалось загрузить базу знаний.'));
  }, [tab, kbSections, kbError]);

  const TABS: { key: Tab; label: string; icon: any }[] = [
    { key: 'overview', label: 'Обзор', icon: Trophy },
    { key: 'events', label: 'События', icon: Calendar },
    { key: 'gear', label: 'Снаряжение', icon: Package },
    ...(canLead ? [{ key: 'kb' as Tab, label: 'База знаний', icon: BookOpen }] : []),
    { key: 'settings', label: 'Настройки', icon: SettingsIcon },
  ];

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center md:p-4" id="profile-screen-root">
      {/* Без motion-анимации умышленно: с ней карточка застревала на opacity 0
          (inline-стиль оставался opacity:0) — перерисовка после загрузки данных
          обрывала tween, и профиль открывался полупрозрачным. */}
      <div onClick={onClose} className="absolute inset-0 bg-black/90 backdrop-blur-md" />
      <div
        className="bg-[#121212] md:rounded-3xl w-full max-w-2xl shadow-2xl relative z-10 md:border md:border-white/10 flex flex-col h-[100dvh] md:h-auto md:max-h-[92vh] text-white"
      >
        {/* ── Шапка: кто я + уровень. Видно всегда, не уезжает при скролле. ── */}
        <div className="shrink-0 border-b border-white/10 bg-[#161616] p-4 sm:p-6 pt-5">
          <div className="flex items-start gap-3">
            <div className="shrink-0 w-12 h-12 rounded-2xl bg-brand/15 border border-brand/30 flex items-center justify-center font-display font-black text-xl text-brand">
              {(p?.firstName || '?').trim().charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="font-display font-black text-lg sm:text-2xl uppercase tracking-tight leading-none truncate">
                {p?.firstName || 'Профиль'}
              </h2>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {p?.username && <span className="text-[11px] font-mono text-white/50">@{p.username}</span>}
                {p && (
                  <span className={`text-[9px] font-mono uppercase tracking-widest px-2 py-0.5 rounded-full border ${
                    p.isCore ? 'border-brand/40 text-brand bg-brand/10'
                      : p.status === 'approved' ? 'border-emerald-500/30 text-emerald-300 bg-emerald-500/10'
                      : 'border-white/15 text-white/50 bg-white/5'
                  }`}>
                    {p.isCore ? 'Костяк' : p.status === 'approved' ? 'Участник' : p.status === 'pending_review' ? 'На рассмотрении' : 'Гость'}
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={onClose}
              className="shrink-0 p-2 rounded-full bg-white/5 hover:bg-white/10 border-none cursor-pointer text-white/70 hover:text-white"
              title="Закрыть"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {p && (
            <div className="mt-4 space-y-1.5">
              <div className="flex justify-between text-[10px] font-mono uppercase tracking-widest">
                <span className="text-white/50">Уровень {level} · {levelTitle}</span>
                {/* Прогресс ВНУТРИ уровня, а не от нуля: полоса рисуется по
                    остатку (points % 500), и подпись обязана совпадать с ней. */}
                <span className="text-brand font-bold">{p.points % 500} / 500 → ур. {level + 1}</span>
              </div>
              <div className="w-full bg-white/10 h-1.5 rounded-full overflow-hidden">
                <div className="bg-brand h-full transition-all" style={{ width: `${((p.points % 500) / 500) * 100}%` }} />
              </div>
            </div>
          )}
        </div>

        {/* ── Вкладки ── */}
        <div className="shrink-0 flex border-b border-white/10 bg-[#141414] overflow-x-auto scrollbar-none">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => { setTab(t.key); haptic('success'); }}
                className={`flex-1 min-w-[86px] px-3 py-3 flex flex-col items-center gap-1 border-none cursor-pointer bg-transparent transition-colors ${
                  active ? 'text-brand' : 'text-white/40 hover:text-white/70'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span className="text-[9px] font-mono uppercase tracking-wider whitespace-nowrap">{t.label}</span>
                <span className={`h-0.5 w-full rounded-full ${active ? 'bg-brand' : 'bg-transparent'}`} />
              </button>
            );
          })}
        </div>

        {/* ── Контент ── */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] space-y-5">
          {/* Чек-лист — статичный список клуба, ему не нужны ни профиль, ни
              Telegram. Поэтому он ВНЕ проверки загрузки: иначе deep-link
              ?checklist из бота приводил бы на экран ошибки, если профиль не
              подтянулся. И сверху — перед выездом им пользуются каждый раз,
              а учёт снаряжения нужен раз в сезон. */}
          {/**
           * Порядок на вкладке «Снаряжение» перевёрнут: сначала СКЛАДЧИНА —
           * что уже есть у клуба и у ребят и чем готовы поделиться, и только
           * потом чек-лист. Раньше первым шёл чек-лист, и люди везли по три
           * одинаковых котелка, не зная, что вещь уже едет.
           */}
          {/**
           * БАЗА ЗНАНИЙ — закрытый раздел для тех, кто ведёт события.
           * Владелец (19.08): «база знаний открывается только организатору и
           * костяку». Раньше методики жили только в боте, и организатор читал
           * их в переписке, а в приложении их не было вовсе.
           * Разметка приходит с сервера в телеграмном HTML (<b>/<i>) — это наш
           * собственный текст из кода, не пользовательский ввод.
           */}
          {tab === 'kb' && (
            <div className="space-y-4">
              <div className="bg-brand/10 border border-brand/25 rounded-2xl p-3">
                <h3 className="text-sm font-black">📚 База знаний</h3>
                <p className="text-[11px] text-white/60 leading-snug mt-1">
                  Стандарты клуба: как вести событие одинаково хорошо у любого ведущего.
                  Раздел закрыт — его видят только костяк и организаторы.
                </p>
              </div>
              {kbError && <p className="text-[11px] text-rose-300">{kbError}</p>}
              {!kbSections && !kbError && (
                <p className="text-white/40 text-xs text-center py-8">Загружаю…</p>
              )}
              {(kbSections || []).map((sec) => (
                <details key={sec.key} className="bg-white/[0.03] border border-white/10 rounded-2xl p-3 group">
                  <summary className="cursor-pointer text-sm font-bold list-none flex items-center justify-between gap-2">
                    <span>{sec.title}</span>
                    <span className="text-white/30 text-[10px] font-mono group-open:hidden">открыть</span>
                  </summary>
                  <div
                    className="text-[12px] text-white/75 leading-relaxed mt-3 space-y-1 [&_b]:text-white [&_i]:text-white/55"
                    dangerouslySetInnerHTML={{ __html: sec.body.replace(/\n/g, '<br/>') }}
                  />
                </details>
              ))}
            </div>
          )}

          {tab === 'gear' && (
            <div className="space-y-5">
              <section className="space-y-2">
                <h3 className="text-[9px] font-mono uppercase tracking-widest text-white/40">
                  Складчина: что уже есть у круга
                </h3>
                <p className="text-[11px] text-white/50 leading-snug">
                  Своё, клубное и передачи из рук в руки. Прежде чем покупать или везти —
                  посмотри, может это уже едет. Своё снаряжение добавь сюда же: круг увидит,
                  чем ты можешь поделиться.
                </p>
                <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-3">
                  <EquipmentPanel />
                </div>
              </section>

              {/* Чек-лист на 131 пункт разворачивался прямо в списке и
                  занимал пол-экрана гармошкой. Он нужен раз перед выездом,
                  поэтому теперь спрятан под кнопку — открывается по желанию. */}
              <section className="space-y-2">
                <button
                  type="button"
                  onClick={() => setShowChecklist((v) => !v)}
                  className="w-full bg-white/[0.03] border border-white/10 rounded-2xl p-3 flex items-center justify-between text-left cursor-pointer hover:bg-white/[0.06] transition-colors"
                >
                  <span className="space-y-0.5">
                    <span className="block text-[11px] font-bold text-white">Личный чек-лист кемпинга</span>
                    <span className="block text-[10px] text-white/40">131 пункт — открой перед сборами</span>
                  </span>
                  <span className="text-white/40 text-lg leading-none">{showChecklist ? '–' : '+'}</span>
                </button>
                {showChecklist && <CampingChecklist />}
              </section>
            </div>
          )}

          {loading && tab !== 'gear' && (
            <div className="py-16 flex flex-col items-center gap-3 text-white/40">
              <Loader2 className="w-6 h-6 animate-spin text-brand" />
              <span className="text-[11px] font-mono uppercase tracking-widest">Загружаем профиль…</span>
            </div>
          )}

          {!loading && error && (
            <div className="bg-white/5 border border-white/10 rounded-2xl p-5 text-center space-y-3">
              <p className="text-[12px] text-white/70 leading-relaxed">{error}</p>
              {!isInsideTelegram() && (
                <a
                  href="https://t.me/campsflint_bot"
                  target="_blank" rel="noopener noreferrer"
                  className="inline-block bg-brand text-black font-black text-[11px] uppercase tracking-widest px-4 py-2.5 rounded-xl"
                >
                  Открыть в Telegram
                </a>
              )}
            </div>
          )}

          {!loading && !error && p && (
            <>
              {/* ═══ ОБЗОР ═══ */}
              {tab === 'overview' && (
                <>
                  {/* ПРИОРИТЕТ 1 — требует действия */}
                  {todo.length > 0 && (
                    <section className="space-y-2">
                      <h3 className="text-[9px] font-mono uppercase tracking-widest text-rose-300 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5" /> Требует внимания ({todo.length})
                      </h3>
                      {todo.map((t) => (
                        <button
                          key={t.key}
                          type="button"
                          onClick={() => { if (t.key === 'birthday') { setTab('settings'); haptic('success'); } }}
                          className={`w-full text-left rounded-2xl border p-3.5 flex items-start gap-3 cursor-pointer transition-all ${
                            t.tone === 'warn' ? 'bg-rose-500/10 border-rose-500/30 hover:bg-rose-500/15' : 'bg-white/5 border-white/10 hover:bg-white/10'
                          }`}
                        >
                          <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${t.tone === 'warn' ? 'bg-rose-400' : 'bg-brand'}`} />
                          <div className="min-w-0">
                            <div className="text-[13px] leading-snug">{t.text}</div>
                            {t.sub && <div className="text-[10px] text-white/45 font-mono mt-0.5">{t.sub}</div>}
                          </div>
                          {t.key === 'birthday' && (
                            <span className="shrink-0 text-[9px] font-mono uppercase text-brand bg-brand/10 border border-brand/25 rounded-lg px-2 py-1">
                              Заполнить →
                            </span>
                          )}
                        </button>
                      ))}
                    </section>
                  )}

                  {/* ПРИОРИТЕТ 2 — ближайшее событие */}
                  {nearest && (
                    <section className="space-y-2">
                      <h3 className="text-[9px] font-mono uppercase tracking-widest text-white/40">Ближайшее событие</h3>
                      <div className="rounded-2xl border border-brand/30 bg-brand/5 p-4 space-y-2">
                        <div className="flex items-start justify-between gap-3">
                          <h4 className="font-display font-black uppercase leading-tight">{nearest.title}</h4>
                          {(() => {
                            const d = daysUntil(nearest.date);
                            return d === null ? null : (
                              <span className="shrink-0 text-[9px] font-mono font-bold px-2 py-0.5 rounded-full bg-brand/20 text-brand">
                                {d === 0 ? 'сегодня' : d === 1 ? 'завтра' : `через ${d} дн`}
                              </span>
                            );
                          })()}
                        </div>
                        <div className="text-[11px] text-white/60 font-mono flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-brand" /> {fmtDate(nearest.date)}
                        </div>
                        {nearest.location && (
                          <div className="text-[11px] text-white/60 font-mono flex items-start gap-1.5">
                            <MapPin className="w-3.5 h-3.5 text-brand shrink-0 mt-0.5" /> {nearest.location}
                          </div>
                        )}
                      </div>
                    </section>
                  )}

                  {/* ПРИОРИТЕТ 3 — уведомления */}
                  <section className="space-y-2">
                    <h3 className="text-[9px] font-mono uppercase tracking-widest text-white/40 flex items-center gap-1.5">
                      <Bell className="w-3.5 h-3.5" /> Уведомления
                    </h3>
                    {notifications.length === 0 ? (
                      <p className="text-[11px] text-white/35 font-mono bg-white/5 border border-white/10 rounded-2xl p-4">
                        Пока ничего. Здесь появятся сообщения от организаторов — и ответить можно прямо отсюда.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {(showAllNotif ? notifications : notifications.slice(0, 5)).map((n) => (
                          <div key={n.id} className={`rounded-2xl border p-3.5 ${
                            n.kind === 'from_club' ? 'bg-white/5 border-white/10' : 'bg-brand/5 border-brand/20'
                          }`}>
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <span className="text-[9px] font-mono uppercase tracking-widest text-white/40">
                                {n.kind === 'from_club' ? (n.author || 'Организаторы') : 'Ты'}
                              </span>
                              <span className="text-[9px] font-mono text-white/30 shrink-0">{fmtWhen(n.at)}</span>
                            </div>
                            <p className="text-[12px] text-white/80 leading-snug whitespace-pre-wrap break-words">{n.text}</p>
                            {/* Ответ на КАЖДОЕ сообщение организаторов, а не только
                                на последнее — иначе непонятно, на что отвечаешь. */}
                            {n.kind === 'from_club' && (
                              <button
                                type="button" onClick={() => quoteReply(n)}
                                className="mt-2 inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-widest text-brand bg-brand/10 hover:bg-brand/20 border border-brand/25 rounded-lg px-2 py-1 cursor-pointer"
                              >
                                <Reply className="w-3 h-3" /> Ответить
                              </button>
                            )}
                          </div>
                        ))}
                        {notifications.length > 5 && (
                          <button
                            type="button" onClick={() => setShowAllNotif((v) => !v)}
                            className="w-full text-[10px] text-white/45 font-mono bg-transparent border-none cursor-pointer py-1 hover:text-white/70"
                          >
                            {showAllNotif ? 'Свернуть' : `Показать все (${notifications.length})`}
                          </button>
                        )}
                      </div>
                    )}

                    {/* Написать организаторам. Уходит в тот же тред, что и
                        переписка в боте — отдельного канала не появляется. */}
                    <div className="bg-white/5 border border-white/10 rounded-2xl p-3 space-y-2">
                      <textarea
                        ref={msgRef}
                        value={msgText}
                        onChange={(e) => setMsgText(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendMessage(); } }}
                        rows={2}
                        placeholder="Написать организаторам…"
                        className="w-full bg-black/30 border border-white/10 rounded-xl p-2.5 text-white text-[12px] placeholder:text-white/25 outline-none focus:border-brand/40 resize-none"
                      />
                      <div className="flex items-center justify-between gap-2">
                        {/* «Сохранено, но…» — это предупреждение, а не успех:
                            красим в янтарный, чтобы не читалось как «всё ок». */}
                        <span className={`text-[9px] font-mono ${
                          /^Отправлено/.test(msgNote) ? 'text-brand'
                            : /^Сохранено/.test(msgNote) ? 'text-amber-300'
                            : 'text-rose-400'
                        }`}>{msgNote}</span>
                        <button
                          type="button" onClick={sendMessage} disabled={msgSending || !msgText.trim()}
                          className="shrink-0 bg-brand hover:bg-brand-hover text-black rounded-xl px-3.5 py-2 text-[10px] font-black uppercase tracking-widest cursor-pointer border-none flex items-center gap-1.5 disabled:opacity-40"
                        >
                          {msgSending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                          Отправить
                        </button>
                      </div>
                    </div>
                  </section>

                  {/* ПРИОРИТЕТ 4 — статистика и награды */}
                  <section className="grid grid-cols-3 gap-2.5">
                    {[
                      { label: 'Посетил', value: p.attended, tone: 'text-white' },
                      { label: 'Записан', value: p.signedUp, tone: 'text-white/70' },
                      { label: 'Очки', value: p.points, tone: 'text-brand' },
                    ].map((s) => (
                      <div key={s.label} className="bg-white/5 border border-white/10 rounded-2xl p-3.5">
                        <div className="text-white/40 text-[9px] uppercase font-mono tracking-widest">{s.label}</div>
                        <div className={`font-display font-black text-2xl ${s.tone}`}>{s.value}</div>
                      </div>
                    ))}
                  </section>

                  <section className="space-y-2">
                    <h3 className="text-[9px] font-mono uppercase tracking-widest text-white/40">
                      Награды ({achievements.filter((a) => a.unlocked).length}/{achievements.length})
                    </h3>
                    <div className="grid grid-cols-3 gap-2">
                      {achievements.map((a) => {
                        const Icon = a.icon;
                        return (
                          <div key={a.id} className={`p-3 rounded-xl border flex flex-col items-center gap-1.5 text-center ${
                            a.unlocked ? 'bg-brand/10 border-brand/30' : 'bg-white/5 border-white/5'
                          }`}>
                            <Icon className={`w-5 h-5 ${a.unlocked ? 'text-brand' : 'text-white/20'}`} />
                            <div className={`text-[9px] font-bold uppercase tracking-wider ${a.unlocked ? 'text-brand' : 'text-white/25'}`}>{a.name}</div>
                            <div className="text-[8px] text-white/35 leading-tight">{a.desc}</div>
                          </div>
                        );
                      })}
                    </div>
                  </section>

                  {/* ПРИОРИТЕТ 5 — реф-ссылка */}
                  {p.refLink && (
                    <section className="bg-brand/5 border border-brand/20 rounded-2xl p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-brand text-[9px] uppercase font-mono font-bold tracking-widest flex items-center gap-1.5">
                          <Users className="w-3.5 h-3.5" /> Твоя реф-ссылка
                        </span>
                        <span className="text-[10px] text-white/50 font-mono">Приглашено: <b className="text-brand">{p.referralsCount}</b></span>
                      </div>
                      <div className="flex gap-2">
                        <input readOnly value={p.refLink} className="flex-1 bg-black/30 border border-white/10 rounded-lg p-2 text-white/80 text-[11px] font-mono truncate outline-none" />
                        <button onClick={copyRef} className="shrink-0 bg-brand hover:bg-brand-hover text-black rounded-lg px-3 flex items-center justify-center cursor-pointer border-none" title="Копировать">
                          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                        </button>
                      </div>
                    </section>
                  )}
                </>
              )}

              {/* ═══ СОБЫТИЯ ═══ */}
              {tab === 'events' && (
                <>
                  <section className="space-y-2">
                    <h3 className="text-[9px] font-mono uppercase tracking-widest text-white/40">
                      Предстоящие ({upcoming.length})
                    </h3>
                    {upcoming.length === 0 && (
                      <p className="text-[11px] text-white/35 font-mono bg-white/5 border border-white/10 rounded-2xl p-4">
                        Ты пока ни на что не записан.
                      </p>
                    )}
                    {upcoming.map((e) => (
                      <div key={e.regId} className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-2.5">
                        <div className="flex items-start justify-between gap-3">
                          <h4 className="font-display font-black uppercase text-sm leading-tight">{e.title}</h4>
                          <span className="shrink-0 text-[9px] font-mono text-white/50">{fmtDate(e.date)}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
                          <div className={`rounded-lg px-2.5 py-2 border flex items-center gap-1.5 ${
                            e.paymentStatus === 'paid' ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300' : 'bg-rose-500/10 border-rose-500/25 text-rose-300'
                          }`}>
                            <CreditCard className="w-3.5 h-3.5 shrink-0" />
                            {e.paymentStatus === 'paid' ? 'Взнос внесён' : 'Взнос не внесён'}
                          </div>
                          <div className="rounded-lg px-2.5 py-2 border bg-white/5 border-white/10 text-white/60 flex items-center gap-1.5">
                            <Truck className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate">{e.hasTransport ? (e.transportDetails || 'Своё авто') : e.transportDetails || 'Не указано'}</span>
                          </div>
                          {e.guestCount > 0 && (
                            <div className="rounded-lg px-2.5 py-2 border bg-white/5 border-white/10 text-white/60 flex items-center gap-1.5">
                              <Users className="w-3.5 h-3.5 shrink-0" /> +{e.guestCount} гостя
                            </div>
                          )}
                          {e.dietary && (
                            <div className="rounded-lg px-2.5 py-2 border bg-white/5 border-white/10 text-white/60 flex items-center gap-1.5">
                              <UtensilsCrossed className="w-3.5 h-3.5 shrink-0" /> {DIET_RU[e.dietary] || e.dietary}
                            </div>
                          )}
                        </div>
                        {e.roles && <div className="text-[10px] text-white/45 font-mono">Роли: {e.roles}</div>}
                      </div>
                    ))}
                  </section>

                  <section className="space-y-2">
                    <h3 className="text-[9px] font-mono uppercase tracking-widest text-white/40">
                      Прошедшие ({past.length})
                    </h3>
                    {past.length === 0 && (
                      <p className="text-[11px] text-white/35 font-mono bg-white/5 border border-white/10 rounded-2xl p-4">Пока пусто.</p>
                    )}
                    {past.map((e) => (
                      <div key={e.regId} className="bg-white/[0.03] border border-white/5 rounded-2xl p-3.5 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-[13px] truncate">{e.title}</div>
                          <div className="text-[10px] text-white/35 font-mono">{fmtDate(e.date)}</div>
                        </div>
                        <span className={`shrink-0 text-[9px] font-mono uppercase px-2 py-0.5 rounded-full border ${
                          e.attended ? 'border-brand/30 text-brand bg-brand/10' : 'border-white/10 text-white/30'
                        }`}>
                          {e.attended ? 'был' : 'не отмечен'}
                        </span>
                      </div>
                    ))}
                  </section>
                </>
              )}

              {/* ═══ СНАРЯЖЕНИЕ И ПИТАНИЕ ═══ */}
              {tab === 'gear' && (
                <>

                  {(data.transfers || []).length > 0 && (
                    <section className="space-y-2">
                      <h3 className="text-[9px] font-mono uppercase tracking-widest text-amber-300 flex items-center gap-1.5">
                        <ArrowRightLeft className="w-3.5 h-3.5" /> Незакрытые передачи ({data.transfers.length})
                      </h3>
                      {data.transfers.map((t: any) => (
                        <div key={t.id} className="bg-amber-500/10 border border-amber-500/25 rounded-2xl p-3.5">
                          <div className="text-[13px]">{t.item_name} × {t.quantity}</div>
                          <div className="text-[10px] text-white/45 font-mono mt-0.5">
                            {t.from_telegram_id === p.telegramId ? 'ты отдаёшь' : 'тебе передают'} · ждёт подтверждения
                          </div>
                        </div>
                      ))}
                    </section>
                  )}

                  {/**
                   * Снаряжение живёт ТОЛЬКО на своей вкладке.
                   * Здесь стоял второй экземпляр той же панели — на экране
                   * получалось два одинаковых блока «добавить снаряжение», и
                   * было непонятно, какой из них настоящий. Оставляем короткую
                   * сводку и ссылку на вкладку.
                   */}
                  <section className="space-y-2">
                    <h3 className="text-[9px] font-mono uppercase tracking-widest text-white/40">Снаряжение</h3>
                    <button
                      type="button"
                      onClick={() => setTab('gear')}
                      className="w-full text-left bg-white/[0.03] border border-white/10 rounded-2xl p-4 cursor-pointer hover:bg-white/[0.06] transition-colors"
                    >
                      <span className="text-[12px] text-white/80 block">
                        {(data.equipment || []).length > 0
                          ? `Твоего снаряжения в списке: ${(data.equipment || []).length}`
                          : 'Своё снаряжение ещё не заведено'}
                      </span>
                      <span className="text-[11px] text-white/45 block mt-1">
                        Вкладка «Снаряжение» → складчина круга и твой список. Что отметишь — увидит организатор
                        и ребята: не повезут второй такой же.
                      </span>
                    </button>
                  </section>

                  <section className="space-y-2">
                    <h3 className="text-[9px] font-mono uppercase tracking-widest text-white/40 flex items-center gap-1.5">
                      <UtensilsCrossed className="w-3.5 h-3.5" /> Питание
                    </h3>
                    <div className="bg-white/5 border border-white/10 rounded-2xl p-3.5 space-y-1">
                      <div className="text-[10px] text-white/40 font-mono uppercase tracking-widest">Мои предпочтения</div>
                      <div className="text-[13px]">{DIET_RU[p.dietary] || 'не указано'}</div>
                    </div>
                    {(data.food || []).length > 0 && (
                      <div className="space-y-2">
                        {(data.food || []).map((f: any, i: number) => (
                          <div key={i} className="bg-white/5 border border-white/10 rounded-2xl p-3.5 flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-[13px] truncate">{f.emoji} {f.name}</div>
                              <div className="text-[10px] text-white/40 font-mono truncate">{f.eventTitle}</div>
                            </div>
                            <span className="shrink-0 text-[11px] font-mono text-brand">{f.quantity} {f.unit}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {nearest && (
                      <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-3">
                        <FoodSelectionPanel eventId={nearest.eventId} telegramId={p.telegramId} eventTitle={nearest.title} />
                      </div>
                    )}
                  </section>
                </>
              )}

              {/* ═══ НАСТРОЙКИ ═══ */}
              {tab === 'settings' && <SettingsTab profile={p} onSaved={load} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Настройки: то, что участник вправе менять сам (статус/очки — только костяк). */
function SettingsTab({ profile, onSaved }: { profile: any; onSaved: () => void }) {
  const [firstName, setFirstName] = useState(profile.firstName || '');
  const [phone, setPhone] = useState(profile.phone || '');
  const [gender, setGender] = useState<string>(profile.gender || '');
  const [birthday, setBirthday] = useState(profile.birthday || '');
  const [dietary, setDietary] = useState<string>(profile.dietary || 'omnivore');
  const notif = profile.prefs?.notify || {};
  const [notifyPrefs, setNotifyPrefs] = useState<Record<string, boolean>>({
    events: notif.events !== false,
    payments: notif.payments !== false,
    logistics: notif.logistics !== false,
    digest: notif.digest !== false,
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const save = async () => {
    // День рождения — ОБЯЗАТЕЛЬНО: нужен для доски дней рождения и расчёта
    // возраста в админке. Без него профиль не сохраняется.
    if (!birthday) {
      setMsg('Укажи день рождения — это обязательное поле');
      haptic('error');
      return;
    }
    setSaving(true); setMsg('');
    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_settings', initData: getInitData(),
          firstName, phone, gender: gender || undefined, birthday, dietary, notifyPrefs,
        }),
      });
      const j = await res.json();
      if (j.ok) { setMsg('Сохранено'); haptic('success'); onSaved(); }
      else { setMsg(j.error || 'Не удалось сохранить'); haptic('error'); }
    } catch { setMsg('Нет связи с сервером'); haptic('error'); }
    setSaving(false);
  };

  const NOTIF_LABELS: Record<string, string> = {
    events: 'Новые события и напоминания',
    payments: 'Взносы и оплаты',
    logistics: 'Логистика: машины, палатки',
    digest: 'Итоги и отзывы после события',
  };

  return (
    <>
      <section className="space-y-3">
        <h3 className="text-[9px] font-mono uppercase tracking-widest text-white/40">Обо мне</h3>
        <div className="space-y-2.5">
          <label className="block">
            <span className="text-[9px] font-mono uppercase tracking-widest text-white/40">Имя</span>
            <input
              value={firstName} onChange={(e) => setFirstName(e.target.value)}
              className="mt-1 w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white text-[13px] outline-none focus:border-brand/40"
            />
          </label>
          <label className="block">
            <span className="text-[9px] font-mono uppercase tracking-widest text-white/40">Телефон для связи</span>
            <input
              value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+375 29 111-22-33"
              className="mt-1 w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white text-[13px] font-mono outline-none focus:border-brand/40 placeholder:text-white/25"
            />
          </label>
          <label className="block">
            <span className="text-[9px] font-mono uppercase tracking-widest text-white/40">День рождения *</span>
            <input
              type="date"
              value={birthday} onChange={(e) => setBirthday(e.target.value)}
              max={new Date().toISOString().split('T')[0]}
              className="mt-1 w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white text-[13px] font-mono outline-none focus:border-brand/40"
            />
            <p className="text-[9px] text-white/30 font-mono mt-1">Обязательное поле. Нужен для доски дней рождения и возраста в клубе.</p>
          </label>
          <div>
            <span className="text-[9px] font-mono uppercase tracking-widest text-white/40">Пол</span>
            <div className="mt-1 flex gap-2">
              {[{ v: 'male', l: 'Мужчина' }, { v: 'female', l: 'Женщина' }].map((o) => (
                <button
                  key={o.v} type="button" onClick={() => setGender(o.v)}
                  className={`flex-1 py-2.5 rounded-xl text-[12px] font-bold border-none cursor-pointer transition-all ${
                    gender === o.v ? 'bg-brand text-black' : 'bg-white/10 text-white/60 hover:bg-white/15'
                  }`}
                >{o.l}</button>
              ))}
            </div>
            <p className="text-[9px] text-white/30 font-mono mt-1">Нужен для расселения по палаткам и мужских/женских событий.</p>
          </div>
          <label className="block">
            <span className="text-[9px] font-mono uppercase tracking-widest text-white/40">Питание</span>
            <select
              value={dietary} onChange={(e) => setDietary(e.target.value)}
              className="mt-1 w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white text-[13px] outline-none focus:border-brand/40"
            >
              <option value="omnivore">Всё ем</option>
              <option value="vegetarian">Вегетарианец</option>
              <option value="vegan">Веган</option>
            </select>
          </label>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-[9px] font-mono uppercase tracking-widest text-white/40 flex items-center gap-1.5">
          <Bell className="w-3.5 h-3.5" /> Уведомления
        </h3>
        <p className="text-[9px] text-white/30 font-mono leading-relaxed">
          Выключенное не придёт в Telegram. Организационные сообщения от костяка приходят всегда.
        </p>
        {Object.keys(NOTIF_LABELS).map((k) => (
          <label key={k} className="flex items-center justify-between gap-3 bg-white/5 border border-white/10 rounded-2xl p-3.5 cursor-pointer">
            <span className="text-[12px] text-white/80">{NOTIF_LABELS[k]}</span>
            <input
              type="checkbox" checked={!!notifyPrefs[k]}
              onChange={(e) => setNotifyPrefs((s) => ({ ...s, [k]: e.target.checked }))}
              className="w-4 h-4 shrink-0 accent-[#E6FD3A]"
            />
          </label>
        ))}
      </section>

      <section className="space-y-2">
        <h3 className="text-[9px] font-mono uppercase tracking-widest text-white/40 flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5" /> Клуб
        </h3>
        <div className="bg-white/5 border border-white/10 rounded-2xl p-3.5 space-y-1.5 text-[11px] font-mono text-white/50">
          <div className="flex justify-between"><span>Статус</span><span className="text-white/80">{profile.isCore ? 'Костяк' : profile.status === 'approved' ? 'Участник' : profile.status}</span></div>
          <div className="flex justify-between"><span>Согласие на обработку данных</span><span className={profile.agreedPd ? 'text-emerald-300' : 'text-rose-300'}>{profile.agreedPd ? 'дано' : 'нет'}</span></div>
          {profile.memberSince && (
            <div className="flex justify-between items-center gap-2">
              <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> В клубе с</span>
              <span className="text-white/80">{new Date(profile.memberSince).toLocaleDateString('ru-RU')}</span>
            </div>
          )}
        </div>
        <p className="text-[9px] text-white/30 font-mono leading-relaxed">
          Статус, уровень и очки меняет только костяк клуба — это защита от накрутки.
        </p>
      </section>

      {msg && (
        <p className={`text-[11px] font-mono text-center ${msg === 'Сохранено' ? 'text-brand' : 'text-rose-400'}`}>{msg}</p>
      )}
      <button
        type="button" onClick={save} disabled={saving}
        className="w-full bg-brand hover:bg-brand-hover text-black py-3.5 rounded-xl text-[12px] font-black uppercase tracking-widest cursor-pointer border-none flex items-center justify-center gap-2 disabled:opacity-60"
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        {saving ? 'Сохраняем…' : 'Сохранить'}
      </button>
    </>
  );
}
