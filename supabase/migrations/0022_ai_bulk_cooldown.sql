-- AUD-18: interval limit for background (bulk) AI endpoints.
-- A daily ceiling without a per-interval limit lets a client spend the whole
-- day's allowance in a minute. Keyed by (uid, endpoint) so rerank, embed and
-- chat throttle independently.
--
-- A sliding window with a call budget, NOT a one-call-per-interval gate: the
-- background endpoints are legitimately bursty. `embed` is called once per
-- chat search and once per note while indexing an archive (150 ms apart), so
-- a hard 1/min gate would stop indexing at one note per minute and make the
-- second search of any minute fall back to keyword-only. That exact failure
-- already happened once (2026-06-16, a 10 s cooldown on embedDocument).
--
-- The table holds transient counters only; recreating it loses nothing.
drop table if exists public.ai_bulk_cooldown;

create table public.ai_bulk_cooldown (
  uid          text        not null,
  endpoint     text        not null,
  window_start timestamptz not null default now(),
  calls        integer     not null default 0,
  primary key (uid, endpoint)
);

alter table public.ai_bulk_cooldown enable row level security;
create policy "ai_bulk_cooldown_deny_all"
  on public.ai_bulk_cooldown for all
  using (false)
  with check (false);
