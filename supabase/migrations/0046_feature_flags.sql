-- 0046_feature_flags.sql
-- RP-3 (практики ревью 2026-10-24): выключатель без выкатки и выпуск сначала на
-- владельца. Флаги этапов синка были константами в коде — выключить новый путь
-- значило выпустить клиент (~1 ч с CI). Теперь значение в базе:
--
--   update public.feature_flags set enabled_for = 'nobody', updated_at = now()
--    where name = 'sync_pull_by_rev';
--
-- и клиенты уходят на старый путь при следующем входе или перезагрузке.
--
-- `enabled_for`: 'nobody' | 'owner' | 'all'. «Владелец» — аккаунт с role='admin',
-- тот же признак, что у вкладки админки и мобильного макета (0041).
--
-- Таблицу клиент не читает (deny-all, как service_accounts в 0040): ответ даёт
-- функция от имени владельца — ровно boolean для своего uid и имени флага.
-- Нет строки флага — false: «неизвестный флаг» не включает ничего. Сбой вызова
-- (в том числе сервер без этой миграции) клиент трактует как значение по
-- умолчанию из кода — для синка это старый путь.
--
-- Прод миграцию применяет ревьюер руками при выкатке, своим бэкапом.

create table if not exists public.feature_flags (
  name        text primary key,
  enabled_for text not null check (enabled_for in ('nobody', 'owner', 'all')),
  updated_at  timestamptz not null default now()
);

alter table public.feature_flags enable row level security;
-- Политик нет: из браузера таблица не читается и не пишется. Права Supabase по
-- умолчанию на новые таблицы снимаются явно.
revoke all on public.feature_flags from public, anon, authenticated;

create or replace function public.feature_enabled(flag text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case f.enabled_for
             when 'all' then true
             when 'owner' then exists (
               select 1 from public.users u
                where u.uid = (select auth.uid()) and u.role = 'admin'
             )
             else false
           end
      from public.feature_flags f
     where f.name = flag
  ), false);
$$;

revoke all on function public.feature_enabled(text) from public, anon;
grant execute on function public.feature_enabled(text) to authenticated;

-- Первый флаг: забор заметок по серверному rev (SYNC1, 0045) — сначала владельцу.
insert into public.feature_flags (name, enabled_for)
values ('sync_pull_by_rev', 'owner')
on conflict (name) do nothing;
