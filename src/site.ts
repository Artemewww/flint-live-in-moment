/**
 * АДРЕС САЙТА для ссылок, которые уходят наружу.
 *
 * Раньше ссылки собирались из `window.location.origin`. Внутри Telegram Mini App
 * это НЕ наш домен: приложение открыто в вебвью `https://web.telegram.org/k/...`,
 * то есть origin уезжал в Telegram. В итоге «поделиться событием» отдавало
 * ссылку вида web.telegram.org/e/event-… — мёртвую, и в превью пересылки не
 * было ни картинки, ни описания: Telegram не нашёл у неё og-разметку.
 *
 * ВАЖНО: этот адрес нужен только для ссылок наружу (шеринг, приглашения).
 * Внутри приложения API и ассеты по-прежнему берутся относительным путём и
 * ходят на тот же домен, что и сама страница.
 */
const PROD_ORIGIN = 'https://flint-live-in-moment.vercel.app';

/**
 * СОЦИАЛЬНЫЕ ССЫЛКИ КЛУБА — одно место, где их менять.
 *
 * Раньше их в приложении не было вообще: в шапке и в футере жил только
 * Telegram-бот, а Instagram/Threads clubs не были связаны с мини-приложением.
 * Человек, пришедший с рилса, попадал в приложение и не мог найти, где ещё
 * посмотреть клуб, — и уходил обратно в ленту.
 *
 * Ники НЕ зашиты по кнопкам: переопределяются через VITE_SOCIAL_* на деплое,
 * иначе правка каждой ссылки означала бы новый релиз фронта.
 */
const SOCIAL: { instagram: string; threads: string } = {
  instagram: (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_SOCIAL_INSTAGRAM) || 'https://instagram.com/flint_social',
  threads: (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_SOCIAL_THREADS) || 'https://threads.net/@flint_social',
};

export { SOCIAL };

export const SITE_ORIGIN: string = (
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_SITE_URL) || PROD_ORIGIN
).replace(/\/+$/, '');

/** Ссылка на страницу события — она несёт og:картинку для превью в Telegram. */
export function eventShareLink(eventId: string, ref?: string): string {
  const refPart = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  return `${SITE_ORIGIN}/e/${encodeURIComponent(eventId)}${refPart}`;
}