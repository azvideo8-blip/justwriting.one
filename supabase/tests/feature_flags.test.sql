-- feature_flags.test.sql — RP-3: флаг «владельцу / всем / никому» отдаёт база.
--
-- Запуск (миграции уже применены):
--   docker exec -i <база> psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/tests/feature_flags.test.sql
-- Подключён в CI: job `rls` (ci.yml) и «Live database checks» (gates.yml).
--
-- Проверяется:
--   1. 'owner': админ → true, обычный → false;
--   2. 'all' → true обычному; 'nobody' → false админу;
--   3. неизвестный флаг → false (не null и не ошибка);
--   4. таблица из браузера не читается; аноним функцию не исполняет.
-- Свои строки — в первом блоке, уборка — в последнем.

DO $$
declare
  uid_admin constant uuid := '00000000-0000-0000-0000-000000000f46';
  uid_plain constant uuid := '00000000-0000-0000-0000-000000000f47';
begin
  delete from public.users where uid in (uid_admin, uid_plain);
  insert into public.users (uid, email, nickname, role) values
    (uid_admin, 'ff-admin@test.local', 'FF Admin', 'admin'),
    (uid_plain, 'ff-plain@test.local', 'FF Plain', 'user');
  delete from public.feature_flags where name like 'test_ff_%';
  insert into public.feature_flags (name, enabled_for) values
    ('test_ff_owner', 'owner'), ('test_ff_all', 'all'), ('test_ff_nobody', 'nobody');
end $$;

-- 1–3: админ.
SET request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000f46"}';
SET role = 'authenticated';
DO $$
BEGIN
  IF public.feature_enabled('test_ff_owner') IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'FAIL: owner-флаг у админа = %', public.feature_enabled('test_ff_owner');
  END IF;
  IF public.feature_enabled('test_ff_nobody') IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'FAIL: nobody-флаг у админа = %', public.feature_enabled('test_ff_nobody');
  END IF;
  IF public.feature_enabled('test_ff_unknown') IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'FAIL: неизвестный флаг = %', public.feature_enabled('test_ff_unknown');
  END IF;
END $$;
RESET role;
RESET request.jwt.claims;

-- 1–2, 4: обычный пользователь.
SET request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000f47"}';
SET role = 'authenticated';
DO $$
BEGIN
  IF public.feature_enabled('test_ff_owner') IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'FAIL: owner-флаг у обычного = %', public.feature_enabled('test_ff_owner');
  END IF;
  IF public.feature_enabled('test_ff_all') IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'FAIL: all-флаг у обычного = %', public.feature_enabled('test_ff_all');
  END IF;
  BEGIN
    PERFORM 1 FROM public.feature_flags LIMIT 1;
    RAISE EXCEPTION 'FAIL: authenticated читает public.feature_flags';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET role;
RESET request.jwt.claims;

-- 4: аноним функцию не исполняет.
SET role = 'anon';
DO $$
BEGIN
  BEGIN
    PERFORM public.feature_enabled('test_ff_all');
    RAISE EXCEPTION 'FAIL: anon исполняет feature_enabled';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET role;

-- Уборка.
DO $$
BEGIN
  delete from public.feature_flags where name like 'test_ff_%';
  delete from public.users where uid in ('00000000-0000-0000-0000-000000000f46', '00000000-0000-0000-0000-000000000f47');
END $$;
