-- Медиа-галерея события: фото/видео от участников после мероприятия.
-- ХРАНИЛИЩЕ: сами файлы живут в Telegram (file_id) — нам это ничего не стоит
-- и не ест лимиты Supabase (free tier: 500 MB БД, 1 GB Storage). В БД — только
-- метаданные (~200 байт на файл). Отдача на веб — через getFile-прокси.
--
-- ЖИЗНЕННЫЙ ЦИКЛ: 7 дней после события — открытая галерея и голосование,
-- потом cron оставляет топ-5 по голосам, остальные строки удаляются
-- (файлы у отправителей в Telegram остаются — «удаление» = уход из галереи).
--
-- ЗАПУСТИТЬ В: Supabase Dashboard → SQL Editor (DDL из кода недоступен).

create table if not exists event_media (
  id uuid primary key default gen_random_uuid(),
  event_id text not null,
  telegram_id bigint not null,          -- кто прислал
  file_id text not null,                -- Telegram file_id (фото или видео)
  file_unique_id text not null,         -- для дедупликации повторных отправок
  media_type text not null default 'photo' check (media_type in ('photo', 'video')),
  votes int not null default 0,         -- денормализованный счётчик для сортировки
  is_keeper boolean not null default false, -- топ, переживший чистку
  created_at timestamptz not null default now(),
  unique (event_id, file_unique_id)
);

create table if not exists event_media_votes (
  media_id uuid not null references event_media(id) on delete cascade,
  telegram_id bigint not null,
  created_at timestamptz not null default now(),
  primary key (media_id, telegram_id)   -- один голос на файл от человека
);

create index if not exists idx_event_media_event on event_media(event_id, votes desc);

-- RLS: доступ только через service_role (API-слой), как у остальных таблиц.
alter table event_media enable row level security;
alter table event_media_votes enable row level security;
