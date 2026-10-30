-- sync_rev.test.sql — серверный номер `rev` (S1-2).
--
-- Запуск (миграции уже применены, из корня репозитория):
--   PGCLIENTENCODING=UTF8 psql -h 127.0.0.1 -p <порт> -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f supabase/tests/sync_rev.test.sql
--
-- В общий поток psql ci.yml не встроен: проверке заполнения нужно заново
-- применить файл миграции (`\ir` ниже). С DY10-5 (30.10) — отдельный шаг
-- «sync_rev guards (0045)» в джобе rls, после применения миграций.
--
-- У теста свой пользователь; за собой убирает. Проверки, которым нужно
-- «между транзакциями», снимаются в отдельные `do $$` (каждый — своя
-- транзакция), а значения переносятся через временные таблицы (R7Q-036).

\set ON_ERROR_STOP on

create temp table if not exists sync_rev_probe (
  k text primary key,
  v bigint not null
);
create temp table if not exists sync_rev_stamps (
  k text primary key,
  t timestamptz not null
);

-- Пустые claims — не JSON; auth.uid() (как в проде) ждёт объект или NULL.
-- Сеансовая база «без пользователя», чтобы после локальных set_config
-- триггеры видели корректное значение.
select set_config('request.jwt.claims', '{}', false);

-- 1. Клиентское значение `rev` не доживает до строки — ни на insert, ни на
--    update. Заодно номер серверный и положительный.
do $$
declare
  uid constant uuid := '00000000-0000-0000-0000-000000000f01';
  r bigint;
begin
  insert into auth.users (id, email)
    values (uid, 'sync-rev@test.local') on conflict (id) do nothing;

  delete from public.documents where uuid like 's1-rev-%';
  delete from public.versions where document_uuid like 's1-rev-%';
  delete from public.drafts where user_id = uid;
  delete from public.local_store_records where key like 's1-rev-%';

  insert into public.documents (uuid, user_id, title, rev)
    values ('s1-rev-doc-1', uid, 't', 9223372036854775806)
    returning rev into r;
  if r is null or r <= 0 or r = 9223372036854775806 then
    raise exception 'INSERT: клиентский rev дожил до строки (rev=%)', r;
  end if;
  insert into sync_rev_probe (k, v) values ('doc_1', r);
end $$;

-- 2. UPDATE с прежним/клиентским `rev` получает номер сервера строго больше
--    прежнего.
do $$
declare
  r0 bigint;
  r1 bigint;
begin
  select rev into r0 from public.documents where uuid = 's1-rev-doc-1';
  update public.documents
     set rev = r0, title = 't2'
   where uuid = 's1-rev-doc-1'
   returning rev into r1;
  if r1 is null or r1 <= r0 then
    raise exception 'UPDATE: rev не вырос (% → %)', r0, r1;
  end if;
  insert into sync_rev_probe (k, v) values ('doc_1_upd', r1);
end $$;

-- 3. Счётчик общий на четыре таблицы; между транзакциями номер строго растёт.
do $$
declare
  uid constant uuid := '00000000-0000-0000-0000-000000000f01';
  rd bigint;
  rv bigint;
  rf bigint;
  rl bigint;
begin
  insert into public.documents (uuid, user_id, title)
    values ('s1-rev-doc-2', uid, 't') returning rev into rd;
  insert into public.versions (document_uuid, user_id, version, content)
    values ('s1-rev-doc-1', uid, 1, 'x') returning rev into rv;
  insert into public.drafts (user_id, content)
    values (uid, 'draft') returning rev into rf;
  insert into public.local_store_records (user_id, store, key, payload)
    values (uid, 'aiDialogues', 's1-rev-lsr', '{}'::jsonb) returning rev into rl;

  if rd = rv or rd = rf or rd = rl or rv = rf or rv = rl or rf = rl then
    raise exception 'номера не уникальны на общем счётчике: %/%/%/%', rd, rv, rf, rl;
  end if;

  insert into sync_rev_probe (k, v) values
    ('doc_2', rd), ('ver_1', rv), ('draft_1', rf), ('lsr_1', rl);
end $$;

