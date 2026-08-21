-- D4.27: Согласие на векторную индексацию (поиск по смыслу) для отправки фрагментов заметок в модель эмбеддингов.
alter table public.users
  add column if not exists indexing_consent_at      timestamptz,
  add column if not exists indexing_consent_version integer;
