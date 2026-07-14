#!/bin/bash
# ============================================
# FLINT Bot — Deploy Script для VPS
# Запускается автоматически после git push
# ============================================

set -e

echo "🚀 FLINT Deploy: $(date)"

# 1. Перейти в директорию проекта
cd /root/flint-live-in-moment || cd /home/flint/flint-live-in-moment || {
  echo "❌ Директория проекта не найдена"
  exit 1
}

# 2. Скачать последние изменения
echo "📥 Pull из GitHub..."
git pull origin main

# 3. Установить зависимости (если изменились)
echo "📦 Установка зависимостей..."
cd bot && npm install --production && cd ..

# 4. Перезапустить бота
echo "🔄 Перезапуск бота..."

# Пробуем разные способы перезапуска
if command -v pm2 &> /dev/null; then
  echo "   → pm2 restart"
  pm2 restart flint-bot || pm2 start bot/src/index.js --name flint-bot
elif command -v systemctl &> /dev/null; then
  echo "   → systemctl restart"
  systemctl restart flint-bot || systemctl restart fint-bot
elif command -v docker &> /dev/null; then
  echo "   → docker restart"
  docker restart flint-bot || docker-compose restart
else
  # Убить старый процесс и запустить новый
  echo "   → kill + node"
  pkill -f "node.*index.js" || true
  nohup node bot/src/index.js > bot/bot.log 2>&1 &
fi

echo "✅ Деплой завершён: $(date)"