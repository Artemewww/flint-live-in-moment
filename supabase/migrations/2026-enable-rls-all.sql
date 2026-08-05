-- ============================================================================
-- ВКЛЮЧИТЬ Row-Level Security на ВСЕХ таблицах схемы public.
-- Выполнить ОДИН раз в Supabase → SQL Editor → Run.
--
-- Зачем: Supabase Security Advisor прислал предупреждение «Table publicly
-- accessible / rls_disabled_in_public» — на таблицах выключен RLS, и любой,
-- у кого есть URL проекта + публичный anon-ключ, может читать/писать данные
-- напрямую через PostgREST, В ОБХОД нашего API.
--
-- Почему это БЕЗОПАСНО и НИЧЕГО НЕ СЛОМАЕТ:
--   • Всё приложение ходит в БД только с СЕРВЕРА (api/*) под ключом
--     SUPABASE_SERVICE_ROLE_KEY. У роли service_role есть BYPASSRLS — она
--     игнорирует RLS, поэтому сервер продолжит работать как раньше.
--   • Во фронте (src/) НЕТ Supabase-клиента и НЕТ anon-ключа — проверено.
--     Значит анонимного доступа, который мог бы что-то потерять, попросту нет.
--   • RLS без политик = «запретить всем, кроме BYPASSRLS». Ровно то, что нужно:
--     сервер (service_role) — можно, аноним/публика — нельзя.
--
-- Идемпотентно: повторный запуск безвреден (ENABLE RLS на уже включённой
-- таблице — no-op). Новые таблицы в будущем тоже создавайте с
-- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` или прогоняйте этот файл снова.
-- ============================================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', r.tablename);
    RAISE NOTICE 'RLS включён: %', r.tablename;
  END LOOP;
END $$;

-- Проверка: список таблиц, у которых RLS всё ещё выключен (должно быть ПУСТО).
SELECT tablename AS "таблицы_без_RLS_после_миграции"
FROM pg_tables
WHERE schemaname = 'public'
  AND NOT rowsecurity;
