-- 0033_updated_at_on_insert_and_tombstone_sessions.sql
-- N-7: updated_at ставил только триггер BEFORE UPDATE; на INSERT клиент мог
-- прислать любое значение (например, далёкое будущее) и сдвинуть курсор
-- изменений других своих устройств. Теперь метку ставит сервер и при вставке.
drop trigger if exists tr_documents_updated_at on public.documents;
create trigger tr_documents_updated_at
  before insert or update on public.documents
  for each row
  execute function public.set_documents_updated_at();

-- N-9: функция работает от владельца (security definer) и мимо RLS 0016
-- дописывала счётчик сессий в надгробие удалённой заметки.
create or replace function public.increment_document_sessions(p_uuid text, p_delta int default 1)
returns void
language sql security definer
set search_path = ''
as $$
  update public.documents
     set sessions_count = greatest(0, coalesce(sessions_count, 0) + p_delta)
   where uuid = p_uuid and user_id = (select auth.uid()) and deleted_at is null;
$$;
revoke all on function public.increment_document_sessions(text, integer) from public, anon;
grant execute on function public.increment_document_sessions(text, integer) to authenticated;
