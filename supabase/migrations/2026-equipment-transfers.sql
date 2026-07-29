-- Передача снаряжения между участниками с подтверждением
create table if not exists equipment_transfers (
  id bigserial primary key,
  equipment_id bigint not null, -- ID из member_equipment
  from_telegram_id bigint not null, -- кто отдаёт
  to_telegram_id bigint not null, -- кто принимает
  item_name text not null, -- название предмета
  quantity int default 1,
  status text default 'pending', -- pending|confirmed|declined
  created_at timestamptz default now(),
  confirmed_at timestamptz,
  declined_at timestamptz
);

create index if not exists idx_eq_transfers_from on equipment_transfers(from_telegram_id);
create index if not exists idx_eq_transfers_to on equipment_transfers(to_telegram_id);
create index if not exists idx_eq_transfers_status on equipment_transfers(status);