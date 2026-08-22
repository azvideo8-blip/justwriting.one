-- 0015_server_controlled_columns.sql
--
-- 1. applied_migrations — закрыть от чтения и записи клиентами через PostgREST
--    путём включения RLS без политик.
-- 2. protect_user_columns() — защитить email от изменения клиентом (PostgREST),
--    при этом разрешая синхронизацию из auth.users (фоновый триггер).
-- 3. on_auth_user_sync — триггер на auth.users для синхронизации email при
--    создании и обновлении в auth.users.

-- 1. applied_migrations: закрыть от клиентов через RLS
create table if not exists public.applied_migrations (
  filename text primary key,
  applied_at timestamptz not null default now()
);

alter table public.applied_migrations enable row level security;

-- 2. protect_user_columns: запретить менять email через PostgREST
create or replace function public.protect_user_columns()
returns trigger
language plpgsql
as $$
begin
  if new.role is distinct from old.role then
    raise exception 'role is server-controlled';
  end if;
  if new.uid is distinct from old.uid then
    raise exception 'uid is immutable';
  end if;
  if new.email is distinct from old.email
     and nullif(current_setting('request.jwt.claims', true), '') is not null then
    raise exception 'email is server-controlled';
  end if;
  return new;
end;
$$;

-- 3. Синхронизация email из auth.users в public.users
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (uid, email)
  values (new.id, coalesce(new.email, ''))
  on conflict (uid) do update
    set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
drop trigger if exists on_auth_user_sync on auth.users;

create trigger on_auth_user_sync
  after insert or update of email on auth.users
  for each row execute function public.handle_new_auth_user();
