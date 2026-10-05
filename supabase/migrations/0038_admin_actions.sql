-- 0038_admin_actions.sql
-- V-3: удаление аккаунта админом оставляло след только в логе процесса
-- (`console.warn` в adminDeleteUserLogic), а он живёт до первой ротации логов
-- и теряется при переустановке службы. Таблица — чтобы «кто и кого удалил»
-- переживало логи и читалось из админки.
--
-- Ссылочных целостей здесь сознательно нет:
--   * `admin_uid` со ссылкой на public.users помешал бы удалить администратора
--     (NO ACTION блокирует) либо стёр бы след его действия (CASCADE);
--   * `target_uid` со ссылкой уничтожил бы запись о самом факте удаления
--     вместе с удалённым аккаунтом.
-- Оба поля — исторические идентификаторы, а не внешние ключи.

create table if not exists public.admin_actions (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  admin_uid  uuid    not null,
  action     text    not null,
  target_uid uuid    not null,
  -- Пустой текст не допускается, и список действий короткий: «delete_user»
  -- пишет сервер. Ничего, кроме разрешённого, сюда попасть не должно.
  constraint admin_actions_action_nonempty check (length(trim(action)) > 0)
);

create index if not exists idx_admin_actions_at on public.admin_actions(at desc);
create index if not exists idx_admin_actions_target on public.admin_actions(target_uid);

alter table public.admin_actions enable row level security;

-- Читает только админ. Пишет только сервер своим пуловым соединением (api/db.ts),
-- которое идёт мимо RLS — политики ниже та же оборона, что у ai_usage_calls (0029):
-- из браузера сюда нельзя ни строкой.
create policy "admin_actions_select_admin"
  on public.admin_actions for select
  using (public.is_admin());

create policy "admin_actions_deny_insert"
  on public.admin_actions for insert
  with check (false);

create policy "admin_actions_deny_update"
  on public.admin_actions for update
  using (false)
  with check (false);

create policy "admin_actions_deny_delete"
  on public.admin_actions for delete
  using (false);
