-- 0025_admin_portrait_isolation.sql
-- DEEP-5: Isolate psychological portrait and encryption material from admin queries.
-- An admin querying users for operational administration queries public.admin_users_view.
-- public.users select policy allows users to select only their own row (auth.uid() = uid),
-- so that no admin token can directly dump another user's unencrypted ai_portrait.

drop policy if exists "users_select_own_or_admin" on public.users;
drop policy if exists "users_select_own" on public.users;

create policy "users_select_own"
  on public.users for select
  using (auth.uid() = uid);

create or replace view public.admin_users_view
with (security_barrier = true)
as
select
  uid,
  email,
  nickname,
  role,
  created_at,
  _encrypted,
  labels,
  earned_achievements,
  total_word_count,
  sessions_count,
  streak_days,
  total_duration,
  avg_wpm,
  avg_session_words,
  privacy_accepted_at,
  privacy_version,
  ai_consent_at,
  ai_consent_version,
  indexing_consent_at,
  indexing_consent_version
from public.users
where public.is_admin();

revoke all on public.admin_users_view from public, anon;
grant select on public.admin_users_view to authenticated;
