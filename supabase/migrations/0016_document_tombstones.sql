-- 0016_document_tombstones.sql
--
-- AG-SYNC-5: Soft-delete / tombstones for documents.
-- 1. Add deleted_at column to public.documents.
-- 2. Index for filtering active vs deleted documents.
-- 3. RLS policy update: UPDATE on documents requires deleted_at is null,
--    preventing mutation of tombstones and preventing unsetting deleted_at.

alter table public.documents
  add column if not exists deleted_at timestamptz default null;

create index if not exists idx_documents_user_deleted
  on public.documents(user_id, deleted_at);

-- RLS: Only non-deleted documents can be updated by the client.
-- Once deleted_at is set, the row becomes immutable from the client.
drop policy if exists "documents_update_own" on public.documents;

create policy "documents_update_own"
  on public.documents for update
  using (user_id = auth.uid() and deleted_at is null)
  with check (user_id = auth.uid());
