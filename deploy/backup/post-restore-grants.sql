-- Права, которые миграции выставляют явно. Восстановление идёт с
-- --no-privileges (RESTORE.md): гранты приложения возвращает ALTER DEFAULT
-- PRIVILEGES образа Supabase — и вместе с ними возвращает то, что миграции
-- отозвали. Drill 2026-10-01 покраснел ровно на этом: после восстановления
-- anon/authenticated снова получили все права на четыре служебные таблицы
-- (0034), а функции из 0017/0020/0033 — EXECUTE для PUBLIC.
--
-- Применять сразу после pg_restore, от supabase_admin (владельца объектов
-- после --no-owner). Список держит scripts/__tests__/postRestoreGrants.test.ts:
-- каждый grant/revoke из supabase/migrations обязан быть здесь.

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;
revoke all on function public.increment_document_sessions(text, integer) from public, anon;
grant execute on function public.increment_document_sessions(text, integer) to authenticated;
-- 0039 (V-5): счётчики сессий. Без этих строк восстановление возвращает EXECUTE
-- для PUBLIC, и чужой rpc считает чужие заметки.
revoke all on function public.sync_document_stats(text, bigint, bigint) from public, anon;
grant execute on function public.sync_document_stats(text, bigint, bigint) to authenticated;
revoke all on public.admin_users_view from public, anon;
grant select on public.admin_users_view to authenticated;
revoke all on public.applied_migrations from authenticated, anon;
revoke all on public.ai_global_daily from authenticated, anon;
revoke all on public.ai_cooldown from authenticated, anon;
