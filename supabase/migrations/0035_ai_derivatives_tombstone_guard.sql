-- 0035_ai_derivatives_tombstone_guard.sql
--
-- R5-001: класс R4-001 (0034) не был закрыт для разборов и векторов.
-- ai_summaries_* / ai_embeddings_* insert/update требовали только, чтобы
-- документ был свой; deleted_at не смотрели. Разбор или векторы, чья выгрузка
-- обогнала дренаж удаления, — или которые выгрузил другой проход с локальной
-- копией заметки, уже снятой с облака надгробием (unlinkedByTombstone
-- сохраняет uuid), — оставляли пересказ и чанки текста удалённой заметки в
-- облаке. Защита на сервере, как в 0034: от клиентских замков и вкладок она
-- не зависит.
--
-- Легальной записи под надгробием нет: deleteDocument стирает разборы и
-- векторы ДО того, как ставит deleted_at, а восстановить надгробие клиент не
-- может (documents_update_own из 0016 требует deleted_at is null).
-- select/delete не трогаем: удалить хвост под надгробием по-прежнему можно.

drop policy if exists "ai_summaries_insert_own" on public.ai_summaries;
drop policy if exists "ai_summaries_update_own" on public.ai_summaries;
drop policy if exists "ai_embeddings_insert_own" on public.ai_embeddings;
drop policy if exists "ai_embeddings_update_own" on public.ai_embeddings;

create policy "ai_summaries_insert_own"
  on public.ai_summaries for insert
  with check (user_id = auth.uid() and exists (
    select 1 from public.documents d
    where d.uuid = document_id and d.user_id = auth.uid() and d.deleted_at is null));

create policy "ai_summaries_update_own"
  on public.ai_summaries for update
  using (user_id = auth.uid() and exists (
    select 1 from public.documents d
    where d.uuid = document_id and d.user_id = auth.uid() and d.deleted_at is null))
  with check (user_id = auth.uid() and exists (
    select 1 from public.documents d
    where d.uuid = document_id and d.user_id = auth.uid() and d.deleted_at is null));

create policy "ai_embeddings_insert_own"
  on public.ai_embeddings for insert
  with check (user_id = auth.uid() and exists (
    select 1 from public.documents d
    where d.uuid = document_id and d.user_id = auth.uid() and d.deleted_at is null));

create policy "ai_embeddings_update_own"
  on public.ai_embeddings for update
  using (user_id = auth.uid() and exists (
    select 1 from public.documents d
    where d.uuid = document_id and d.user_id = auth.uid() and d.deleted_at is null))
  with check (user_id = auth.uid() and exists (
    select 1 from public.documents d
    where d.uuid = document_id and d.user_id = auth.uid() and d.deleted_at is null));
