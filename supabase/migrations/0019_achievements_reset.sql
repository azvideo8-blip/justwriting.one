-- 0019_achievements_reset.sql
-- A reset must survive the union-merge from other devices: the tombstone
-- moment lives on the profile, and the client skips cloud achievements that
-- were earned before it. Legacy entries carry no earnedAt — they are treated
-- as earned before any reset, which keeps the reset meaningful going forward
-- and loses nothing that was not already lost.
alter table public.users
  add column if not exists achievements_reset_at timestamptz;
