import React from 'react';

// Внутренний плейлист FLINT — треки живут в /public/assets/music и раздаются
// как статика (Vite/Vercel). Расширяемый список: добавить трек = добавить файл
// в public/assets/music и строку здесь.
export interface PlaylistTrack {
  id: string;
  title: string;
  subtitle?: string;
  src: string;
}

export const PLAYLIST: PlaylistTrack[] = [
  {
    id: 'zhivi-v-momente',
    title: 'Живи в моменте',
    subtitle: 'Гимн FLINT',
    src: '/assets/music/zhivi-v-momente.mp3',
  },
  {
    id: 'leto-proshlo-gazuem',
    title: 'Лето прошло / Газуем',
    subtitle: 'FLINT Anthem',
    src: '/assets/music/leto-proshlo-gazuem.mp3',
  },
];

type Listener = () => void;

/**
 * Крошечный стор поверх одного HTMLAudioElement (синглтон).
 * Зачем не useState в компоненте: музыка должна продолжать играть, когда плеер
 * закрыт, а кнопка-нота в шапке должна знать, что сейчас «играет». Стор эмитит
 * события всем подписчикам (кнопка в шапке, модалка плеера).
 */
class MusicStore {
  private audio: HTMLAudioElement | null = null;
  private listeners = new Set<Listener>();
  private state = {
    currentId: null as string | null,
    playing: false,
    currentTime: 0,
    duration: 0,
  };

  constructor() {
    if (typeof window === 'undefined') return;
    this.audio = new Audio();
    this.audio.preload = 'metadata';
    this.audio.addEventListener('timeupdate', () => {
      if (this.state.currentId) {
        this.state.currentTime = this.audio?.currentTime || 0;
        this.emit();
      }
    });
    this.audio.addEventListener('durationchange', () => {
      this.state.duration = this.audio?.duration || 0;
      this.emit();
    });
    this.audio.addEventListener('ended', () => {
      this.state.playing = false;
      this.emit();
    });
    this.audio.addEventListener('play', () => {
      this.state.playing = true;
      this.emit();
    });
    this.audio.addEventListener('pause', () => {
      this.state.playing = false;
      this.emit();
    });
  }

  getState() {
    return this.state;
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit() {
    this.listeners.forEach((fn) => fn());
  }

  /** Toggle: трек играет — пауза; выбран другой — с нуля. */
  toggle(track: PlaylistTrack) {
    if (!this.audio) return;
    if (this.state.currentId === track.id) {
      if (this.audio.paused) {
        this.audio.play().catch(() => {});
      } else {
        this.audio.pause();
      }
      return;
    }
    this.audio.src = track.src;
    this.state.currentId = track.id;
    this.state.currentTime = 0;
    this.state.duration = 0;
    this.audio.play().catch(() => {});
  }

  seek(trackId: string, time: number) {
    if (this.audio && this.state.currentId === trackId && Number.isFinite(time)) {
      this.audio.currentTime = time;
      this.state.currentTime = time;
      this.emit();
    }
  }

  pause() {
    this.audio?.pause();
  }
}

export const musicStore = new MusicStore();

/** useSyncExternalStore-хук: подписка на состояние плеера. */
export function useMusicPlayer() {
  return React.useSyncExternalStore(
    (cb) => musicStore.subscribe(cb),
    () => musicStore.getState(),
    () => musicStore.getState()
  );
}