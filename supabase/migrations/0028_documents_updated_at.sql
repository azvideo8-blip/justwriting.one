-- supabase/migrations/0028_documents_updated_at.sql
-- SYNC-CURSOR-1: Maintain documents.updated_at via trigger for the multi-device change cursor.
--
-- Purely additive migration: adds updated_at with default now(), backfills existing rows to created_at,
-- and attaches a before-update trigger. Safe to run without a maintenance window.

-- 1. Add updated_at column
alter table public.documents
  add column if not exists updated_at timestamptz not null default now();

-- 2. Backfill existing rows to created_at (runs before trigger is attached)
update public.documents
  set updated_at = coalesce(created_at, now());

-- 3. Trigger function: always use database clock now(), ignore any client-supplied updated_at
create or replace function public.set_documents_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 4. Attach trigger on public.documents
drop trigger if exists tr_documents_updated_at on public.documents;

create trigger tr_documents_updated_at
  before update on public.documents
  for each row
  execute function public.set_documents_updated_at();

-- 5. Index for fast change cursor query: max(documents.updated_at) per user
create index if not exists idx_documents_user_updated
  on public.documents(user_id, updated_at desc);
