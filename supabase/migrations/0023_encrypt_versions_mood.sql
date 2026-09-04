-- Migration 0023_encrypt_versions_mood.sql
-- Allow encrypted ciphertexts for mood in versions table (AG-ENC-1)

-- Drop previous 50 char constraint if it exists and replace with 2000 char constraint
do $$
declare
  r record;
begin
  for r in (
    select conname
    from pg_constraint
    where conrelid = 'public.versions'::regclass
      and contype = 'c'
      and conname like '%mood%'
  ) loop
    execute format('alter table public.versions drop constraint if exists %I', r.conname);
  end loop;
end $$;

alter table public.versions add constraint versions_mood_check check (mood is null or length(mood) <= 2000);
