-- ПРИГЛАШЕНИЯ НА СОБЫТИЕ: кому ушло, дошло ли, открыл ли, что ответил.
--
-- Зачем: организатор рассылал приглашения вслепую — не было видно, до кого
-- дошло, кто ответил «буду», кто «подумаю» и кого надо дожать. Теперь у
-- каждого приглашения есть строка, а у события — воронка:
--   отправлено → доставлено → открыл (нажал любую кнопку) → ответил.
--
-- «Прочитал» Telegram ботам не сообщает. Поэтому честный сигнал — нажатие
-- кнопки («👀 Подробнее» или ответ). Доставку подтверждает сам Telegram.
--
-- Применить: Supabase → SQL Editor → New query → вставить файл → Run.

create table if not exists event_invites (
  id            bigserial primary key,
  event_id      text   not null,
  telegram_id   bigint not null,
  invited_by    text,                      -- кто разослал (админка/организатор)
  sent_at       timestamptz not null default now(),
  delivered     boolean not null default false,
  error         text,                      -- почему не дошло (бот заблокирован и т.п.)
  message_id    bigint,                    -- чтобы обновить кнопки под приглашением
  opened_at     timestamptz,               -- первое нажатие любой кнопки
  answer        text check (answer in ('yes', 'maybe', 'no')),
  answered_at   timestamptz,
  reminded_at   timestamptz,               -- последнее напоминание из воронки
  remind_count  int not null default 0,
  unique (event_id, telegram_id)
);

create index if not exists event_invites_event_idx on event_invites (event_id);
create index if not exists event_invites_funnel_idx on event_invites (answer, answered_at);

-- Доступ только серверу (service_role): в таблице видно, кто кого звал.
alter table event_invites enable row level security;
