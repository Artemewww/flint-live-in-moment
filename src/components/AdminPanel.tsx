import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Lock, Unlock, Calendar, Users, Edit, Save, Plus, Trash2, Eye, EyeOff, Shield, RefreshCw, Send, CheckCircle, XCircle, BarChart3, MapPin, Package, DollarSign, Clock, FileText, Settings, Bell, UserCheck, UserX, ClipboardList, Truck, Flag, Play, Pause, X as XIcon, RotateCcw, ShoppingCart, ChefHat, Tent, Navigation, Award, MessageSquare, Star, UserPlus, UserMinus, Globe, Key, CheckSquare, Square, Activity } from 'lucide-react';
import { CommunityEvent } from '../types';

const ADMIN_TOKEN = 'flint-admin-2026';
const API_BASE = typeof window !== 'undefined' ? window.location.origin + '/api' : '';

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
    inventory: r.inventory || [],
    inviter: r.inviter || '',
    category: r.category || '',
    dietary: r.dietary || '',
    guestCount: r.guest_count || 0,
  };
}

// Считаем статистику по заявкам единообразно на клиенте.
function buildStats(regs: any[]) {
  return {
    total: regs.length,
    confirmed: regs.filter((r) => r.status === 'confirmed').length,
    pending: regs.filter((r) => r.status === 'pending').length,
    payments: regs.filter((r) => r.paymentStatus === 'paid').length,
    totalAmount: regs.reduce((s, r) => s + (r.paymentAmount || 0), 0),
    registrations: regs,
  };
}

interface AdminPanelProps {
  events: CommunityEvent[];
  onUpdateEvent: (event: CommunityEvent) => void;
  onAddEvent: (event: CommunityEvent) => void;
  onDeleteEvent: (eventId: string) => void;
  onClose: () => void;
}

