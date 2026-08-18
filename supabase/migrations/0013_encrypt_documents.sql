-- Migration 0013_encrypt_documents.sql
-- Allow encrypted ciphertexts for title and mood, and add _encrypted column to documents table

alter table public.documents add column if not exists _encrypted boolean not null default false;

-- Drop previous 200/50 char constraints if they exist and replace with 2000 char constraints
do $$
declare
  r record;
begin
  for r in (
    select conname
    from pg_constraint
    where conrelid = 'public.documents'::regclass
      and contype = 'c'
      and (conname like '%title%' or conname like '%mood%')
  ) loop
    execute format('alter table public.documents drop constraint if exists %I', r.conname);
  end loop;
end $$;

alter table public.documents add constraint documents_title_check check (length(title) <= 2000);
alter table public.documents add constraint documents_mood_check check (mood is null or length(mood) <= 2000);
