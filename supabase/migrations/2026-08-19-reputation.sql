-- ============================================================================
-- РЕПУТАЦИЯ УЧАСТНИКА + ПОМОЩНИКИ ОРГАНИЗАТОРА («сержанты»)   19.08.2026
--
-- Запустить ОДИН раз: Supabase → SQL Editor → вставить целиком → Run.
-- Идемпотентно (можно запускать повторно). В конце файла — повторное
-- включение RLS на всех таблицах, поэтому этот файл закрывает и предупреждение
-- Security Advisor «Table publicly accessible / rls_disabled_in_public».
--
-- Модель:
--   reputation_events — ОТДЕЛЬНЫЕ СИГНАЛЫ о человеке (факты), а не приговор.
--     Итоговый уровень считается в коде (api/_lib/reputation.ts) из сигналов
--     с затуханием по времени. Так решение остаётся обратимым: удалили сигнал —
--     пересчитался уровень, никакой «вечной метки» в БД нет.
--   member_traits — контекст о человеке (курит, нет прав, языковой барьер).
--     Это НЕ наказание. state='past' = человек это перерос (бросил курить,
--     выучил язык) → в репутации превращается в плюс «рост в клубе».
--   events.staff — помощники организатора на событии («сержанты»).
-- ============================================================================

-- ── 1. Сигналы репутации ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reputation_events (
  id           BIGSERIAL PRIMARY KEY,
  subject_id   BIGINT      NOT NULL,          -- О КОМ сигнал (members.telegram_id)
  author_id    BIGINT,                        -- КТО дал (NULL = система/бот)
  event_id     TEXT,                          -- на каком событии (events.id — TEXT!)
  kind         TEXT        NOT NULL,          -- код сигнала, справочник в коде
  polarity     SMALLINT    NOT NULL DEFAULT 0,-- -1 красный / 0 контекст / +1 зелёный
  weight       NUMERIC     NOT NULL DEFAULT 1,
  source       TEXT        NOT NULL DEFAULT 'peer', -- peer | organizer | core | system | ai
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reputation_events_subject_idx ON reputation_events (subject_id, created_at DESC);
CREATE INDEX IF NOT EXISTS reputation_events_event_idx   ON reputation_events (event_id);

-- Один человек = один сигнал данного вида про данного человека на данном
-- событии. Защита от накрутки: обиженный не может отправить 10 «флажков».
CREATE UNIQUE INDEX IF NOT EXISTS reputation_events_uniq
  ON reputation_events (subject_id, author_id, event_id, kind)
  WHERE author_id IS NOT NULL AND event_id IS NOT NULL;

-- ── 2. Контекст личности: привычки и рост ───────────────────────────────────
CREATE TABLE IF NOT EXISTS member_traits (
  subject_id  BIGINT      NOT NULL,
  trait       TEXT        NOT NULL,           -- smoking | vape | no_license | ...
  state       TEXT        NOT NULL DEFAULT 'active', -- active | past (перерос)
  note        TEXT,
  set_by      BIGINT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (subject_id, trait)
);

-- ── 3. Помощники организатора на событии («сержанты») ───────────────────────
-- Правило клуба: событие больше чем на 10 человек ведёт не один человек —
-- у организатора минимум два помощника, которые держат координацию, деньги
-- и безопасность. Храним прямо в событии (JSON), отдельная таблица не нужна.
ALTER TABLE events ADD COLUMN IF NOT EXISTS staff JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ── 4. RLS на всё, включая новые таблицы ────────────────────────────────────
-- service_role (наш сервер) обходит RLS; anon/public без политик не получает
-- ничего. Во фронте Supabase-клиента нет, ломаться нечему.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', r.tablename);
  END LOOP;
END $$;

-- Проверка: должно вернуть ПУСТОЙ список.
SELECT tablename AS "таблицы_без_RLS"
FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity;
