-- 0021 AG-QUOTA-1 (#25): документированные лимиты становятся enforced.
--
-- Замер размера — на сериализованном значении через pg_column_size.
-- Проверено в Postgres 16 (Docker, postgres:16) 2026-08-23: pg_column_size
-- В CHECK-констрейнте ПРИНИМАЕТСЯ — предположение тикета о том, что STABLE-
-- функция будет отклонена, не подтвердилось: IMMUTABLE требуется для индексных
-- выражений и generated-колонок, но не для CHECK. Поэтому байтовый замер
-- вместо запасного length(x::text), который считает символы, а не байты.
--
-- Версионный потолок (500 версий на документ) сознательно НЕ входит:
-- жёсткий отказ в сохранении заметки хуже риска забить диск в продукте с одним
-- реальным пользователем. Вернуть при появлении второго пользователя.

alter table public.documents
  add constraint documents_tags_size check (pg_column_size(tags) <= 8192);

alter table public.drafts
  add constraint drafts_pinned_thoughts_size check (pg_column_size(pinned_thoughts) <= 60000);
