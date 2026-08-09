-- 0006_profile_on_signup.sql
--
-- Create the public.users row when someone registers.
--
-- Without this, a newly registered account cannot write anything at all.
-- documents, versions, drafts, ai_summaries, ai_embeddings and ai_daily_limit
-- all carry `user_id uuid references public.users(uid)`, so the very first save
-- fails with
--
--   23503  insert or update on table "documents" violates foreign key constraint
--          "documents_user_id_fkey"  —  Key is not present in table "users".
--
-- Firestore had no foreign keys and the client created the profile document
-- lazily, so nothing in the client ever needed to create it. Nothing does now
-- either, and the schema requires it to exist first.
--
-- A trigger rather than client code: it cannot be skipped by a sign-in path that
-- forgets to call it, it runs inside the same transaction as the signup, and it
-- works for accounts created through the admin API too.
--
-- `role` is deliberately left to its default of 'user'. The column is
-- server-controlled and a trigger in 0001 rejects any client attempt to change
-- it; admin is granted deliberately, never on registration.

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (uid, email)
  values (new.id, coalesce(new.email, ''))
  on conflict (uid) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Backfill anyone who registered before this trigger existed, so accounts made
-- in the gap are not permanently unable to save.
insert into public.users (uid, email)
select au.id, coalesce(au.email, '')
from auth.users au
left join public.users pu on pu.uid = au.id
where pu.uid is null;
