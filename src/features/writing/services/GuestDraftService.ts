import { reportError } from '../../../shared/errors/reportError';
import { applyWrite, buildGuestDraftRecord, GUEST_IDB_KEY, type ApplyWriteOutcome, type DraftRecord } from './draftWriter';

/** Настоящая нехватка места: та же форма, по которой её различает показ (`markError`). */
function isQuotaExceeded(e: unknown): e is DOMException {
  return e instanceof DOMException && e.name === 'QuotaExceededError';
}

export async function saveGuestDraftToStorage(
  draft: DraftRecord,
  // Заметка ревьюера 03.11 13:55 (сид 103): гостевая отсрочка называет эпоху
  // мутатору — иначе снятие writer-стража возвращает класс «поздняя запись в
  // окне сохранения».
  // DW5-3.2: `uid` обязателен (без него запись не проходит мутатора, и молча
  // терять гостевой текст нельзя), и итог мутатора возвращается вызывающему.
  opts: { uid: string; epoch?: number | undefined },
): Promise<ApplyWriteOutcome> {
  // DW4-4: гость называет владельцем себя — гостевой текст не имеет
  // владельца-аккаунта по смыслу (DW-6), а зеркало ведёт аккаунты.
  // Шаг 5 DW-4: ту же эпоху правки гость несёт и в строке, а не только в
  // аргументе мутатору — один источник для обоих адресов.
  const rec = buildGuestDraftRecord({ ...draft, owner: opts.uid, epoch: opts.epoch });
  let row: ApplyWriteOutcome = 'no-owner';
  let idbFailed = false;
  let lsFailed = false;
  let idbError: unknown;
  let lsError: unknown;
  try {
    // Строка отсрочки живёт под `guest_draft` (адрес читают load/migration),
    // а `uid` гостя — не ключ: `saveToLocal` пишет гостевые строки по `uid`.
    row = await applyWrite(rec, 'edit', { uid: opts.uid, target: 'row', epoch: opts.epoch, rowKey: GUEST_IDB_KEY });
  } catch (e) {
    idbFailed = true;
    idbError = e;
    reportError(e, { action: 'saveGuestDraft_idb' }, 'warning');
  }
  try {
    await applyWrite(rec, 'edit', { uid: opts.uid, target: 'copy', epoch: opts.epoch });
  } catch (e) {
    lsFailed = true;
    lsError = e;
    reportError(e, { action: 'saveGuestDraft_ls' }, 'warning');
  }
  if (idbFailed && lsFailed) {
    // VIS T4 (владелец 04.11): причина доезжает до показа. Нехватку места
    // `markError` различает только по самому броску (`DOMException` +
    // `QuotaExceededError`), а обёртка «обе половины отказали» показывала гостю
    // «Ошибка сохранения» на полном устройстве — слова, которые не говорят, что
    // делать. Правило записи не меняется: бросок по-прежнему только когда
    // отказали обе половины, и журнал уже назвал каждую.
    const quota = isQuotaExceeded(idbError) ? idbError : isQuotaExceeded(lsError) ? lsError : undefined;
    if (quota) throw quota;
    throw new Error('GUEST_DRAFT_SAVE_FAILED: both IDB and localStorage failed');
  }
  // Отказ мутатора — не «не записано из-за поломки», а «записи здесь быть не
  // должно»: ни строка, ни копия не тронуты (оба зовут то же правило). При
  // обрыве одной половины текст всё равно лежит в читаемом адресе, и его
  // забирает `loadGuestDraftFromStorage` — это «записано», а не потеря.
  return idbFailed ? 'written' : row;
}
