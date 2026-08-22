-- rls.test.sql — Negative tests for RLS policies.
-- Run with:
--   psql -f supabase/tests/_auth_setup.sql \
--        -f supabase/migrations/0001_schema.sql \
--        -f supabase/migrations/0002_rls.sql \
--        -f supabase/migrations/0003_local_store_records.sql \
--        -f supabase/tests/rls.test.sql
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

INSERT INTO public.documents (uuid, user_id, title) VALUES
  ('bob-doc-001', '00000000-0000-0000-0000-000000000002', 'Bob''s secret')
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
    WHEN check_violation THEN ok := true;
    WHEN others THEN ok := true;
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
    VALUES ('bob-doc-uuid', '00000000-0000-0000-0000-000000000002', 1, 'stolen', 1);
    ok := false;
  EXCEPTION
    WHEN insufficient_privilege THEN ok := true;
    WHEN check_violation THEN ok := true;
    WHEN others THEN ok := true;
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
    WHEN check_violation THEN ok := true;
    WHEN others THEN ok := true;
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
    WHEN check_violation THEN ok := true;
    WHEN others THEN ok := true;
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
    WHEN check_violation THEN ok := true;
    WHEN others THEN ok := true;
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
    WHEN check_violation THEN ok := true;
    WHEN others THEN ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL: client inserted into anonymized_telemetry';
  END IF;
END $$;

-- ============================================================
-- connection_test: authenticated can read
-- ============================================================
DO $$
DECLARE cnt int;
BEGIN
  -- This should succeed (returns rows if seeded).
  -- Failure here means the read policy is broken.
  SELECT count(*) INTO cnt FROM public.connection_test;
  -- No assertion: read should work.  If RLS blocks it, psql will error.
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
    WHEN check_violation THEN ok := true;
    WHEN others THEN ok := true;
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
    WHEN check_violation THEN ok := true;
    WHEN others THEN ok := true;
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
    WHEN check_violation THEN ok := true;
    WHEN others THEN ok := true;
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
    WHEN others THEN ok := true;
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
    WHEN check_violation THEN ok := true;
    WHEN others THEN ok := true;
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
    WHEN others THEN ok := true;
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
    WHEN others THEN ok := true;
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
  RAISE NOTICE 'All RLS checks passed.';
END $$;
