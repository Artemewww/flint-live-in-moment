/**
 * Скрипт проверки готовности проекта к запуску
 * Запуск: node test/setup-verification.js
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 Проверка готовности проекта Flint Live in Moment...\n');

let errors = 0;
let warnings = 0;

// 1. Проверка файлов
console.log('📁 Проверка файлов...');
const requiredFiles = [
  'supabase/schema.sql',
  'api/register.ts',
  'api/events.ts',
  'api/vote.ts',
  'api/interest.ts',
  'api/admin/events.ts',
  'api/admin/registrations.ts',
  'bot/src/index.js',
  'bot/src/handlers/start.js',
  'bot/src/handlers/events.js',
  'bot/src/handlers/registration.js',
  'bot/src/handlers/profile.js',
  'bot/src/handlers/admin.js',
  'bot/src/handlers/approval.js',
  'bot/src/notifications.js',
  'SUPABASE_SETUP.md',
  'DEPLOYMENT.md',
  'FINAL_REPORT.md'
];

requiredFiles.forEach(file => {
  if (fs.existsSync(file)) {
    console.log(`  ✅ ${file}`);
  } else {
    console.log(`  ❌ ${file} - ОТСУТСТВУЕТ`);
    errors++;
  }
});

// 2. Проверка переменных окружения
console.log('\n🔐 Проверка переменных окружения...');

if (fs.existsSync('.env')) {
  console.log('  ✅ .env файл существует');
  
  const envContent = fs.readFileSync('.env', 'utf8');
  
  const requiredVars = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'ADMIN_TOKEN',
    'TELEGRAM_BOT_TOKEN'
  ];
  
  requiredVars.forEach(varName => {
    if (envContent.includes(varName)) {
      console.log(`  ✅ ${varName} настроена`);
    } else {
      console.log(`  ⚠️  ${varName} не найдена в .env`);
      warnings++;
    }
  });
} else {
  console.log('  ⚠️  .env файл не найден (скопируйте из .env.example)');
  warnings++;
}

// 3. Проверка bot/.env
console.log('\n🤖 Проверка конфигурации бота...');

if (fs.existsSync('bot/.env')) {
  console.log('  ✅ bot/.env файл существует');
  
  const botEnvContent = fs.readFileSync('bot/.env', 'utf8');
  
  const requiredBotVars = [
    'BOT_TOKEN',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'ADMIN_TOKEN',
    'WEB_APP_URL'
  ];
  
  requiredBotVars.forEach(varName => {
    if (botEnvContent.includes(varName)) {
      console.log(`  ✅ ${varName} настроена`);
    } else {
      console.log(`  ⚠️  ${varName} не найдена в bot/.env`);
      warnings++;
    }
  });
} else {
  console.log('  ⚠️  bot/.env файл не найден (скопируйте из bot/.env.example)');
  warnings++;
}

// 4. Проверка package.json
console.log('\n📦 Проверка зависимостей...');

if (fs.existsSync('package.json')) {
  console.log('  ✅ package.json существует');
  
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  
  if (pkg.dependencies && pkg.dependencies['@supabase/supabase-js']) {
    console.log('  ✅ @supabase/supabase-js установлена');
  } else {
    console.log('  ❌ @supabase/supabase-js не найдена в зависимостях');
    errors++;
  }
}

if (fs.existsSync('bot/package.json')) {
  console.log('  ✅ bot/package.json существует');
  
  const botPkg = JSON.parse(fs.readFileSync('bot/package.json', 'utf8'));
  
  if (botPkg.dependencies && botPkg.dependencies['grammy']) {
    console.log('  ✅ grammy установлена');
  } else {
    console.log('  ❌ grammy не найдена в зависимостях');
    errors++;
  }
}

// 5. Проверка Supabase схемы
console.log('\n🗄️  Проверка схемы базы данных...');

if (fs.existsSync('supabase/schema.sql')) {
  console.log('  ✅ schema.sql существует');
  
  const schema = fs.readFileSync('supabase/schema.sql', 'utf8');
  
  const requiredTables = ['events', 'members', 'registrations'];
  requiredTables.forEach(table => {
    if (schema.includes(`CREATE TABLE IF NOT EXISTS ${table}`)) {
      console.log(`  ✅ Таблица ${table} определена`);
    } else {
      console.log(`  ❌ Таблица ${table} не найдена`);
      errors++;
    }
  });
  
  const requiredFunctions = ['increment_participants', 'decrement_participants', 'get_event_stats'];
  requiredFunctions.forEach(func => {
    if (schema.includes(`CREATE OR REPLACE FUNCTION ${func}`)) {
      console.log(`  ✅ Функция ${func} определена`);
    } else {
      console.log(`  ❌ Функция ${func} не найдена`);
      errors++;
    }
  });
}

// 6. Итог
console.log('\n' + '='.repeat(50));
console.log('📊 ИТОГ:');
console.log(`  ❌ Ошибок: ${errors}`);
console.log(`  ⚠️  Предупреждений: ${warnings}`);

if (errors === 0 && warnings === 0) {
  console.log('\n✅ ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ! Проект готов к запуску.');
  console.log('\nСледующие шаги:');
  console.log('1. Создайте проект на https://supabase.com');
  console.log('2. Выполните supabase/schema.sql в SQL Editor');
  console.log('3. Добавьте переменные в Vercel');
  console.log('4. Задеплойте проект');
  console.log('5. Запустите бота: cd bot && npm install && npm start');
} else if (errors === 0) {
  console.log('\n⚠️  Есть предупреждения, но критических ошибок нет.');
  console.log('Исправьте предупреждения перед запуском.');
} else {
  console.log('\n❌ ЕСТЬ КРИТИЧЕСКИЕ ОШИБКИ!');
  console.log('Исправьте ошибки перед запуском.');
}

console.log('='.repeat(50));