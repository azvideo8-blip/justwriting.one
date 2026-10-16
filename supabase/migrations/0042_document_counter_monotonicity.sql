-- 0042_document_counter_monotonicity.sql
--
-- R7Q-003 / R7F-003. Замер Qoder на живой базе (раунд 7): обычный UPDATE от писателя
-- с устаревшей копией уносил назад `sessions_count` (20 → 1) и `total_duration`
-- (900 → 1); 0039 держал только `current_version`. Клиентскую часть исправили
-- отдельно — абсолюты из локальной копии больше не шлются, приращение считает
-- `increment_document_sessions`. Этот файл — вторая половина: база не пропускает
-- уменьшение даже если кто-то придёт с прямым запросом (старый клиент, чужой
-- скрипт, ручной прогон).
--
-- Почему «оставить прежнее значение», а не «отказать»: тот же выбор, что у 0039 —
-- красный отказ превратил бы безобидную позднюю выгрузку метаданных в сбой
-- синхронизации на экране у человека, а потерянные секунды и так не вернуть.
--
-- `total_words` здесь не трогается намеренно: это длина заметки, и после
-- сокращения текста она обязана становиться меньше (W-2 в шапке 0039). На
-- накопительные счётчики это не распространяется: и сессии, и секунды только
-- прибавляются.

create or replace function public.guard_documents_session_counters()
returns trigger
language plpgsql
as $$
begin
  if new.sessions_count is not null
     and old.sessions_count is not null
     and new.sessions_count < old.sessions_count then
    new.sessions_count := old.sessions_count;
  end if;

  if new.total_duration is not null
     and old.total_duration is not null
     and new.total_duration < old.total_duration then
    new.total_duration := old.total_duration;
  end if;

  return new;
end $$;

drop trigger if exists documents_session_counters_guard on public.documents;
create trigger documents_session_counters_guard
before update on public.documents
for each row execute function public.guard_documents_session_counters();
