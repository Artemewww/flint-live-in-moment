-- Переписка поддержки: двусторонняя лента «костяк ↔ участник».
-- Раньше сообщение юзера просто пересылалось в админ-группу и терялось;
-- теперь каждое входящее/исходящее пишется сюда, а админка показывает
-- чат-ленту по каждому человеку и умеет отвечать прямо из панели.

create table if not exists support_messages (
  id          uuid primary key default gen_random_uuid(),
  telegram_id bigint      not null,           -- собеседник (участник), НЕ автор
  direction   text        not null check (direction in ('in','out')), -- in=от юзера, out=ответ костяка
  text        text        not null,
  from_name   text,                            -- имя автора для отображения
  created_at  timestamptz not null default now()
);

-- Быстрая выборка ленты одного человека и группировка по последнему сообщению.
create index if not exists idx_support_messages_tid_time
  on support_messages (telegram_id, created_at desc);
