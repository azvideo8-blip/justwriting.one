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
import { draftDbSchema } from '../../../core/data/schemas';
import { toTimestampMs } from '../../../core/utils/dateUtils';
import { withTimeout } from '../../../shared/utils/withTimeout';
import { maybeDecrypt } from '../../../core/crypto/cryptoHelpers';
import { DataProvider } from '../../../core/data';
import { contentHash } from '../../../core/utils/contentHash';
import { readSentHashes } from '../../../core/sync/sentHashes';
import { reportError } from '../../../shared/errors/reportError';
import { GUEST_DRAFT_TTL_MS, STORAGE_KEYS } from '../../../shared/constants/storageKeys';
import { useEncryptionStore } from '../../../core/crypto/useEncryptionStore';
import { withRateLimitRetry } from '../../../core/services/rateGate';
import { useContentStore } from '../store/useContentStore';

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
      // Отказ разберёт catch ниже; без слушателя `done` стал бы ещё и unhandledrejection (Safari).
      void tx.done.catch(() => undefined);
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

/* ----------------------------------------------------------------- удаления (шаг 6 DW-4) */

/**
 * Отметка удаления: время + ≤32 хэша удалённого содержимого, текста нет. Две
 * копии — sessionStorage `draft-deleted-<uid>` и localStorage
 * `draft-deleted-persistent-<uid>` (AP2-4: вкладочная умирала вместе с вкладкой,
 * и удалённый черновик возвращался из облака).
 */
interface DraftTombstone { deletedAt: number; hashes: string[] }

const TOMBSTONE_MAX_HASHES = 32;

/** Форма `contentHash`: 16 шестнадцатеричных знаков. Отметка чужой строкой не станет. */
const HASH_SHAPE = /^[0-9a-f]{16}$/;

// Fields worth a cloud draft write. The elapsed-time counters (seconds, wpm,
// accumulatedDuration, totalPauseSeconds, updatedAt) are deliberately absent:
// they change on their own while the writer sits still, so including them made
// the 30s cloud autosave rewrite the entire draft — full note content — every
// 30 seconds of an open session, typing or not.
const DRAFT_SIGNIFICANT_FIELDS = [
  'content', 'title', 'pinnedThoughts', 'tags', 'labelId',
  'wordCount', 'initialWordCount', 'activeSessionId', 'savedDocumentId', 'sessionStartTime',
] as const;

/** Строка черновика в любом виде: каноническая запись мутатора или `LocalDraft` читателя. */
export type DraftLike = DraftRecord | LocalDraft;

/** Подпись «а изменилось ли вообще» — по значимым полям, без счётчиков времени. */
export function draftSignature(rec: DraftLike): string {
  const record = rec as unknown as Record<string, unknown>;
  return JSON.stringify(DRAFT_SIGNIFICANT_FIELDS.map(k => record[k] ?? null));
}

/**
 * SF2-1: короткая метка содержимого. Хранить саму подпись нельзя — она включает
 * весь текст черновика, а локальная копия не должна удваиваться ради службы
 * синхронизации.
 */
export function draftPayloadHash(rec: DraftLike): string {
  return contentHash(draftSignature(rec));
}

/** Хэш последних отправленных нагрузок; пустой список — не помним ни одной. */
export function draftSentHashes(rec: DraftLike): string[] {
  return readSentHashes(rec._cloudSentHashes);
}

/** Хэш нагрузки, принятой облаком последней; `undefined` — не помним. */
export function draftAckedHash(rec: DraftLike): string | undefined {
  const hash = rec._cloudAckedHash;
  return typeof hash === 'string' ? hash : undefined;
}

/** Есть ли стор `drafts` в этой базе (старые схемы — нет). */
export function hasDraftsStore(db: { objectStoreNames: DOMStringList }): boolean {
  return db.objectStoreNames.contains('drafts');
}

function parseTombstone(raw: string | null): DraftTombstone | null {
  if (!raw) return null;
  const sep = raw.indexOf('|');
  const deletedAt = parseInt(sep < 0 ? raw : raw.slice(0, sep), 10);
  if (!Number.isFinite(deletedAt)) return null;
  const tail = sep < 0 ? '' : raw.slice(sep + 1);
  return { deletedAt, hashes: tail.split(',').filter(h => HASH_SHAPE.test(h)) };
}

/** AP2-4: читаются обе копии — вкладки и пережившая её. */
export function readTombstone(userId: string): DraftTombstone | null {
  let marks: Array<DraftTombstone | null> = [];
  try { marks = [parseTombstone(sessionStorage.getItem(STORAGE_KEYS.DRAFT_DELETED(userId)))]; } catch (e) { reportError(e, { action: 'loadDraft_sessionStorageRead', userId }); }
  try { marks.push(parseTombstone(localStorage.getItem(STORAGE_KEYS.DRAFT_DELETED_PERSISTENT(userId)))); } catch (e) { reportError(e, { action: 'loadDraft_persistentTombstoneRead', userId }); }
  const found = marks.filter((m): m is DraftTombstone => m !== null);
  if (found.length === 0) return null;
  return {
    deletedAt: Math.max(...found.map(m => m.deletedAt)),
    hashes: [...new Set(found.flatMap(m => m.hashes))],
  };
}