export default function AdminPanel({ events, onUpdateEvent, onAddEvent, onDeleteEvent, onClose }: AdminPanelProps) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [editingEvent, setEditingEvent] = useState<CommunityEvent | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [broadcasting, setBroadcasting] = useState<string | null>(null);
  const [broadcastResult, setBroadcastResult] = useState<{eventId: string, success: boolean, message: string} | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<CommunityEvent | null>(null);
  const [eventStats, setEventStats] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'participants' | 'logistics' | 'settings'>('overview');
  const [showTemplates, setShowTemplates] = useState(false);

  const ADMIN_PASSWORD = 'flint-admin-2026';

  // Шаблоны мероприятий
  const eventTemplates = [
    {
      title: 'Мужская баня FLINT',
      type: 'male' as const,
      time: '19:00',
      timeEnd: '23:00',
      maxParticipants: 12,
      priceLabel: 'Аренда делится на всех • при 10+ ≈ 50 ₽/чел',
      priceAmount: 500,
      entryThreshold: 'Только мужчины • 100% трезвость • личный веник',
      entryType: 'male' as const,
      description: 'Каноническая перезагрузка ума и тела. Профессиональный пар, закалка ледяной купелью, глубокий прогрев дубовыми вениками и честные разговоры по душам у открытого камина.',
      image: '/assets/images/nano_banya_flint_1780473778276.png',
      program: [
        '18:30 - Сбор, знакомство',
        '19:00 - Парилка (дубовые веники)',
        '20:30 - Перекус, чай',
        '21:00 - Честные разговоры у камина',
        '23:00 - Завершение'
      ]
    },
    {
      title: 'Гиревой вояж у воды',
      type: 'active' as const,
      time: '10:00',
      timeEnd: '12:00',
      maxParticipants: 15,
      priceLabel: 'На совесть',
      priceAmount: 0,
      entryThreshold: '100% трезвость • спортивная форма',
      entryType: 'all' as const,
      description: 'Утренняя силовая пробежка у Минского моря. Гири, зарядка, свежий воздух.',
      image: '/assets/images/kettlebell_walk.png',
      program: [
        '10:00 - Сбор, разминка',
        '10:15 - Силовая тренировка',
        '11:30 - Закалка, купание',
        '12:00 - Завершение'
      ]
    },
    {
      title: 'Экзистенциальный Кинотеатр',
      type: 'intellectual' as const,
      time: '19:30',
      timeEnd: '22:00',
      maxParticipants: 20,
      priceLabel: 'На совесть',
      priceAmount: 0,
      entryThreshold: '100% трезвость',
      entryType: 'all' as const,
      description: 'Рефлексия и глубокий разбор великих кинокартин. Философские дискуссии после просмотра.',
      image: '/assets/images/cinema.png',
      program: [
        '19:30 - Знакомство',
        '19:45 - Просмотр фильма',
        '21:30 - Философская дискуссия',
        '22:00 - Завершение'
      ]
    },
    {
      title: 'Читательский круг "Смыслы"',
      type: 'intellectual' as const,
      time: '16:00',
      timeEnd: '19:00',
      maxParticipants: 15,
      priceLabel: 'На совесть',
      priceAmount: 0,
      entryThreshold: '100% трезвость • книга прочитана',
      entryType: 'all' as const,
      description: 'Интеллектуальный разбор психологических трудов. Глубокие вопросы и честные ответы.',
      image: '/assets/images/reading.png',
      program: [
        '16:00 - Знакомство',
        '16:15 - Обсуждение книги',
        '17:30 - Глубокие вопросы',
        '19:00 - Завершение'
      ]
    },
    {
      title: 'Лесной поход к Ислочи',
      type: 'active' as const,
      time: '08:00',
      timeEnd: '20:00',
      maxParticipants: 12,
      priceLabel: 'Аренда делится на всех',
      priceAmount: 300,
      entryThreshold: '100% трезвость • спортивная форма • палатка',
      entryType: 'all' as const,
      description: 'Проводники, дикий костер и лесные переходы. Полный день на природе.',
      image: '/assets/images/hiking.png',
      program: [
        '08:00 - Сбор, выезд',
        '10:00 - Начало перехода',
        '13:00 - Обед у костра',
        '16:00 - Осмотр достопримечательностей',
        '18:00 - Возвращение',
        '20:00 - Завершение'
      ]
    },
    {
      title: 'Покерный заезд "Трезвый круг"',
      type: 'mixed' as const,
      time: '18:00',
      timeEnd: '23:00',
      maxParticipants: 16,
      priceLabel: 'На совесть',
      priceAmount: 0,
      entryThreshold: '100% трезвость',
      entryType: 'all' as const,
      description: 'Тлеющие угольки, мандарины, апельсиновый сок и глубокая математика.',
      image: '/assets/images/poker.png',
      program: [
        '18:00 - Знакомство, раздача карт',
        '18:30 - Турнир',
        '21:00 - Перерыв, угощения',
        '21:30 - Финальный стол',
        '23:00 - Завершение'
      ]
    }
  ];

  const createFromTemplate = (template: typeof eventTemplates[0]) => {
    const eventDate = new Date();
    eventDate.setDate(eventDate.getDate() + 7); // +7 дней
    
    const newEvent: CommunityEvent = {
      id: `event-${Date.now()}`,
      title: template.title,
      description: template.description,
      type: template.type,
      date: eventDate.toISOString().split('T')[0],
      dateLabel: `Через 7 дней (${eventDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' })})`,
      time: template.time || '19:00',
      timeEnd: template.timeEnd || '23:00',
      location: 'Уточняется',
      painPoint: '',
      houseQualities: [],
      image: template.image || '/assets/images/default_event.png',
      maxParticipants: template.maxParticipants,
      participantsCount: 0,
      telegramBotUrl: 'https://t.me/campsflint_bot',
      priceType: 'conscience',
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

  const handleLogin = () => {
    if (password === ADMIN_PASSWORD) {
      setIsAuthenticated(true);
    } else {
      alert('Неверный пароль');
    }
  };

  const toggleEventStatus = (event: CommunityEvent) => {
    const newStatus = event.status === 'open' ? 'locked' : 'open';
    onUpdateEvent({ ...event, status: newStatus });
  };

  const updateParticipants = (event: CommunityEvent, count: number) => {
    onUpdateEvent({ ...event, participantsCount: count });
  };

  const loadEventStats = async (event: CommunityEvent) => {
    setSelectedEvent(event);
    
    try {
      // Загружаем заявки из API (Supabase)
      const res = await fetch(`/api/admin/registrations?eventId=${encodeURIComponent(event.id)}`, {
        headers: { 'Authorization': `Bearer ${ADMIN_TOKEN}` }
      });

      if (res.ok) {
        const data = await res.json();
        const regs = (data.registrations || []).map(mapRegistration);
        setEventStats(buildStats(regs));
        setActiveTab('overview');
        return;
      }
    } catch (err) {
      console.error('Failed to load from API, using localStorage:', err);
    }
    
    // Fallback на localStorage
    const registrations = JSON.parse(localStorage.getItem('event_registrations') || '[]');
    const eventRegs = registrations.filter((r: any) => r.eventId === event.id);
    
    const stats = {
      total: eventRegs.length,
      confirmed: eventRegs.filter((r: any) => r.status === 'confirmed').length,
      pending: eventRegs.filter((r: any) => r.status === 'pending').length,
      payments: eventRegs.filter((r: any) => r.paymentStatus === 'paid').length,
      totalAmount: eventRegs.reduce((sum: number, r: any) => sum + (r.paymentAmount || 0), 0),
      registrations: eventRegs
    };
    
    setEventStats(stats);
    setActiveTab('overview');
  };

  const broadcastEvent = async (event: CommunityEvent) => {
    setBroadcasting(event.id);
    setBroadcastResult(null);
    try {
      // Рассылка идёт на сервере (токен бота не в браузере, безопасно).
      const res = await fetch('/api/admin/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ADMIN_TOKEN}` },
        body: JSON.stringify({ eventId: event.id }),
      });
      const data = await res.json().catch(() => ({}));
      setBroadcastResult({
        eventId: event.id,
        success: !!data.ok,
        message: data.ok
          ? `Отправлено ${data.sent}/${data.total} участникам`
          : (data.message || data.error || 'Некому слать (нет Telegram-получателей)'),
      });
      setTimeout(() => setBroadcastResult(null), 6000);
    } catch (error) {
      setBroadcastResult({ eventId: event.id, success: false, message: 'Ошибка рассылки' });
    } finally {
      setBroadcasting(null);
    }
  };

  // Обновить статус/оплату участника и обновить список.
  const patchRegistration = async (reg: any, patch: Record<string, unknown>) => {
    try {
      await fetch(`/api/admin/registrations?registrationId=${encodeURIComponent(reg.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ADMIN_TOKEN}` },
        body: JSON.stringify(patch),
      });
    } catch (err) {
      console.error('Ошибка обновления участника:', err);
    }
    if (selectedEvent) loadEventStats(selectedEvent);
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
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Пароль"
              className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white text-sm focus:outline-none focus:border-brand/40"
              onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
            />
            <button
              onClick={handleLogin}
              className="w-full bg-brand hover:bg-brand-hover text-black py-3 rounded-xl text-xs font-bold uppercase tracking-widest"
            >
              Войти
            </button>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" id="admin-panel-root">
      <div className="absolute inset-0 bg-black/90 backdrop-blur-md" onClick={onClose} />

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-[#121212] rounded-3xl w-full max-w-6xl shadow-2xl relative z-10 border border-white/10 flex flex-col max-h-[90vh] text-white"
      >
        {/* Header */}
        <div className="p-6 border-b border-white/10 flex items-center justify-between">
          <div>
            <h2 className="font-display font-black text-2xl uppercase">Админ-панель</h2>
            <p className="text-xs text-brand font-mono uppercase">Полное управление мероприятиями</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full bg-white/5 hover:bg-white/10"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Events List Sidebar */}
          <div className="w-80 border-r border-white/10 overflow-y-auto p-4 space-y-3">
            <div className="flex items-center justify-between mb-4">
              <span className="text-white/40 text-[10px] uppercase font-mono">Мероприятия: {events.length}</span>
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

            {events.map(event => (
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
                
                <p className="text-[10px] text-white/60 mb-2">{event.dateLabel}</p>
                
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
            ))}
          </div>

          {/* Event Details Panel */}
          <div className="flex-1 overflow-y-auto p-6">
            {!selectedEvent ? (
              <div className="flex flex-col items-center justify-center h-full text-white/40">
                <Calendar className="w-16 h-16 mb-4" />
                <p className="text-sm">Выберите мероприятие для управления</p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Event Header */}
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-display font-black text-xl uppercase mb-1">{selectedEvent.title}</h3>
                    <p className="text-xs text-white/60">{selectedEvent.dateLabel} • {selectedEvent.location}</p>
                  </div>
                  <div className="flex gap-2">
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
                <div className="flex gap-2 border-b border-white/10 pb-3">
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
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <Users className="w-4 h-4 text-brand" />
                          <span className="text-[10px] text-white/60 uppercase font-mono">Участники</span>
                        </div>
                        <p className="text-2xl font-black">{eventStats.total}</p>
                        <p className="text-xs text-white/40">из {selectedEvent.maxParticipants} мест</p>
                      </div>

                      <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <DollarSign className="w-4 h-4 text-brand" />
                          <span className="text-[10px] text-white/60 uppercase font-mono">Оплата</span>
                        </div>
                        <p className="text-2xl font-black">{eventStats.payments}</p>
                        <p className="text-xs text-white/40">{eventStats.totalAmount} ₽ собрано</p>
                      </div>

                      <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <CheckSquare className="w-4 h-4 text-brand" />
                          <span className="text-[10px] text-white/60 uppercase font-mono">Подтверждено</span>
                        </div>
                        <p className="text-2xl font-black">{eventStats.confirmed}</p>
                        <p className="text-xs text-white/40">{eventStats.pending} ожидают</p>
                      </div>

                      <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <Activity className="w-4 h-4 text-brand" />
                          <span className="text-[10px] text-white/60 uppercase font-mono">Готовность</span>
                        </div>
                        <p className="text-2xl font-black">{Math.round((eventStats.confirmed / (selectedEvent.maxParticipants || 1)) * 100)}%</p>
                        <div className="w-full bg-white/10 rounded-full h-2 mt-2">
                          <div 
                            className="bg-brand h-2 rounded-full transition-all"
                            style={{ width: `${(eventStats.confirmed / (selectedEvent.maxParticipants || 1)) * 100}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Checklist */}
                    <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                      <h4 className="text-xs font-bold uppercase mb-3 flex items-center gap-2">
                        <CheckSquare className="w-4 h-4 text-brand" />
                        Готовность мероприятия
                      </h4>
                      <div className="space-y-2">
                        {[
                          'Голосование за программу завершено',
                          'Программа согласована и разослана',
                          'Меню питания утверждено',
                          'Закупщик найден или закупка распределена',
                          'Закупка выполнена и подтверждена',
                          'Координаты лагеря разосланы участникам',
                          'Мероприятие стартовало',
                          'Мероприятие завершено',
                          'Отзывы собраны'
                        ].map((item, idx) => (
                          <div key={idx} className="flex items-center gap-2 text-xs">
                            <Square className="w-4 h-4 text-white/30" />
                            <span className="text-white/60">{item}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'participants' && eventStats && (
                  <div className="space-y-4">
                    <div className="flex gap-2 mb-4">
                      <button className="bg-brand/20 text-brand px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1">
                        <UserCheck className="w-3 h-3" />
                        Кто приехал
                      </button>
                      <button className="bg-white/5 text-white/60 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 hover:bg-white/10">
                        <Star className="w-3 h-3" />
                        Отзывы
                      </button>
                      <button className="bg-white/5 text-white/60 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 hover:bg-white/10">
                        <CheckSquare className="w-3 h-3" />
                        Подтвердить явку
                      </button>
                    </div>

                    <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                      <div className="p-3 border-b border-white/10">
                        <h4 className="text-xs font-bold uppercase">Список участников ({eventStats.total})</h4>
                      </div>
                      <div className="max-h-96 overflow-y-auto">
                        {eventStats.registrations.length === 0 ? (
                          <div className="p-6 text-center text-white/40 text-xs">
                            Пока нет зарегистрированных участников
                          </div>
                        ) : (
                          eventStats.registrations.map((reg: any, idx: number) => (
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
                                <div className={`p-2 rounded-lg border ${
                                  reg.hasTransport ? 'bg-brand/10 border-brand/30' : 'bg-white/5 border-white/10'
                                }`}>
                                  <div className="flex items-center gap-1 mb-1">
                                    <Truck className="w-3 h-3 text-brand" />
                                    <span className="text-[9px] font-bold uppercase">Транспорт</span>
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

                              <div className="flex gap-1 mt-2">
                                <button
                                  onClick={() => patchRegistration(reg, { status: reg.status === 'confirmed' ? 'pending' : 'confirmed' })}
                                  className={`flex-1 p-1.5 rounded-lg text-[9px] font-bold uppercase transition-all ${reg.status === 'confirmed' ? 'bg-brand/20 text-brand' : 'bg-white/5 hover:bg-white/10 text-white/60 hover:text-white'}`}
                                  title="Подтвердить участие"
                                >
                                  {reg.status === 'confirmed' ? '✓ Подтверждён' : 'Подтвердить'}
                                </button>
                                <button
                                  onClick={() => patchRegistration(reg, { paymentStatus: reg.paymentStatus === 'paid' ? 'pending' : 'paid' })}
                                  className={`flex-1 p-1.5 rounded-lg text-[9px] font-bold uppercase transition-all ${reg.paymentStatus === 'paid' ? 'bg-brand/20 text-brand' : 'bg-white/5 hover:bg-white/10 text-white/60 hover:text-white'}`}
                                  title="Отметить оплату"
                                >
                                  {reg.paymentStatus === 'paid' ? '✓ Оплачено' : 'Оплата'}
                                </button>
                                <button
                                  onClick={async () => {
                                    if (confirm(`Удалить участника ${reg.name}?`)) {
                                      // Пробуем удалить через API
                                      try {
                                        await fetch(`/api/admin/registrations?registrationId=${encodeURIComponent(reg.id)}`, {
                                          method: 'DELETE',
                                          headers: { 'Authorization': `Bearer ${ADMIN_TOKEN}` }
                                        });
                                      } catch (err) {
                                        console.error('API delete failed, using localStorage:', err);
                                        // Fallback на localStorage
                                        const regs = JSON.parse(localStorage.getItem('event_registrations') || '[]');
                                        const updated = regs.filter((r: any) => r.id !== reg.id);
                                        localStorage.setItem('event_registrations', JSON.stringify(updated));
                                      }
                                      loadEventStats(selectedEvent);
                                    }
                                  }}
                                  className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400"
                                  title="Принудительно удалить"
                                >
                                  <UserMinus className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'logistics' && eventStats && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <button className="bg-white/5 border border-white/10 rounded-xl p-4 text-left hover:bg-white/10 transition-all">
                        <ShoppingCart className="w-6 h-6 text-brand mb-2" />
                        <p className="text-xs font-bold uppercase">Список закупки</p>
                        <p className="text-[10px] text-white/40 mt-1">Управление закупками</p>
                      </button>

                      <button className="bg-white/5 border border-white/10 rounded-xl p-4 text-left hover:bg-white/10 transition-all">
                        <ChefHat className="w-6 h-6 text-brand mb-2" />
                        <p className="text-xs font-bold uppercase">Распределить готовку</p>
                        <p className="text-[10px] text-white/40 mt-1">Назначить ответственных</p>
                      </button>

                      <button className="bg-white/5 border border-white/10 rounded-xl p-4 text-left hover:bg-white/10 transition-all">
                        <Tent className="w-6 h-6 text-brand mb-2" />
                        <p className="text-xs font-bold uppercase">Первый заезд</p>
                        <p className="text-[10px] text-white/40 mt-1">Подготовка лагеря</p>
                      </button>

                      <button className="bg-white/5 border border-white/10 rounded-xl p-4 text-left hover:bg-white/10 transition-all">
                        <Navigation className="w-6 h-6 text-brand mb-2" />
                        <p className="text-xs font-bold uppercase">Авто-выдача точек</p>
                        <p className="text-[10px] text-white/40 mt-1">ВКЛ / ВЫКЛ</p>
                      </button>

                      <button className="bg-white/5 border border-white/10 rounded-xl p-4 text-left hover:bg-white/10 transition-all">
                        <MapPin className="w-6 h-6 text-brand mb-2" />
                        <p className="text-xs font-bold uppercase">Координаты</p>
                        <p className="text-[10px] text-white/40 mt-1">Отправить участникам</p>
                      </button>

                      <button className="bg-white/5 border border-white/10 rounded-xl p-4 text-left hover:bg-white/10 transition-all">
                        <Package className="w-6 h-6 text-brand mb-2" />
                        <p className="text-xs font-bold uppercase">Общее снаряжение</p>
                        <p className="text-[10px] text-white/40 mt-1">Список и статус</p>
                      </button>
                    </div>

                    {/* Транспортный план */}
                    <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                      <h4 className="text-xs font-bold uppercase mb-3 flex items-center gap-2">
                        <Truck className="w-4 h-4 text-brand" />
                        Транспортный план
                      </h4>
                      <div className="space-y-2">
                        {eventStats.registrations.filter((r: any) => r.hasTransport).length === 0 ? (
                          <p className="text-[10px] text-white/40">Пока нет участников с транспортом</p>
                        ) : (
                          eventStats.registrations
                            .filter((r: any) => r.hasTransport)
                            .map((reg: any, idx: number) => (
                              <div key={idx} className="bg-white/5 rounded-lg p-3 flex items-center justify-between">
                                <div>
                                  <p className="text-xs font-bold">{reg.name || 'Гость'}</p>
                                  <p className="text-[10px] text-white/60">{reg.transportDetails || 'Автомобиль'}</p>
                                </div>
                                <div className="text-right">
                                  <p className="text-xs font-bold text-brand">{reg.transportSeats || 0} мест</p>
                                  <p className="text-[9px] text-white/40">Свободно: {Math.max(0, (reg.transportSeats || 0) - 1)}</p>
                                </div>
                              </div>
                            ))
                        )}
                      </div>
                    </div>

                    {/* Общий инвентарь */}
                    <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                      <h4 className="text-xs font-bold uppercase mb-3 flex items-center gap-2">
                        <Package className="w-4 h-4 text-brand" />
                        Общий инвентарь участников
                      </h4>
                      <div className="space-y-2">
                        {(() => {
                          const allInventory = eventStats.registrations
                            .filter((r: any) => r.inventory && r.inventory.length > 0)
                            .flatMap((r: any) => r.inventory);
                          
                          if (allInventory.length === 0) {
                            return <p className="text-[10px] text-white/40">Пока нет заявленного инвентаря</p>;
                          }

                          const uniqueItems = Array.from(new Set(allInventory)) as string[];
                          return uniqueItems.map((item, idx: number) => (
                            <div key={idx} className="bg-white/5 rounded-lg p-2 flex items-center justify-between">
                              <span className="text-xs">{item}</span>
                              <span className="text-[10px] text-brand font-mono">
                                {allInventory.filter((i: string) => i === item).length} шт.
                              </span>
                            </div>
                          ));
                        })()}
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'settings' && (
                  <div className="space-y-4">
                    <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
                      <h4 className="text-xs font-bold uppercase mb-3">Управление мероприятием</h4>
                      
                      <div className="grid grid-cols-2 gap-2">
                        <button className="bg-white/5 hover:bg-white/10 text-white/60 hover:text-white p-3 rounded-lg text-xs font-bold uppercase flex items-center justify-center gap-2">
                          <Play className="w-4 h-4" />
                          Стартовать
                        </button>
                        <button className="bg-white/5 hover:bg-white/10 text-white/60 hover:text-white p-3 rounded-lg text-xs font-bold uppercase flex items-center justify-center gap-2">
                          <Pause className="w-4 h-4" />
                          Приостановить
                        </button>
                        <button className="bg-brand/20 hover:bg-brand/30 text-brand p-3 rounded-lg text-xs font-bold uppercase flex items-center justify-center gap-2">
                          <CheckCircle className="w-4 h-4" />
                          Завершить
                        </button>
                        <button className="bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 p-3 rounded-lg text-xs font-bold uppercase flex items-center justify-center gap-2">
                          <XIcon className="w-4 h-4" />
                          Отменить
                        </button>
                      </div>
                    </div>

                    <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
                      <h4 className="text-xs font-bold uppercase mb-3">Доступ и публичность</h4>
                      
                      <button className="w-full bg-white/5 hover:bg-white/10 text-white/60 hover:text-white p-3 rounded-lg text-xs font-bold uppercase flex items-center justify-center gap-2">
                        <Globe className="w-4 h-4" />
                        Сделать публичным
                      </button>

                      <button className="w-full bg-white/5 hover:bg-white/10 text-white/60 hover:text-white p-3 rounded-lg text-xs font-bold uppercase flex items-center justify-center gap-2">
                        <Key className="w-4 h-4" />
                        Сменить код доступа
                      </button>

                      <button className="w-full bg-white/5 hover:bg-white/10 text-white/60 hover:text-white p-3 rounded-lg text-xs font-bold uppercase flex items-center justify-center gap-2">
                        <UserPlus className="w-4 h-4" />
                        Заместитель на мероприятие
                      </button>
                    </div>

                    <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
                      <h4 className="text-xs font-bold uppercase mb-3">Участники</h4>
                      
                      <button className="w-full bg-white/5 hover:bg-white/10 text-white/60 hover:text-white p-3 rounded-lg text-xs font-bold uppercase flex items-center justify-center gap-2">
                        <MessageSquare className="w-4 h-4" />
                        Важное объявление всем
                      </button>

                      <button className="w-full bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 p-3 rounded-lg text-xs font-bold uppercase flex items-center justify-center gap-2">
                        <UserMinus className="w-4 h-4" />
                        Удалить без возврата
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </motion.div>

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
            }}
          />
        )}
      </AnimatePresence>

      {/* Templates Modal */}
      <AnimatePresence>
        {showTemplates && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4" id="templates-modal">
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

              <p className="text-xs text-white/60 mb-4">Выберите шаблон для быстрого создания мероприятия</p>

              <div className="grid grid-cols-2 gap-3 max-h-[60vh] overflow-y-auto">
                {eventTemplates.map((template, idx) => (
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
function EditEventModal({ event, onClose, onSave }: {
  event: CommunityEvent;
  onClose: () => void;
  onSave: (event: CommunityEvent) => void;
}) {
  const [formData, setFormData] = useState({
    title: event.title,
    description: event.description,
    date: event.date,
    dateLabel: event.dateLabel,
    time: event.time || '',
    timeEnd: event.timeEnd || '',
    location: event.location,
    locationDetails: event.locationDetails || '',
    coordinates: event.coordinates || { lat: 0, lng: 0 },
    maxParticipants: event.maxParticipants,
    participantsCount: event.participantsCount,
    status: event.status || 'open',
    priceType: event.priceType || 'conscience',
    priceLabel: event.priceLabel || 'На совесть',
    priceAmount: event.priceAmount || 0,
    entryThreshold: event.entryThreshold || '',
    entryType: event.entryType || 'all'
  });

  // Гибкая цена: бесплатно / на совесть / платно (аренда делится поровну на всех).
  const computedPriceLabel = () => {
    if (formData.priceType === 'free') return 'Бесплатно';
    if (formData.priceType === 'paid' && formData.priceAmount > 0) {
      const per = formData.maxParticipants
        ? ` • при ${formData.maxParticipants} ≈ ${Math.round(formData.priceAmount / formData.maxParticipants)} ₽/чел`
        : '';
      return `Аренда ${formData.priceAmount} ₽ — делится поровну на всех${per}`;
    }
    return 'На совесть';
  };

  const handleSave = () => {
    onSave({
      ...event,
      title: formData.title,
      description: formData.description,
      date: formData.date,
      dateLabel: formData.dateLabel,
      time: formData.time,
      timeEnd: formData.timeEnd,
      location: formData.location,
      locationDetails: formData.locationDetails,
      coordinates: formData.coordinates,
      maxParticipants: formData.maxParticipants,
      participantsCount: formData.participantsCount,
      status: formData.status,
      priceType: formData.priceType,
      priceLabel: computedPriceLabel(),
      priceAmount: formData.priceType === 'free' ? 0 : formData.priceAmount,
      entryThreshold: formData.entryThreshold,
      entryType: formData.entryType
    });
  };

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center p-4" id="edit-event-modal">
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

          <div>
            <label className="text-[10px] text-white/40 uppercase font-mono block mb-1">
              Дата *
            </label>
            <input
              type="date"
              value={formData.date}
              onChange={(e) => setFormData({...formData, date: e.target.value})}
              className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white"
            />
          </div>


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
                <option value="free">Бесплатно</option>
                <option value="conscience">На совесть</option>
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
                Сумма аренды (₽) — делится поровну на всех
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

          <div>
            <label className="text-[10px] text-white/40 uppercase font-mono block mb-1">
              Порог входа
            </label>
            <input
              type="text"
              value={formData.entryThreshold}
              onChange={(e) => setFormData({...formData, entryThreshold: e.target.value})}
              className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white"
              placeholder="Например: 100% трезвость • личный веник"
            />
          </div>

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

// Add Event Modal
function AddEventModal({ onClose, onAdd }: {
  onClose: () => void;
  onAdd: (event: CommunityEvent) => void;
}) {
  const [formData, setFormData] = useState({
    title: '',
    date: '',
    dateLabel: '',
    time: '',
    timeEnd: '',
    location: '',
    type: 'mixed' as CommunityEvent['type'],
    maxParticipants: 15,
    description: '',
    priceLabel: 'На совесть',
    priceAmount: 0,
    entryThreshold: '100% Трезвость',
    entryType: 'all' as 'male' | 'female' | 'all'
  });

  const handleAdd = () => {
    if (!formData.title || !formData.date) return;

    const newEvent: CommunityEvent = {
      id: `event-${Date.now()}`,
      title: formData.title,
      description: formData.description || 'Описание будет добавлено позже',
      type: formData.type,
      date: formData.date,
      dateLabel: formData.dateLabel || formData.date,
      time: formData.time,
      timeEnd: formData.timeEnd,
      location: formData.location,
      painPoint: '',
      houseQualities: [],
      image: '/assets/images/default_event.png',
      maxParticipants: formData.maxParticipants,
      participantsCount: 0,
      telegramBotUrl: 'https://t.me/campsflint_bot',
      priceType: 'conscience',
      priceLabel: formData.priceLabel,
      priceAmount: formData.priceAmount,
      entryThreshold: formData.entryThreshold,
      entryType: formData.entryType,
      status: 'locked',
      program: [],
      notifications: {
        reminder7d: true,
        reminder3d: true,
        reminder1d: true,
        reminder3h: true,
        reminder1h: true
      }
    };

    onAdd(newEvent);
  };

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center p-4" id="add-event-modal">
      <div className="absolute inset-0 bg-black/95" onClick={onClose} />

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-[#121212] rounded-3xl w-full max-w-md shadow-2xl relative z-10 border border-white/10 p-6 space-y-4"
      >
        <h3 className="font-bold text-lg uppercase">Новое мероприятие</h3>

        <div className="space-y-3">
          <input
            type="text"
            placeholder="Название *"
            value={formData.title}
            onChange={(e) => setFormData({...formData, title: e.target.value})}
            className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white placeholder:text-white/30"
          />

          <div className="grid grid-cols-2 gap-2">
            <input
              type="date"
              value={formData.date}
              onChange={(e) => setFormData({...formData, date: e.target.value})}
              className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white"
            />

            <input
              type="text"
              placeholder="Время начала (19:00)"
              value={formData.time}
              onChange={(e) => setFormData({...formData, time: e.target.value})}
              className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white placeholder:text-white/30"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              placeholder="Время окончания (23:00)"
              value={formData.timeEnd}
              onChange={(e) => setFormData({...formData, timeEnd: e.target.value})}
              className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white placeholder:text-white/30"
            />

            <input
              type="number"
              placeholder="Стоимость аренды (₽)"
              value={formData.priceAmount}
              onChange={(e) => setFormData({...formData, priceAmount: parseInt(e.target.value)})}
              className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white placeholder:text-white/30"
            />
          </div>

          <input
            type="text"
            placeholder="Локация"
            value={formData.location}
            onChange={(e) => setFormData({...formData, location: e.target.value})}
            className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white placeholder:text-white/30"
          />

          <textarea
            placeholder="Описание мероприятия"
            value={formData.description}
            onChange={(e) => setFormData({...formData, description: e.target.value})}
            className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white placeholder:text-white/30"
            rows={3}
          />

          <div className="grid grid-cols-2 gap-2">
            <input
              type="number"
              placeholder="Макс. участников"
              value={formData.maxParticipants}
              onChange={(e) => setFormData({...formData, maxParticipants: parseInt(e.target.value)})}
              className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white"
            />

            <select
              value={formData.type}
              onChange={(e) => setFormData({...formData, type: e.target.value as any})}
              className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white"
            >
              <option value="male">Мужское Братство</option>
              <option value="mixed">Смешанный Круг</option>
              <option value="intellectual">Интеллектуальный Клуб</option>
              <option value="active">Активный Выезд</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              placeholder="Цена / Оплата"
              value={formData.priceLabel}
              onChange={(e) => setFormData({...formData, priceLabel: e.target.value})}
              className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white placeholder:text-white/30"
            />

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

          <input
            type="text"
            placeholder="Порог входа"
            value={formData.entryThreshold}
            onChange={(e) => setFormData({...formData, entryThreshold: e.target.value})}
            className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white placeholder:text-white/30"
          />
        </div>

        <div className="flex gap-2 pt-2">
          <button
            onClick={handleAdd}
            disabled={!formData.title || !formData.date}
            className="flex-1 bg-brand hover:bg-brand-hover text-black py-3 rounded-xl text-xs font-bold uppercase disabled:opacity-50"
          >
            Создать
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