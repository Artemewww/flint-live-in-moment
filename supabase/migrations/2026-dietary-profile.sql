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

-- 4. Профиль предпочтений по активностям и режиму дня
ALTER TABLE members ADD COLUMN IF NOT EXISTS activity_preferences jsonb DEFAULT '{}'::jsonb;
ALTER TABLE members ADD COLUMN IF NOT EXISTS sleep_schedule jsonb DEFAULT '{}'::jsonb;
ALTER TABLE members ADD COLUMN IF NOT EXISTS fitness_level text DEFAULT '';
ALTER TABLE members ADD COLUMN IF NOT EXISTS medical_notes text DEFAULT '';

COMMENT ON COLUMN members.activity_preferences IS 'Предпочтения по активностям: {"hiking": true, "workshops": false, "games": true}';
COMMENT ON COLUMN members.sleep_schedule IS 'Режим сна: {"bedtime": "23:00", "wake_time": "07:00", "nap_needed": false}';
COMMENT ON COLUMN members.fitness_level IS 'Уровень подготовки: beginner/medium/advanced';
COMMENT ON COLUMN members.medical_notes IS 'Медицинские противопоказания';

-- 5. Библиотека активностей
DO $$ BEGIN
  CREATE TABLE IF NOT EXISTS activities (
    id              bigserial PRIMARY KEY,
    title           text NOT NULL,
    description     text DEFAULT '',
    category        text NOT NULL, -- 'active' | 'intellectual' | 'social' | 'rest'
    duration_min    int DEFAULT 60,
    intensity       text DEFAULT 'medium', -- 'low' | 'medium' | 'high'
    weather_dependent bool DEFAULT true,
    equipment       jsonb DEFAULT '[]'::jsonb,
    max_participants int,
    created_at      timestamptz DEFAULT now()
  );
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

COMMENT ON TABLE activities IS 'Библиотека активностей для мероприятий';
COMMENT ON COLUMN activities.category IS 'Категория: активная, интеллектуальная, социальная, отдых';
COMMENT ON COLUMN activities.intensity IS 'Физическая нагрузка: низкая/средняя/высокая';

-- 6. Расписание мероприятия
DO $$ BEGIN
  CREATE TABLE IF NOT EXISTS event_schedules (
    id              bigserial PRIMARY KEY,
    event_id        text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    day             int NOT NULL DEFAULT 1,
    start_time      text NOT NULL, -- 'HH:MM'
    end_time        text NOT NULL, -- 'HH:MM'
    activity_id     bigint REFERENCES activities(id),
    custom_title    text DEFAULT '',
    location        text DEFAULT '',
    notes           text DEFAULT '',
    created_at      timestamptz DEFAULT now(),
    UNIQUE (event_id, day, start_time)
  );
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

COMMENT ON TABLE event_schedules IS 'Расписание мероприятия по дням';
COMMENT ON COLUMN event_schedules.activity_id IS 'Ссылка на активность из библиотеки';
COMMENT ON COLUMN event_schedules.custom_title IS 'Если нет activity_id — произвольное название';

-- 7. Роли участников на мероприятии
DO $$ BEGIN
  CREATE TABLE IF NOT EXISTS event_roles (
    id              bigserial PRIMARY KEY,
    event_id        text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    telegram_id     bigint NOT NULL,
    role            text NOT NULL, -- 'driver' | 'cook' | 'first_aid' | 'photographer' | 'entertainment' | 'logistics' | 'cleaner' | 'custom'
    custom_name     text DEFAULT '',
    confirmed       boolean DEFAULT false,
    notes           text DEFAULT '',
    created_at      timestamptz DEFAULT now(),
    UNIQUE (event_id, telegram_id, role)
  );
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

COMMENT ON TABLE event_roles IS 'Роли участников на конкретном мероприятии';
COMMENT ON COLUMN event_roles.role IS 'Тип роли: водитель, повар, медик, фотограф, аниматор, логист, уборщик, custom';
COMMENT ON COLUMN event_roles.confirmed IS 'Подтвердил ли участник роль';