// Ревью AP2: список сливается с прежним — повторное удаление без локальной
// строки иначе стирало хэши, и оставалось одно правило по часам устройства.
// ponytail: хвост в 32 хэша; удалённое раньше давно вытеснено из облака.
export function writeTombstone(userId: string, deletedAt: number, newHashes: string[]): void {
  const hashes = [...new Set([...newHashes, ...(readTombstone(userId)?.hashes ?? [])])].slice(0, TOMBSTONE_MAX_HASHES);
  const value = `${deletedAt}${hashes.length ? `|${hashes.join(',')}` : ''}`;
  try { sessionStorage.setItem(STORAGE_KEYS.DRAFT_DELETED(userId), value); } catch (e) { reportError(e, { action: 'deleteDraft_sessionStorageWrite', userId }); }
  try { localStorage.setItem(STORAGE_KEYS.DRAFT_DELETED_PERSISTENT(userId), value); } catch (e) { reportError(e, { action: 'deleteDraft_persistentTombstone', userId }); }
}

/** BR-1а: отметка досылки облачного удаления — в ЛОКАЛЬНОЙ половине. */
export function clearPendingCloudDelete(userId: string): void {
  try { localStorage.removeItem(STORAGE_KEYS.DRAFT_DELETE_PENDING(userId)); } catch { /* намеренно: отметка — подсказка, не данные */ }
}

function markPendingCloudDelete(userId: string): void {
  try { localStorage.setItem(STORAGE_KEYS.DRAFT_DELETE_PENDING(userId), String(Date.now())); } catch { /* намеренно: без отметки облако снесёт обычная ветка удаления */ }
}

/**
 * SF2/qota: подпись последней реально уехавшей в облако записи. Живёт рядом с
 * мутатором, потому что удаление строки обязано её снять: иначе следующая
 * сессия с тем же текстом получила бы «ничего не изменилось» и не уехала бы.
 */
export const lastCloudSignature = new Map<string, string>();

/** Куда удалять: только локальная половина, только облако или обе. */
export type DraftDeletePart = 'local' | 'cloud' | 'both';

/**
 * Причина удаления. Отдельная от `DraftWriteBasis` перечисления: список записей
 * закрыт шагом 5, а удалять строку приходят по-разному, и журнал обязан
 * различать «человек закрыл черновик» и «копию снес срок».
 */
export type DraftDeleteBasis = 'close' | 'post-save' | 'expire' | 'tombstone';

export interface DraftDeleteOptions {
  /** Гостевой адрес: `guest_draft` + `jw_guest_draft`; надгробия и облачной строки нет (D6). */
  guest?: boolean | undefined;
  /** Явный ключ строки IDB, если uid — не ключ. */
  rowKey?: string | undefined;
  part?: DraftDeletePart | undefined;
}

export interface DraftDeleteResult { localOk: boolean; cloudOk: boolean }

/**
 * §4.1 DW-4: единственное удаление черновика. Подъём эпохи (`applySave`), хэши
 * удалённого, надгробие, отметка BR-1а, строка `drafts` и LS-дубль
 * (`draft-<uid>` / `jw_guest_draft`) — здесь и в одном порядке; облачная
 * половина — там же, где и всегда, с отметкой досылки на отказе.
 *
 * `basis` называет причину (закрытие сохранением, «Удалить», срок, досылка):
 * правило одно на все причины, но журнал обязан различать, кто пришёл удалять.
 *
 * Локальная половина стоит В очереди строки (DW5-3.3 снимал это как дефект):
 * запись, вставшая до удаления, обязана отработать раньше него, иначе она
 * вернёт уже удалённую строку; удаление, вставшее до записи новой сессии, новой
 * строки не сносит — её эпоха поднята после удаления.
 */
export async function applyDelete(
  uid: string,
  basis: DraftDeleteBasis,
  opts: DraftDeleteOptions = {},
): Promise<DraftDeleteResult> {
  if (!uid) return { localOk: true, cloudOk: true };
  const isGuest = opts.guest === true;
  const part = opts.part ?? 'both';
  let localOk = true;
  let cloudOk = true;
  if (part !== 'cloud') localOk = await deleteLocalHalf(uid, isGuest, opts.rowKey, basis);
  // У гостя облачной строки черновика нет — досылать удаление некуда.
  if (!isGuest && part !== 'local') cloudOk = await deleteCloudHalf(uid);
  return { localOk, cloudOk };
}

