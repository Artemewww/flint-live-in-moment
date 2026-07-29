-- Медиа-галерея события: участники сдают фото/видео → общая галерея
-- Через 7 дней остаётся топ-5 по голосам

create table if not exists event_media (
  id bigserial primary key,
  event_id text not null,
  telegram_id bigint not null, -- кто загрузил
  media_type text not null, -- photo|video
  url text not null, -- ссылка на файл (TG file_id или внешний URL)
  thumb_url text, -- превью
  caption text, -- подпись от автора
  is_approved boolean default true, -- модерация (сначала авто-ок, админ может скрыть)
  vote_count int default 0, -- количество голосов
  created_at timestamptz default now()
);

create index if not exists idx_event_media_event on event_media(event_id);
create index if not exists idx_event_media_votes on event_media(vote_count desc);

-- Голоса за медиа
create table if not exists media_votes (
  id bigserial primary key,
  media_id bigint not null references event_media(id) on delete cascade,
  telegram_id bigint not null,
  created_at timestamptz default now(),
  unique(media_id, telegram_id)
);

create index if not exists idx_media_votes_media on media_votes(media_id);

-- Авто-архивация: через 7 дней после события топ-5 остаётся, остальное скрывается
create or replace function auto_archive_media() returns void as $$
declare
  rec record;
begin
  for rec in
    select e.id as event_id, em.date_max
    from (
      select event_id, max(created_at) as date_max
      from event_media
      group by event_id
    ) em
    join events e on e.id = em.event_id
    where em.date_max < now() - interval '7 days'
  loop
    -- Оставляем топ-5 по голосам
    update event_media
    set is_approved = false
    where event_id = rec.event_id
      and id not in (
        select id from event_media
        where event_id = rec.event_id
        order by vote_count desc
        limit 5
      );
  end loop;
end;
$$ language plpgsql;