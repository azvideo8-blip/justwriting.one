-- drafts_updated_at.test.sql — метку обновления черновика пишет только сервер.
--
-- S0-4 (Fable §1.3, R6Q-040), посылка уточнена в SF-2: у `drafts` был только
-- `default now()`, он срабатывает на вставку, а `saveDraft`/`updateDraft`
-- присылают `updatedAt: new Date()` с клиента. Значит метку ряда мог сдвинуть
-- произвольный часовой источник. Пока метка клиентская, ни одно сравнение
-- «облако новее» на черновиках не имеет опоры: после правки SF-2 `loadDraft`
-- сверяет серверный `updated_at` облака с серверным же штампом последней
-- принятой этим устройством записи, и оба числа обязаны быть с часов сервера.
-- Прежний текст ссылался на сверку `lastSeenCloudUpdatedAt` в
-- `CloudSyncService:274` — там сравниваются `documents`, а не черновики.
--
-- Запуск (миграции уже применены):
--   docker exec -i <база> psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/tests/drafts_updated_at.test.sql
--
-- НИКОГДА не запускай рядом висящий `rls.test.sql` на проде — он рассчитан на
-- изолированную базу и трогает чужие строки. Этот файл самодостаточен: у него
-- собственный пользователь и своя строка черновика, он их создаёт и удаляет.
--
-- Проверка роста метки снята ДВУМЯ транзакциями (R7Q-036): внутри одного
-- `do $$` `now()` одинаков по определению, и сравнение было бы неопровержимым.

-- 1. Клиентская метка из прошлого не доживает до строки (INSERT).
do $$
declare
  uid constant uuid := '00000000-0000-0000-0000-000000000d43';
  t timestamptz;
begin
  insert into auth.users (id, email)
    values (uid, 'drafts-updated-at@test.local') on conflict (id) do nothing;

  delete from public.drafts where user_id = uid;

  insert into public.drafts (user_id, content, updated_at)
    values (uid, 'черновик', '2000-01-01T00:00:00Z');

  select updated_at into t from public.drafts where user_id = uid;
  if t < '2020-01-01T00:00:00Z' then
    raise exception 'INSERT: клиентская updated_at (%) дожила до строки — триггер не работает', t;
  end if;
end $$;

-- 2. UPDATE не принимает клиентское время из будущего (+сутки).
do $$
declare
  uid constant uuid := '00000000-0000-0000-0000-000000000d43';
  t timestamptz;
  future constant timestamptz := now() + interval '1 day';
begin
  update public.drafts
     set content = 'черновик 2', updated_at = future
   where user_id = uid;

  select updated_at into t from public.drafts where user_id = uid;
  if t >= future then
    raise exception 'UPDATE: клиент смог записать метку из будущего (% — просил %) — триггер не работает', t, future;
  end if;
end $$;

-- 3. Между транзакциями метка строго растёт: вставка, затем обновление.
create temp table if not exists drafts_probe (k text primary key, t timestamptz not null);

do $$
declare uid constant uuid := '00000000-0000-0000-0000-000000000d43';
begin
  update public.drafts set content = 'промер 1' where user_id = uid;
  insert into drafts_probe (k, t)
    select 'after_update_1', updated_at from public.drafts where user_id = uid;
end $$;

select pg_sleep(0.05) as пауза_между_транзакциями;

do $$
declare uid constant uuid := '00000000-0000-0000-0000-000000000d43';
begin
  update public.drafts set content = 'промер 2' where user_id = uid;
  insert into drafts_probe (k, t)
    select 'after_update_2', updated_at from public.drafts where user_id = uid;
end $$;

do $$
declare
  before_ts timestamptz;
  after_ts timestamptz;
begin
  select t into before_ts from drafts_probe where k = 'after_update_1';
  select t into after_ts from drafts_probe where k = 'after_update_2';
  if before_ts is null or after_ts is null then
    raise exception 'замер между транзакциями не снят: before=% after=%', before_ts, after_ts;
  end if;
  if after_ts <= before_ts then
    raise exception 'метка не выросла между транзакциями: % → %', before_ts, after_ts;
  end if;
end $$;

-- 4. Уборка за собой. Строки черновика удалены и в самих блоках, но этот шаг
-- убирает ещё и тестового пользователя, и временную таблицу: в gates.yml после
-- нас идут canary и постулаты, и им вид базы поперёк горла (образец —
-- server_stamp.test.sql, блок 5). Без этой строки тест оставлял запись в
-- auth.users, которой нет ни в одном другом прогоне.
do $$
declare uid constant uuid := '00000000-0000-0000-0000-000000000d43';
begin
  delete from public.drafts where user_id = uid;
  delete from auth.users where id = uid;
end $$;

drop table if exists drafts_probe;

select 'drafts_updated_at: все проверки прошли' as итог;