do $$
declare
  uid constant uuid := '00000000-0000-0000-0000-000000000f01';
  r3 bigint;
  top bigint;
begin
  insert into public.documents (uuid, user_id, title)
    values ('s1-rev-doc-3', uid, 't') returning rev into r3;
  select max(v) into top from sync_rev_probe;
  if r3 <= top then
    raise exception 'номер следующей транзакции не больше всех прежних: % <= %', r3, top;
  end if;
end $$;

-- 4. Запись ролью authenticated с request.jwt.claims проходит: права на
--    последовательность есть только у security definer-функции. Заодно —
--    форма старого клиента: insert и upsert без `rev`.
do $$
declare
  uid constant uuid := '00000000-0000-0000-0000-000000000f01';
  r1 bigint;
  r2 bigint;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  insert into public.documents (uuid, user_id, title)
    values ('s1-rev-doc-auth', uid, 't') returning rev into r1;
  insert into public.documents (uuid, user_id, title)
    values ('s1-rev-doc-auth', uid, 't2')
    on conflict (uuid) do update set title = excluded.title
    returning rev into r2;

  execute 'reset role';
  perform set_config('request.jwt.claims', '{}', true);

  if r1 is null or r2 is null or r2 <= r1 then
    raise exception 'authenticated: insert/upsert без rev не прошли (%, %)', r1, r2;
  end if;
end $$;

-- 5. Надгробие `documents` (update deleted_at, как documents.ts deleteDocument)
--    получает новый номер.
do $$
declare
  before_rev bigint;
  after_rev bigint;
begin
  select rev into before_rev from public.documents where uuid = 's1-rev-doc-2';
  update public.documents
     set deleted_at = now(), title = '', tags = '[]'::jsonb
   where uuid = 's1-rev-doc-2'
   returning rev into after_rev;
  if after_rev is null or after_rev <= before_rev then
    raise exception 'надгробие не получило новый rev (% → %)', before_rev, after_rev;
  end if;
end $$;

-- 5b. Пустые request.jwt.claims (прямой psql, rls-тесты, служебные скрипты)
--     не роняют запись: statement-триггер считает это «пользователя нет», а
--     номер и порядок обеспечивает строчный триггер по user_id.
do $$
declare
  uid constant uuid := '00000000-0000-0000-0000-000000000f01';
  r bigint;
begin
  perform set_config('request.jwt.claims', '', true);
  insert into public.documents (uuid, user_id, title)
    values ('s1-rev-empty-claims', uid, 't') returning rev into r;
  if r is null then raise exception 'пустые claims уронили запись'; end if;
  perform set_config('request.jwt.claims', '{}', true);
end $$;

-- 6. Заполнение существующих строк и идемпотентность файла миграции.
--    Засеваем строки на БАЗЕ С 0045, снимаем updated_at/stamped_at, снимаем
--    объекты 0045 и применяем файл заново: номера раздаются, метки строк не
--    сдвигаются (иначе каждое устройство увидело бы «облако новее»).
do $$
declare
  uid constant uuid := '00000000-0000-0000-0000-000000000f02';
begin
  insert into auth.users (id, email)
    values (uid, 'sync-rev-pre@test.local') on conflict (id) do nothing;
  insert into public.documents (uuid, user_id, title)
    values ('s1-rev-pre-doc', uid, 'pre');
  insert into public.versions (document_uuid, user_id, version, content)
    values ('s1-rev-pre-doc', uid, 1, 'pre');
  insert into public.drafts (user_id, content)
    values (uid, 'pre');
  insert into public.local_store_records (user_id, store, key, payload)
    values (uid, 'aiDialogues', 's1-rev-pre-lsr', '{}'::jsonb);

  insert into sync_rev_stamps (k, t)
    select 'doc.updated_at', updated_at from public.documents where uuid = 's1-rev-pre-doc';
  insert into sync_rev_stamps (k, t)
    select 'lsr.stamped_at', stamped_at from public.local_store_records where key = 's1-rev-pre-lsr';
end $$;

