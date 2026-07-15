-- Пол участника: нужен для статистики события (сколько М/Ж едет) и для
-- расселения по палаткам (gender_rule). Собираем в конце заявки в клуб.
-- Значения: 'male' | 'female' | NULL (не указан — легаси-участники).
-- ЗАПУСТИТЬ В: Supabase Dashboard → SQL Editor (DDL из кода недоступен).

alter table members add column if not exists gender text;
