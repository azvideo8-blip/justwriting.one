-- 0036_drop_telemetry.sql
-- S-26 (152-ФЗ data minimisation): remove telemetry entirely.

drop policy if exists "telemetry_select_admin" on public.anonymized_telemetry;
drop policy if exists "telemetry_deny_write" on public.anonymized_telemetry;
drop policy if exists "telemetry_deny_update" on public.anonymized_telemetry;
drop policy if exists "telemetry_deny_delete" on public.anonymized_telemetry;
drop policy if exists telemetry_cooldown_deny_all on public.telemetry_cooldown;

drop table if exists public.anonymized_telemetry;
drop table if exists public.telemetry_cooldown;
