-- 0037_local_store_server_stamp.sql
--
-- Серверная метка (решение владельца от 04.10.2026, см. justwriting-docs:
-- server-stamp-design-2026-10-04.md). Отметку версии облачной строки ставит сервер, а
-- не устройство: сегодня спор скалярных полей диалога решается по `payload.updatedAt`,
-- который придумывает клиент, и часы, убежавшие вперёд, замораживают чужие правки на
-- величину расхождения (тикет ag-clock-skew-scalar-hostage-ticket.md, теперешнее
-- поведение зафиксировано тестом dialogueMergeFutureStamp.m6).

alter table public.local_store_records
  add column if not exists stamped_at timestamptz not null default now();

-- Формула: на ЛЮБОМ insert/update колонка перезаписывается серверным now(). Клиент не
-- может её ни задать, ни сохранить прежней — триггер идёт после любых присваиваний.
-- `security definer` не нужен: триггер не читает другие таблицы и не должен получать
-- чужих прав.
--
-- Второй, более важный для слияния эффект: у БАЗОВОЙ строки диалога перезаписывается и
-- `payload.updatedAt` — именно с ним сравнивают копии `mergeDialogues` и именно его
-- проверяет CAS (`payload->>updatedAt`). Дочерние строки не трогаются: страницы и окна
-- идентифицируются по отметке версии (`key#<stamp>#N`, `key@seg<firstAt>…`), и перепись
-- их `updatedAt` рассогласовала бы уборку прежних версий.
create or replace function public.stamp_local_store_record()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.stamped_at := now();
  if new.store = 'aiDialogues'
     and new.key not like '%#%'
     and new.key not like '%@%'
     and jsonb_typeof(new.payload -> 'updatedAt') = 'number' then
    new.payload := jsonb_set(
      new.payload, '{updatedAt}',
      to_jsonb(floor(extract(epoch from now()) * 1000)::bigint));
  end if;
  return new;
end $$;

drop trigger if exists local_store_records_stamp on public.local_store_records;
create trigger local_store_records_stamp
before insert or update on public.local_store_records
for each row execute function public.stamp_local_store_record();

-- CAS-фильтры сравнивают метку точным равенством, а строку берут по primary key,
-- отдельный индекс не нужен.
