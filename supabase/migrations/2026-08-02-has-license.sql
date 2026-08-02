-- Колонка has_license в registrations: есть ли у участника водительские права.
-- Критично для событий с арендой гидроциклов/квадроциклов/авто: без неё
-- insert заявки падал (колонки не было), а клиент показывал «Вы записаны».
ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS has_license boolean DEFAULT NULL;