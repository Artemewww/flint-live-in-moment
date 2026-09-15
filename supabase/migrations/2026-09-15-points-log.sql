-- Миграция 2026-dietary-profile.sql в базе применена НЕ ПОЛНОСТЬЮ:
-- из неё дошла только таблица event_menus. Отсутствуют points_log, achievements
-- и колонки members (points есть, остальных нет).
--
-- Эти объекты использует живой код:
--   api/fundraisers.ts  -> points_log
--   api/profile.ts      -> points_log, achievements, members.level/attended_count/invited_count/achievements
--
-- Ниже — только то, что нужно коду. event_chats из старой миграции сюда
-- НЕ включена: api/profile.ts:1733 прямо фиксирует, что этой таблицы в БД
-- нет и не было, функциональность переведена на events.telegram_bot_url.
--
-- Идемпотентно: можно применять повторно, существующие данные не трогаются.

-- 1. Баллы и репутация участников
ALTER TABLE members ADD COLUMN IF NOT EXISTS points integer DEFAULT 0;
ALTER TABLE members ADD COLUMN IF NOT EXISTS attended_count integer DEFAULT 0;
ALTER TABLE members ADD COLUMN IF NOT EXISTS invited_count integer DEFAULT 0;
ALTER TABLE members ADD COLUMN IF NOT EXISTS level text DEFAULT 'newbie';
ALTER TABLE members ADD COLUMN IF NOT EXISTS achievements jsonb DEFAULT '[]'::jsonb;

COMMENT ON COLUMN members.points IS 'Баллы за посещения, помощь, рефералы';
COMMENT ON COLUMN members.attended_count IS 'Количество посещённых мероприятий';
COMMENT ON COLUMN members.invited_count IS 'Количество приведённых участников';
COMMENT ON COLUMN members.level IS 'Уровень в клубе: newbie | regular | core | legend';
COMMENT ON COLUMN members.achievements IS 'Достижения: ["first_event", "organizer", "cook", "driver", "photographer"]';

-- 2. Журнал начисления баллов (в т.ч. подтверждённые вклады в сборы)
CREATE TABLE IF NOT EXISTS points_log (
  id          bigserial PRIMARY KEY,
  telegram_id bigint NOT NULL,
  event_id    text REFERENCES events(id) ON DELETE SET NULL,
  reason      text NOT NULL, -- 'attendance' | 'invite' | 'role' | 'feedback' | 'bonus' | 'fundraiser'
  points      integer NOT NULL,
  description text DEFAULT '',
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS points_log_telegram_idx ON points_log (telegram_id, created_at DESC);

COMMENT ON TABLE points_log IS 'Журнал начисления/списания баллов';
COMMENT ON COLUMN points_log.reason IS 'Причина: посещение, приведён, роль, отзыв, бонус, подтверждённый вклад в сбор';

ALTER TABLE points_log ENABLE ROW LEVEL SECURITY;

-- 3. Каталог достижений (api/profile.ts читает его при add_points)
CREATE TABLE IF NOT EXISTS achievements (
  id              bigserial PRIMARY KEY,
  code            text NOT NULL UNIQUE,
  title           text NOT NULL,
  description     text DEFAULT '',
  icon            text DEFAULT '🏆',
  points_required integer DEFAULT 0,
  condition       jsonb DEFAULT '{}'::jsonb
);

COMMENT ON TABLE achievements IS 'Каталог достижений клуба';
