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
-- 0041 (MB-1): право на мобильный макет. Функция security definer читает
-- service_accounts (0040, deny-all для клиентов) от имени владельца; если
-- восстановление вернёт ей EXECUTE для PUBLIC, спросить чужое право сможет и
-- аноним, а это уже не «boolean про себя».
revoke all on function public.mobile_layout_allowed() from public, anon;
grant execute on function public.mobile_layout_allowed() to authenticated;
revoke all on public.admin_users_view from public, anon;
grant select on public.admin_users_view to authenticated;
revoke all on public.applied_migrations from authenticated, anon;
revoke all on public.ai_global_daily from authenticated, anon;
revoke all on public.ai_cooldown from authenticated, anon;
revoke all on public.service_accounts from authenticated, anon;
-- 0045 (SYNC1): номер строки выдаёт security definer-функция; клиенту
-- последовательность не нужна. Восстановление возвращает USAGE из default
-- privileges образа — отзываем снова, иначе клиент сможет жечь номера.
-- S1-15: дамп, снятый до 0045, последовательности не содержит — безусловный
-- revoke ронял бы весь файл с ON_ERROR_STOP=1. Страж — psql \if; строка
-- revoke остаётся дословной (её держит postRestoreGrants.test.ts).
select to_regclass('public.sync_rev_seq') is not null as has_sync_rev_seq \gset
\if :has_sync_rev_seq
revoke all on sequence public.sync_rev_seq from public, anon, authenticated;
\endif
-- 0046 (RP-3): флаги читает только функция от имени владельца; таблица для
-- клиентов закрыта. Дамп до 0046 таблицы не содержит — тот же страж \if.
select to_regclass('public.feature_flags') is not null as has_feature_flags \gset
\if :has_feature_flags
revoke all on public.feature_flags from public, anon, authenticated;
revoke all on function public.feature_enabled(text) from public, anon;
grant execute on function public.feature_enabled(text) to authenticated;
\endif
