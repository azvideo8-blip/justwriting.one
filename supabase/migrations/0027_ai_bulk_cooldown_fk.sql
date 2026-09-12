-- supabase/migrations/0027_ai_bulk_cooldown_fk.sql
-- S-11: Cascade delete on ai_bulk_cooldown when user is deleted

-- 1. Delete orphan rows
delete from public.ai_bulk_cooldown
  where uid not in (select uid::text from public.users);

-- 2. Alter column to uuid to match public.users(uid)
alter table public.ai_bulk_cooldown
  alter column uid type uuid using uid::uuid;

-- 3. Add foreign key with cascade delete
alter table public.ai_bulk_cooldown
  add constraint ai_bulk_cooldown_uid_fkey
  foreign key (uid) references public.users(uid)
  on delete cascade;
