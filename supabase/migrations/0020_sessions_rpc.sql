-- 0020_sessions_rpc.sql
-- sessions_count used to be read-modify-write from the client: two tabs or two
-- devices lost increments. The increment happens atomically on the database
-- now; the client calls this via PostgREST rpc().
-- Note: documents.uuid is a text column in this schema, not the uuid type —
-- the parameter matches it.
create or replace function public.increment_document_sessions(p_uuid text, p_delta int default 1)
returns void
language sql security definer
set search_path = ''
as $$
  update public.documents
     set sessions_count = greatest(0, coalesce(sessions_count, 0) + p_delta)
   where uuid = p_uuid and user_id = (select auth.uid());
$$;
revoke all on function public.increment_document_sessions(text, integer) from public, anon;
grant execute on function public.increment_document_sessions(text, integer) to authenticated;
