/**
 * DW4-1: каноническая форма строки черновика и единственный (де)сериализатор
 * для всех адресов записи — IDB-стор `drafts` (строка аккаунта и гостевая
 * строка `guest_draft`), LS-дубль `draft-<uid>` и гостевой ключ
 * `jw_guest_draft`.
 *
 * Имена хранящихся полей не меняются: читать обязаны оба бандла (§4.4 DW-4),
 * поля только добавляются, `DB_VERSION` не поднимается. Две формы у двух
 * писателей одного адреса — класс DW-F-2: теперь форма одна, и расхождение
 * требует правки этого файла, а не одного из писателей.
 *
 * DW4-2: здесь же живёт мутатор `applyWrite` — единственное место, которое
 * пишет оба локальных адреса (строку IDB и LS-дубль закрытия вкладки). Эпоха
 * записи принадлежит ему: писатель называет её на момент правки, сверка —
 * в мутаторе, до любой записи. Очередь правок строки — та же одна цепочка,
 * что была в `WritingDraftService` (SF2-1: текст и служебные метки облака —
 * два read-modify-write одной строки, порядок обязателен).
 */
import { getLocalDb, type LocalDraft } from '../../../core/storage/localDb';
import { reportError } from '../../../shared/errors/reportError';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';
import { useEncryptionStore } from '../../../core/crypto/useEncryptionStore';

/** Адрес записи: строка IDB (её `userId` = ключ) или LS-ключ. */
export type DraftAddress = { kind: 'idb'; key: string } | { kind: 'ls'; key: string };

/** Ключ гостевой строки IDB в общей базе (`justwriting-local`). */
export const GUEST_IDB_KEY = 'guest_draft';

/**
 * Каноническая форма. Поля факультативны (и принимают явный `undefined`:
 * писатель может не знать поле, сериализатор его вычищает) — старые строки и
 * бедные снимки читает тот же парсер. `[field: string]` — поля только
 * добавляются: поле, которого этот бандл не знает, обязано пережить круговой
 * обход serialize → parse без потерь.
 */
export interface DraftRecord {
  title?: string | undefined;
  content?: string | undefined;
  seconds?: number | undefined;
  wpm?: number | undefined;
  wordCount?: number | undefined;
  initialWordCount?: number | undefined;
  pinnedThoughts?: string[] | undefined;
  sessionStartTime?: number | null | undefined;
  activeSessionId?: string | null | undefined;
  savedDocumentId?: string | null | undefined;
  tags?: string[] | undefined;
  labelId?: string | undefined;
  accumulatedDuration?: number | undefined;
  totalPauseSeconds?: number | undefined;
  status?: string | undefined;
  /** Метка записи писателя; у копии, принятой из облака, — серверная. */
  updatedAt?: number | undefined;
  /** Метка гостевых строк прошлых версий; читается вторым выбором. */
  timestamp?: number | undefined;
  /** Шаг 2 DW-4: эпоха записи — собственность мутатора. */
  epoch?: number | undefined;
  /** Шаг 4 DW-4: владелец текста — поле строки. */
  owner?: string | undefined;
  /** SF-2: серверная метка облачной версии, которую устройство видело последней. */
  _cloudUpdatedAt?: number | undefined;
  /** SF2-1: хэш нагрузки, ПРИНЯТОЙ облаком последней. */
  _cloudAckedHash?: string | undefined;
  /** SF2-1: хэши отправленных нагрузок, ответа на которые мы не видели. */
  _cloudSentHashes?: string[] | undefined;
  [field: string]: unknown;
}

/**
 * Разбор хранящейся строки любого адреса и любой прошлой версии. Нарочно
 * пермиссивный: отказ прочтения не имеет права означать «черновика нет»
 * (I7), поэтому проверяется только «это объект».
 */
export function parseDraftRow(raw: unknown): DraftRecord | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  return raw as DraftRecord;
}

/**
 * Строка для записи по адресу: IDB-строка несёт `userId` (= ключ), LS-копия —
 * нет (адрес и есть ключ, а чужой `userId` в копии вводит читателя в
 * заблуждение). Ключи со значением `undefined` вычищаются: форма записи —
 * JSON-эквивалентная на обоих адресах, иначе набор полей строки IDB и LS-ключа
 * расходится сам по себе (structured clone хранит `undefined`-ключи, JSON — нет).
 */
export function serializeDraftRow(rec: DraftRecord, addr: DraftAddress): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(rec)) {
    if (value !== undefined) row[field] = value;
  }
  delete row.userId;
  if (addr.kind === 'idb') row.userId = addr.key;
  return row;
}

/**
 * Канонический билдер гостевой записи: обе гостевых записи (отсрочка
 * `GuestDraftService` и уход со страницы `useSyncUnloadSave`) собирают строку
 * только через него — одна форма по построению.
 */
