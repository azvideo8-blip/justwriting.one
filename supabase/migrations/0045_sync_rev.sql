-- 0045_sync_rev.sql — серверный номер ревизии строки (SYNC1, S1-1).
--
-- Зачем. Устройство забирает заметки «всё после номера N» вместо полных
-- проходов (plan-sync-v2 §2 п.1 и п.6, §4 этап 1). Номер строке ставит сервер:
-- триггер перезаписывает `rev` на любом insert/update, клиентское значение не
-- доживает до строки. Колонка открытая и лежит рядом с шифром; шифрование,
-- RLS, политики и гранты не меняются.
--
-- Разовое заполнение — сам `add column ... default nextval(...)`: volatile
-- default переписывает таблицу и раздаёт номера существующим строкам без
-- строчных триггеров. Заполнять через `update ... set rev = ...` нельзя: он
-- разбудил бы `tr_documents_updated_at` (0033), `local_store_records_stamp`
-- (0037) и `tr_drafts_updated_at` (0043), сдвинул бы `updated_at`/`stamped_at`
-- всех строк, и каждое устройство увидело бы «облако новее» по всем заметкам.
--
-- Замок на пользователя (S1-1 п.5). Номер выдаётся при записи, а виден читателю
-- при коммите. Без сериализации: A взял 5, B взял 6, B закоммитил, устройство
-- забрало 6 и запомнило курсор 6, A коммитит 5 — строка 5 не будет забрана
-- никогда. `pg_advisory_xact_lock` по user_id держится до конца транзакции:
-- для одного аккаунта порядок коммитов = порядок `rev`, видимое множество —
-- всегда префикс.
--
-- Порядок «замок до блокировок строк». Строчный BEFORE-триггер вызывается уже
-- после блокировки строки, поэтому два многострочных обновления одного
-- аккаунта в разном порядке строк могли зациклиться (40P01). BEFORE STATEMENT
-- триггер берёт тот же замок до строк; если `auth.uid()` пуст (сервисная
-- роль, прямой psql), замок возьмёт строчный триггер по `new.user_id`.
--
-- Блокировка таблицы. `migrate.sh` гонит файл одной транзакцией
-- (--single-transaction), поэтому `concurrently` и промежуточный `commit`
-- невозможны. `lock_timeout` заставляет миграцию упасть целиком, а не встать
-- в очередь блокировок перед всеми запросами.
--
-- Класс отката: T — обратный DDL, данные не переписаны (drop триггеров,
-- функций, индексов, колонки, последовательности). Ранбук — отчёт SYNC1,
-- раздел S1-9 (`report-2026-10-21-SYNC1.md`).
--
-- ponytail: перезапись таблицы при добавлении колонки — миллисекунды на ~1,5
-- тыс. строк. Потолок подхода — порядка 1 млн строк (время ACCESS EXCLUSIVE
-- растёт линейно). Для больших таблиц путь апгрейда: добавить колонку nullable
-- без default, заполнять пачками процедурой с `pg_advisory_xact_lock` на
-- пользователя, затем `set not null`; default снять — номер ставит триггер.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 1. Одна последовательность на все четыре таблицы. Клиентские роли не должны
--    уметь двигать счётчик: номер назначает `security definer`-функция.
create sequence if not exists public.sync_rev_seq;
revoke all on sequence public.sync_rev_seq from public, anon, authenticated;

-- 2. Колонка и разовое заполнение (volatile default переписывает таблицу).
alter table public.documents
  add column if not exists rev bigint not null default nextval('public.sync_rev_seq');
alter table public.versions
  add column if not exists rev bigint not null default nextval('public.sync_rev_seq');
alter table public.local_store_records
  add column if not exists rev bigint not null default nextval('public.sync_rev_seq');
alter table public.drafts
  add column if not exists rev bigint not null default nextval('public.sync_rev_seq');

