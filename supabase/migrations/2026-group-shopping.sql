-- Коллективная закупка еды: участники выбирают категории, пишут пожелания,
-- ИИ формирует список, назначается закупщик, дедлайн, сплит

-- Групповые закупки (один на событие или несколько в процессе)
create table if not exists group_shopping (
  id bigserial primary key,
  event_id text not null,
  title text not null, -- "Закупка на завтрак", "Мороженое на поляне"
  organizer_tg bigint not null, -- кто инициировал
  organizer_name text,
  deadline timestamptz, -- до какого времени можно присоединиться
  status text default 'collecting', -- collecting|confirmed|purchased|closed
  items jsonb default '[]', -- [{item, qty, note, requested_by:[tg_ids]}]
  buyer_tg bigint, -- кто взялся закупить
  buyer_name text,
  total_cost numeric(10,2),
  receipt_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_group_shopping_event on group_shopping(event_id);
create index if not exists idx_group_shopping_status on group_shopping(status);

-- Участие в закупке: кто участвует, что хочет, сколько скинул
create table if not exists shopping_participants (
  id bigserial primary key,
  shopping_id bigint not null references group_shopping(id) on delete cascade,
  telegram_id bigint not null,
  name text,
  preferences jsonb, -- {categories: [dairy, sweets, drinks], custom: "текст свободной формы"}
  amount_paid numeric(10,2) default 0,
  payment_confirmed boolean default false,
  joined_at timestamptz default now(),
  unique(shopping_id, telegram_id)
);

create index if not exists idx_shopping_parts_shop on shopping_participants(shopping_id);
create index if not exists idx_shopping_parts_tg on shopping_participants(telegram_id);

-- Категории предпочтений (для быстрого выбора)
create table if not exists food_categories (
  id serial primary key,
  slug text unique not null, -- dairy, sweets, meat, fruits, drinks, snacks
  title_ru text not null,
  emoji text,
  typical_items jsonb -- ["молоко", "йогурт", "сметана"] для подсказок ИИ
);

insert into food_categories (slug, title_ru, emoji, typical_items) values
('dairy', 'Молочка', '🥛', '["молоко", "йогурт", "сметана", "творог", "кефир", "сыр"]'),
('sweets', 'Сладости', '🍫', '["шоколад", "печенье", "конфеты", "вафли", "мармелад"]'),
('fruits', 'Фрукты', '🍎', '["яблоки", "бананы", "апельсины", "виноград", "ягоды"]'),
('drinks', 'Напитки', '🥤', '["вода", "сок", "чай", "кофе", "лимонад"]'),
('snacks', 'Перекус', '🥨', '["орехи", "сухофрукты", "чипсы", "сухарики", "батончики"]'),
('meat', 'Мясное', '🥩', '["колбаса", "сосиски", "курица", "мясо для шашлыка"]'),
('veggies', 'Овощи', '🥗', '["помидоры", "огурцы", "перец", "лук", "зелень"]'),
('bread', 'Хлеб', '🍞', '["хлеб", "булочки", "лаваш", "батон"]')
on conflict (slug) do nothing;

-- Функция: кто НЕ участвует в закупке (но едет на событие)
create or replace function get_shopping_non_participants(p_shopping_id bigint, p_event_id text)
returns table(telegram_id bigint, name text, has_own_food boolean) as $$
  select r.telegram_id, r.name, 
    (r.notes ilike '%своя еда%' or r.notes ilike '%сам%еда%') as has_own_food
  from registrations r
  left join shopping_participants sp on sp.shopping_id = p_shopping_id and sp.telegram_id = r.telegram_id
  where r.event_id = p_event_id
    and r.status = 'approved'
    and r.telegram_id is not null
    and sp.id is null;
$$ language sql stable;
