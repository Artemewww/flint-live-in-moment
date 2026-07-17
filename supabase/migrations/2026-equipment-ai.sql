-- Система снаряжения с ИИ-парсингом
-- Каждый участник ведёт свой инвентарь, который может брать на события

-- Личное снаряжение участника (глобальное, не привязано к событию)
create table if not exists member_equipment (
  id bigserial primary key,
  telegram_id bigint not null,
  item text not null,
  quantity int default 1,
  category text, -- палатка/посуда/инструмент/одежда/прочее
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(telegram_id, item) -- для upsert: один предмет = одна запись
);

create index if not exists idx_member_equipment_tg on member_equipment(telegram_id);

-- Снаряжение клуба (общее, может брать кто угодно на событие)
create table if not exists club_equipment (
  id bigserial primary key,
  item text not null,
  quantity int default 1,
  category text,
  owner_id bigint, -- кто добавил/отвечает
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Бронирование клубного снаряжения на событие
create table if not exists equipment_bookings (
  id bigserial primary key,
  event_id text not null,
  equipment_id bigint references club_equipment(id) on delete cascade,
  telegram_id bigint not null,
  quantity int default 1,
  created_at timestamptz default now(),
  unique(event_id, equipment_id, telegram_id)
);

create index if not exists idx_equipment_bookings_event on equipment_bookings(event_id);
