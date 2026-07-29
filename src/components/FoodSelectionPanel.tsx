import React, { useState, useEffect } from 'react';
import { ShoppingCart, Plus, Check, X, ChevronDown, ChevronUp, Search } from 'lucide-react';
import { haptic } from '../telegram';

interface FoodProduct {
  id: number;
  category_slug: string;
  name_ru: string;
  emoji: string;
  unit: string;
  default_qty: number;
}

interface FoodCategory {
  slug: string;
  title_ru: string;
  emoji: string;
  products: FoodProduct[];
}

interface FoodSelection {
  product_id: number;
  quantity: number;
  custom_note?: string;
}

export default function FoodSelectionPanel({ eventId, telegramId }: { eventId?: string; telegramId?: number }) {
  const [categories, setCategories] = useState<FoodCategory[]>([]);
  const [selections, setSelections] = useState<FoodSelection[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadData();
  }, [eventId, telegramId]);

  const loadData = async () => {
    setLoading(true);
    try {
      // Load categories with products
      const catRes = await fetch('/api/food?action=categories');
      const catData = await catRes.json();
      if (Array.isArray(catData)) setCategories(catData);

      // Load existing selections
      if (eventId && telegramId) {
        const selRes = await fetch(`/api/food?action=selections&event_id=${eventId}&telegram_id=${telegramId}`);
        const selData = await selRes.json();
        if (Array.isArray(selData)) setSelections(selData);
      }
    } catch (e) {
      console.error('Failed to load food data:', e);
    }
    setLoading(false);
  };

  const toggleProduct = async (productId: number) => {
    const existing = selections.find(s => s.product_id === productId);
    let newSelections: FoodSelection[];

    if (existing) {
      newSelections = selections.filter(s => s.product_id !== productId);
    } else {
      newSelections = [...selections, { product_id: productId, quantity: 1 }];
    }

    setSelections(newSelections);
    haptic('success');

    // Save to server
    if (eventId && telegramId) {
      await fetch('/api/food?action=toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_id: eventId,
          telegram_id: telegramId,
          product_id: productId,
          selected: !existing,
        }),
      });
    }
  };

  const filteredCategories = categories
    .map(cat => ({
      ...cat,
      products: cat.products.filter(p =>
        p.name_ru.toLowerCase().includes(search.toLowerCase())
      ),
    }))
    .filter(cat => cat.products.length > 0);

  const selectedCount = selections.length;

  return (
    <div className="space-y-4 font-sans">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShoppingCart className="w-5 h-5 text-brand" />
          <h2 className="font-black text-lg uppercase tracking-tight text-white">Продукты</h2>
        </div>
        {selectedCount > 0 && (
          <span className="bg-brand/10 border border-brand/30 text-brand px-2.5 py-1 rounded-lg text-[10px] font-bold font-mono">
            {selectedCount} выбрано
          </span>
        )}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск продуктов..."
          className="w-full bg-[#121212] border border-white/10 rounded-2xl py-3 pl-10 pr-4 text-sm text-white placeholder-white/30 outline-none focus:border-brand/50 transition-all"
        />
      </div>

      {/* Categories */}
      {loading ? (
        <div className="text-center py-8 text-white/30 text-sm">Загрузка...</div>
      ) : (
        <div className="space-y-2">
          {filteredCategories.map((cat) => (
            <div key={cat.slug} className="bg-[#121212] border border-white/10 rounded-2xl overflow-hidden">
              <button
                onClick={() => setExpandedCategory(expandedCategory === cat.slug ? null : cat.slug)}
                className="w-full p-4 flex items-center justify-between text-left cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl">{cat.emoji}</span>
                  <div>
                    <span className="text-sm font-bold text-white">{cat.title_ru}</span>
                    <span className="text-[10px] text-white/40 font-mono ml-2">
                      {cat.products.length} продуктов
                    </span>
                  </div>
                </div>
                {expandedCategory === cat.slug ? (
                  <ChevronUp className="w-4 h-4 text-white/30" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-white/30" />
                )}
              </button>

              {expandedCategory === cat.slug && (
                <div className="px-4 pb-4 grid grid-cols-2 gap-2">
                  {cat.products.map((product) => {
                    const isSelected = selections.some(s => s.product_id === product.id);
                    return (
                      <button
                        key={product.id}
                        onClick={() => toggleProduct(product.id)}
                        className={`flex items-center gap-2 p-3 rounded-xl border transition-all cursor-pointer text-left ${
                          isSelected
                            ? 'bg-brand/10 border-brand/30'
                            : 'bg-black/20 border-white/5 hover:border-white/20'
                        }`}
                      >
                        <span className="text-lg">{product.emoji}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-bold text-white truncate">{product.name_ru}</div>
                          <div className="text-[9px] text-white/40 font-mono">
                            {product.default_qty} {product.unit}
                          </div>
                        </div>
                        {isSelected && (
                          <Check className="w-4 h-4 text-brand shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}