async function deleteLocalHalf(uid: string, isGuest: boolean, rowKey: string | undefined, basis: DraftDeleteBasis): Promise<boolean> {
  const key = rowKey ?? (isGuest ? GUEST_IDB_KEY : uid);
  // Шаг 5 DW-4: закрытие черновика поднимает эпоху в мутаторе — опоздавшая
  // запись этого текста не вернёт ни один адрес.
  applySave(uid);
  lastCloudSignature.delete(uid);
  // SF2-6/SF3-4: под надгробие ложатся ВСЕ версии удалённого содержимого —
  // последняя правка в строке, принятая облаком и та, что уехала без ответа.
  // Прочитать не удалось (сейф заперт, база сломана, строки нет) — надгробие
  // остаётся временны́м (D1), а не «удаления не было».
  let deletedHashes: string[] = [];
  try {
    const db = await getLocalDb(uid);
    if (hasDraftsStore(db)) {
      const row = await db.get('drafts', key) as DraftRecord | undefined;
      if (row) {
        const acked = draftAckedHash(row);
        deletedHashes = [...new Set([
          draftPayloadHash(row),
          ...(acked !== undefined ? [acked] : []),
          ...draftSentHashes(row),
        ])].filter(h => HASH_SHAPE.test(h));
      }
    }
  } catch (e) { reportError(e, { action: 'deleteDraft_readForHash', userId: uid, basis }); }
  if (!isGuest) {
    writeTombstone(uid, Date.now(), deletedHashes);
    // BR-1а: отметка ставится здесь, а не в облачной половине. Офлайн-финиш
    // (`cleanupDraftsAfterSave` без сети) зовёт только локальную половину, и без
    // отметки старая облачная строка жила бы до следующего удаления.
    markPendingCloudDelete(uid);
  }
  let localOk = true;
  try {
    const db = await getLocalDb(uid);
    await queueDraftRowWrite(async () => {
      if (hasDraftsStore(db)) await db.delete('drafts', key);
    });
  } catch (err) {
    localOk = false;
    reportError(err, { action: 'deleteDraft_local', userId: uid, basis });
  }
  try {
    localStorage.removeItem(isGuest ? STORAGE_KEYS.GUEST_DRAFT : STORAGE_KEYS.DRAFT(uid));
  } catch (e) { reportError(e, { action: 'deleteDraft_legacyLocalStorage', userId: uid }); }
  return localOk;
}

async function deleteCloudHalf(uid: string): Promise<boolean> {
  try {
    await DataProvider.deleteDraft(uid);
    clearPendingCloudDelete(uid);
    return true;
  } catch (err) {
    reportError(err, { action: 'deleteDraft_cloud', userId: uid });
    markPendingCloudDelete(uid);
    return false;
  }
}
const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const CLOUD_READ_TIMEOUT_MS = 10_000;

// Шаг 6 DW-4: сюда же переезжают удаления и чтение строки. У черновика остаётся
// один дом — `applyWrite`, `applyDelete` и `resolve`.

/** Серверная метка облачной версии, которую устройство видело последней; `null` — не помнит. */
function draftCloudSeen(draft: LocalDraft): number | null {
  const seen = (draft as unknown as Record<string, unknown>)._cloudUpdatedAt;
  return typeof seen === 'number' && Number.isFinite(seen) ? seen : null;
}

/**
 * D1-2: сравнивать метку ряда с `deletedAt` (часы этого прибора) можно, только
 * если её поставил он же. У облачной строки после 0043 метка серверная; у копии,
 * принятой из облака, — тоже (она хранит серверный штамп). У правки человека —
 * `Date.now()` прибора.
 */
function draftStampFromDevice(draft: LocalDraft, fromCloud: boolean): boolean {
  if (fromCloud) return false;
  const seen = draftCloudSeen(draft);
  return seen === null || toTimestampMs(draft.updatedAt) !== seen;
}

/**
 * D1-6: срок считает прибор (`Date.now()`), значит и метка черновика обязана быть
 * приборной. У облачной копии после 0043 метку ставит сервер; сравнивать её с
 * часами устройства нельзя — спешащий прибор объявлял свежий чужой черновик
 * просроченным и сносил его вместе с облачной копией.
 */
function isDraftExpired(draft: LocalDraft, fromCloud: boolean): boolean {
  if (!draftStampFromDevice(draft, fromCloud)) return false;
  const updated = toTimestampMs(draft.updatedAt) ?? 0;
  return updated > 0 && Date.now() - updated > DRAFT_MAX_AGE_MS;
}


