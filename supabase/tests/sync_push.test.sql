-- sync_push.test.sql — запись с проверкой базы (SYNC2, S2-2, миграция 0047).
--
-- Запуск (миграции уже применены):
--   docker exec -i <база> psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/tests/sync_push.test.sql
-- Подключён в CI: job `rls` (ci.yml), шаг общего потока.
--
-- Проверяется:
--   1. put: вставка без базы; вторая вставка без базы → conflict с текущей строкой;
--      верная база → ok и rev вырос; устаревшая → conflict с текущей строкой.
--   2. delete → надгробие: клиенту не видно; put поверх → conflict deleted;
--      recreate с чужой базой → conflict, с базой надгробия → ok; delete повторно → ok.
--   3. Старый клиент: слепой upsert поверх надгробия — отказ RLS.
--   4. delta: ok → +1; повтор с тем же op_id → duplicate, без прибавки;
--      заметки нет → missing, ключ не потрачен; надгробие заметки → gone.
--   5. Чужие строки: элемент с user_id/ключом другого пользователя не трогает его
--      строк; anon функцию не исполняет; больше 100 элементов — отказ.
--   6. Предел размера (0032) — отказ элемента, остальные элементы пачки ложатся.
-- Свои пользователи — в первом блоке, уборка — в последнем.

\set ON_ERROR_STOP on

select set_config('request.jwt.claims', '{}', false);

do $$
declare
  ua constant uuid := '00000000-0000-0000-0000-000000000f51';
  ub constant uuid := '00000000-0000-0000-0000-000000000f52';
begin
  delete from public.local_store_records where user_id in (ua, ub);
  delete from public.documents where user_id in (ua, ub);
  delete from public.sync_op_keys where user_id in (ua, ub);
  delete from public.users where uid in (ua, ub);
  insert into public.users (uid, email, nickname, role) values
    (ua, 'sp-a@test.local', 'SP A', 'user'),
    (ub, 'sp-b@test.local', 'SP B', 'user');
  insert into public.documents (uuid, user_id, title) values
    ('s2-doc-a', ua, 't'), ('s2-doc-gone', ua, 't');
  update public.documents set deleted_at = now() where uuid = 's2-doc-gone';
end $$;

-- Один элемент — один ответ.
create or replace function pg_temp.sp1(item jsonb) returns jsonb
language sql as $$ select (public.sync_push(jsonb_build_array(item)))->0 $$;

create temp table sp_probe (k text primary key, v bigint);
grant all on sp_probe to authenticated;

-- 1–2, 4: пользователь A.
SET request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000f51"}';
SET role = 'authenticated';

DO $$
declare
  r jsonb;
  r1 bigint;
  r2 bigint;
