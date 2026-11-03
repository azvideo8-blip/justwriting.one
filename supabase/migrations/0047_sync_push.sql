-- 0047_sync_push.sql — запись с проверкой базы (SYNC2, S2-1).
--
-- Зачем. Устройство писало ИИ-данные вслепую: «вот моя версия» поверх того,
-- что лежит в облаке. Правка другого устройства, легшая раньше, затиралась
-- (I1), удалённая запись воскресала от старой копии (I3), а прибавка счётчиков
-- после потерянного ответа либо терялась, либо считалась дважды (I4). Теперь:
--
--   * `local_store_records` — `put` с `base_rev`: строка меняется, только если
--     её серверный `rev` равен базе, от которой получена локальная копия.
--     Иначе — `conflict` и текущая строка; разбирается клиент.
--   * удаление — надгробие (`deleted = true`, пустой payload), а не `delete`:
--     удалённое не воскресает, пока устройство не видело удаления (`recreate`
--     с базой надгробия).
--   * `documents` `delta` — прибавка счётчиков с `op_id`: повтор после
--     потерянного ответа ничего не меняет (`duplicate`).
--
-- Метаданные заметок (теги, метка, корзина, название) сюда НЕ идут: владелец
-- 02.11 выбрал «последний по серверу» по полю, а это и есть обычная запись
-- только изменённых полей — проверка базы ничего бы не добавила.
--
-- Старые клиенты. Надгробия скрыты политикой select: для старого клиента
-- надгробие выглядит как удалённая строка (как раньше при физическом delete),
-- пустых «живых» записей он не увидит. Его слепой upsert поверх надгробия
-- отказывает той же политикой — запись на старом клиенте
-- остаётся неотправленной до обновления (решение владельца 02.11, п.4).
--
-- Порядок: после 0045 (`rev`) и 0046 (флаги). Класс отката: T — обратный DDL;
-- перед `drop column deleted` удалить надгробия (иначе после возврата политик
-- старые клиенты увидят пустые записи). Ранбук — отчёт SYNC2, S2-9.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'local_store_records' and column_name = 'rev'
  ) then
    raise exception '0047_sync_push требует 0045_sync_rev';
  end if;
end $$;

-- 1. Надгробие. Константный default — без перезаписи таблицы.
alter table public.local_store_records
  add column if not exists deleted boolean not null default false;

-- 2. Ключи повтора прибавок. Клиентам таблица закрыта: пишет только sync_push.
create table if not exists public.sync_op_keys (
  user_id    uuid not null references public.users(uid) on delete cascade,
  op_id      uuid not null,
  rev        bigint,
  created_at timestamptz not null default now(),
  primary key (user_id, op_id)
);
alter table public.sync_op_keys enable row level security;
revoke all on public.sync_op_keys from public, anon, authenticated;

-- 3. Политика select: надгробие клиенту не видно. Это единственная
--    не-добавляющая правка миграции. Её одной хватает и на запись: update и
--    upsert (`on conflict do update`) проходят только по видимым строкам, так что
--    слепой upsert старого клиента поверх надгробия отказывает (42501), а update
--    не находит строки (проверено мутацией: отдельное `not deleted` в политике
--    update тест не краснит).
drop policy if exists "local_store_records_select_own" on public.local_store_records;
create policy "local_store_records_select_own"
  on public.local_store_records for select
  using (auth.uid() = user_id and not deleted);

