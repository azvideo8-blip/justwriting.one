-- supabase/migrations/0030_document_trashed_at.sql
-- FEAT-5: Delayed deletion with 10-day recovery window (Trash / Корзина).
-- Adds trashed_at column to public.documents and index.

-- 1. Add trashed_at column
alter table public.documents
  add column if not exists trashed_at timestamptz default null;

-- 2. Index for filtering active vs trashed documents
create index if not exists idx_documents_user_trashed
  on public.documents(user_id, trashed_at);
