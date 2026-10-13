-- 0041_mobile_layout_access.sql
-- Право на мобильный макет: админ и служебные аккаунты.
--
-- Мобильный макет выключен для всех с 2026-09-22 (D-15, `MOBILE_LAYOUT_ENABLED =
-- false`): телефон получал десктопную рейку. Решение владельца от 2026-10-12 —
-- открывать макет не всем сразу, а по аккаунту: админу (владелец) и служебному
-- аккаунту, под которым ревьюер, Fable и Qoder проверяют прод. Остальные сидят на
-- десктопе, пока владелец не скажет иначе.
--
-- Из браузера аккаунт не разобрать: `public.service_accounts` (0040) — deny-all для
-- authenticated/anon, читает только сервер своим пуловым соединением. Поэтому ответ
-- даёт функция от имени владельца таблицы: наружу выходит ровно boolean для
-- собственного uid вызывающего, ни одной строки из базы не уезжает.
--
-- Прод миграцию применяет ревьюер руками при выкатке (как 0040).

create or replace function public.mobile_layout_allowed()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    where u.uid = (select auth.uid())
      and u.role = 'admin'
  )
  or exists (
    select 1
    from public.service_accounts s
    where s.uid = (select auth.uid())
  );
$$;

revoke all on function public.mobile_layout_allowed() from public, anon;
grant execute on function public.mobile_layout_allowed() to authenticated;
