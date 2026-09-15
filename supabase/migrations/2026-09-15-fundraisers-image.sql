-- Фото сбора: обложка объявления (например, макет или образец того, на что собираем).
-- Необязательное поле — старые сборы продолжают работать без правок.
ALTER TABLE fundraisers ADD COLUMN IF NOT EXISTS image_url TEXT NOT NULL DEFAULT '';
ALTER TABLE fundraisers ADD COLUMN IF NOT EXISTS image_caption TEXT NOT NULL DEFAULT '';