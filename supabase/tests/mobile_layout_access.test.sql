-- mobile_layout_access.test.sql — право на мобильный макет: только админ и служебный аккаунт.
--
-- Запуск (миграции уже применены):
--   docker exec -i <база> psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/tests/mobile_layout_access.test.sql
-- Файл подключён в CI: job `rls` в .github/workflows/ci.yml (после server_stamp.test.sql)
-- и шаг 3 «Live database checks» в .github/workflows/gates.yml. Прод эта проверка не
-- трогает: она идёт по голой Postgres с подставной схемой auth (_auth_setup.sql).
--
-- Тест не пользуется чужими остатками, как server_stamp.test.sql: у него собственные
-- строки в первом блоке и уборка в последнем. Иначе набор молча зависел бы от того,
-- какие uid засеял rls.test.sql перед ним.
--
-- Проверяется ровно то, на чём держится MB-1:
--   1. админ (role='admin') → true;
--   2. uid из public.service_accounts → true (эту таблицу клиент не читает: функция
--      обязана дотянуться до неё сама, от имени владельца);
--   3. обычный пользователь → false;
--   4. аноним права на исполнение не имеет;
--   5. ответ — boolean, а не строки: без uid это false, не null и не ошибка.

-- Посев: админ, служебный аккаунт, обычный пользователь.
--
-- Строки в public.users кладём напрямую, без auth.users: триггер профиля при
-- регистрации (0006) завёл бы их с role='user', а перевести существующую строку на
-- 'admin' нельзя — protect_user_columns (0001) висит на UPDATE и rejects смену
-- роли кем бы он ни шёл. Отсюда же предварительная очистка: повторный прогон
-- должен стартовать с тех же трёх строк, а не с того, что оставил упавший прогон.
DO $$
declare
  uid_admin constant uuid := '00000000-0000-0000-0000-000000000e41';
  uid_service constant uuid := '00000000-0000-0000-0000-000000000e42';
  uid_plain constant uuid := '00000000-0000-0000-0000-000000000e43';
begin
  delete from public.service_accounts where uid in (uid_admin, uid_service, uid_plain);
  delete from public.users where uid in (uid_admin, uid_service, uid_plain);

  insert into public.users (uid, email, nickname, role) values
    (uid_admin,   'mb-admin@test.local',   'MB Admin',   'admin'),
    (uid_service, 'mb-service@test.local', 'MB Service', 'user'),
    (uid_plain,   'mb-plain@test.local',   'MB Plain',   'user');

  insert into public.service_accounts (uid, note) values
    (uid_service, 'тест мобильного макета');
end $$;

-- 1. Админ → true.
SET request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000e41"}';
SET role = 'authenticated';

DO $$
BEGIN
  IF public.mobile_layout_allowed() IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'FAIL: админ получил % вместо true', public.mobile_layout_allowed();
  END IF;
END $$;

RESET role;
RESET request.jwt.claims;

-- 2. Служебный аккаунт (не админ, сам таблицы не читает) → true.
-- Мутация MB-1: убрать из функции ветку service_accounts → этот блок красный.
SET request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000e42"}';
SET role = 'authenticated';

DO $$
BEGIN
  IF public.mobile_layout_allowed() IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'FAIL: служебный аккаунт получил % вместо true', public.mobile_layout_allowed();
  END IF;
END $$;

RESET role;
RESET request.jwt.claims;

-- 3. Обычный пользователь → false.
SET request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000e43"}';
SET role = 'authenticated';

DO $$
BEGIN
  IF public.mobile_layout_allowed() IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'FAIL: обычный пользователь получил % вместо false', public.mobile_layout_allowed();
  END IF;
END $$;

-- 5. Тот же authenticated без sub в токене: false, не null и не ошибка.
SET request.jwt.claims = '{"sub":""}';

DO $$
DECLARE ok boolean;
BEGIN
  ok := public.mobile_layout_allowed();
  IF ok IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'FAIL: без uid функция вернула % вместо false', ok;
  END IF;
END $$;

RESET role;
RESET request.jwt.claims;

-- 4. Аноним: права на исполнение нет ни в каталоге, ни на деле.
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.mobile_layout_allowed()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: anon имеет EXECUTE на mobile_layout_allowed';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.mobile_layout_allowed()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: у authenticated нет EXECUTE — клиент не сможет спросить';
  END IF;
END $$;

SET role = 'anon';

DO $$
BEGIN
  BEGIN
    PERFORM public.mobile_layout_allowed();
    RAISE EXCEPTION 'FAIL: anon исполнил mobile_layout_allowed';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END $$;

RESET role;
RESET request.jwt.claims;

-- Уборка: тестовые строки не остаются в базе.
DO $$
BEGIN
  DELETE FROM public.service_accounts WHERE uid = '00000000-0000-0000-0000-000000000e42';
  DELETE FROM public.users WHERE uid IN (
    '00000000-0000-0000-0000-000000000e41',
    '00000000-0000-0000-0000-000000000e42',
    '00000000-0000-0000-0000-000000000e43');
END $$;

DO $$
BEGIN
  RAISE NOTICE 'All mobile layout access checks passed.';
END $$;
