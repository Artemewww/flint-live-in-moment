-- Задачи события: кому назначено, кем и к какому сроку.
-- Раньше задачу можно было только «взять» самому — назначить её человеку из
-- состава и поставить дедлайн было нельзя, и в моменте никто не видел, что
-- горит. Код работает и без этих колонок (просто без срока) — но с ними
-- видно просроченное.
-- ЗАПУСТИТЬ В: Supabase Dashboard → SQL Editor. Идемпотентно.

alter table tasks add column if not exists due_at timestamptz;
alter table tasks add column if not exists assigned_by bigint;
alter table tasks add column if not exists done_at timestamptz;
create index if not exists idx_tasks_event_due on tasks(event_id, due_at);

-- Задачи v2: кто вызвался помочь, тип задачи и кого подтвердить.
-- kind = 'confirm' — «подтвердить участие»: target_id — чьё участие
-- подтверждаем; кнопка «Пингануть» шлёт ему «Подтверждаю / Не еду».
alter table tasks add column if not exists helpers jsonb default '[]'::jsonb;
alter table tasks add column if not exists kind text;
alter table tasks add column if not exists target_id bigint;
