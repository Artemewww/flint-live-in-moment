-- Закупка продуктов события: сохранённый список + согласование участниками +
-- (позже) закупщик, смета, чек, сплит, реквизиты. Всё в одном jsonb на событии,
-- чтобы не плодить таблицы (free-tier). Структура:
--   { items:[{item,qty,note}], status:'draft'|'sent'|'approved',
--     approved_by:[telegram_id...], estimate:number,
--     buyer_id, buyer_name, payment_info, receipt, splits, sent_at }
-- ЗАПУСТИТЬ В: Supabase Dashboard → SQL Editor (DDL из кода недоступен).

alter table events add column if not exists shopping jsonb;
