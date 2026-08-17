-- 0010_drafts_session_start_time_bigint.sql
--
-- session_start_time хранит epoch-миллисекунды (LocalDraft.sessionStartTime,
-- число вида 1786752000000), а объявлена была как `real`. float4 держит около
-- семи значащих цифр, а такой метке нужно тринадцать, поэтому значение
-- округлялось при записи.
--
-- Замерено на боевой базе вставкой в транзакции с откатом: записали
-- 1786752000000, прочитали 1786752008192 — расхождение 8192 мс. Шаг float4 на
-- этой величине равен 2^17 = 131072, то есть ошибка доходит до ~65 секунд.
--
-- Метка используется как точка отсчёта возобновлённой сессии письма, так что
-- ошибка уезжала в длительность и в wpm. bigint покрывает epoch-ms без потерь.
--
-- Остальные `real`-колонки в drafts (seconds, wpm, word_count,
-- initial_word_count, accumulated_duration, total_pause_seconds) держат
-- небольшие величины, где точности float4 хватает, и здесь не меняются.

alter table public.drafts
  alter column session_start_time type bigint using session_start_time::bigint;