-- 8. Библиотека стандартных ролей
DO $$ BEGIN
  CREATE TABLE IF NOT EXISTS role_templates (
    id              bigserial PRIMARY KEY,
    title           text NOT NULL,
    description     text DEFAULT '',
    icon            text DEFAULT '📌',
    skills_required jsonb DEFAULT '[]'::jsonb,
    created_at      timestamptz DEFAULT now()
  );
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

COMMENT ON TABLE role_templates IS 'Шаблоны ролей для мероприятий';

-- 9. Групповые чаты мероприятий
DO $$ BEGIN
  CREATE TABLE IF NOT EXISTS event_chats (
    id              bigserial PRIMARY KEY,
    event_id        text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    chat_id         bigint NOT NULL,
    chat_type       text DEFAULT 'group', -- 'group' | 'supergroup'
    invite_link     text DEFAULT '',
    is_active       boolean DEFAULT true,
    created_at      timestamptz DEFAULT now(),
    UNIQUE (event_id, chat_id)
  );
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

COMMENT ON TABLE event_chats IS 'Групповые чаты Telegram для мероприятий';
COMMENT ON COLUMN event_chats.chat_id IS 'ID чата в Telegram';
COMMENT ON COLUMN event_chats.invite_link IS 'Ссылка для приглашения в чат';

-- 10. Баллы и репутация участников
ALTER TABLE members ADD COLUMN IF NOT EXISTS points integer DEFAULT 0;
ALTER TABLE members ADD COLUMN IF NOT EXISTS attended_count integer DEFAULT 0;
ALTER TABLE members ADD COLUMN IF NOT EXISTS invited_count integer DEFAULT 0;
ALTER TABLE members ADD COLUMN IF NOT EXISTS level text DEFAULT 'newbie'; -- 'newbie' | 'regular' | 'core' | 'legend'
ALTER TABLE members ADD COLUMN IF NOT EXISTS achievements jsonb DEFAULT '[]'::jsonb;

COMMENT ON COLUMN members.points IS 'Баллы за посещения, помощь, рефералы';
COMMENT ON COLUMN members.attended_count IS 'Количество посещённых мероприятий';
COMMENT ON COLUMN members.invited_count IS 'Количество приведённых участников';
COMMENT ON COLUMN members.level IS 'Уровень в клубе';
COMMENT ON COLUMN members.achievements IS 'Достижения: ["first_event", "organizer", "cook", "driver", "photographer"]';

-- 11. Журнал начисления баллов
DO $$ BEGIN
  CREATE TABLE IF NOT EXISTS points_log (
    id              bigserial PRIMARY KEY,
    telegram_id     bigint NOT NULL,
    event_id        text REFERENCES events(id) ON DELETE SET NULL,
    reason          text NOT NULL, -- 'attendance' | 'invite' | 'role' | 'feedback' | 'bonus'
    points          integer NOT NULL,
    description     text DEFAULT '',
    created_at      timestamptz DEFAULT now()
  );
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

COMMENT ON TABLE points_log IS 'Журнал начисления/списания баллов';
COMMENT ON COLUMN points_log.reason IS 'Причина: посещение, приведён, роль, отзыв, бонус';

-- 12. Достижения
DO $$ BEGIN
  CREATE TABLE IF NOT EXISTS achievements (
    id              bigserial PRIMARY KEY,
    code            text NOT NULL UNIQUE, -- 'first_event', 'regular', 'organizer', 'cook', 'driver', 'photographer', 'legend'
    title           text NOT NULL,
    description     text DEFAULT '',
    icon            text DEFAULT '🏆',
    points_required integer DEFAULT 0,
    condition       jsonb DEFAULT '{}'::jsonb -- { "attended_count": 5, "invited_count": 3 }
  );
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

COMMENT ON TABLE achievements IS 'Каталог достижений клуба';