/**
 * SF-2: спор локальной копии черновика и облачной решается СЕРВЕРНЫМИ метками с
 * обеих сторон, как `markCloudSeen` у заметок.
 *
 * Миграция 0043 перенесла `drafts.updated_at` на часы сервера, а локальную отметку
 * по-прежнему придумывает прибор (`buildLocalDraft`: `updatedAt: Date.now()`).
 * До 0043 оба числа были с одних часов, и сравнение было честным; после 0043 на
 * устройстве, чьи часы отстают больше чем на 60 с, облако побеждает ВСЕГДА:
 * облачную копию писатель отправляет только на заметных изменениях и не чаще раза
 * в 30 с, значит последние минуты набора всегда «старше» серверной метки. Текст
 * перезаписывался через `saveToLocal` — последний набор терялся.
 *
 * При запомненной метке часам прибора нет места в решении: облако новее ровно
 * тогда, когда его `updated_at` ушёл вперёд от версии, которую мы сами приняли.
 * `cloudTs = 0` («метки не прочитали») — локальная копия остаётся: «не знаю» не
 * имеет права означать «облако новее».
 *
 * SF2-1: «метка ушла вперёд» НЕ равно «правку сделал кто-то другой». Облако
 * уходит вперёд и по нашей собственной записи, ответ на которую потерян
 * (`DataProvider.saveDraft` бросает уже после коммита — отметка не запомнена, а
 * строка в облаке лежит). Человек дописывает, приложение перезапускается, и
 * прежняя ветка `cloudTs > cloudSeen` отдавала облаку НАШУ же прошлую версию:
 * дописанное после сгорало в `saveToLocal`. Так же терялся текст между
 * устройствами, когда A правит офлайн после записи B.
 *
 * Различает эти исходы хэш последних ОТПРАВЛЕННЫХ нагрузок:
 *   • `cloudIsOurs` — содержимое облака совпало с одной из последних отправок:
 *     дошла наша запись, ответа мы не видели. Локальная копия новее неё по
 *     построению, затирать её нельзя;
 *   • `localDirty === false` — после принятой записи здесь ничего не менялось:
 *     всё новое в облаке чужое, берём облако (как в SF-2);
 *   • `localDirty === true` и облако чужое — настоящий спор. Он решается ровно
 *     тем правилом, что действовало на `main` до 0043 (коридор 60 с по числу слов,
 *     иначе свежесть), поэтому ни один исход не хуже `main`. «Облачное в
 *     оригинал, своё в копию» из плана §2 для черновика применить нечем: копия у
 *     черновика одна, места для проигравшей нет — это решение владельца.
 *
 * Без запомненной метки и без хэшей (черновики, написанные до правки) остаётся
 * прежнее правило по часам — переходный путь, он живёт один цикл, пока прибор хоть
 * раз не напишется в облако или не примет облачную копию.
 */
export function decideDraftCopy(o: {
  cloudSeen: number | null;
  cloudTs: number;
  localTs: number;
  localWords: number;
  cloudWords: number;
  /** Облачное содержимое совпало с одной из последних отправленных нами нагрузок. */
  cloudIsOurs?: boolean | undefined;
  /** После принятой облачной записи в локальной копии есть правки; `undefined` — не знаем. */
  localDirty?: boolean | undefined;
}): 'cloud' | 'local' {
  /*gate:clock-rule*/
  // Участок правила спора копий: здесь запрещено читать часы устройства
  // (`Date.now()`, `new Date()` без аргумента). Гейт — src/test/syncRuleGates.s06.test.ts (S0-6).
  const byClock = (): 'cloud' | 'local' => {
    if (Math.abs(o.localTs - o.cloudTs) < 60_000) return o.localWords >= o.cloudWords ? 'local' : 'cloud';
    return o.localTs > o.cloudTs ? 'local' : 'cloud';
  };
  if (o.cloudSeen === null) return o.cloudIsOurs ? 'local' : byClock();
  if (o.cloudTs <= o.cloudSeen) return 'local';
  if (o.cloudIsOurs) return 'local';
  if (o.localDirty === true) return byClock();
  return 'cloud';
  /*endgate:clock-rule*/
}


/**
 * N1-4: из двух локальных копий — строки IndexedDB и снимка закрытия вкладки
 * (`draft-<uid>`, W14 `useDraftCore.ts:272-284`) — берётся НОВЕЕ по `updatedAt`.
 * Прежний выбор `localDraft || legacyDraft` читал копию только когда строки нет
 * совсем: набранное в отсрочке между правкой и записью в базу проигрывало более
 * старой строке, а `clearLegacyDraft` (`useSessionPersistence.ts:109`) стирал
 * ключ с этими словами — потеря окончательная.
 *
 * Ничья и «даты нет» — IndexedDB: у строки полная форма, у копии — снимок.
 *
 * Поля, которых в снимке нет, доезжают со строкой: без `savedDocumentId`
 * следующее сохранение завело бы БУКВУ вместо версии (тот же класс, что DW-F-2 у
 * гостя), а без `_cloudUpdatedAt`/`_cloudAckedHash`/`_cloudSentHashes` следующий
 * спор с облаком потерял бы память и вернулся к часам (SF-2, SF2-1).
 *
 * Это единственная функция выбора локальной копии; спор с облаком
 * (`decideDraftCopy`) остаётся над ней и работает с уже выбранной копией.
 */
const UNLOAD_COPY_GAPS: readonly string[] = [
  'savedDocumentId', 'accumulatedDuration', 'totalPauseSeconds', 'initialWordCount',
  '_cloudUpdatedAt', '_cloudAckedHash', '_cloudSentHashes',
];

/** Копия проигравшего адреса не выбрасывается: поля, которых в ней нет, доезжают. */
function withCarriedFields(winner: LocalDraft, other: LocalDraft): LocalDraft {
  const carried: Record<string, unknown> = {};
  for (const field of UNLOAD_COPY_GAPS) {
    const key = field as keyof LocalDraft;
    if (winner[key] === undefined && other[key] !== undefined) {
      carried[field] = other[key];
    }
  }
  return Object.keys(carried).length > 0
    ? ({ ...winner, ...carried } as unknown as LocalDraft)
    : winner;
}

