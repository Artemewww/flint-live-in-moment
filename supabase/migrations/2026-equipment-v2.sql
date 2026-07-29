-- Снаряжение v2: стоимость, фото, состояние, контроль
-- Каждый предмет имеет владельца, стоимость, фото, комплектность

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

-- Расширяем equipment_transfers: фото ДО, состояние ДО, подпись
alter table equipment_transfers add column if not exists photo_before text; -- фото перед передачей
alter table equipment_transfers add column if not exists condition_before text; -- состояние перед передачей
alter table equipment_transfers add column if not exists completeness_before jsonb default '[]'; -- комплектность перед передачей
alter table equipment_transfers add column if not exists photo_after text; -- фото после возврата
alter table equipment_transfers add column if not exists condition_after text; -- состояние после возврата
alter table equipment_transfers add column if not exists completeness_after jsonb default '[]';
alter table equipment_transfers add column if not exists compensation_amount numeric(10,2) default 0; -- сумма компенсации при утере
alter table equipment_transfers add column if not exists compensation_paid boolean default false;
alter table equipment_transfers add column if not exists notes text; -- примечания к передаче

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