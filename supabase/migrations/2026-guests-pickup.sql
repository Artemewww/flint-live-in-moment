-- Управление гостями с изменениями + координаты встречи + напоминания

-- Расширяем registrations: изменяемое количество гостей
alter table registrations add column if not exists guest_details jsonb;
-- {count: 2, names: ["Иван", "Мария"], changed_at: "2026-07-15T10:00:00Z"}

-- Точки встречи/забора участников
create table if not exists pickup_points (
  id bigserial primary key,
  event_id text not null,
  telegram_id bigint not null, -- кого забирают
  name text,
  address text not null, -- "ул. Ленина 5" или текстовое описание
  lat numeric(10,7), -- координаты в цифрах: 53.9045, 27.5615
  lon numeric(10,7),
  pickup_time timestamptz not null, -- когда забрать
  notes text, -- "забрать вещи: рюкзак, палатку"
  driver_tg bigint, -- кто взялся забрать
  driver_name text,
  confirmed boolean default false,
  reminder_sent boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_pickup_event on pickup_points(event_id);
create index if not exists idx_pickup_tg on pickup_points(telegram_id);
create index if not exists idx_pickup_time on pickup_points(pickup_time);
create index if not exists idx_pickup_driver on pickup_points(driver_tg);

-- Автонапоминания: что нужно напомнить и кому
create table if not exists auto_reminders (
  id bigserial primary key,
  event_id text not null,
  telegram_id bigint not null, -- кому напомнить
  reminder_type text not null, -- safety_confirm|guest_update|pickup_confirm|shopping_deadline
  reference_id bigint, -- ID связанной записи (pickup_points.id, shopping.id и т.д.)
  message text not null, -- текст напоминания
  remind_at timestamptz not null, -- когда напомнить
  sent boolean default false,
  attempts int default 0, -- сколько раз уже напомнили
  max_attempts int default 3,
  created_at timestamptz default now()
);

create index if not exists idx_reminders_time on auto_reminders(remind_at) where not sent;
create index if not exists idx_reminders_tg on auto_reminders(telegram_id);
create index if not exists idx_reminders_type on auto_reminders(reminder_type);

-- Функция: создать напоминание с умной логикой повторов
create or replace function create_reminder(
  p_event_id text,
  p_telegram_id bigint,
  p_type text,
  p_message text,
  p_remind_at timestamptz,
  p_ref_id bigint default null
) returns bigint as $$
declare
  v_reminder_id bigint;
begin
  insert into auto_reminders (event_id, telegram_id, reminder_type, reference_id, message, remind_at)
  values (p_event_id, p_telegram_id, p_type, p_ref_id, p_message, p_remind_at)
  returning id into v_reminder_id;
  
  return v_reminder_id;
end;
$$ language plpgsql;

-- Функция: получить неподтверждённые пункты (гости, координаты, безопасность)
create or replace function get_pending_confirmations(p_event_id text)
returns jsonb as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'unconfirmed_safety', (
      select jsonb_agg(jsonb_build_object('telegram_id', telegram_id, 'name', name))
      from get_unconfirmed_safety(p_event_id)
    ),
    'unconfirmed_guests', (
      select jsonb_agg(jsonb_build_object('telegram_id', telegram_id, 'name', name, 'guest_count', guest_count))
      from registrations
      where event_id = p_event_id
        and status = 'approved'
        and telegram_id is not null
        and guest_count > 0
        and (guest_details is null or guest_details->>'count' is null)
    ),
    'unconfirmed_pickups', (
      select jsonb_agg(jsonb_build_object('id', id, 'telegram_id', telegram_id, 'name', name, 'pickup_time', pickup_time))
      from pickup_points
      where event_id = p_event_id and not confirmed
    )
  ) into v_result;
  
  return v_result;
end;
$$ language plpgsql stable;
