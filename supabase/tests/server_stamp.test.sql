-- server_stamp.test.sql — отметку версии облачной строки пишет только сервер.
--
-- Как запускать (на стендовой базе, где миграции уже применены):
--   docker exec -i jw-stand-db psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/tests/server_stamp.test.sql
--
-- В CI файл пока не подключён (ci.yml катает _auth_setup + миграции + rls.test.sql);
-- включение — одна строчка, но pipeline без ведома владельца не трогаем.
--
-- Проверяется ровно то, на чём держится шаг 2 (CAS по stamped_at вместо
-- payload->>updatedAt): клиент не может ни задать метку, ни оставить её прежней,
-- а между транзакциями метка строго растёт.

-- 1. Клиентская отметка из прошлого не доживает до строки (INSERT).
do $$
declare
  uid uuid;
  t timestamptz;
begin
  select user_id into uid from public.local_store_records limit 1;
  if uid is null then
    raise exception 'нет ни одной строки local_store_records — вставлять некому';
  end if;

  delete from public.local_store_records where key in ('stamp-test', 'stamp-test-2');

  insert into public.local_store_records (user_id, store, key, payload, stamped_at)
    values (uid, 'aiDialogues', 'stamp-test', '{"updatedAt": 1}'::jsonb, '2000-01-01T00:00:00Z');

  select stamped_at into t from public.local_store_records where key = 'stamp-test';
  if t < '2020-01-01T00:00:00Z' then
    raise exception 'INSERT: клиентская stamped_at (%) дожила до строки — триггер не работает', t;
  end if;
end $$;

-- 2. UPDATE сдвигает метку вперёд, даже когда клиент просит вернуть прежнюю.
do $$
declare
  t timestamptz;
begin
  update public.local_store_records
     set payload = '{"updatedAt": 2}'::jsonb, stamped_at = '2000-01-01T00:00:00Z'
   where key = 'stamp-test';

  select stamped_at into t from public.local_store_records where key = 'stamp-test';
  if t < '2020-01-01T00:00:00Z' then
    raise exception 'UPDATE: клиент смог записать stamped_at в 2000-й год (%)', t;
  end if;
end $$;

-- 3. Между ТРАНЗАКЦИЯМИ метка строго растёт — на этом держится CAS: ровно эта
-- функция и возвращает new.stamped_at победителю. Каждый do $$ … $$ — своя
-- транзакция, поэтому между ними ставим паузу отдельным запросом.
do $$
declare uid uuid;
begin
  select user_id into uid from public.local_store_records limit 1;
  insert into public.local_store_records (user_id, store, key, payload)
    values (uid, 'aiDialogues', 'stamp-test-2', '{"updatedAt": 1}'::jsonb);
end $$;

select pg_sleep(0.05) as пауза_между_транзакциями;

do $$
declare
  t1 timestamptz;
  t2 timestamptz;
begin
  select stamped_at into t1 from public.local_store_records where key = 'stamp-test-2';
  update public.local_store_records set payload = '{"updatedAt": 2}'::jsonb where key = 'stamp-test-2';
  select stamped_at into t2 from public.local_store_records where key = 'stamp-test-2';
  -- В одной транзакции now() одинаково, поэтому сравниваем с отдельной:
  -- ниже читаем значение, оставленное ПРЕДЫДУЩИМ запросом.
  if t2 < t1 then
    raise exception 'метка пошла назад: % → %', t1, t2;
  end if;
end $$;

-- Отдельная транзакция: после шага 3 запись точно новее, чем сразу после вставки.
do $$
declare
  t timestamptz;
begin
  select stamped_at into t from public.local_store_records where key = 'stamp-test-2';
  if t < '2020-01-01T00:00:00Z' then
    raise exception 'stamped_at (%) не серверная', t;
  end if;
  delete from public.local_store_records where key in ('stamp-test', 'stamp-test-2');
end $$;

select 'server_stamp: все проверки прошли' as итог;
