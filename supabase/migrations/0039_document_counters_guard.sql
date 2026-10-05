-- 0039_document_counters_guard.sql
--
-- V-5 (тикет ag-note-metadata-blind-update-ticket.md). Замер на проде
-- 2026-10-05: документов с `current_version < max(version)` — ноль, то есть
-- сегодняшних потерь нет. Но запись метаданных идёт вслепую: клиент присылает
-- абсолюты, которые сам прочитал раньше, и писатель с более старой копией
-- спокойно перезаписывает более новую. Переписывать протокол ради этого дешёвого
-- класса ошибок не стали; закрыли ровно два места, где это становится видно.

-- 1. current_version не умеет назад.
--
-- Выбрано «оставить прежнее значение», а не «поднять до запрошенного» и не
-- «упасть»:
--   * поднять было бы враньем: строка начала бы ссылаться на версию, которой
--     писатель в неё не клал (содержимое в этот же запрос не переехало);
--   * упасть — значит превратить безобидную позднюю выгрузку метаданных в
--     красный отказ синхронизации у человека на экране;
--   * оставить максимум — инвариант «отметка в строке не ниже любой уже
--     писанной» выполняется, а сам контент живёт в public.versions со своими
--     защитами (0034), и перезаписать его этим запросом нельзя.
-- Отдельно: отметку разрешено писать равную или большую, поэтому обычный
-- прогресс (1 → 2 → 3) триггер не трогает.
create or replace function public.guard_documents_current_version()
returns trigger
language plpgsql
as $$
begin
  if new.current_version is not null
     and old.current_version is not null
     and new.current_version < old.current_version then
    new.current_version := old.current_version;
  end if;
  return new;
end $$;

drop trigger if exists documents_current_version_guard on public.documents;
create trigger documents_current_version_guard
before update on public.documents
for each row execute function public.guard_documents_current_version();

-- 2. Счётчики сессий: атомарно, на сервере, вместо абсолютов из клиента.
--
-- `total_duration` — накопительное число (сумма длительностей сессий), поэтому
-- дельта: два устройства, синхронизующие одну заметку, больше не теряют ход
-- одного из них (read-modify-write без этого условия и был источником потерь) —
-- ровно как `increment_document_sessions` из 0020.
--
-- `total_words` — НЕ дельта: клиент хранит в этом поле ДЛИНУ заметки, а не сумму
-- написанного, и дельты для него нет. Поэтому максимум: устаревший писатель не
-- уменьшит счётчик, а самое свежее (самое длинное) наблюдение остаётся. Цена —
-- после сокращения текста облачный счётчик не откатывается назад; локальная
-- копия по-прежнему показывает реальную длину, и именно она идёт в интерфейс
-- заметки, а облачное число питает сводки.
--
-- `and deleted_at is null` — то же N-9, что 0033 закрыл для
-- increment_document_sessions: функция работает от владельца, поэтому мимо этого
-- условия она дописывала счётчики в надгробие удалённой заметки, куда RLS её
-- пустил бы отказом.
create or replace function public.sync_document_stats(
  p_uuid text,
  p_words bigint,
  p_duration_delta bigint
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.documents
     set total_words   = greatest(coalesce(total_words, 0), coalesce(p_words, 0)),
         total_duration = greatest(0, coalesce(total_duration, 0) + coalesce(p_duration_delta, 0))
   where uuid = p_uuid
     and user_id = (select auth.uid())
     and deleted_at is null;
$$;

revoke all on function public.sync_document_stats(text, bigint, bigint) from public, anon;
grant execute on function public.sync_document_stats(text, bigint, bigint) to authenticated;
