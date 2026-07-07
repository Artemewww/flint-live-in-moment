import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Lock, Unlock, Calendar, Users, Edit, Save, Plus, Trash2, Eye, EyeOff, Shield, RefreshCw, Send, CheckCircle, XCircle } from 'lucide-react';
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
        className="bg-[#121212] rounded-3xl w-full max-w-4xl shadow-2xl relative z-10 border border-white/10 flex flex-col max-h-[90vh] text-white"
      >
        {/* Header */}
        <div className="p-6 border-b border-white/10 flex items-center justify-between">
          <div>
            <h2 className="font-display font-black text-2xl uppercase">Админ-панель</h2>
            <p className="text-xs text-brand font-mono uppercase">Управление мероприятиями</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full bg-white/5 hover:bg-white/10"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Events List */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-white/40 text-[10px] uppercase font-mono">Всего: {events.length} мероприятий</span>
            <button
              onClick={() => setShowAddForm(true)}
              className="bg-brand hover:bg-brand-hover text-black px-4 py-2 rounded-xl text-xs font-bold uppercase flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Добавить
            </button>
          </div>

          <div className="space-y-3">
            {events.map(event => (
              <div key={event.id} className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <h3 className="font-bold text-sm uppercase">{event.title}</h3>
                    <p className="text-xs text-white/60">{event.dateLabel}</p>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className={`
                      text-[10px] px-2 py-1 rounded-full font-mono uppercase
                      ${event.status === 'locked' ? 'bg-white/10 text-white/40' :
                        event.status === 'closed' ? 'bg-rose-500/20 text-rose-400' :
                        'bg-brand/20 text-brand'}
                    `}>
                      {event.status === 'locked' ? 'Закрыто' :
                       event.status === 'closed' ? 'Завершено' : 'Открыто'}
                    </span>

                    <button
                      onClick={() => toggleEventStatus(event)}
                      className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10"
                      title={event.status === 'locked' ? 'Открыть набор' : 'Закрыть набор'}
                    >
                      {event.status === 'locked' ?
                        <Unlock className="w-4 h-4 text-brand" /> :
                        <Lock className="w-4 h-4 text-white/60" />
                      }
                    </button>

                    <button
                      onClick={() => broadcastEvent(event)}
                      disabled={broadcasting === event.id}
                      className="p-1.5 rounded-lg bg-brand/20 hover:bg-brand/30 disabled:opacity-50"
                      title="Разослать уведомление"
                    >
                      {broadcasting === event.id ? (
                        <RefreshCw className="w-4 h-4 text-brand animate-spin" />
                      ) : (
                        <Send className="w-4 h-4 text-brand" />
                      )}
                    </button>

                    <button
                      onClick={() => setEditingEvent(event)}
                      className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10"
                    >
                      <Edit className="w-4 h-4 text-white/60" />
                    </button>

                    <button
                      onClick={() => {
                        if (confirm('Удалить мероприятие?')) {
                          onDeleteEvent(event.id);
                        }
                      }}
                      className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20"
                    >
                      <Trash2 className="w-4 h-4 text-rose-400" />
                    </button>
                  </div>
                </div>

                {/* Broadcast Result */}
                {broadcastResult && broadcastResult.eventId === event.id && (
                  <div className={`flex items-center gap-2 p-2 rounded-lg text-xs ${
                    broadcastResult.success ? 'bg-brand/10 text-brand' : 'bg-rose-500/10 text-rose-400'
                  }`}>
                    {broadcastResult.success ? (
                      <CheckCircle className="w-4 h-4" />
                    ) : (
                      <XCircle className="w-4 h-4" />
                    )}
                    <span>{broadcastResult.message}</span>
                  </div>
                )}

                <div className="flex items-center gap-4 text-xs">
                  <div className="flex items-center gap-1">
                    <Users className="w-4 h-4 text-brand" />
                    <span className="text-white/60">Участники:</span>
                    <span className="font-bold">{event.participantsCount}/{event.maxParticipants}</span>
                  </div>

                  <div className="flex items-center gap-1">
                    <Calendar className="w-4 h-4 text-brand" />
                    <span className="text-white/60">Тип:</span>
                    <span className="font-bold uppercase">{event.type}</span>
                  </div>
                </div>
              </div>
            ))}
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