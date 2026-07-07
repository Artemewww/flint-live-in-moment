# FLINT Telegram Bot

Telegram бот для сообщества FLINT - Live in Moment.

## Функции

- 📅 Просмотр ближайших мероприятий
- 📝 Регистрация на мероприятия (пошаговая)
- 👤 Личный профиль с статистикой
- 🔔 Уведомления о мероприятиях (за 7, 3, 1 день, 3 часа, 1 час)
- 🔐 Админ-панель с рассылкой

## Установка

### 1. Клонирование репозитория

```bash
git clone https://github.com/Artemewww/flint-live-in-moment.git
cd flint-live-in-moment/bot
```

### 2. Установка зависимостей

```bash
npm install
```

### 3. Настройка переменных окружения

Создайте файл `.env` на основе `.env.example`:

```bash
cp .env.example .env
```

Заполните переменные:
- `BOT_TOKEN` - токен бота от @BotFather
- `SUPABASE_URL` - URL вашего Supabase проекта
- `SUPABASE_SERVICE_ROLE_KEY` - service_role ключ из Supabase
- `ADMIN_TOKEN` - токен для админки (flint-admin-2026)
- `ADMIN_CHAT_ID` - ваш Telegram ID для админских уведомлений
- `WEB_APP_URL` - URL вашего Vercel проекта

### 4. Запуск

```bash
# Режим разработки
npm run dev

# Продакшн
npm start
```

## Развертывание на сервере

### Вариант 1: PM2 (рекомендуется)

```bash
# Установка PM2
npm install -g pm2

# Запуск
pm2 start src/index.js --name flint-bot

# Просмотр логов
pm2 logs flint-bot

# Автозапуск при старте сервера
pm2 startup
pm2 save
```

### Вариант 2: Systemd

Создайте файл `/etc/systemd/system/flint-bot.service`:

```ini
[Unit]
Description=FLINT Telegram Bot
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/flint-bot
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Запуск:
```bash
sudo systemctl enable flint-bot
sudo systemctl start flint-bot
sudo systemctl status flint-bot
```

## Структура проекта

```
bot/
├── src/
│   ├── index.js              # Точка входа
│   ├── handlers/             # Обработчики команд
│   │   ├── start.js         # /start
│   │   ├── events.js        # Просмотр мероприятий
│   │   ├── registration.js  # Регистрация
│   │   ├── profile.js       # Профиль
│   │   └── admin.js         # Админка
│   └── notifications.js      # Система уведомлений
├── package.json
├── .env.example
└── README.md
```

## API Endpoints

Бот использует следующие endpoints:

- `GET /api/events` - получение мероприятий
- `POST /api/register` - регистрация на мероприятие
- `GET /api/admin/registrations` - получение заявок (админ)
- `POST /api/admin/broadcast` - рассылка (админ)

## Разработка

### Добавление новой команды

1. Создайте handler в `src/handlers/`
2. Импортируйте в `src/index.js`
3. Зарегистрируйте команду:

```javascript
bot.command('newcommand', handleNewCommand);
```

### Добавление callback handler

```javascript
bot.callbackQuery('callback_data', async (ctx) => {
  await ctx.answerCallbackQuery();
  // Обработка
});
```

## Мониторинг

### Просмотр логов

```bash
# PM2
pm2 logs flint-bot

# Systemd
sudo journalctl -u flint-bot -f
```

### Статус бота

```bash
# PM2
pm2 status

# Systemd
sudo systemctl status flint-bot
```

## Безопасность

- Никогда не коммитьте `.env` файл
- Используйте сильные пароли для ADMIN_TOKEN
- Ограничьте доступ к админским функциям по Telegram ID
- Регулярно обновляйте зависимости

## Troubleshooting

**Бот не отвечает:**
- Проверьте токен бота
- Убедитесь, что бот запущен
- Проверьте логи на ошибки

**Ошибки при регистрации:**
- Проверьте WEB_APP_URL
- Убедитесь, что Supabase настроен
- Проверьте переменные окружения

**Уведомления не отправляются:**
- Проверьте время на сервере
- Убедитесь, что notifications включены в .env
- Проверьте логи уведомлений

## Лицензия

MIT