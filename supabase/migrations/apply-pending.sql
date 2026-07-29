-- ============================================
-- PENDING MIGRATIONS — apply via Supabase Dashboard SQL Editor
-- ============================================

-- 2026-guests-pickup.sql
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


-- 2026-equipment-ai.sql
-- Система снаряжения с ИИ-парсингом

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


-- 2026-group-ai-manager.sql
-- ИИ-менеджер групповых чатов

create table if not exists group_messages (
  id bigserial primary key,
  event_id text not null,
  telegram_id bigint not null,
  message_text text not null,
  message_type text default 'user', -- user|ai|system
  parent_message_id bigint, -- для тредов
  is_important boolean default false,
  is_answered boolean default false,
  created_at timestamptz default now()
);

create index if not exists idx_group_messages_event on group_messages(event_id);
create index if not exists idx_group_messages_tg on group_messages(telegram_id);
create index if not exists idx_group_messages_parent on group_messages(parent_message_id);

-- Функция: получить важные неотвеченные вопросы
create or replace function get_unanswered_questions(p_event_id text)
returns table(
  id bigint,
  telegram_id bigint,
  message_text text,
  created_at timestamptz,
  is_important boolean
) as $$
  select id, telegram_id, message_text, created_at, is_important
  from group_messages
  where event_id = p_event_id
    and message_type = 'user'
    and is_important = true
    and is_answered = false
  order by created_at asc;
$$ language sql stable;

-- Функция: отметить вопрос как отвеченный
create or replace function mark_question_answered(p_message_id bigint)
returns void as $$
begin
  update group_messages
  set is_answered = true
  where id = p_message_id;
end;
$$ language plpgsql;