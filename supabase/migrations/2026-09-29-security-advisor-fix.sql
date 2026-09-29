-- ============================================================================
-- ИСПРАВЛЕНИЕ ПРЕДУПРЕЖДЕНИЙ SUPABASE SECURITY ADVISOR               29.09.2026
--
-- Запустить: Supabase -> SQL Editor -> вставить целиком -> Run.
-- Идемпотентно (можно запускать повторно).
--
-- Закрывает:
--   • rls_disabled_in_public  — таблицы public без Row-Level Security;
--   • security_definer_view   — VIEW challenge_checkins обходит RLS.
--
-- Ничего не ломает: сервер (api/*) ходит в БД только под service_role,
-- у которой BYPASSRLS. Во фронте Supabase-клиента и anon-ключа нет.
-- ============================================================================

-- ── 1. RLS на всех таблицах public ─────────────────────────────────────────
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', r.tablename);
    RAISE NOTICE 'RLS включён: %', r.tablename;
  END LOOP;
END $$;

-- ── 2. Все VIEW в public — с правами вызывающего, а не владельца ────────────
-- Иначе VIEW читает таблицы от имени postgres и RLS на них не действует.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT viewname FROM pg_views WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true);', r.viewname);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated;', r.viewname);
    RAISE NOTICE 'VIEW закрыт: %', r.viewname;
  END LOOP;
END $$;

-- ── 3. Проверка: оба списка должны быть ПУСТЫМИ ────────────────────────────
SELECT 'таблица без RLS' AS проблема, tablename AS объект
FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity
UNION ALL
SELECT 'VIEW без security_invoker', c.relname
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'v'
  AND NOT coalesce(c.reloptions @> ARRAY['security_invoker=true'], false);
