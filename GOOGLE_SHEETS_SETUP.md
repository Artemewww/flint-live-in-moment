# Настройка Google Sheets для админки

## 1. Создание таблицы

Создайте Google таблицу со следующими колонками:

| A | B | C | D | E | F | G | H | I | J | K | L | M | N | O | P | Q |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| id | title | description | type | date | datelabel | time | location | locationdetails | painpoint | housequalities | image | maxparticipants | participantscount | telegramboturl | pricetype | pricelabel | entrypoint | needsonboarding | status | lockedhint |

## 2. Переменные окружения в Vercel

Добавьте в Vercel Environment Variables:

```
GOOGLE_SHEET_ID=your_sheet_id_here
GOOGLE_SERVICE_ACCOUNT_CREDENTIALS={"type":"service_account",...}
ADMIN_TOKEN=flint-admin-2026
```

## 3. Service Account

1. Перейдите в Google Cloud Console
2. Создайте Service Account
3. Скачайте JSON ключ
4. Поделитесь таблицей с email из ключа (с правом редактирования)

## 4. Как это работает

- Сайт получает данные через `/api/events`
- AdminPanel сохраняет через `/api/admin/events`
- Все изменения мгновенно видны на сайте
- Не требуется пересборка проекта