export function buildGuestDraftRecord(draft: DraftRecord): DraftRecord {
  return { ...draft, updatedAt: Date.now() };
}

/**
 * Эпоха черновика (DY10-10): счётчик сессии записи по каждому владельцу.
 * Сохранение заметки и выход из редактора поднимают её и стирают черновик;
 * запись, назвавшая эпоху на момент правки, после подъёма уже не проходит.
 * DW4-2: карта и сверка живут в мутаторе — второй источник эпохи на один
 * выпуск (писатель сверяет сам, мутатор пишет) — ровно тот класс, ради
 * которого DW-4. Шаг 5: поднимает её тоже мутатор (`applySave`), а не тот,
 * кто сохранения делает, — и писатель, снявший эпоху до сохранения, больше не
 * меняет ни один адрес.
 */
const draftEpochs = new Map<string, number>();

export function getDraftGeneration(userId: string): number {
  return draftEpochs.get(userId) ?? 0;
}

export function bumpDraftGeneration(userId: string): number {
  const next = (draftEpochs.get(userId) ?? 0) + 1;
  draftEpochs.set(userId, next);
  return next;
}

/**
 * Шаг 5 DW-4: подъём эпохи — единственный вход мутатора. Закрытие помнится
 * отдельно от счётчика, потому что от него зависит исход отвергнутой записи:
 * «черновик закрыт человеком» (сохранение заметки принято, либо человек
 * удалил/сбросил черновик) означает, что тексту больше некуда возвращаться, а
 * «сессия письма кончилась» (уход из редактора) — нет, и такой текст обязан
 * остаться на экране или уйти в базу владельца (правило пакета: не записать ≠
 * выбросить). Конец сессии идёт сразу за сохранением (сброс → `idle`) и память
 * о закрытии не затирает.
 */
const draftClosedAt = new Map<string, number>();

/**
 * Черновик закрыт: сохранение заметки принято (`basis 'post-save'`) либо его
 * стёрли/сбросили. Единственный подъём эпохи в продуктовом коде — писатель его
 * не планирует, а только называет эпоху своего текста. Прежние шесть мест
 * (`sessionActions` ×2, `deleteDraftLocalPart`, `useDraftSession`,
 * `useSessionPersistence` и два в `useDraftAutosave`) поднимали счётчик сами:
 * новый писатель обязан был не забыть — ровно тот класс, ради которого DW-4.
 */
export function applySave(userId: string): number {
  const next = bumpDraftGeneration(userId);
  draftClosedAt.set(userId, next);
  return next;
}

/** Сессия письма кончилась (размонтирование редактора, переход в `idle`). */
export function applySessionEnd(userId: string): number {
  return bumpDraftGeneration(userId);
}

/**
 * Шаг 5: текст, снявший эпоху до закрытия черновика, этим закрытием и закрыт —
 * он лежит в заметке или удалён человеком. Возвращать его некуда.
 */
export function isDraftClosed(userId: string, epoch: number | undefined): boolean {
  if (epoch === undefined) return false;
  const closedAt = draftClosedAt.get(userId);
  return closedAt !== undefined && epoch < closedAt;
}

/**
 * Шаг 5: правило эпохи одной строкой (§4.1). Писатель называет эпоху ТЕКСТА,
 * снятую в момент правки; после подъёма запись с более ранней эпохой не имеет
 * права менять ни один адрес. Сверка одна — здесь; `!==` сузился до `<`, чтобы
 * строка, принесшая эпоху прошлой вкладки (карта эпох новой вкладки начинается
 * с нуля), не отвергалась.
 */
export function isEpochStale(userId: string, epoch: number | undefined): boolean {
  return epoch !== undefined && epoch < getDraftGeneration(userId);
}

/** Эпоха, названная самой записью (`epoch` — поле строки, §4.1). */
function recordEpoch(rec: DraftRecord): number | undefined {
  return typeof rec.epoch === 'number' ? rec.epoch : undefined;
}

/**
 * Эпоху называют писатели текста; `adopt-*`, `migrate-guest` и `expire` — чтения
 * и переносы, они приносят строку с чужой отметкой и сравнивать её не с чем.
 */
function namedEpoch(rec: DraftRecord, basis: DraftWriteBasis, opts: ApplyWriteOptions): number | undefined {
  if (opts.epoch !== undefined) return opts.epoch;
  return basis === 'edit' || basis === 'post-save' ? recordEpoch(rec) : undefined;
}

/**
 * DW4-4: владелец текста в редакторе этой вкладки. Мутатор пишет адреса только
 * названного владельца (I3), а запись без владельца не проходит вовсе (I6:
 * поле стоит в каждой строке). Зеркало — уровня вкладки, как карта эпох:
 * переживает перемонтирование хуков (N-47), чистится сбросом сессии
 * (resetAndClear) и при приёме чужой копии.
 */
