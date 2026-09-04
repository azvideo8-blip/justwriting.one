-- Migration 0024_repair_current_version.sql
-- Repair documents where current_version does not match max(version) (BETA-5 / SYNC-10)

update public.documents d
set current_version = sub.max_v
from (
  select document_uuid, max(version) as max_v
  from public.versions
  group by document_uuid
) sub
where d.uuid = sub.document_uuid
  and d.deleted_at is null
  and d.current_version < sub.max_v;
