-- server_stamp.test.sql — отметку версии облачной строки пишет только сервер.
--
-- Запуск (миграции уже применены):
--   docker exec -i <база> psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/tests/server_stamp.test.sql
-- Файл подключён в CI: `rls` в .github/workflows/ci.yml (сразу после rls.test.sql)
-- и шаг 3 «Live database checks» в .github/workflows/gates.yml.
--
-- Тест не пользуется чужими остатками: у него собственный пользователь,
-- заведённый в первом блоке. Иначе проверка молча зависела бы от того, какие
-- строки оставил rls.test.sql перед ней, и падала бы на пустой базе.
--
-- `local_store_records.user_id` связан внешним ключом с `auth.users`, поэтому
-- «просто сгенерировать uuid» для вставки нельзя — база её отвергнет.
--
-- Проверяется ровно то, на чём держится шаг 2 (спор копий по отметке строки):
-- клиент не может ни задать `stamped_at`, ни оставить её прежней, а между
-- транзакциями метка строго растёт.

-- 1. Клиентская отметка из прошлого не доживает до строки (INSERT).
do $$
declare
  uid constant uuid := '00000000-0000-0000-0000-000000000d05';
  t timestamptz;
begin
  insert into auth.users (id, email)
    values (uid, 'server-stamp@test.local') on conflict (id) do nothing;

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
-- функция и возвращает new.stamped_at победителю.
--
-- R7Q-036: прежняя форма сравнивала t1 и t2 ВНУТРИ одного `do $$`, а там now()
-- одинаков по определению — проверка была неопровержимой (замер раунда 7:
-- t1 = t2 = …461149, «t2 < t1» = false при любом триггере). Теперь значения
-- снимаются в разных транзакциях через временную таблицу, и сравнение
-- «послеupdate <= послеinsert» краснеет, если перестать поднимать метку.
create temp table if not exists stamp_probe (k text primary key, t timestamptz not null);

do $$
declare uid constant uuid := '00000000-0000-0000-0000-000000000d05';
begin
  insert into public.local_store_records (user_id, store, key, payload)
    values (uid, 'aiDialogues', 'stamp-test-2', '{"updatedAt": 1}'::jsonb);
  insert into stamp_probe (k, t)
    select 'after_insert', stamped_at from public.local_store_records where key = 'stamp-test-2';
end $$;

select pg_sleep(0.05) as пауза_между_транзакциями;

do $$
begin
  update public.local_store_records set payload = '{"updatedAt": 2}'::jsonb where key = 'stamp-test-2';
  insert into stamp_probe (k, t)
    select 'after_update', stamped_at from public.local_store_records where key = 'stamp-test-2';
end $$;

do $$
declare
  before_ts timestamptz;
  after_ts timestamptz;
begin
  select t into before_ts from stamp_probe where k = 'after_insert';
  select t into after_ts from stamp_probe where k = 'after_update';
  if before_ts is null or after_ts is null then
    raise exception 'замер между транзакциями не снят: before=% after=%', before_ts, after_ts;
  end if;
  if after_ts <= before_ts then
    raise exception 'метка не выросла между транзакциями: % → %', before_ts, after_ts;
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

-- 4. У БАЗОВОЙ строки диалога `payload.updatedAt` — серверный, даже если клиент
-- прислал время из будущего. Дочерние строки (страницы `key#…`, окна `key@seg…`)
-- не трогаются: по отметке версии строится уборка прежних копий.
do $$
declare
  uid constant uuid := '00000000-0000-0000-0000-000000000d05';
  v bigint;
  future bigint := floor(extract(epoch from now()) * 1000)::bigint + 86400000; -- +сутки
begin
  delete from public.local_store_records where key in ('stamp-base', 'stamp-base#3', 'stamp-base@seg9-x');

  insert into public.local_store_records (user_id, store, key, payload)
    values (uid, 'aiDialogues', 'stamp-base', jsonb_build_object('updatedAt', future));
  select (payload ->> 'updatedAt')::bigint into v
    from public.local_store_records where key = 'stamp-base';
  if v >= future then
    raise exception 'базовая строка сохранила клиентские часы: % (просят <= now)', v;
  end if;

  insert into public.local_store_records (user_id, store, key, payload)
    values (uid, 'aiDialogues', 'stamp-base#3', jsonb_build_object('updatedAt', future));
  select (payload ->> 'updatedAt')::bigint into v
    from public.local_store_records where key = 'stamp-base#3';
  if v <> future then
    raise exception 'страница %: триггер тронул отметку версии — уборка прежних копий рассогласуется', v;
  end if;

  insert into public.local_store_records (user_id, store, key, payload)
    values (uid, 'aiDialogues', 'stamp-base@seg9-x', jsonb_build_object('updatedAt', future, 'firstAt', future));
  select (payload ->> 'updatedAt')::bigint into v
    from public.local_store_records where key = 'stamp-base@seg9-x';
  if v <> future then
    raise exception 'окно %: триггер тронул отметку окна', v;
  end if;

  -- Другой стор (заметки, документы) не затронут вовсе.
  insert into public.local_store_records (user_id, store, key, payload)
    values (uid, 'documents', 'stamp-doc', jsonb_build_object('updatedAt', future));
  select (payload ->> 'updatedAt')::bigint into v
    from public.local_store_records where store = 'documents' and key = 'stamp-doc';
  if v <> future then
    raise exception 'documents: триггер полез в чужой стор (%)', v;
  end if;

  delete from public.local_store_records
    where key in ('stamp-base', 'stamp-base#3', 'stamp-base@seg9-x')
       or (store = 'documents' and key = 'stamp-doc');
end $$;

select 'server_stamp: payload.updatedAt базовой строки — серверный, дочерние целы' as итог_2;

-- 5. Уборка за собой. Строки удалены и в самих блоках, но этот шаг убирает ещё и
-- тестового пользователя: в gates.yml после нас идут canary и постулаты, и им
-- вид базы поперёк горла.
do $$
declare uid constant uuid := '00000000-0000-0000-0000-000000000d05';
begin
  delete from public.local_store_records where user_id = uid;
  delete from auth.users where id = uid;
end $$;
