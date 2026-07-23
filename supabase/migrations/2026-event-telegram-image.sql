-- Отдельная вертикальная афиша события для шеринга в Telegram (og:image при
-- пересылке другу). Основная image остаётся для сайта/карточки; telegram_image —
-- специально под превью-афишу. Пока колонки нет, сохранение события проходит без
-- неё (устойчиво в api/admin/events.ts), но афиша не сохраняется — накатить это.

alter table events add column if not exists telegram_image text;
