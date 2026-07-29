import React, { useState, useEffect } from 'react';
import { Search, Package, User, ArrowRightLeft, Camera, DollarSign, Check, X, AlertTriangle, Plus, ChevronDown, ChevronUp } from 'lucide-react';
import { haptic } from '../telegram';

interface EquipmentItem {
  id: number;
  telegram_id: number;
  item: string;
  quantity: number;
  category: string;
  price: number;
  photo_url?: string;
  condition: string;
  completeness: string[];
  access_level: string;
  investors: number[];
  description?: string;
}

interface TransferRequest {
  id: number;
  equipment_id: number;
  from_telegram_id: number;
  to_telegram_id: number;
  item_name: string;
  quantity: number;
  status: string;
  photo_before?: string;
  condition_before?: string;
  compensation_amount: number;
  compensation_paid: boolean;
}

const CONDITION_LABELS: Record<string, string> = {
  perfect: '✅ Идеальное',
  good: '👍 Хорошее',
  worn: '👌 Нормальное',
  damaged: '⚠️ С повреждениями',
};

const CONDITION_COLORS: Record<string, string> = {
  perfect: 'text-emerald-400',
  good: 'text-blue-400',
  worn: 'text-amber-400',
  damaged: 'text-rose-400',
};

export default function EquipmentPanel({ telegramId }: { telegramId?: number }) {
  const [tab, setTab] = useState<'my' | 'club' | 'transfers'>('my');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<EquipmentItem[]>([]);
  const [clubItems, setClubItems] = useState<EquipmentItem[]>([]);
  const [transfers, setTransfers] = useState<TransferRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newItem, setNewItem] = useState({ item: '', quantity: 1, category: 'other', price: 0, condition: 'perfect' });
  const [expandedItem, setExpandedItem] = useState<number | null>(null);

  const loadItems = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ action: 'search' });
      if (search) params.set('q', search);
      if (telegramId) params.set('telegram_id', String(telegramId));

      const res = await fetch(`/api/equipment?${params}`);
      const data = await res.json();
      if (Array.isArray(data)) setItems(data);

      const clubRes = await fetch(`/api/equipment?action=search-club${search ? `&q=${search}` : ''}`);
      const clubData = await clubRes.json();
      if (Array.isArray(clubData)) setClubItems(clubData);

      const transRes = await fetch('/api/equipment?action=pending-transfers');
      const transData = await transRes.json();
      if (Array.isArray(transData)) setTransfers(transData);
    } catch (e) {
      console.error('Failed to load equipment:', e);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadItems();
  }, [search, telegramId]);

  const handleAdd = async () => {
    if (!newItem.item.trim()) return;
    const res = await fetch('/api/equipment?action=add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        telegram_id: telegramId,
        item: newItem.item.trim(),
        quantity: newItem.quantity,
        category: newItem.category,
        price: newItem.price,
        condition: newItem.condition,
      }),
    });
    const data = await res.json();
    if (data.ok) {
      haptic('success');
      setShowAddForm(false);
      setNewItem({ item: '', quantity: 1, category: 'other', price: 0, condition: 'perfect' });
      loadItems();
    }
  };

  const handleTransfer = async (item: EquipmentItem) => {
    const toId = prompt('Telegram ID получателя:');
    if (!toId || isNaN(Number(toId))) return;

    const res = await fetch('/api/equipment?action=transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        equipment_id: item.id,
        from_telegram_id: telegramId,
        to_telegram_id: Number(toId),
        item_name: item.item,
        quantity: item.quantity,
      }),
    });
    const data = await res.json();
    if (data.ok) {
      haptic('success');
      alert('✅ Запрос на передачу отправлен. Получатель получит уведомление в Telegram.');
      loadItems();
    }
  };

  const getConditionColor = (cond: string) => CONDITION_COLORS[cond] || 'text-white/50';
  const getConditionLabel = (cond: string) => CONDITION_LABELS[cond] || cond;

  return (
    <div className="space-y-4 font-sans">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package className="w-5 h-5 text-brand" />
          <h2 className="font-black text-lg uppercase tracking-tight text-white">Снаряжение</h2>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="bg-brand/10 border border-brand/30 text-brand px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider hover:bg-brand/20 transition-all cursor-pointer flex items-center gap-1"
        >
          <Plus className="w-3 h-3" /> Добавить
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск снаряжения..."
          className="w-full bg-[#121212] border border-white/10 rounded-2xl py-3 pl-10 pr-4 text-sm text-white placeholder-white/30 outline-none focus:border-brand/50 transition-all"
        />
      </div>

      {/* Tabs */}
      <div className="bg-[#121212] border border-white/10 p-1 rounded-2xl flex gap-1">
        {(['my', 'club', 'transfers'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
              tab === t
                ? 'bg-brand text-black'
                : 'text-white/50 hover:text-white'
            }`}
          >
            {t === 'my' ? 'Моё' : t === 'club' ? 'Клубное' : `Передачи (${transfers.length})`}
          </button>
        ))}
      </div>

      {/* Add Form */}
      {showAddForm && (
        <div className="bg-[#121212] border border-white/10 rounded-2xl p-4 space-y-3">
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-brand">Новый предмет</h3>
          <input
            type="text"
            value={newItem.item}
            onChange={(e) => setNewItem({ ...newItem, item: e.target.value })}
            placeholder="Название предмета"
            className="w-full bg-black/50 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-white/30 outline-none"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              type="number"
              value={newItem.quantity}
              onChange={(e) => setNewItem({ ...newItem, quantity: Number(e.target.value) })}
              placeholder="Кол-во"
              className="bg-black/50 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-white/30 outline-none"
            />
            <input
              type="number"
              value={newItem.price}
              onChange={(e) => setNewItem({ ...newItem, price: Number(e.target.value) })}
              placeholder="Стоимость Br"
              className="bg-black/50 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-white/30 outline-none"
            />
          </div>
          <select
            value={newItem.condition}
            onChange={(e) => setNewItem({ ...newItem, condition: e.target.value })}
            className="w-full bg-black/50 border border-white/10 rounded-xl px-3 py-2 text-sm text-white outline-none"
          >
            <option value="perfect">✅ Идеальное</option>
            <option value="good">👍 Хорошее</option>
            <option value="worn">👌 Нормальное</option>
            <option value="damaged">⚠️ С повреждениями</option>
          </select>
          <button
            onClick={handleAdd}
            className="w-full bg-brand text-black font-bold py-3 rounded-xl text-xs uppercase tracking-wider hover:bg-brand-hover transition-all cursor-pointer"
          >
            Добавить в инвентарь
          </button>
        </div>
      )}

      {/* Items List */}
      {loading ? (
        <div className="text-center py-8 text-white/30 text-sm">Загрузка...</div>
      ) : (
        <div className="space-y-2">
          {(tab === 'my' ? items : tab === 'club' ? clubItems : []).length === 0 && tab !== 'transfers' && (
            <div className="text-center py-8 text-white/20 text-sm">
              <Package className="w-8 h-8 mx-auto mb-2 opacity-30" />
              {search ? 'Ничего не найдено' : 'Снаряжение пока не добавлено'}
            </div>
          )}

          {/* Transfers Tab */}
          {tab === 'transfers' && (
            <div className="space-y-2">
              {transfers.length === 0 ? (
                <div className="text-center py-8 text-white/20 text-sm">Нет активных передач</div>
              ) : (
                transfers.map((t) => (
                  <div key={t.id} className="bg-[#121212] border border-amber-500/20 rounded-2xl p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <ArrowRightLeft className="w-4 h-4 text-amber-400" />
                        <span className="text-sm font-bold text-white">{t.item_name}</span>
                      </div>
                      <span className="text-[10px] text-amber-400 font-mono uppercase">Ожидает</span>
                    </div>
                    <div className="text-[10px] text-white/50 font-mono">
                      От @{t.from_telegram_id} → @{t.to_telegram_id}
                    </div>
                    {t.compensation_amount > 0 && (
                      <div className="text-[10px] text-rose-400 font-mono">
                        Компенсация: {t.compensation_amount} Br
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {/* My / Club Items */}
          {(tab === 'my' ? items : clubItems).map((item) => (
            <div
              key={item.id}
              className="bg-[#121212] border border-white/10 rounded-2xl overflow-hidden transition-all hover:border-white/20"
            >
              <button
                onClick={() => setExpandedItem(expandedItem === item.id ? null : item.id)}
                className="w-full p-4 flex items-center gap-3 text-left cursor-pointer"
              >
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg ${
                  item.condition === 'damaged' ? 'bg-rose-500/10' : 'bg-white/5'
                }`}>
                  {item.category === 'tent' ? '⛺' :
                   item.category === 'kitchen' ? '🍳' :
                   item.category === 'tool' ? '🔧' :
                   item.category === 'clothing' ? '👕' : '📦'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-white truncate">{item.item}</span>
                    <span className={`text-[9px] font-mono ${getConditionColor(item.condition)}`}>
                      {getConditionLabel(item.condition)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-white/40 font-mono mt-0.5">
                    <span>{item.quantity} шт</span>
                    {item.price > 0 && <span className="text-brand/80">{item.price} Br</span>}
                    <span className="capitalize">{item.category}</span>
                  </div>
                </div>
                {expandedItem === item.id ? <ChevronUp className="w-4 h-4 text-white/30" /> : <ChevronDown className="w-4 h-4 text-white/30" />}
              </button>

              {expandedItem === item.id && (
                <div className="px-4 pb-4 space-y-3 border-t border-white/5 pt-3">
                  {/* Completeness */}
                  {item.completeness && item.completeness.length > 0 && (
                    <div className="space-y-1">
                      <span className="text-[9px] text-white/40 font-mono uppercase">Комплектность</span>
                      <div className="flex flex-wrap gap-1">
                        {item.completeness.map((c, i) => (
                          <span key={i} className="text-[9px] bg-white/5 px-2 py-0.5 rounded text-white/60">{c}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Description */}
                  {item.description && (
                    <p className="text-[10px] text-white/50">{item.description}</p>
                  )}

                  {/* Access Level */}
                  <div className="flex items-center gap-2 text-[9px] text-white/40 font-mono">
                    <User className="w-3 h-3" />
                    Доступ: {item.access_level === 'owner' ? 'Только владелец' :
                             item.access_level === 'investors' ? 'Инвесторы' : 'Все'}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2">
                    {tab === 'my' && (
                      <button
                        onClick={() => handleTransfer(item)}
                        className="flex-1 bg-white/5 border border-white/10 hover:border-brand/30 rounded-xl py-2 text-[10px] font-bold uppercase tracking-wider text-white/70 hover:text-brand transition-all cursor-pointer flex items-center justify-center gap-1"
                      >
                        <ArrowRightLeft className="w-3 h-3" /> Передать
                      </button>
                    )}
                    {item.price > 0 && (
                      <div className="flex-1 bg-rose-500/5 border border-rose-500/20 rounded-xl py-2 text-[10px] text-rose-400 font-mono text-center">
                        Компенсация: {item.price} Br
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}