drop trigger if exists tr_documents_sync_rev on public.documents;
drop trigger if exists tr_documents_sync_rev_stmt on public.documents;
drop trigger if exists tr_versions_sync_rev on public.versions;
drop trigger if exists tr_versions_sync_rev_stmt on public.versions;
drop trigger if exists tr_local_store_records_sync_rev on public.local_store_records;
drop trigger if exists tr_local_store_records_sync_rev_stmt on public.local_store_records;
drop trigger if exists tr_drafts_sync_rev on public.drafts;
drop trigger if exists tr_drafts_sync_rev_stmt on public.drafts;
drop function if exists public.assign_sync_rev();
drop function if exists public.lock_sync_rev_stmt();
drop index if exists public.documents_user_rev_idx;
drop index if exists public.versions_user_rev_idx;
drop index if exists public.local_store_records_user_rev_idx;
drop index if exists public.drafts_user_rev_idx;
alter table public.documents drop column if exists rev;
alter table public.versions drop column if exists rev;
alter table public.local_store_records drop column if exists rev;
alter table public.drafts drop column if exists rev;
drop sequence if exists public.sync_rev_seq;

-- Путь относительно этого файла: запускать через psql -f, не через cat | psql.
\ir ../migrations/0045_sync_rev.sql

do $$
declare
  uid constant uuid := '00000000-0000-0000-0000-000000000f01';
  n bigint;
  prev_updated timestamptz;
  prev_stamped timestamptz;
  new_updated timestamptz;
  new_stamped timestamptz;
  dup bigint;
begin
  select count(*) into n from public.documents where rev is null;
  if n <> 0 then raise exception 'documents: rev is null у % строк', n; end if;
  select count(*) into n from public.versions where rev is null;
  if n <> 0 then raise exception 'versions: rev is null у % строк', n; end if;
  select count(*) into n from public.drafts where rev is null;
  if n <> 0 then raise exception 'drafts: rev is null у % строк', n; end if;
  select count(*) into n from public.local_store_records where rev is null;
  if n <> 0 then raise exception 'local_store_records: rev is null у % строк', n; end if;

  select count(*) into dup from (
    select rev from public.documents
    union all select rev from public.versions
    union all select rev from public.drafts
    union all select rev from public.local_store_records
  ) q group by rev having count(*) > 1 limit 1;
  if dup is not null then raise exception 'номер rev повторяется: %', dup; end if;

  select t into prev_updated from sync_rev_stamps where k = 'doc.updated_at';
  select t into prev_stamped from sync_rev_stamps where k = 'lsr.stamped_at';
  select updated_at into new_updated from public.documents where uuid = 's1-rev-pre-doc';
  select stamped_at into new_stamped from public.local_store_records where key = 's1-rev-pre-lsr';
  if new_updated <> prev_updated then
    raise exception 'заполнение сдвинуло documents.updated_at (% → %)', prev_updated, new_updated;
  end if;
  if new_stamped <> prev_stamped then
    raise exception 'заполнение сдвинуло local_store_records.stamped_at (% → %)', prev_stamped, new_stamped;
  end if;

  -- Default снят, права на последовательность у клиента отобраны.
  select count(*) into n from pg_attrdef d
    join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
   where d.adrelid in ('public.documents'::regclass, 'public.versions'::regclass,
                       'public.drafts'::regclass, 'public.local_store_records'::regclass)
     and a.attname = 'rev';
  if n <> 0 then raise exception 'у rev остался default — старый клиент упрётся в права на последовательность'; end if;
  if has_sequence_privilege('authenticated', 'public.sync_rev_seq', 'USAGE') then
    raise exception 'authenticated получил права на sync_rev_seq';
  end if;
end $$;

-- 7. Уборка за собой (R7Q-036).
do $$
declare
  uid constant uuid := '00000000-0000-0000-0000-000000000f01';
  uid2 constant uuid := '00000000-0000-0000-0000-000000000f02';
begin
  delete from public.documents where uuid like 's1-rev-%';
  delete from public.versions where document_uuid like 's1-rev-%';
  delete from public.drafts where user_id in (uid, uid2);
  delete from public.local_store_records where key like 's1-rev-%';
  delete from auth.users where id in (uid, uid2);
end $$;

select 'sync_rev: все проверки прошли' as итог;
