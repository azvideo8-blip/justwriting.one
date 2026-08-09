-- 0007_telemetry_cooldown.sql
--
-- Per-user cooldown for anonymised telemetry.
--
-- It has to be its own table. anonymized_telemetry is keyed by a telemetryId and
-- deliberately carries no uid — that is what makes it anonymous — so the
-- once-a-day limit cannot be derived from it without undoing the anonymity it
-- exists to provide. Firestore kept the same split (telemetryCooldown/{uid}).
--
-- Only the server writes here, through the service connection, so RLS denies
-- everyone as with the other admin-only tables.

create table if not exists public.telemetry_cooldown (
  uid          uuid primary key references public.users(uid) on delete cascade,
  last_sent_at timestamptz not null default now()
);

alter table public.telemetry_cooldown enable row level security;

drop policy if exists telemetry_cooldown_deny_all on public.telemetry_cooldown;
create policy telemetry_cooldown_deny_all on public.telemetry_cooldown
  using (false) with check (false);
