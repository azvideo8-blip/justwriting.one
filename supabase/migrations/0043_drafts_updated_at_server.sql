-- 0043_drafts_updated_at_server.sql
--
-- S0-4 (Fable §1.3, R6Q-040). Посылка уточнена в SF-2: у `drafts.updated_at`
-- есть `default now()`, но защитного триггера не было — а `saveDraft`/
-- `updateDraft` присылают `updatedAt: new Date()` с клиента. Значит метку ряда
-- мог сдвинуть произвольный часовой источник: отстающий прибор ставил своей
-- строке будущее или прошлое, и ни одно сравнение «облако новее» на черновиках
-- не имело опоры. Прежний текст ссылался на сверку `lastSeenCloudUpdatedAt` в
-- `CloudSyncService:274` — там сравниваются `documents`, а не черновики; на
-- черновиках эта ссылка ничего не проверяла.
--
-- Зачем триггер нужен именно сейчас (и почему без него нельзя отказаться): правка
-- SF-2 перевела спор черновика на серверные метки с обеих сторон — `loadDraft`
-- сверяет `updated_at` облачной строки с серверным штампом последней принятой
-- этим устройством записи. Оба числа обязаны быть с часов сервера; пока метку
-- ряда пишет клиент, сравнение рассыпается ровно там же, где часовое.
--
-- Чисто аддитивная миграция: функция + триггер `before insert or update`.
-- Окна обслуживания не требует; данные не переписываются (строки, где клиентская
-- метка ушла в будущее, обновятся при первой же записи черновика).
--
-- Почему на INSERT тоже: 0033 уже чинил `documents` ровно по этой причине —
-- вставка с клиентской меткой сдвигала курсор изменений других устройств вперёд.

create or replace function public.set_drafts_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists tr_drafts_updated_at on public.drafts;
create trigger tr_drafts_updated_at
  before insert or update on public.drafts
  for each row
  execute function public.set_drafts_updated_at();
