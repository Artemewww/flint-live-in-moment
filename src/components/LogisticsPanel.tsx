/**
 * ЛОГИСТИКА СОБЫТИЯ В ПРИЛОЖЕНИИ: машины, палатки, брони, попутки.
 *
 * Раньше всё это жило только в боте: кнопка в карточке вела «🚗 Кто едет,
 * попутки и брони — в боте», дальше человек листал ленту, где каждая машина —
 * отдельное сообщение, а число свободных мест устаревало сразу после отправки.
 * Дословно от владельца: «через бота это очень неудобно».
 *
 * Здесь состояние живое: экран перечитывается после каждого действия и сам
 * обновляется, пока открыт. Уведомления при этом по-прежнему уходят в бот —
 * приложение показывает, бот зовёт. Ровно то разделение, к которому проект
 * шёл с 28.08.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Car, Tent, Users, MapPin, Clock, Phone, RefreshCw, Plus, X, Check, Pencil } from 'lucide-react';
import { getLogistics, logiAction, type LogiState, type LogiRide } from '../api';
import { haptic } from '../telegram';

/** Пока экран открыт, состав меняют и другие — перечитываем сами. */
const REFRESH_MS = 12_000;

interface Props {
  eventId: string;
  /** Записан ли смотрящий: незаписанному брони недоступны. */
  isRegistered: boolean;
}

function yandexRoute(point: string): string {
  const m = String(point || '').match(/(-?\d+[.,]\d+)[,\s]+(-?\d+[.,]\d+)/);
  const coords = m ? `${m[1].replace(',', '.')},${m[2].replace(',', '.')}` : '';
  return coords
    ? `https://yandex.ru/maps/?text=${coords}`
    : `https://yandex.ru/maps/?text=${encodeURIComponent(String(point).slice(0, 80))}`;
}

/** Полоска занятости: сколько мест уже разобрали. Цифра рядом — не вместо. */
function SeatBar({ total, taken }: { total: number; taken: number }) {
  if (total <= 0) return null;
  const pct = Math.min(100, Math.round((taken / total) * 100));
  return (
    <div className="w-full bg-white/10 h-1 rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-500 ${pct >= 100 ? 'bg-red-400' : pct >= 60 ? 'bg-amber-400' : 'bg-[#E6FD3A]'}`}
        style={{ width: `${Math.max(pct > 0 ? 6 : 0, pct)}%` }}
      />
    </div>
  );
}