export function pickNewerLocalCopy(
  idb: LocalDraft | null,
  unload: LocalDraft | null,
): LocalDraft | null {
  if (!idb) return unload;
  if (!unload) return idb;

  // Самопроверка (сверка 27): сравнивать можно только часы одного прибора (D1-2).
  // Метка строки базы бывает СЕРВЕРНОЙ — когда копия была принята из облака
  // (`saveToLocal({ ...cloudDraft, _cloudUpdatedAt: cloudTs })`, и у такой копии
  // `updatedAt` = `draftCloudSeen`). На приборе, который отстаёт от сервера,
  // правило «больше по числу» снова отдавало старую облачную строку и теряло
  // последние слова, то есть N1-4 работал только при точных часах.
  // Копия закрытия вкладки штампуется прибором (`useDraftCore.ts:283`) и живёт в
  // адресе только если после последней принятой локальной записи случилось
  // закрытие: `persistDraft` снимает ключ на каждой удачной записи
  // (`draftPersistence.ts:80-82`), а удаление — в обеих половинах. Значит она —
  // работа более поздняя. Даты в копии нет — не угадываем, остаётся строка.
  if (!draftStampFromDevice(idb, false)) {
    return toTimestampMs(unload.updatedAt) === null
      ? withCarriedFields(idb, unload)
      : withCarriedFields(unload, idb);
  }

  const idbTs = toTimestampMs(idb.updatedAt) ?? 0;
  const unloadTs = toTimestampMs(unload.updatedAt) ?? 0;
  return unloadTs > idbTs ? withCarriedFields(unload, idb) : withCarriedFields(idb, unload);
}

/**
 * AP2-4: облачное удаление, не дошедшее в прошлый раз, досылается при загрузке.
 * Приёмка 0.10.6: только если в облаке лежит ИМЕННО удалённое содержимое (хэш из
 * надгробия). После неудачного удаления в облако мог уехать новый черновик — с
 * этого устройства или с другого; слепое удаление стёрло бы его облачную копию.
 * Не прочиталось — ничего не удаляем и отметку держим: «нет ответа» не «можно».
 */
async function flushPendingCloudDelete(userId: string, deletedHashes: readonly string[]): Promise<void> {
  try {
    if (localStorage.getItem(STORAGE_KEYS.DRAFT_DELETE_PENDING(userId)) === null) return;
  } catch { return; }
  try {
    const row = await DataProvider.getDraft(userId);
    if (!row) { clearPendingCloudDelete(userId); return; }
    const parsed = draftDbSchema.safeParse(await maybeDecrypt(row, ['content', 'title'], ['pinnedThoughts', 'tags']));
    if (!parsed.success) return;
    if (!deletedHashes.includes(draftPayloadHash(parsed.data as unknown as DraftRecord))) {
      clearPendingCloudDelete(userId);
      return;
    }
    await applyDelete(userId, 'tombstone', { part: 'cloud' });
  } catch (e) {
    reportError(e, { action: 'deleteDraft_retry', userId });
  }
}


/** Флаг «облако прочесть нельзя, пока сейф заперт» (S-4): по нему `useSessionPersistence`
 *  не гасит повтор загрузки — при открытии сейфа черновик надо прочесть заново. */
let cloudDraftLocked = false;
export function isCloudDraftLocked(): boolean { return cloudDraftLocked; }

/**
 * «Не прочитали» — не «там пусто»: строка черновика в облаке одна, и слепой `upsert`
 * затёр бы единственную копию, которую мы не увидели. Отправка ждёт удачного чтения,
 * повтор держит `useSessionPersistence`.
 */
const cloudDraftUnread = new Set<string>();
export function isCloudDraftUnread(uid: string): boolean { return cloudDraftUnread.has(uid); }

export interface ResolveOptions {
  /** Гостевой черновик: кандидатов два (`guest_draft` и `jw_guest_draft`), облака и надгробия нет. */
  guest?: boolean | undefined;
}

/**
 * DW6-5.2 + ревьюер 04.11: в редакторе есть что терять — текст, набранный и во
 * время чтения, и до него, заголовок тоже. Удаление подняло бы эпоху, и автосохранение
 * этого набранного дальше отказывало бы при висящем «Сохранено». Строка доживёт до
 * следующего чтения; лишняя строка дешевле потерянного текста.
 */
function editorHoldsWork(): () => boolean {
  const start = useContentStore.getState();
  return () => {
    const now = useContentStore.getState();
    return now.content !== start.content || now.title !== start.title
      || now.content.trim() !== '' || now.title.trim() !== '';
  };
}

