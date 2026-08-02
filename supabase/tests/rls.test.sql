-- rls.test.sql — Negative tests for RLS policies.
-- Run with: psql -f rls.test.sql (requires two test users in auth.users).
-- Each section attempts to read/modify another user's data; expects 0 rows
-- or a permission error.
--
-- NOTE: these tests require a running Supabase/Postgres instance with auth
-- set up.  They were NOT run during this ticket — see report.

-- ============================================================
-- Setup: two test users.  Replace UUIDs with actual auth.users ids.
-- ============================================================
-- INSERT INTO auth.users (id, email) VALUES
--   ('00000000-0000-0000-0000-000000000001', 'alice@test.com'),
--   ('00000000-0000-0000-0000-000000000002', 'bob@test.com');

-- ============================================================
-- Helper: set the JWT to impersonate a user.
-- ============================================================
-- SET request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001"}';
-- SET role = 'authenticated';

-- ============================================================
-- users: Alice cannot read Bob's profile (non-admin)
-- ============================================================
-- SELECT * FROM public.users WHERE uid = '00000000-0000-0000-0000-000000000002';
-- Expected: 0 rows

-- ============================================================
-- users: Alice cannot update Bob's profile
-- ============================================================
-- UPDATE public.users SET nickname = 'hacked' WHERE uid = '00000000-0000-0000-0000-000000000002';
-- Expected: 0 rows affected

-- ============================================================
-- documents: Alice cannot read Bob's documents
-- ============================================================
-- SELECT * FROM public.documents WHERE user_id = '00000000-0000-0000-0000-000000000002';
-- Expected: 0 rows

-- ============================================================
-- documents: Alice cannot insert a document for Bob
-- ============================================================
-- INSERT INTO public.documents (uuid, user_id, title) VALUES ('test-uuid', '00000000-0000-0000-0000-000000000002', 'stolen');
-- Expected: permission denied or 0 rows

-- ============================================================
-- documents: Alice cannot update Bob's document
-- ============================================================
-- UPDATE public.documents SET title = 'hacked' WHERE user_id = '00000000-0000-0000-0000-000000000002';
-- Expected: 0 rows affected

-- ============================================================
-- documents: Alice cannot delete Bob's document
-- ============================================================
-- DELETE FROM public.documents WHERE user_id = '00000000-0000-0000-0000-000000000002';
-- Expected: 0 rows affected

-- ============================================================
-- versions: Alice cannot read Bob's versions
-- ============================================================
-- SELECT * FROM public.versions WHERE user_id = '00000000-0000-0000-0000-000000000002';
-- Expected: 0 rows

-- ============================================================
-- versions: Alice cannot insert a version for Bob
-- ============================================================
-- INSERT INTO public.versions (document_uuid, user_id, version, content, word_count)
--   VALUES ('bob-doc-uuid', '00000000-0000-0000-0000-000000000002', 1, 'stolen', 1);
-- Expected: permission denied

-- ============================================================
-- versions: Alice cannot update Bob's version
-- ============================================================
-- UPDATE public.versions SET content = 'hacked' WHERE user_id = '00000000-0000-0000-0000-000000000002';
-- Expected: 0 rows affected

-- ============================================================
-- versions: Alice cannot delete Bob's version
-- ============================================================
-- DELETE FROM public.versions WHERE user_id = '00000000-0000-0000-0000-000000000002';
-- Expected: 0 rows affected

-- ============================================================
-- drafts: Alice cannot read Bob's draft
-- ============================================================
-- SELECT * FROM public.drafts WHERE user_id = '00000000-0000-0000-0000-000000000002';
-- Expected: 0 rows

-- ============================================================
-- drafts: Alice cannot update Bob's draft
-- ============================================================
-- UPDATE public.drafts SET content = 'hacked' WHERE user_id = '00000000-0000-0000-0000-000000000002';
-- Expected: 0 rows affected

-- ============================================================
-- ai_summaries: Alice cannot read Bob's summaries
-- ============================================================
-- SELECT * FROM public.ai_summaries WHERE user_id = '00000000-0000-0000-0000-000000000002';
-- Expected: 0 rows

-- ============================================================
-- ai_summaries: Alice cannot insert for Bob
-- ============================================================
-- INSERT INTO public.ai_summaries (document_id, user_id) VALUES ('x', '00000000-0000-0000-0000-000000000002');
-- Expected: permission denied

-- ============================================================
-- ai_embeddings: Alice cannot read Bob's embeddings
-- ============================================================
-- SELECT * FROM public.ai_embeddings WHERE user_id = '00000000-0000-0000-0000-000000000002';
-- Expected: 0 rows

-- ============================================================
-- ai_embeddings: Alice cannot insert for Bob
-- ============================================================
-- INSERT INTO public.ai_embeddings (document_id, user_id) VALUES ('x', '00000000-0000-0000-0000-000000000002');
-- Expected: permission denied

-- ============================================================
-- ai_daily_limit: no client access at all
-- ============================================================
-- SELECT * FROM public.ai_daily_limit;
-- Expected: 0 rows (deny_all)

-- ============================================================
-- ai_cooldown: no client access at all
-- ============================================================
-- SELECT * FROM public.ai_cooldown;
-- Expected: 0 rows (deny_all)

-- ============================================================
-- ai_usage: Alice can read own, cannot read Bob's
-- ============================================================
-- SELECT * FROM public.ai_usage WHERE uid = '00000000-0000-0000-0000-000000000002';
-- Expected: 0 rows

-- ============================================================
-- ai_usage: Alice cannot write
-- ============================================================
-- INSERT INTO public.ai_usage (uid, date, data) VALUES ('00000000-0000-0000-0000-000000000001', '2026-01-01', '{}');
-- Expected: permission denied

-- ============================================================
-- ai_global_daily: no client access at all
-- ============================================================
-- SELECT * FROM public.ai_global_daily;
-- Expected: 0 rows

-- ============================================================
-- anonymized_telemetry: client cannot read (admin only)
-- ============================================================
-- SELECT * FROM public.anonymized_telemetry;
-- Expected: 0 rows

-- ============================================================
-- anonymized_telemetry: client cannot insert
-- ============================================================
-- INSERT INTO public.anonymized_telemetry (id, data) VALUES ('x', '{}');
-- Expected: permission denied

-- ============================================================
-- connection_test: authenticated can read
-- ============================================================
-- SELECT * FROM public.connection_test;
-- Expected: rows (if seeded)

-- ============================================================
-- connection_test: client cannot write
-- ============================================================
-- INSERT INTO public.connection_test (id) VALUES ('evil');
-- Expected: permission denied
