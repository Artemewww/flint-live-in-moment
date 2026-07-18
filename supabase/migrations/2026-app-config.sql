-- Глобальные настройки бота: пока только Gemini-ключ + throttle для уведомления
-- о закончившейся квоте. key/value, чтобы не плодить миграции под каждую новую настройку.
create table if not exists app_config (
  key text primary key,
  value text,
  updated_at timestamptz default now(),
  updated_by bigint
);
