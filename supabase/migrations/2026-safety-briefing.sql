-- Техника безопасности: обязательное подтверждение перед выездом
-- Каждое мероприятие имеет свой набор правил, все участники должны подписаться

-- Правила безопасности для событий (location-specific)
create table if not exists event_safety_rules (
  id bigserial primary key,
  event_id text not null,
  location_type text not null, -- quarry|forest|lake|mountain|city
  rules jsonb not null, -- [{title, text, critical}] тезисные правила
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_safety_rules_event on event_safety_rules(event_id);

-- Подтверждения участников (кто ознакомился)
create table if not exists safety_confirmations (
  id bigserial primary key,
  event_id text not null,
  telegram_id bigint not null,
  confirmed_at timestamptz default now(),
  rules_version int not null default 1, -- если правила обновились → переподтвердить
  unique(event_id, telegram_id)
);

create index if not exists idx_safety_conf_event on safety_confirmations(event_id);
create index if not exists idx_safety_conf_tg on safety_confirmations(telegram_id);

-- Шаблоны правил по типам локаций
insert into event_safety_rules (event_id, location_type, rules) values
('_template_quarry', 'quarry', '[
  {"title": "Никто один не ходит", "text": "Особенно на обзорной экскурсии", "critical": true},
  {"title": "Лагерь в лесу", "text": "Палатки и костёр только в лесной зоне", "critical": false},
  {"title": "Купание запрещено", "text": "В меловых карьерах не купаемся", "critical": true},
  {"title": "Связь", "text": "Держим телефон заряженным, координатор всегда на связи", "critical": true}
]'),
('_template_forest', 'forest', '[
  {"title": "Не отходим от группы", "text": "В лесу держимся вместе", "critical": true},
  {"title": "Костёр", "text": "Только в отведённых местах, полностью тушим перед уходом", "critical": true},
  {"title": "Мусор с собой", "text": "Всё, что принесли — забираем", "critical": false}
]')
on conflict do nothing;

-- Функция: кто не подтвердил правила для события
create or replace function get_unconfirmed_safety(p_event_id text)
returns table(telegram_id bigint, name text, status text) as $$
  select r.telegram_id, r.name, r.status
  from registrations r
  left join safety_confirmations s on s.event_id = r.event_id and s.telegram_id = r.telegram_id
  where r.event_id = p_event_id
    and r.status in ('approved', 'pending')
    and r.telegram_id is not null
    and s.id is null;
$$ language sql stable;
