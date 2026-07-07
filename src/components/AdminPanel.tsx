import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Lock, Unlock, Calendar, Users, Edit, Save, Plus, Trash2, Eye, EyeOff, Shield, RefreshCw, Send, CheckCircle, XCircle, BarChart3, MapPin, Package, DollarSign, Clock, FileText, Settings, Bell, UserCheck, UserX, ClipboardList, Truck, Flag, Play, Pause, X as XIcon, RotateCcw, ShoppingCart, ChefHat, Tent, Navigation, Award, MessageSquare, Star, UserPlus, UserMinus, Globe, Key, CheckSquare, Square, Activity } from 'lucide-react';
import { CommunityEvent } from '../types';

const ADMIN_TOKEN = 'flint-admin-2026';
const API_BASE = typeof window !== 'undefined' ? window.location.origin + '/api' : '';

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

  const ADMIN_PASSWORD = 'flint-admin-2026';

  const handleLogin = () => {
    if (password === ADMIN_PASSWORD) {
      setIsAuthenticated(true);
    } else {
      alert('Неверный пароль');
    }
  };

  const toggleEventStatus = (event: CommunityEvent) => {
    const newStatus = event.status === 'locked' ? 'open' : 'locked';
    onUpdateEvent({ ...event, status: newStatus });
  };

  const updateParticipants = (event: CommunityEvent, count: number) => {
    onUpdateEvent({ ...event, participantsCount: count });
  };

  const loadEventStats = (event: CommunityEvent) => {
    setSelectedEvent(event);
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
      // Получаем всех пользователей из localStorage
      const registrations: Array<{telegram: string}> = JSON.parse(localStorage.getItem('event_registrations') || '[]');
      const uniqueUsers = Array.from(new Map(registrations.map(r => [r.telegram, r])).values()) as Array<{telegram: string}>;

      if (uniqueUsers.length === 0) {
        setBroadcastResult({
          eventId: event.id,
          success: false,
          message: 'Нет зарегистрированных пользователей'
        });
        setBroadcasting(null);
        return;
      }

      // Отправляем уведомление через Telegram Bot API
      const botToken = '7861573345:AAEoWtYZa_6rWJszayOQ-9pRjf1p5X2lM9A'; // Токен бота @campsflint_bot
      
      const results = await Promise.allSettled(
        uniqueUsers.map(async (user: {telegram: string}) => {
          const message = `🔔 <b>Новое мероприятие!</b>\n\n` +
            `📅 <b>${event.title}</b>\n` +
            `📆 ${event.dateLabel}\n` +
            `📍 ${event.location}\n\n` +
            `💰 ${event.priceLabel}\n\n` +
            `🔗 <a href="https://t.me/campsflint_bot?start=event_${event.id}">Записаться через бота</a>`;

          const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: user.telegram,
              text: message,
              parse_mode: 'HTML'
            })
          });

          return response.ok;
        })
      );

      const successCount = results.filter((r: PromiseSettledResult<boolean>) => r.status === 'fulfilled' && r.value).length;
      const totalCount = uniqueUsers.length;

      setBroadcastResult({
        eventId: event.id,
        success: successCount > 0,
        message: `Отправлено ${successCount}/${totalCount} пользователям`
      });

      // Очищаем результат через 5 секунд
      setTimeout(() => setBroadcastResult(null), 5000);
    } catch (error) {
      setBroadcastResult({
        eventId: event.id,
        success: false,
        message: 'Ошибка рассылки'
      });
    } finally {
      setBroadcasting(null);
    }
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
              <button
                onClick={() => setShowAddForm(true)}
                className="bg-brand hover:bg-brand-hover text-black p-2 rounded-lg"
                title="Добавить мероприятие"
              >
                <Plus className="w-4 h-4" />
              </button>
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
                    event.status === 'locked' ? 'bg-white/10 text-white/40' :
                    event.status === 'closed' ? 'bg-rose-500/20 text-rose-400' :
                    'bg-brand/20 text-brand'
                  }`}>
                    {event.status === 'locked' ? 'Закрыто' : event.status === 'closed' ? 'Завершено' : 'Открыто'}
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
                    className="flex-1 bg-white/5 hover:bg-white/10 text-white/60 hover:text-white p-1.5 rounded-lg transition-all"
                    title={event.status === 'locked' ? 'Открыть' : 'Закрыть'}
                  >
                    {event.status === 'locked' ? <Unlock className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
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
                            <div key={idx} className="p-3 border-b border-white/5 flex items-center justify-between hover:bg-white/5">
                              <div className="flex-1">
                                <p className="text-sm font-bold">{reg.name || 'Гость'}</p>
                                <p className="text-[10px] text-white/60">@{reg.telegram}</p>
                                {reg.inviter && (
                                  <p className="text-[10px] text-brand">Пригласил: {reg.inviter}</p>
                                )}
                              </div>
                              <div className="flex gap-1">
                                <span className={`text-[9px] px-2 py-1 rounded-full font-mono ${
                                  reg.status === 'confirmed' ? 'bg-brand/20 text-brand' :
                                  reg.status === 'pending' ? 'bg-white/10 text-white/40' :
                                  'bg-rose-500/20 text-rose-400'
                                }`}>
                                  {reg.status === 'confirmed' ? 'Подтвержден' : reg.status === 'pending' ? 'Ожидает' : 'Отклонен'}
                                </span>
                                <button className="p-1 rounded bg-white/5 hover:bg-white/10" title="Удалить">
                                  <UserMinus className="w-3 h-3 text-rose-400" />
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'logistics' && (
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
    participantsCount: event.participantsCount,
    maxParticipants: event.maxParticipants,
    status: event.status || 'open'
  });

  const handleSave = () => {
    onSave({
      ...event,
      participantsCount: formData.participantsCount,
      maxParticipants: formData.maxParticipants,
      status: formData.status
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

        <div className="space-y-3">
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
    location: '',
    type: 'mixed' as CommunityEvent['type'],
    maxParticipants: 15
  });

  const handleAdd = () => {
    if (!formData.title || !formData.date) return;

    const newEvent: CommunityEvent = {
      id: `event-${Date.now()}`,
      title: formData.title,
      description: 'Описание будет добавлено позже',
      type: formData.type,
      date: formData.date,
      dateLabel: formData.dateLabel || formData.date,
      time: formData.time,
      location: formData.location,
      painPoint: '',
      houseQualities: [],
      image: '/assets/images/default_event.png',
      maxParticipants: formData.maxParticipants,
      participantsCount: 0,
      telegramBotUrl: 'https://t.me/campsflint_bot',
      priceType: 'conscience',
      priceLabel: 'На совесть',
      entryThreshold: '100% Трезвость'
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
            placeholder="Название"
            value={formData.title}
            onChange={(e) => setFormData({...formData, title: e.target.value})}
            className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white placeholder:text-white/30"
          />

          <input
            type="date"
            value={formData.date}
            onChange={(e) => setFormData({...formData, date: e.target.value})}
            className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white"
          />

          <input
            type="text"
            placeholder="Время"
            value={formData.time}
            onChange={(e) => setFormData({...formData, time: e.target.value})}
            className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white placeholder:text-white/30"
          />

          <input
            type="text"
            placeholder="Локация"
            value={formData.location}
            onChange={(e) => setFormData({...formData, location: e.target.value})}
            className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white placeholder:text-white/30"
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