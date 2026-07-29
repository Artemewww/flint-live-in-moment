-- Фикс: добавляем недостающие колонки в equipment_transfers
-- (таблица уже существует, но без полей v2)

alter table equipment_transfers add column if not exists photo_before text;
alter table equipment_transfers add column if not exists condition_before text default 'perfect';
alter table equipment_transfers add column if not exists completeness_before jsonb default '[]';
alter table equipment_transfers add column if not exists photo_after text;
alter table equipment_transfers add column if not exists condition_after text;
alter table equipment_transfers add column if not exists completeness_after jsonb default '[]';
alter table equipment_transfers add column if not exists compensation_amount numeric(10,2) default 0;
alter table equipment_transfers add column if not exists compensation_paid boolean default false;
alter table equipment_transfers add column if not exists notes text;

-- Создаём equipment_audit если ещё не существует
create table if not exists equipment_audit (
  id bigserial primary key,
  equipment_id bigint not null,
  item_name text not null,
  from_telegram_id bigint,
  to_telegram_id bigint,
  action text not null,
  photo_url text,
  condition text,
  completeness jsonb,
  notes text,
  created_at timestamptz default now()
);

create index if not exists idx_equipment_audit_item on equipment_audit(equipment_id);
create index if not exists idx_equipment_audit_tg on equipment_audit(to_telegram_id);

-- Создаём media_votes если ещё не существует
-- ВАЖНО: event_media.id имеет тип uuid, поэтому media_id должен быть uuid
create table if not exists media_votes (
  id bigserial primary key,
  media_id uuid not null references event_media(id) on delete cascade,
  telegram_id bigint not null,
  created_at timestamptz default now(),
  unique(media_id, telegram_id)
);

create index if not exists idx_media_votes_media on media_votes(media_id);