-- rls.test.sql — Negative tests for RLS policies.
-- Run with:
--   ARGS="-f supabase/tests/_auth_setup.sql"
--   for f in supabase/migrations/*.sql; do ARGS="$ARGS -f $f"; done
--   ARGS="$ARGS -f supabase/tests/rls.test.sql"
--   psql -h localhost -U postgres -v ON_ERROR_STOP=1 $ARGS
--
-- Each case is wrapped in a DO block that RAISEs EXCEPTION on unexpected
-- success, so psql will exit non-zero if any check fails.

-- ============================================================
-- Setup: two test users + seed data for Bob
-- ============================================================
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-000000000001', 'alice@test.com'),
  ('00000000-0000-0000-0000-000000000002', 'bob@test.com')
ON CONFLICT DO NOTHING;

-- Seed Bob's data so negative tests have something to attempt to read.
INSERT INTO public.users (uid, email, nickname) VALUES
  ('00000000-0000-0000-0000-000000000001', 'alice@test.com', 'Alice'),
  ('00000000-0000-0000-0000-000000000002', 'bob@test.com', 'Bob')
ON CONFLICT DO NOTHING;

-- current_version задан явно и равен номеру версии ниже. Приложение иначе и не
-- пишет, а строка «документ на версии 0 с версией номер 1» — это состояние,
-- которое BETA-5 как раз объявляет невозможным. Данные для проверки политик
-- доступа не повод нарушать инвариант, который тут же и проверяется.
INSERT INTO public.documents (uuid, user_id, title, current_version) VALUES
  ('bob-doc-001', '00000000-0000-0000-0000-000000000002', 'Bob''s secret', 1)
ON CONFLICT DO NOTHING;

INSERT INTO public.versions (document_uuid, user_id, version, content, word_count) VALUES
  ('bob-doc-001', '00000000-0000-0000-0000-000000000002', 1, 'secret content', 2)
ON CONFLICT DO NOTHING;

INSERT INTO public.drafts (user_id, content) VALUES
  ('00000000-0000-0000-0000-000000000002', 'Bob''s draft')
ON CONFLICT DO NOTHING;

INSERT INTO public.ai_summaries (document_id, user_id) VALUES
  ('bob-doc-001', '00000000-0000-0000-0000-000000000002')
ON CONFLICT DO NOTHING;

INSERT INTO public.ai_embeddings (document_id, user_id) VALUES
  ('bob-doc-001', '00000000-0000-0000-0000-000000000002')
ON CONFLICT DO NOTHING;

INSERT INTO public.ai_usage (uid, date, data) VALUES
  ('00000000-0000-0000-0000-000000000002', '2026-01-01', '{"tokens": 100}')
ON CONFLICT DO NOTHING;

-- Seed local_store_records for Bob
INSERT INTO public.local_store_records (user_id, store, key, payload) VALUES
  ('00000000-0000-0000-0000-000000000002', 'aiDialogues', 'dlg-1', '{"id":"dlg-1"}')
ON CONFLICT DO NOTHING;

-- Seed deny-all and client-isolated tables so SELECT checks are not empty (TEST-GUARD-2)
INSERT INTO public.ai_daily_limit (uid, data) VALUES
  ('00000000-0000-0000-0000-000000000002', '{"limit": 100}')
ON CONFLICT DO NOTHING;

INSERT INTO public.ai_cooldown (uid, data) VALUES
  ('00000000-0000-0000-0000-000000000002', '{"cooldown": true}')
ON CONFLICT DO NOTHING;

INSERT INTO public.ai_global_daily (date, data) VALUES
  ('2026-01-01', '{"count": 50}')
ON CONFLICT DO NOTHING;

INSERT INTO public.anonymized_telemetry (id, data) VALUES
  ('telem-seed-001', '{"event": "test"}')
ON CONFLICT DO NOTHING;

INSERT INTO public.ai_usage_calls (uid, fn, model, tokens_in, tokens_out) VALUES
  ('00000000-0000-0000-0000-000000000002', 'chat', 'test-model', 100, 20);

INSERT INTO public.applied_migrations (filename) VALUES
  ('0000_seed.sql')
ON CONFLICT DO NOTHING;

INSERT INTO public.connection_test (id) VALUES
  ('ping')
ON CONFLICT DO NOTHING;

-- Positive control: ensure all seeded rows exist under postgres before testing client isolation
DO $$
DECLARE c int;
BEGIN
  SELECT count(*) INTO c FROM public.ai_daily_limit WHERE uid = '00000000-0000-0000-0000-000000000002';
  IF c = 0 THEN RAISE EXCEPTION 'seed missing: ai_daily_limit'; END IF;

  SELECT count(*) INTO c FROM public.ai_cooldown WHERE uid = '00000000-0000-0000-0000-000000000002';
  IF c = 0 THEN RAISE EXCEPTION 'seed missing: ai_cooldown'; END IF;

  SELECT count(*) INTO c FROM public.ai_global_daily WHERE date = '2026-01-01';
  IF c = 0 THEN RAISE EXCEPTION 'seed missing: ai_global_daily'; END IF;

  SELECT count(*) INTO c FROM public.anonymized_telemetry WHERE id = 'telem-seed-001';
  IF c = 0 THEN RAISE EXCEPTION 'seed missing: anonymized_telemetry'; END IF;

  SELECT count(*) INTO c FROM public.ai_usage_calls WHERE uid = '00000000-0000-0000-0000-000000000002' AND fn = 'chat';
  IF c = 0 THEN RAISE EXCEPTION 'seed missing: ai_usage_calls'; END IF;

  SELECT count(*) INTO c FROM public.applied_migrations WHERE filename = '0000_seed.sql';
  IF c = 0 THEN RAISE EXCEPTION 'seed missing: applied_migrations'; END IF;

  SELECT count(*) INTO c FROM public.connection_test WHERE id = 'ping';
  IF c = 0 THEN RAISE EXCEPTION 'seed missing: connection_test'; END IF;
END $$;

-- Impersonate Alice (non-admin authenticated user).
SET request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001"}';
SET role = 'authenticated';

-- ============================================================
-- users: Alice cannot read Bob's profile (non-admin)
-- ============================================================
DO $$
DECLARE cnt int;
BEGIN
  SELECT count(*) INTO cnt
    FROM public.users
   WHERE uid = '00000000-0000-0000-0000-000000000002';
  IF cnt > 0 THEN
    RAISE EXCEPTION 'FAIL: Alice read Bob''s profile (% rows)', cnt;
  END IF;
END $$;

-- ============================================================
-- users: Alice cannot update Bob's profile
-- ============================================================
DO $$
DECLARE affected int;
BEGIN
  UPDATE public.users SET nickname = 'hacked'
   WHERE uid = '00000000-0000-0000-0000-000000000002';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected > 0 THEN
    RAISE EXCEPTION 'FAIL: Alice updated Bob''s profile (% rows)', affected;
  END IF;
END $$;

-- ============================================================
-- documents: Alice cannot read Bob's documents
-- ============================================================
DO $$
DECLARE cnt int;
BEGIN
  SELECT count(*) INTO cnt
    FROM public.documents
   WHERE user_id = '00000000-0000-0000-0000-000000000002';
  IF cnt > 0 THEN
    RAISE EXCEPTION 'FAIL: Alice read Bob''s documents (% rows)', cnt;
  END IF;
END $$;

-- ============================================================
-- documents: Alice cannot insert a document for Bob
-- ============================================================
DO $$
DECLARE ok boolean;
BEGIN
  BEGIN
    INSERT INTO public.documents (uuid, user_id, title)
    VALUES ('test-uuid', '00000000-0000-0000-0000-000000000002', 'stolen');
    ok := false;
  EXCEPTION
    WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL: Alice inserted document for Bob';
  END IF;
END $$;

-- ============================================================
-- documents: Alice cannot update Bob's document
-- ============================================================
DO $$
DECLARE affected int;
BEGIN
  UPDATE public.documents SET title = 'hacked'
   WHERE user_id = '00000000-0000-0000-0000-000000000002';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected > 0 THEN
    RAISE EXCEPTION 'FAIL: Alice updated Bob''s document (% rows)', affected;
  END IF;
END $$;

-- ============================================================
-- documents: Alice cannot delete Bob's document
-- ============================================================
DO $$
DECLARE affected int;
BEGIN
  DELETE FROM public.documents
   WHERE user_id = '00000000-0000-0000-0000-000000000002';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected > 0 THEN
    RAISE EXCEPTION 'FAIL: Alice deleted Bob''s document (% rows)', affected;
  END IF;
END $$;

-- ============================================================
-- versions: Alice cannot read Bob's versions
-- ============================================================
DO $$
DECLARE cnt int;
BEGIN
  SELECT count(*) INTO cnt
    FROM public.versions
   WHERE user_id = '00000000-0000-0000-0000-000000000002';
  IF cnt > 0 THEN
    RAISE EXCEPTION 'FAIL: Alice read Bob''s versions (% rows)', cnt;
  END IF;
END $$;

-- ============================================================
-- versions: Alice cannot insert a version for Bob
-- ============================================================
DO $$
DECLARE ok boolean;
BEGIN
  BEGIN
    INSERT INTO public.versions (document_uuid, user_id, version, content, word_count)
    VALUES ('bob-doc-001', '00000000-0000-0000-0000-000000000002', 2, 'stolen', 1);
    ok := false;
  EXCEPTION
    WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL: Alice inserted version for Bob';
  END IF;
END $$;

-- ============================================================
-- versions: Alice cannot update Bob's version
-- ============================================================
DO $$
DECLARE affected int;
BEGIN
  UPDATE public.versions SET content = 'hacked'
   WHERE user_id = '00000000-0000-0000-0000-000000000002';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected > 0 THEN
    RAISE EXCEPTION 'FAIL: Alice updated Bob''s version (% rows)', affected;
  END IF;
END $$;

-- ============================================================
-- versions: Alice cannot delete Bob's version
-- ============================================================
DO $$
DECLARE affected int;
BEGIN
  DELETE FROM public.versions
   WHERE user_id = '00000000-0000-0000-0000-000000000002';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected > 0 THEN
    RAISE EXCEPTION 'FAIL: Alice deleted Bob''s version (% rows)', affected;
  END IF;
END $$;

-- ============================================================
-- drafts: Alice cannot read Bob's draft
-- ============================================================
DO $$
DECLARE cnt int;
BEGIN
  SELECT count(*) INTO cnt
    FROM public.drafts
   WHERE user_id = '00000000-0000-0000-0000-000000000002';
  IF cnt > 0 THEN
    RAISE EXCEPTION 'FAIL: Alice read Bob''s draft (% rows)', cnt;
  END IF;
END $$;

-- ============================================================
-- drafts: Alice cannot update Bob's draft
-- ============================================================
DO $$
DECLARE affected int;
BEGIN
  UPDATE public.drafts SET content = 'hacked'
   WHERE user_id = '00000000-0000-0000-0000-000000000002';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected > 0 THEN
    RAISE EXCEPTION 'FAIL: Alice updated Bob''s draft (% rows)', affected;
  END IF;
END $$;

-- ============================================================
-- ai_summaries: Alice cannot read Bob's summaries
-- ============================================================
DO $$
DECLARE cnt int;
BEGIN
  SELECT count(*) INTO cnt
    FROM public.ai_summaries
   WHERE user_id = '00000000-0000-0000-0000-000000000002';
  IF cnt > 0 THEN
    RAISE EXCEPTION 'FAIL: Alice read Bob''s summaries (% rows)', cnt;
  END IF;
END $$;

-- ============================================================
-- ai_summaries: Alice cannot insert for Bob
-- ============================================================
DO $$
DECLARE ok boolean;
BEGIN
  BEGIN
    INSERT INTO public.ai_summaries (document_id, user_id)
    VALUES ('x', '00000000-0000-0000-0000-000000000002');
    ok := false;
  EXCEPTION
    WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL: Alice inserted summary for Bob';
  END IF;
END $$;

-- ============================================================
-- ai_embeddings: Alice cannot read Bob's embeddings
-- ============================================================
DO $$
DECLARE cnt int;
BEGIN
  SELECT count(*) INTO cnt
    FROM public.ai_embeddings
   WHERE user_id = '00000000-0000-0000-0000-000000000002';
  IF cnt > 0 THEN
    RAISE EXCEPTION 'FAIL: Alice read Bob''s embeddings (% rows)', cnt;
  END IF;
END $$;

-- ============================================================
-- ai_embeddings: Alice cannot insert for Bob
-- ============================================================
DO $$
DECLARE ok boolean;
BEGIN
  BEGIN
    INSERT INTO public.ai_embeddings (document_id, user_id)
    VALUES ('x', '00000000-0000-0000-0000-000000000002');
    ok := false;
  EXCEPTION
    WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL: Alice inserted embedding for Bob';
  END IF;
END $$;

-- ============================================================
-- ai_daily_limit: no client access at all
-- ============================================================
DO $$
DECLARE cnt int;
BEGIN
  SELECT count(*) INTO cnt FROM public.ai_daily_limit;
  IF cnt > 0 THEN
    RAISE EXCEPTION 'FAIL: client read ai_daily_limit (% rows)', cnt;
  END IF;
END $$;

-- ============================================================
-- ai_cooldown: no client access at all
-- ============================================================
DO $$
DECLARE cnt int;
BEGIN
  SELECT count(*) INTO cnt FROM public.ai_cooldown;
  IF cnt > 0 THEN
    RAISE EXCEPTION 'FAIL: client read ai_cooldown (% rows)', cnt;
  END IF;
END $$;

-- ============================================================
-- ai_usage: Alice can read own, cannot read Bob's
-- ============================================================
DO $$
DECLARE cnt int;
BEGIN
  SELECT count(*) INTO cnt
    FROM public.ai_usage
   WHERE uid = '00000000-0000-0000-0000-000000000002';
  IF cnt > 0 THEN
    RAISE EXCEPTION 'FAIL: Alice read Bob''s ai_usage (% rows)', cnt;
  END IF;
END $$;

-- ============================================================
-- ai_usage: Alice cannot write
-- ============================================================
DO $$
DECLARE ok boolean;
BEGIN
  BEGIN
    INSERT INTO public.ai_usage (uid, date, data)
    VALUES ('00000000-0000-0000-0000-000000000001', '2026-01-01', '{}');
    ok := false;
  EXCEPTION
    WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL: client inserted into ai_usage';
  END IF;
END $$;

-- ============================================================
-- ai_global_daily: no client access at all
-- ============================================================
DO $$
DECLARE cnt int;
BEGIN
  SELECT count(*) INTO cnt FROM public.ai_global_daily;
  IF cnt > 0 THEN
    RAISE EXCEPTION 'FAIL: client read ai_global_daily (% rows)', cnt;
  END IF;
END $$;

-- ============================================================
-- anonymized_telemetry: client cannot read (admin only)
-- ============================================================
DO $$
DECLARE cnt int;
BEGIN
  SELECT count(*) INTO cnt FROM public.anonymized_telemetry;
  IF cnt > 0 THEN
    RAISE EXCEPTION 'FAIL: client read anonymized_telemetry (% rows)', cnt;
  END IF;
END $$;

-- ============================================================
-- anonymized_telemetry: client cannot insert
-- ============================================================
DO $$
DECLARE ok boolean;
BEGIN
  BEGIN
    INSERT INTO public.anonymized_telemetry (id, data)
    VALUES ('x', '{}');
    ok := false;
  EXCEPTION
    WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL: client inserted into anonymized_telemetry';
  END IF;
END $$;

-- ============================================================
-- ai_usage_calls: client cannot read (admin only), even Bob's own row
-- ============================================================
DO $$
DECLARE cnt int;
BEGIN
  SELECT count(*) INTO cnt FROM public.ai_usage_calls;
  IF cnt > 0 THEN
    RAISE EXCEPTION 'FAIL: client read ai_usage_calls (% rows)', cnt;
  END IF;
END $$;

-- ============================================================
-- ai_usage_calls: client cannot insert
-- ============================================================
DO $$
DECLARE ok boolean;
BEGIN
  BEGIN
    INSERT INTO public.ai_usage_calls (uid, fn, tokens_in, tokens_out)
    VALUES ('00000000-0000-0000-0000-000000000001', 'chat', 1, 1);
    ok := false;
  EXCEPTION
    WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL: client inserted into ai_usage_calls';
  END IF;
END $$;

-- ============================================================
-- connection_test: authenticated can read
-- ============================================================
DO $$
DECLARE cnt int;
BEGIN
  -- Authenticated user can read ping row (TEST-GUARD-2)
  SELECT count(*) INTO cnt FROM public.connection_test;
  IF cnt <> 1 THEN
    RAISE EXCEPTION 'FAIL: authenticated user cannot read connection_test (got % rows, expected 1)', cnt;
  END IF;
END $$;

-- ============================================================
-- connection_test: client cannot write
-- ============================================================
DO $$
DECLARE ok boolean;
BEGIN
  BEGIN
    INSERT INTO public.connection_test (id) VALUES ('evil');
    ok := false;
  EXCEPTION
    WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL: client inserted into connection_test';
  END IF;
END $$;

-- ============================================================
-- local_store_records: Alice cannot read Bob's records
-- ============================================================
DO $$
DECLARE cnt int;
BEGIN
  SELECT count(*) INTO cnt
    FROM public.local_store_records
   WHERE user_id = '00000000-0000-0000-0000-000000000002';
  IF cnt > 0 THEN
    RAISE EXCEPTION 'FAIL: Alice read Bob''s local_store_records (% rows)', cnt;
  END IF;
END $$;

-- ============================================================
-- local_store_records: Alice cannot insert for Bob
-- ============================================================
DO $$
DECLARE ok boolean;
BEGIN
  BEGIN
    INSERT INTO public.local_store_records (user_id, store, key, payload)
    VALUES ('00000000-0000-0000-0000-000000000002', 'test', 'k', '{}');
    ok := false;
  EXCEPTION
    WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL: Alice inserted local_store_record for Bob';
  END IF;
END $$;

-- ============================================================
-- versions: Alice cannot insert a version for Bob's document (I3)
-- ============================================================
DO $$
DECLARE ok boolean;
BEGIN
  BEGIN
    -- Alice inserts a version, setting user_id to herself, but document_uuid to Bob's
    INSERT INTO public.versions (document_uuid, user_id, version, content, word_count)
    VALUES ('bob-doc-001', '00000000-0000-0000-0000-000000000001', 2, 'stolen', 1);
    ok := false;
  EXCEPTION
    WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL: Alice inserted version for Bob''s document';
  END IF;
END $$;

-- ============================================================
-- users: Alice cannot change her own role to admin (I4)
-- ============================================================
DO $$
DECLARE ok boolean;
BEGIN
  BEGIN
    UPDATE public.users SET role = 'admin'
     WHERE uid = '00000000-0000-0000-0000-000000000001';
    ok := false;
  EXCEPTION
    WHEN insufficient_privilege THEN ok := true;
    WHEN check_violation THEN ok := true;
    -- protect_user_columns() (0015) raises a plain exception (SQLSTATE
    -- P0001 / raise_exception) for role changes, not an RLS/CHECK error —
    -- same as the email-immutability block below it.
    WHEN raise_exception THEN ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL: Alice made herself admin';
  END IF;
END $$;

-- ============================================================
-- local_store_records: Alice cannot update Bob's records
-- ============================================================
DO $$
DECLARE affected int;
BEGIN
  UPDATE public.local_store_records SET payload = '{"hacked":true}'
   WHERE user_id = '00000000-0000-0000-0000-000000000002';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected > 0 THEN
    RAISE EXCEPTION 'FAIL: Alice updated Bob''s local_store_records (% rows)', affected;
  END IF;
END $$;

-- ============================================================
-- local_store_records: Alice cannot delete Bob's records
-- ============================================================
DO $$
DECLARE affected int;
BEGIN
  DELETE FROM public.local_store_records
   WHERE user_id = '00000000-0000-0000-0000-000000000002';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected > 0 THEN
    RAISE EXCEPTION 'FAIL: Alice deleted Bob''s local_store_records (% rows)', affected;
  END IF;
END $$;

-- ============================================================
-- users: Cannot insert a user row with role='admin' (JW-SEC-04)
-- ============================================================
-- Seed Charlie in auth.users only.
-- С 57-й строки мы сидим под ролью authenticated, а у неё нет прав на схему
-- auth — засев обязан идти от владельца, иначе весь файл падает здесь на
-- permission denied.
RESET ROLE;
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-000000000003', 'charlie@test.com')
ON CONFLICT DO NOTHING;

-- Триггер из 0006 заводит профиль сам при появлении строки в auth.users.
-- Обе проверки ниже вставляют профиль Чарли руками, поэтому созданную
-- триггером строку убираем — иначе положительная проверка падает на
-- дублирующемся ключе, а отрицательная проходит по неверной причине: её
-- обработчик ловит `WHEN others`, и duplicate key он засчитал бы как успех.
DELETE FROM public.users WHERE uid = '00000000-0000-0000-0000-000000000003';

-- Impersonate Charlie
SET request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003"}';
SET role = 'authenticated';

-- Charlie cannot insert profile with role='admin'
DO $$
DECLARE ok boolean;
BEGIN
  BEGIN
    INSERT INTO public.users (uid, email, nickname, role)
    VALUES ('00000000-0000-0000-0000-000000000003', 'charlie@test.com', 'Charlie', 'admin');
    ok := false;
  EXCEPTION
    WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL: Charlie inserted profile with role=admin';
  END IF;
END $$;

-- Charlie CAN insert profile with role='user' or default role
DO $$
BEGIN
  INSERT INTO public.users (uid, email, nickname, role)
  VALUES ('00000000-0000-0000-0000-000000000003', 'charlie@test.com', 'Charlie', 'user');
END $$;

-- ============================================================
-- users: Alice cannot change email (server-controlled, AG-SEC-B)
-- ============================================================
SET request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001"}';
SET role = 'authenticated';

DO $$
DECLARE ok boolean;
BEGIN
  BEGIN
    UPDATE public.users SET email = 'evil@test.com'
     WHERE uid = '00000000-0000-0000-0000-000000000001';
    ok := false;
  EXCEPTION
    WHEN insufficient_privilege THEN ok := true;
    WHEN raise_exception THEN ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL: Alice changed her email from client';
  END IF;
END $$;

-- ============================================================
-- users: Email syncs from auth.users via trigger (AG-SEC-B)
-- ============================================================
RESET request.jwt.claims;
RESET role;

UPDATE auth.users SET email = 'alice-new@test.com'
 WHERE id = '00000000-0000-0000-0000-000000000001';

DO $$
DECLARE cur_email text;
BEGIN
  SELECT email INTO cur_email
    FROM public.users
   WHERE uid = '00000000-0000-0000-0000-000000000001';
  IF cur_email <> 'alice-new@test.com' THEN
    RAISE EXCEPTION 'FAIL: email was not synced to public.users (got %)', cur_email;
  END IF;
END $$;

-- ============================================================
-- applied_migrations: Deny all for clients (AG-SEC-B)
-- ============================================================
SET request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001"}';
SET role = 'authenticated';

DO $$
DECLARE cnt int;
BEGIN
  SELECT count(*) INTO cnt FROM public.applied_migrations;
  IF cnt > 0 THEN
    RAISE EXCEPTION 'FAIL: Alice read applied_migrations (% rows)', cnt;
  END IF;
END $$;

DO $$
DECLARE ok boolean;
BEGIN
  BEGIN
    INSERT INTO public.applied_migrations (filename) VALUES ('0999_evil.sql');
    ok := false;
  EXCEPTION
    WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL: Alice inserted into applied_migrations';
  END IF;
END $$;

-- ============================================================
-- documents: Tombstones immutability (AG-SYNC-5 / 0016_document_tombstones)
-- ============================================================
SET request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001"}';
SET role = 'authenticated';

-- Alice creates a document
INSERT INTO public.documents (uuid, user_id, title)
VALUES ('alice-tombstone-doc', '00000000-0000-0000-0000-000000000001', 'Alice active note')
ON CONFLICT (uuid) DO NOTHING;

-- Alice soft-deletes her document
UPDATE public.documents
   SET deleted_at = now(), title = ''
 WHERE uuid = 'alice-tombstone-doc';

-- Alice tries to update the tombstoned document (should affect 0 rows)
DO $$
DECLARE affected int;
BEGIN
  UPDATE public.documents SET title = 'Resurrected note'
   WHERE uuid = 'alice-tombstone-doc';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected > 0 THEN
    RAISE EXCEPTION 'FAIL: Alice updated tombstoned document (% rows)', affected;
  END IF;
END $$;

-- Alice tries to unset deleted_at (should affect 0 rows)
DO $$
DECLARE affected int;
BEGIN
  UPDATE public.documents SET deleted_at = null
   WHERE uuid = 'alice-tombstone-doc';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected > 0 THEN
    RAISE EXCEPTION 'FAIL: Alice un-deleted tombstoned document (% rows)', affected;
  END IF;
END $$;

RESET request.jwt.claims;
RESET role;

-- ============================================================
-- Summary: count passed checks
-- ============================================================
DO $$
BEGIN
  RAISE NOTICE 'Base RLS checks passed; audit additions follow.';
END $$;
-- ============================================================
-- TEST-1 additions: regression cases for migrations
--   0017 (admin RLS lookup), 0018 (consent stamp),
--   0019 (achievements reset), 0020 (sessions rpc)
-- Appended to supabase/tests/rls.test.sql. Style matches the suite:
-- any violated expectation RAISEs and fails the run (ON_ERROR_STOP=1).
-- ============================================================

-- ------------------------------------------------------------
-- 1.1 — is_admin() / admin RLS policies.
-- Alice (authenticated) must see only her own users-row; an admin row
-- created server-side sees everything; recursion inside the users policy
-- would time out or error the whole SELECT, which itself is a failure.
-- ------------------------------------------------------------
SET role = 'authenticated';
SET request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001"}';

DO $$
DECLARE
  visible_for_alice int;
BEGIN
  SELECT count(*) INTO visible_for_alice FROM public.users;
  -- At this point in the suite only Alice's own profile row exists for her JWT.
  IF visible_for_alice > 1 THEN
    RAISE EXCEPTION 'FAIL: plain user sees % users rows (expected own only)', visible_for_alice;
  END IF;
END $$;

RESET role;
-- Provision the admin server-side. Claims GUC is set BEFORE touching users:
-- an empty-string GUC breaks auth.uid() json parsing.
SET role = 'postgres';
SET request.jwt.claims = '{"sub":"99999999-9999-9999-9999-999999999999","role":"authenticated"}';
INSERT INTO public.users (uid, email, nickname, role)
VALUES ('99999999-9999-9999-9999-999999999999', 'admin@suite.local', 'Suite Admin', 'admin')
ON CONFLICT (uid) DO UPDATE SET role = 'admin';
RESET role;

-- Under an authenticated non-admin JWT the function answers false.
SET role = 'authenticated';
SET request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001"}';
DO $$
BEGIN
  IF public.is_admin() IS TRUE THEN
    RAISE EXCEPTION 'FAIL: is_admin() true for a plain user';
  END IF;
END $$;

-- DEEP-5: Plain user cannot read public.admin_users_view (0 rows).
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.admin_users_view;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL: plain user read admin_users_view (% rows)', n;
  END IF;
END $$;

-- Telemetry stays invisible to the plain user (policy now uses is_admin()).
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.anonymized_telemetry;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL: plain user read anonymized_telemetry (% rows)', n;
  END IF;
END $$;
RESET role;
RESET request.jwt.claims;

-- DEEP-5: Admin JWT can ONLY see own row in public.users, preventing exposure of
-- other users' private unencrypted ai_portrait.
SET role = 'authenticated';
SET request.jwt.claims = '{"sub":"99999999-9999-9999-9999-999999999999","role":"authenticated"}';
DO $$
DECLARE
  visible_for_admin int;
  alice_portrait_visible int;
  view_count int;
BEGIN
  -- 1. Direct query to public.users returns ONLY admin's own row.
  SELECT count(*) INTO visible_for_admin FROM public.users;
  IF visible_for_admin <> 1 THEN
    RAISE EXCEPTION 'FAIL: admin sees % users rows directly (expected own row only = 1)', visible_for_admin;
  END IF;

  -- 2. Admin cannot select Alice's row or ai_portrait from public.users.
  SELECT count(*) INTO alice_portrait_visible FROM public.users WHERE uid = '00000000-0000-0000-0000-000000000001';
  IF alice_portrait_visible <> 0 THEN
    RAISE EXCEPTION 'FAIL: admin read Alice profile from public.users (% rows)', alice_portrait_visible;
  END IF;

  -- 3. Admin can list users via public.admin_users_view (operational metadata only).
  SELECT count(*) INTO view_count FROM public.admin_users_view;
  IF view_count < 2 THEN
    RAISE EXCEPTION 'FAIL: admin sees only % rows in admin_users_view (expected >= 2)', view_count;
  END IF;
END $$;

-- Admin can read ai_usage_calls (per-call token breakdown), unlike a plain user above.
DO $$
DECLARE cnt int;
BEGIN
  SELECT count(*) INTO cnt FROM public.ai_usage_calls WHERE fn = 'chat';
  IF cnt = 0 THEN
    RAISE EXCEPTION 'FAIL: admin could not read ai_usage_calls';
  END IF;
END $$;
RESET role;
RESET request.jwt.claims;

-- ------------------------------------------------------------
-- 1.7 — consent stamp: client cannot forge ai_consent_server_at; the trigger
-- sets it whenever consent fields change.
-- ------------------------------------------------------------
SET role = 'authenticated';
SET request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001"}';

UPDATE public.users
   SET ai_consent_at = now(),
       ai_consent_version = 2,
       ai_consent_server_at = '1970-01-01'::timestamptz  -- forged value attempt
 WHERE uid = '00000000-0000-0000-0000-000000000001';

DO $$
DECLARE stamped timestamptz;
BEGIN
  SELECT ai_consent_server_at INTO stamped FROM public.users
   WHERE uid = '00000000-0000-0000-0000-000000000001';
  IF stamped IS NULL OR stamped < now() - interval '1 minute' THEN
    RAISE EXCEPTION 'FAIL: ai_consent_server_at was not stamped by the trigger (%)', stamped;
  END IF;
END $$;

DO $$
DECLARE bad int;
BEGIN
  BEGIN
    UPDATE public.users SET ai_consent_version = 0
     WHERE uid = '00000000-0000-0000-0000-000000000001';
    bad := 0;
  EXCEPTION
    -- users_ai_consent_version_check (0018) raises check_violation (SQLSTATE
    -- 23514); neither BEFORE UPDATE trigger interferes (stamp_consent touches
    -- ai_consent_server_at without raising, protect_user_columns checks role/uid/email),
    -- and WITH CHECK passes (own row).
    WHEN check_violation THEN bad := 1;
  END;
  IF bad <> 1 THEN
    RAISE EXCEPTION 'FAIL: ai_consent_version=0 accepted, CHECK missing';
  END IF;
END $$;
RESET role;
RESET request.jwt.claims;

-- ------------------------------------------------------------
-- 2.11 — achievements reset column exists on the profile row.
-- (The skip-on-merge semantics live client-side; here we pin the tombstone
-- field the merge reads.)
-- ------------------------------------------------------------
SET role = 'authenticated';
SET request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001"}';
UPDATE public.users
   SET earned_achievements = '{}',
       achievements_reset_at = now()
 WHERE uid = '00000000-0000-0000-0000-000000000001';
DO $$
DECLARE r timestamptz;
BEGIN
  SELECT achievements_reset_at INTO r FROM public.users
   WHERE uid = '00000000-0000-0000-0000-000000000001';
  IF r IS NULL THEN
    RAISE EXCEPTION 'FAIL: achievements_reset_at was not persisted';
  END IF;
END $$;
RESET role;
RESET request.jwt.claims;

-- ------------------------------------------------------------
-- 2.17 — increment_document_sessions: +1 twice = +2 (no lost update), and it
-- refuses to touch another user's document.
-- ------------------------------------------------------------
SET role = 'authenticated';
SET request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001"}';

INSERT INTO public.documents (uuid, user_id, title)
VALUES ('rpc-counter-doc', '00000000-0000-0000-0000-000000000001', 'RPC counter')
ON CONFLICT (uuid) DO NOTHING;

-- Two parallel-style sequential calls: the count must grow by exactly 2.
DO $$
DECLARE c1 int; c2 int;
BEGIN
  SELECT sessions_count INTO c1 FROM public.documents WHERE uuid = 'rpc-counter-doc';
  PERFORM public.increment_document_sessions('rpc-counter-doc', 1);
  PERFORM public.increment_document_sessions('rpc-counter-doc', 1);
  SELECT sessions_count INTO c2 FROM public.documents WHERE uuid = 'rpc-counter-doc';
  IF c2 - c1 <> 2 THEN
    RAISE EXCEPTION 'FAIL: two rpc calls produced delta % (expected 2)', c2 - c1;
  END IF;
END $$;

-- Cross-user refusal: Bob's JWT cannot increment Alice's document.
SET role = 'authenticated';
SET request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002"}';
DO $$
DECLARE c1 int; c2 int;
BEGIN
  SELECT sessions_count INTO c1 FROM public.documents WHERE uuid = 'rpc-counter-doc';
  PERFORM public.increment_document_sessions('rpc-counter-doc', 1);
  SELECT sessions_count INTO c2 FROM public.documents WHERE uuid = 'rpc-counter-doc';
  IF c2 <> c1 THEN
    RAISE EXCEPTION 'FAIL: cross-user rpc changed sessions_count (% -> %)', c1, c2;
  END IF;
END $$;

-- The direct UPDATE path is still blocked for a foreign user (RLS baseline).
RESET role;
RESET request.jwt.claims;

-- ------------------------------------------------------------
-- AG-QUOTA-1 (#25): размерные лимиты enforced. Оба плеча: отказ И приёмка.
-- Проверка «только rejection» проходила бы и на таблице, отказывающей всему.
-- ------------------------------------------------------------
SET role = 'authenticated';
SET request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001"}';

DO $$
BEGIN
  -- Oversized tags (> 8192 bytes) are rejected by documents_tags_size.
  BEGIN
    INSERT INTO public.documents (uuid, user_id, title, tags)
    VALUES ('quota-oversize', '00000000-0000-0000-0000-000000000001',
            'Quota oversize', array_to_json(array_fill('тэг'::text, ARRAY[2000]))::jsonb);
    RAISE EXCEPTION 'FAIL: oversized tags were accepted';
  EXCEPTION WHEN check_violation THEN NULL;  -- expected
  END;

  -- A normal-sized tag list passes the same constraint.
  INSERT INTO public.documents (uuid, user_id, title, tags)
  VALUES ('quota-normal', '00000000-0000-0000-0000-000000000001',
          'Quota normal', '["дневник","утро"]');

  -- Oversized pinned_thoughts (> 60000 bytes) rejected by drafts constraint.
  BEGIN
    INSERT INTO public.drafts (user_id, content, pinned_thoughts)
    VALUES ('00000000-0000-0000-0000-000000000001', 'короткий черновик',
            to_jsonb(repeat('мысль ', 12000)));
    RAISE EXCEPTION 'FAIL: oversized pinned_thoughts were accepted';
  EXCEPTION WHEN check_violation THEN NULL;  -- expected
  END;
END $$;

RESET role;
RESET request.jwt.claims;

-- ------------------------------------------------------------
-- BETA-5 (SYNC-10): Consistency invariant: current_version = max(version)
--
-- Оговорка о силе этой проверки. Здесь не исполняется ни строчки кода
-- приложения: строки вставлены руками этим же файлом. Значит проверка ловит
-- ровно одно — что сами данные для проверок непротиворечивы. Регрессию в
-- продукте она поймать не может по устройству. Настоящие два места, где этот
-- инвариант меряется на данных, написанных приложением, — обход базы в
-- `npm run postulates` (там он идёт по живой базе) и харнесс жизненного цикла.
-- Every active document in Postgres must have its current_version aligned
-- with the maximum version number in versions table.
-- ------------------------------------------------------------
DO $$
DECLARE
  drift_count int;
BEGIN
  SELECT count(*) INTO drift_count
    FROM public.documents d
    JOIN (
      SELECT document_uuid, MAX(version) AS max_v
      FROM public.versions
      GROUP BY document_uuid
    ) sub ON d.uuid = sub.document_uuid
   WHERE d.deleted_at IS NULL
     AND d.current_version <> sub.max_v;

  IF drift_count > 0 THEN
    RAISE EXCEPTION 'FAIL: documents found where current_version does not equal max(version): %', drift_count;
  END IF;
END $$;

-- ------------------------------------------------------------
-- S-11: ai_bulk_cooldown cascade delete on user deletion
-- ------------------------------------------------------------
DO $$
DECLARE
  test_uid uuid := '00000000-0000-0000-0000-000000000099';
  remaining_cooldown int;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (test_uid, 'cascade_test@test.com')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.users (uid, email, nickname) VALUES (test_uid, 'cascade_test@test.com', 'Cascade')
  ON CONFLICT (uid) DO NOTHING;

  INSERT INTO public.ai_bulk_cooldown (uid, endpoint, window_start, calls)
  VALUES (test_uid, 'chat', now(), 1)
  ON CONFLICT (uid, endpoint) DO UPDATE SET calls = 1;

  DELETE FROM public.users WHERE uid = test_uid;

  SELECT count(*) INTO remaining_cooldown
    FROM public.ai_bulk_cooldown
   WHERE uid = test_uid;

  IF remaining_cooldown > 0 THEN
    RAISE EXCEPTION 'FAIL: ai_bulk_cooldown row survived user deletion (count: %)', remaining_cooldown;
  END IF;

  DELETE FROM auth.users WHERE id = test_uid;
END $$;

-- ------------------------------------------------------------
-- SYNC-CURSOR-1: documents.updated_at trigger and backfill tests
-- ------------------------------------------------------------

-- 1. Owner updates document title: updated_at advances, created_at does not.
-- Also verifies client-supplied updated_at cannot override database now().
DO $$
DECLARE
  owner_uid uuid := '00000000-0000-0000-0000-000000000001';
  initial_created timestamptz;
  initial_updated timestamptz;
  new_updated timestamptz;
  new_created timestamptz;
BEGIN
  INSERT INTO public.documents (uuid, user_id, title, created_at, updated_at)
  VALUES ('cursor-test-doc-1', owner_uid, 'Original Title', now() - interval '1 hour', now() - interval '1 hour')
  ON CONFLICT (uuid) DO UPDATE SET title = 'Original Title', created_at = now() - interval '1 hour', updated_at = now() - interval '1 hour';

  SELECT created_at, updated_at INTO initial_created, initial_updated
    FROM public.documents WHERE uuid = 'cursor-test-doc-1';

  -- Impersonate owner
  SET LOCAL role = 'authenticated';
  SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001"}';

  -- Update title, and attempt to spoof client updated_at
  UPDATE public.documents
     SET title = 'Updated Title', updated_at = '1999-01-01 00:00:00+00'
   WHERE uuid = 'cursor-test-doc-1';

  RESET role;
  RESET request.jwt.claims;

  SELECT created_at, updated_at INTO new_created, new_updated
    FROM public.documents WHERE uuid = 'cursor-test-doc-1';

  IF new_created <> initial_created THEN
    RAISE EXCEPTION 'FAIL: SYNC-CURSOR-1: created_at changed upon update (% vs %)', new_created, initial_created;
  END IF;

  IF new_updated <= initial_updated THEN
    RAISE EXCEPTION 'FAIL: SYNC-CURSOR-1: updated_at did not advance upon update (% <= %)', new_updated, initial_updated;
  END IF;

  IF new_updated = '1999-01-01 00:00:00+00'::timestamptz THEN
    RAISE EXCEPTION 'FAIL: SYNC-CURSOR-1: trigger allowed client-supplied updated_at';
  END IF;

  DELETE FROM public.documents WHERE uuid = 'cursor-test-doc-1';
END $$;

-- 2. Non-owner updates document: write rejected by RLS, no column changes, trigger does not fire.
DO $$
DECLARE
  bob_uid uuid := '00000000-0000-0000-0000-000000000002';
  affected int;
  initial_created timestamptz;
  initial_updated timestamptz;
  cur_created timestamptz;
  cur_updated timestamptz;
BEGIN
  INSERT INTO public.documents (uuid, user_id, title, created_at, updated_at)
  VALUES ('cursor-test-doc-2', bob_uid, 'Bob Doc', now() - interval '1 hour', now() - interval '1 hour')
  ON CONFLICT (uuid) DO UPDATE SET title = 'Bob Doc', created_at = now() - interval '1 hour', updated_at = now() - interval '1 hour';

  SELECT created_at, updated_at INTO initial_created, initial_updated
    FROM public.documents WHERE uuid = 'cursor-test-doc-2';

  -- Impersonate Alice (non-owner)
  SET LOCAL role = 'authenticated';
  SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001"}';

  UPDATE public.documents SET title = 'Alice Hack'
   WHERE uuid = 'cursor-test-doc-2';
  GET DIAGNOSTICS affected = ROW_COUNT;

  RESET role;
  RESET request.jwt.claims;

  IF affected > 0 THEN
    RAISE EXCEPTION 'FAIL: SYNC-CURSOR-1: Alice updated Bob doc (% rows)', affected;
  END IF;

  SELECT created_at, updated_at INTO cur_created, cur_updated
    FROM public.documents WHERE uuid = 'cursor-test-doc-2';

  IF cur_created <> initial_created OR cur_updated <> initial_updated THEN
    RAISE EXCEPTION 'FAIL: SYNC-CURSOR-1: timestamps modified on rejected write';
  END IF;

  DELETE FROM public.documents WHERE uuid = 'cursor-test-doc-2';
END $$;

-- 3. Backfill assertion: pre-migration row (updated_at = created_at after backfill)
DO $$
DECLARE
  past_time timestamptz := '2025-05-01 12:00:00+00';
  owner_uid uuid := '00000000-0000-0000-0000-000000000001';
  rec record;
BEGIN
  INSERT INTO public.documents (uuid, user_id, title, created_at, updated_at)
  VALUES ('cursor-test-doc-backfill', owner_uid, 'Old Doc', past_time, now())
  ON CONFLICT (uuid) DO UPDATE SET created_at = past_time, updated_at = now();

  -- Run backfill update matching 0028_documents_updated_at.sql. By the time
  -- this test runs, 0028's own trigger already exists and would overwrite
  -- this UPDATE's SET clause back to now() (that is its whole job) — disable
  -- it for this one statement to actually simulate the pre-trigger backfill,
  -- the same way the real migration's backfill ran before the trigger existed.
  ALTER TABLE public.documents DISABLE TRIGGER tr_documents_updated_at;
  UPDATE public.documents
     SET updated_at = coalesce(created_at, now())
   WHERE uuid = 'cursor-test-doc-backfill';
  ALTER TABLE public.documents ENABLE TRIGGER tr_documents_updated_at;

  SELECT created_at, updated_at INTO rec
    FROM public.documents WHERE uuid = 'cursor-test-doc-backfill';

  IF rec.updated_at <> rec.created_at THEN
    RAISE EXCEPTION 'FAIL: SYNC-CURSOR-1 backfill: updated_at (%) != created_at (%)', rec.updated_at, rec.created_at;
  END IF;

  DELETE FROM public.documents WHERE uuid = 'cursor-test-doc-backfill';
END $$;

-- ============================================================
-- RLS-TEST-1: drafts: Alice cannot insert draft as another user
-- ============================================================
SET request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001"}';
SET role = 'authenticated';

DO $$
DECLARE ok boolean;
BEGIN
  BEGIN
    -- Charlie has no draft seeded, so RLS rejection is tested without PK unique_violation
    INSERT INTO public.drafts (user_id, content)
    VALUES ('00000000-0000-0000-0000-000000000003', 'hacked draft');
    ok := false;
  EXCEPTION
    WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL: RLS-TEST-1: Alice inserted draft as another user';
  END IF;
END $$;

-- ============================================================
-- RLS-TEST-1: drafts: Alice cannot delete Bob's draft
-- ============================================================
DO $$
DECLARE affected int;
BEGIN
  DELETE FROM public.drafts
   WHERE user_id = '00000000-0000-0000-0000-000000000002';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected > 0 THEN
    RAISE EXCEPTION 'FAIL: RLS-TEST-1: Alice deleted Bob''s draft (% rows)', affected;
  END IF;
END $$;

-- ============================================================
-- RLS-TEST-1: ai_summaries: Alice cannot update Bob's summaries
-- ============================================================
DO $$
DECLARE affected int;
BEGIN
  UPDATE public.ai_summaries
     SET tone = 'hacked'
   WHERE user_id = '00000000-0000-0000-0000-000000000002';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected > 0 THEN
    RAISE EXCEPTION 'FAIL: RLS-TEST-1: Alice updated Bob''s ai_summaries (% rows)', affected;
  END IF;
END $$;

-- ============================================================
-- RLS-TEST-1: ai_summaries: Alice cannot delete Bob's summaries
-- ============================================================
DO $$
DECLARE affected int;
BEGIN
  DELETE FROM public.ai_summaries
   WHERE user_id = '00000000-0000-0000-0000-000000000002';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected > 0 THEN
    RAISE EXCEPTION 'FAIL: RLS-TEST-1: Alice deleted Bob''s ai_summaries (% rows)', affected;
  END IF;
END $$;

-- ============================================================
-- RLS-TEST-1: ai_embeddings: Alice cannot update Bob's embeddings
-- ============================================================
DO $$
DECLARE affected int;
BEGIN
  UPDATE public.ai_embeddings
     SET model = 'hacked'
   WHERE user_id = '00000000-0000-0000-0000-000000000002';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected > 0 THEN
    RAISE EXCEPTION 'FAIL: RLS-TEST-1: Alice updated Bob''s ai_embeddings (% rows)', affected;
  END IF;
END $$;

-- ============================================================
-- RLS-TEST-1: ai_embeddings: Alice cannot delete Bob's embeddings
-- ============================================================
DO $$
DECLARE affected int;
BEGIN
  DELETE FROM public.ai_embeddings
   WHERE user_id = '00000000-0000-0000-0000-000000000002';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected > 0 THEN
    RAISE EXCEPTION 'FAIL: RLS-TEST-1: Alice deleted Bob''s ai_embeddings (% rows)', affected;
  END IF;
END $$;

-- ============================================================
-- RLS-TEST-1: telemetry_cooldown: deny-all table (select & insert)
-- ============================================================
RESET ROLE;
INSERT INTO public.telemetry_cooldown (uid, last_sent_at)
VALUES ('00000000-0000-0000-0000-000000000001', now())
ON CONFLICT (uid) DO UPDATE SET last_sent_at = now();
SET request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001"}';
SET role = 'authenticated';

DO $$
DECLARE cnt int;
BEGIN
  SELECT count(*) INTO cnt FROM public.telemetry_cooldown;
  IF cnt > 0 THEN
    RAISE EXCEPTION 'FAIL: RLS-TEST-1: Alice read telemetry_cooldown (% rows)', cnt;
  END IF;
END $$;

RESET ROLE;
DELETE FROM public.telemetry_cooldown WHERE uid = '00000000-0000-0000-0000-000000000001';
SET role = 'authenticated';

DO $$
DECLARE ok boolean;
BEGIN
  BEGIN
    INSERT INTO public.telemetry_cooldown (uid, last_sent_at)
    VALUES ('00000000-0000-0000-0000-000000000001', now());
    ok := false;
  EXCEPTION
    WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL: RLS-TEST-1: Alice inserted into telemetry_cooldown';
  END IF;
END $$;

-- ============================================================
-- RLS-TEST-1: ai_bulk_cooldown: deny-all table under authenticated (select & insert)
-- ============================================================
RESET ROLE;
INSERT INTO public.ai_bulk_cooldown (uid, endpoint, window_start, calls)
VALUES ('00000000-0000-0000-0000-000000000001', 'embed', now(), 1)
ON CONFLICT (uid, endpoint) DO UPDATE SET calls = 1;
SET request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001"}';
SET role = 'authenticated';

DO $$
DECLARE cnt int;
BEGIN
  SELECT count(*) INTO cnt FROM public.ai_bulk_cooldown;
  IF cnt > 0 THEN
    RAISE EXCEPTION 'FAIL: RLS-TEST-1: Alice read ai_bulk_cooldown (% rows)', cnt;
  END IF;
END $$;

DO $$
DECLARE ok boolean;
BEGIN
  BEGIN
    INSERT INTO public.ai_bulk_cooldown (uid, endpoint, window_start, calls)
    VALUES ('00000000-0000-0000-0000-000000000001', 'chat', now(), 1);
    ok := false;
  EXCEPTION
    WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL: RLS-TEST-1: Alice inserted into ai_bulk_cooldown';
  END IF;
END $$;

-- ============================================================
-- RLS-TEST-1: users: Alice cannot delete own or Bob's user profile (no delete policy)
-- ============================================================
DO $$
DECLARE affected int;
BEGIN
  DELETE FROM public.users
   WHERE uid = '00000000-0000-0000-0000-000000000001';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected > 0 THEN
    RAISE EXCEPTION 'FAIL: RLS-TEST-1: Alice deleted own profile (% rows)', affected;
  END IF;

  DELETE FROM public.users
   WHERE uid = '00000000-0000-0000-0000-000000000002';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected > 0 THEN
    RAISE EXCEPTION 'FAIL: RLS-TEST-1: Alice deleted Bob''s profile (% rows)', affected;
  END IF;
END $$;

-- Итоговое сообщение стоит последним не для красоты: до этой правки
-- «All RLS checks passed» печаталось на 709-й строке, а сто семьдесят восемь
-- строк проверок из TEST-1 шли после него. Набор при их провале падал (код 3),
-- но человек, читающий вывод, видел зелёную строку и переставал читать.
DO $$
BEGIN
  RAISE NOTICE 'All RLS checks passed.';
END $$;

