import React, { useRef, useState } from 'react';
import { motion } from 'motion/react';
import { X, Camera, Clapperboard, Loader } from 'lucide-react';
import { compressPhoto, readVideo, ShotTooLargeError } from '../capture';
import { getInitData } from '../telegram';

interface SnapModalProps {
  eventTitle: string;
  eventId: string;
  onClose: () => void;
  onUploaded?: () => void;
}

/**
 * Всплывающее (в период события) окно «Снять фото / снять видео».
 * Фото/видео → /api/events action=media_upload → сервер шлёт в Telegram
 * (там медиа сжимается) и пишет в event_media → лента события у всех обновляется.
 */
export default function SnapModal({ eventTitle, eventId, onClose, onUploaded }: SnapModalProps) {
  const photoInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const send = async (file: File, isVideo: boolean) => {
    setBusy(true); setStatus(null);
    try {
      const shot = isVideo ? await readVideo(file) : await compressPhoto(file);
      const res = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'media_upload', eventId, initData: getInitData(), data: shot.data, mime: shot.mime }),
      });
      const j = await res.json();
      if (res.ok && j.ok) setStatus('✅ Отправлено! Спасибо за кадр');
      else if (j.error === 'finished') setStatus('⏳ Событие уже завершилось');
      else if (j.error === 'not_started') setStatus('⏳ Событие ещё не началось');
      else if (j.error === 'not_registered') setStatus('🔒 Сначала запишись на событие');
      else if (j.error === 'video_too_large' || j.error === 'shot_too_large') setStatus('📦 Слишком большой файл (лимит ~4 МБ)');
      else setStatus('⚠️ Не получилось. Попробуй ещё раз');
    } catch (e) {
      setStatus(e instanceof ShotTooLargeError ? '📦 Файл слишком большой' : '⚠️ Ошибка сети/загрузки');
    } finally {
      setBusy(false);
      setTimeout(() => setStatus(null), 3800);
    }
  };

return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center md:p-4" id="snap-modal-root">
      {/* Backdrop */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose} className="absolute inset-0 bg-black/85 backdrop-blur-md" />

      {/* Card */}
      <motion.div initial={{ opacity: 0, scale: 0.92, y: 24 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.92, y: 24 }}
        transition={{ type: 'spring', damping: 24, stiffness: 320 }}
        className="relative z-10 bg-[#121212] md:rounded-3xl w-full max-w-sm shadow-2xl md:border md:border-white/10 text-white overflow-hidden"
      >
        <button onClick={onClose} className="absolute top-3 right-3 z-20 p-2 rounded-full bg-black/60 border border-white/10 text-white/70 hover:text-brand transition-all cursor-pointer" aria-label="Закрыть">
          <X className="w-4.5 h-4.5" />
        </button>

        <div className="p-5 sm:p-6 space-y-4">
          <div className="space-y-1">
            <span className="inline-flex items-center gap-1.5 text-[10px] uppercase font-mono font-bold tracking-widest text-brand">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-brand"></span>
              </span>
              Сейчас · в моменте
            </span>
            <h2 className="font-display font-black text-2xl uppercase tracking-tight text-white">
              Ты на событии
            </h2>
            <p className="text-white/60 text-xs leading-snug">
              «{eventTitle}» — поделись кадром прямо сейчас. Фото и видео увидят все участники события.
            </p>
          </div>

          {/* Две кнопки */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => photoInput.current?.click()}
              disabled={busy}
              className="flex-1 h-28 rounded-2xl bg-brand/15 border-2 border-brand/40 hover:bg-brand/25 transition-all cursor-pointer flex flex-col items-center justify-center gap-2"
            >
              <Camera className="w-9 h-9 text-brand" />
              <span className="text-sm font-black text-white">📷 Фото</span>
            </button>
            <button
              onClick={() => videoInput.current?.click()}
              disabled={busy}
              className="flex-1 h-28 rounded-2xl bg-white/5 border-2 border-white/15 hover:bg-white/10 transition-all cursor-pointer flex flex-col items-center justify-center gap-2"
            >
              <Clapperboard className="w-9 h-9 text-white/80" />
              <span className="text-sm font-black text-white">🎥 Видео</span>
            </button>
          </div>

          {busy && (
            <div className="flex items-center gap-2 text-white/50 text-[11px] font-mono">
              <Loader className="w-4 h-4 animate-spin text-brand" /> Отправляем и сжимаем…
            </div>
          )}
          {status && <div className="text-[11px] text-white/70 font-sans text-center">{status}</div>}

          <p className="text-white/35 text-[9px] font-mono uppercase tracking-widest">
            Фото сжимаются автоматически · файлы ≤ 4 МБ
          </p>
        </div>
      </motion.div>

      {/* Скрытые инпуты: вызывают камеру на телефоне */}
      <input ref={photoInput} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) send(f, false); e.target.value = ''; }} />
      <input ref={videoInput} type="file" accept="video/*" capture="environment" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) send(f, true); e.target.value = ''; }} />
    </div>
  );
}