-- AUD-18: interval limit for background (bulk) AI endpoints.
-- A daily ceiling without a per-interval limit lets a client spend the whole
-- day's allowance in a minute. Keyed by (uid, endpoint) so rerank and chat
-- throttle independently, mirroring ai_cooldown for the interactive path.
create table if not exists public.ai_bulk_cooldown (
  uid        text        not null,
  endpoint   text        not null,
  updated_at timestamptz not null default now(),
  primary key (uid, endpoint)
);

alter table public.ai_bulk_cooldown enable row level security;
create policy "ai_bulk_cooldown_deny_all"
  on public.ai_bulk_cooldown for all
  using (false)
  with check (false);
