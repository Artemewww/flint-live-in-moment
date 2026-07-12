/**
 * Гео-сервис для FLINT «Живи в моменте».
 * 
 * Координаты Минска (центра) для расчёта расстояния: 53.9006, 27.5590
 * 
 * Функции:
 * - geocode(location: string): Promise<{lat, lng} | null> — геокодирование через Яндекс.Карты API
 * - calcDistance(lat, lng): number — расстояние от Минска по прямой (км)
 * - calcTravelTime(distanceKm): string — примерное время в пути
 */

const MINSK_LAT = 53.9006;
const MINSK_LNG = 27.5590;

/**
 * Геокодирование через бесплатный Nominatim (OpenStreetMap).
 * Не требует API-ключа, но имеет лимит 1 запрос/сек.
 */
export async function geocode(location: string): Promise<{ lat: number; lng: number } | null> {
  if (!location || location.trim().length < 3) return null;

  try {
    // Пробуем Яндекс.Карты API (если ключ есть в env)
    const ymapsKey = (window as any).__YMAPS_API_KEY;
    if (ymapsKey) {
      const url = `https://geocode-maps.yandex.ru/1.x/?format=json&apikey=${ymapsKey}&geocode=${encodeURIComponent(location)}&results=1`;
      const res = await fetch(url);
      const data = await res.json();
      const pos = data?.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject?.Point?.pos;
      if (pos) {
        const [lng, lat] = pos.split(' ').map(Number);
        return { lat, lng };
      }
    }

    // Fallback: Nominatim (OSM, бесплатно)
    await new Promise(r => setTimeout(r, 1100));
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(location + ', Минск, Беларусь')}&limit=1`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'FLINT-LiveInMoment/1.0' }
    });
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Расчёт расстояния от центра Минска по прямой (формула гаверсинуса).
 * @returns расстояние в километрах (с округлением до 1 км)
 */
export function calcDistance(lat: number, lng: number): number {
  const R = 6371;
  const dLat = (lat - MINSK_LAT) * Math.PI / 180;
  const dLng = (lng - MINSK_LNG) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(MINSK_LAT * Math.PI / 180) * Math.cos(lat * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.max(1, Math.round(R * c));
}

/**
 * Примерное время в пути от Минска (по дороге ×1.3 расстояния по прямой).
 * @param distanceKm расстояние по прямой в км
 * @returns строка вида "~45 мин" или "~1 ч 20 мин"
 */
export function calcTravelTime(distanceKm: number): string {
  const roadKm = Math.round(distanceKm * 1.3);
  const minutes = Math.round(roadKm / 60 * 60);
  if (minutes < 60) return `~${minutes} мин`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `~${h} ч ${m} мин` : `~${h} ч`;
}

/**
 * Создаёт ссылку на Яндекс.Карты с указанной точкой.
 */
export function getYandexMapsPointUrl(lat: number, lng: number): string {
  return `https://yandex.ru/maps/?pt=${lng},${lat}&z=16&l=map`;
}

/**
 * Парсинг строки расстояния из текста (например, "30 км от Минска").
 * Возвращает расстояние в км или null.
 */
export function parseDistance(text: string): number | null {
  const match = text.match(/(\d+)\s*км/i);
  if (match) return parseInt(match[1], 10);
  return null;
}