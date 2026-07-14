import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { lat, lng, date, location } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({ error: 'Missing lat/lng' });
    }

    // Пробуем получить погоду через Open-Meteo (бесплатно, без API ключа)
    try {
      const weatherUrl = new URL('https://api.open-meteo.com/v1/forecast');
      weatherUrl.searchParams.set('latitude', String(lat));
      weatherUrl.searchParams.set('longitude', String(lng));
      weatherUrl.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode');
      weatherUrl.searchParams.set('timezone', 'Europe/Minsk');
      weatherUrl.searchParams.set('forecast_days', '7');

      const weatherRes = await fetch(weatherUrl.toString());
      if (weatherRes.ok) {
        const weatherData = await weatherRes.json();
        const daily = weatherData.daily || {};

        // Находим индекс нужной даты
        let dateIndex = 0;
        if (date && daily.time) {
          const dateStr = String(date);
          dateIndex = daily.time.findIndex((t: string) => t === dateStr);
          if (dateIndex < 0) dateIndex = 0;
        }

        const weatherCode = daily.weathercode?.[dateIndex] || 0;
        const tempMax = daily.temperature_2m_max?.[dateIndex];
        const tempMin = daily.temperature_2m_min?.[dateIndex];
        const precipitation = daily.precipitation_sum?.[dateIndex];

        // Код погоды → описание
        const weatherDescriptions: Record<number, { label: string; emoji: string; recommendation: string }> = {
          0: { label: 'Ясно', emoji: '☀️', recommendation: 'Идеальная погода для мероприятия!' },
          1: { label: 'Преимущественно ясно', emoji: '🌤️', recommendation: 'Хорошая погода, можно планировать outdoor.' },
          2: { label: 'Переменная облачность', emoji: '⛅', recommendation: 'Погода переменная, иметь запасной план.' },
          3: { label: 'Облачно', emoji: '☁️', recommendation: 'Облачно, но без осадков.' },
          45: { label: 'Туман', emoji: '🌫️', recommendation: 'Туман, осторожно на дороге.' },
          48: { label: 'Изморозь', emoji: '🌫️', recommendation: 'Изморозь, скользко.' },
          51: { label: 'Лёгкая морось', emoji: '🌦️', recommendation: 'Небольшой дождь, взять зонты.' },
          53: { label: 'Морось', emoji: '🌦️', recommendation: 'Дождь, нужны зонты/крыши.' },
          55: { label: 'Сильная морось', emoji: '🌧️', recommendation: 'Дождь, лучше indoor.' },
          61: { label: 'Лёгкий дождь', emoji: '🌦️', recommendation: 'Дождь, взять зонты.' },
          63: { label: 'Дождь', emoji: '🌧️', recommendation: 'Дождь, нужны крыши/палатки.' },
          65: { label: 'Сильный дождь', emoji: '⛈️', recommendation: 'Ливень, лучше перенести или indoor.' },
          71: { label: 'Лёгкий снег', emoji: '🌨️', recommendation: 'Снег, тёплая одежда.' },
          73: { label: 'Снег', emoji: '❄️', recommendation: 'Снег, подготовить зимнее снаряжение.' },
          75: { label: 'Сильный снег', emoji: '❄️', recommendation: 'Метель, опасное путешествие.' },
          80: { label: 'Ливень', emoji: '🌧️', recommendation: 'Кратковременный ливень.' },
          81: { label: 'Сильный ливень', emoji: '⛈️', recommendation: 'Ливень, укрыться.' },
          82: { label: 'Очень сильный ливень', emoji: '⛈️', recommendation: 'Шторм, опасность.' },
          95: { label: 'Гроза', emoji: '⚡', recommendation: 'Гроза, опасность на открытом пространстве.' },
          96: { label: 'Гроза с градом', emoji: '⛈️', recommendation: 'Опасно, искать укрытие.' },
          99: { label: 'Сильная гроза с градом', emoji: '⛈️', recommendation: 'Крайне опасно, оставаться внутри.' },
        };

        const weather = weatherDescriptions[weatherCode] || { label: 'Неизвестно', emoji: '❓', recommendation: 'Погода неизвестна' };

        return res.status(200).json({
          ok: true,
          weather: {
            code: weatherCode,
            label: weather.label,
            emoji: weather.emoji,
            recommendation: weather.recommendation,
            tempMax: tempMax ? Math.round(tempMax) : null,
            tempMin: tempMin ? Math.round(tempMin) : null,
            precipitation: precipitation ? Math.round(precipitation * 10) / 10 : 0,
            date: date || daily.time?.[0] || null,
          },
        });
      }
    } catch (weatherError) {
      console.error('Weather API error:', weatherError);
    }

    // Фолбэк: если погодный API не доступен
    return res.status(200).json({
      ok: true,
      weather: {
        code: 0,
        label: 'Данные временно недоступны',
        emoji: '🌡️',
        recommendation: 'Проверьте погоду самостоятельно перед выходом.',
        tempMax: null,
        tempMin: null,
        precipitation: 0,
        date: date || null,
        fallback: true,
      },
    });
  } catch (err) {
    return res.status(200).json({ ok: false, error: (err as Error).message });
  }
}