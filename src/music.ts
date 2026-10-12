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
  {
    id: 'komanda-flint',
    title: 'Команда FLINT',
    subtitle: 'Гимн команды',
    src: '/assets/music/komanda-flint.mp3',
  },
];

type Listener = () => void;

export interface MusicState {
  currentId: string | null;
  playing: boolean;
  currentTime: number;
  duration: number;
}

/**
 * Крошечный стор поверх одного HTMLAudioElement (синглтон).
 * Зачем не useState в компоненте: музыка должна продолжать играть, когда плеер
 * закрыт, а кнопка-нота в шапке должна знать, что сейчас «играет».
 *
 * ВАЖНО: состояние обновляется НЕИЗМЕНЯЕМО (новый объект), а не мутацией на
 * месте. useSyncExternalStore сравнивает снимки через Object.is: если отдать
 * тот же объект, React считает, что ничего не изменилось, и НЕ перерисовывает
 * компонент. Ровно так и выглядел баг — музыка играла, а ползунок прогресса и
 * кнопка play/pause оставались в исходном виде («нажал play — полоса не
 * появилась»). Плюс позиция и трек сохраняются, иначе F5 обнулял музыку.
 */
class MusicStore {
  private audio: HTMLAudioElement | null = null;
  private listeners = new Set<Listener>();
  private state: MusicState = {
    currentId: null,
    playing: false,
    currentTime: 0,
    duration: 0,
  };

  private static readonly SAVE_KEY = 'flint_music_v1';

  constructor() {
    if (typeof window === 'undefined') return;
    let saved: any = null;
    try { saved = JSON.parse(localStorage.getItem(MusicStore.SAVE_KEY) || 'null'); } catch { saved = null; }
    const savedTrack = PLAYLIST.find((t) => t.id === saved?.id) || null;
    if (savedTrack) {
      this.state = { ...this.state, currentId: savedTrack.id, currentTime: Number(saved.t) || 0 };
    }
    this.audio = new Audio();
    this.audio.preload = 'metadata';
    if (savedTrack) this.audio.src = savedTrack.src;
    this.audio.addEventListener('loadedmetadata', () => {
      // Возвращаемся на сохранённое место, но не в самый конец трека.
      const dur = this.audio?.duration || 0;
      if (this.state.currentTime > 0 && Number.isFinite(dur)) {
        const t = Math.min(this.state.currentTime, Math.max(0, dur - 1));
        this.audio!.currentTime = t;
        this.patch({ currentTime: t });
      }
      this.patch({ duration: dur });
    });
    this.audio.addEventListener('timeupdate', () => {
      if (this.state.currentId) this.patch({ currentTime: this.audio?.currentTime || 0 });
    });
    this.audio.addEventListener('durationchange', () => this.patch({ duration: this.audio?.duration || 0 }));
    // Трек кончился — идём к следующему, иначе музыка просто встаёт.
    this.audio.addEventListener('ended', () => this.next());
    this.audio.addEventListener('play', () => this.patch({ playing: true }));
    this.audio.addEventListener('pause', () => this.patch({ playing: false }));
  }

  /** Заменить снимок новым объектом — так React видит изменение. */
  private patch(p: Partial<MusicState>) {
    this.state = { ...this.state, ...p };
    this.save();
    this.emit();
  }

  private save() {
    try {
      localStorage.setItem(
        MusicStore.SAVE_KEY,
        JSON.stringify({ id: this.state.currentId, t: Math.floor(this.state.currentTime) }),
      );
    } catch { /* приватный режим — просто не сохраняем */ }
  }

  getState(): MusicState {
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

  /** Загрузить трек с позиции и включить. */
  private playTrack(track: PlaylistTrack, fromSeconds = 0) {
    if (!this.audio) return;
    this.audio.src = track.src;
    this.patch({ currentId: track.id, currentTime: fromSeconds, duration: 0 });
    this.audio.currentTime = fromSeconds;
    this.audio.play().catch(() => {});
  }

  /** Toggle: трек играет — пауза; выбран другой — с нуля. */
  toggle(track: PlaylistTrack) {
    if (!this.audio) return;
    if (this.state.currentId === track.id) {
      if (this.audio.paused) this.audio.play().catch(() => {});
      else this.audio.pause();
      return;
    }
    this.playTrack(track);
  }

  /** Следующий трек плейлиста. */
  next() {
    if (!this.audio || !PLAYLIST.length) return;
    const cur = PLAYLIST.findIndex((t) => t.id === this.state.currentId);
    this.playTrack(PLAYLIST[cur === -1 ? 0 : (cur + 1) % PLAYLIST.length]);
  }

  /** Предыдущий трек. Если играем больше 3 секунд — сначала в начало. */
  prev() {
    if (!this.audio || !PLAYLIST.length) return;
    if (this.state.currentTime > 3) {
      this.seek(this.state.currentId || '', 0);
      return;
    }
    const cur = PLAYLIST.findIndex((t) => t.id === this.state.currentId);
    this.playTrack(PLAYLIST[cur === -1 ? 0 : (cur - 1 + PLAYLIST.length) % PLAYLIST.length]);
  }

  seek(trackId: string, time: number) {
    if (this.audio && this.state.currentId === trackId && Number.isFinite(time)) {
      this.audio.currentTime = time;
      this.patch({ currentTime: time });
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