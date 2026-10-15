import React, { useCallback, useEffect, useState, Suspense } from 'react';
import Avatar from './Avatar';
import EventTasks from './EventTasks';
import EventContributions from './EventContributions';
import { HeroGallery, IncludedBlock, FaqBlock, TripBlock, YandexMapBlock, WhoBrings } from './EventShowcase';
import { motion } from 'motion/react';
import {
  X, MapPin, Clock, Users, Check, Send, Calendar, ShieldCheck, Tag, Eye, Lock, Bell, Share2, Monitor, Wifi, Smartphone, Backpack, HeartPulse
, UserPlus} from 'lucide-react';
import { CommunityEvent, getYandexMapsUrl, getEventPhase, isEventOver, priceTag, clubValue, calculateDynamicPrice, getToday, prettyPlace, extractCoords } from '../types';
import { getPromoVideo } from '../promoVideo';
import { submitInterest, submitVote } from '../api';
import { eventShareLink } from '../site';
import { haptic, getInitData, openBot, ensureWriteAccess, downloadFile } from '../telegram';
import ProgramVoting from './ProgramVoting';
import CampingChecklist from './CampingChecklist';
import LiveMedia from './LiveMedia';
import { lazyWithRetry } from '../lazy';
import { getEventGuide } from '../eventGuide';
import { LogisticsPanel } from './LogisticsPanel';
import { EventRules } from './EventRules';
import ChallengeProgress from './ChallengeProgress';
import ChallengeStories from './ChallengeStories';

/**
 * Окно съёмки открывается по кнопке и почти никогда не нужно. Статический
 * импорт тянул его в чанк карточки события, а через неё — в бандл афиши.
 */
const SnapModal = lazyWithRetry(() => import('./SnapModal'));

/**
 * Настоящий ли это чат события.
 * В `telegram_bot_url` у половины событий лежит ссылка на самого бота
 * (t.me/campsflint_bot) — кнопка «Чат события» вела туда, где человек уже
 * находится, и участники писали «не вижу, как вступить в чат».
 * Чат = инвайт-ссылка или публичная группа; ники ботов кончаются на «bot».
 */
function isRealChatUrl(url?: string): boolean {
  const u = String(url || '').trim();
  if (/^https:\/\/t\.me\/(\+|joinchat\/)/i.test(u)) return true;
  return /^https:\/\/t\.me\/[A-Za-z0-9_]{4,}$/i.test(u) && !/bot$/i.test(u);
}

// --- .ics (self-contained, data-URI) ---
const pad = (n: number) => String(n).padStart(2, '0');
const icsEscape = (s: string) =>
  String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