/**
 * §4.1 DW-4, шаг 6: единственное чтение черновика при загрузке. Кандидаты —
 * IDB-строка, LS-дубль и облако; правило выбора (`decideDraftCopy`) перенесено
 * без изменений; надгробие и срок решают исход. Побочные записи читающего —
 * только `applyWrite(..., 'adopt-*')` и `applyDelete(..., 'expire' | 'tombstone')`,
 * то есть видимы в очереди строки и в одном мутаторе. `loadDraft` удалена, а не
 * оставлена обёрткой: второй точки чтения быть не должно (§4.3.1).
 *
 * Главная ловушка этого репо (I7): неудачное чтение — НЕ «ничего нет».
 * `localFailed` и отказ/таймаут облака пережиты из прежней `loadDraft` дословно:
 * при сбое локальной половины ничего не удаляется, а облачная копия не затирает
 * локальную и не кэшируется в неё.
 */
export async function resolve(uid: string, opts: ResolveOptions = {}): Promise<LocalDraft | null> {
  if (opts.guest === true) return resolveGuest(uid);
  if (!uid) return null;

  // SF2-6/SF3-4/AP2-4: хэши ТОГО, что удалили, читаются с обеих копий надгробия.
  const tombstone = readTombstone(uid);
  const deletedAt = tombstone?.deletedAt ?? 0;
  const deletedHashes = tombstone?.hashes ?? [];
  /** Черновик, удалённый на этом устройстве: по содержимому, а не по часам. */
  const isDeletedDraft = (draft: LocalDraft): boolean =>
    deletedHashes.includes(draftPayloadHash(draft));
  /**
   * D1-2: надгробие судит по хэшу. Временна́я ветка остаётся только для метки,
   * поставленной этим прибором: серверную метку облачной строки сравнивать с
   * `deletedAt` нельзя — спешащие часы объявляли чужой свежий черновик «старее
   * удаления», и он сносился из облака. Не знаем — не удаляем.
   */
  const isDeletedByTombstone = (draft: LocalDraft, fromCloud: boolean): boolean => {
    if (!deletedAt) return false;
    if (isDeletedDraft(draft)) return true;
    if (!draftStampFromDevice(draft, fromCloud)) return false;
    return (toTimestampMs(draft.updatedAt) ?? 0) <= deletedAt;
  };

  // DW6-5.2: буфер редактора на момент начала чтения. Правка, пришедшая, пока
  // читали базу и облако, — знак, что экран больше не тот, о котором решал
  // `resolve`: поднимать эпоху и сносить строку нельзя, на экране стоит
  // набранное, а закрытый черновик автосохранение больше не пишет (I1).
  const editorMoved = editorHoldsWork();

  // DW6-5.1: эпоха снимается ДО чтения. Чтение облака занимает до 10 с, и за это
  // время заметка может быть сохранена (или черновик закрыт) — подъём эпохи.
  // Принятие облачной копии обязано назвать ЭТУ эпоху: опоздавшую запись отвергает
  // мутатор, и старый облачный черновик не ложится поверх свежей работы.
  const readEpoch = getDraftGeneration(uid);
  await flushPendingCloudDelete(uid, deletedHashes);

  let cloudUnparsed = false;
  const [localResult, legacyResult, cloudResult] = await Promise.allSettled([
    (async () => {
      const localDb = await getLocalDb(uid);
      if (hasDraftsStore(localDb)) {
        return await localDb.get('drafts', uid) ?? null;
      }
      return null;
    })(),
    (async () => {
      const raw = localStorage.getItem(STORAGE_KEYS.DRAFT(uid));
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.content) return { ...parsed, userId: uid } as LocalDraft;
      }
      return null;
    })(),
    withTimeout((async () => {
      // Дейлик 05.11: 429 — «помедленнее», а не отказ чтения.
      const draftData = await withRateLimitRetry(() => DataProvider.getDraft(uid));
      if (draftData) {
        const decrypted: unknown = await maybeDecrypt(draftData, ['content', 'title'], ['pinnedThoughts', 'tags']);
        // Битый облачный черновик не доходит до таймеров и сравнений дат:
        // локальная копия побеждает, мусор в состояние приложения не входит.
        const parsed = draftDbSchema.safeParse(decrypted);
        if (!parsed.success) {
          cloudUnparsed = true;
          reportError(parsed.error, { action: 'loadDraft_cloud_invalid', userId: uid });
          return null;
        }
        return parsed.data as unknown as LocalDraft;
      }
      return null;
    })(), CLOUD_READ_TIMEOUT_MS),
  ]);

  // Ревьюер 04.11: черновик закрыли, пока читали. Прочитанная до этого копия — уже
  // сохранённый или удалённый текст: черновиком он не возвращается (DY10-10), а
  // решать о новых записях по такому чтению нельзя.
  if (isDraftClosed(uid, readEpoch)) return null;

  const localFailed = localResult.status === 'rejected';
  if (localFailed) {
    reportError(localResult.reason, { action: 'loadDraft_local_failed', userId: uid });
  }
  const localDraft: LocalDraft | null = localResult.status === 'fulfilled' ? localResult.value : null;

  const legacyFailed = legacyResult.status === 'rejected';
  if (legacyFailed) {
    reportError(legacyResult.reason, { action: 'loadDraft_legacy_failed', userId: uid });
  }
  const legacyDraft: LocalDraft | null = legacyResult.status === 'fulfilled' ? legacyResult.value : null;
  let cloudDraft: LocalDraft | null = null;

  if (cloudResult.status === 'fulfilled') {
    cloudDraft = cloudResult.value;
    cloudDraftLocked = false;
    cloudDraftUnread.delete(uid);
  } else {
    const reason = cloudResult.reason as Error | undefined;
    if (
      reason?.message?.startsWith('LOCKED') ||
      reason?.message?.includes('session key not available')
    ) {
      cloudDraftLocked = true;
    } else if (reason?.name !== 'DecryptionError') {
      // Строку прочитали, но она нечитаема (битая, чужая): ответ есть, повтор его не
      // изменит. Как и строку, не прошедшую схему, её заменяет следующая отправка.
      cloudDraftUnread.add(uid);
    }
  }

  // N1-4: новая из двух локальных копий, а не «IndexedDB, если он вообще есть».
  const resolvedLocal = pickNewerLocalCopy(localDraft, legacyDraft);

  if (resolvedLocal && cloudDraft) {
    const localTs = toTimestampMs(resolvedLocal.updatedAt) ?? 0;
    const cloudTs = toTimestampMs(cloudDraft.updatedAt) ?? 0;
    // SF2-1: два признака, которых часовому правилу не хватало. Хэш облачной
    // строки считается по прочитанной (расшифрованной) копии, поэтому совпадает
    // с хэшем отправленной нагрузки ровно тогда, когда в облаке лежит ОНА ЖЕ.
    // Отсутствие хэшей — «не знаю», и правило остаётся прежним.
    const sentHashes = draftSentHashes(resolvedLocal);
    const ackedHash = draftAckedHash(resolvedLocal);
    const cloudHash = draftPayloadHash(cloudDraft);
    const winner: LocalDraft = decideDraftCopy({
      cloudSeen: draftCloudSeen(resolvedLocal),
      cloudTs,
      localTs,
      localWords: resolvedLocal.wordCount ?? 0,
      cloudWords: cloudDraft.wordCount ?? 0,
      cloudIsOurs: sentHashes.includes(cloudHash),
      localDirty: ackedHash === undefined ? undefined : draftPayloadHash(resolvedLocal) !== ackedHash,
    }) === 'cloud' ? cloudDraft : resolvedLocal;
    if (isDeletedByTombstone(winner, winner === cloudDraft)) {
      // BR-1 (б): надгробие догнало облачный победитель — это та строка, что
      // удалили на этом приборе. Локальная копия при этом своя, новая работа, и
      // полное удаление снесло бы её вместе с облаком.
      if (winner === cloudDraft && !isDeletedByTombstone(resolvedLocal, false) && !isDraftExpired(resolvedLocal, false)) {
        await applyDelete(uid, 'tombstone', { part: 'cloud' }); // намеренно: исход облака не меняет ответ — при отказе половина сама держит отметку досылки
        return resolvedLocal;
      }
      // DW6-5.2: на экране уже другая работа — удаление закрыло бы её. Решение
      // остаётся неотложенным: строка доживёт до следующего чтения.
      if (!localFailed && !editorMoved()) await applyDelete(uid, 'tombstone'); // намеренно: удаление удалённого черновика
      return null;
    }
    if (isDraftExpired(winner, winner === cloudDraft)) {
      if (!localFailed && !editorMoved()) await applyDelete(uid, 'expire'); // намеренно: удаление просроченного черновика
      return null;
    }
    // Ревью кандидата: человек печатает — строку облачной копией не трогаем, иначе набранное
    // до следующей правки лежит только на экране. Ответ остаётся: решает вызывающий.
    if (winner === cloudDraft && !localFailed && !editorMoved()) {
      // SF-2/SF2-1/SF3-1: принятая копия запоминает СВОЮ серверную метку, свой
      // хэш и закрывает список неотправленных — иначе следующий спор решили бы
      // часы прибора, а своя же дошедшая запись выглядела бы чужой.
      const adopted = await applyWrite(
        { ...cloudDraft, owner: uid, _cloudUpdatedAt: cloudTs, _cloudAckedHash: cloudHash, _cloudSentHashes: [cloudHash] } as DraftRecord,
        'adopt-cloud',
        { uid, epoch: readEpoch },
      ).catch(() => 'failed' as const);
      // DW6-5.1: эпоха поднялась, пока читали облако, — строку не тронули, и
      // прошлый облачный черновик показывать нельзя: здесь есть своя новая копия.
      if (adopted === 'stale-epoch') return isDraftClosed(uid, readEpoch) ? null : resolvedLocal;
    }
    return winner;
  }
  const resolved = resolvedLocal || cloudDraft;
  if (resolved) {
    // Дейлик 05.11 Н-1: облако не прочитано — не «облака нет». Удаляем только свою половину;
    // отметка досылки уже стоит, и досылка сверит хэш, когда облако ответит.
    const unreadCloudKept = cloudResult.status === 'rejected' || cloudUnparsed ? { part: 'local' as const } : {};
    if (isDeletedByTombstone(resolved, resolved === cloudDraft)) {
      if (!localFailed && !editorMoved()) await applyDelete(uid, 'tombstone', unreadCloudKept); // намеренно: удаление удалённого черновика
      return null;
    }
    if (isDraftExpired(resolved, resolved === cloudDraft)) {
      if (!localFailed && !editorMoved()) await applyDelete(uid, 'expire', unreadCloudKept); // намеренно: удаление просроченного черновика
      return null;
    }
    if (resolved === cloudDraft && !localFailed) {
      // SF3-1: принятая копия — она же единственная отправка, о которой мы знаем.
      const acceptedHash = draftPayloadHash(cloudDraft);
      const adopted = await applyWrite(
        { ...cloudDraft, owner: uid, _cloudUpdatedAt: toTimestampMs(cloudDraft.updatedAt) ?? undefined, _cloudAckedHash: acceptedHash, _cloudSentHashes: [acceptedHash] } as DraftRecord,
        'adopt-cloud',
        { uid, epoch: readEpoch },
      ).catch(() => 'failed' as const);
      // Тот же DW6-5.1: локальной строки нет, а эпоха поднялась во время чтения —
      // значит здесь закрыли черновик или сохранили заметку. Прошлый облачный
      // текст в редактор не кладём; сам он остаётся в облаке непроявленным.
      if (adopted === 'stale-epoch' && isDraftClosed(uid, readEpoch)) return null;
    }
  }
  return resolved;
}

