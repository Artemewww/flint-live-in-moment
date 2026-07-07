// Публичный API для получения мероприятий из Google Sheets
// Автоматически обновляется при изменении в таблице

import { GoogleSpreadsheet } from 'google-spreadsheet';

// ID таблицы Google Sheets (замените на ваш)
const SHEET_ID = process.env.GOOGLE_SHEET_ID || '1YourSheetIdHere';
const SHEET_CREDENTIALS = process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    try {
      // Если нет credentials - возвращаем демо-данные
      if (!SHEET_CREDENTIALS) {
        const { INITIAL_EVENTS } = await import('../../shared/events.data.js');
        return res.status(200).json(INITIAL_EVENTS);
      }

      const doc = new GoogleSpreadsheet(SHEET_ID);
      await doc.useServiceAccountAuth(JSON.parse(SHEET_CREDENTIALS));
      await doc.loadInfo();
      
      const sheet = doc.sheetsByIndex[0];
      const rows = await sheet.getRows();
      
      const events = rows.map(row => ({
        id: row.id,
        title: row.title,
        description: row.description,
        type: row.type,
        date: row.date,
        dateLabel: row.datelabel,
        time: row.time,
        location: row.location,
        locationDetails: row.locationdetails,
        painPoint: row.painpoint,
        houseQualities: row.housequalities ? row.housequalities.split(',').map((k: string) => ({ key: k.trim() })) : [],
        image: row.image,
        maxParticipants: parseInt(row.maxparticipants) || 15,
        participantsCount: parseInt(row.participantscount) || 0,
        telegramBotUrl: row.telegramboturl,
        priceType: row.pricetype,
        priceLabel: row.pricelabel,
        entryThreshold: row.entrypoint,
        needsOnboarding: row.needsonboarding === 'true',
        status: row.status,
        lockedHint: row.lockedhint
      }));

      return res.status(200).json(events);
    } catch (error) {
      console.error('Google Sheets error:', error);
      const { INITIAL_EVENTS } = await import('../../shared/events.data.js');
      return res.status(200).json(INITIAL_EVENTS);
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}