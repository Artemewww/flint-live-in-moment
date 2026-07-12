-- Миграция: Мягкая миграция профилей развития
-- Добавляет поля для онбординга и флаг is_profile_completed
-- Идемпотентно: можно перезапускать

-- Поля профиля развития
alter table members add column if not exists is_profile_completed boolean default false;
alter table members add column if not exists dreams text;
alter table members add column if not exists interests jsonb default '[]';
alter table members add column if not exists skills jsonb default '[]';
alter table members add column if not exists development_goal text;

-- Индекс для быстрой фильтрации незавершённых профилей
create index if not exists idx_members_profile_completed on members(is_profile_completed);

-- Комментарии к колонкам
comment on column members.is_profile_completed is 'Завершён ли профиль развития (онбординг)';
comment on column members.dreams is 'Мечты и стремления (текст, собранный в онбординге)';
comment on column members.interests is 'Интересы и увлечения (json-массив строк)';
comment on column members.skills is 'Навыки, которыми готов делиться (json-массив строк)';
comment on column members.development_goal is 'Приоритетная цель развития (ключ качества из houseQualities)';

-- Для существующих участников: is_profile_completed = false (по умолчанию)
-- Они увидят онбординг при следующем входе в личный кабинет.
-- Для новых участников: is_profile_completed = false (по умолчанию)
-- Онбординг будет обязательным этапом регистрации.