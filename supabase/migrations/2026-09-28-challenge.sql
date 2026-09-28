-- ============================================================================
-- ЧЕЛЛЕНДЖИ: ежедневная отметка видео-кружком                      28.09.2026
--
-- Запустить ОДИН раз: Supabase -> SQL Editor -> вставить целиком -> Run.
-- Идемпотентно (можно запускать повторно).
--
-- ЗАЧЕМ. 90-дневный челлендж — не «выезд подольше», а другой жанр: он идёт
-- КАЖДЫЙ день, и ценность в серии. Проверка «день засчитан» — видео-кружок
-- (video_note) в чате челленджа. Новая таблица под это не нужна: отметки
-- пишутся в app_config строками
--   challenge_checkin:<eventId>:<telegramId>:<YYYY-MM-DD>
-- потому что ключ уже уникален, а значение — обычный jsonb-текст с временем
-- подъёма. Здесь только индекс и удобное представление: читать app_config
-- целиком на каждый запрос карточки — это лишние секунды на холоде.
--
-- ПОЧЕМУ НЕ event_media. Один и тот же человек может прислать за день
-- несколько видео: первое засчитываем как отметку, остальные живут в галерее.
-- Смешивать «доказательство» и «контент» в одной строке нельзя — при чистке
-- галереи (топ-5 по голосам) можно случайно потерять факт подъёма.
--
-- ФОРМАТ ЧЕЛЛЕНДЖА В СОБЫТИИ. Флаг живёт в events.notifications (jsonb):
--   { "_format": "challenge", "_scale": "multiday", "is_challenge": true }
-- Отдельная колонка не нужна — тот же приём, что с feat_food и _heatCount.
-- ============================================================================

-- ── 1. Индекс: отметки одного челленджа читаются одним диапазоном ───────────
-- app_config.key — TEXT с PRIMARY KEY, поэтому обычный LIKE по префиксу уже
-- работает, но pattern_ops делает это предсказуемо на десятках тысяч строк.
CREATE INDEX IF NOT EXISTS app_config_challenge_checkin_idx
  ON app_config (key text_pattern_ops)
  WHERE key LIKE 'challenge_checkin:%';

COMMENT ON INDEX app_config_challenge_checkin_idx IS
  'Быстрый разбор отметок челленджа: challenge_checkin:<eventId>:<telegramId>:<дата>.';

-- ── 2. Представление: отметки в виде таблицы ───────────────────────────────
-- Разбирать ключ в коде приходится каждому потребителю (вебхук, cron, API) —
-- и каждый делает это по-своему. Один источник правды в SQL убирает расхождение:
-- «streak считается по-разному в трёх местах» — уже наступали на это.
CREATE OR REPLACE VIEW challenge_checkins AS
SELECT
  split_part(key, ':', 2)                      AS event_id,
  NULLIF(split_part(key, ':', 3), '')::BIGINT  AS telegram_id,
  to_date(split_part(key, ':', 4), 'YYYY-MM-DD') AS checkin_date,
  -- value — jsonb, записанный как текст; битое значение не должно ронять VIEW.
  (CASE WHEN (value::jsonb ? 'time') THEN value::jsonb->>'time' END) AS checkin_time,
  (CASE WHEN (value::jsonb ? 'type') THEN value::jsonb->>'type' END) AS media_type,
  updated_at
FROM app_config
WHERE key LIKE 'challenge_checkin:%'
  AND split_part(key, ':', 4) ~ '^\d{4}-\d{2}-\d{2}$';

COMMENT ON VIEW challenge_checkins IS
  'Отметки челленджа, разобранные из app_config: кто, в какой день и во сколько поднялся.';

-- ── 3. Проверка: какие события сейчас считаются челленджами ─────────────────
-- Должно вернуть 90-Day Challenge (или пусто, если его ещё не помечали).
SELECT id, title, date, date_end
FROM events
WHERE notifications->>'_format' = 'challenge'
   OR notifications->>'is_challenge' = 'true';

-- Проверка: должно вернуть ПУСТОЙ список (все таблицы под RLS).
SELECT tablename AS "таблицы_без_RLS"
FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity;
