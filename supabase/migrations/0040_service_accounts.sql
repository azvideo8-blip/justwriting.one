-- 0040_service_accounts.sql
-- Служебные аккаунты, которые админ не может удалить кнопкой «Удалить».
--
-- 2026-10-05 владелец удалил из админки восемь «тестовых» аккаунтов, и среди них
-- оказался аккаунт, под которым выкатка проверяет вход на проде (TB-17,
-- scripts/post-deploy-login.ts). Следующая выкатка упала на этой проверке и
-- откатилась. В списке пользователей служебный аккаунт ничем не отличался.
--
-- Роль (`public.users.role`) для пометки не годится: её охраняет
-- protect_user_columns, и смена роли ломала бы этот инвариант. Отдельная таблица:
-- её читает только сервер своим пуловым соединением (api/db.ts, мимо RLS), из
-- браузера в неё нельзя ни прочитать, ни записать. Строку кладут руками при
-- выкатке (runbook), uid — у каждого прода свой, в миграции его нет.

create table if not exists public.service_accounts (
  uid        uuid primary key,
  note       text not null default '',
  created_at timestamptz not null default now()
);

alter table public.service_accounts enable row level security;
-- Политик нет: deny-all. Права по умолчанию (_auth_setup.sql / прод) отзываем,
-- как у прочих серверных таблиц (0034).
revoke all on public.service_accounts from authenticated, anon;
