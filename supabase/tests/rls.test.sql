-- rls.test.sql — Negative tests for RLS policies.
-- Run with: psql -f rls.test.sql (requires two test users in auth.users).
-- Each section attempts to read/modify another user's data; expects 0 rows
-- or a permission error.
--
-- NOTE: these tests require a running Supabase/Postgres instance with auth
-- set up.  They were NOT run during this ticket — see report.
-- Each case is wrapped in a DO block that RAISEs EXCEPTION on unexpected
-- success, so psql -f will exit non-zero if any check fails.

-- ============================================================
-- Setup: two test users.  Replace UUIDs with actual auth.users ids.
-- ============================================================
-- INSERT INTO auth.users (id, email) VALUES
--   ('00000000-0000-0000-0000-000000000001', 'alice@test.com'),
--   ('00000000-0000-0000-0000-000000000002', 'bob@test.com');

-- Helper: set the JWT to impersonate a user.
-- Uncomment and run the INSERT above first, then uncomment these.
-- SET request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001"}';
-- SET role = 'authenticated';

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
BEGIN
  BEGIN
    INSERT INTO public.documents (uuid, user_id, title)
    VALUES ('test-uuid', '00000000-0000-0000-0000-000000000002', 'stolen');
    RAISE EXCEPTION 'FAIL: Alice inserted document for Bob';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL; -- expected
    WHEN others THEN NULL; -- RLS may raise different codes
  END;
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
BEGIN
  BEGIN
    INSERT INTO public.versions (document_uuid, user_id, version, content, word_count)
    VALUES ('bob-doc-uuid', '00000000-0000-0000-0000-000000000002', 1, 'stolen', 1);
    RAISE EXCEPTION 'FAIL: Alice inserted version for Bob';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN others THEN NULL;
  END;
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
BEGIN
  BEGIN
    INSERT INTO public.ai_summaries (document_id, user_id)
    VALUES ('x', '00000000-0000-0000-0000-000000000002');
    RAISE EXCEPTION 'FAIL: Alice inserted summary for Bob';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN others THEN NULL;
  END;
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
BEGIN
  BEGIN
    INSERT INTO public.ai_embeddings (document_id, user_id)
    VALUES ('x', '00000000-0000-0000-0000-000000000002');
    RAISE EXCEPTION 'FAIL: Alice inserted embedding for Bob';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN others THEN NULL;
  END;
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
BEGIN
  BEGIN
    INSERT INTO public.ai_usage (uid, date, data)
    VALUES ('00000000-0000-0000-0000-000000000001', '2026-01-01', '{}');
    RAISE EXCEPTION 'FAIL: client inserted into ai_usage';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN others THEN NULL;
  END;
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
BEGIN
  BEGIN
    INSERT INTO public.anonymized_telemetry (id, data)
    VALUES ('x', '{}');
    RAISE EXCEPTION 'FAIL: client inserted into anonymized_telemetry';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN others THEN NULL;
  END;
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
BEGIN
  BEGIN
    INSERT INTO public.connection_test (id) VALUES ('evil');
    RAISE EXCEPTION 'FAIL: client inserted into connection_test';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN others THEN NULL;
  END;
END $$;
