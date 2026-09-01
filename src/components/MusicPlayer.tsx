import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Music, Play, Pause, X, AudioLines } from 'lucide-react';
import { PLAYLIST, useMusicPlayer, musicStore } from '../music';

interface MusicPlayerProps {
  onClose: () => void;
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Пульсирующие полоски-эквалайзер у играющего трека. */
function EqualizerBars() {
  return (
    <span className="flex items-end gap-[2px] h-3.5" aria-hidden="true">
      <span className="w-[3px] rounded-sm bg-brand animate-[eqBounce_0.9s_ease-in-out_infinite]" style={{ animationDelay: '0s' }} />
      <span className="w-[3px] rounded-sm bg-brand animate-[eqBounce_0.9s_ease-in-out_infinite]" style={{ animationDelay: '0.2s' }} />
      <span className="w-[3px] rounded-sm bg-brand animate-[eqBounce_0.9s_ease-in-out_infinite]" style={{ animationDelay: '0.4s' }} />
    </span>
  );
}

export default function MusicPlayer({ onClose }: MusicPlayerProps) {
  const player = useMusicPlayer();
  const currentTrack = PLAYLIST.find((t) => t.id === player.currentId) || null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center md:p-4" id="music-player-root">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/90 backdrop-blur-md"
        />

        {/* Modal */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 30 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 30 }}
          transition={{ type: 'spring', damping: 25, stiffness: 350 }}
          className="bg-[#121212] md:rounded-3xl w-full max-w-md shadow-2xl relative z-10 md:border md:border-white/10 flex flex-col h-[100dvh] md:h-auto md:max-h-[90vh] text-white"
        >
          {/* Close Button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 z-30 p-2.5 rounded-full bg-black/60 border border-white/10 hover:border-brand/40 text-white/70 hover:text-[#E6FD3A] hover:scale-105 transition-all outline-none cursor-pointer"
            aria-label="Закрыть плеер"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="overflow-y-auto w-full flex-grow scrollbar-none p-4 sm:p-6 space-y-6">
            {/* Header */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Music className="w-5 h-5 text-brand" />
                <span className="text-[10px] uppercase font-mono font-bold tracking-widest text-brand">
                  Внутренний плейлист
                </span>
              </div>
              <h2 className="font-display font-black text-2xl uppercase tracking-tight text-white">
                Музыка FLINT
              </h2>
              <p className="text-white/60 text-xs font-sans">
                Наш гимн и вайбы сообщества — жми play и слушай прямо в боте.
              </p>
            </div>

            {/* Track list */}
            <div className="space-y-3">
              {PLAYLIST.map((track) => {
                const isCurrent = player.currentId === track.id;
                const isPlaying = isCurrent && player.playing;
                return (
                  <div
                    key={track.id}
                    className={`rounded-2xl border p-4 transition-all ${
                      isCurrent
                        ? 'border-brand/40 bg-brand/10'
                        : 'border-white/10 bg-[#1C1C1C] hover:border-white/20'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {/* Play / Pause */}
                      <button
                        onClick={() => musicStore.toggle(track)}
                        className={`w-12 h-12 shrink-0 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                          isPlaying
                            ? 'bg-brand text-black hover:bg-brand-hover'
                            : 'bg-brand/15 border border-brand/30 text-brand hover:bg-brand/25'
                        }`}
                        aria-label={isPlaying ? `Пауза — ${track.title}` : `Слушать — ${track.title}`}
                      >
                        {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
                      </button>

                      {/* Title */}
                      <button
                        onClick={() => musicStore.toggle(track)}
                        className="flex-1 min-w-0 text-left bg-transparent border-none cursor-pointer p-0"
                      >
                        <div className="flex items-center gap-2">
                          <span className={`font-display font-black text-base uppercase tracking-tight truncate ${isCurrent ? 'text-brand' : 'text-white'}`}>
                            {track.title}
                          </span>
                          {isPlaying && <EqualizerBars />}
                        </div>
                        {track.subtitle && (
                          <span className="text-[11px] text-white/50 font-mono uppercase tracking-wider">
                            {track.subtitle}
                          </span>
                        )}
                      </button>
                    </div>

                    {/* Progress (только у текущего трека) */}
                    {isCurrent && player.duration > 0 && (
                      <div className="mt-3">
                        <input
                          type="range"
                          min={0}
                          max={Math.floor(player.duration) || 0}
                          value={Math.floor(player.currentTime)}
                          onChange={(e) => musicStore.seek(track.id, Number(e.target.value))}
                          className="w-full accent-[#E6FD3A] cursor-pointer"
                          aria-label={`Перемотка — ${track.title}`}
                        />
                        <div className="flex justify-between mt-1 font-mono text-[10px] text-white/40">
                          <span>{formatTime(player.currentTime)}</span>
                          <span>{formatTime(player.duration)}</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Now playing footer */}
            <div className="flex items-center gap-2 text-white/40">
              <AudioLines className="w-4 h-4 text-brand/70" />
              <span className="text-[10px] font-mono uppercase tracking-widest">
                {currentTrack && player.playing
                  ? `Сейчас играет: ${currentTrack.title}`
                  : currentTrack
                    ? `На паузе: ${currentTrack.title}`
                    : 'Треки играют, даже если закрыть плеер'}
              </span>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
