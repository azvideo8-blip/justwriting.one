-- 0009_users_insert_role.sql — Restrict self-service user creation to role='user' or default.
-- Prevents clients from inserting rows with role='admin' to escalate privileges.

drop policy if exists "users_insert_own" on public.users;
create policy "users_insert_own"
  on public.users for insert
  with check (auth.uid() = uid and (role is null or role = 'user'));
