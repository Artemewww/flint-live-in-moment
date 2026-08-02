import React, { useState, useEffect, useRef } from 'react';
import { AnimatePresence } from 'motion/react';
import { 
  Heart, Compass, Calendar as CalendarIcon, UserCheck, Trash2, CheckCircle,
  BookOpen, Info, ShieldCheck, HelpCircle, FileText, Sparkles, X, Gift, Trophy, Shield, Menu, MessageCircle
} from 'lucide-react';
import { CommunityEvent, Registration } from './types';
import { getInitData, getStartParam, getTelegramUser, openBot } from './telegram';
import InfoSection from './components/InfoSection';
import EventFeed from './components/EventFeed';
import RegistrationModal from './components/RegistrationModal';
import EventDetailModal from './components/EventDetailModal';
import CalendarGrid from './components/CalendarGrid';
import VerificationModal from './components/VerificationModal';
import BirthdayCalendar from './components/BirthdayCalendar';
import FeedbackModal from './components/FeedbackModal';
import ProfileScreen from './components/ProfileScreen';
import EventPoster from './components/EventPoster';
import AdminPanel from './components/AdminPanel';
import GateScreen from './components/GateScreen';
import { LogoMain, LogoEmblem, getVectorIconByKey } from './components/VectorIcons';
import { submitFeedback } from './api';

// Маппинг snake_case -> camelCase для данных из Supabase
function mapEventToCamelCase(event: any): CommunityEvent {
  if (!event) return event;
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    type: event.type,
    date: event.date,
    // Без dateEnd многодневное событие «протухает» в первый же день (getEventPhase).
    dateEnd: event.date_end || event.dateEnd || undefined,
    dateLabel: event.date_label || event.dateLabel || event.date,
    time: event.time || '',
    timeEnd: event.time_end || event.timeEnd || '',
    location: event.location,
    locationDetails: event.location_details || event.locationDetails,
    coordinates: event.coordinates || (event.coordinates_lat ? { lat: event.coordinates_lat, lng: event.coordinates_lng } : undefined),
    painPoint: event.pain_point || event.painPoint || '',
    houseQualities: event.house_qualities || event.houseQualities || [],
    logistics: event.logistics || {},
    paymentDetails: event.payment_details || event.paymentDetails || {},
    image: event.image,
    maxParticipants: event.max_participants ?? event.maxParticipants ?? 15,
    participantsCount: event.participants_count ?? event.participantsCount ?? 0,
    telegramImage: event.telegram_image || event.telegramImage || undefined,
    telegramBotUrl: event.telegram_bot_url || event.telegramBotUrl,
    priceType: (event.price_type || event.priceType) === 'paid' ? 'paid' : 'free',
    priceLabel: event.price_label || event.priceLabel,
    priceAmount: event.price_amount ?? event.priceAmount ?? 0,
    entryThreshold: event.entry_threshold || event.entryThreshold,
    entryType: event.entry_type || event.entryType || 'all',
    needsOnboarding: event.needs_onboarding ?? event.needsOnboarding ?? false,
    status: event.status || 'locked',
    statusReason: event.status_reason || event.statusReason,
    decisionDeadline: event.decision_deadline || event.decisionDeadline,
    checklist: event.checklist || {},
    isPublic: event.is_public ?? event.isPublic ?? true,
    accessCode: event.access_code || event.accessCode,
    deputyId: event.deputy_id ?? event.deputyId,
    lockedHint: event.locked_hint || event.lockedHint,
    program: event.program || [],
    notifications: event.notifications || {},
    programVoting: event.program_voting || event.programVoting
  };
}

/**
 * Раздел «Философия клуба» — визуальная опора идеологии.
 * Инфографики пути развития личности и колеса жизненного баланса.
 * Задел пополнять: добавляй объекты в массив CARDS.
 */
function PhilosophyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const CARDS = [
    {
      img: '/assets/flint-stages.webp',
      title: 'Ступени развития личности',
      sub: 'Путь от заботы о себе к смыслу и единству с миром',
      desc: 'Базовый уровень → саморазвитие → самотрансценденция → единение. Мы растём вместе: от опоры и безопасности к раскрытию потенциала, служению команде и природе — и к состоянию потока и присутствия.',
    },
    {
      img: '/assets/flint-wheel.jpg',
      title: 'Колесо жизненного баланса',
      sub: 'Гармония внутри — сила снаружи',
      desc: '8 сфер жизни: личный рост, здоровье, карьера и дело, отдых, духовность, окружение, отношения, финансы. Развивай каждую — живи сбалансированно и будь своей лучшей версией.',
    },
  ];
  const [zoom, setZoom] = useState<string | null>(null);
  useEffect(() => { if (!open) setZoom(null); }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" id="philosophy-modal-root">
      <div className="absolute inset-0 bg-black/85 backdrop-blur-md" onClick={onClose} />

      <div className="bg-[#121212] rounded-3xl w-full max-w-3xl shadow-2xl relative z-10 border border-white/10 max-h-[88vh] overflow-y-auto flex flex-col text-white">
        {/* Header */}
        <div className="p-6 border-b border-white/10 flex justify-between items-start bg-[#181818] sticky top-0 z-10">
          <div>
            <span className="text-[10px] uppercase font-mono font-bold tracking-widest text-[#000] bg-brand px-2.5 py-1 rounded-full inline-block mb-1.5">Философия клуба</span>
            <h2 className="font-display font-black text-2xl sm:text-3xl uppercase tracking-tight leading-none">Путь развития</h2>
            <p className="text-white/60 text-sm mt-2">Только живое общение. 100% чистота. Без алкоголя и фальши. Равенство, искренность и поддержка каждого.</p>
          </div>
          <button type="button" onClick={onClose}
            className="text-white/50 hover:text-white bg-white/5 hover:bg-white/10 rounded-full w-9 h-9 flex items-center justify-center border-none cursor-pointer shrink-0 ml-3">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-5">
          {CARDS.map((c) => (
            <div key={c.img} className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden flex flex-col">
              <button type="button" onClick={() => setZoom(c.img)}
                className="block w-full bg-black/30 border-none cursor-zoom-in p-0" aria-label={`Открыть ${c.title}`}>
                <img src={c.img} alt={c.title} loading="lazy"
                  className="w-full h-auto max-h-[520px] object-contain" />
              </button>
              <div className="p-4">
                <h3 className="font-display font-black text-lg uppercase leading-tight">{c.title}</h3>
                <p className="text-brand text-xs font-mono uppercase tracking-wide mt-0.5">{c.sub}</p>
                <p className="text-white/70 text-[13px] leading-relaxed mt-2">{c.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {zoom && (
        <div className="fixed inset-0 z-[70] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 cursor-zoom-out"
          onClick={() => setZoom(null)}>
          <img src={zoom} alt="" className="max-w-full max-h-full object-contain rounded-lg" />
          <button type="button" onClick={(e) => { e.stopPropagation(); setZoom(null); }}
            className="absolute top-4 right-4 bg-white/10 hover:bg-white/20 text-white rounded-full w-10 h-10 border-none cursor-pointer text-xl">✕</button>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [events, setEvents] = useState<CommunityEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [registeredEventIds, setRegisteredEventIds] = useState<string[]>([]);
  const [userRegistrations, setUserRegistrations] = useState<Registration[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [registeringEvent, setRegisteringEvent] = useState<CommunityEvent | null>(null);
  const [showMyRegistrationsModal, setShowMyRegistrationsModal] = useState<boolean>(false);
  /**
   * «Мои участия» — только по НЕ прошедшим событиям. Прошедшие висели там с
   * плашкой «Активен» и предложением удалить регистрацию, хотя человек уже
   * съездил. История прошедших живёт в профиле (вкладка «События») и в архиве
   * афиши. `registeredEventIds` при этом НЕ фильтруем: факт записи на прошедшее
   * событие нужен для проверок «уже записан».
   */
  const activeRegistrations = React.useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return userRegistrations.filter((reg) => {
      const ev = events.find((e) => e.id === reg.eventId);
      return !!ev && (ev.dateEnd || ev.date) >= today;
    });
  }, [userRegistrations, events]);
  const [showManifestoModal, setShowManifestoModal] = useState<boolean>(false);
  const [showPhilosophyModal, setShowPhilosophyModal] = useState<boolean>(false);
  const [activeDetailEvent, setActiveDetailEvent] = useState<CommunityEvent | null>(null);
  const [verifyingEvent, setVerifyingEvent] = useState<CommunityEvent | null>(null);
  const [verificationData, setVerificationData] = useState<import('./components/VerificationModal').VerificationData | null>(null);
  const [showBirthdayCalendar, setShowBirthdayCalendar] = useState<boolean>(false);
  const [birthdays, setBirthdays] = useState<Array<{id: string, name: string, date: string, year?: number, telegram?: string}>>([]);
  const [feedbackEvent, setFeedbackEvent] = useState<CommunityEvent | null>(null);
  const [showUserStats, setShowUserStats] = useState<boolean>(false);
  /** Инициал для аватара в шапке: внутри Telegram личность известна сразу. */
  const profileInitial = React.useMemo(() => {
    const name = getTelegramUser()?.first_name || '';
    return name.trim().charAt(0).toUpperCase() || '?';
  }, []);
  /** С какой вкладки открыть профиль (deep-link ?checklist ведёт в «Снаряжение»). */
  const [profileTab, setProfileTab] = useState<'overview' | 'events' | 'gear' | 'settings'>('overview');
  const [posterEvent, setPosterEvent] = useState<CommunityEvent | null>(null);
  const [showAdminPanel, setShowAdminPanel] = useState<boolean>(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  // Клуб закрытый: без реф-ссылки афиша не видна. Аварийно открыть: VITE_GATE_ENABLED=0.
  const gateEnabled = import.meta.env.VITE_GATE_ENABLED !== '0';
  const [gatePassed, setGatePassed] = useState<boolean>(() => {
    if (!gateEnabled) return true;
    try { return localStorage.getItem('flint_gate_ok') === '1'; } catch { return false; }
  });
  const isAuthorizedUser = (() => {
    try { return typeof window !== 'undefined' && !!window.Telegram?.WebApp?.initDataUnsafe?.user; } catch { return false; }
  })();
  // Уже принятый в клуб участник не должен проходить «верификацию» заново
  // при каждой записи. null = ещё не знаем, true/false = ответ сервера.
  const [clubApproved, setClubApproved] = useState<boolean | null>(null);
  const [incompleteProfile, setIncompleteProfile] = useState(false);
  /** Участник заблокирован (members.status === 'blocked') — афиша ему недоступна. */
  const [banned, setBanned] = useState(false);
  /** Сервер ответил 403 members_only: не зарегистрирован в клубе — афишу не показываем.
   *  Реф-код больше НЕ открывает афишу (только вступление в боте). */
  const [membersOnly, setMembersOnly] = useState(false);
  /** Открыть анкету вступления на экране «Только для участников». */
  const [showApplyForm, setShowApplyForm] = useState(false);
  /**
   * Человек пришёл по ссылке-приглашению (код в URL/start_param или уже
   * сохранён шлюзом). Ему анкету показываем сразу: он не «случайный прохожий»,
   * его позвал участник, и лишний экран здесь — потерянный человек.
   */
  const invitedByRef = React.useMemo(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      if (p.get('ref') || p.get('apply') === '1') return true;
      if (localStorage.getItem('flint_ref')) return true;
    } catch { /* нет window/localStorage */ }
    return /(?:^|_)ref_/.test(getStartParam());
  }, []);

  // Находим ближайшее мероприятие для баннера
  const nextEvent = events
    .filter(e => e.status === 'open' || e.status === 'locked')
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .find(e => new Date(e.date) >= new Date(new Date().toISOString().split('T')[0]));

  // Рефетч афиши по требованию: админка после логина получает куку,
  // с которой сервер уже отдаёт список.
  const [eventsReloadTick, setEventsReloadTick] = useState(0);
  useEffect(() => {
    const bump = () => setEventsReloadTick((t) => t + 1);
    window.addEventListener('flint:events-refetch', bump);
    return () => window.removeEventListener('flint:events-refetch', bump);
  }, []);

  // Загружаем события из API (Supabase) или fallback на JSON.
  // Афиша закрыта на сервере: шлём initData участника и реф-код приглашения.
  // На 403 фолбэки НЕ используем — иначе статический JSON обходил бы гейт.
  useEffect(() => {
    const ref = (() => { try { return localStorage.getItem('flint_ref') || ''; } catch { return ''; } })();
    fetch(`/api/events${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`, {
      headers: { 'X-Telegram-Init-Data': getInitData() },
    })
      .then(res => {
        if (res.status === 403) { setEvents([]); setEventsLoading(false); setMembersOnly(true); return Promise.reject('members_only'); }
        return res.ok ? res.json() : Promise.reject('API not available');
      })
      .then(data => {
        if (data && data.events && data.events.length > 0) {
          const mappedEvents = data.events.map(mapEventToCamelCase);
          setEvents(mappedEvents);
        } else {
          throw new Error('No events from API');
        }
        setEventsLoading(false);
      })
      .catch(err => {
        if (err === 'members_only') return; // закрытый клуб: без фолбэков
        console.log('API not available, loading from JSON:', err);
        // Fallback на статический JSON
        fetch('/events.json')
          .then(res => res.json())
          .then(data => {
            if (data && data.length > 0) {
              setEvents(data.map(mapEventToCamelCase));
            }
            setEventsLoading(false);
          })
          .catch(() => {
            // Fallback на локальные данные
            import('./data').then(module => {
              const localEvents = (module.INITIAL_EVENTS || []).map(mapEventToCamelCase);
              setEvents(localEvents);
              setEventsLoading(false);
            });
          });
      });
    // Перезапрашиваем после прохождения гейта и по событию рефетча (логин админа).
  }, [gatePassed, eventsReloadTick]);

  // Deep-link `?ev=<id>` из бота: кнопка «Заполнить анкету» открывает Mini App
  // сразу на нужном событии. Бот своей записи больше не ведёт — все этапы здесь.
  // Срабатывает один раз, как только события загрузились.
  const evDeepLinkDone = useRef(false);
  useEffect(() => {
    if (evDeepLinkDone.current || events.length === 0) return;
    let evId = '';
    try {
      const p = new URLSearchParams(window.location.search);
      evId = p.get('ev') || '';
    } catch { /* нет window.location — не критично */ }
    if (!evId) {
      // Ссылка вида t.me/bot/app?startapp=ev_<id> тоже ведёт на карточку события.
      const sp = getStartParam();
      const m = sp.match(/(?:^|_)ev_([\w-]+)/);
      if (m) evId = m[1];
    }
    if (!evId) return;
    const ev = events.find((e) => e.id === evId);
    if (!ev) return;
    evDeepLinkDone.current = true;
    setActiveDetailEvent(ev);
  }, [events]);

  /**
   * Deep-link `?checklist=1` — кнопка «Весь список с галочками» из бота.
   * Открывает профиль сразу на вкладке «Снаряжение», где живёт чек-лист.
   */
  const checklistDeepLinkDone = useRef(false);
  useEffect(() => {
    if (checklistDeepLinkDone.current) return;
    let want = false;
    try {
      want = new URLSearchParams(window.location.search).has('checklist');
    } catch { /* нет window.location */ }
    if (!want && /(?:^|_)checklist/.test(getStartParam())) want = true;
    if (!want) return;
    checklistDeepLinkDone.current = true;
    setProfileTab('gear');
    setShowUserStats(true);
  }, []);

  // Статус в клубе: одобрен ли участник. Нужно, чтобы не показывать «верификацию»
  // тем, кто уже внутри (пришёл по реф-ссылке и принят костяком).
  useEffect(() => {
    const initData = (typeof window !== 'undefined' && (window as any).Telegram?.WebApp?.initData) || '';
    if (!initData) { setClubApproved(false); return; }
    fetch('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'profile', initData }),
    })
      .then((r) => r.json())
      .then((d) => {
        const p = d?.profile;
        setClubApproved(!!p && (p.status === 'approved' || p.isCore));
        // Костяк не блокируется; для остальных статус 'blocked' закрывает афишу.
        setBanned(!!p && p.status === 'blocked' && !p.isCore);
      })
      .catch(() => setClubApproved(false));
  }, []);

  // Внутри Telegram — подтягиваем свои заявки из БД, чтобы «Мои Участия»
  // работали на телефоне даже если человек записывался через бота.
  useEffect(() => {
    const initData = (typeof window !== 'undefined' && (window as any).Telegram?.WebApp?.initData) || '';
    if (!initData) return;
    fetch('/api/my', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData }),
    })
      .then((r) => r.json())
      .then((d) => {
        const regs = (d && d.registrations) || [];
        if (!regs.length) return;
        setUserRegistrations((prev) => {
          const map = new Map(prev.map((r) => [r.eventId, r]));
          regs.forEach((r: any) =>
            map.set(r.eventId, {
              id: r.id || r.eventId,
              eventId: r.eventId,
              telegram: '',
              name: r.name || '',
              phone: r.phone || '',
              status: r.status || 'pending',
              paymentStatus: r.paymentStatus || 'pending',
              paymentAmount: r.paymentAmount || 0,
              donationAmount: 0,
              hasTransport: !!r.hasTransport,
              transportSeats: r.transportSeats || 0,
              inventory: [],
              registeredAt: r.registeredAt || new Date().toISOString(),
            } as Registration)
          );
          return Array.from(map.values());
        });
        setRegisteredEventIds((prev) => Array.from(new Set([...prev, ...regs.map((r: any) => r.eventId)])));
      })
      .catch(() => {});
  }, []);

  // Load registration state from localStorage on init
  useEffect(() => {
    try {
      const savedIds = localStorage.getItem('moment_registered_event_ids');
      const savedRegs = localStorage.getItem('moment_user_registrations');
      const savedBirthdays = localStorage.getItem('moment_birthdays');
      
      if (savedIds) {
        setRegisteredEventIds(JSON.parse(savedIds));
      }
      if (savedRegs) {
        setUserRegistrations(JSON.parse(savedRegs));
      }
      if (savedBirthdays) {
        setBirthdays(JSON.parse(savedBirthdays));
      } else {
        // Демо-данные для тестирования
        setBirthdays([
          { id: '1', name: 'Александр', date: '07-15', year: 1990, telegram: '@alex' },
          { id: '2', name: 'Михаил', date: '07-22', year: 1988, telegram: '@mike' },
          { id: '3', name: 'Дмитрий', date: '08-03', year: 1992, telegram: '@dima' }
        ]);
      }
    } catch (err) {
      console.error('Failed to load local storage registrations', err);
    }
  }, []);

  // Слушаем событие открытия верификации из EventDetailModal.
  // Кто уже в клубе — сразу к записи, «кто пригласил в клуб» ему показывать не нужно.
  useEffect(() => {
    const handleOpenVerification = (e: any) => {
      const { eventId } = e.detail;
      const event = events.find(ev => ev.id === eventId);
      if (!event) return;
      if (clubApproved) setRegisteringEvent(event);
      else setVerifyingEvent(event);
    };

    window.addEventListener('openVerification', handleOpenVerification);
    return () => window.removeEventListener('openVerification', handleOpenVerification);
  }, [events, clubApproved]);

  // Слушаем событие открытия постера из EventDetailModal
  useEffect(() => {
    const handleOpenPoster = (e: any) => {
      const { eventId } = e.detail;
      const event = events.find(ev => ev.id === eventId);
      if (event) {
        setPosterEvent(event);
      }
    };

    window.addEventListener('openPoster', handleOpenPoster);
    return () => window.removeEventListener('openPoster', handleOpenPoster);
  }, [events]);

  // Save registration state to localStorage on update
  const saveToLocalStorage = (ids: string[], regs: Registration[]) => {
    try {
      localStorage.setItem('moment_registered_event_ids', JSON.stringify(ids));
      localStorage.setItem('moment_user_registrations', JSON.stringify(regs));
    } catch (err) {
      console.error('Failed to save to local storage', err);
    }
  };

  const handleRegistrationSuccess = (newReg: Registration) => {
    const updatedIds = [...registeredEventIds, newReg.eventId];
    const updatedRegs = [...userRegistrations, newReg];

    setRegisteredEventIds(updatedIds);
    setUserRegistrations(updatedRegs);
    saveToLocalStorage(updatedIds, updatedRegs);

    // Increment participants counter
    setEvents(prevEvents =>
      prevEvents.map(evt => {
        if (evt.id === newReg.eventId) {
          return {
            ...evt,
            participantsCount: evt.participantsCount + 1
          };
        }
        return evt;
      })
    );
  };

  const handleClearRegistrations = () => {
    if (window.confirm('Вы действительно хотите отменить все регистрации?')) {
      setRegisteredEventIds([]);
      setUserRegistrations([]);
      localStorage.removeItem('moment_registered_event_ids');
      localStorage.removeItem('moment_user_registrations');
      
      // Перезагружаем события из JSON
      fetch('/events.json')
        .then(res => res.json())
        .then(data => setEvents(data.map(mapEventToCamelCase)))
        .catch(() => {});
      setShowMyRegistrationsModal(false);
    }
  };

  const handleDeleteRegistration = (eventId: string) => {
    if (window.confirm('Вы действительно хотите отменить участие в этом событии?')) {
      // Внутри Telegram — снимаем заявку и в БД (иначе на перезагрузке вернётся).
      const initData = (typeof window !== 'undefined' && (window as any).Telegram?.WebApp?.initData) || '';
      if (initData) {
        fetch('/api/my', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'cancel', eventId, initData }),
        }).catch(() => {});
      }

      const updatedIds = registeredEventIds.filter(id => id !== eventId);
      const updatedRegs = userRegistrations.filter(reg => reg.eventId !== eventId);

      setRegisteredEventIds(updatedIds);
      setUserRegistrations(updatedRegs);
      saveToLocalStorage(updatedIds, updatedRegs);

      // Decrement participants counter
      setEvents(prevEvents =>
        prevEvents.map(evt => {
          if (evt.id === eventId) {
            return {
              ...evt,
              participantsCount: Math.max(0, evt.participantsCount - 1)
            };
          }
          return evt;
        })
      );

      if (updatedIds.length === 0) {
        setShowMyRegistrationsModal(false);
      }
    }
  };

  // Единые CRUD-обработчики событий для админки. Раньше эта ветка (вход админа
  // через гейт) меняла ТОЛЬКО локальный стейт и не писала в БД — событие
  // «сохранялось» на экране, но пропадало после обновления и не доходило до
  // бота. Теперь оба места отрисовки AdminPanel пишут в API, проверяют ответ и
  // рефетчат список с сервера.
  // Кука админки истекает/слетает раньше клиентского флага localStorage —
  // тогда запрос ловит 401. Раньше это выглядело как «просто не сохранилось».
  // Теперь: чистим клиентскую сессию и просим войти заново.
  const handleAdminExpired = () => {
    try { localStorage.removeItem('flint_admin_session'); } catch { /* no-op */ }
    alert('Сессия админки истекла — войди заново (кнопка «Админ» → пароль). Твои данные не потеряны, просто повтори сохранение после входа.');
    window.location.reload();
  };
  /**
   * Токен админки к запросу. Кука сессии — `SameSite=Strict`, а панель
   * открывают внутри Telegram Mini App, где страница во встроенном контексте и
   * такая кука не прикладывается: сервер отвечает 401, и сохранение события
   * выглядит как «сессия истекла». Сервер принимает и куку, и Bearer.
   */
  const adminAuthHeaders = (base: Record<string, string> = {}): Record<string, string> => {
    try {
      const t = localStorage.getItem('flint_admin_token');
      if (t) return { ...base, Authorization: `Bearer ${t}` };
    } catch { /* приватный режим */ }
    return base;
  };
  const adminSaveEvent = async (ev: CommunityEvent, isNew: boolean) => {
    try {
      const res = await fetch('/api/admin/events', {
        method: 'POST',
        headers: adminAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(ev),
      });
      if (res.status === 401) { handleAdminExpired(); return; }
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as any));
        alert(`Не удалось сохранить событие: ${body.details || body.error || `HTTP ${res.status}`}`);
        return;
      }
      // Сервер возвращает event в camelCase. Обновляем стейт из ответа.
      // Refetch НЕ вызываем — он перезапишет стейт старыми данными из /api/events,
      // и telegramImage/image могут потеряться, пока новый код не задеплоен.
      const data = await res.json().catch(() => ({} as any));
      const saved = data?.event || ev;
      setEvents((prev) => (isNew ? [...prev, saved] : prev.map((x) => (x.id === saved.id ? saved : x))));
    } catch (err) {
      alert(`Ошибка сети при сохранении события: ${(err as Error).message}`);
    }
  };
  const adminDeleteEvent = async (eventId: string) => {
    try {
      const res = await fetch(`/api/admin/events?eventId=${eventId}`, { method: 'DELETE', headers: adminAuthHeaders() });
      if (res.status === 401) { handleAdminExpired(); return; }
      if (!res.ok) {
        alert(`Не удалось удалить событие: HTTP ${res.status}`);
        return;
      }
      setEvents((prev) => prev.filter((x) => x.id !== eventId));
      window.dispatchEvent(new Event('flint:events-refetch'));
    } catch (err) {
      alert(`Ошибка сети при удалении события: ${(err as Error).message}`);
    }
  };

  // Админ должен попадать в панель, не проходя шлюз для гостей.
  if (gateEnabled && !gatePassed && showAdminPanel) {
    return (
      <AdminPanel
        events={events}
        onUpdateEvent={(e) => adminSaveEvent(e, false)}
        onAddEvent={(e) => adminSaveEvent(e, true)}
        onDeleteEvent={(id) => adminDeleteEvent(id)}
        onClose={() => setShowAdminPanel(false)}
        onViewSite={() => { setGatePassed(true); setShowAdminPanel(false); }}
      />
    );
  }

  if (gateEnabled && !gatePassed) {
    return <GateScreen onPass={() => setGatePassed(true)} onAdmin={() => setShowAdminPanel(true)} />;
  }

  // Жёсткий клубный гейт: сервер отдаёт афишу только зарегистрированным участникам
  // (approved/core через Telegram initData). Реф-код больше НЕ открывает систему —
  // сначала вступление в боте. Кто прошёл визуальный гейт кодом, но не член — сюда.
  if (gateEnabled && membersOnly && !showAdminPanel) {
    /**
     * Пришёл по реф-ссылке — сразу анкета, без промежуточного экрана. Это был
     * ТУПИК: шлюз он проходил (код валидный), но членом клуба ещё не был, и
     * сервер не отдавал афишу — человек упирался в «Только для участников» со
     * ссылкой «Вступить через бот», а анкеты там не было вообще.
     */
    if (showApplyForm || invitedByRef) {
      return (
        <GateScreen
          applyOnly
          onPass={() => {
            setMembersOnly(false);
            setShowApplyForm(false);
            // Афишу очистили на 403 — после вступления её нужно перезапросить,
            // иначе новый участник видит пустой экран вместо событий.
            setEventsLoading(true);
            window.dispatchEvent(new Event('flint:events-refetch'));
          }}
          onAdmin={() => setShowAdminPanel(true)}
        />
      );
    }
    return (
      <div className="min-h-screen bg-[#0A0A0A] text-white flex flex-col items-center justify-center px-6 text-center overflow-hidden relative">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-brand/5 rounded-full blur-3xl pointer-events-none" />
        <div className="text-5xl mb-6 relative z-10">🔒</div>
        <h1 className="font-display font-black text-3xl uppercase tracking-tight mb-3 relative z-10">Только для участников</h1>
        <p className="text-sm text-white/60 max-w-sm leading-relaxed font-sans relative z-10">
          «Живи в моменте» — закрытый клуб. Афишу видят только участники.
          Заполни короткую анкету — костяк познакомится и откроет афишу здесь же.
        </p>
        <button
          onClick={() => setShowApplyForm(true)}
          className="mt-8 px-6 py-3 rounded-full bg-[#E6FD3A] text-black font-black text-sm uppercase tracking-wide relative z-10 border-none cursor-pointer"
        >
          Заполнить анкету
        </button>
        <button
          type="button"
          onClick={() => openBot('https://t.me/campsflint_bot?start=apply')}
          className="mt-3 text-[11px] text-white/40 hover:text-white/70 transition-colors font-mono relative z-10 bg-transparent border-none cursor-pointer"
        >
          Или написать в бот →
        </button>
        <button
          onClick={() => setShowAdminPanel(true)}
          className="mt-4 text-[11px] text-white/30 hover:text-white/70 transition-colors font-mono bg-transparent border-none cursor-pointer relative z-10"
        >
          Я организатор — вход в админку
        </button>
      </div>
    );
  }

  // Бан: заблокированному участнику афиша полностью недоступна (независимо от шлюза).
  // Админ-панель (под своим паролем) не перекрывается, чтобы не заблокировать оргов.
  if (banned && !showAdminPanel) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] text-white flex flex-col items-center justify-center px-6 text-center">
        <div className="text-5xl mb-6">🔒</div>
        <h1 className="font-display font-black text-3xl uppercase tracking-tight mb-3">Доступ ограничен</h1>
        <p className="text-sm text-white/60 max-w-sm leading-relaxed font-sans">
          Ваш доступ к афише сообщества сейчас закрыт. Если это недоразумение — напишите
          организатору в Telegram, и мы разберёмся.
        </p>
        <button
          type="button"
          onClick={() => openBot('https://t.me/campsflint_bot')}
          className="mt-8 px-6 py-3 rounded-full bg-[#E6FD3A] text-black font-black text-sm uppercase tracking-wide border-none cursor-pointer"
        >
          Написать организатору
        </button>
      </div>
    );
  }

  // `relative` на #app-root обязателен: без него декоративные glow-блобы (absolute,
  // w-96) позиционируются от initial containing block и НЕ клипаются overflow-x —
  // из-за этого страница «уезжала» вправо на мобильном (body.scrollWidth 478 при
  // ширине экрана 375).
  return (
    <div id="app-root" className="relative min-h-screen bg-[#0A0A0A] text-white font-sans selection:bg-brand/35 selection:text-white pb-12 antialiased overflow-x-clip">
      {/* Dynamic Glow Accents */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-brand/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-1/4 right-1/4 w-80 h-80 bg-brand/5 rounded-full blur-3xl pointer-events-none animate-pulse" />

      {/* Navigation Header */}
      <header className="sticky top-0 z-40 bg-[#0A0A0A] border-b border-white/10" id="main-navigation">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          
          {/* Logo element in Upper-Left corner */}
          <div className="flex items-center gap-3" id="header-brand-logo">
            <LogoMain size={38} className="cursor-pointer hover:opacity-90 select-none" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} />
            <div className="hidden md:block pl-3 border-l border-white/15">
              <span className="text-[10px] uppercase font-mono font-bold text-brand tracking-widest block">
                ЖИВОЕ СООБЩЕСТВО
              </span>
              <span className="text-[9px] text-white/40 font-mono tracking-widest uppercase">
                БЕЛАРУСЬ • МИНСК
              </span>
            </div>
          </div>

          {/* Профиль + бургер. Профиль — иконкой в шапке, а не пунктом внутри
              меню: это вход в личный кабинет, самое частое действие после афиши,
              и на мобиле он не должен прятаться за бургером. */}
          <div className="md:hidden flex items-center gap-2">
            <button
              onClick={() => setShowUserStats(true)}
              className="w-10 h-10 rounded-full bg-brand/15 border border-brand/30 hover:bg-brand/25 transition-all cursor-pointer flex items-center justify-center font-display font-black text-brand text-sm relative"
              id="header-profile-btn"
              title="Профиль"
              aria-label="Профиль"
            >
              {profileInitial}
              {activeRegistrations.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 bg-brand text-black font-black text-[9px] w-4 h-4 rounded-full flex items-center justify-center">
                  {activeRegistrations.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all cursor-pointer"
              id="mobile-menu-btn"
            >
              {mobileMenuOpen ? <X className="w-5 h-5 text-white" /> : <Menu className="w-5 h-5 text-white" />}
            </button>
          </div>

          {/* Desktop nav (hidden on mobile) */}
          <div className="hidden md:flex items-center gap-4" id="nav-actions">
            
            {/* Manifesto button */}
            <button
              onClick={() => setShowManifestoModal(true)}
              className="px-3.5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border border-white/10 bg-white/5 hover:bg-white/10 hover:text-brand cursor-pointer flex items-center gap-2 font-mono h-10"
              id="show-manifesto-header-btn"
            >
              <BookOpen className="w-4 h-4 text-brand" />
              <span>Манифест</span>
            </button>

            {/* Philosophy button */}
            <button
              onClick={() => setShowPhilosophyModal(true)}
              className="px-3.5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border border-white/10 bg-white/5 hover:bg-white/10 hover:text-brand cursor-pointer flex items-center gap-2 font-mono h-10"
              id="show-philosophy-header-btn"
            >
              <Compass className="w-4 h-4 text-brand" />
              <span>Философия</span>
            </button>

            {/* Birthday Calendar button */}
            <button
              onClick={() => setShowBirthdayCalendar(true)}
              className="px-3.5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border border-white/10 bg-white/5 hover:bg-white/10 hover:text-brand cursor-pointer flex items-center gap-2 font-mono h-10"
              id="show-birthday-calendar-btn"
            >
              <Gift className="w-4 h-4 text-brand" />
              <span>Дни Рождения</span>
            </button>

            {/* Профиль участника — доступен всегда: внутри настройки,
                уведомления, снаряжение и питание, а не только прогресс. */}
            {/* Профиль — круглой иконкой-аватаром, как принято для личного
                кабинета: узнаётся без подписи и не тонет в ряду текстовых кнопок. */}
            <button
              onClick={() => setShowUserStats(true)}
              className="w-10 h-10 shrink-0 rounded-full bg-brand/15 border border-brand/30 hover:bg-brand/25 transition-all cursor-pointer flex items-center justify-center font-display font-black text-brand text-sm relative"
              id="show-user-stats-btn"
              title="Профиль"
              aria-label="Профиль"
            >
              {profileInitial}
              {activeRegistrations.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 bg-brand text-black font-black text-[9px] w-4 h-4 rounded-full flex items-center justify-center">
                  {activeRegistrations.length}
                </span>
              )}
            </button>

            {/* Admin Panel button - всегда виден */}
            <button
              onClick={() => setShowAdminPanel(true)}
              className="px-3.5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 cursor-pointer flex items-center gap-2 font-mono h-10"
              id="show-admin-panel-btn"
              title="Админ-панель"
            >
              <Shield className="w-4 h-4" />
              <span>Админ</span>
            </button>

            {/* Persistent registrations manager */}
            {activeRegistrations.length > 0 && (
              <button
                onClick={() => setShowMyRegistrationsModal(true)}
                className="bg-[#151515] hover:bg-[#1C1C1C] border border-white/10 text-white px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer relative group h-10"
                id="my-regs-btn"
              >
                <UserCheck className="w-4 h-4 text-brand" />
                <span>Мои Участия</span>
                <span className="bg-brand text-black font-black text-[10px] w-5 h-5 rounded-full flex items-center justify-center">
                  {activeRegistrations.length}
                </span>
                
                <span className="absolute -top-1 -right-1 flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-brand"></span>
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={() => openBot('https://t.me/campsflint_bot?start=support')}
              title="Написать в поддержку"
              className="bg-white/5 hover:bg-white/10 border border-white/10 text-white w-10 h-10 rounded-xl flex items-center justify-center cursor-pointer transition-all shrink-0"
            >
              <MessageCircle className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => openBot('https://t.me/campsflint_bot')}
              className="bg-brand hover:bg-brand-hover text-black px-4.5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest transition-all flex items-center gap-2 cursor-pointer font-bold h-10 shadow-lg shadow-brand/10 hover:shadow-brand/20 active:scale-98 border-none"
              id="tg-bot-main-btn"
            >
              <span>В Бот</span>
              <span className="font-mono text-[9px] text-black/50 hidden sm:inline">@campsflint_bot</span>
            </button>
          </div>

          {/* Mobile menu overlay */}
          {mobileMenuOpen && (
            <div
              className="fixed inset-0 top-20 z-50 bg-[#0A0A0A] md:hidden overflow-y-auto"
              onClick={() => setMobileMenuOpen(false)}
            >
              <div
                className="flex flex-col items-start gap-3 p-6 max-w-sm mx-auto"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => { setShowManifestoModal(true); setMobileMenuOpen(false); }}
                  className="w-full px-4 py-3.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border border-white/15 bg-[#1C1C1C] hover:bg-[#282828] hover:text-brand cursor-pointer flex items-center gap-3 font-mono"
                >
                  <BookOpen className="w-4 h-4 text-brand" />
                  Манифест
                </button>

                <button
                  onClick={() => { setShowPhilosophyModal(true); setMobileMenuOpen(false); }}
                  className="w-full px-4 py-3.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border border-white/15 bg-[#1C1C1C] hover:bg-[#282828] hover:text-brand cursor-pointer flex items-center gap-3 font-mono"
                >
                  <Compass className="w-4 h-4 text-brand" />
                  Философия
                </button>

                <button
                  onClick={() => { setShowBirthdayCalendar(true); setMobileMenuOpen(false); }}
                  className="w-full px-4 py-3.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border border-white/15 bg-[#1C1C1C] hover:bg-[#282828] hover:text-brand cursor-pointer flex items-center gap-3 font-mono"
                >
                  <Gift className="w-4 h-4 text-brand" />
                  Дни Рождения
                </button>

                {/* Admin button in mobile menu */}
                <button
                  onClick={() => { setShowAdminPanel(true); setMobileMenuOpen(false); }}
                  className="w-full px-4 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 cursor-pointer flex items-center gap-3 font-mono"
                >
                  <Shield className="w-4 h-4" />
                  Админ-панель
                </button>

                <button
                  onClick={() => { setShowUserStats(true); setMobileMenuOpen(false); }}
                  className="w-full px-4 py-3.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border border-white/15 bg-[#1C1C1C] hover:bg-[#282828] hover:text-brand cursor-pointer flex items-center gap-3 font-mono"
                >
                  <Trophy className="w-4 h-4 text-brand" />
                  Профиль{activeRegistrations.length > 0 ? ` (${activeRegistrations.length})` : ''}
                </button>

                {activeRegistrations.length > 0 && (
                  <button
                    onClick={() => { setShowMyRegistrationsModal(true); setMobileMenuOpen(false); }}
                    className="w-full px-4 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border border-white/10 bg-[#151515] hover:bg-white/10 cursor-pointer flex items-center gap-3 font-mono"
                  >
                    <UserCheck className="w-4 h-4 text-brand" />
                    Мои Участия
                    <span className="bg-brand text-black font-black text-[10px] w-5 h-5 rounded-full flex items-center justify-center ml-auto">
                      {activeRegistrations.length}
                    </span>
                  </button>
                )}

                <button
                  type="button"
                  className="w-full bg-brand hover:bg-brand-hover text-black px-4 py-3 rounded-xl text-xs font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2 font-bold shadow-lg shadow-brand/10 border-none cursor-pointer"
                  onClick={() => { openBot('https://t.me/campsflint_bot'); setMobileMenuOpen(false); }}
                >
                  <span>В Бот</span>
                  <span className="font-mono text-[9px] text-black/50">@campsflint_bot</span>
                </button>

                <button
                  type="button"
                  className="w-full px-4 py-3.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border border-white/15 bg-[#1C1C1C] hover:bg-[#282828] hover:text-brand cursor-pointer flex items-center gap-3 font-mono"
                  onClick={() => { openBot('https://t.me/campsflint_bot?start=support'); setMobileMenuOpen(false); }}
                >
                  <MessageCircle className="w-4 h-4 text-brand" />
                  Поддержка
                </button>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Central Content Canvas */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-10 relative z-10" id="main-content">
        
        {/* Compact Calendar Grid with no headers */}
        <section id="calendar-widget-block" className="pt-2">
          <CalendarGrid
            events={events}
            selectedEventId={selectedEventId}
            onSelectEvent={setSelectedEventId}
            onOpenDetail={setActiveDetailEvent}
          />
        </section>

        {/* Row 2: COMPONENT 2 - Featured Highlight Event Hero Card */}
        <section id="featured-hero-banner-block" className="pt-2">
          <InfoSection
            events={events}
            registeredEventIds={registeredEventIds}
            onRegisterClick={(evt) => setRegisteringEvent(evt)}
            onOpenManifesto={() => setShowManifestoModal(true)}
            onOpenDetails={(evt) => setActiveDetailEvent(evt)}
          />
        </section>

        {/* Row 3: COMPONENT 3 - Event Listing Filter Catalog */}
        <section id="event-feed-catalog" className="pt-6 border-t border-white/10">
          <EventFeed 
            events={events} 
            registeredEventIds={registeredEventIds}
            onRegisterClick={(evt) => setRegisteringEvent(evt)}
            selectedEventId={selectedEventId}
          />
        </section>

      </main>

      {/* Footer Block: «100% Чистота» Principles reminder */}
      <footer id="footer-sauce" className="bg-brand border-t border-brand-hover text-black py-12 mt-16 relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 text-center space-y-6 relative z-10">
          <div className="space-y-3">
            <span className="text-[11px] font-mono font-black uppercase tracking-[0.25em] text-black/60 block">ЖИВИ В МОМЕНТЕ • НАШ СОУС</span>
            <p className="font-display font-black text-xl sm:text-2xl md:text-3xl text-black max-w-4xl mx-auto leading-tight uppercase tracking-tight">
              «Только живое общение. 100% Чистота. Без алкоголя и фальши. Равенство, искренность и поддержка каждого»
            </p>
          </div>

          <div className="border-t border-black/10 pt-6 flex flex-col sm:flex-row items-center justify-between text-[11px] text-black/85 font-mono gap-4" id="footer-fine-print">
            <div>
              <span className="font-bold">© {new Date().getFullYear()} LIVE IN MOMENT BELARUS — SELF-DEVELOPMENT THROUGH DIALOGUE</span>
            </div>
            <div className="flex gap-4 font-black">
              <button onClick={() => setShowManifestoModal(true)} className="hover:underline bg-transparent border-none text-black p-0 cursor-pointer uppercase tracking-wider font-mono font-bold">СПИСОК ВЕКТОРОВ</button>
              <span>•</span>
              <button type="button" onClick={() => openBot('https://t.me/campsflint_bot')} className="hover:underline bg-transparent border-none p-0 cursor-pointer uppercase font-mono">ВСТУПИТЬ В БОТ</button>
            </div>
          </div>
        </div>
      </footer>

      {/* Popup Registration Modal Dialog */}
      {registeringEvent && (
        <RegistrationModal
          event={registeringEvent}
          isMember={gatePassed}
          onClose={() => setRegisteringEvent(null)}
          onSuccess={handleRegistrationSuccess}
        />
      )}

      {/* Философия клуба: инфографики пути развития и колеса баланса (модалка из шапки) */}
      <PhilosophyModal open={showPhilosophyModal} onClose={() => setShowPhilosophyModal(false)} />

      {/* CUSTOM POPUP MODAL 1: Community Core Manifesto & House of Persona Vectors */}
      {showManifestoModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" id="manifesto-modal-root">
          <div className="absolute inset-0 bg-black/85 backdrop-blur-md" onClick={() => setShowManifestoModal(false)} />
          
          <div className="bg-[#121212] rounded-3xl w-full max-w-2xl shadow-2xl relative z-10 border border-white/10 max-h-[85vh] overflow-y-auto flex flex-col text-white">
            
            {/* Header */}
            <div className="p-6 border-b border-white/10 flex justify-between items-start bg-[#181818] sticky top-0 z-10">
              <div>
                <span className="text-[10px] uppercase font-mono font-bold tracking-widest text-[#000] bg-brand px-2.5 py-1 rounded-full inline-block mb-1.5">
                  Манифест Сообщества
                </span>
                <h3 className="font-display font-black text-2xl text-white uppercase tracking-tight">
                  Пространство Живого Общения
                </h3>
                <p className="text-xs text-brand font-mono uppercase tracking-widest mt-0.5">
                  Живи в моменте • Минск
                </p>
              </div>
              <button 
                onClick={() => setShowManifestoModal(false)}
                className="p-1 px-3 py-1.5 rounded-xl text-white/40 hover:text-white font-mono uppercase tracking-wider text-xs cursor-pointer border border-white/10"
              >
                Закрыть
              </button>
            </div>

            {/* Inner Content */}
            <div className="p-6 space-y-6 text-sm leading-relaxed" id="manifesto-scroll-body">
              
              {/* Mission */}
              <div className="space-y-2">
                <h4 className="text-brand font-display font-black text-sm uppercase tracking-wider flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-brand" />
                  Кто мы и зачем мы собираемся?
                </h4>
                <p className="text-white/80 font-sans">
                  Мы строим сообщество осознанных людей в Беларуси. Место, где смывается привычная шелуха городских ролей. Наш фокус — здоровый отдых, глубокое психологическое развитие и неподдельная человеческая встреча мужчины и женщины.
                </p>
              </div>

              {/* Core Philosophy Pillar */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-white/10">
                <div className="bg-white/5 border border-white/5 rounded-2xl p-4 space-y-1.5">
                  <div className="text-[10px] text-brand uppercase font-mono font-bold tracking-widest">Культ Здоровья</div>
                  <div className="font-display font-black text-base uppercase text-white leading-tight">100% Чистота ума</div>
                  <p className="text-[11px] text-white/50 leading-normal">
                    Все перезагрузки проводятся без алкоголя, кальянов и измененных состояний сознания. Мы ищем настоящий дофамин присутствия.
                  </p>
                </div>

                <div className="bg-white/5 border border-white/5 rounded-2xl p-4 space-y-1.5">
                  <div className="text-[10px] text-brand uppercase font-mono font-bold tracking-widest">Инструмент силы</div>
                  <div className="font-display font-black text-base uppercase text-white leading-tight">Дом Личности</div>
                  <p className="text-[11px] text-white/50 leading-normal">
                    Каждое мероприятие клуба закаляет один из шести ключевых стержней характера (Предназначение, Воля, Совесть, Творчество, Любовь, Бытие).
                  </p>
                </div>
              </div>

              {/* The 6 Vectors breakdown */}
              <div className="space-y-4 pt-4 border-t border-white/15">
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#E6FD3A]" />
                  <span className="text-white/40 text-[10px] tracking-widest font-mono block uppercase">Векторы Развития (6 Стихий застройки)</span>
                </div>

                <div className="space-y-3">
                  {[
                    { key: 'foundation', title: '1. Предназначение (Фундамент) — Вектор жизни', desc: 'Осознание своей жизненной миссии, целей, глубокое понимание своего призвания и ориентиров в жизни.' },
                    { key: 'wall', title: '2. Воля (Стены) — Мужской Дух', desc: 'Плавление зажимов, баня дубовым веником, ледяная прорубь, честный разговор лицом к лицу без страха осуждений.' },
                    { key: 'roof', title: '3. Совесть (Крыша) — Интеллект', desc: 'Интеллектуальные дискуссионные баттлы, глубокий разбор прочитанного в читательском клубе, избавление от чужих клише.' },
                    { key: 'decor', title: '4. Творчество (Декор) — Эстетика', desc: 'Музыкальные джемы у ночного костра, лесные фотосессии, раскрытие природной харизмы и созидательность.' },
                    { key: 'heat', title: '5. Любовь (Тепло) — Союз', desc: 'Встречи мужчин и женщин в смешанных группах. Зеркало подсознания, построение гармоничных искренних союзов.' },
                    { key: 'life', title: '6. Счастье (Дзен / Жизнь в доме) — Бытие', desc: 'Медитации в тишине на каяках сплава, лесной трекинг, чистый воздух, слияние с естественными биоритмами Земли.' }
                  ].map((vec, i) => (
                    <div key={i} className="flex gap-3 p-3.5 rounded-2xl border transition-all bg-[#E6FD3A]/5 border-[#E6FD3A]/20 text-white">
                      <div className="p-1.5 rounded-xl border shrink-0 flex items-center justify-center h-9 w-9 bg-[#E6FD3A]/10 border-[#E6FD3A]/25 text-[#E6FD3A] drop-shadow-[0_0_8px_rgba(230,253,58,0.2)]">
                        {getVectorIconByKey(vec.key, false, 20)}
                      </div>
                      <div className="space-y-1 text-left">
                        <strong className="block text-xs uppercase font-mono tracking-wide text-[#E6FD3A]">{vec.title}</strong>
                        <p className="text-[11px] text-white/70 leading-normal font-sans">{vec.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Bot callout */}
              <div className="p-4 bg-brand/5 border border-brand/20 rounded-2xl flex items-start gap-3 text-xs text-brand leading-relaxed">
                <ShieldCheck className="w-5 h-5 shrink-0" />
                <div className="text-white/80">
                  <strong className="text-brand block uppercase tracking-wide font-bold mb-0.5">Готовы стать частью живого круга?</strong>
                  Активируйте нашего Telegram бота, чтобы пройти анкету соответствия ценностям сообщества и забронировать билет.
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="p-6 border-t border-white/10 bg-[#161616] flex flex-col sm:flex-row gap-3">
              <button 
                onClick={() => setShowManifestoModal(false)}
                className="flex-1 border border-white/15 py-3 rounded-xl text-xs font-bold uppercase tracking-widest text-white/70 hover:bg-white/5 transition-colors cursor-pointer font-mono bg-transparent"
              >
                Вернуться на главную
              </button>
              <button
                type="button"
                onClick={() => openBot('https://t.me/campsflint_bot')}
                className="flex-1 bg-brand hover:bg-brand-hover text-black py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all text-center flex items-center justify-center gap-1 shadow-md shadow-brand/10 hover:shadow-brand/20 cursor-pointer border-none"
              >
                Запустить бот
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CUSTOM: User Registrations Manager Modal */}
      {showMyRegistrationsModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" id="regs-modal-root">
          <div className="absolute inset-0 bg-black/85 backdrop-blur-sm" onClick={() => setShowMyRegistrationsModal(false)} />
          
          <div className="bg-[#121212] rounded-3xl w-full max-w-md shadow-2xl relative z-10 border border-white/10 p-6 space-y-5 text-white">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div>
                <h3 className="font-display font-black text-lg text-white uppercase tracking-wider">Календарный План</h3>
                <p className="text-xs text-brand font-mono uppercase tracking-widest mt-0.5">ВЫ ПОДТВЕРДИЛИ УЧАСТИЕ</p>
              </div>
              <button 
                onClick={() => setShowMyRegistrationsModal(false)}
                className="text-white/40 hover:text-white font-mono uppercase tracking-wider text-xs cursor-pointer border-none bg-transparent"
              >
                Закрыть
              </button>
            </div>

            <div className="space-y-3 max-h-60 overflow-y-auto pr-1" id="saved-regs-details">
              {activeRegistrations.length === 0 && (
                <p className="text-[11px] text-white/40 font-mono text-center py-6">
                  Актуальных участий нет. Прошедшие смотри в профиле → «События».
                </p>
              )}
              {activeRegistrations.map((reg, idx) => {
                const targetEvent = events.find(e => e.id === reg.eventId);
                if (!targetEvent) return null;
                return (
                  <div key={`${reg.eventId}-${idx}`} className="bg-[#181818] rounded-2xl p-4 border border-white/5 flex justify-between items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold text-white uppercase truncate">{targetEvent.title}</div>
                      <div className="text-[10px] text-brand font-mono uppercase tracking-wide mt-1">{targetEvent.dateLabel}</div>
                      <div className="text-[10px] text-white/40 mt-0.5 truncate">Локация: {targetEvent.location}</div>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <span className="bg-brand/15 text-brand border border-brand/25 text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider font-mono">Активен</span>
                      <button
                        onClick={() => handleDeleteRegistration(reg.eventId)}
                        className="text-rose-400 hover:text-rose-300 p-1 px-2 rounded hover:bg-rose-500/10 transition-colors border-none bg-transparent cursor-pointer flex items-center gap-1 text-[9px] uppercase font-mono font-bold"
                        title="Удалить из моих регистраций"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Удалить</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="pt-4 border-t border-white/10 flex flex-col gap-2 font-mono">
              <button
                onClick={handleClearRegistrations}
                className="w-full border border-rose-500/30 hover:bg-rose-500/10 text-rose-400 py-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer bg-transparent"
                id="delete-all-regs-btn"
              >
                <Trash2 className="w-4 h-4" />
                Сбросить мои регистрации
              </button>
              <button
                onClick={() => setShowMyRegistrationsModal(false)}
                className="w-full bg-brand text-black hover:bg-brand-hover transition-colors py-3 rounded-xl text-xs font-bold uppercase tracking-widest cursor-pointer border-none"
              >
                Вернуться к событиям
              </button>
            </div>
          </div>
        </div>
      )}
      {/* FLY-OUT DETAILS MODAL FROM HERO ACTIONS */}
      {activeDetailEvent && (
        <EventDetailModal
          event={activeDetailEvent}
          isRegistered={registeredEventIds.includes(activeDetailEvent.id)}
          isClubMember={clubApproved === true}
          onClose={() => setActiveDetailEvent(null)}
          onRegisterClick={(evt) => setRegisteringEvent(evt)}
        />
      )}

      {/* VERIFICATION MODAL */}
      {verifyingEvent && (
        <VerificationModal
          eventId={verifyingEvent.id}
          eventTitle={verifyingEvent.title}
          requiresOnboarding={verifyingEvent.needsOnboarding || false}
          onClose={() => setVerifyingEvent(null)}
          onSubmit={(data) => {
            setVerificationData(data);
            console.log('Verification submitted:', data);
            setVerifyingEvent(null);
          }}
        />
      )}

      {/* BIRTHDAY CALENDAR MODAL */}
      {showBirthdayCalendar && (
        <BirthdayCalendar
          birthdays={birthdays}
          onClose={() => setShowBirthdayCalendar(false)}
          onAddBirthday={(newBirthday) => {
            const updated = [...birthdays, newBirthday];
            setBirthdays(updated);
            localStorage.setItem('moment_birthdays', JSON.stringify(updated));
          }}
        />
      )}

      {/* FEEDBACK MODAL */}
      {feedbackEvent && (
        <FeedbackModal
          eventId={feedbackEvent.id}
          eventTitle={feedbackEvent.title}
          onClose={() => setFeedbackEvent(null)}
          onSubmit={async (data) => {
            await submitFeedback({
              eventId: data.eventId,
              eventTitle: feedbackEvent.title,
              rating: data.rating,
              wouldReturn: data.wouldReturn,
              feedback: data.feedback,
            });
            setFeedbackEvent(null);
          }}
        />
      )}

      {/* ПРОФИЛЬ УЧАСТНИКА */}
      {showUserStats && (
        <ProfileScreen initialTab={profileTab} onClose={() => { setShowUserStats(false); setProfileTab('overview'); }} />
      )}

      {/* EVENT POSTER MODAL */}
      {posterEvent && (
        <EventPoster
          event={posterEvent}
          onClose={() => setPosterEvent(null)}
        />
      )}

      {/* ADMIN PANEL MODAL */}
      {showAdminPanel && (
        <AdminPanel
          events={events}
          onUpdateEvent={(updated) => adminSaveEvent(updated, false)}
          onAddEvent={(newEvent) => adminSaveEvent(newEvent, true)}
          onDeleteEvent={(eventId) => adminDeleteEvent(eventId)}
          onClose={() => setShowAdminPanel(false)}
        />
      )}
    </div>
  );
}