-- 0002_rls.sql — Row-Level Security policies ported from firestore.rules
-- Each policy comment references the Firestore rule line it derives from.

-- ============================================================
-- Helper: enable RLS on every table
-- ============================================================
alter table public.users               enable row level security;
alter table public.documents           enable row level security;
alter table public.versions            enable row level security;
alter table public.drafts              enable row level security;
alter table public.ai_summaries        enable row level security;
alter table public.ai_embeddings       enable row level security;
alter table public.ai_daily_limit      enable row level security;
alter table public.ai_cooldown         enable row level security;
alter table public.ai_usage            enable row level security;
alter table public.ai_global_daily     enable row level security;
alter table public.anonymized_telemetry enable row level security;
alter table public.connection_test     enable row level security;

-- ============================================================
-- users  (firestore.rules L116–129)
-- Read: own profile, or admin.  Create: own uid.  Update: own, diff-based.
-- ============================================================
create policy "users_select_own_or_admin"
  on public.users for select
  using (auth.uid() = uid or (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'admin');

create policy "users_insert_own"
  on public.users for insert
  with check (auth.uid() = uid);

create policy "users_update_own"
  on public.users for update
  using (auth.uid() = uid)
  with check (auth.uid() = uid);

-- No delete policy: Firestore rules don't allow user self-delete from client.

-- ============================================================
-- documents  (firestore.rules L202–206)
-- All operations: owner only.
-- ============================================================
create policy "documents_select_own"
  on public.documents for select
  using (user_id = auth.uid());

create policy "documents_insert_own"
  on public.documents for insert
  with check (user_id = auth.uid());

create policy "documents_update_own"
  on public.documents for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "documents_delete_own"
  on public.documents for delete
  using (user_id = auth.uid());

-- ============================================================
-- versions  (firestore.rules L208–213)
-- All operations: owner only.
-- ============================================================
create policy "versions_select_own"
  on public.versions for select
  using (user_id = auth.uid() and exists (select 1 from public.documents d where d.uuid = document_uuid and d.user_id = auth.uid()));

create policy "versions_insert_own"
  on public.versions for insert
  with check (user_id = auth.uid() and exists (select 1 from public.documents d where d.uuid = document_uuid and d.user_id = auth.uid()));

create policy "versions_update_own"
  on public.versions for update
  using (user_id = auth.uid() and exists (select 1 from public.documents d where d.uuid = document_uuid and d.user_id = auth.uid()))
  with check (user_id = auth.uid() and exists (select 1 from public.documents d where d.uuid = document_uuid and d.user_id = auth.uid()));

create policy "versions_delete_own"
  on public.versions for delete
  using (user_id = auth.uid() and exists (select 1 from public.documents d where d.uuid = document_uuid and d.user_id = auth.uid()));

-- ============================================================
-- drafts  (firestore.rules L137–145)
-- Owner only.  Audit finding: admin read removed — compromised admin claim
-- could read every user's draft.
-- ============================================================
create policy "drafts_select_own"
  on public.drafts for select
  using (user_id = auth.uid());

create policy "drafts_insert_own"
  on public.drafts for insert
  with check (user_id = auth.uid());

create policy "drafts_update_own"
  on public.drafts for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "drafts_delete_own"
  on public.drafts for delete
  using (user_id = auth.uid());

-- ============================================================
-- ai_summaries  (firestore.rules L291–295)
-- Owner only.
-- ============================================================
create policy "ai_summaries_select_own"
  on public.ai_summaries for select
  using (user_id = auth.uid() and exists (select 1 from public.documents d where d.uuid = document_id and d.user_id = auth.uid()));

create policy "ai_summaries_insert_own"
  on public.ai_summaries for insert
  with check (user_id = auth.uid() and exists (select 1 from public.documents d where d.uuid = document_id and d.user_id = auth.uid()));

create policy "ai_summaries_update_own"
  on public.ai_summaries for update
  using (user_id = auth.uid() and exists (select 1 from public.documents d where d.uuid = document_id and d.user_id = auth.uid()))
  with check (user_id = auth.uid() and exists (select 1 from public.documents d where d.uuid = document_id and d.user_id = auth.uid()));

create policy "ai_summaries_delete_own"
  on public.ai_summaries for delete
  using (user_id = auth.uid() and exists (select 1 from public.documents d where d.uuid = document_id and d.user_id = auth.uid()));

-- ============================================================
-- ai_embeddings  (firestore.rules L297–301)
-- Owner only.
-- ============================================================
create policy "ai_embeddings_select_own"
  on public.ai_embeddings for select
  using (user_id = auth.uid() and exists (select 1 from public.documents d where d.uuid = document_id and d.user_id = auth.uid()));

create policy "ai_embeddings_insert_own"
  on public.ai_embeddings for insert
  with check (user_id = auth.uid() and exists (select 1 from public.documents d where d.uuid = document_id and d.user_id = auth.uid()));

create policy "ai_embeddings_update_own"
  on public.ai_embeddings for update
  using (user_id = auth.uid() and exists (select 1 from public.documents d where d.uuid = document_id and d.user_id = auth.uid()))
  with check (user_id = auth.uid() and exists (select 1 from public.documents d where d.uuid = document_id and d.user_id = auth.uid()));

create policy "ai_embeddings_delete_own"
  on public.ai_embeddings for delete
  using (user_id = auth.uid() and exists (select 1 from public.documents d where d.uuid = document_id and d.user_id = auth.uid()));

-- ============================================================
-- ai_daily_limit  (firestore.rules L304–306)
-- Admin SDK only: no client read/write.
-- ============================================================
create policy "ai_daily_limit_deny_all"
  on public.ai_daily_limit for all
  using (false)
  with check (false);

-- ============================================================
-- ai_cooldown  (firestore.rules L308–310)
-- Admin SDK only: no client read/write.
-- ============================================================
create policy "ai_cooldown_deny_all"
  on public.ai_cooldown for all
  using (false)
  with check (false);

-- ============================================================
-- ai_usage  (firestore.rules L313–316)
-- Client can read own usage; admin SDK writes only.
-- ============================================================
create policy "ai_usage_select_own"
  on public.ai_usage for select
  using (uid = auth.uid());

create policy "ai_usage_deny_write"
  on public.ai_usage for insert
  with check (false);

create policy "ai_usage_deny_update"
  on public.ai_usage for update
  using (false)
  with check (false);

create policy "ai_usage_deny_delete"
  on public.ai_usage for delete
  using (false);

-- ============================================================
-- ai_global_daily  (firestore.rules L319–321)
-- Admin SDK only: no client read/write.
-- ============================================================
create policy "ai_global_daily_deny_all"
  on public.ai_global_daily for all
  using (false)
  with check (false);

-- ============================================================
-- anonymized_telemetry  (firestore.rules L325–328)
-- Admin read; no client create/update/delete.
-- ============================================================
create policy "telemetry_select_admin"
  on public.anonymized_telemetry for select
  using ((current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'admin');

create policy "telemetry_deny_write"
  on public.anonymized_telemetry for insert
  with check (false);

create policy "telemetry_deny_update"
  on public.anonymized_telemetry for update
  using (false)
  with check (false);

create policy "telemetry_deny_delete"
  on public.anonymized_telemetry for delete
  using (false);

-- ============================================================
-- connection_test  (firestore.rules L132–134)
-- Read-only for authenticated users.
-- ============================================================
create policy "connection_test_select_auth"
  on public.connection_test for select
  using (auth.role() = 'authenticated');

create policy "connection_test_deny_write"
  on public.connection_test for insert
  with check (false);

create policy "connection_test_deny_update"
  on public.connection_test for update
  using (false)
  with check (false);

create policy "connection_test_deny_delete"
  on public.connection_test for delete
  using (false);