begin
  -- 1. Вставка без базы.
  r := pg_temp.sp1('{"table":"local_store_records","op":"put","store":"aiPortrait","key":"singleton","base_rev":null,"payload":{"v":1}}');
  if r->>'status' <> 'ok' or (r->>'rev') is null then
    raise exception 'FAIL 1a: вставка без базы = %', r;
  end if;
  r1 := (r->>'rev')::bigint;

  r := pg_temp.sp1('{"table":"local_store_records","op":"put","store":"aiPortrait","key":"singleton","base_rev":null,"payload":{"v":99}}');
  if r->>'status' <> 'conflict' or (r#>>'{row,rev}')::bigint <> r1 or (r#>>'{row,payload,v}') <> '1' then
    raise exception 'FAIL 1b: вторая вставка без базы = %', r;
  end if;

  r := pg_temp.sp1(jsonb_build_object('table','local_store_records','op','put','store','aiPortrait','key','singleton','base_rev',r1,'payload','{"v":2}'::jsonb));
  if r->>'status' <> 'ok' or (r->>'rev')::bigint <= r1 then
    raise exception 'FAIL 1c: верная база = %', r;
  end if;
  r2 := (r->>'rev')::bigint;

  r := pg_temp.sp1(jsonb_build_object('table','local_store_records','op','put','store','aiPortrait','key','singleton','base_rev',r1,'payload','{"v":3}'::jsonb));
  if r->>'status' <> 'conflict' or (r#>>'{row,rev}')::bigint <> r2 or (r#>>'{row,payload,v}') <> '2' then
    raise exception 'FAIL 1d: устаревшая база = %', r;
  end if;
  if (select payload->>'v' from public.local_store_records where store = 'aiPortrait' and key = 'singleton') <> '2' then
    raise exception 'FAIL 1e: устаревшая база перезаписала строку';
  end if;

  -- 2. Надгробие.
  r := pg_temp.sp1(jsonb_build_object('table','local_store_records','op','delete','store','aiPortrait','key','singleton','base_rev',r1));
  if r->>'status' <> 'conflict' then
    raise exception 'FAIL 2a: удаление с устаревшей базой = %', r;
  end if;
  r := pg_temp.sp1(jsonb_build_object('table','local_store_records','op','delete','store','aiPortrait','key','singleton','base_rev',r2));
  if r->>'status' <> 'ok' then
    raise exception 'FAIL 2b: удаление = %', r;
  end if;
  insert into sp_probe values ('tomb', (r->>'rev')::bigint);
  if exists (select 1 from public.local_store_records where store = 'aiPortrait' and key = 'singleton') then
    raise exception 'FAIL 2c: надгробие видно клиенту';
  end if;

  r := pg_temp.sp1(jsonb_build_object('table','local_store_records','op','put','store','aiPortrait','key','singleton','base_rev',(select v from sp_probe where k='tomb'),'payload','{"v":4}'::jsonb));
  if r->>'status' <> 'conflict' or (r#>>'{row,deleted}') <> 'true' then
    raise exception 'FAIL 2d: put поверх надгробия = %', r;
  end if;
  r := pg_temp.sp1(jsonb_build_object('table','local_store_records','op','put','store','aiPortrait','key','singleton','base_rev',null,'payload','{"v":4}'::jsonb));
  if r->>'status' <> 'conflict' or (r#>>'{row,deleted}') <> 'true' then
    raise exception 'FAIL 2e: вставка без базы поверх надгробия = %', r;
  end if;

  r := pg_temp.sp1(jsonb_build_object('table','local_store_records','op','delete','store','aiPortrait','key','singleton','base_rev',r2));
  if r->>'status' <> 'ok' then
    raise exception 'FAIL 2f: повторное удаление не идемпотентно = %', r;
  end if;

  r := pg_temp.sp1(jsonb_build_object('table','local_store_records','op','recreate','store','aiPortrait','key','singleton','base_rev',r2,'payload','{"v":5}'::jsonb));
  if r->>'status' <> 'conflict' then
    raise exception 'FAIL 2g: recreate с чужой базой = %', r;
  end if;
  r := pg_temp.sp1(jsonb_build_object('table','local_store_records','op','recreate','store','aiPortrait','key','singleton','base_rev',(select v from sp_probe where k='tomb'),'payload','{"v":6}'::jsonb));
  if r->>'status' <> 'ok' then
    raise exception 'FAIL 2h: recreate с базой надгробия = %', r;
  end if;
  if (select payload->>'v' from public.local_store_records where store = 'aiPortrait' and key = 'singleton') is distinct from '6' then
    raise exception 'FAIL 2i: пересозданная строка не видна';
  end if;
  insert into sp_probe values ('a_portrait', (r->>'rev')::bigint);

  -- Голова диалога: ответ несёт метку и серверный updatedAt (0037).
  r := pg_temp.sp1('{"table":"local_store_records","op":"put","store":"aiDialogues","key":"d1","base_rev":null,"payload":{"updatedAt":1}}');
  if r->>'status' <> 'ok' or (r->>'stamped_at') is null or (r->>'payload_updated_at')::bigint <= 1 then
    raise exception 'FAIL 2j: ответ без серверной метки = %', r;
  end if;
end $$;

-- 3. Старый клиент: слепой upsert поверх надгробия.
DO $$
declare
  r jsonb;
  refused boolean := false;
begin
  r := pg_temp.sp1('{"table":"local_store_records","op":"put","store":"aiFacets","key":"f1","base_rev":null,"payload":{"v":1}}');
  r := pg_temp.sp1(jsonb_build_object('table','local_store_records','op','delete','store','aiFacets','key','f1','base_rev',(r->>'rev')::bigint));
  if r->>'status' <> 'ok' then raise exception 'FAIL 3a: %', r; end if;
  begin
    insert into public.local_store_records (user_id, store, key, payload)
    values ('00000000-0000-0000-0000-000000000f51', 'aiFacets', 'f1', '{"v":"old"}')
    on conflict (user_id, store, key) do update set payload = excluded.payload;
  exception when insufficient_privilege then
    refused := true;
  end;
  if not refused then
    raise exception 'FAIL 3b: слепой upsert старого клиента лёг поверх надгробия';
  end if;

  -- S2-5: клиент убирает окна диалога тем же delete по key — надгробие он не видит и не снимает.
  delete from public.local_store_records where store = 'aiFacets' and key = 'f1';
  r := pg_temp.sp1('{"table":"local_store_records","op":"delete","store":"aiFacets","key":"f1","base_rev":null}');
  if (r->>'rev') is null then
    raise exception 'FAIL 3c: клиентский delete снял надгробие = %', r;
  end if;
  -- S2-5: вставка старым путём поверх надгробия — 23505 при пустом чтении (клиент узнаёт удаление).
  refused := false;
  begin
    insert into public.local_store_records (user_id, store, key, payload)
    values ('00000000-0000-0000-0000-000000000f51', 'aiFacets', 'f1', '{"v":"old"}');
  exception when unique_violation then
    refused := true;
  end;
  if not refused then
    raise exception 'FAIL 3d: вставка поверх надгробия не дала 23505';
  end if;
end $$;

-- 4. Прибавки.
DO $$
declare
  r jsonb;
  op constant text := '11111111-1111-4111-8111-111111111111';
  op2 constant text := '22222222-2222-4222-8222-222222222222';
begin
  r := pg_temp.sp1(jsonb_build_object('table','documents','op','delta','uuid','s2-doc-a','op_id',op,'sessions',1,'duration',60,'words',100));
  if r->>'status' <> 'ok' then raise exception 'FAIL 4a: %', r; end if;
  r := pg_temp.sp1(jsonb_build_object('table','documents','op','delta','uuid','s2-doc-a','op_id',op,'sessions',1,'duration',60,'words',100));
  if r->>'status' <> 'duplicate' then raise exception 'FAIL 4b: повтор = %', r; end if;
  if (select sessions_count from public.documents where uuid = 's2-doc-a') <> 1
     or (select total_duration from public.documents where uuid = 's2-doc-a') <> 60 then
    raise exception 'FAIL 4c: повтор прибавил второй раз';
  end if;

  r := pg_temp.sp1(jsonb_build_object('table','documents','op','delta','uuid','s2-doc-later','op_id',op2,'sessions',1,'duration',5,'words',1));
  if r->>'status' <> 'missing' then raise exception 'FAIL 4d: заметки нет = %', r; end if;

  r := pg_temp.sp1(jsonb_build_object('table','documents','op','delta','uuid','s2-doc-gone','op_id',op2,'sessions',1,'duration',5,'words',1));
  if r->>'status' <> 'gone' then raise exception 'FAIL 4e: надгробие заметки = %', r; end if;

  -- Ключ не потрачен ни на missing, ни на gone: та же операция ложится, когда заметка есть.
  r := pg_temp.sp1(jsonb_build_object('table','documents','op','delta','uuid','s2-doc-a','op_id',op2,'sessions',2,'duration',-1000,'words',50));
  if r->>'status' <> 'ok' then raise exception 'FAIL 4f: ключ потрачен вхолостую = %', r; end if;
  if (select sessions_count from public.documents where uuid = 's2-doc-a') <> 3
     -- Отрицательная прибавка длительности назад не уносит (0042).
     or (select total_duration from public.documents where uuid = 's2-doc-a') <> 60
     or (select total_words from public.documents where uuid = 's2-doc-a') <> 100 then
    raise exception 'FAIL 4g: счётчики после второй прибавки';
  end if;
end $$;

-- 6. Предел размера: отказ элемента, а не пачки.
DO $$
declare
  r jsonb;
begin
  r := public.sync_push(jsonb_build_array(
    jsonb_build_object('table','local_store_records','op','put','store','aiBig','key','b1','base_rev',null,
      'payload', jsonb_build_object('blob', (select string_agg(md5(i::text), '') from generate_series(1, 80000) i))),
    jsonb_build_object('table','local_store_records','op','put','store','aiBig','key','b2','base_rev',null,'payload','{"v":1}'::jsonb)));
  if r->0->>'status' <> 'rejected' or r->1->>'status' <> 'ok' then
    raise exception 'FAIL 6: %', r;
  end if;
end $$;

-- 5. Пользователь B: чужие строки.
RESET role;
SET request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000f52"}';
SET role = 'authenticated';
DO $$
declare
  r jsonb;
  too_many jsonb := '[]'::jsonb;
  refused boolean := false;
begin
  -- user_id в элементе игнорируется; ключ A — это ключ в пространстве B.
  r := pg_temp.sp1('{"table":"local_store_records","op":"put","store":"aiPortrait","key":"singleton","base_rev":null,"user_id":"00000000-0000-0000-0000-000000000f51","payload":{"v":"b"}}');
  if r->>'status' <> 'ok' then raise exception 'FAIL 5a: %', r; end if;
  -- База из чужой строки: у B своя строка с другим rev — конфликт, строка A не тронута.
  r := pg_temp.sp1(jsonb_build_object('table','local_store_records','op','put','store','aiPortrait','key','singleton',
    'base_rev',(select v from sp_probe where k='a_portrait'),'payload','{"v":"b2"}'::jsonb));
  if r->>'status' <> 'conflict' then raise exception 'FAIL 5a2: база чужой строки = %', r; end if;
  -- Ревью SYNC2: в ответе «конфликт» — строка самого B, а не строка A (утечка).
  if r->'row'->'payload'->>'v' is distinct from 'b' then raise exception 'FAIL 5a3: конфликт вернул не свою строку: %', r; end if;
  r := pg_temp.sp1('{"table":"documents","op":"delta","uuid":"s2-doc-a","op_id":"33333333-3333-4333-8333-333333333333","sessions":5,"duration":5,"words":5}');
  if r->>'status' <> 'missing' then raise exception 'FAIL 5b: чужая заметка = %', r; end if;

  for i in 1..101 loop
    too_many := too_many || '[{"table":"documents","op":"delta","uuid":"x","op_id":"44444444-4444-4444-8444-444444444444"}]'::jsonb;
  end loop;
  begin
    perform public.sync_push(too_many);
  exception when invalid_parameter_value then
    refused := true;
  end;
  if not refused then raise exception 'FAIL 5c: больше 100 элементов приняты'; end if;
end $$;
RESET role;

DO $$
begin
  if (select payload->>'v' from public.local_store_records
       where user_id = '00000000-0000-0000-0000-000000000f51' and store = 'aiPortrait' and key = 'singleton') <> '6' then
    raise exception 'FAIL 5d: строка A тронута элементом B';
  end if;
  if (select sessions_count from public.documents where uuid = 's2-doc-a') <> 3 then
    raise exception 'FAIL 5e: счётчик A тронут элементом B';
  end if;
end $$;

SET role = 'anon';
DO $$
declare
  refused boolean := false;
begin
  begin
    perform public.sync_push('[]'::jsonb);
  exception when insufficient_privilege then
    refused := true;
  end;
  if not refused then raise exception 'FAIL 5f: anon исполнил sync_push'; end if;
end $$;
RESET role;
RESET request.jwt.claims;

DO $$
declare
  ua constant uuid := '00000000-0000-0000-0000-000000000f51';
  ub constant uuid := '00000000-0000-0000-0000-000000000f52';
begin
  delete from public.local_store_records where user_id in (ua, ub);
  delete from public.documents where user_id in (ua, ub);
  delete from public.sync_op_keys where user_id in (ua, ub);
  delete from public.users where uid in (ua, ub);
end $$;

select 'sync_push: все проверки прошли';
