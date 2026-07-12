-- Динамические очереди ожидания на конкретную машину/палатку (PLAN §5)
-- Date: 2026-07-12
-- ride_requests уже есть (общий «нужна попутка», ride_id = null).
-- Добавляем ride_id: когда машина/палатка заполнена, участник встаёт в очередь
-- именно на неё. Освободилось место (unbook) → бот зовёт первого в очереди.
alter table ride_requests add column if not exists ride_id bigint;
create index if not exists idx_ride_requests_ride on ride_requests(ride_id) where ride_id is not null;