/**
 * Гостевое чтение (W13, D12): две копии — строка `guest_draft` в общей базе и
 * ключ `jw_guest_draft`. Новейшая по `updatedAt ?? timestamp` побеждает, ничья —
 * IndexedDB; проигравшая кэшируется в строку через мутатор (прежний `db.put` шёл
 * мимо него), а просроченная стирается из обоих адресов. Отказ прочтения — не
 * «черновика нет»: без прочитанной строки не пишем и не удаляем (I7).
 */
async function resolveGuest(uid: string): Promise<LocalDraft | null> {
  // DW6-5.2: то же правило, что и для аккаунта, — гостевой черновик читают без
  // облака, но редактор в этот момент живой.
  const editorMoved = editorHoldsWork();
  let idbDraft: DraftRecord | null = null;
  let idbFailed = false;
  try {
    const db = await getLocalDb(uid);
    if (hasDraftsStore(db)) idbDraft = parseDraftRow(await db.get('drafts', GUEST_IDB_KEY));
  } catch (e) {
    idbFailed = true;
    reportError(e, { action: 'loadGuestDraft_idb' }, 'warning');
  }

  let lsDraft: DraftRecord | null = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.GUEST_DRAFT);
    if (raw) lsDraft = parseDraftRow(JSON.parse(raw));
  } catch (e) {
    reportError(e, { action: 'loadGuestDraft_ls_read' }, 'warning');
    try {
      localStorage.removeItem(STORAGE_KEYS.GUEST_DRAFT);
    } catch { /* намеренно: битый ключ чистим, гостя не ломаем */ }
  }

  let winner: DraftRecord | null;
  if (idbDraft && lsDraft) {
    const idbTs = idbDraft.updatedAt ?? idbDraft.timestamp ?? 0;
    const lsTs = lsDraft.updatedAt ?? lsDraft.timestamp ?? 0;
    winner = idbTs >= lsTs ? idbDraft : lsDraft;
    if (winner === lsDraft && !idbFailed) {
      await applyWrite(winner, 'adopt-legacy', { uid, target: 'row', rowKey: GUEST_IDB_KEY })
        .catch(e => reportError(e, { action: 'loadGuestDraft_ls_sync' }, 'warning'));
    }
  } else if (lsDraft && idbFailed) {
    // Ревью кандидата: база не читается, копия — единственный адрес (`GuestDraftService` так и
    // обещает). «Черновика нет» отдало бы пустой редактор, и следующая запись затёрла бы её.
    winner = lsDraft;
  } else if (lsDraft && !idbDraft) {
    winner = lsDraft;
    await applyWrite(lsDraft, 'adopt-legacy', { uid, target: 'row', rowKey: GUEST_IDB_KEY })
      .catch(e => reportError(e, { action: 'loadGuestDraft_ls_restore' }, 'warning'));
  } else {
    winner = idbDraft;
  }

  if (winner) {
    const stamp = winner.updatedAt ?? winner.timestamp;
    if (typeof stamp === 'number' && stamp > 1_000_000_000_000 && Date.now() - stamp > GUEST_DRAFT_TTL_MS) {
      // Просроченное не показывается; при набранном тексте его ещё и не удаляют
      // (DW6-5.2) — стирание закрыло бы новую работу гостя.
      if (editorMoved() || idbFailed) return null;
      await applyDelete(uid, 'expire', { guest: true });
      return null;
    }
  }
  return (winner as LocalDraft | null) ?? null;
}
