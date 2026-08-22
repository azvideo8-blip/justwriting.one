-- 0017_admin_rls_lookup.sql
-- Admin = a row in public.users with role='admin'. SECURITY DEFINER is required
-- so the function does not recurse when used inside a policy on public.users:
-- it runs as the table owner, and RLS does not apply to the owner.
-- Verified 2026-08-22: no table in this schema uses FORCE ROW LEVEL SECURITY,
-- so the owner bypass holds. If FORCE RLS is ever added, revisit this.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.users u
    where u.uid = (select auth.uid())
      and u.role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

drop policy if exists "users_select_own_or_admin" on public.users;
create policy "users_select_own_or_admin"
  on public.users for select
  using (auth.uid() = uid or public.is_admin());

drop policy if exists "telemetry_select_admin" on public.anonymized_telemetry;
create policy "telemetry_select_admin"
  on public.anonymized_telemetry for select
  using (public.is_admin());