let editorTextOwner: string | undefined;

export function getEditorTextOwner(): string | undefined {
  return editorTextOwner;
}

export function markEditorTextOwner(uid: string): void {
  editorTextOwner = uid;
}

export function clearEditorTextOwner(): void {
  editorTextOwner = undefined;
}

/**
 * Снимок текста на момент, когда владелец его лишился (смена аккаунта в той же
 * вкладке). Спасение обязано записать ИМЕННО его: пока спасение в ходу, новый
 * владелец успевает напечатать, буфер становится смешанным, и слова нового
 * владельца чужому адресу не уходят (I3) — они стираются вместе с редактором
 * после подтверждённой записи снимка. Повторы спасения пишут тот же снимок,
 * а не текущий буфер.
 */
const rescuePayloads = new Map<string, LocalDraft>();

export function rememberRescuePayload(uid: string, rec: LocalDraft): LocalDraft {
  const existing = rescuePayloads.get(uid);
  if (existing) return existing;
  rescuePayloads.set(uid, rec);
  return rec;
}

export function takeRescuePayload(uid: string): LocalDraft | undefined {
  const rec = rescuePayloads.get(uid);
  rescuePayloads.delete(uid);
  return rec;
}

/**
 * DW5-2: снимки, ждущие своего владельца. У держателя вкладки нет открытой
 * копии (сейф не назван выключенным — SEC-56), и повтор записи обязан идти не
 * из текущего буфера, а из этого списка: буфер принадлежит новому владельцу.
 */
export function pendingRescuePayloads(): LocalDraft[] {
  return [...rescuePayloads.values()];
}

export function clearAllRescuePayloads(): void {
  rescuePayloads.clear();
}

/**
 * Все правки строки черновика в этой вкладке — одной цепочкой. `applyWrite`
 * (текст) и `rememberCloudSend` (служебные метки) — два read-modify-write в
 * разных транзакциях, и без порядка один из них кладёт обратно строку,
 * прочитанную до чужой записи: теряется либо набор, либо хэш отправки.
 * А хэш, потерянный при обрыве ответа, ровно и нужен. (SF2-1, перенос из
 * `WritingDraftService` без изменений поведения.)
 */
let draftRowWrite: Promise<unknown> = Promise.resolve();

export function queueDraftRowWrite<T>(fn: () => Promise<T>): Promise<T> {
  const run = draftRowWrite.then(fn, fn);
  draftRowWrite = run.catch(() => undefined);
  return run;
}

/**
 * §4.1 DW-4: почему пишется строка. Полный список сразу, чтобы basis не
 * расширялся по шагам; шаг 5 сузил правило эпохи (`isEpochStale`) и перенёс
 * её подъём в мутатор (`applySave`): писатель называет эпоху текста, снятую
 * при правке, и запись с эпохой до сохранения не меняет ни одного адреса.
 */
export type DraftWriteBasis =
  | 'edit'
  | 'post-save'
  | 'adopt-cloud'
  | 'adopt-legacy'
  | 'migrate-guest'
  | 'expire';

/** Куда пишет мутатор: строка IDB (по умолчанию) или LS-дубль закрытия вкладки. */
export type DraftWriteTarget = 'row' | 'copy';

/**
 * 'no-owner' — запись без названного владельца: мутатор отказывает вовсе
 * (I6). 'owner-mismatch' — названный владелец ≠ адресу: текст A не доходит до
 * адресов B (I3) ни при каких отметках времени. Итог обязывают разбирать
 * писатели копии: 'stale-epoch' — ничего не написано, 'vault-cleared' — ключ
 * стёрт и запись строки надо запустить отдельно (ветка Н-2).
 */
export type ApplyWriteOutcome =
  | 'written'
  | 'stale-epoch'
  | 'vault-cleared'
  | 'no-owner'
  | 'owner-mismatch';

export interface ApplyWriteOptions {
  /** Чей адрес: выбор базы и LS-ключа (`draft-<uid>` / `jw_guest_draft`). */
  uid?: string | undefined;
  /** Эпоха на момент правки, названная писателем. Названная не текущая — запись отвергается. */
  epoch?: number | undefined;
  /** Адрес записи; по умолчанию — строка IDB. */
  target?: DraftWriteTarget;
  /**
   * Явный ключ строки IDB вместо `uid`. Только гостевой отсрочке: её строка
   * живёт в общей базе под `guest_draft`, а `uid` гостя — не ключ (DEEP-1:
   * `saveToLocal` с `userId: 'guest'` обязан писать строку по `uid`).
   */
  rowKey?: string | undefined;
}

