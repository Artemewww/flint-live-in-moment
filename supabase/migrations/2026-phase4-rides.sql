-- Фаза 4: участник-driven логистика (машины). Каждый водитель сам заявляет условия.
-- Выполнить в Supabase SQL Editor. Идемпотентно.

create table if not exists rides (
  id           bigserial primary key,
  event_id     text not null references events(id) on delete cascade,
  driver_id    bigint not null,           -- telegram_id водителя
  driver_name  text,
  from_point   text,                       -- откуда выезжает
  depart_text  text,                       -- дата+время выезда (свободный текст)
  seats_total  int default 0,              -- сколько мест готов взять
  fuel_cost    int default 0,              -- взнос на бензин ₽/чел (0 = бесплатно)
  note         text,
  active       boolean default true,
  created_at   timestamptz default now()
);
create index if not exists idx_rides_event on rides(event_id);

create table if not exists ride_bookings (
  id             bigserial primary key,
  ride_id        bigint not null references rides(id) on delete cascade,
  passenger_id   bigint not null,          -- telegram_id пассажира
  passenger_name text,
  created_at     timestamptz default now(),
  unique (ride_id, passenger_id)
);
create index if not exists idx_ride_bookings_ride on ride_bookings(ride_id);

-- SOS «нужна попутка»: заявки тех, кому нужно место.
create table if not exists ride_requests (
  id           bigserial primary key,
  event_id     text not null references events(id) on delete cascade,
  passenger_id bigint not null,
  passenger_name text,
  from_area    text,
  active       boolean default true,
  created_at   timestamptz default now(),
  unique (event_id, passenger_id)
);
