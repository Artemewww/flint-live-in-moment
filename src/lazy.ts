import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

/**
 * Ключ в sessionStorage: «мы уже один раз перезагружались из-за битого чанка».
 *
 * Нужен, чтобы починить классическую поломку SPA: открытая страница держит
 * в памяти старые хеши чанков, деплой их переименовал, и при переходе на
 * ленивый экран браузер получает 404. Лечится единственной перезагрузкой —
 * но БЕЗ этого ключа получился бы бесконечный цикл «релоад → 404 → релоад».
 */
export const CHUNK_RELOAD_KEY = 'flint:chunk-reload';

/**
 * Решить, что делать с неудачной загрузкой чанка.
 *
 *   1-й провал: ставим флаг и просим перезагрузку — почти наверняка поможет.
 *   2-й провал: флаг уже стоял, значит перезагрузка не спасла. Снимаем флаг
 *                (чтобы следующая ошибка снова получила свой шанс) и отдаём
 *                ошибку наверх — её покажет ErrorBoundary.
 *
 * Чистые функции sessionStorage могут кидать (приватный режим, переполнение) —
 * тогда просто отдаём ошибку наверх, без перезагрузки.
 */
export function shouldReloadOnChunkError(): boolean {
  try {
    if (sessionStorage.getItem(CHUNK_RELOAD_KEY)) {
      sessionStorage.removeItem(CHUNK_RELOAD_KEY);
      return false;
    }
    sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

/**
 * Снимать флаг нужно при УСПЕШНОЙ загрузке чанка, а не только при провале.
 * Иначе флаг, поставленный провалом одного экрана, «залипнет» и следующий
 * реально битый экран не получит свою попытку перезагрузки.
 */
export function markChunkLoaded(): void {
  try {
    sessionStorage.removeItem(CHUNK_RELOAD_KEY);
  } catch {
    /* нет sessionStorage — нечего снимать */
  }
}

/**
 * Явный сброс флага перезагрузки. Нужен ErrorBoundary: человек нажал
 * «Попробовать снова» — и следующая ошибка обязана получить СВОЙ шанс на
 * перезагрузку, а не увидеть флаг от прошлой неудачи.
 */
export function clearChunkReloadFlag(): void {
  markChunkLoaded();
}

/**
 * Ленивый экран с самовосстановлением после деплоя.
 *
 * Отличается от `React.lazy` ровно одним: если чанк не пришёл (деплой успел
 * сменить хеши, пока страница была открыта), делаем одну прозрачную
 * перезагрузку и повторяем попытку. Без этого человек в Telegram Mini App
 * получал белый экран без единого способа восстановиться.
 */
export function lazyWithRetry<P extends object>(
  factory: () => Promise<{ default: ComponentType<P> }>,
): LazyExoticComponent<ComponentType<P>> {
  return lazy(async () => {
    try {
      const mod = await factory();
      markChunkLoaded();
      return mod;
    } catch (err) {
      if (shouldReloadOnChunkError() && typeof window !== 'undefined') {
        window.location.reload();
        // reload() не останавливает выполнение — бросаем наружу, чтобы React
        // не показал «битый» экран, пока страница перезагружается.
        throw err;
      }
      throw err;
    }
  });
}