/**
 * DW4-2: единственный писатель локальных адресов черновика. Строку IDB кладёт
 * в очереди одной цепочкой (с переносом служебных `_cloud*` с прежней строки:
 * писатель строит черновик из редактора и принести их не может); LS-дубль
 * закрытия вкладки пишет синхронно — до первого `await`, уход со страницы не
 * обязан дождаться микрозадачи. Сейф (SEC-56): при включённом шифровании
 * открытой копии в LS не бывает, ключ стирается, а строка базы пишется —
 * «нет дубля» ≠ «запись не нужна».
 *
 * Возвращаемый итог обязывают разбирать писатели копии: 'stale-epoch' — ничего
 * не написано, 'vault-cleared' — ключ стёрт и запись строки надо запустить
 * отдельно (ветка Н-2).
 */
export async function applyWrite(
  rec: DraftRecord,
  basis: DraftWriteBasis,
  opts: ApplyWriteOptions = {},
): Promise<ApplyWriteOutcome> {
  const uid = opts.uid ?? (typeof rec.userId === 'string' ? rec.userId : '');
  const epoch = namedEpoch(rec, basis, opts);
  // Владелец сверяется первым, до эпохи: правило структурное, его исход не
  // зависит от отметок времени. Безымянная запись не проходит вовсе, чужая —
  // не доходит ни до строки, ни до копии (I3).
  const owner = typeof rec.owner === 'string' ? rec.owner : undefined;
  if (owner === undefined) return 'no-owner';
  if (owner !== uid) return 'owner-mismatch';
  // Эпоха сверяется ДО любой записи и синхронно: уход со страницы не успевает
  // положить копию с устаревшей эпохой (DY10-10), а правило одно на все адреса.
  if (isEpochStale(uid, epoch)) {
    return 'stale-epoch';
  }

  if (opts.target === 'copy') {
    const key = uid.startsWith('guest') ? STORAGE_KEYS.GUEST_DRAFT : STORAGE_KEYS.DRAFT(uid);
    if (!uid.startsWith('guest') && useEncryptionStore.getState().getEncryptionEnabled(uid)) {
      try {
        localStorage.removeItem(key);
      } catch (e) {
        reportError(e, { action: 'applyWrite_vaultClear', userId: uid }, 'warning');
      }
      return 'vault-cleared';
    }
    localStorage.setItem(key, JSON.stringify(serializeDraftRow(rec, { kind: 'ls', key })));
    return 'written';
  }

  try {
    const localDb = await getLocalDb(uid);
    // Эпоха могла подняться, пока открывалась база (сохранение заметки в полёте).
    if (isEpochStale(uid, epoch)) {
      return 'stale-epoch';
    }
    // SF-2/SF2-1: серверный штамп принятой облачной версии и хэши отправок —
    // служебные поля локальной копии. Писатель строит черновик из состояния
    // редактора и принести их не может, а терять нельзя: без них спор снова
    // решают часы прибора, и своя же дошедшая запись выглядит чужой.
    const queuedOutcome = await queueDraftRowWrite(async () => {
      // DW5-3.3: очередь — то место, где запись действительно ложится в адрес, а
      // удаление черновика (`deleteDraftLocalPart`, `clearGuestDraft`) идёт мимо
      // неё. Без этой сверки запись, пропустившая проверку до подъёма, дописывает
      // уже удалённую строку, когда очередь освободится.
      if (isEpochStale(uid, epoch)) return 'stale' as const;
      // Ключ строки — `uid`; гостевая отсрочка называет свой `guest_draft`
      // явно (rowKey), чтобы не перехватывать гостевые строки `saveToLocal`.
      const rowKey = opts.rowKey ?? uid;
      const tx = localDb.transaction('drafts', 'readwrite');
      const previous = await tx.store.get(rowKey);
      const seen = rec._cloudUpdatedAt ?? previous?._cloudUpdatedAt;
      const acked = rec._cloudAckedHash ?? previous?._cloudAckedHash;
      const sent = rec._cloudSentHashes ?? previous?._cloudSentHashes;
      const next = serializeDraftRow(rec, { kind: 'idb', key: rowKey });
      if (seen !== undefined) next._cloudUpdatedAt = seen;
      if (acked !== undefined) next._cloudAckedHash = acked;
      if (sent !== undefined) next._cloudSentHashes = sent;
      await tx.store.put(next as unknown as LocalDraft);
      await tx.done;
      return 'written' as const;
    });
    if (queuedOutcome === 'stale') return 'stale-epoch';
    return 'written';
  } catch (err) {
    // Обрыв на устаревшей эпохе — не ошибка писателя, а нормальный отказ: «не
    // записано» вместо исключения, чтобы обрыв в полёте не ронял отчёт.
    if (isEpochStale(uid, epoch)) {
      return 'stale-epoch';
    }
    reportError(err, { action: 'applyWrite', userId: uid });
    // D-1: re-throw so Promise.allSettled sees 'rejected' and localOk is
    // false — prevents the UI from showing "Saved" when the draft is lost.
    throw err;
  }
}