function icsAddDayCompact(ymd: string): string {
  const dt = new Date(`${ymd}T00:00:00`);
  dt.setDate(dt.getDate() + 1);
  return `${dt.getFullYear()}${pad(dt.getMonth() + 1)}${pad(dt.getDate())}`;
}
/** Собирает .ics data-URI из даты/времени события. Точную локацию кладём только зарегистрированным. */
function buildIcsDataUri(event: CommunityEvent, includeLocation: boolean): string {
  const start = (event.date || '').replace(/-/g, '');
  // Время берём только для однодневных (у диапазона — событие «на весь день»).
  const m = !event.dateEnd ? `${event.time} ${event.dateLabel}`.match(/(\d{1,2}):(\d{2})/) : null;
  let dtStart: string, dtEnd: string;
  if (m) {
    const sh = Number(m[1]);
    const sm = m[2];
    dtStart = `DTSTART:${start}T${pad(sh)}${sm}00`;
    const me = (event.timeEnd || '').match(/(\d{1,2}):(\d{2})/);
    dtEnd = `DTEND:${start}T${me ? pad(Number(me[1])) + me[2] : pad((sh + 3) % 24) + sm}00`;
  } else {
    dtStart = `DTSTART;VALUE=DATE:${start}`;
    dtEnd = `DTEND;VALUE=DATE:${icsAddDayCompact(event.dateEnd || event.date)}`;
  }
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//FLINT//RU', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT', `UID:${event.id}@flint`, dtStart, dtEnd,
    `SUMMARY:${icsEscape(event.title)}`,
    `DESCRIPTION:${icsEscape(`${event.painPoint || ''}\nБот: https://t.me/campsflint_bot?start=event_${event.id}`)}`,
    includeLocation && event.location ? `LOCATION:${icsEscape(event.location)}` : '',
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean);
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(lines.join('\r\n'))}`;
}

/**
 * «💎 ЦЕННОСТЬ»: сколько это стоит без клуба, что клуб даёт и сколько мест.
 * Общая структура для любых событий с пригласительными (форумы, выставки).
 */
function ClubValueBlock({ event }: { event: CommunityEvent }) {
  const v = clubValue(event.logistics);
  if (!v) return null;
  const left = v.seats ? Math.max(0, v.seats - (Number(event.participantsCount) || 0)) : 0;
  return (
    <div className="rounded-2xl border border-brand/30 bg-gradient-to-br from-brand/10 to-transparent p-4 space-y-3">
      <span className="block text-[10px] font-mono uppercase tracking-widest text-brand/80">💎 Ценность для тебя</span>
      <div className="grid grid-cols-2 gap-2">
        {v.marketPrice && (
          <div className="rounded-xl bg-black/30 p-3">
            <div className="text-[10px] uppercase text-white/40">Билет без клуба</div>
            <div className="mt-0.5 text-base font-black text-white/70 line-through decoration-white/30">{v.marketPrice}</div>
          </div>
        )}
        <div className="rounded-xl bg-black/30 p-3">
          <div className="text-[10px] uppercase text-white/40">Для участника клуба</div>
          <div className="mt-0.5 text-base font-black text-brand">Бесплатно</div>
        </div>
      </div>
      <p className="text-[13px] leading-snug text-white/80">
        🎟 У клуба {v.seats ? <b>{v.seats} пригласительных</b> : 'есть пригласительные'}
        {v.sponsor ? <> · партнёр — <b>{v.sponsor}</b></> : null}.
        {v.seats ? <> {left > 0 ? <>Свободно: <b className="text-brand">{left}</b> из {v.seats}.</> : <>Все места разобраны — запишись в лист ожидания.</>}</> : null}
      </p>
      {v.ticketUrl && (
        <a href={v.ticketUrl} target="_blank" rel="noreferrer" className="inline-block text-[11px] text-white/45 underline decoration-white/20">
          Цена на сайте продажи билетов →
        </a>
      )}
    </div>
  );
}

/**
 * «🎟 ТВОЙ ПРИГЛАСИТЕЛЬНЫЙ». Если клуб выписал на человека именной билет —
 * он видит его здесь и одной кнопкой получает PDF в личку от бота (почистил
 * чат, потерял файл — жмёт ещё раз). Чужой билет так не получить: сервер ищет
 * строго по подписанному Telegram id.
 */
function MyTicketCard({ eventId }: { eventId: string }) {
  const [st, setSt] = React.useState<any>(null);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState('');
  const call = (op: 'status' | 'send' | 'download') => fetch('/api/profile', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'my_ticket', op, eventId, initData: getInitData() }),
  }).then((r) => r.json());
  React.useEffect(() => { if (getInitData()) call('status').then(setSt).catch(() => {}); }, [eventId]);
  if (!st?.ok || !st.pool) return null;
  if (!st.ticket) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[.03] p-4 text-[12px] text-white/60">
        🎟 Пригласительных у клуба: <b className="text-white">{st.total}</b>, свободно <b className="text-brand">{st.free}</b>.
        Запишись — организатор выпишет именной билет и бот пришлёт его тебе в личку.
      </div>
    );
  }
  const t = st.ticket;
  return (
    <div className="relative overflow-hidden rounded-2xl border border-brand/40 bg-gradient-to-br from-brand/15 via-brand/5 to-transparent p-4">
      <div className="pointer-events-none absolute -right-6 -top-6 text-[88px] leading-none opacity-10">🎟</div>
      <span className="block text-[10px] font-mono uppercase tracking-widest text-brand/80">Твой пригласительный</span>
      <div className="mt-1 font-display text-2xl font-black text-white">№ {t.no} <span className="text-white/40 text-base">из {st.total}</span></div>
      <div className="mt-0.5 text-[12px] text-white/70">{t.name} · код <span className="font-mono text-brand">{t.code}</span></div>
      <p className="mt-2 text-[12px] leading-snug text-white/65">
        {t.used ? '✅ Билет использован — ты на месте. Заряжайся!' : 'Именной и одноразовый: на входе покажи QR из файла. Не пересылай — пройдёт только первый скан.'}
      </p>
      {!t.used && (
        <button type="button" disabled={busy}
          onClick={async () => {
            setBusy(true); setMsg('');
            try {
              // Разрешаем боту писать (системный запрос Telegram) — иначе
              // тем, кто не нажимал «Старт», файл в личку не дойдёт.
              await ensureWriteAccess();
              const j = await call('send');
              if (j.ok) { haptic('success'); setMsg('Отправил в чат с ботом — проверь Telegram 🎟'); setSt(j); }
              else if (j.url) { downloadFile(j.url, j.fileName); haptic('success'); setMsg('Бот пока не может тебе написать — скачал файл сюда. Нажми «Старт» в боте, и копия придёт в личку.'); }
              else setMsg(j.error || 'Не получилось, попробуй ещё раз');
            } catch { setMsg('Нет связи — попробуй ещё раз'); }
            finally { setBusy(false); }
          }}
          className="mt-3 w-full rounded-xl border-none bg-brand py-3 text-sm font-black uppercase text-black cursor-pointer disabled:opacity-50">
          {busy ? 'Отправляю…' : t.received ? '📩 Прислать ещё раз' : '📩 Забрать пригласительный'}
        </button>
      )}
      {!t.used && (
        <button type="button" disabled={busy}
          onClick={async () => {
            setBusy(true); setMsg('');
            try {
              const j = await call('download');
              if (j.ok && j.url) { downloadFile(j.url, j.fileName); haptic('success'); }
              else setMsg(j.error || 'Не получилось');
            } catch { setMsg('Нет связи — попробуй ещё раз'); }
            finally { setBusy(false); }
          }}
          className="mt-2 w-full rounded-xl border border-white/15 bg-transparent py-2.5 text-[12px] font-bold text-white/75 cursor-pointer disabled:opacity-50">
          ⬇️ Скачать PDF
        </button>
      )}
      {msg && <p className="mt-2 text-center text-[11px] text-white/70">{msg}</p>}
    </div>
  );
}

// Компонент динамической цены
function DynamicPrice({ event }: { event: CommunityEvent }) {
  const { label, factors } = calculateDynamicPrice(event);
  // Модель оплаты важнее «взноса»: при «каждый за себя» клубу не платят, но
  // и бесплатным выезд не назовёшь — показываем ориентир и комментарий.
  const tag = priceTag(event);
  const model = (event.logistics as any)?.costModel;
  const headline = event.priceType === 'paid' && event.priceAmount > 0 ? label : tag.short;
  const sub = event.priceType === 'paid' && event.priceAmount > 0 ? 'Взнос на аренду — делится поровну на всех'
    : model === 'self' ? 'Взноса клубу нет — каждый оплачивает себя на месте'
    : model === 'pool' ? 'Общий взнос — делится поровну на всех'
    : model === 'food_share' ? 'Еду покупаем вскладчину'
    : model === 'bring_own' ? 'Каждый везёт своё'
    : model === 'club_invite' ? 'Пригласительный от клуба — платить не нужно'
    : 'Полностью свободное участие';

  return (
    <div className="space-y-1">
      <div className="text-brand font-black text-lg">{headline}</div>
      <div className="text-white/55 text-[11px]">{sub}</div>
      {tag.note && <div className="text-white/75 text-[12px] leading-snug whitespace-pre-line">{tag.note}</div>}
      {factors.length > 0 && (
        <div className="space-y-0.5 mt-1.5">
          {factors.map((factor, idx) => (
            <div key={idx} className="text-[9px] text-white/40 font-mono flex items-center gap-1">
              <span className="w-1 h-1 rounded-full bg-brand/60" />
              {factor}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Погода (open-meteo, без ключа, запрос из браузера) ---
const WMO: Record<number, { icon: string; label: string }> = {
  0: { icon: '☀️', label: 'Ясно' }, 1: { icon: '🌤', label: 'Малооблачно' },
  2: { icon: '⛅️', label: 'Облачно' }, 3: { icon: '☁️', label: 'Пасмурно' },
  45: { icon: '🌫', label: 'Туман' }, 48: { icon: '🌫', label: 'Изморозь' },
  51: { icon: '🌦', label: 'Морось' }, 53: { icon: '🌦', label: 'Морось' }, 55: { icon: '🌦', label: 'Морось' },
  61: { icon: '🌧', label: 'Дождь' }, 63: { icon: '🌧', label: 'Дождь' }, 65: { icon: '🌧', label: 'Ливень' },
  71: { icon: '🌨', label: 'Снег' }, 73: { icon: '🌨', label: 'Снег' }, 75: { icon: '❄️', label: 'Снегопад' },
  80: { icon: '🌦', label: 'Ливни' }, 81: { icon: '🌧', label: 'Ливни' }, 82: { icon: '⛈', label: 'Ливни' },
  95: { icon: '⛈', label: 'Гроза' }, 96: { icon: '⛈', label: 'Гроза' }, 99: { icon: '⛈', label: 'Гроза с градом' },
};
function WeatherBlock({ event }: { event: CommunityEvent }) {
  const [data, setData] = useState<any>(null);
  const lat = event.coordinates?.lat;
  const lng = event.coordinates?.lng;
  useEffect(() => {
    if (!lat || !lng) return;
    const start = event.date;
    const eventEnd = event.dateEnd || event.date;
    const today = getToday();
    if (!start || start < today) return;
    const daysAhead = (new Date(`${start}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86400000;
    if (daysAhead > 15) return; // open-meteo прогноз ~16 дней
    /**
     * Показываем НЕДЕЛЮ, а не только дни события: по одному столбику
     * (однодневный выезд) нельзя понять тенденцию — похолодает или разгуляется,
     * а от этого зависит, что класть в рюкзак. Дни самого события подсвечиваем
     * отдельно, чтобы неделя не читалась как «событие на 7 дней».
     */
    // Считаем в UTC: `new Date('...T00:00:00')` берёт ЛОКАЛЬНУЮ полночь, а
    // toISOString() переводит обратно в UTC — при часовом поясе UTC+3 дата
    // уезжала на день назад, и неделя выходила шестидневной.
    const plus = (iso: string, n: number) => {
      const d = new Date(`${iso}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + n);
      return d.toISOString().slice(0, 10);
    };
    const weekEnd = plus(start, 6);
    const end = eventEnd > weekEnd ? eventEnd : weekEnd;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode&timezone=auto&start_date=${start}&end_date=${end}`;
    fetch(url).then((r) => r.json()).then(setData).catch(() => {});
  }, [lat, lng, event.date, event.dateEnd]);

  if (!data?.daily?.time?.length) return null;
  const d = data.daily;
  /**
   * Дождь считаем ТОЛЬКО по дням события. Раньше окно совпадало с событием, но
   * теперь лента недельная — максимум по ней предупреждал бы «возьми дождевик»
   * из-за ливня через пять дней после возвращения.
   */
  const evEnd = event.dateEnd || event.date;
  const rainOnEventDays = (d.time as string[])
    .map((t, i) => (t >= event.date && t <= evEnd ? (d.precipitation_probability_max?.[i] ?? 0) : 0));
  const maxRain = Math.max(0, ...rainOnEventDays);
  return (
    <div className="bg-white/5 border border-white/10 p-4 rounded-2xl space-y-2.5">
      <span className="text-brand text-[10px] tracking-widest font-mono block uppercase font-bold">🌦 Погода на неделю</span>
      <div className="flex gap-2 overflow-x-auto scrollbar-none">
        {(d.time as string[]).map((t, i) => {
          const w = WMO[d.weathercode[i]] || { icon: '🌡', label: '' };
          // Дни самого события — акцентом, остальная неделя приглушена:
          // иначе семидневная лента читается как «событие на неделю».
          const isEventDay = t >= event.date && t <= (event.dateEnd || event.date);
          return (
            <div key={t} className={`shrink-0 rounded-xl px-3 py-2 text-center min-w-[74px] border ${
              isEventDay ? 'bg-brand/10 border-brand/30' : 'bg-black/25 border-white/5 opacity-70'
            }`}>
              <div className="text-[10px] text-white/50">{new Date(`${t}T00:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</div>
              <div className="text-xl leading-tight my-0.5" title={w.label}>{w.icon}</div>
              <div className="text-xs font-bold text-white">{Math.round(d.temperature_2m_max[i])}°<span className="text-white/40">/{Math.round(d.temperature_2m_min[i])}°</span></div>
              <div className="text-[9px] text-sky-300/80">💧 {d.precipitation_probability_max[i]}%</div>
            </div>
          );
        })}
      </div>
      {maxRain >= 60 && <p className="text-[11px] text-amber-400">☔️ Высокая вероятность дождя — возьми дождевик.</p>}
    </div>
  );
}

interface EventDetailModalProps {
  event: CommunityEvent;
  isRegistered: boolean;
  /** Уже принят в клуб — тогда «верификацию» не показываем. */
  isClubMember?: boolean;
  onClose: () => void;
  onRegisterClick: (event: CommunityEvent) => void;
}

export default function EventDetailModal({
  event,
  isRegistered,
  isClubMember,
  onClose,
  onRegisterClick
}: EventDetailModalProps) {
  const maxSpots = event.maxParticipants || 15;
  const totalRegistered = event.participantsCount + (isRegistered ? 1 : 0);
  const spotsRemaining = Math.max(0, maxSpots - totalRegistered);
  const spotsFull = spotsRemaining <= 0;
  const percentFull = Math.min(100, Math.floor((totalRegistered / maxSpots) * 100));
  /**
   * Состав события. Люди несколько раз писали: «написано 6 человек — а КТО?
   * мужчины, женщины, семьи?» — по одной цифре новичок не понимает, его это
   * круг или нет. Имя/пол/костяк отдаёт /api/events, закрытый гейтом клуба.
   */
  // Обложка + галерея места (logistics.gallery) — листаются на обложке.
  const heroImages = [event.image, ...((event.logistics as any)?.gallery || [])].filter((x, i, a) => !!x && a.indexOf(x) === i) as string[];
  const extras = (event.logistics || {}) as any;
  const roster = event.participants || [];
  const rosterMale = roster.filter((p) => p.gender === 'male').length;
  const rosterFemale = roster.filter((p) => p.gender === 'female').length;
  const phase = getEventPhase(event);
  const isLocked = phase === 'locked';
  // Идёт ли событие прямо сейчас (период [date..dateEnd] включает сегодня) — «маячок в моменте».
  const today = getToday();
  const isLiveNow = (event.date || today) <= today && !isEventOver(event, today);
  const guide = getEventGuide(event);

  // Сигнал спроса «Мне интересно» → уходит организаторам в группу.
  const [interestSent, setInterestSent] = useState(false);
  const [interestSending, setInterestSending] = useState(false);
  /** Полный чек-лист клуба — по кнопке, чтобы не растягивать карточку по умолчанию. */
  const [showChecklist, setShowChecklist] = useState(false);
  /** Онлайн-событие: часть блоков (сборы, маршрут, чек-лист) для него бессмысленна. */
  const isOnline = event.notifications?._format === 'online';
  /**
   * Челлендж: марафон с ежедневной отметкой видео-кружком.
   * Отличается от выезда кардинально — нет ни сбора в точке, ни маршрута, ни
   * палаток, зато есть дни, серия и правило «кружок в чат до 06:00». Держим
   * флаг отдельно, чтобы не размазывать проверки по всему компоненту.
   */
  const isChallenge = !!event.isChallenge;
  /**
   * Чек-лист для кемпинга уместен не везде. На «Вызове 30 км» или встрече в
   * городе список «палатка, спальник, котелок» — мусор, который сбивает с толку
   * («некоторые блоки просто не соответствуют мероприятию» — владелец, 30.08).
   * Показываем его только там, где реально ночуют: многодневки и выезды на
   * природу. Полный список всегда доступен участнику в профиле → «Снаряжение».
   */
  const isOvernight = !!event.dateEnd && event.dateEnd !== event.date;
  const campingType = ['camping', 'hike', 'retreat', 'mixed'].includes(String(event.type || '').toLowerCase());
  const needsCampingList = !isOnline && !isChallenge && (isOvernight || campingType);
  /** Предупреждения из логистики: здоровье и условия на месте. */
  const logi: any = event.logistics || {};
  /** Промо-ролик события: явное поле или авто-подбор по названию/локации. */
  const promo = getPromoVideo(event);
  const [promoActive, setPromoActive] = useState(false);
  /** Открыта ли «всплывашка» «Снять фото/видео» из кнопок под баннером. */
  const [showSnap, setShowSnap] = useState(false);
  /** Идёт ли отправка приглашения в личку — на время запроса кнопка гасится. */
  const [shareSending, setShareSending] = useState(false);
  const tg = (window as any).Telegram?.WebApp;
  /**
   * Человек вступил в чат события.
   *
   * Telegram не сообщает, что человек ушёл по инвайт-ссылке, поэтому факт
   * вступления запоминаем сами: один раз нажал «Вступил» (или «Уже в чате») —
   * и предложение больше не вылетает. Ключ — по событию, чтобы, придя на
   * следующий выезд, человек снова получил призыв.
   */
  const chatKey = `flint_chat_joined_${event.id}`;
  const [chatJoined, setChatJoined] = useState<boolean>(() => {
    try { return localStorage.getItem(chatKey) === '1'; } catch { return false; }
  });
  const markChatJoined = () => {
    setChatJoined(true);
    try { localStorage.setItem(chatKey, '1'); } catch { /* приватный режим */ }
  };
  /** Фокус сторис: тап по точке в таблице прогресса открывает кружок этого дня. */
  const [storyFocus, setStoryFocus] = useState<{ telegramId: number; date: string } | null>(null);
  const medicalNote = String(logi.medical || '').trim();
  const isDetox = !!logi.detox;
  const isNoSignal = !!logi.nosignal;
  const handleInterest = async () => {
    if (interestSending || interestSent) return;
    setInterestSending(true);
    await submitInterest(event.id, event.title);
    setInterestSending(false);
    setInterestSent(true);
    haptic('success');
  };

  // Six vectors of development reference
  /**
   * Сколько кадров уже в галерее. Плитка звала «Live-фото» и вела в галерею,
   * которая могла быть пустой: человек открывал, видел ничего и больше не
   * возвращался. Теперь число видно ДО перехода — и оно же зовёт добавить
   * первым, когда пусто.
   */
  // Счётчик берём из того же запроса, что грузит ленту (LiveMedia → onLoaded):
  // раньше карточка дублировала media_list отдельным fetch.
  const [mediaCount, setMediaCount] = useState<{ photo: number; video: number } | null>(null);
  const [galleryUrl, setGalleryUrl] = useState<string | null>(null);
  const onMediaLoaded = useCallback((items: { media_type: string }[], signedGallery?: string | null) => {
    if (signedGallery) setGalleryUrl(signedGallery);
    setMediaCount({
      photo: items.filter((i) => i.media_type !== 'video').length,
      video: items.filter((i) => i.media_type === 'video').length,
    });
  }, []);

  // Prevent scroll behind modal
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  /**
   * Положить готовое приглашение в личку.
   *
   * Через `t.me/share/url` сообщение выходило текстом сверху, а ссылкой
   * в превью снизу — ровно наоборот, как просили: обложки сверху не было,
   * а ссылка шла отдельной карточкой, а не внутри текста. Плюс человек
   * уходил в стороннее окно выбора чата и терял нить разговора.
   *
   * Теперь сервер кладёт сообщение прямо в личку (api/events.ts,
   * action=share): баннер-обложка сверху, подпись, ссылка спрятана под
   * словами «Открыть и записаться». Дальше — обычное «переслать».
   *
   * Одна функция на обе кнопки — «позвать» в шапке карточки и «Поделиться»
   * у прошедшего события. Разница в действии нулевая, значит не должно быть
   * и разницы в коде.
   */
  const sendInvite = async () => {
    if (shareSending) return;
    setShareSending(true);
    const fallback = () => {
      let ref = '';
      try { ref = localStorage.getItem('flint_ref') || ''; } catch { /* приватный режим */ }
      const link = eventShareLink(event.id, ref);
      const text = `Еду на «${event.title}» с FLINT. Присоединяйся!`;
      openBot(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
    };
    try {
      const r = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'share', eventId: event.id, initData: getInitData() }),
      });
      const j = await r.json().catch(() => ({}));
      if (j.ok) {
        haptic('success');
        tg.showAlert?.('Готово. Приглашение лежит в чате с ботом — перешли его другу 👆');
      } else {
        fallback();
      }
    } catch {
      fallback();
    } finally {
      setShareSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center md:p-4" id="event-detail-modal-root">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/90 backdrop-blur-md"
        id="detail-backdrop"
      />

      {/* Detail Card Panel */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 30 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 30 }}
        transition={{ type: 'spring', damping: 25, stiffness: 350 }}
        className="bg-[#121212] md:rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden relative z-10 md:border md:border-white/10 flex flex-col h-[100dvh] md:h-auto md:max-h-[90vh] text-white"
        id="detail-card-panel"
      >

        <button
          type="button"
          disabled={shareSending}
          onClick={() => { haptic('success'); void sendInvite(); }}
          className="absolute top-4 right-[4.25rem] z-30 p-2.5 rounded-full bg-black/60 border border-white/10 hover:border-brand/40 text-white/70 hover:text-[#E6FD3A] hover:scale-105 transition-all outline-none cursor-pointer disabled:opacity-60"
          title="Пригласить друга"
        >
          <UserPlus className="w-5 h-5" />
        </button>

        {/* Floating Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-30 p-2.5 rounded-full bg-black/60 border border-white/10 hover:border-brand/40 text-white/70 hover:text-[#E6FD3A] hover:scale-105 transition-all outline-none cursor-pointer"
          title="Закрыть"
          id="detail-close-btn"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Scrollable Container */}
        <div className="overflow-y-auto w-full flex-grow scrollbar-none" id="detail-scroll-container">
          
          {/* Cover Hero Banner — во всю ширину экрана, без рамок (пожелание владельца) */}
          <HeroGallery images={heroImages} title={event.title}>
            <div className="absolute bottom-5 left-4 right-4 sm:bottom-6 sm:left-6 sm:right-6 space-y-2">
              <span className={`
                px-3 py-1 rounded-full text-[10px] font-bold font-mono uppercase tracking-widest inline-flex items-center gap-1.5 bg-black/75 border
                ${event.type === 'male' ? 'border-indigo-500/30 text-indigo-300' :
                  event.type === 'mixed' ? 'border-brand/35 text-brand' :
                  event.type === 'intellectual' ? 'border-emerald-500/30 text-emerald-300' : 'border-rose-500/30 text-rose-300'}
              `}>
                <span className={`w-1.5 h-1.5 rounded-full ${
                  event.type === 'male' ? 'bg-indigo-400' :
                  event.type === 'mixed' ? 'bg-brand' :
                  event.type === 'intellectual' ? 'bg-emerald-400' : 'bg-rose-400'
                }`} />
                {event.type === 'male' ? 'Мужское Братство' :
                  event.type === 'mixed' ? 'Смешанный Круг' :
                  event.type === 'intellectual' ? 'Интеллектуальный Клуб' : 'Активный Выезд'}
              </span>

              {event.format && event.format !== 'offline' && (
                <span className="px-3 py-1 rounded-full text-[10px] font-bold font-mono uppercase tracking-widest inline-flex items-center gap-1.5 bg-black/75 border border-sky-500/30 text-sky-300 ml-2">
                  {event.format === 'online' ? <Monitor className="w-3 h-3" /> : <Wifi className="w-3 h-3" />}
                  {event.format === 'online' ? 'Онлайн' : 'Гибрид'}
                </span>
              )}

              {isLocked && (
                <span className="px-3 py-1 rounded-full text-[10px] font-bold font-mono uppercase tracking-widest inline-flex items-center gap-1.5 bg-black/75 border border-brand/40 text-brand ml-2">
                  <Lock className="w-3 h-3" /> Скоро • набор ещё не открыт
                </span>
              )}

              <h2 className="font-display font-black text-2xl sm:text-4xl uppercase tracking-tight italic text-white max-w-xl leading-none">
                {event.title}
              </h2>
            </div>

          {/* Кнопки «Фото» и «Видео» поверх обложки УБРАНЫ: обе открывали
              одно и то же окно, что и плитка «Снять» ниже. Три входа в одно
              действие — это не удобство, а шум поверх картинки события. */}

          {/* Маячок «событие в моменте» — пульсирующий индикатор LIVE, пока событие идёт.
              СЛЕВА, а не справа: справа в этом же углу висят крестик и «позвать
              друга», и маячок накрывался на них — на узком экране (а это в
              Telegram всегда узкий экран) кнопки просто не попадали в кадр. */}
          {isLiveNow && (
            <div className="absolute top-4 left-4 z-30 inline-flex items-center gap-1.5 rounded-full bg-brand px-3 py-1.5 shadow-lg shadow-brand/30">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-black opacity-60"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-black"></span>
              </span>
              <span className="text-[10px] font-black font-mono uppercase tracking-widest text-black">
                LIVE · в моменте
              </span>
            </div>
          )}
        </HeroGallery>

          {/* Промо-ролик события: реклама перед решением о регистрации.
              Видео проигрывается по клику (автоплей в вебвью Telegram блокируется),
              авто-подбор для грибной Нарочи гарантирует показ без правки базы. */}
          {promo && (
            <div className="rounded-2xl overflow-hidden border border-white/10 bg-black mt-2" id={`detail-promo-${event.id}`}>
              <video
                ref={(v) => { if (v) v.controls = promoActive; }}
                src={promo.src}
                playsInline
                poster={event.telegramImage || event.image}
                muted
                loop
                onClick={(e) => { const v = (e.target as HTMLVideoElement); if (v.paused) { v.play(); setPromoActive(true); } else { v.pause(); setPromoActive(false); } }}
                onPause={() => setPromoActive(false)}
                onPlay={() => setPromoActive(true)}
                onEnded={() => setPromoActive(false)}
                className="w-full aspect-video object-cover cursor-pointer"
              />
              <div className="px-3 py-2 bg-[#121212]/90 flex items-center gap-2">
                <span className={`text-brand text-[10px] font-mono uppercase tracking-widest ${promoActive ? 'opacity-90' : ''}`}>▶ {promo.label || 'Промо-ролик события'}</span>
              </div>
            </div>
          )}
{/* Быстрые действия события: маршрут (если задан) и live-галерея «Фото и видео».
              Показываем всегда, не только записавшимся, — маршбросок/выезд открывают
              маршрут заранее, а live-ленту смотрят все. */}
          <div className="px-4 sm:px-6 mt-1" id={`event-actions-${event.id}`}>
            {/* Бенто-сетка: три колонки одинаковых плиток вместо flex-wrap, где
                кнопки разной длины выстраивались рваной лесенкой и занимали
                три-четыре строки. Всё, ради чего человек открыл карточку,
                должно попадать в первый экран, а не уезжать под скролл. */}
            <div className="grid grid-cols-3 gap-2">
              {event.logistics?.routeUrl && !isChallenge && (
                <a
                  href={event.logistics.routeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-col items-center justify-center gap-1 bg-brand text-black text-[10px] font-black font-mono uppercase tracking-wider rounded-xl px-2 py-3 transition-all hover:bg-brand-hover shadow-lg shadow-brand/20 text-center leading-tight"
                >
                  <span className="text-base leading-none">📍</span>
                  {event.logistics.routeLabel || 'Маршрут'}
                </a>
              )}
              {/* Live-галерея события: существующая точка media_<id> в Mini App.
                  ДЛЯ ЧЕЛЛЕНДЖА скрываем: кружки участников — в ChallengeStories. */}
              {!isChallenge && (
              <a
                // Страница галереи требует подпись (g=…), без неё — 403. Подписанную
                // ссылку отдаёт media_list; пока её нет, плитка не кликабельна.
                href={galleryUrl || undefined}
                aria-disabled={!galleryUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-col items-center justify-center gap-1 text-[10px] font-black font-mono uppercase tracking-wider text-brand border border-brand/30 hover:bg-brand/10 rounded-xl px-2 py-3 transition-all text-center leading-tight"
              >
                <span className="text-base leading-none">📸</span>
                Галерея
                <span className="text-[9px] font-normal text-white/50 normal-case tracking-normal">
                  {!mediaCount
                    ? '…'
                    : mediaCount.photo + mediaCount.video === 0
                      ? 'пока пусто'
                      : [
                          mediaCount.photo ? `${mediaCount.photo} фото` : '',
                          mediaCount.video ? `${mediaCount.video} видео` : '',
                        ].filter(Boolean).join(' · ')}
                </span>
              </a>
              )}
              {/* Снять фото/видео ПРЯМО из карточки — не ждать всплывашки.
                  ДЛЯ ЧЕЛЛЕНДЖА скрываем: отчёты идут в чат, не в галерею.
                  Записанному — не главная: зелёный свет должен гореть на чате
                  события, ведь это главное действие после записи, а не галерея. */}
              {!isChallenge && !isRegistered && (
              <button
                type="button"
                onClick={() => setShowSnap(true)}
                className="flex flex-col items-center justify-center gap-1 text-[10px] font-black font-mono uppercase tracking-wider text-black bg-brand hover:bg-brand-hover rounded-xl px-2 py-3 transition-all shadow-lg shadow-brand/20 text-center leading-tight"
              >
                <span className="text-base leading-none">📷</span>
                Добавить
                <span className="text-[9px] font-normal text-black/60 normal-case tracking-normal">
                  снять или из галереи
                </span>
              </button>
              )}
              {!isChallenge && isRegistered && (
              <button
                type="button"
                onClick={() => setShowSnap(true)}
                className="flex flex-col items-center justify-center gap-1 text-[10px] font-black font-mono uppercase tracking-wider text-white/70 border border-white/15 hover:bg-white/10 rounded-xl px-2 py-3 transition-all text-center leading-tight"
              >
                <span className="text-base leading-none">📷</span>
                Добавить
                <span className="text-[9px] font-normal text-white/45 normal-case tracking-normal">
                  снять или из галереи
                </span>
              </button>
              )}
              {/* Чат события — ГЛАВНАЯ зелёная кнопка для всех, кто записан, и для
                  челленджа. Раньше зелёный свет горел на «Добавить фото», а
                  чат был серой: вроде и записался, а главное действие спрятано.
                  Записавшемуся чат — это первое, что нужно: в нём состав,
                  выезд и все вопросы. */}
              {isRealChatUrl(event.telegramBotUrl) && (
                <a
                  href={event.telegramBotUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`flex flex-col items-center justify-center gap-1 text-[10px] font-black font-mono uppercase tracking-wider rounded-xl px-2 py-3 transition-all text-center leading-tight ${
                    isChallenge || isRegistered
                      ? 'bg-brand text-black hover:bg-brand-hover shadow-lg shadow-brand/30'
                      : 'text-white/70 border border-white/15 hover:bg-white/10'
                  }`}
                >
                  <span className="text-base leading-none">💬</span>
                  Чат события
                  <span className={`text-[9px] font-normal normal-case tracking-normal ${
                    isChallenge || isRegistered ? 'text-black/60' : 'text-white/40'
                  }`}>
                    {isChallenge ? 'отправь кружок сюда' : 'вступить и написать'}
                  </span>
                </a>
              )}
              {/* Навигация по самой странице: событие длинное, и до программы,
                  подготовки или голосования люди просто не доскроливали.
                  Плитка показывается, только если за ней реально что-то есть —
                  ведущая в пустоту хуже отсутствующей. */}
              {Boolean((event.logistics as any)?.prep || event.locationDetails) && !isChallenge && (
                <button
                  type="button"
                  onClick={() => document.getElementById('sect-prep')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  className="flex flex-col items-center justify-center gap-1 text-[10px] font-black font-mono uppercase tracking-wider text-white/70 border border-white/15 hover:bg-white/10 rounded-xl px-2 py-3 transition-all text-center leading-tight"
                >
                  <span className="text-base leading-none">🎒</span>
                  Как готовиться
                </button>
              )}
              {needsCampingList && (
                <button
                  type="button"
                  onClick={() => document.getElementById('sect-gear')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  className="flex flex-col items-center justify-center gap-1 text-[10px] font-black font-mono uppercase tracking-wider text-white/70 border border-white/15 hover:bg-white/10 rounded-xl px-2 py-3 transition-all text-center leading-tight"
                >
                  <span className="text-base leading-none">🧰</span>
                  Что взять
                </button>
              )}
              {Boolean(event.programVoting?.enabled) && !isChallenge && (
                <button
                  type="button"
                  onClick={() => document.getElementById('sect-vote')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  className="flex flex-col items-center justify-center gap-1 text-[10px] font-black font-mono uppercase tracking-wider text-white/70 border border-white/15 hover:bg-white/10 rounded-xl px-2 py-3 transition-all text-center leading-tight"
                >
                  <span className="text-base leading-none">🗳</span>
                  Голосование
                </button>
              )}
              {isRegistered && (event.myBuddies?.length || 0) > 0 && !isChallenge && (
                <button
                  type="button"
                  onClick={() => document.getElementById('sect-my')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  className="flex flex-col items-center justify-center gap-1 text-[10px] font-black font-mono uppercase tracking-wider text-white/70 border border-white/15 hover:bg-white/10 rounded-xl px-2 py-3 transition-all text-center leading-tight"
                >
                  <span className="text-base leading-none">🤝</span>
                  Мой бади
                </button>
              )}
              {/* Снаряжение и задачи живут в кабинете, а нужны ровно здесь.
                  Открываем вкладку событием, без перезагрузки приложения.
                  ДЛЯ ЧЕЛЛЕНДЖА скрываем: там нет ни задач, ни снаряжения. */}
              {isRegistered && !isChallenge && (
                <button
                  type="button"
                  onClick={() => document.getElementById('sect-tasks')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  className="flex flex-col items-center justify-center gap-1 text-[10px] font-black font-mono uppercase tracking-wider text-white/70 border border-white/15 hover:bg-white/10 rounded-xl px-2 py-3 transition-all text-center leading-tight"
                >
                  <span className="text-base leading-none">📋</span>
                  Задачи
                </button>
              )}
              {isRegistered && !isChallenge && (
                <button
                  type="button"
                  onClick={() => { onClose(); window.dispatchEvent(new CustomEvent('openProfileTab', { detail: { tab: 'gear' } })); }}
                  className="flex flex-col items-center justify-center gap-1 text-[10px] font-black font-mono uppercase tracking-wider text-white/70 border border-white/15 hover:bg-white/10 rounded-xl px-2 py-3 transition-all text-center leading-tight"
                >
                  <span className="text-base leading-none">🎽</span>
                  Снаряжение
                </button>
              )}

              {/* Плитка «Бот» убрана: человек УЖЕ в приложении, и отправлять
                  его обратно в бота незачем — всё, ради чего он туда ходил,
                  теперь здесь. Бот остаётся каналом уведомлений. */}
            </div>
          </div>

          {/* Живая лента фото/видео события — каждый poll обновляется, как в сторис.
              Фото шлют в бота (media_upload), здесь они сразу появляются и сохраняются в истории.
              ДЛЯ ЧЕЛЛЕНДЖА НЕ ПОКАЗЫВАЕМ: кружки живут в Telegram (file_id), лента — в ChallengeStories. */}
          {!isChallenge && <LiveMedia eventId={event.id} live={isLiveNow} onLoaded={onMediaLoaded} />}

          {/* Grid of Essential Parameters. На мобильном узкие отступы — больше места контенту. */}
          <div className="p-4 sm:p-6 space-y-6">
            
            {/* Time / Price / Location Info Blocks */}
            {/* Две колонки и на телефоне: дата, место, условия и места — четыре
                плитки, которые должны читаться одним взглядом, а не занимать
                четыре экрана столбиком. Отступы и кегль поджаты под узкий
                экран. */}
            {/* Бенто: слева высокая плитка с датой, справа стопкой локация и
                состояние мест — они про одно решение («еду ли я»), и разносить
                их по разным углам было нелогично. Взнос и организатор — во всю
                ширину внизу: одна строка текста не должна занимать половину
                сетки и оставлять дыру рядом.
                grid-flow-dense досыпает узкие плитки в свободные клетки справа
                от даты, поэтому порядок в разметке менять не пришлось. */}
            {/* Бенто-параметры (дата/время, локация, взнос, места) — для
                челленджа скрываем: там нет ни локации, ни даты-времени-проведения,
                ни взноса. Вместо него — блок «Как засчитывается день» ниже. */}
            {!isChallenge && (
            <div className="grid grid-cols-2 grid-flow-row-dense gap-2.5 sm:gap-4 font-mono text-[11px] sm:text-xs items-stretch
                            [&>div]:p-3 sm:[&>div]:p-4 [&>div]:min-w-0 [&>div]:overflow-hidden
                            [&>div>div]:min-w-0 [&>div>div]:break-words [&>div]:gap-2 sm:[&>div]:gap-3">
              {/* Дата и локация стоят в одной колонке и тянутся друг под друга
                  (items-stretch): раньше стоял items-start, и плитка даты была
                  ниже верхнего края своей ячейки — под ней зияла пустота, а
                  локация уезжала вниз. Теперь обе ровно одной высоты. */}
              <div className="row-span-2 bg-white/5 border border-white/5 rounded-2xl p-4 flex gap-3 items-start">
                <Calendar className="w-5 h-5 text-brand shrink-0" />
                <div className="space-y-1">
                  <span className="text-white/40 uppercase text-[9px] tracking-wider block">ДАТА И ВРЕМЯ проведения</span>
                  <div className="text-white font-bold">{event.dateLabel}</div>
                  {event.time && !event.dateLabel.includes(event.time) && (
                    <div className="text-white/60 text-[10px]">{event.time}</div>
                  )}
                  {phase !== 'past' && (
                    <a
                      href={buildIcsDataUri(event, isRegistered)}
                      download={`flint-${event.id}.ics`}
                      onClick={() => haptic('success')}
                      className="inline-flex items-center gap-1 text-[10px] text-brand/80 hover:text-brand mt-1.5 font-mono uppercase tracking-wider transition-colors"
                      title="Добавить в календарь (.ics)"
                    >
                      <Calendar className="w-3 h-3" /> В календарь
                    </a>
                  )}
                </div>
              </div>

              {/* Кто ведёт событие — участник должен знать это до записи,
                  а не выяснять в переписке. */}
              {event.organizerName && (
                <div className="col-span-2 bg-white/5 border border-white/5 rounded-2xl p-3 flex gap-3 items-center">
                  <Avatar name={event.organizerName} src={event.organizerAvatar} size={48} ring="brand" />
                  <div className="min-w-0 flex-1 space-y-0.5 text-left">
                    <span className="text-white/40 uppercase text-[9px] tracking-wider block font-bold">Организатор события</span>
                    <div className="truncate text-white font-bold">{event.organizerName}</div>
                    <div className="text-white/50 text-[10px] leading-normal">Отвечает за выезд — вопросы ему или в чат события.</div>
                  </div>
                  {event.organizerUsername && (
                    <a
                      href={`https://t.me/${event.organizerUsername}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 rounded-full bg-brand px-3.5 py-2 text-[11px] font-black uppercase text-black no-underline"
                    >
                      Написать
                    </a>
                  )}
                </div>
              )}

              {isRegistered ? (
                <a
                  href={getYandexMapsUrl(event.location)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-white/5 border border-white/5 hover:border-[#E6FD3A]/40 hover:bg-white/10 rounded-2xl p-4 flex gap-3 items-start transition-all cursor-pointer group"
                  title="Поехать (Открыть в Яндекс Картах)"
                  id="location-yandex-link"
                >
                  <MapPin className="w-5 h-5 text-brand shrink-0 group-hover:scale-110 transition-transform" />
                  <div className="space-y-1 text-left">
                    <span className="text-[#E6FD3A] uppercase text-[9px] tracking-wider block font-bold flex items-center gap-1">
                      ЛОКАЦИЯ И СБОР • Яндекс Карты 🗺️
                    </span>
                    <div className="text-white font-bold group-hover:text-brand transition-colors underline decoration-brand/35">{event.location}</div>
                    {event.locationDetails && (
                      <div className="text-white/60 text-[10px] italic leading-normal">{event.locationDetails}</div>
                    )}
                  </div>
                </a>
              ) : (
                <div className="bg-white/5 border border-white/5 rounded-2xl p-4 flex gap-3 items-start opacity-60">
                  <Lock className="w-5 h-5 text-brand shrink-0" />
                  <div className="space-y-1 text-left">
                    <span className="text-white/40 uppercase text-[9px] tracking-wider block font-bold">
                      РАЙОН · точка сбора скрыта 🔒
                    </span>
                    {event.location && (
                      <div className="text-white/70 text-xs font-bold">{event.location}</div>
                    )}
                    {/* Время выезда показываем ДО записи: «во сколько выезд?» —
                        вопрос, на который человек решает, идти ли вообще. Само
                        место сбора остаётся закрытым. */}
                    {event.logistics?.departureTime && (
                      <div className="text-white/70 text-[11px] font-mono">🕗 Выезд в {event.logistics.departureTime}</div>
                    )}
                    <div className="text-white/50 text-[10px] italic">
                      Точное место сбора и карта откроются после подтверждения участия
                    </div>
                  </div>
                </div>
              )}

              {/* Условия участия (взнос) — УЗКОЙ ПОЛОСОЙ на всю ширину, а не плиткой в
                  две строки. Раньше он занимал столько же места, сколько
                  состояние мест, хотя внутри — одна строка; из-за этого в сетке
                  зияла дыра и карточка уезжала вниз. */}
              <div className="col-span-2 bg-white/5 border border-white/5 rounded-2xl px-3 py-2.5 flex items-center gap-2.5">
                <Tag className="w-4 h-4 text-brand shrink-0" />
                <DynamicPrice event={event} />
              </div>

              <div className="bg-white/5 border border-white/5 rounded-2xl p-4 flex gap-3 items-start">
                <Users className="w-5 h-5 text-brand shrink-0" />
                <div className="space-y-2 w-full">
                  <span className="text-white/40 uppercase text-[9px] tracking-wider block">СОСТОЯНИЕ МЕСТ</span>

                  {/* Smart Hype: мотивирующий текст при малом числе участников */}
                  {totalRegistered < 3 ? (
                    <div className="space-y-1">
                      <p className="text-brand text-xs font-bold leading-snug">🔥 Будь первым — костяк уже едет</p>
                      <p className="text-white/50 text-[10px]">Запись открыта · {maxSpots} мест · присоединяйся к первым</p>
                    </div>
                  ) : (
                    <div className="text-white font-bold flex justify-between items-center gap-1 w-full min-w-0">
                      <span className="truncate">{totalRegistered} из {maxSpots}</span>
                      <span className={`font-mono text-[10px] ${percentFull >= 80 ? 'text-red-400' : percentFull >= 50 ? 'text-amber-400' : 'text-brand'}`}>
                        {percentFull}%
                      </span>
                    </div>
                  )}

                  {/* ASCII-полоса [██████░░░░] убрана: десять блоков со скобками
                      не влезают в половину ширины телефона и разрывали плитку —
                      «состояние мест» вылезало за карточку. Тонкий бар ниже
                      показывает ровно то же, цифры остались текстом. */}

                  {/* Тонкий визуальный бар */}
                  <div className="w-full bg-white/10 h-1 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${percentFull >= 80 ? 'bg-red-400' : percentFull >= 50 ? 'bg-amber-400' : 'bg-[#E6FD3A]'}`}
                      style={{ width: `${Math.max(totalRegistered > 0 ? 4 : 0, percentFull)}%` }}
                    />
                  </div>

                  {/* Срочность при высокой заполненности */}
                  {percentFull >= 80 && !spotsFull && (
                    <p className="text-red-400 text-[10px] font-mono">
                      ⚡ Осталось {spotsRemaining} {spotsRemaining === 1 ? 'место' : spotsRemaining < 5 ? 'места' : 'мест'} — торопись
                    </p>
                  )}
                </div>
              </div>
            </div>
            )}

            {/* ПРИЗЫВ ВСТУПИТЬ В ЧАТ — сразу после записи.
                Человек только что записался и смотрит карточку; чат события в
                этот момент важнее карты: там состав, выезд и все вопросы.
                Блок висит, пока человек не нажмёт «Вступил» или не вступит сам,
                поэтому предложение не теряется среди прочего. */}
            {isRegistered && isRealChatUrl(event.telegramBotUrl) && !chatJoined && (
              <div className="rounded-2xl border border-brand/40 bg-brand/10 p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <span className="w-9 h-9 rounded-xl bg-brand text-black flex items-center justify-center text-lg shrink-0">💬</span>
                  <div className="min-w-0">
                    <b className="block text-sm text-white">Вступи в чат события</b>
                    <span className="text-[11px] text-white/65 leading-snug">
                      Там состав, точка и время выезда, задачи и все вопросы по выезду.
                      Без чата организатор не достанет тебя в день события.
                    </span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <a
                    href={event.telegramBotUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 rounded-xl bg-brand text-black py-3 text-xs font-black uppercase tracking-wider text-center no-underline"
                    onClick={(e: React.MouseEvent<HTMLAnchorElement>) => {
                      // Внутри Telegram обычная ссылка открылась бы СИСТЕМНЫМ
                      // браузером поверх приложения: вернуться в чат события
                      // было бы уже нечем. openBot внутри мессенджера открывает
                      // инвайт во встроенном окне и оставляет нас на месте.
                      e.preventDefault();
                      openBot(String(event.telegramBotUrl || ''));
                      markChatJoined();
                      haptic('success');
                    }}
                  >
                    Вступить в чат
                  </a>
                  <button
                    type="button"
                    onClick={() => { markChatJoined(); haptic('success'); }}
                    className="rounded-xl border border-white/15 px-3 text-[11px] font-bold text-white/60 hover:text-white transition-colors cursor-pointer"
                  >
                    Уже в чате
                  </button>
                </div>
              </div>
            )}

            <div id="sect-my" className="scroll-mt-4" />
            {/* Твоё участие: где и во сколько выезд — записавшимся.
                Дословная жалоба: «Я уже вроде записалась. Как мне теперь
                найти, с кем я, где и во сколько выезд?». Точка сбора и время
                лежали в logistics, редактировались в админке и уходили в бота,
                но в карточке на сайте не показывались НИКОГДА.
                ДЛЯ ЧЕЛЛЕНДЖА скрываем: нет ни сбора, ни выезда, ни точки. */}
            {isRegistered && !isChallenge && (
              <div className="bg-brand/5 border border-brand/20 rounded-2xl p-4 space-y-3">
                <span className="text-brand uppercase text-[9px] tracking-wider font-bold flex items-center gap-2">
                  <Check className="w-4 h-4" /> Твоё участие
                </span>

                {/* Карта точки — только записавшимся: место видят участники.
                    У челленджа точки нет: каждый встаёт у себя дома. */}
                {event.format !== 'online' && !isChallenge && (
                  <YandexMapBlock lat={event.coordinates?.lat || Number(extractCoords(event.location || '')?.lat) || undefined} lng={event.coordinates?.lng || Number(extractCoords(event.location || '')?.lon) || undefined} place={prettyPlace(event.location)} />
                )}

                {/* Кнопка «Позвать своих» убрана: то же действие уже живёт
                    иконкой у крестика наверху. Две кнопки под одно действие на
                    одной странице — это не забота, а сомнение в том, что
                    первая работает. */}

                {event.logistics?.assemblyPoint ? (
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1 min-w-0">
                      <span className="text-white/40 uppercase text-[9px] tracking-wider block">Точка сбора</span>
                      <div className="text-white font-bold text-sm break-words">
                        {prettyPlace(event.logistics.assemblyPoint)}
                      </div>
                      <div className="text-white/60 text-[11px] font-mono">
                        {/* Сбор и выезд — разное время: на Нарочи сбор 06:00,
                            выезд 07:00. Показываем оба, если сбор задан. */}
                        {event.logistics.gatherTime && `Сбор в ${event.logistics.gatherTime} · `}
                        Выезд в {event.logistics.departureTime || event.time || 'уточняется'}
                      </div>
                    </div>
                    <a
                      href={getYandexMapsUrl(event.logistics.assemblyPoint)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] font-black font-mono uppercase tracking-wider text-brand border border-brand/30 hover:bg-brand/10 rounded-xl px-3 py-2 transition-all shrink-0"
                    >
                      🧭 Маршрут
                    </a>
                  </div>
                ) : (
                  <p className="text-white/50 text-[11px] leading-snug">
                    Точку сбора организатор ещё не назначил — она придёт в бот и появится здесь.
                  </p>
                )}

                {/* За кого я отвечаю: бади. Правило человек принимает на входе
                    в клуб, но напарника до сих пор негде было посмотреть — он
                    приходил одним сообщением в бот и терялся в переписке.
                    Связку собирает сервер: от 5 записавшихся, нечётный третий
                    подсаживается в пару (см. миграцию 2026-09-25-buddy-pairs). */}
                {(event.myBuddies?.length ?? 0) > 0 && (
                  <div className="border-t border-white/10 pt-3 space-y-1.5">
                    <span className="text-white/40 uppercase text-[9px] tracking-wider block">
                      {event.myBuddies!.length > 1 ? 'Твои бади' : 'Твой бади'}
                    </span>
                    <div className="flex flex-wrap gap-3">
                      {event.myBuddies!.map((b, i) => {
                        const inner = (
                          <>
                            <Avatar name={b.name} src={b.avatar} size={40} />
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-bold text-white">{b.name}</span>
                              {b.username && <span className="block text-[11px] text-brand">написать @{b.username}</span>}
                            </span>
                          </>
                        );
                        return b.username ? (
                          <a
                            key={`${b.name}-${i}`}
                            href={`https://t.me/${b.username}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2.5 rounded-full bg-white/5 border border-white/10 py-1 pl-1 pr-4 no-underline"
                          >
                            {inner}
                          </a>
                        ) : (
                          <span key={`${b.name}-${i}`} className="flex items-center gap-2.5 rounded-full bg-white/5 border border-white/10 py-1 pl-1 pr-4">
                            {inner}
                          </span>
                        );
                      })}
                    </div>
                    <p className="text-white/60 text-[11px] leading-snug">
                      Держите друг друга в поле зрения от сбора до разъезда. Пропал, заболел,
                      стало плохо — ты первый, кто это заметит и скажет организатору. Спрос с обоих.
                    </p>
                  </div>
                )}

                {/* С кем я еду: машина, попутчики, контакт водителя. */}
                {event.myRide ? (
                  <div className="border-t border-white/10 pt-3 space-y-1.5">
                    <span className="text-white/40 uppercase text-[9px] tracking-wider block">
                      {event.myRide.role === 'driver' ? 'Ты за рулём' : 'Едешь в машине'}
                    </span>
                    {event.myRide.role === 'driver' ? (
                      <div className="text-white text-sm font-bold">
                        {event.myRide.seatsTotal > 0
                          ? `Мест ${event.myRide.seatsTotal}, занято ${event.myRide.seatsTaken}`
                          : 'Едешь своим ходом, свободных мест нет'}
                      </div>
                    ) : (
                      <div className="text-white text-sm font-bold">
                        Водитель: {event.myRide.driverName}
                        {event.myRide.driverUsername ? ` · @${event.myRide.driverUsername}` : ''}
                      </div>
                    )}
                    {event.myRide.role === 'passenger' && event.myRide.driverPhone && (
                      <a href={`tel:${event.myRide.driverPhone}`} className="text-brand text-[11px] font-mono underline">
                        📞 {event.myRide.driverPhone}
                      </a>
                    )}
                    {event.myRide.passengers.length > 0 && (
                      <div className="text-white/70 text-[11px]">
                        Попутчики: {event.myRide.passengers.join(', ')}
                      </div>
                    )}
                    {event.myRide.fromPoint && (
                      <div className="text-white/60 text-[11px] font-mono flex flex-wrap items-center gap-2">
                        <span>🚗 Старт: {prettyPlace(event.myRide.fromPoint)}</span>
                        <a
                          href={getYandexMapsUrl(event.myRide.fromPoint)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-brand underline"
                        >
                          маршрут
                        </a>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="border-t border-white/10 pt-3">
                    <p className="text-white/50 text-[11px] leading-snug">
                      Машина не выбрана. Попутки и свободные места — в боте, кнопка ниже.
                    </p>
                  </div>
                )}

                {(event.logistics?.returnInfo || event.logistics?.fuelCost || event.logistics?.notes) && (
                  <div className="border-t border-white/10 pt-3 space-y-1.5">
                    {event.logistics?.returnInfo && (
                      <div className="text-white/70 text-[11px]">🔙 Обратно: {event.logistics.returnInfo}</div>
                    )}
                    {!!event.logistics?.fuelCost && (
                      <div className="text-white/70 text-[11px]">⛽ Бензин: ~{event.logistics.fuelCost} Br с человека</div>
                    )}
                    {event.logistics?.notes && (
                      <div className="text-white/60 text-[11px] leading-snug whitespace-pre-line">{event.logistics.notes}</div>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap gap-2 pt-1">
                  {isRealChatUrl(event.telegramBotUrl) && (
                    <a
                      href={event.telegramBotUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] font-black font-mono uppercase tracking-wider bg-brand text-black rounded-xl px-3 py-2 transition-all"
                    >
                      💬 Чат события
                    </a>
                  )}
                  <a
                    href={`https://t.me/campsflint_bot?start=event_${event.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] font-black font-mono uppercase tracking-wider text-white/70 border border-white/15 hover:bg-white/10 rounded-xl px-3 py-2 transition-all"
                  >
                    🤖 Открыть в боте
                  </a>
                </div>
              </div>
            )}

            {/* Задачи события: кто что делает и к какому сроку — всем записавшимся. */}
            {isRegistered && !isChallenge && <EventTasks eventId={event.id} />}

            {/* ЧЕЛЛЕНДЖ: правила и чек-лист дня. Задачи, машины и палатки у
                марафона отсутствуют — вместо них человеку нужно ровно одно:
                понять, что именно считается «днём засчитан» и как это
                отправить. Правило «видео-кружок в чат» спрятано в переписке,
                и новичок про него не догадывается. */}
            {isChallenge && (
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/[.06] p-5 space-y-3">
                <span className="flex items-center gap-2 font-mono text-[10px] font-black uppercase tracking-widest text-amber-300">
                  <Clock className="w-3.5 h-3.5" /> Как засчитывается день
                </span>
                {/* ТРИ СПОСОБА, а не три абзаца правил. Человек ленивый: он
                    не читает условия, он их сканирует. Раньше здесь был текст
                    на 15 строк, из которого новичок выходил с мыслью «надо
                    разобраться» — и не отмечался. Теперь видно три плитки,
                    и любую из них можно сделать молча. */}
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { icon: '🎥', t: 'Кружок', d: 'Видео с телефона' },
                    { icon: '📷', t: 'Фото', d: 'Одно фото' },
                    { icon: '💬', t: 'Слово', d: 'Текстом в чат' },
                  ].map((s) => (
                    <div key={s.t} className="rounded-xl border border-amber-400/25 bg-black/30 p-2.5 text-center">
                      <div className="text-2xl leading-none">{s.icon}</div>
                      <b className="block text-[12px] text-white mt-1.5">{s.t}</b>
                      <span className="block text-[9px] leading-3 text-white/45 mt-0.5">{s.d}</span>
                    </div>
                  ))}
                </div>
                <p className="text-[12px] leading-5 text-white/70">
                  Сделал что-то для себя — и <b className="text-white">отправь это в чат</b>.
                  Бот засчитает день сам. Видео не обязано быть красивым.
                </p>
                {/* ЗАЧЕМ. Раньше этого не было нигде, и человек честно спрашивал
                    «а время подъёма реально не важно?» — потому что заголовок
                    обещал подъём, а правила про движение. Ответ должен лежать
                    на карточке, а не в переписке. */}
                <p className="rounded-xl bg-black/30 border border-amber-400/20 px-3 py-2.5 text-[12px] leading-5 text-white/70">
                  <b className="text-amber-300">Зачем это.</b> Не чтобы встать
                  раньше мира. Чтобы 90 дней подряд сделать хотя бы одно движение
                  для себя — и не разорвать серию. Утро, вечер, спортзал или
                  просто растяжка: время не важно, важен факт.
                </p>
                {/* ОДНА большая кнопка сразу под плитками. Человек ленивый:
                    он не дочитывает блок до конца, он ищет, куда нажать.
                    Кнопка стоит ровно там, где заканчивается объяснение. */}
                {isRealChatUrl(event.telegramBotUrl) ? (
                  <button
                    type="button"
                    onClick={() => { haptic('success'); openBot(String(event.telegramBotUrl || '')); }}
                    className="w-full rounded-xl bg-amber-400 text-black py-3.5 text-xs font-black uppercase tracking-widest cursor-pointer border-none flex items-center justify-center gap-2"
                  >
                    ✊ Отметить день
                    <Send className="w-4 h-4" />
                  </button>
                ) : (
                  <p className="rounded-xl border border-amber-400/20 px-3 py-2.5 text-[11px] leading-4 text-white/55">
                    Чат челленджа ещё не создан — спроси организатора, куда скидывать отчёт.
                  </p>
                )}
                <p className="border-t border-white/10 pt-3 text-[11px] leading-5 text-white/50">
                  Пропустил день — серия обнуляется, но день из истории не исчезает. Ценно не «идеально», а то, что ты возвращаешься завтра.
                </p>
              </div>
            )}

            {/* ЛЕНТА СТОРИС: кружки участников, как в Instagram. Тап по
                аватару → полноэкранный просмотр. Источник — file_id из Telegram,
                в Supabase сами видео не храним. */}
            {isChallenge && (
              <ChallengeStories
                event={event}
                focus={storyFocus}
                onCloseFocus={() => setStoryFocus(null)}
              />
            )}

            {/* ТАБЛИЦА ПРОГРЕССА: аватар + полоса из 92 точек по месяцам.
                Тап по залитой точке → сторис этого дня. */}
            {isChallenge && (
              <ChallengeProgress
                event={event}
                onOpenStory={(telegramId, date) => setStoryFocus({ telegramId, date })}
              />
            )}

            {/* Поступки события: «кто что сделал». Организатор подтверждает —
                только тогда эпизод идёт в репутацию и приносит баллы. Кому что
               visible, решает сервер: участник видит лишь свои подтверждённые.
               ДЛЯ ЧЕЛЛЕНДЖА скрываем: там прогресс идёт по дням (ChallengeProgress). */}
            {!isChallenge && (isRegistered || isClubMember) && <EventContributions eventId={event.id} />}

            {/* Программа подня́та выше логистики: человек сначала решает,
                идёт ли он на ЭТО, и только потом — как добираться. Раньше
                она лежала под составом и описанием, и до неё доскроливали
                не все. */}
            {/* Программа по времени — для челленджа скрываем: там не программа,
                а условия «как засчитывается день» (блок ниже). */}
            {!isChallenge && guide.program.length > 0 && (
              <div className="bg-white/5 border border-white/10 p-4 rounded-2xl space-y-3">
                <span className="text-brand text-[10px] tracking-widest font-mono block uppercase font-bold flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5" /> Программа
                </span>
                {(() => {
                  // Группируем программу по дню: «День N» или дата в начале строки
                  // становится заголовком-разделителем, а под ним идут только время и
                  // активность — без повтора даты в каждой строке (дерево по часам).
                  // Заголовок дня в начале строки: «День N», «Day N», «N день»,
                  // дата «12.07», дата с месяцем «17 июля», день недели «Суббота».
                  const dayRe = /^\s*(День\s*\d+|Day\s*\d+|\d{1,2}\s*день\w*|\d{1,2}[.\/]\d{1,2}(?:[.\/]\d{2,4})?|\d{1,2}\s+(?:янв|фев|мар|апр|ма[йя]|июн|июл|авг|сен|окт|ноя|дек)[а-я]*|понедельник|вторник|сред[аы]|четверг|пятниц[аы]|суббот[аы]|воскресень[ея])(?=[\s)\].,:–—-]|$)\s*[)\].,:–—-]*\s*/i;
                  const groups: { day: string | null; items: string[] }[] = [];
                  for (const raw of guide.program) {
                    const m = raw.match(dayRe);
                    const day = m ? m[1].trim() : null;
                    const rest = (m ? raw.slice(m[0].length) : raw).trim();
                    const last = groups[groups.length - 1];
                    if (day && (!last || last.day !== day)) groups.push({ day, items: rest ? [rest] : [] });
                    else if (last) { if (rest) last.items.push(rest); }
                    else groups.push({ day, items: rest ? [rest] : [] });
                  }
                  const hasDays = groups.some((g) => g.day);
                  if (!hasDays) {
                    return (
                      <ol className="space-y-2">
                        {guide.program.map((step, i) => (
                          <li key={i} className="flex gap-3 text-xs text-white/80">
                            <span className="shrink-0 w-5 h-5 rounded-full bg-brand/15 text-brand font-bold flex items-center justify-center text-[10px]">{i + 1}</span>
                            <span className="leading-relaxed pt-0.5">{step}</span>
                          </li>
                        ))}
                      </ol>
                    );
                  }
                  return (
                    <div className="space-y-3">
                      {groups.map((g, gi) => (
                        <div key={gi} className="space-y-1.5">
                          {g.day && (
                            <div className="text-brand text-[11px] font-bold uppercase tracking-wide flex items-center gap-2">
                              <span className="w-1.5 h-1.5 rounded-full bg-brand" />{g.day}
                            </div>
                          )}
                          <ul className="space-y-1.5 border-l border-white/10 ml-[3px] pl-3">
                            {g.items.map((it, ii) => {
                              const tm = it.match(/^(\d{1,2}[:.]\d{2})\s*[–—-]?\s*/);
                              const time = tm ? tm[1] : '';
                              const text = tm ? it.slice(tm[0].length) : it;
                              return (
                                <li key={ii} className="flex gap-2 text-xs text-white/80">
                                  {time && <span className="shrink-0 font-mono text-brand/90 text-[11px] pt-0.5 w-11">{time}</span>}
                                  <span className="leading-relaxed pt-0.5">{text}</span>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Логистика прямо здесь: машины, места, палатки, попутки.
                Раньше карточка отправляла за этим в бота — там каждая машина
                отдельным сообщением, и число свободных мест устаревало сразу
                после отправки. Теперь состояние живое, а бот только зовёт. */}
            {/* Логистика — инструмент того, кто уже едет: машины, брони, попутки.
                Незаписавшемуся она не нужна и только отвлекает от решения,
                идёт он или нет. */}
            {/* Логистика (машины, попутчики, сборы) у челленджа бессмысленна:
                никто никуда не едет — люди встают у себя дома, в разных
                городах. Блок только сбивал бы с толку. */}
            {isRegistered && !isChallenge && <LogisticsPanel eventId={event.id} isRegistered={isRegistered} />}

            {/* Правила круга: короткое напоминание вместо восьми экранов кодекса.
                На место убранного «Дома Личности» встаёт то, что на выезде
                действительно решает споры. */}
            <EventRules />

            {/* Кто уже едет: состав, а не только цифра.
                Для челленджа скрываем: состав по дням виден в ChallengeProgress. */}
            {!isChallenge && roster.length > 0 && (
              <div className="bg-white/5 border border-white/5 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-white/40 uppercase text-[9px] tracking-wider flex items-center gap-2">
                    <Users className="w-4 h-4 text-brand" /> Кто уже едет
                  </span>
                  <span className="font-mono text-[10px] text-white/50">
                    {rosterMale > 0 && `♂ ${rosterMale}`}
                    {rosterMale > 0 && rosterFemale > 0 && ' · '}
                    {rosterFemale > 0 && `♀ ${rosterFemale}`}
                  </span>
                </div>
                {/* Кружки с фото из Telegram: людей узнают в лицо, а не по букве.
                    Кольцо бренда — костяк, «+N» — гости, которых человек везёт. */}
                <div className="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-x-2 gap-y-3">
                  {roster.map((p, i) => (
                    <div key={`${p.name}-${i}`} className="flex flex-col items-center gap-1.5 min-w-0">
                      <span className="relative">
                        <Avatar name={p.name} src={p.avatar} size={48} ring={p.isCore ? 'brand' : 'none'} />
                        {!!p.guests && (
                          <span className="absolute -bottom-1 -right-1 rounded-full bg-white text-black text-[9px] font-black px-1.5 py-0.5 leading-none">
                            +{p.guests}
                          </span>
                        )}
                      </span>
                      <span className="w-full truncate text-center text-[11px] font-bold text-white/85">{p.name}</span>
                    </div>
                  ))}
                </div>
                <p className="text-white/30 text-[9px] font-mono">Состав видят только участники клуба</p>
              </div>
            )}

            {/* Погода на даты (open-meteo) — для челленджа скрываем: он офлайн,
                по всему миру, погода не влияет на результат. */}
            {!isChallenge && <WeatherBlock event={event} />}

            {/* «Под вопросом» — честно предупреждаем до того, как человек запишется */}
            {event.statusReason && (
              <div className="bg-amber-500/10 border border-amber-500/30 p-4 rounded-2xl" id={`detail-at-risk-${event.id}`}>
                <p className="text-amber-300 text-[10px] font-mono uppercase tracking-widest mb-1">⚠️ Мероприятие под вопросом</p>
                <p className="text-xs text-white/85 leading-relaxed">{event.statusReason}</p>
                {event.decisionDeadline && (
                  <p className="text-[10px] text-white/50 mt-1 font-mono">Решение до {event.decisionDeadline}</p>
                )}
              </div>
            )}

            {/* Pain Point Solution Panel (PAIN) */}
            <div className="bg-white/5 border border-white/10 p-4.5 rounded-2xl flex items-start gap-3.5" id={`detail-pain-block-${event.id}`}>
              <div className="bg-[#E6FD3A]/10 border border-[#E6FD3A]/30 text-brand font-black text-[9px] px-2 py-0.5 rounded uppercase font-mono tracking-widest shrink-0 mt-0.5">
                ЗАПРОС
              </div>
              <div className="space-y-1">
                <span className="text-white/40 text-[9px] tracking-wider font-mono block uppercase">Решаемая проблема</span>
                <p className="italic font-sans text-xs sm:text-sm text-white/85 leading-relaxed">
                  « {event.painPoint} »
                </p>
              </div>
            </div>

            {/* Comprehensive Description — для челленджа скрываем: там условия,
                а не сценарий (блок «Как засчитывается день» выше). */}
            {!isChallenge && (
            <div className="space-y-2">
              <span className="text-white/40 text-[10px] tracking-widest font-mono block uppercase">ПОДРОБНЫЙ СЦЕНАРИЙ И СМЫСЛ ВСТРЕЧИ</span>
              <p className="font-sans text-sm text-white/80 leading-relaxed whitespace-pre-wrap">
                {event.description}
              </p>
            </div>
            )}

            <ClubValueBlock event={event} />
            {clubValue(event.logistics) && <MyTicketCard eventId={event.id} />}
            <IncludedBlock included={extras.included || []} notIncluded={extras.notIncluded || []} />
            <TripBlock trip={extras.trip} />
            {/* Общее снаряжение: кто что везёт — видно всем, распределяет бот. */}
            <WhoBrings needs={extras.needs || []} people={roster} />
            {extras.costNote && (
              <div className="rounded-2xl border border-white/10 bg-white/[.03] p-4">
                <span className="block text-[10px] font-mono uppercase tracking-widest text-white/40">💳 Как с деньгами</span>
                <p className="mt-1 text-sm text-white/80">{extras.costNote}</p>
              </div>
            )}

            <div id="sect-gear" className="scroll-mt-4" />
            {/* Что взять с собой. Для онлайн-события блок бессмысленен: человек
                дома, брать с собой нечего — и чек-лист кемпинга тем более. */}
            {needsCampingList && (
            <div className="bg-white/5 border border-white/10 p-4 rounded-2xl space-y-2.5">
              <span className="text-brand text-[10px] tracking-widest font-mono block uppercase font-bold flex items-center gap-2">
                <Check className="w-3.5 h-3.5" /> Что взять с собой
              </span>
              <div className="flex flex-wrap gap-2">
                {guide.bring.map((item, i) => (
                  <span key={i} className="text-[11px] text-white/80 bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5">
                    {item}
                  </span>
                ))}
              </div>
              <p className="text-[9px] text-white/40 font-mono uppercase tracking-wider pt-1">По-дружески и по желанию — без обязаловки. Главное: 100% трезвость и открытость.</p>
              {/* Полный чек-лист клуба: список выше — короткая выжимка под
                  конкретное событие, а собираться люди хотят по полному. */}
              <button
                type="button"
                onClick={() => setShowChecklist((v) => !v)}
                className="w-full flex items-center justify-center gap-1.5 py-2.5 mt-1 rounded-xl bg-brand/10 hover:bg-brand/20 border border-brand/25 text-brand text-[10px] font-mono uppercase tracking-widest cursor-pointer"
              >
                <Backpack className="w-3.5 h-3.5" />
                {showChecklist ? 'Скрыть полный чек-лист' : 'Полный чек-лист для кемпинга'}
              </button>
            </div>
            )}

            {needsCampingList && showChecklist && (
              <div className="bg-white/[0.03] border border-white/10 p-3 rounded-2xl">
                <CampingChecklist defaultOpen />
              </div>
            )}

            {/* Мед-показания — рядом с порогом входа и ДО кнопки записи:
                человеку с противопоказанием нужно увидеть их раньше, чем он
                решит участвовать, а не в памятке после регистрации. */}
            {medicalNote && (
              <div className="bg-rose-500/5 border border-rose-500/20 p-4 rounded-2xl flex gap-3.5 items-start">
                <HeartPulse className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <span className="text-rose-400 text-[10px] tracking-wider font-mono block uppercase font-bold">Кому нельзя / с чем осторожно</span>
                  <p className="text-xs text-white/80 leading-relaxed font-sans whitespace-pre-wrap">{medicalNote}</p>
                </div>
              </div>
            )}

            {/* Условия, меняющие ожидания: телефон и связь планируют заранее. */}
            {(isDetox || isNoSignal) && (
              <div className="flex flex-wrap gap-2">
                {isDetox && (
                  <span className="text-[11px] text-amber-200 bg-amber-500/10 border border-amber-500/25 rounded-xl px-3 py-2">
                    📵 Цифровой детокс — событие без телефонов
                  </span>
                )}
                {isNoSignal && (
                  <span className="text-[11px] text-amber-200 bg-amber-500/10 border border-amber-500/25 rounded-xl px-3 py-2">
                    📡 Связи и интернета на месте почти нет — предупреди близких
                  </span>
                )}
              </div>
            )}

            {/* Hard Entry Threshold */}
            <div className="bg-rose-500/5 border border-rose-500/20 p-4 rounded-2xl flex gap-3.5 items-start">
              <ShieldCheck className="w-5 h-5 text-rose-450 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <span className="text-rose-400 text-[10px] tracking-wider font-mono block uppercase font-bold">Правила прохода & Порог входа</span>
                <p className="text-xs text-white/80 leading-relaxed font-sans font-medium">
                  {event.entryThreshold}
                </p>
              </div>
            </div>

            <div id="sect-prep" className="scroll-mt-4" />
            {/* Detailed Rules & Preparation — только зарегистрированным (гейтинг локации) */}
            {isRegistered && event.locationDetails && (
              <div className="bg-white/5 border border-white/10 p-4 rounded-2xl space-y-2">
                <span className="text-white/40 text-[10px] tracking-widest font-mono block uppercase">Подробные правила и подготовка</span>
                <p className="text-xs text-white/70 leading-relaxed font-sans">
                  {event.locationDetails}
                </p>
              </div>
            )}

            <FaqBlock faq={extras.faq || []} />

            <div id="sect-vote" className="scroll-mt-4" />
            {/* Program Voting */}
            <ProgramVoting
              event={event}
              onVote={async (eventId, option) => {
                const res = await submitVote(eventId, option);
                haptic(res.ok ? 'success' : 'error');
                return res;
              }}
            />

            {/* Манифест «Дома Личности» со страницы события УБРАН.
                Владелец: «это не ценная информация этого мероприятия, и так все
                знают». Шесть векторов — про клуб в целом, а не про конкретный
                выезд: они занимали пол-экрана перед кнопкой записи и оттесняли
                вниз то, ради чего человек открыл карточку — программу, состав и
                логистику. Манифест живёт в разделе «Манифест Сообщества». */}

          </div>
        </div>

        {/* Нижняя панель — только там, где у человека есть ГЛАВНОЕ действие:
            записаться, отметить интерес к закрытому набору, оставить отзыв.
            У записанного действия нет: панель держала полосу экрана ради
            надписи «участие подтверждено» и двух ссылок, которые теперь живут
            плитками наверху. Сам факт записи виден в блоке «Твоё участие». */}
        {/* ГЛАВНОЕ ДЕЙСТВИЕ ЗАПИСАННОГО — внизу, под большим пальцем.
            Раньше у записанного нижней панели не было вовсе, а «Чат события» и
            отчёт челленджа жили плитками в шапке: до них приходилось тянуться
            через весь экран. В челлендже главное — отчитаться за сегодня. */}
        {isRegistered && phase !== 'past' && !isLocked && (
          <div className="border-t border-white/10 bg-[#161616] pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <div className="p-3 sm:p-4 pb-1.5 sm:pb-2 flex gap-2.5">
            {isChallenge ? (
              isRealChatUrl(event.telegramBotUrl) ? (
                <a
                  href={event.telegramBotUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => haptic('success')}
                  className="flex-1 flex items-center justify-center gap-3 rounded-2xl bg-brand py-3.5 text-black shadow-lg shadow-brand/20 no-underline"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black text-brand text-2xl font-black leading-none">+</span>
                  <span className="text-left leading-tight">
                    <span className="block text-[15px] font-black uppercase">Отчёт за сегодня</span>
                    <span className="block text-[12px] text-black/60">кружок, фото или текст в чат</span>
                  </span>
                </a>
              ) : null
            ) : (
              <>
                {isRealChatUrl(event.telegramBotUrl) && (
                  <a
                    href={event.telegramBotUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-[2] flex items-center justify-center gap-2 rounded-2xl bg-brand py-3.5 text-[14px] font-black uppercase text-black no-underline shadow-lg shadow-brand/20"
                  >
                    💬 Чат события
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setShowSnap(true)}
                  className="flex-1 flex items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/5 py-3.5 text-[14px] font-bold text-white cursor-pointer"
                >
                  📷 Кадры
                </button>
              </>
            )}
          </div>
          {/* Отказ — тихой ссылкой, не кнопкой рядом с главным действием: случайно
              не нажмёшь, но и искать не придётся. Организатор узнает лично. */}
          <button
            type="button"
            onClick={() => {
              const q = isChallenge ? 'Выйти из челленджа? Твоя серия сохранится в истории.' : 'Точно не сможешь? Организатор получит уведомление, место освободится.';
              if (!window.confirm(q)) return;
              haptic('warning');
              window.dispatchEvent(new CustomEvent('cancelRegistration', { detail: { eventId: event.id } }));
              onClose();
            }}
            className="mx-auto block border-none bg-transparent px-3 py-1.5 text-[12px] text-white/40 underline cursor-pointer hover:text-white/70"
          >
            {isChallenge ? 'Выйти из челленджа' : 'Не смогу — отказаться от участия'}
          </button>
          </div>
        )}
        {!(isRegistered && phase !== 'past' && !isLocked) && (
        <div className="p-4 sm:p-6 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-6 border-t border-white/10 bg-[#161616] flex flex-col sm:flex-row gap-3 items-stretch justify-between snap-none">
          {phase === 'past' ? (
            /* Past event - feedback and share */
            <div className="flex flex-col sm:flex-row gap-2.5 items-stretch w-full">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  window.dispatchEvent(new CustomEvent('openFeedback', { detail: { eventId: event.id, eventTitle: event.title } }));
                }}
                className="flex-1 bg-brand/10 border border-brand/30 text-brand py-4 rounded-2xl text-xs font-bold uppercase tracking-widest hover:bg-brand/20 transition-colors cursor-pointer font-mono"
              >
                Оставить отзыв
              </button>
              {/**
               * «Поделиться» у прошедшего события.
               *
               * Раньше здесь открывалась отдельная карточка-постер (EventPoster)
               * с одной кнопкой — то есть ещё одно окно поверх карточки
               * события. Владелец попросил его убрать: «Поделиться» должно
               * делать ровно то же, что «Позвать» на идущем событии — класть
               * готовое приглашение с обложкой в чат. Разницы в действии нет,
               * значит нет и лишнего экрана между человеком и результатом.
               */}
              <button
                type="button"
                disabled={shareSending}
                onClick={() => { onClose(); void sendInvite(); }}
                className="flex-1 bg-white/5 border border-white/10 text-white/70 py-4 rounded-2xl text-xs font-bold uppercase tracking-widest hover:bg-white/10 hover:text-white transition-colors cursor-pointer font-mono flex items-center justify-center gap-2 disabled:opacity-60"
              >
                <Share2 className="w-4 h-4" />
                Поделиться
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex-1 border border-white/10 py-4 rounded-2xl text-xs font-bold uppercase tracking-widest text-[#FFF]/60 hover:bg-[#FFF]/5 transition-colors cursor-pointer font-mono bg-transparent"
              >
                Вернуться в каталог
              </button>
            </div>
          ) : isLocked ? (
            /* «Под замочком» — набор ещё не открыт */
            <div className="flex flex-col sm:flex-row gap-2.5 items-stretch w-full">
              <div className="bg-white/5 border border-white/10 rounded-2xl px-5 py-4 flex items-center justify-center gap-2.5 flex-grow text-white/70">
                <Lock className="w-4 h-4 text-brand shrink-0" />
                <span className="text-xs font-bold font-mono uppercase tracking-wider text-center">
                  {event.lockedHint || 'Набор скоро откроется'}
                </span>
              </div>
              <button
                type="button"
                onClick={handleInterest}
                disabled={interestSending || interestSent}
                className={`font-black font-mono text-xs py-4 px-6 rounded-2xl transition-all flex items-center justify-center gap-2 uppercase tracking-widest text-center border-none cursor-pointer ${
                  interestSent
                    ? 'bg-brand/15 text-brand border border-brand/30'
                    : 'bg-brand hover:bg-brand-hover text-black shadow-lg shadow-brand/10'
                }`}
              >
                {interestSent ? (
                  <><Check className="w-4 h-4 shrink-0" /> Интерес учтён</>
                ) : interestSending ? (
                  'Отправляем…'
                ) : (
                  <><Bell className="w-4 h-4 text-black shrink-0" /> Мне интересно</>
                )}
              </button>
            </div>
          ) : isRegistered ? (
            /* Already Registered */
            <div className="flex flex-col sm:flex-row gap-2.5 items-stretch w-full">
              <div className="bg-brand/10 border border-brand/30 rounded-2xl px-5 py-4 flex items-center justify-center gap-2.5 flex-grow">
                <Check className="w-4 h-4 text-brand stroke-[3px]" />
                <span className="text-xs font-bold text-brand font-mono uppercase tracking-wider">Ваше участие подтверждено! Вы в кругу</span>
              </div>
              {/* Кнопку «Чат события» показываем, только если это правда чат:
                  у части событий в поле лежит ссылка на самого бота. */}
              {isRealChatUrl(event.telegramBotUrl) && (
                <a
                  href={event.telegramBotUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="border border-brand/30 text-brand hover:bg-brand/10 font-black font-mono text-xs py-4 px-6 rounded-2xl transition-all flex items-center justify-center gap-2 uppercase tracking-widest text-center"
                >
                  Чат события
                  <Send className="w-4 h-4 shrink-0" />
                </a>
              )}
              {/* «ТГ-Бот флинта» для челленджа скрываем: человек уже здесь,
                  отчёт он шлёт в чат, а не в личку бота. */}
              {!isChallenge && (
              <a
                href={`https://t.me/campsflint_bot?start=event_${event.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-[#E6FD3A] hover:bg-[#D4E825] text-black font-black font-mono text-xs py-4 px-6 rounded-2xl transition-all flex items-center justify-center gap-2 uppercase tracking-widest text-center shadow-lg shadow-brand/10"
              >
                ТГ-Бот флинта
                <Send className="w-4 h-4 text-black shrink-0" />
              </a>
              )}
            </div>
          ) : (
            /* Open for Registration */
            <>
              {/* «Верификация» — только для тех, кого ещё не приняли в клуб. */}
              {event.needsOnboarding && !isClubMember && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    window.dispatchEvent(new CustomEvent('openVerification', { detail: { eventId: event.id, eventTitle: event.title } }));
                  }}
                  className="flex-1 order-2 sm:order-1 border border-brand/30 py-4.5 rounded-2xl text-xs font-bold uppercase tracking-widest text-brand hover:bg-brand/10 transition-colors cursor-pointer font-mono bg-transparent"
                >
                  Пройти верификацию
                </button>
              )}

              <button
                type="button"
                onClick={onClose}
                className={`flex-1 order-${event.needsOnboarding ? '3' : '2'} sm:order-${event.needsOnboarding ? '2' : '1'} border border-white/10 py-4.5 rounded-2xl text-xs font-bold uppercase tracking-widest text-[#FFF]/60 hover:bg-[#FFF]/5 transition-colors cursor-pointer font-mono bg-transparent`}
              >
                Вернуться в каталог
              </button>

              <button
                onClick={() => {
                  onClose();
                  onRegisterClick(event);
                }}
                disabled={spotsFull}
                className={`
                  flex-1 order-${event.needsOnboarding ? '4' : '1'} sm:order-${event.needsOnboarding ? '3' : '2'} py-4.5 rounded-2xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all outline-none border-none cursor-pointer
                  ${spotsFull 
                    ? 'bg-white/5 text-white/30 cursor-not-allowed'
                    : 'bg-brand hover:bg-brand-hover text-black shadow-lg shadow-brand/10 active:scale-98'
                  }
                `}
              >
                {/* «Вступить в живой круг» читалось как вступление в КЛУБ, а не
                    запись на конкретный выезд — человек не понимал, на что
                    жмёт. Призыв должен называть ровно одно действие. */}
                {spotsFull ? (
                  <span>Все места заняты</span>
                ) : isChallenge ? (
                  /* Челлендж — не поездка: мы не «едем», а действуем каждый день. */
                  <>⚡ Вступить в челлендж</>
                ) : (
                  <>
                    Записаться
                    <span className="font-normal opacity-70">· {spotsRemaining} мест</span>
                  </>
                )}
              </button>
            </>
          )}
        </div>
        )}

        {/* Снять фото / видео прямо из карточки события (живые кнопки) */}
        {showSnap && (
          <Suspense fallback={null}>
            <SnapModal
              eventId={event.id}
              eventTitle={event.title}
              onClose={() => setShowSnap(false)}
              // Живая лента (LiveMedia) сама опрашивает сервер каждые ~12с — кадр появится автоматически.
            />
          </Suspense>
        )}

      </motion.div>
    </div>
  );
}
