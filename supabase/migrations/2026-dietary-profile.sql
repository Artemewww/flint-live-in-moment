-- Миграция профиля питания участников
-- Добавляет поля для детального управления питанием в клубе

-- 1. Расширяем members: детальный профиль питания
ALTER TABLE members ADD COLUMN IF NOT EXISTS allergies jsonb DEFAULT '[]'::jsonb;
ALTER TABLE members ADD COLUMN IF NOT EXISTS liked_foods jsonb DEFAULT '[]'::jsonb;
ALTER TABLE members ADD COLUMN IF NOT EXISTS disliked_foods jsonb DEFAULT '[]'::jsonb;
ALTER TABLE members ADD COLUMN IF NOT EXISTS cooking_skills text DEFAULT '';
ALTER TABLE members ADD COLUMN IF NOT EXISTS meal_preferences jsonb DEFAULT '{}'::jsonb;
-- meal_preferences: { "breakfast": bool, "lunch": bool, "dinner": bool, "snacks": bool }

COMMENT ON COLUMN members.allergies IS 'Массив аллергий: ["молочные","орехи","глютен"]';
COMMENT ON COLUMN members.liked_foods IS 'Любимые продукты';
COMMENT ON COLUMN members.disliked_foods IS 'Нелюбимые продукты';
COMMENT ON COLUMN members.cooking_skills IS 'Уровень готовки: beginner/medium/pro/chef';
COMMENT ON COLUMN members.meal_preferences IS 'Какие приёмы пищи предпочитает';

-- 2. Таблица для меню события
DO $$ BEGIN
  CREATE TABLE IF NOT EXISTS event_menus (
    id              bigserial PRIMARY KEY,
    event_id        text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    day             int NOT NULL DEFAULT 1,
    meal_type       text NOT NULL, -- 'breakfast' | 'lunch' | 'dinner' | 'snack'
    dish            text NOT NULL,
    ingredients     jsonb DEFAULT '[]'::jsonb,
    cooking_notes   text DEFAULT '',
    assigned_to     bigint REFERENCES members(telegram_id),
    created_at      timestamptz DEFAULT now(),
    UNIQUE (event_id, day, meal_type, dish)
  );
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

COMMENT ON TABLE event_menus IS 'Меню мероприятия по дням и приёмам пищи';
COMMENT ON COLUMN event_menus.day IS 'День мероприятия (1 = первый день)';
COMMENT ON COLUMN event_menus.meal_type IS 'Завтрак/обед/ужин/перекус';
COMMENT ON COLUMN event_menus.dish IS 'Название блюда';
COMMENT ON COLUMN event_menus.ingredients IS 'Ингредиенты: [{ "name": "картошка", "qty": "2 кг", "note": "очистить" }]';
COMMENT ON COLUMN event_menus.assigned_to IS 'Кто готовит';

-- 3. Таблица голосования за блюда
DO $$ BEGIN
  CREATE TABLE IF NOT EXISTS menu_votes (
    id              bigserial PRIMARY KEY,
    event_id        text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    telegram_id     bigint NOT NULL,
    day             int NOT NULL DEFAULT 1,
    meal_type       text NOT NULL,
    dish            text NOT NULL,
    vote            int NOT NULL DEFAULT 1 CHECK (vote BETWEEN -1 AND 1),
    created_at      timestamptz DEFAULT now(),
    UNIQUE (event_id, telegram_id, day, meal_type, dish)
  );
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

COMMENT ON TABLE menu_votes IS 'Голосование участников за блюда в меню';