-- Прозрачность сборов: обоснование суммы, кто организатор, отчёт после сбора.
-- Поля необязательные, поэтому старые сборы продолжают работать без правок.
ALTER TABLE fundraisers ADD COLUMN IF NOT EXISTS organizer_name TEXT NOT NULL DEFAULT '';
ALTER TABLE fundraisers ADD COLUMN IF NOT EXISTS cost_breakdown TEXT NOT NULL DEFAULT '';
ALTER TABLE fundraisers ADD COLUMN IF NOT EXISTS legal_note TEXT NOT NULL DEFAULT '';
ALTER TABLE fundraisers ADD COLUMN IF NOT EXISTS report_note TEXT NOT NULL DEFAULT '';
ALTER TABLE fundraisers ADD COLUMN IF NOT EXISTS report_url TEXT NOT NULL DEFAULT '';

-- Статус «review» в CHECK уже есть; отдельно фиксируем, что сбор может быть
-- отменён организатором до старта — участники видят это состояние как closed.
CREATE INDEX IF NOT EXISTS fundraisers_status_deadline_idx ON fundraisers(status, deadline);