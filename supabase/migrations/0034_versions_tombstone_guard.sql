-- 0034_versions_tombstone_guard.sql
--
-- L-3 (R4-001): a version could be written to the cloud under a tombstone.
-- versions_insert_own / versions_update_own required only that the document
-- belong to the caller; deleted_at was not checked. A queued delete that
-- raced a running version upload (another tab, lock timeout) left the note
-- text in the cloud under a tombstone. The guard is server-side and does not
-- depend on client locks or tabs.
--
-- R4-034: server-only tables have deny-all policies, but the default grants
-- to authenticated/anon remained — revoked, so the deny is total.

drop policy if exists "versions_insert_own" on public.versions;
drop policy if exists "versions_update_own" on public.versions;

create policy "versions_insert_own"
  on public.versions for insert
  with check (user_id = auth.uid() and exists (
    select 1 from public.documents d
    where d.uuid = document_uuid and d.user_id = auth.uid() and d.deleted_at is null));

create policy "versions_update_own"
  on public.versions for update
  using (user_id = auth.uid() and exists (
    select 1 from public.documents d
    where d.uuid = document_uuid and d.user_id = auth.uid() and d.deleted_at is null))
  with check (user_id = auth.uid() and exists (
    select 1 from public.documents d
    where d.uuid = document_uuid and d.user_id = auth.uid() and d.deleted_at is null));

revoke all on public.applied_migrations from authenticated, anon;
revoke all on public.ai_global_daily from authenticated, anon;
revoke all on public.ai_cooldown from authenticated, anon;
revoke all on public.telemetry_cooldown from authenticated, anon;
