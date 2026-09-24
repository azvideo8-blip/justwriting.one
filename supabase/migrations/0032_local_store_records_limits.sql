-- 0032_local_store_records_limits.sql
-- R3-14: у записей ИИ не было ни предела размера, ни связи с владельцем.
-- Клиент режет запись на страницы по 500 КБ (PAGE_SPLIT_THRESHOLD_BYTES), после
-- шифрования страница ~700 КБ; на проде 2026-09-24 максимум 683 КБ, записей без
-- владельца 0. Предел 2 МиБ — запас втрое, а не рабочая граница.
alter table public.local_store_records
  add constraint local_store_records_payload_size
  check (pg_column_size(payload) <= 2097152) not valid;
alter table public.local_store_records validate constraint local_store_records_payload_size;

alter table public.local_store_records
  add constraint local_store_records_user_fk
  foreign key (user_id) references public.users(uid) on delete cascade not valid;
alter table public.local_store_records validate constraint local_store_records_user_fk;
