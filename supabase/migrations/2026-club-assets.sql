-- Реестр инвентаря клуба Flint: чьё снаряжение и у кого сейчас на руках, когда
-- взял, сколько держит + история передач. Отдельно от gear_inventory (то — про
-- снаряжение участника на конкретное событие, а это — учёт активов клуба).

create table if not exists club_assets (
  id          text primary key,
  name        text not null,
  category    text,                 -- палатка / экран / флаг / баня / освещение / кухня / прочее
  owner_name  text,                 -- чьё (принадлежность)
  holder_name text,                 -- у кого сейчас на руках
  holder_id   bigint,               -- telegram_id держателя (опц., для уведомлений/запросов)
  taken_at    timestamptz,          -- когда текущий держатель взял
  qty         int default 1,
  is_shared   boolean default false,-- складчина (несколько владельцев)
  location    text,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- История передач: кто→кому, когда, фото-подтверждение.
create table if not exists asset_handoffs (
  id        uuid primary key default gen_random_uuid(),
  asset_id  text references club_assets(id) on delete cascade,
  from_name text, to_name text, from_id bigint, to_id bigint,
  at        timestamptz not null default now(),
  photo     text, note text
);
create index if not exists idx_asset_handoffs_asset on asset_handoffs(asset_id, at desc);

-- ── Сид: инвентарь на 23.07.2026 (диктовка владельца) ──────────────────────
insert into club_assets (id, name, category, owner_name, holder_name, taken_at, qty, is_shared, notes) values
  ('ast-tent3',      'Палатка трёхместная',            'палатка',    'Артём', 'Артём', null, 1, false, null),
  ('ast-table',      'Стол',                            'прочее',     'Артём', 'Артём', null, 1, false, null),
  ('ast-grill',      'Мангал',                          'кухня',      'Меловые-ребята (складчина)', 'Артём', null, 1, true, 'Куплен вскладчину на Меловых, физически у Артёма'),
  ('ast-screen-big', 'Экран для кино 2×4 м',            'экран',      'Артём', 'Артём', null, 1, false, null),
  ('ast-lamps',      'Лампы гибкие для освещения',      'освещение',  'Артём', 'Артём', null, 2, false, null),
  ('ast-burner',     'Горелка',                         'кухня',      'Артём', 'Артём', null, 1, false, null),
  ('ast-teaburner',  'Чурка для чая (кипятить воду)',   'кухня',      'Артём', 'Артём', null, 1, false, null),
  ('ast-flags',      'Флаги Flint брендовые',           'флаг',       'Олег (@twister312)', 'Артём', '2026-07-23T00:00:00Z', 2, false, 'Взято у Олега 23.07 под выезд на Ислочь'),
  ('ast-oleg-tent',  'Tent (палатка-тент) Олега',       'палатка',    'Олег (@twister312)', 'Артём', '2026-07-23T00:00:00Z', 1, false, 'Взято у Олега 23.07'),
  ('ast-banya',      'Баня',                            'баня',       'Олег (@twister312)', 'Артём', '2026-07-23T00:00:00Z', 1, false, 'Взято у Олега 23.07'),
  ('ast-banya-stove','Печка к бане',                    'баня',       'Олег (@twister312)', 'Артём', '2026-07-23T00:00:00Z', 1, false, 'Взято у Олега 23.07'),
  ('ast-screen-sm',  'Экран для кино ~1.5×1.5 м',       'экран',      'Лиза',  'Лиза',  null, 1, false, null),
  ('ast-tent-small', 'Палатка маленькая (промокаемая)', 'палатка',    'Андрей','Андрей',null, 1, false, 'Промокает'),
  ('ast-tent-big',   'Тент большой (палатка-тент)',     'палатка',    'Андрей','Андрей',null, 1, false, null),
  ('ast-mattress',   'Матрас',                          'прочее',     'Андрей','Андрей',null, 1, false, null),
  ('ast-powerbank',  'PowerBank большой (на компанию)', 'электро',    'Андрей','Андрей',null, 1, false, null)
on conflict (id) do nothing;
