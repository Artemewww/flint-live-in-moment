-- Палатки как бронируемые места — обобщаем систему поездок (rides/ride_bookings)
-- Date: 2026-07-12
-- Идея: не плодим отдельные таблицы, а вводим дискриминатор kind.
--   Палатка          = строка в rides с kind='tent'
--                      (seats_total = спальных мест, seats_taken = занято, from_point = чья/где).
--   Бронь места в ней = строка в ride_bookings с kind='tent'.
--   Механика броней (RPC book_ride/unbook_ride, счётчик seats_taken, active) переиспользуется
--   БЕЗ ИЗМЕНЕНИЙ — значит для машин ничего не ломается.
--
-- Доп. поля под «до мелочей»:
--   gender_rule — для палаток: 'any' | 'male' | 'female' (кого можно подселять).
--   Очереди ожидания используют существующую ride_requests (kind тоже добавим).

alter table rides         add column if not exists kind text default 'car';   -- car | tent
alter table ride_bookings add column if not exists kind text default 'car';
alter table ride_requests add column if not exists kind text default 'car';   -- очередь: и на машину, и на место в палатке
alter table rides         add column if not exists gender_rule text default 'any'; -- палатки: any|male|female

create index if not exists idx_rides_kind on rides(event_id, kind, active);
