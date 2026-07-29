-- Снаряжение v2: стоимость, фото, состояние, контроль
-- Каждый предмет имеет владельца, стоимость, фото, комплектность
-- ВНИМАНИЕ: ДО этой миграции должна быть выполнена 2026-equipment-transfers.sql

-- Расширяем member_equipment: добавляем поля стоимости, фото, состояния
alter table member_equipment add column if not exists price numeric(10,2) default 0; -- рыночная стоимость
alter table member_equipment add column if not exists photo_url text; -- фото предмета
alter table member_equipment add column if not exists condition text default 'perfect'; -- perfect|good|worn|damaged
alter table member_equipment add column if not exists completeness jsonb default '[]'; -- ["колышек 4/4", "чехол есть"]
alter table member_equipment add column if not exists access_level text default 'owner'; -- owner|investors|all
alter table member_equipment add column if not exists investors jsonb default '[]'; -- [telegram_id] кто вложился
alter table member_equipment add column if not exists description text; -- описание/примечания

-- Расширяем club_equipment: те же поля
alter table club_equipment add column if not exists price numeric(10,2) default 0;
alter table club_equipment add column if not exists photo_url text;
alter table club_equipment add column if not exists condition text default 'perfect';
alter table club_equipment add column if not exists completeness jsonb default '[]';
alter table club_equipment add column if not exists access_level text default 'all';
alter table club_equipment add column if not exists investors jsonb default '[]';
alter table club_equipment add column if not exists description text;

-- Сначала создаём equipment_transfers если ещё не существует
create table if not exists equipment_transfers (
  id bigserial primary key,
  equipment_id bigint not null,
  from_telegram_id bigint not null,
  to_telegram_id bigint not null,
  item_name text not null,
  quantity int default 1,
  status text default 'pending',
  photo_before text,
  condition_before text default 'perfect',
  completeness_before jsonb default '[]',
  photo_after text,
  condition_after text,
  completeness_after jsonb default '[]',
  compensation_amount numeric(10,2) default 0,
  compensation_paid boolean default false,
  notes text,
  created_at timestamptz default now(),
  confirmed_at timestamptz,
  declined_at timestamptz
);

create index if not exists idx_eq_transfers_from on equipment_transfers(from_telegram_id);
create index if not exists idx_eq_transfers_to on equipment_transfers(to_telegram_id);
create index if not exists idx_eq_transfers_status on equipment_transfers(status);

-- История перемещений предмета (аудит)
create table if not exists equipment_audit (
  id bigserial primary key,
  equipment_id bigint not null,
  item_name text not null,
  from_telegram_id bigint,
  to_telegram_id bigint,
  action text not null, -- created|transferred|returned|damaged|lost|repaired
  photo_url text,
  condition text,
  completeness jsonb,
  notes text,
  created_at timestamptz default now()
);

create index if not exists idx_equipment_audit_item on equipment_audit(equipment_id);
create index if not exists idx_equipment_audit_tg on equipment_audit(to_telegram_id);