-- 4. RPC. Пачка — одна транзакция; ответ — массив по элементам в том же порядке.
--    `user_id` из элемента не читается: каждый запрос — `user_id = uid`.
create or replace function public.sync_push(items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  it jsonb;
  out jsonb := '[]'::jsonb;
  res jsonb;
  op text;
  tbl text;
  base bigint;
  new_rev bigint;
  cur public.local_store_records%rowtype;
  doc_rev bigint;
  doc_deleted timestamptz;
  key_rev bigint;
begin
  if uid is null then
    raise exception 'sync_push: нет пользователя' using errcode = '42501';
  end if;
  if jsonb_typeof(items) is distinct from 'array' then
    raise exception 'sync_push: ожидается массив' using errcode = '22023';
  end if;
  if jsonb_array_length(items) > 100 then
    raise exception 'sync_push: больше 100 элементов' using errcode = '22023';
  end if;

  for it in select value from jsonb_array_elements(items) loop
    tbl := it->>'table';
    op := it->>'op';
    base := (it->>'base_rev')::bigint;
    res := null;

    if tbl = 'local_store_records' and op in ('put', 'recreate', 'delete') then
      if coalesce(it->>'store', '') = '' or coalesce(it->>'key', '') = '' then
        raise exception 'sync_push: нет store/key' using errcode = '22023';
      end if;

      begin
        if op = 'put' and base is null then
          insert into public.local_store_records (user_id, store, key, payload, checksum)
          values (uid, it->>'store', it->>'key', it->'payload', it->>'checksum')
          on conflict (user_id, store, key) do nothing
          returning rev into new_rev;
        elsif op = 'put' then
          update public.local_store_records
             set payload = it->'payload', checksum = it->>'checksum'
           where user_id = uid and store = it->>'store' and key = it->>'key'
             and rev = base and not deleted
          returning rev into new_rev;
        elsif op = 'recreate' then
          -- Только поверх надгробия, которое устройство видело.
          update public.local_store_records
             set payload = it->'payload', checksum = it->>'checksum', deleted = false
           where user_id = uid and store = it->>'store' and key = it->>'key'
             and rev = base and deleted
          returning rev into new_rev;
        else -- delete
          select * into cur from public.local_store_records
           where user_id = uid and store = it->>'store' and key = it->>'key'
           for update;
          if not found then
            res := jsonb_build_object('status', 'ok', 'rev', null);
          elsif cur.deleted then
            -- Идемпотентно: уже удалено.
            res := jsonb_build_object('status', 'ok', 'rev', cur.rev);
          else
            update public.local_store_records
               set deleted = true, payload = '{}'::jsonb, checksum = null
             where user_id = uid and store = it->>'store' and key = it->>'key'
               and rev = base
            returning rev into new_rev;
          end if;
        end if;
      exception when check_violation then
        -- Предел размера (0032): отказ этого элемента, а не всей пачки.
        res := jsonb_build_object('status', 'rejected', 'code', sqlstate);
      end;

      if res is null then
        if new_rev is not null then
          res := jsonb_build_object('status', 'ok', 'rev', new_rev,
            'stamped_at', (select (extract(epoch from r.stamped_at) * 1000)::bigint
                             from public.local_store_records r
                            where r.user_id = uid and r.store = it->>'store' and r.key = it->>'key'),
            'payload_updated_at', (select r.payload->'updatedAt'
                             from public.local_store_records r
                            where r.user_id = uid and r.store = it->>'store' and r.key = it->>'key'));
        else
          select * into cur from public.local_store_records
           where user_id = uid and store = it->>'store' and key = it->>'key';
          if not found then
            -- put с базой на строку, которой нет (удалена старым клиентом физически).
            res := jsonb_build_object('status', 'conflict', 'row', null);
          else
            res := jsonb_build_object('status', 'conflict', 'row', jsonb_build_object(
              'rev', cur.rev,
              'deleted', cur.deleted,
              'payload', cur.payload,
              'checksum', cur.checksum,
              'stamped_at', (extract(epoch from cur.stamped_at) * 1000)::bigint));
          end if;
        end if;
      end if;
      new_rev := null;

    elsif tbl = 'documents' and op = 'delta' then
      if (it->>'op_id') is null or coalesce(it->>'uuid', '') = '' then
        raise exception 'sync_push: нет op_id/uuid' using errcode = '22023';
      end if;
      select d.rev, d.deleted_at into doc_rev, doc_deleted
        from public.documents d
       where d.uuid = it->>'uuid' and d.user_id = uid
       for update;
      if not found then
        -- Заметки в облаке ещё нет: ключ не тратится, долг остаётся у клиента.
        res := jsonb_build_object('status', 'missing');
      elsif doc_deleted is not null then
        res := jsonb_build_object('status', 'gone');
      else
        insert into public.sync_op_keys (user_id, op_id)
        values (uid, (it->>'op_id')::uuid)
        on conflict do nothing;
        if not found then
          select k.rev into key_rev from public.sync_op_keys k
           where k.user_id = uid and k.op_id = (it->>'op_id')::uuid;
          res := jsonb_build_object('status', 'duplicate', 'rev', key_rev);
        else
          update public.documents
             set sessions_count = greatest(0, coalesce(sessions_count, 0) + coalesce((it->>'sessions')::int, 0)),
                 total_duration = greatest(0, coalesce(total_duration, 0) + coalesce((it->>'duration')::bigint, 0)),
                 total_words = greatest(coalesce(total_words, 0), coalesce((it->>'words')::bigint, 0))
           where uuid = it->>'uuid' and user_id = uid and deleted_at is null
          returning rev into new_rev;
          update public.sync_op_keys set rev = new_rev
           where user_id = uid and op_id = (it->>'op_id')::uuid;
          res := jsonb_build_object('status', 'ok', 'rev', new_rev);
          new_rev := null;
        end if;
      end if;

    else
      raise exception 'sync_push: неизвестный элемент %/%', tbl, op using errcode = '22023';
    end if;

    out := out || jsonb_build_array(res);
  end loop;

  return out;
end $$;

revoke all on function public.sync_push(jsonb) from public, anon;
grant execute on function public.sync_push(jsonb) to authenticated;

-- 5. Выключатель (RP-3): сначала владельцу.
insert into public.feature_flags (name, enabled_for)
values ('sync_push_rpc', 'owner')
on conflict (name) do nothing;
