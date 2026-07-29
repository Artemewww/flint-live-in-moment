-- Каталог продуктов для Питания-v2
-- Категории + продукты с галочками + "своё"

-- Расширяем food_categories: порядок сортировки, иконка
alter table food_categories add column if not exists sort_order int default 0;
update food_categories set sort_order = 1 where slug = 'dairy';
update food_categories set sort_order = 2 where slug = 'meat';
update food_categories set sort_order = 3 where slug = 'veggies';
update food_categories set sort_order = 4 where slug = 'fruits';
update food_categories set sort_order = 5 where slug = 'bread';
update food_categories set sort_order = 6 where slug = 'sweets';
update food_categories set sort_order = 7 where slug = 'snacks';
update food_categories set sort_order = 8 where slug = 'drinks';

-- Таблица продуктов (каждый продукт привязан к категории)
create table if not exists food_products (
  id serial primary key,
  category_slug text not null references food_categories(slug) on delete cascade,
  name_ru text not null, -- "молоко", "йогурт", "сметана"
  emoji text default '🍽',
  unit text default 'шт', -- шт|кг|л|уп|г
  default_qty numeric(8,2) default 1, -- количество по умолчанию
  sort_order int default 0,
  created_at timestamptz default now(),
  unique(category_slug, name_ru)
);

-- Наполняем продуктами
insert into food_products (category_slug, name_ru, emoji, unit, default_qty, sort_order) values
-- Молочка
('dairy', 'Молоко', '🥛', 'л', 1, 1),
('dairy', 'Йогурт', '🥛', 'шт', 4, 2),
('dairy', 'Сметана', '🥛', 'шт', 2, 3),
('dairy', 'Творог', '🧀', 'шт', 2, 4),
('dairy', 'Кефир', '🥛', 'л', 1, 5),
('dairy', 'Сыр', '🧀', 'кг', 0.3, 6),
('dairy', 'Масло сливочное', '🧈', 'шт', 1, 7),
-- Мясное
('meat', 'Курица', '🍗', 'кг', 1, 1),
('meat', 'Свинина', '🥩', 'кг', 1, 2),
('meat', 'Говядина', '🥩', 'кг', 1, 3),
('meat', 'Колбаса', '🌭', 'шт', 1, 4),
('meat', 'Сосиски', '🌭', 'уп', 1, 5),
('meat', 'Фарш', '🥩', 'кг', 0.5, 6),
('meat', 'Шашлык', '🥩', 'кг', 1, 7),
-- Овощи
('veggies', 'Помидоры', '🍅', 'кг', 0.5, 1),
('veggies', 'Огурцы', '🥒', 'кг', 0.5, 2),
('veggies', 'Перец болгарский', '🫑', 'шт', 2, 3),
('veggies', 'Лук', '🧅', 'кг', 0.5, 4),
('veggies', 'Чеснок', '🧄', 'шт', 3, 5),
('veggies', 'Картофель', '🥔', 'кг', 1, 6),
('veggies', 'Морковь', '🥕', 'кг', 0.5, 7),
('veggies', 'Зелень', '🌿', 'шт', 1, 8),
-- Фрукты
('fruits', 'Яблоки', '🍎', 'кг', 0.5, 1),
('fruits', 'Бананы', '🍌', 'кг', 0.5, 2),
('fruits', 'Апельсины', '🍊', 'кг', 0.5, 3),
('fruits', 'Виноград', '🍇', 'кг', 0.3, 4),
('fruits', 'Лимоны', '🍋', 'шт', 2, 5),
-- Хлеб
('bread', 'Хлеб', '🍞', 'шт', 1, 1),
('bread', 'Булочки', '🥐', 'шт', 6, 2),
('bread', 'Лаваш', '🫓', 'шт', 2, 3),
('bread', 'Батон', '🍞', 'шт', 1, 4),
-- Сладости
('sweets', 'Шоколад', '🍫', 'шт', 2, 1),
('sweets', 'Печенье', '🍪', 'уп', 1, 2),
('sweets', 'Конфеты', '🍬', 'кг', 0.3, 3),
('sweets', 'Вафли', '🧇', 'уп', 1, 4),
('sweets', 'Мармелад', '🍬', 'уп', 1, 5),
-- Перекус
('snacks', 'Орехи', '🥜', 'кг', 0.2, 1),
('snacks', 'Сухофрукты', '🍑', 'кг', 0.2, 2),
('snacks', 'Чипсы', '🥨', 'уп', 1, 3),
('snacks', 'Сухарики', '🥨', 'уп', 1, 4),
('snacks', 'Батончики', '🍫', 'шт', 4, 5),
-- Напитки
('drinks', 'Вода', '💧', 'л', 1.5, 1),
('drinks', 'Сок', '🧃', 'л', 1, 2),
('drinks', 'Чай', '🫖', 'уп', 1, 3),
('drinks', 'Кофе', '☕', 'уп', 1, 4),
('drinks', 'Лимонад', '🥤', 'л', 1, 5)
on conflict (category_slug, name_ru) do nothing;

-- Выбор продуктов участником для события
create table if not exists food_selections (
  id bigserial primary key,
  event_id text not null,
  telegram_id bigint not null,
  product_id int not null references food_products(id) on delete cascade,
  quantity numeric(8,2) default 1,
  custom_note text, -- "своё" — свободный текст
  created_at timestamptz default now(),
  unique(event_id, telegram_id, product_id)
);

create index if not exists idx_food_selections_event on food_selections(event_id);
create index if not exists idx_food_selections_tg on food_selections(telegram_id);-- Медиа-галерея события: участники сдают фото/видео → общая галерея
-- Через 7 дней остаётся топ-5 по голосам

create table if not exists event_media (
  id bigserial primary key,
  event_id text not null,
  telegram_id bigint not null, -- кто загрузил
  media_type text not null, -- photo|video
  url text not null, -- ссылка на файл (TG file_id или внешний URL)
  thumb_url text, -- превью
  caption text, -- подпись от автора
  is_approved boolean default true, -- модерация (сначала авто-ок, админ может скрыть)
  vote_count int default 0, -- количество голосов
  created_at timestamptz default now()
);

create index if not exists idx_event_media_event on event_media(event_id);
create index if not exists idx_event_media_votes on event_media(vote_count desc);

-- Голоса за медиа
create table if not exists media_votes (
  id bigserial primary key,
  media_id bigint not null references event_media(id) on delete cascade,
  telegram_id bigint not null,
  created_at timestamptz default now(),
  unique(media_id, telegram_id)
);

create index if not exists idx_media_votes_media on media_votes(media_id);

-- Авто-архивация: через 7 дней после события топ-5 остаётся, остальное скрывается
create or replace function auto_archive_media() returns void as $$
declare
  rec record;
begin
  for rec in
    select e.id as event_id, em.date_max
    from (
      select event_id, max(created_at) as date_max
      from event_media
      group by event_id
    ) em
    join events e on e.id = em.event_id
    where em.date_max < now() - interval '7 days'
  loop
    -- Оставляем топ-5 по голосам
    update event_media
    set is_approved = false
    where event_id = rec.event_id
      and id not in (
        select id from event_media
        where event_id = rec.event_id
        order by vote_count desc
        limit 5
      );
  end loop;
end;
$$ language plpgsql;