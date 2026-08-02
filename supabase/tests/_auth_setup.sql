-- _auth_setup.sql — Minimal auth schema for local RLS testing.
-- Provides auth.users table and auth.uid()/auth.role() functions
-- that mirror Supabase's behavior.
--
-- auth.uid() returns text (not uuid) to match public.users.uid and
-- the user_id columns in the public schema.  In real Supabase,
-- implicit casting handles the comparison; here we make the types
-- match directly.

create schema if not exists auth;

create table if not exists auth.users (
  id    uuid primary key,
  email text not null
);

create or replace function auth.uid()
returns text as $$
  select coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '');
$$ language sql stable;

create or replace function auth.role()
returns text as $$
  select coalesce(current_setting('role', true), 'anon');
$$ language sql stable;

-- The 'authenticated' role is needed by SET role = 'authenticated'.
-- In Supabase this role exists by default; here we create it manually.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
END $$;

-- Grant usage so SET role works.
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
