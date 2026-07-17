-- ИИ-менеджер групповых чатов: анализ переписки, автозадачи, обучение
-- Бот как проактивный координатор мероприятия

-- Привязка групп к событиям
create table if not exists event_groups (
  id bigserial primary key,
  event_id text not null,
  chat_id bigint not null unique, -- Telegram chat ID группы
  chat_title text,
  added_at timestamptz default now(),
  active boolean default true
);

create index if not exists idx_event_groups_event on event_groups(event_id);
create index if not exists idx_event_groups_chat on event_groups(chat_id);

-- История сообщений группы (скользящее окно, храним последние ~200)
create table if not exists group_messages (
  id bigserial primary key,
  chat_id bigint not null,
  message_id bigint not null,
  telegram_id bigint not null, -- кто написал
  username text,
  first_name text,
  text text,
  replied_to bigint, -- message_id сообщения, на которое ответили
  created_at timestamptz default now(),
  unique(chat_id, message_id)
);

create index if not exists idx_group_messages_chat on group_messages(chat_id, created_at desc);
create index if not exists idx_group_messages_tg on group_messages(telegram_id);

-- Контекстное окно для ИИ: последние N сообщений цепочкой
create or replace function get_chat_context(p_chat_id bigint, p_limit int default 20)
returns table(msg_id bigint, tg_id bigint, username text, txt text, replied bigint, ts timestamptz) as $$
  select message_id, telegram_id, username, text, replied_to, created_at
  from group_messages
  where chat_id = p_chat_id
  order by created_at desc
  limit p_limit;
$$ language sql stable;

-- Действия бота в группе (лог вмешательств)
create table if not exists bot_group_actions (
  id bigserial primary key,
  chat_id bigint not null,
  event_id text not null,
  action_type text not null, -- info_reply|task_created|poll_created|ride_suggested|silent
  trigger_text text, -- что спровоцировало (фраза из переписки)
  response_text text, -- что бот ответил
  data jsonb, -- связанные ID (task_id, poll_id и т.д.)
  created_at timestamptz default now()
);

create index if not exists idx_bot_actions_chat on bot_group_actions(chat_id, created_at desc);
create index if not exists idx_bot_actions_event on bot_group_actions(event_id);

-- Паттерны обучения: что работает, что нет
create table if not exists ai_learning_patterns (
  id bigserial primary key,
  pattern_type text not null, -- task_auto|ride_suggest|info_question|should_silent
  trigger_keywords jsonb, -- ['нет места', 'машина', 'взять'] → предложить попутку
  context_hints jsonb, -- дополнительные условия
  action text not null, -- что делать: create_task|suggest_ride|answer_info|stay_silent
  success_count int default 0, -- сколько раз сработало удачно
  fail_count int default 0, -- сколько раз участники проигнорировали
  last_used timestamptz,
  created_at timestamptz default now()
);

create index if not exists idx_learning_type on ai_learning_patterns(pattern_type);

-- Счётчики эффективности: как бот помогает
create table if not exists bot_effectiveness (
  id bigserial primary key,
  event_id text not null,
  metric text not null, -- tasks_auto_created|questions_answered|rides_organized|messages_sent
  value int default 0,
  updated_at timestamptz default now(),
  unique(event_id, metric)
);

-- Функция для очистки старых сообщений (держим последние 200 на чат)
create or replace function cleanup_old_messages() returns trigger as $$
begin
  delete from group_messages
  where chat_id = NEW.chat_id
    and id not in (
      select id from group_messages
      where chat_id = NEW.chat_id
      order by created_at desc
      limit 200
    );
  return NEW;
end;
$$ language plpgsql;

create trigger trg_cleanup_messages after insert on group_messages
for each row execute function cleanup_old_messages();

