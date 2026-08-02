-- Данные, живущие только в браузере: диалоги с ИИ, память чата, портрет,
-- грани профиля, история жизни и прочее. На сервере их никто не разбирает по
-- полям, поэтому пятнадцать типизированных таблиц были бы схемой ради схемы.
-- Одна таблица с payload jsonb принимает их дословно; если что-то из этого
-- когда-нибудь понадобится серверу, оно выделится в свою таблицу отдельной
-- миграцией.
create table if not exists public.local_store_records (
  user_id  uuid not null references auth.users(id) on delete cascade,
  store    text not null,
  key      text not null,
  payload  jsonb not null,
  checksum text,
  primary key (user_id, store, key)
);

alter table public.local_store_records enable row level security;

-- RLS: owner-only CRUD, no admin exception.
create policy "local_store_records_select_own"
  on public.local_store_records for select
  using (auth.uid() = user_id);

create policy "local_store_records_insert_own"
  on public.local_store_records for insert
  with check (auth.uid() = user_id);

create policy "local_store_records_update_own"
  on public.local_store_records for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "local_store_records_delete_own"
  on public.local_store_records for delete
  using (auth.uid() = user_id);
