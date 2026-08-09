-- supabase/migrations/0004_ai_counters.sql
-- These tables already exist from 0001 with a jsonb payload. CREATE TABLE IF NOT
-- EXISTS would silently do nothing here, which is how this file first shipped as
-- a no-op — every counter query then failed on a column that was never created.

alter table public.ai_global_daily
  add column if not exists call_count bigint not null default 0;

-- Per-user limits need one row per day, and the table is keyed by uid alone.
-- `kind` separates the ordinary counter from the bulk one: uid is a uuid with a
-- foreign key to users, so the previous `bulk:<uid>` string could never be
-- stored in it.
alter table public.ai_daily_limit
  add column if not exists day  date not null default current_date,
  add column if not exists kind text not null default 'chat',
  add column if not exists call_count bigint not null default 0;

alter table public.ai_daily_limit drop constraint if exists ai_daily_limit_pkey;
alter table public.ai_daily_limit add primary key (uid, day, kind);

create index if not exists idx_ai_daily_limit_uid_day
  on public.ai_daily_limit (uid, day);
