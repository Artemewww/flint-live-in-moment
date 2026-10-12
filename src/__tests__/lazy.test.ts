/**
 * Логика самовосстановления после деплоя (`src/lazy.ts`).
 *
 * Тестируем НЕ сам React.lazy (это его ответственность), а нашу обвязку —
 * потому что именно она ломает приложение целиком, когда неверна:
 *   - без перезагрузки человек в Mini App видит белый экран без выхода;
 *   - с перезагрузкой без ограничения он попадает в бесконечный цикл
 *     «релоад → 404 → релоад», и страница не открывается вообще никогда.
 *
 * Проверяем чистые функции: React в них не участвует, DOM не нужен.
 */
import {
  shouldReloadOnChunkError,
  markChunkLoaded,
  clearChunkReloadFlag,
  CHUNK_RELOAD_KEY,
} from '../lazy';

/** Минимальная замена sessionStorage в node-окружении jest. */
function fakeStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    store,
  };
}

let original: Storage | undefined;

beforeEach(() => {
  original = (globalThis as any).sessionStorage;
});

afterEach(() => {
  (globalThis as any).sessionStorage = original;
});

describe('shouldReloadOnChunkError', () => {
  it('первый провал просит перезагрузку — это лечит устаревшие хеши чанков', () => {
    (globalThis as any).sessionStorage = fakeStorage();
    expect(shouldReloadOnChunkError()).toBe(true);
  });

  it('ставит флаг, чтобы вторая ошибка не ушла в бесконечный релоад', () => {
    const st = fakeStorage();
    (globalThis as any).sessionStorage = st;
    shouldReloadOnChunkError();
    expect(st.store.get(CHUNK_RELOAD_KEY)).toBe('1');
  });

  it('второй провал подряд НЕ перезагружает — иначе цикл «релоад → 404»', () => {
    const st = fakeStorage();
    (globalThis as any).sessionStorage = st;
    expect(shouldReloadOnChunkError()).toBe(true);
    // Флаг остался от первого провала: решение «не перезагружать» и сброс флага.
    expect(shouldReloadOnChunkError()).toBe(false);
    expect(st.store.has(CHUNK_RELOAD_KEY)).toBe(false);
  });

  it('сбрасывает флаг при втором провале, чтобы следующая ошибка получила свой шанс', () => {
    const st = fakeStorage();
    (globalThis as any).sessionStorage = st;
    shouldReloadOnChunkError();
    shouldReloadOnChunkError();
    // Третья ошибка — уже новая ситуация, снова можно перезагрузить.
    expect(shouldReloadOnChunkError()).toBe(true);
  });

  it('не падает, когда sessionStorage недоступен (приватный режим)', () => {
    (globalThis as any).sessionStorage = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
      removeItem: () => { throw new Error('denied'); },
    };
    expect(shouldReloadOnChunkError()).toBe(false);
  });
});

describe('markChunkLoaded', () => {
  it('успешная загрузка снимает флаг — иначе он «залипнет» от чужой ошибки', () => {
    const st = fakeStorage();
    (globalThis as any).sessionStorage = st;
    shouldReloadOnChunkError();          // флаг выставлен
    markChunkLoaded();                  // чанк пришёл
    expect(shouldReloadOnChunkError()).toBe(true); // новая ошибка снова может перезагрузить
  });

  it('не падает без sessionStorage', () => {
    (globalThis as any).sessionStorage = {
      removeItem: () => { throw new Error('denied'); },
    };
    expect(() => markChunkLoaded()).not.toThrow();
  });
});

describe('clearChunkReloadFlag', () => {
  it('кнопка «Попробовать снова» даёт следующей ошибке чистый шанс', () => {
    const st = fakeStorage();
    (globalThis as any).sessionStorage = st;
    shouldReloadOnChunkError();
    clearChunkReloadFlag();
    expect(shouldReloadOnChunkError()).toBe(true);
  });
});