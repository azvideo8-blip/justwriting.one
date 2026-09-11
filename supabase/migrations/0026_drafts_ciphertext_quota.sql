-- Migration 0026_drafts_ciphertext_quota.sql
-- Allow encrypted ciphertexts for drafts.title (up to 2,000 chars) and drafts.content (up to 1,000,000 chars).
-- Matches documents.title (0013_encrypt_documents.sql) and accommodates AES-GCM ciphertext expansion for Cyrillic text.

do $$
declare
  r record;
begin
  for r in (
    select conname
    from pg_constraint
    where conrelid = 'public.drafts'::regclass
      and contype = 'c'
      and (conname like '%title%' or conname like '%content%')
  ) loop
    execute format('alter table public.drafts drop constraint if exists %I', r.conname);
  end loop;
end $$;

alter table public.drafts add constraint drafts_title_check check (title is null or length(title) <= 2000);
alter table public.drafts add constraint drafts_content_check check (length(content) <= 1000000);
