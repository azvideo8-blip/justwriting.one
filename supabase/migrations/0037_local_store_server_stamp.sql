-- 0037_local_store_server_stamp.sql
--
-- Шаг 1 серверной метки (см. justwriting-docs: server-stamp-design-2026-10-04.md).
-- Отметку версии облачной строки ставит сервер, а не устройство: сегодня спор
-- скалярных полей диалога решается по `payload.updatedAt`, который придумывает
-- клиент, и часы, убежавшие вперёд, замораживают чужие правки на величину расхождения
-- (тикет ag-clock-skew-scalar-hostage-ticket.md, поведение зафиксировано тестом
-- dialogueMergeFutureStamp.m6).
--
-- Формула: на ЛЮБОМ insert/update колонка перезаписывается серверным now().
-- Клиент не может её ни задать, ни сохранить прежней — триггер идёт после любых
-- присваиваний. `security definer` не нужен: триггер не читает другие таблицы и
-- не должен получать чужих прав.

alter table public.local_store_records
  add column if not exists stamped_at timestamptz not null default now();

create or replace function public.stamp_local_store_record()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.stamped_at := now();
  return new;
end $$;

drop trigger if exists local_store_records_stamp on public.local_store_records;
create trigger local_store_records_stamp
before insert or update on public.local_store_records
for each row execute function public.stamp_local_store_record();

-- CAS-фильтры будут сравнивать эту колонку точным равенством (строка выбирается по
-- primary key), отдельный индекс не нужен.
