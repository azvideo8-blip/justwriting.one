-- 0031_consent_stamp_server_only.sql
-- R4-3: 0018 ставил ai_consent_server_at только при изменении полей согласия,
-- а в остальных случаях принимал то, что прислал клиент: одиночный
-- UPDATE ... SET ai_consent_server_at = '2000-01-01' закреплялся. Отметка —
-- доказательство момента согласия, поэтому её пишет только сервер: при
-- неизменных полях сохраняется прежняя, на INSERT — now() при наличии согласия.
create or replace function public.stamp_consent()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.ai_consent_server_at := case
      when new.ai_consent_at is not null or new.indexing_consent_at is not null then now()
    end;
  elsif new.ai_consent_at is distinct from old.ai_consent_at
     or new.ai_consent_version is distinct from old.ai_consent_version
     or new.indexing_consent_at is distinct from old.indexing_consent_at then
    new.ai_consent_server_at := now();
  else
    new.ai_consent_server_at := old.ai_consent_server_at;
  end if;
  return new;
end $$;

drop trigger if exists users_consent_stamp on public.users;
create trigger users_consent_stamp
before insert or update on public.users
for each row execute function public.stamp_consent();
