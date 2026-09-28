-- ============================================================================
-- ПОСТУПКИ С СОБЫТИЙ: «кто что сделал» из переписки чата              28.09.2026
--
-- Запустить ОДИН раз: Supabase -> SQL Editor -> вставить целиком -> Run.
-- Идемпотентно (можно запускать повторно).
--
-- ЗАЧЕМ. После выезда все хорошие дела видны только в переписке: Аня снимала
-- видео, Людмила привезла еду, Артём разрулил затор из двух мерседесов. В базе
-- об этом не остаётся НИЧЕГО — репутация не растёт, а через месяц уже никто не
-- вспомнит, кто вывез выезд. Теперь ИИ достаёт такие эпизоды из чата, кладёт
-- сюда, и после ОДНОГО подтверждения организатора эпизод становится сигналом
-- репутации (reputation_events) и приносит баллы.
--
-- ПОЧЕМУ ОТДЕЛЬНАЯ ТАБЛИЦА, А НЕ СРАЗУ reputation_events. ИИ ошибается и
-- склонен к лести. Пока организатор не подтвердил, эпизод живёт здесь и НЕ
-- влияет ни на репутацию, ни на баллы. Подтверждённый — уходит в
-- reputation_events (source='organizer'), и дальше работает существующая
-- система из api/_lib/reputation.ts без единой правки.
--
-- КТО ПОДТВЕРЖДАЕТ. Организатор события (events.deputy_id), а не весь костяк:
-- организаторов много, и грузить каждого чужими выездами нельзя. Костяк видит
-- всё в админке, но уведомления получает только тот, кто вёл это событие.
--
-- СТОИМОСТЬ. Разбор идёт ВНУТРИ уже существующего часового дайджеста
-- (maybeDigestChat) — дополнительные вызовы Gemini не тратятся, квота free-тира
-- не съедается. Отдельный разбор запускается только командой /разбор.
-- ============================================================================

-- ── 1. Эпизоды-кандидаты ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_contributions (
  id          BIGSERIAL PRIMARY KEY,
  event_id    TEXT        NOT NULL,            -- events.id — TEXT
  subject_id  BIGINT      NOT NULL,            -- КТО сделал (members.telegram_id)
  kind        TEXT        NOT NULL,            -- код сигнала из SIGNALS (helped, role_done, ...)
  title       TEXT        NOT NULL,            -- короткая формулировка поступка для списка
  quote       TEXT,                            -- цитата из чата: основание, а не вымысел
  confidence  NUMERIC     NOT NULL DEFAULT 0,  -- уверенность ИИ 0..1

  -- Источник: из какого чата и какого сообщения. Нужно, чтобы дать
  -- организатору ссылку «открыть сообщение» и проверить своими глазами.
  chat_id     BIGINT,
  message_id  BIGINT,

  -- pending — ИИ нашёл, ждём организатора. confirmed — принято, сигнал ушёл.
  -- rejected — организатор сказал «нет, не было».
  status      TEXT        NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'confirmed', 'rejected')),

  reviewed_by   BIGINT,                        -- кто подтвердил/отклонил
  reviewed_at   TIMESTAMPTZ,
  points_awarded INT      NOT NULL DEFAULT 0,  -- сколько баллов дали при подтверждении

  -- Куда положили в репутации. Заполняется при подтверждении: если сигнал
  -- потом удалят, строку в event_contributions всё равно видно — история цела.
  reputation_event_id BIGINT,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Один и тот же поступок не должен всплывать дважды при повторных разборах:
-- ИИ перечитывает те же сообщения и снова находит Аню с камерой.
CREATE UNIQUE INDEX IF NOT EXISTS event_contributions_uniq
  ON event_contributions (event_id, subject_id, kind, message_id)
  WHERE message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS event_contributions_event_idx
  ON event_contributions (event_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS event_contributions_subject_idx
  ON event_contributions (subject_id, created_at DESC);
CREATE INDEX IF NOT EXISTS event_contributions_pending_idx
  ON event_contributions (status, created_at DESC) WHERE status = 'pending';

COMMENT ON TABLE event_contributions IS
  'Поступки участников, найденные ИИ в переписке чата события. До подтверждения организатором не влияют на репутацию и баллы.';
COMMENT ON COLUMN event_contributions.kind IS
  'Код сигнала из SIGNALS (api/_lib/reputation.ts): helped, role_done, calm_conflict, driver, growth...';
COMMENT ON COLUMN event_contributions.quote IS
  'Цитата из переписки — основание. Организатор видит, из чего ИИ сделал вывод.';
COMMENT ON COLUMN event_contributions.confidence IS
  'Уверенность ИИ 0..1. Ниже порога эпизод не показываем: пусть лучше пропустит, чем выдумает.';
COMMENT ON COLUMN event_contributions.status IS
  'pending — ждёт организатора, confirmed — сигнал ушёл в репутацию, rejected — организатор отклонил.';

-- ── 2. Репутация знает, из какого эпизода пришёл сигнал ──────────────────────
-- Обратная ссылка нужна, чтобы «убрать» сигнал вместе с эпизодом, если
-- организатор передумал: подтвердил, потом понял, что ИИ не так понял.
ALTER TABLE reputation_events
  ADD COLUMN IF NOT EXISTS contribution_id BIGINT;

COMMENT ON COLUMN reputation_events.contribution_id IS
  'Если сигнал пришёл из подтверждённого поступка (event_contributions), здесь его id — чтобы можно было откатить.';

-- ── 3. RLS: только через service_role ──────────────────────────────────────
ALTER TABLE event_contributions ENABLE ROW LEVEL SECURITY;

-- Проверка: должно вернуть ПУСТОЙ список.
SELECT tablename AS "таблицы_без_RLS"
FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity;
