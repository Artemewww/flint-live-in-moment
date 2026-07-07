-- Supabase schema for Flint Live in Moment
-- Tables: events, members, registrations

-- Events table
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
  notifications JSONB DEFAULT '{
    "reminder7d": true,
    "reminder3d": true,
    "reminder1d": true,
    "reminder3h": true,
    "reminder1h": true
  }',
  program_voting JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Members table (Telegram users)
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

-- Registrations table
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

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_registrations_event_id ON registrations(event_id);
CREATE INDEX IF NOT EXISTS idx_registrations_telegram_id ON registrations(telegram_id);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(date);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);

-- Auto-update trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_events_updated_at BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_members_updated_at BEFORE UPDATE ON members
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to get event stats
CREATE OR REPLACE FUNCTION get_event_stats(event_id TEXT)
RETURNS JSONB AS $$
DECLARE
  stats JSONB;
BEGIN
  SELECT jsonb_build_object(
    'total', COUNT(*),
    'confirmed', COUNT(*) FILTER (WHERE status = 'confirmed'),
    'pending', COUNT(*) FILTER (WHERE status = 'pending'),
    'payments', COUNT(*) FILTER (WHERE payment_status = 'paid'),
    'total_amount', COALESCE(SUM(payment_amount), 0)
  ) INTO stats
  FROM registrations
  WHERE event_id = get_event_stats.event_id;
  
  RETURN stats;
END;
$$ LANGUAGE plpgsql;

-- Function to increment participants count
CREATE OR REPLACE FUNCTION increment_participants(event_id TEXT)
RETURNS VOID AS $$
BEGIN
  UPDATE events
  SET participants_count = participants_count + 1
  WHERE id = increment_participants.event_id;
END;
$$ LANGUAGE plpgsql;

-- Function to decrement participants count
CREATE OR REPLACE FUNCTION decrement_participants(event_id TEXT)
RETURNS VOID AS $$
BEGIN
  UPDATE events
  SET participants_count = GREATEST(0, participants_count - 1)
  WHERE id = decrement_participants.event_id;
END;
$$ LANGUAGE plpgsql;