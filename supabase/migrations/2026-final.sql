-- FLINT «Живи в моменте» — финальная миграция.
-- Выполнить целиком в Supabase SQL Editor. Всё идемпотентно, безопасно повторять.
-- Собирает воедино то, что раньше жило только текстом в PLAN.md §1.

-- ─────────────────────────────────────────────────────────────
-- 1. events: диапазон дат, качества, реквизиты, логистика, жизненный цикл
-- ─────────────────────────────────────────────────────────────
alter table events add column if not exists date_end text;
alter table events add column if not exists house_qualities jsonb default '[]';
alter table events add column if not exists arrival_time text;
alter table events add column if not exists status_reason text;        -- «под вопросом»: причина
alter table events add column if not exists decision_deadline text;    -- дедлайн решения
alter table events add column if not exists payment_details jsonb default '{}';
alter table events add column if not exists rent_amount integer default 0;
alter table events add column if not exists day_price integer default 0;
alter table events add column if not exists logistics jsonb default '{}';
alter table events add column if not exists checklist jsonb default '{}';   -- чек-лист готовности
alter table events add column if not exists is_public boolean default true; -- закрытое событие по коду
alter table events add column if not exists access_code text;
alter table events add column if not exists deputy_id bigint;              -- заместитель на событие

-- Легаси price_type='conscience' → 'free' (кода «на совесть» больше нет).
update events set price_type = 'free' where price_type not in ('free', 'paid') or price_type is null;

-- ─────────────────────────────────────────────────────────────
-- 2. members: закрытый клуб, рефералы, баллы, роли
-- ─────────────────────────────────────────────────────────────
alter table members add column if not exists status text default 'pending';   -- pending|pending_review|approved|blocked
alter table members add column if not exists is_core boolean default false;
alter table members add column if not exists role text default 'member';      -- owner|admin|member
alter table members add column if not exists ref_code text;
alter table members add column if not exists referred_by bigint;
alter table members add column if not exists points integer default 0;
alter table members add column if not exists agreed_pd boolean default false;
alter table members add column if not exists approved_by bigint;
create unique index if not exists uniq_members_ref_code on members(ref_code);

-- ─────────────────────────────────────────────────────────────
-- 3. registrations: даты участия, гости/дети, оплата, явка
-- ─────────────────────────────────────────────────────────────
alter table registrations add column if not exists days jsonb default '[]';
alter table registrations add column if not exists guests jsonb default '[]';
alter table registrations add column if not exists children_count integer default 0;
alter table registrations add column if not exists food_optout boolean default false;
alter table registrations add column if not exists payment_proof text;
alter table registrations add column if not exists payment_submitted_at timestamptz;
alter table registrations add column if not exists contact_revealed boolean default false;
alter table registrations add column if not exists attended boolean default false;
alter table registrations add column if not exists source_hint text;          -- «откуда узнал»
alter table registrations add column if not exists reminded_at timestamptz;   -- анти-дубль напоминаний
alter table registrations add column if not exists pay_reminded_at timestamptz;

-- Одна АКТИВНАЯ заявка на событие от одного человека. Частичный индекс:
-- отменённые заявки не мешают записаться заново.
create unique index if not exists uniq_reg_event_member
  on registrations(event_id, telegram_id)
  where status <> 'cancelled';

-- ─────────────────────────────────────────────────────────────
-- 4. Сессии диалога бота
-- ─────────────────────────────────────────────────────────────
create table if not exists bot_sessions (
  telegram_id bigint primary key,
  state       text,
  context     jsonb default '{}',
  updated_at  timestamptz default now()
);

-- ─────────────────────────────────────────────────────────────
-- 5. Рефералы
-- ─────────────────────────────────────────────────────────────
create table if not exists referrals (
  id         bigserial primary key,
  ref_code   text,
  inviter_id bigint,
  invited_id bigint,
  event_id   text,
  created_at timestamptz default now(),
  rewarded   boolean default false
);
create index if not exists idx_referrals_inviter on referrals(inviter_id);

-- ─────────────────────────────────────────────────────────────
-- 6. Голосования (общий механизм) + голоса за программу
-- ─────────────────────────────────────────────────────────────
create table if not exists polls (
  id         bigserial primary key,
  event_id   text references events(id) on delete cascade,
  question   text,
  options    jsonb default '[]',
  deadline   text,
  created_by bigint,
  created_at timestamptz default now()
);
create table if not exists poll_votes (
  poll_id     bigint references polls(id) on delete cascade,
  telegram_id bigint,
  choice      int,
  created_at  timestamptz default now(),
  primary key (poll_id, telegram_id)
);