export function LogisticsPanel({ eventId, isRegistered }: Props) {
  const [state, setState] = useState<LogiState | null>(null);
  const [busy, setBusy] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [showOffer, setShowOffer] = useState<'car' | 'tent' | null>(null);
  const [seats, setSeats] = useState('2');
  const [fromPoint, setFromPoint] = useState('');
  const [departText, setDepartText] = useState('');
  const alive = useRef(true);

  const load = useCallback(async () => {
    const s = await getLogistics(eventId);
    if (!alive.current) return;
    setState(s);
    if (!s.ok && s.error) setError(s.error);
  }, [eventId]);

  useEffect(() => {
    alive.current = true;
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => { alive.current = false; clearInterval(t); };
  }, [load]);

  /** Любое действие → сервер → сразу перечитать, чтобы цифры не расходились. */
  const run = useCallback(
    async (key: string, action: Parameters<typeof logiAction>[0], payload: Record<string, unknown>) => {
      setBusy(key);
      setError('');
      const r = await logiAction(action, payload);
      if (!alive.current) return;
      if (r.ok) haptic('success');
      else { haptic('error'); setError(r.error || 'Не получилось'); }
      await load();
      if (alive.current) setBusy('');
    },
    [load],
  );

  const submitOffer = async () => {
    const kind = showOffer;
    if (!kind) return;
    await run('offer', 'logi_offer', {
      eventId, kind,
      seats: Number(seats) || 0,
      fromPoint: fromPoint.trim(),
      departText: departText.trim(),
    });
    setShowOffer(null);
    setFromPoint('');
    setDepartText('');
  };

  if (!state) {
    return (
      <div className="bg-white/5 border border-white/5 rounded-2xl p-4 flex items-center gap-2 text-white/40 text-[11px]">
        <RefreshCw className="w-4 h-4 animate-spin" /> Загружаю логистику…
      </div>
    );
  }

  const card = (r: LogiRide) => {
    const isTent = r.kind === 'tent';
    return (
      <div key={r.id} className="bg-black/20 border border-white/10 rounded-xl p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-white text-sm font-bold flex items-center gap-1.5 truncate">
              {isTent ? <Tent className="w-4 h-4 text-brand shrink-0" /> : <Car className="w-4 h-4 text-brand shrink-0" />}
              <span className="truncate">{r.driverName}</span>
              {r.isMine && <span className="text-brand text-[9px] font-mono uppercase shrink-0">твоя</span>}
            </div>
            {!isTent && (
              <div className="text-white/50 text-[11px] font-mono mt-0.5 flex flex-wrap items-center gap-x-2">
                {r.fromPoint && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    {r.fromPoint}
                  </span>
                )}
                {r.departText && (
                  <span className="inline-flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {r.departText}
                  </span>
                )}
              </div>
            )}
          </div>
          <span className={`font-mono text-[10px] shrink-0 ${r.free > 0 ? 'text-brand' : 'text-white/40'}`}>
            {r.free > 0 ? `${r.free} своб.` : 'мест нет'}
          </span>
        </div>

        <SeatBar total={r.seatsTotal} taken={r.seatsTaken} />

        {r.passengers.length > 0 && (
          <div className="text-white/60 text-[11px]">
            {isTent ? 'Спят' : 'Едут'}: {r.passengers.map((p) => (p.isMe ? 'ты' : p.name)).join(', ')}
          </div>
        )}

        {/* Контакты водителя приходят с сервера только своим попутчикам:
            доступ к человеку даёт общая поездка, а не просмотр списка. */}
        {(r.iAmIn || r.isMine) && (r.driverUsername || r.driverPhone) && !r.isMine && (
          <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono">
            {r.driverUsername && (
              <a href={`https://t.me/${r.driverUsername}`} target="_blank" rel="noopener noreferrer" className="text-brand underline">
                @{r.driverUsername}
              </a>
            )}
            {r.driverPhone && (
              <a href={`tel:${r.driverPhone}`} className="text-brand underline inline-flex items-center gap-1">
                <Phone className="w-3 h-3" /> {r.driverPhone}
              </a>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-0.5">
          {r.isMine ? (
            <>
              {/* Планы меняются на ходу: выехал из другого района, сдвинул время,
                  освободилось ещё место. Раньше это правилось только диалогом с
                  ботом, и чаще не правилось вовсе — в списке висело старое. */}
              <button
                type="button"
                onClick={() => {
                  setShowOffer(r.kind);
                  setSeats(String(r.seatsTotal));
                  setFromPoint(r.fromPoint);
                  setDepartText(r.departText);
                }}
                className="text-[10px] font-black font-mono uppercase tracking-wider text-brand border border-brand/30 hover:bg-brand/10 rounded-xl px-3 py-2 transition-all"
              >
                <Pencil className="w-3 h-3 inline mr-1" />
                Изменить
              </button>
              <button
                type="button"
                disabled={busy === `c${r.id}`}
                onClick={() => run(`c${r.id}`, 'logi_cancel', { rideId: r.id })}
                className="text-[10px] font-black font-mono uppercase tracking-wider text-red-300 border border-red-400/30 hover:bg-red-400/10 rounded-xl px-3 py-2 transition-all disabled:opacity-40"
              >
                <X className="w-3 h-3 inline mr-1" />
                {busy === `c${r.id}` ? '…' : isTent ? 'Убрать палатку' : 'Отменить поездку'}
              </button>
            </>
          ) : r.iAmIn ? (
            <button
              type="button"
              disabled={busy === `u${r.id}`}
              onClick={() => run(`u${r.id}`, 'logi_unbook', { rideId: r.id })}
              className="text-[10px] font-black font-mono uppercase tracking-wider text-white/70 border border-white/15 hover:bg-white/10 rounded-xl px-3 py-2 transition-all disabled:opacity-40"
            >
              {busy === `u${r.id}` ? '…' : 'Освободить место'}
            </button>
          ) : r.free > 0 ? (
            <button
              type="button"
              disabled={!isRegistered || busy === `b${r.id}`}
              onClick={() => run(`b${r.id}`, 'logi_book', { rideId: r.id })}
              className="text-[10px] font-black font-mono uppercase tracking-wider bg-brand text-black rounded-xl px-3 py-2 transition-all disabled:opacity-40"
            >
              <Check className="w-3 h-3 inline mr-1" />
              {busy === `b${r.id}` ? '…' : 'Занять место'}
            </button>
          ) : (
            <button
              type="button"
              disabled={!isRegistered || busy === `w${r.id}`}
              onClick={() => run(`w${r.id}`, 'logi_wait', { rideId: r.id })}
              className="text-[10px] font-black font-mono uppercase tracking-wider text-white/70 border border-white/15 hover:bg-white/10 rounded-xl px-3 py-2 transition-all disabled:opacity-40"
            >
              {busy === `w${r.id}` ? '…' : 'Встать в очередь'}
            </button>
          )}
          {!isTent && r.fromPoint && (
            <a
              href={yandexRoute(r.fromPoint)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] font-black font-mono uppercase tracking-wider text-brand border border-brand/30 hover:bg-brand/10 rounded-xl px-3 py-2 transition-all"
            >
              🧭 Маршрут
            </a>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="bg-white/5 border border-white/5 rounded-2xl p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-white/40 uppercase text-[9px] tracking-wider flex items-center gap-2">
          <Car className="w-4 h-4 text-brand" /> Логистика и брони
        </span>
        <button
          type="button"
          onClick={() => { setError(''); load(); }}
          className="text-white/30 hover:text-white/60 transition-colors"
          aria-label="Обновить"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {error && (
        <p className="text-red-300 text-[11px] bg-red-400/10 border border-red-400/20 rounded-xl px-3 py-2">{error}</p>
      )}

      {!isRegistered && (
        <p className="text-white/50 text-[11px] leading-snug">
          Брони открываются после записи на событие — сейчас список только для просмотра.
        </p>
      )}

      {/* ── Машины ── */}
      <div className="space-y-2">
        {state.cars.length > 0 ? (
          state.cars.map(card)
        ) : (
          <p className="text-white/50 text-[11px] leading-snug">
            Машин пока нет. Едешь на своей — заяви места, и их сразу увидят все.
          </p>
        )}
      </div>

      {/* ── Палатки: те же места, только спальные ── */}
      {state.tents.length > 0 && (
        <div className="space-y-2 border-t border-white/10 pt-3">
          <span className="text-white/40 uppercase text-[9px] tracking-wider flex items-center gap-2">
            <Tent className="w-3.5 h-3.5 text-brand" /> Палатки
          </span>
          {state.tents.map(card)}
        </div>
      )}

      {/* ── Кто ещё без машины: чтобы водитель видел, ради кого добавлять место ── */}
      {state.seekers.length > 0 && (
        <div className="border-t border-white/10 pt-3">
          <span className="text-white/40 uppercase text-[9px] tracking-wider flex items-center gap-2 mb-1.5">
            <Users className="w-3.5 h-3.5 text-amber-400" /> Ищут попутку ({state.seekers.length})
          </span>
          <div className="text-white/60 text-[11px]">
            {state.seekers.map((s) => (s.isMe ? 'ты' : s.name) + (s.fromArea ? ` (${s.fromArea})` : '')).join(', ')}
          </div>
        </div>
      )}

      {/* ── Форма «еду на машине» / «своя палатка» ── */}
      {showOffer ? (
        <div className="border-t border-white/10 pt-3 space-y-2">
          <span className="text-white/40 uppercase text-[9px] tracking-wider block">
            {(showOffer === 'tent' ? state.tents : state.cars).some((r) => r.isMine)
              ? (showOffer === 'tent' ? 'Моя палатка — правка' : 'Моя машина — правка')
              : (showOffer === 'tent' ? 'Своя палатка' : 'Еду на машине')}
          </span>
          <div className="flex gap-2">
            <input
              value={seats}
              onChange={(e) => setSeats(e.target.value.replace(/\D/g, '').slice(0, 1))}
              inputMode="numeric"
              placeholder="мест"
              aria-label="Свободных мест"
              className="w-20 bg-black/30 border border-white/10 rounded-xl px-3 py-2 text-white text-sm font-mono outline-none focus:border-brand/50"
            />
            <input
              value={departText}
              onChange={(e) => setDepartText(e.target.value.slice(0, 60))}
              placeholder={showOffer === 'tent' ? 'когда ставим' : 'во сколько выезд'}
              className="flex-1 min-w-0 bg-black/30 border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-brand/50"
            />
          </div>
          {showOffer === 'car' && (
            <input
              value={fromPoint}
              onChange={(e) => setFromPoint(e.target.value.slice(0, 120))}
              placeholder={state.event.assemblyPoint || 'откуда стартуешь'}
              className="w-full bg-black/30 border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-brand/50"
            />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy === 'offer'}
              onClick={submitOffer}
              className="flex-1 bg-brand text-black py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest font-mono disabled:opacity-40"
            >
              {busy === 'offer' ? 'Сохраняю…' : 'Сохранить'}
            </button>
            <button
              type="button"
              onClick={() => setShowOffer(null)}
              className="px-4 text-white/50 border border-white/15 rounded-xl text-[10px] font-black uppercase tracking-widest font-mono"
            >
              Отмена
            </button>
          </div>
          <p className="text-white/40 text-[10px] leading-snug">
            Мест — сколько можешь взять <b>кроме себя</b>. Ноль тоже имеет смысл: так видно, что ты
            в колонне, даже если брать некого. Сохранение правит твою запись, а не заводит вторую:
            {showOffer === 'tent' ? ' одна палатка' : ' одна машина'} на человека.
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 border-t border-white/10 pt-3">
          <button
            type="button"
            disabled={!isRegistered}
            onClick={() => { setShowOffer('car'); setFromPoint(state.event.assemblyPoint || ''); setDepartText(state.event.departureTime || ''); }}
            className="text-[10px] font-black font-mono uppercase tracking-wider text-white/70 border border-white/15 hover:bg-white/10 rounded-xl px-3 py-2 transition-all disabled:opacity-40"
          >
            <Plus className="w-3 h-3 inline mr-1" /> Еду на машине
          </button>
          <button
            type="button"
            disabled={!isRegistered || busy === 'seek'}
            onClick={() => run('seek', 'logi_seek', { eventId, off: state.meSeeking })}
            className={`text-[10px] font-black font-mono uppercase tracking-wider rounded-xl px-3 py-2 transition-all disabled:opacity-40 ${
              state.meSeeking ? 'bg-amber-400/20 text-amber-200 border border-amber-400/30' : 'text-white/70 border border-white/15 hover:bg-white/10'
            }`}
          >
            {busy === 'seek' ? '…' : state.meSeeking ? '✕ Больше не ищу попутку' : '🚶 Нужна попутка'}
          </button>
          <button
            type="button"
            disabled={!isRegistered}
            onClick={() => { setShowOffer('tent'); setDepartText(''); }}
            className="text-[10px] font-black font-mono uppercase tracking-wider text-white/70 border border-white/15 hover:bg-white/10 rounded-xl px-3 py-2 transition-all disabled:opacity-40"
          >
            <Tent className="w-3 h-3 inline mr-1" /> Своя палатка
          </button>
        </div>
      )}

      <p className="text-white/30 text-[10px] font-mono">
        Обновляется само · уведомления приходят в бот
      </p>
    </div>
  );
}
