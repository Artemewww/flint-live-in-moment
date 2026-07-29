-- Пост-сверка чеков: загрузил чек + сумма → делёж по головам → каждому доля

-- Чеки на событие
create table if not exists event_bills (
  id bigserial primary key,
  event_id text not null,
  telegram_id bigint not null, -- кто загрузил чек
  title text not null, -- "Закупка на завтрак", "Бензин"
  amount numeric(10,2) not null, -- общая сумма
  currency text default 'BYN',
  receipt_url text, -- фото чека
  split_type text default 'equal', -- equal|custom|percent
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_event_bills_event on event_bills(event_id);

-- Доли участников в чеке
create table if not exists bill_splits (
  id bigserial primary key,
  bill_id bigint not null references event_bills(id) on delete cascade,
  telegram_id bigint not null,
  name text,
  share_amount numeric(10,2) not null default 0, -- сколько должен
  paid boolean default false, -- оплатил ли
  paid_at timestamptz,
  created_at timestamptz default now(),
  unique(bill_id, telegram_id)
);

create index if not exists idx_bill_splits_bill on bill_splits(bill_id);
create index if not exists idx_bill_splits_tg on bill_splits(telegram_id);

-- Функция: автоматический равный сплит
create or replace function auto_split_bill(
  p_bill_id bigint,
  p_participant_ids bigint[]
) returns void as $$
declare
  v_bill record;
  v_share numeric(10,2);
  v_count int;
  v_tg bigint;
begin
  select * into v_bill from event_bills where id = p_bill_id;
  if not found then
    raise exception 'Bill not found';
  end if;

  v_count := array_length(p_participant_ids, 1);
  if v_count is null or v_count = 0 then
    raise exception 'No participants';
  end if;

  v_share := round(v_bill.amount / v_count, 2);

  foreach v_tg in array p_participant_ids loop
    insert into bill_splits (bill_id, telegram_id, share_amount)
    values (p_bill_id, v_tg, v_share)
    on conflict (bill_id, telegram_id) do nothing;
  end loop;
end;
$$ language plpgsql;

-- Функция: отметить оплату доли
create or replace function mark_split_paid(
  p_split_id bigint
) returns void as $$
begin
  update bill_splits
  set paid = true, paid_at = now()
  where id = p_split_id;
end;
$$ language plpgsql;

-- Функция: получить сводку по чеку (кто сколько должен/оплатил)
create or replace function get_bill_summary(p_bill_id bigint)
returns jsonb as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'total', b.amount,
    'paid', coalesce((select sum(share_amount) from bill_splits where bill_id = p_bill_id and paid), 0),
    'unpaid', coalesce((select sum(share_amount) from bill_splits where bill_id = p_bill_id and not paid), 0),
    'participants', (
      select jsonb_agg(jsonb_build_object(
        'telegram_id', s.telegram_id,
        'name', s.name,
        'share', s.share_amount,
        'paid', s.paid
      ) order by s.telegram_id)
      from bill_splits s
      where s.bill_id = p_bill_id
    )
  ) into v_result
  from event_bills b
  where b.id = p_bill_id;

  return v_result;
end;
$$ language plpgsql stable;