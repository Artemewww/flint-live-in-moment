-- Сначала удаляем старые таблицы (чтобы сбросить прерванную транзакцию)
DROP TABLE IF EXISTS registrations CASCADE;
DROP TABLE IF EXISTS members CASCADE;
DROP TABLE IF EXISTS events CASCADE;

-- Создаём таблицу events
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL DEFAULT 'mixed',
  date TEXT NOT NULL,
  date_label TEXT,
  time TEXT,
  time_end TEXT,
  location TEXT NOT NULL,
  location_details TEXT,
  coordinates_lat DECIMAL(10, 6),
  coordinates_lng DECIMAL(10, 6),
  pain_point TEXT,
  image TEXT,
  max_participants INTEGER DEFAULT 15,
  participants_count INTEGER DEFAULT 0,
  telegram_bot_url TEXT,
  price_type TEXT DEFAULT 'conscience',
  price_label TEXT,
  price_amount INTEGER DEFAULT 0,
  entry_threshold TEXT,
  entry_type TEXT DEFAULT 'all',
  status TEXT DEFAULT 'locked',
  locked_hint TEXT,
  program JSONB DEFAULT '[]',
  notifications JSONB DEFAULT '{"reminder7d": true, "reminder3d": true, "reminder1d": true, "reminder3h": true, "reminder1h": true}',
  program_voting JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Создаём таблицу members
CREATE TABLE IF NOT EXISTS members (
  telegram_id BIGINT PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  phone TEXT,
  birthday TEXT,
  category TEXT,
  dietary TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Создаём таблицу registrations
CREATE TABLE IF NOT EXISTS registrations (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  telegram_id BIGINT NOT NULL REFERENCES members(telegram_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  status TEXT DEFAULT 'pending',
  payment_status TEXT DEFAULT 'pending',
  payment_amount INTEGER DEFAULT 0,
  donation_amount INTEGER DEFAULT 0,
  has_transport BOOLEAN DEFAULT FALSE,
  transport_details TEXT,
  transport_seats INTEGER DEFAULT 0,
  inventory JSONB DEFAULT '[]',
  category TEXT,
  dietary TEXT,
  guest_count INTEGER DEFAULT 0,
  equipment JSONB DEFAULT '[]',
  roles JSONB DEFAULT '[]',
  source TEXT,
  inviter TEXT,
  notes TEXT,
  registered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  confirmed_at TIMESTAMP WITH TIME ZONE,
  cancelled_at TIMESTAMP WITH TIME ZONE,
  cancel_reason TEXT
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_registrations_event_id ON registrations(event_id);
CREATE INDEX IF NOT EXISTS idx_registrations_telegram_id ON registrations(telegram_id);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(date);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);