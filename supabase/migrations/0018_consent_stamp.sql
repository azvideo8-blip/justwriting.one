-- 0018_consent_stamp.sql
-- The client can write ai_consent_at with any value, including backdated ones.
-- The server stamps when the consent actually changed. Open question for the
-- lawyer: is a server stamp sufficient for the audit trail, or does consent
-- need an append-only log table? Do not ship the answer as an assumption.
alter table public.users
  add column if not exists ai_consent_server_at timestamptz;

create or replace function public.stamp_consent()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.ai_consent_at is distinct from old.ai_consent_at
     or new.ai_consent_version is distinct from old.ai_consent_version
     or new.indexing_consent_at is distinct from old.indexing_consent_at then
    new.ai_consent_server_at := now();
  end if;
  return new;
end $$;

create trigger users_consent_stamp
before update on public.users
for each row execute function public.stamp_consent();

-- Postgres fires `before` row triggers in name order: stamp_consent sorts
-- before protect_user_columns (0015). Harmless — they touch disjoint columns.
-- Verified by the RLS suite rather than assumed.

alter table public.users
  add constraint users_ai_consent_version_check
  check (ai_consent_version is null or ai_consent_version > 0);

alter table public.users
  add constraint users_indexing_consent_version_check
  check (indexing_consent_version is null or indexing_consent_version > 0);
