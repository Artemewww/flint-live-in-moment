/**
 * Тонкая обёртка над Telegram WebApp SDK (Mini App).
 *
 * Сайт работает в двух режимах:
 *  1. Как обычный сайт в браузере (window.Telegram отсутствует).
 *  2. Как Telegram Mini App — открыт из бота @campsflint_bot через
 *     кнопку меню / inline-кнопку с web_app. Тогда доступны личность
 *     пользователя, тема и подпись initData для проверки на сервере.
 *
 * Никаких «сканирований сессии» вручную — личность приходит от Telegram.
 */

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
}

interface TelegramWebApp {
  initData: string;
  initDataUnsafe: {
    user?: TelegramUser;
    start_param?: string;
    [key: string]: unknown;
  };
  colorScheme: 'light' | 'dark';
  themeParams: Record<string, string>;
  isExpanded: boolean;
  ready: () => void;
  expand: () => void;
  close: () => void;
  openTelegramLink: (url: string) => void;
  HapticFeedback?: {
    notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
    impactOccurred: (style: 'light' | 'medium' | 'heavy') => void;
  };
  MainButton?: {
    setText: (text: string) => void;
    show: () => void;
    hide: () => void;
    onClick: (cb: () => void) => void;
    offClick: (cb: () => void) => void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export function getWebApp(): TelegramWebApp | null {
  if (typeof window === 'undefined') return null;
  const wa = window.Telegram?.WebApp;
  // SDK создаёт объект WebApp даже в обычном браузере, но initData там пустой.
  // Непустой подписанный initData есть только при запуске как Mini App из бота.
  if (wa && typeof wa.initData === 'string' && wa.initData.length > 0) return wa;
  return null;
}

/** Инициализация Mini App: подтверждаем готовность, разворачиваем, ставим тему. */
export function initTelegram(): TelegramWebApp | null {
  const wa = getWebApp();
  if (!wa) return null;
  try {
    wa.ready();
    wa.expand();
    // Помечаем корень для темизации (по умолчанию сайт тёмный — совпадает).
    document.documentElement.dataset.tgTheme = wa.colorScheme;
  } catch {
    /* no-op */
  }
  return wa;
}

/** Запущены ли мы внутри Telegram Mini App. */
export function isInsideTelegram(): boolean {
  return getWebApp() !== null;
}

/**
 * «Авторизован» ли пользователь.
 * В контексте сообщества FLINT авторизация = запуск сайта из бота
 * @campsflint_bot как Mini App: Telegram подтвердил личность пользователя
 * подписанным initData. В обычном браузере пользователь — гость/новичок,
 * и ему скрыты приватные данные (точное место сбора, дни рождения резидентов).
 */
export function isAuthorized(): boolean {
  return isInsideTelegram();
}

export function getTelegramUser(): TelegramUser | null {
  return getWebApp()?.initDataUnsafe.user ?? null;
}

/** Подписанная строка initData — сервер проверяет её HMAC по токену бота. */
export function getInitData(): string {
  return getWebApp()?.initData ?? '';
}

/** start_param из deep-link (напр. ?startapp=ref_maxim) — реферал/контекст. */
export function getStartParam(): string {
  return getWebApp()?.initDataUnsafe.start_param ?? '';
}

/** Лёгкий тактильный отклик (безопасно вне Telegram). */
export function haptic(type: 'success' | 'error' | 'warning'): void {
  try {
    getWebApp()?.HapticFeedback?.notificationOccurred(type);
  } catch {
    /* no-op */
  }
}

/** Открыть ссылку на бота корректно и в браузере, и внутри Telegram. */
export function openBot(url: string): void {
  const wa = getWebApp();
  if (wa) {
    wa.openTelegramLink(url);
  } else if (typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
