-- supabase/migrations/0029_ai_usage_calls.sql
-- ai_usage aggregates promptTokens/completionTokens/requests per (uid, date)
-- only — no way to see cost per call type (chat vs rerank vs memory
-- extraction) or compare before/after a prompt change without a full day of
-- mixed traffic. This logs each recordUsage() call individually.
--
-- Writes only ever happen through the service's own pooled connection
-- (api/db.ts), which bypasses RLS — the policies below are defense-in-depth,
-- same posture as ai_global_daily/anonymized_telemetry.

create table if not exists public.ai_usage_calls (
  id         bigserial primary key,
  uid        uuid not null references public.users(uid) on delete cascade,
  fn         text not null,
  model      text,
  tokens_in  integer not null default 0,
  tokens_out integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_usage_calls_uid_created
  on public.ai_usage_calls(uid, created_at desc);

create index if not exists idx_ai_usage_calls_fn_created
  on public.ai_usage_calls(fn, created_at desc);

alter table public.ai_usage_calls enable row level security;

create policy "ai_usage_calls_select_admin"
  on public.ai_usage_calls for select
  using (public.is_admin());

create policy "ai_usage_calls_deny_write"
  on public.ai_usage_calls for insert
  with check (false);

create policy "ai_usage_calls_deny_update"
  on public.ai_usage_calls for update
  using (false)
  with check (false);

create policy "ai_usage_calls_deny_delete"
  on public.ai_usage_calls for delete
  using (false);