-- Default нужен был только для разового заполнения. Оставлять его нельзя: default
-- вычисляется от имени вставляющей роли, а клиентских прав на последовательность
-- нет — старый клиент без `rev` получал бы `permission denied for sequence`.
-- Дальше номер ставит только триггер (security definer), на insert и на update.
alter table public.documents alter column rev drop default;
alter table public.versions alter column rev drop default;
alter table public.local_store_records alter column rev drop default;
alter table public.drafts alter column rev drop default;

-- 3. Строчный триггер: замок по владельцу строки и серверный номер.
--    `security definer` — у клиентской роли нет прав на последовательность;
--    `set search_path = ''` — тело не зависит от чужого search_path.
create or replace function public.assign_sync_rev()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(
    hashtextextended('jw_sync_rev:' || new.user_id::text, 0));
  new.rev := nextval('public.sync_rev_seq');
  return new;
end $$;

-- 4. Statement-триггер: тот же замок до блокировок строк, чтобы два
--    многострочных обновления одного аккаунта не зацикливались на 40P01.
--    Возврат null у statement-триггера ни на что не влияет.
create or replace function public.lock_sync_rev_stmt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid;
begin
  -- auth.uid() разбирает request.jwt.claims::jsonb. Прямой psql (миграции,
  -- rls-тесты, служебные скрипты) может оставить claims пустой строкой — это
  -- не JSON, и без стража КАЖДАЯ запись падала бы на statement-триггере.
  -- Пустые/битые claims = «пользователя нет»: порядок обеспечит строчный
  -- триггер по new.user_id, правильность номеров не страдает.
  begin
    uid := auth.uid();
  exception when others then
    uid := null;
  end;
  if uid is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('jw_sync_rev:' || uid::text, 0));
  end if;
  return null;
end $$;

drop trigger if exists tr_documents_sync_rev on public.documents;
create trigger tr_documents_sync_rev
  before insert or update on public.documents
  for each row execute function public.assign_sync_rev();
drop trigger if exists tr_documents_sync_rev_stmt on public.documents;
create trigger tr_documents_sync_rev_stmt
  before insert or update on public.documents
  for each statement execute function public.lock_sync_rev_stmt();

drop trigger if exists tr_versions_sync_rev on public.versions;
create trigger tr_versions_sync_rev
  before insert or update on public.versions
  for each row execute function public.assign_sync_rev();
drop trigger if exists tr_versions_sync_rev_stmt on public.versions;
create trigger tr_versions_sync_rev_stmt
  before insert or update on public.versions
  for each statement execute function public.lock_sync_rev_stmt();

drop trigger if exists tr_local_store_records_sync_rev on public.local_store_records;
create trigger tr_local_store_records_sync_rev
  before insert or update on public.local_store_records
  for each row execute function public.assign_sync_rev();
drop trigger if exists tr_local_store_records_sync_rev_stmt on public.local_store_records;
create trigger tr_local_store_records_sync_rev_stmt
  before insert or update on public.local_store_records
  for each statement execute function public.lock_sync_rev_stmt();

drop trigger if exists tr_drafts_sync_rev on public.drafts;
create trigger tr_drafts_sync_rev
  before insert or update on public.drafts
  for each row execute function public.assign_sync_rev();
drop trigger if exists tr_drafts_sync_rev_stmt on public.drafts;
create trigger tr_drafts_sync_rev_stmt
  before insert or update on public.drafts
  for each statement execute function public.lock_sync_rev_stmt();

-- 5. Индексы под keyset-забор `(user_id, rev)`. Без `concurrently`: см. шапку.
create index if not exists documents_user_rev_idx
  on public.documents (user_id, rev);
create index if not exists versions_user_rev_idx
  on public.versions (user_id, rev);
create index if not exists local_store_records_user_rev_idx
  on public.local_store_records (user_id, rev);
create index if not exists drafts_user_rev_idx
  on public.drafts (user_id, rev);