-- Голос за вариант программы события (используется ProgramVoting на сайте).
create table if not exists program_votes (
  id          bigserial primary key,
  event_id    text not null references events(id) on delete cascade,
  telegram_id bigint,
  option      text not null,
  created_at  timestamptz default now(),
  unique (event_id, telegram_id)
);
create index if not exists idx_program_votes_event on program_votes(event_id);

-- ─────────────────────────────────────────────────────────────
-- 7. «Мне интересно» — сигнал спроса на событие
-- ─────────────────────────────────────────────────────────────
create table if not exists interests (
  id          bigserial primary key,
  event_id    text not null references events(id) on delete cascade,
  telegram_id bigint,
  created_at  timestamptz default now(),
  unique (event_id, telegram_id)
);
create index if not exists idx_interests_event on interests(event_id);

-- ─────────────────────────────────────────────────────────────
-- 8. Обратная связь после события
-- ─────────────────────────────────────────────────────────────
create table if not exists feedback (
  id           bigserial primary key,
  event_id     text not null references events(id) on delete cascade,
  telegram_id  bigint,
  rating       int check (rating between 1 and 5),
  would_return boolean,
  comment      text,
  created_at   timestamptz default now(),
  unique (event_id, telegram_id)
);
create index if not exists idx_feedback_event on feedback(event_id);

-- ─────────────────────────────────────────────────────────────
-- 9. Задачи / поручения (доска задач события)
-- ─────────────────────────────────────────────────────────────
create table if not exists tasks (
  id         bigserial primary key,
  event_id   text references events(id) on delete cascade,
  title      text,
  taken_by   bigint,
  done       boolean default false,
  created_by bigint,
  created_at timestamptz default now()
);
create index if not exists idx_tasks_event on tasks(event_id);

-- ─────────────────────────────────────────────────────────────
-- 9b. rides.seats_taken — счётчик занятых мест.
-- Миграция Фазы 4 (2026-phase4-rides.sql) эту колонку не создала, хотя бот на
-- неё опирался: занятые места не считались, «свободно» всегда равнялось всего.
-- Создаём и пересчитываем из фактических броней.
-- ─────────────────────────────────────────────────────────────
alter table rides add column if not exists seats_taken int default 0;

update rides
   set seats_taken = (select count(*) from ride_bookings b where b.ride_id = rides.id)
 where seats_taken is distinct from (select count(*) from ride_bookings b where b.ride_id = rides.id);

-- ─────────────────────────────────────────────────────────────
-- 10. RPC
-- ─────────────────────────────────────────────────────────────

-- Начисление баллов (за достижение, не за факт регистрации).
create or replace function award_points(tg bigint, n int)
returns void as $$
begin
  update members set points = coalesce(points, 0) + n where telegram_id = tg;
end;
$$ language plpgsql;

-- Атомарная бронь места в машине: одним UPDATE, без гонки read-modify-write.
-- Возвращает 'ok' | 'full' | 'gone' | 'dup'.
create or replace function book_ride_seat(p_ride_id bigint, p_passenger bigint, p_name text)
returns text as $$
declare
  updated int;
begin
  if exists (select 1 from ride_bookings where ride_id = p_ride_id and passenger_id = p_passenger) then
    return 'dup';
  end if;

  -- Условие в WHERE делает захват места атомарным: два параллельных вызова
  -- на последнее место — второй увидит updated = 0.
  update rides
     set seats_taken = coalesce(seats_taken, 0) + 1
   where id = p_ride_id
     and active = true
     and coalesce(seats_taken, 0) < coalesce(seats_total, 0);
  get diagnostics updated = row_count;

  if updated = 0 then
    if not exists (select 1 from rides where id = p_ride_id and active = true) then
      return 'gone';
    end if;
    return 'full';
  end if;

  insert into ride_bookings (ride_id, passenger_id, passenger_name)
  values (p_ride_id, p_passenger, p_name);
  return 'ok';
end;
$$ language plpgsql;

-- Освобождение места (отмена брони пассажиром).
create or replace function cancel_ride_seat(p_ride_id bigint, p_passenger bigint)
returns text as $$
declare
  removed int;
begin
  delete from ride_bookings where ride_id = p_ride_id and passenger_id = p_passenger;
  get diagnostics removed = row_count;
  if removed = 0 then return 'none'; end if;
  update rides set seats_taken = greatest(0, coalesce(seats_taken, 0) - 1) where id = p_ride_id;
  return 'ok';
end;
$$ language plpgsql;

-- ─────────────────────────────────────────────────────────────
-- 11. Костяк-владелец
-- ─────────────────────────────────────────────────────────────
insert into members (telegram_id, username, first_name, is_core, status, role)
values (377551019, 'Demarts', 'ARTDEMENTIEV.BY', true, 'approved', 'owner')
on conflict (telegram_id) do update set is_core = true, status = 'approved', role = 'owner';
