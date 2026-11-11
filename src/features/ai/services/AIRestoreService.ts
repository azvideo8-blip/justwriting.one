import { getLocalDb } from '../../../core/storage/localDb';
import type { AIDocumentSummary, AIDocumentEmbedding, AITimelineEntry, AIProfileFacet, AIDialogue } from '../../../core/storage/localDb';
import { DataProvider } from '../../../core/data';
import { mergeDialogues, dialogueFingerprint, isTombstoned } from '../../../core/storage/dialogueMerge';
import { contentHash } from '../../../core/utils/contentHash';
import { pageTextOf, parseLocalStoreKey, selectCloudVersion, PAGE_TEXT_FIELDS, type CloudRow } from '../../../core/services/localStorePages';
import {
  HEAD_TEXT_FIELDS,
  SEGMENT_TEXT_FIELDS,
  headKeyOfRow,
  readSegmentVersion,
} from '../../../core/services/dialogueSegments';
import { LocalVersionService } from '../../../core/services/LocalVersionService';
import { sha256Hex, isEmbeddingFresh } from '../utils/embeddingIndexer';
import { getSessionKey } from '../../../core/crypto/encrypt';
import { getEncryptionEnabled, maybeDecrypt } from '../../../core/crypto/cryptoHelpers';
import {
  extractRecordTimestamp,
  LocalStoreSyncService,
  SUPPORTED_LOCAL_STORES,
  SupportedLocalStoreName,
  MAX_RESTORE_RECORD_BYTES,
  getPendingStoreDeleteKeys,
  getPendingUpsertKeySet,
  cloudFormOf,
  keepLocalVector,
  carriesSyncedVector,
  CLOUD_STAMP_FIELD,
  CLOUD_BASE_HASH_FIELD,
} from '../../../core/services/LocalStoreSyncService';

import { reportError } from '../../../shared/errors/reportError';
import { logger } from '../../../shared/errors/logger';
import { decodeCloudSummary } from './AISummaryService';
import { decodeCloudEmbedding } from './AIEmbeddingService';
import { useActivityLogStore } from '../../../shared/activity/useActivityLogStore';
import { writeFacetStore } from '../../../core/services/facetLock';
import { localDayKey, localMonthKey } from '../../../core/utils/dateUtils';
import { getPendingAnalysisDeleteKeys } from './pendingAnalysisDeletes';
import { getCurrentUser } from '../../../core/auth';
import { isExcludedFromAI } from '../utils/isExcludedFromAI';
import { invalidateEmbeddingIndexCache } from '../../../core/services/embeddingIndexCache';
import { useAIStageStore } from '../store/useAIStageStore';
import {
  requestEmbeddingRestore, isEmbeddingRestoreRequested,
  clearEmbeddingRestoreRequest,
  isEmbeddingRestoreStarted, markEmbeddingRestoreStarted,
  isEmbeddingRestoreDone, markEmbeddingRestoreDone, clearEmbeddingRestoreDone,
  clearEmbeddingRestoreStarted,
  getEmbeddingRestoreCursor, setEmbeddingRestoreCursor, clearEmbeddingRestoreCursor,
  isEmbeddingRestoreStuck, noteEmbeddingRestoreProgress, clearEmbeddingRestoreStall,
} from './embeddingRestoreState';

/**
 * П-6 (замер 08.10.2026): семантический индекс догружается из облака сам, если
 * локально векторов нет хотя бы для половины заметок, доступных ИИ. Кнопка в
 * диагностике осталась и значит «форсировать»: ею можно запустить догрузку
 * поверх завершённой или при целом локальном индексе. Флаги и курсор — в
 * ./embeddingRestoreState; наружу сервис отдаёт их как раньше (UI диагностики и
 * тесты импортируют сервис).
 */
export { requestEmbeddingRestore, isEmbeddingRestoreRequested };

/**
 * П-6: догружать ли векторы автоматически.
 *
 * Запуск — свежих локальных векторов нет хотя бы для половины заметок, доступных
 * ИИ. Порог именно «половина», а не «ноль»: на устройстве, где индекс недостроен
 * на треть, догрузка тоже выгоднее пересчёта. Начатая догрузка продолжается и
 * при покрытии выше порога, иначе она встала бы на середине архива и остаток
 * пришлось бы пересчитывать через ИИ — ровно то, чего П-6 и избегает.
 *
 * Флаг «догрузка завершена» снимается только вручную (кнопка в диагностике) —
 * кроме случая, когда локальных векторов нет совсем: это свежее или очищенное
 * устройство, и начинать надо заново.
 *
 * Во время хода чата догрузка не идёт: `useAIStageStore.stage` — уже тот признак
 * занятости, который чат выставляет на время сборки контекста и генерации.
 */
async function shouldAutoDownloadVectors(
  userId: string,
  db: Awaited<ReturnType<typeof getLocalDb>>,
): Promise<boolean> {
  const embeddings = await db.getAll('aiEmbeddings');
  if (isEmbeddingRestoreDone(userId)) {
    if (embeddings.length > 0) return false;
    clearEmbeddingRestoreDone(userId);
    clearEmbeddingRestoreStarted(userId);
  }
  if (useAIStageStore.getState().stage !== null) return false;
  const visible = (await db.getAll('documents')).filter(d => !isExcludedFromAI(d));
  if (visible.length === 0) return false;
  if (isEmbeddingRestoreStarted(userId)) return true;
  const fresh = embeddings.filter(e => isEmbeddingFresh(e)).length;
  return fresh * 2 < visible.length;
}

/**
 * Совпадает ли облачный вектор с текущим текстом заметки. Локального текста нет
 * (заметка ещё не приехала) или хэш не записан — сравнивать нечего, запись
 * принимается как раньше: `reattachOrphanedAnalysis` довяжет её позже.
 *
 * R7F-010: заметка есть локально и она скрыта или в корзине — не принимается:
 * это лишняя копия текста скрытой записи, и её не за кем пересчитывать.
 */
export async function cloudVectorMatchesNote(decoded: AIDocumentEmbedding): Promise<boolean> {
  if (!decoded.contentHash) return true;
  const db = await getLocalDb();
  const doc = await db.get('documents', decoded.documentId);
  if (!doc) return true;
  if (isExcludedFromAI(doc)) return false;
  const content = await LocalVersionService.getLatestContent(decoded.documentId);
  if (!content) return true;
  return (await sha256Hex(content)) === decoded.contentHash;
}

/** Контекст одного прохода догрузки: что уже есть локально и что нельзя принимать. */
interface EmbeddingRunContext {
  db: Awaited<ReturnType<typeof getLocalDb>>;
  existing: Set<string>;
  deleted: { has(id: string): boolean };
  needsRepair: boolean;
  cloudHashes: Set<string>;
}

/**
 * В-2: страницы облачного списка обрабатываются по мере чтения. Возвращает число
 * записей, которые УПАЛИ (сбой расшифровки или записи), — не сознательные пропуски
 * по хэшу или по удалению. По нему догрузка решает, переступать ли курсор за эту
 * страницу: переступила — и записи страницы потеряны навсегда, следующий проход
 * начнёт за ними, а недостающее `indexPending` пересчитает через ИИ.
 */
async function consumeEmbeddingPage(
  rows: Record<string, unknown>[],
  ctx: EmbeddingRunContext,
  counters: { embeddings: number; failed: number },
): Promise<number> {
  let errored = 0;
  for (const d of rows) {
    const dId = d.id as string;
    if (ctx.deleted.has(dId)) continue;
    const alreadyLocal = ctx.existing.has(dId);
    // Decoding an already-local record is pure CPU, no extra quota — worth it
    // only when there is something to repair.
    if (alreadyLocal && !ctx.needsRepair) continue;
    try {
      const decoded = await decodeCloudEmbedding(d, dId);
      if (decoded.contentHash) ctx.cloudHashes.add(decoded.contentHash);
      if (!alreadyLocal) {
        // П-6: облачный вектор описывает тот текст, с которого его считали.
        // Совпал хэш — запись закрывает заметку; не совпал — заметка ждёт
        // пересчёта, а не получает вектор от чужого текста.
        if (!(await cloudVectorMatchesNote(decoded))) continue;
        await ctx.db.put('aiEmbeddings', { ...decoded, cloudSyncedAt: Date.now() });
        counters.embeddings++;
        // X-5: индекс построен по старому набору — сбрасываем на любой
        // привезённой записи.
        invalidateEmbeddingIndexCache();
      }
    } catch {
      counters.failed++;
      errored++;
    }
  }
  return errored;
}

/**
 * В-1 (замер 08.10.2026): потолок и шаг догрузки. Наследство июля — 10 строк на
 * чтение и 100 за проход — было задумано, когда читать было дороже, чем
 * пересчитывать; с тех пор цена перевернулась, а на прежнем потолке архив в 1000
 * заметок догружался десять суток (полный проход — раз в сутки). 300 за проход
 * страницами по 50 дают тот же расход чтений, но догрузка заканчивается за
 * несколько фоновых проходов.
 */
const EMBED_PAGE = 50;
const EMBED_MAX_PER_RUN = 300;

export interface EmbeddingDownloadOutcome {
  embeddings: number;
  failed: number;
  markedSynced: number;
  /** Догрузка закрыта этим проходом: курсор исчерпан либо сработала страховка В-1. */
  finished: boolean;
}

/** Что один проход догрузки пишет в счётчики. */
type EmbeddingCounters = Pick<EmbeddingDownloadOutcome, 'embeddings' | 'failed' | 'markedSynced'>;

const NO_DOWNLOAD: EmbeddingDownloadOutcome = { embeddings: 0, failed: 0, markedSynced: 0, finished: false };

/**
 * DE-2: сколько проходов head без своих окон держит курсор. Писатель подписывает
 * head последним, когда все окна уже в облаке, — так что дольше это не выгрузка в
 * пути, а оборванная копия. Чинит её писатель новым head'ом, и триггер 0037 даёт
 * строке новую `stamped_at`, новее курсора. Без предела каждый фоновый проход
 * заново качал и применял всё, что новее осиротевшего head. Считаем проходы, а не
 * часы устройства: часы в решениях забора запрещены (S0-6).
 */
// C7: считают оба прохода — и инкрементальный, и полный. Полный нужен: head старше
// окна забора видит только он. В одном runPass без суточной отметки идут оба, так
// что 6 проходов ≈ 3 runPass; с отметкой — 6 инкрементальных.
const INCOMPLETE_HOLD_PASSES = 6;
// ponytail: отпущенные head'ы помним последними 200 ключами; новый head = новый
// ключ (в нём stamped_at), старые выпадают сами — без часов (S0-6).
const RELEASED_HOLDS_CAP = 200;
const incompleteHoldsKey = (userId: string): string => `ai_incomplete_holds_${userId}`;

/** Нечитаемый счётчик — заново с нуля: хуже станет только лишний перезабор. */
function readIncompleteHolds(userId: string): Record<string, number> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(incompleteHoldsKey(userId)) ?? '{}');
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, number> : {};
  } catch {
    return {};
  }
}

/**
 * Local records the cloud already holds, marked so they are not re-uploaded.
 * Anything whose content hash the cloud already holds is present there under SOME
 * key — re-attach re-keys locally and the hash finds it again after a wipe, so
 * uploading it again buys nothing and costs a burst of multi-hundred-KB vector
 * writes. Missing this is how the daily write quota went twice in one day.
 */
async function embeddingRunContext(
  userId: string,
  db: Awaited<ReturnType<typeof getLocalDb>>,
  deleted: { has(id: string): boolean },
): Promise<EmbeddingRunContext> {
  const local = await db.getAll('aiEmbeddings');
  return {
    db,
    existing: new Set(local.map(e => String(e.documentId))),
    deleted,
    needsRepair: local.some(
      e => e.cloudSyncedAt === undefined && e.cloudSkipped !== true && Boolean(e.contentHash),
    ),
    cloudHashes: new Set<string>(),
  };
}

/** Курсор исчерпан или догрузка закрыта: автоматический проход больше не начинается. */
function closeEmbeddingRestore(userId: string): void {
  markEmbeddingRestoreDone(userId);
  clearEmbeddingRestoreRequest(userId);
  clearEmbeddingRestoreCursor(userId);
  clearEmbeddingRestoreStall(userId);
}

/**
 * В-1: один проход догрузки — страницы облачного списка, начиная с курсора.
 * Курсор переступает только полностью обработанную страницу (В-2). Две страховки
 * от вечного ожидания: сутки «в пути» и три прохода без продвижения курсора
 * закрывают догрузку, и `indexPending` возвращается к обычному пересчёту того,
 * чего в облаке не оказалось. Счётчики пишет в `counters` вызывающего: падение
 * чтения облака посреди прохода не должно обнулять уже привезённое.
 */
async function runEmbeddingDownload(
  userId: string,
  ctx: EmbeddingRunContext,
  counters: EmbeddingCounters,
): Promise<boolean> {
  if (isEmbeddingRestoreStuck(userId)) {
    closeEmbeddingRestore(userId);
    return true;
  }

  const startCursor = getEmbeddingRestoreCursor(userId);
  let cursorId: string | undefined = startCursor || undefined;
  let exhausted = false;
  let read = 0;
  while (read < EMBED_MAX_PER_RUN) {
    const res = await DataProvider.getUserEmbeddingsPaginated(userId, EMBED_PAGE, cursorId);
    // N-39: конец списка решает число строк, которые отдал сервер (readCount),
    // а не число своих после фильтра владельца: одна чужая строка в странице
    // иначе объявляла восстановление законченным и снимала флаг.
    if (res.readCount === 0) { exhausted = true; break; }

    const errored = await consumeEmbeddingPage(res.items, ctx, counters);
    read += res.items.length;
    // В-2: упавшая страница остаётся за курсором — повтор начнёт с неё же.
    if (errored > 0) break;
    // Курсора нет — продолжать нечем: за последней страницей список кончился.
    if (res.readCount < EMBED_PAGE || !res.nextCursorId) { exhausted = true; break; }
    setEmbeddingRestoreCursor(userId, res.nextCursorId);
    cursorId = res.nextCursorId;
  }

  if (ctx.needsRepair && ctx.cloudHashes.size > 0) {
    for (const e of await ctx.db.getAll('aiEmbeddings')) {
      if (e.cloudSyncedAt || e.cloudSkipped || !e.contentHash) continue;
      if (!ctx.cloudHashes.has(e.contentHash)) continue;
      await ctx.db.put('aiEmbeddings', { ...e, cloudSyncedAt: Date.now() });
      counters.markedSynced++;
    }
  }

  if (exhausted) {
    closeEmbeddingRestore(userId);
    return true;
  }
  // В-1: три прохода подряд курсор не сдвинулся — догрузка стоит, ждать нельзя.
  if (noteEmbeddingRestoreProgress(userId, getEmbeddingRestoreCursor(userId) !== startCursor)) {
    closeEmbeddingRestore(userId);
    return true;
  }
  return false;
}

/**
 * В-1: продолжение начатой догрузки векторов — на КАЖДОМ фоновом проходе, а не раз
 * в сутки. Первый запуск по-прежнему решает полный проход
 * (`shouldAutoDownloadVectors`); здесь только то, что не дошло за прошлые разы.
 * Пропуск, если чат отвечает (векторы не нужны посреди хода) или сейф заперт
 * (расшифровка всё равно падает, а чтения облака уже заплачены).
 */
export async function continueEmbeddingDownload(userId: string): Promise<EmbeddingDownloadOutcome> {
  if (!userId) return NO_DOWNLOAD;
  // Застарелая догрузка сюда доходит: `runEmbeddingDownload` закрывает её и
  // ставит «готово», а не молча возвращается.
  if (!isEmbeddingRestoreStarted(userId) || isEmbeddingRestoreDone(userId)) return NO_DOWNLOAD;
  if (useAIStageStore.getState().stage !== null) return NO_DOWNLOAD;
  if (getEncryptionEnabled(userId) && !getSessionKey()) return NO_DOWNLOAD;
  const db = await getLocalDb(userId);
  const counters: EmbeddingCounters = { embeddings: 0, failed: 0, markedSynced: 0 };
  const finished = await runEmbeddingDownload(userId, await embeddingRunContext(
    userId, db, getPendingAnalysisDeleteKeys(userId) ?? { has: () => true },
  ), counters);
  return { ...counters, finished };
}

export interface AIRestoreResult {
  summaries: number;
  embeddings: number;
  localStoreRecords: number;
  /** Local records the cloud already holds, marked so they are not re-uploaded. */
  markedSynced: number;
  failed: number;
  oversized: number;
  skippedLocked: boolean;
  sectionFailed?: boolean;
  /**
   * Наибольшая СЕРВЕРНАЯ отметка строки, реально увидленная в облаке за этот
   * проход (W-5; `payload.updatedAt` — только у строк без неё). Курсор
   * инкрементального забора обязан считаться по ней, а не по `Date.now()` и не по
   * часам устройства-писателя: на устройстве с часами вперёд собственные часы
   * оказываются «новее» всего, что приходит с сервера, — такой читатель перестал бы
   * получать чужие правки совсем.
   */
  maxUpdatedAt: number;
}

/**
 * Pulls AI analysis back from the cloud into local storage.
 *
 * Signing out wipes every local store (SEC-29), which is correct on a shared
 * device but also deletes summaries and embeddings that cost real LLM calls to
 * produce. Both live in the cloud, so they never have to be recomputed — but
 * nothing walked those collections to bring them home, and the embedding
 * indexer deliberately never reads the cloud in its loop, so it would have
 * re-embedded every note from scratch instead.
 *
 * Read-only against the cloud. A local record is replaced only by a strictly
 * newer cloud copy: a restore must not clobber work newer than the cloud copy.
 */
/**
 * M-5: строки сегментной копии в том виде, в котором их читает
 * readSegmentVersion — head с открытыми текстовыми полями и названные им сегменты
 * с открытым `messages`. Строки, которых head не называет, читателя не касаются:
 * это осиротевшие остатки чужих попыток, их убирает писатель. Нечитаемая
 * названная строка остаётся брошенной ошибкой, а не «строк не было».
 */
async function decodeSegmentGroup(rows: CloudRow[], headRow: CloudRow): Promise<CloudRow[]> {
  const payload = await maybeDecrypt(headRow.payload, [...HEAD_TEXT_FIELDS], []);
  const named = new Set(((payload.segments as Array<{ key: string }> | undefined) ?? []).map(s => s.key));
  const out: CloudRow[] = [{ key: headRow.key, payload }];
  for (const r of rows) {
    if (r === headRow || r.payload.seg !== true || !named.has(r.key)) continue;
    out.push({ key: r.key, payload: await maybeDecrypt(r.payload, [...SEGMENT_TEXT_FIELDS], []) });
  }
  return out;
}

/** Инкрементальный забор фильтрует строки по `payload.updatedAt`, а переиспользованное
 *  окно сохраняет свою прежнюю отметку: свежий head может приехать без старых строк,
 *  которые он называет. Их добирают точным чтением по ключу; чего нет — того нет,
 *  и отказ выдаёт readSegmentVersion. */
async function fetchMissingSegments(userId: string, store: string, keys: string[]): Promise<CloudRow[]> {
  const out: CloudRow[] = [];
  for (const key of keys) {
    const row = await DataProvider.getLocalStoreRecord(userId, store, key);
    if (!row) continue;
    out.push({ key, payload: await maybeDecrypt(row.payload as Record<string, unknown>, [...SEGMENT_TEXT_FIELDS], []) });
  }
  return out;
}

/**
 * `sinceMs` — инкрементальный забор: только то, что изменилось на других
 * устройствах после этой отметки (регулярный фоновый проход). Без него —
 * полное восстановление (раз в день, после очистки устройства).
 */
export async function restoreAIDataFromCloud(userId: string, opts?: { sinceMs?: number }): Promise<AIRestoreResult> {
  const sinceMs = opts?.sinceMs;
  const result: AIRestoreResult = { summaries: 0, embeddings: 0, localStoreRecords: 0, markedSynced: 0, failed: 0, oversized: 0, skippedLocked: false, sectionFailed: false, maxUpdatedAt: 0 };
  if (!userId) return result;

  // With E2E on but the vault locked, every decrypt throws. Restoring now would
  // just burn reads and log noise; the caller retries after unlock.
  if (getEncryptionEnabled(userId) && !getSessionKey()) {
    result.skippedLocked = true;
    return result;
  }

  const db = await getLocalDb(userId);

  // Журнал удалений разборов не читается — не знаем, какие разборы удалены:
  // вернуть удалённое хуже, чем не вернуть ничего (как у AI-сторов ниже).
  const pendingAnalysisDeletes = getPendingAnalysisDeleteKeys(userId) ?? { has: () => true };

  try {
    const docs = await DataProvider.getUserSummaries(userId, sinceMs);
    if (docs.length > 0) {
      const localSummaries = new Map((await db.getAll('aiSummaries')).map(s => [s.documentId, s] as const));
      const localDocByUuid = new Map<string, { id: string; lastSessionAt?: number | undefined }>();
      for (const doc of await db.getAll('documents')) if (doc.uuid) localDocByUuid.set(doc.uuid, doc);

      for (const d of docs) {
        const cloudKey = d.id as string;
        if (pendingAnalysisDeletes.has(cloudKey)) continue;
        try {
          const decoded = await decodeCloudSummary(d, cloudKey);
          const uuid = decoded.documentUuid ?? cloudKey;
          if (pendingAnalysisDeletes.has(uuid) || (decoded.documentId && pendingAnalysisDeletes.has(decoded.documentId))) continue;
          const localDoc = localDocByUuid.get(uuid);
          const existing = (localDoc && localSummaries.get(localDoc.id))
            ?? localSummaries.get(decoded.documentId) ?? localSummaries.get(cloudKey);
          // Разбор, сделанный заново на другом устройстве, новее здешнего.
          // Раньше любой локальный разбор блокировал облачный навсегда: повторный
          // разбор с компьютера так и не доезжал до ноутбука. Без отметки
          // времени облачная копия не считается новее.
          const cloudTs = typeof d.processedAt === 'number' ? decoded.processedAt : 0;
          if (existing && (existing.processedAt ?? 0) >= cloudTs) continue;
          if (localDoc) {
            const adopted: AIDocumentSummary = { ...decoded, documentId: localDoc.id, documentUuid: uuid };
            await db.put('aiSummaries', adopted);
            if (cloudKey !== localDoc.id && localSummaries.has(cloudKey)) await db.delete('aiSummaries', cloudKey);
            await rebuildTimelineEntry(db, localDoc, adopted);
          } else {
            await db.put('aiSummaries', decoded); // заметка ещё не приехала — привяжет reattachOrphanedAnalysis
          }
          result.summaries++;
        } catch {
          result.failed++;
        }
      }
    }
  } catch (e) {
    result.sectionFailed = true;
    reportError(e, { action: 'restoreAIData_summaries', userId });
  }

  // --- Restore local_store_records (allowlisted AI stores) ---
  const pendingDeletes = getPendingStoreDeleteKeys(userId);
  if (pendingDeletes === null) {
    // A-5 (R2-012): журнал незакрытых облачных удалений не читается — не знаем,
    // какие из облачных записей пользователь уже снёс. Вернуть удалённое хуже,
    // чем не вернуть ничего, поэтому весь раздел пропускаем.
    result.sectionFailed = true;
    reportError(
      new Error('Journal of pending AI-store deletions is unreadable — AI-store restore skipped'),
      { action: 'restoreAIData_deleteJournalUnknown', userId },
      'warning',
    );
  } else try {
    const cloudRecords = await DataProvider.getLocalStoreRecords(userId, undefined, sinceMs);
    // DE-2: счётчик переписывается целиком — head, которого проход не увидел
    // (починен или уже за курсором), из него выпадает.
    const prevHolds = readIncompleteHolds(userId);
    const nextHolds: Record<string, number> = {};

    // Group cloud records by (store, baseKey). S-49: разбор ключей и выбор
    // версии — общий с выгрузкой (core/services/localStorePages).
    const grouped = new Map<string, { store: string; baseKey: string; rows: CloudRow[] }>();

    // W-5: курсор живёт серверной отметкой строки (миграция 0037), а не
    // `payload.updatedAt`: её переписывает сервер только у базовой строки диалога,
    // в остальных 13 хранилищах это часы устройства-писателя. Курсор, снятый с
    // таких часов, на устройстве с +2 ч уезжает в будущее, и строка, которую
    // другое устройство записало через 10 минут по серверному времени, не доезжает
    // никогда. Второй дефект той же причины: после апгрейда у всех старых строк
    // `stamped_at` = время миграции, а `payload.updatedAt` старее сохранённого
    // курсора → курсор не ползёт → весь набор перебирается каждые 2 минуты.
    // Строка без серверной отметки (её не ставил триггер 0037) по-прежнему
    // считает курсор часами писателя — и только как базовая строка записи:
    // отметка осиротевшего окна device-ная, ею задирать курсор нельзя.
    // D1-5: курсор двигают только применённые группы, и не дальше самой ранней
    // отвергнутой. Раньше он поднимался для каждой ПРОЧИТАННОЙ строки до решений:
    // оборванная выгрузка (head без окон) или слишком большая запись отвергались
    // навсегда — их отметка уже за курсором, и следующий забор их не приносил.
    const appliedStamps: number[] = [];
    let refusedMin: number | null = null;
    const rowCursorStamp = (rec: CloudRow, isBaseRow: boolean): number | null => (
      typeof rec.stamped_at === 'number'
        ? rec.stamped_at
        : isBaseRow && typeof rec.payload?.updatedAt === 'number' ? rec.payload.updatedAt : null
    );
    const groupStamp = (rows: CloudRow[], baseKey: string): number | null => {
      let t: number | null = null;
      for (const rec of rows) {
        const v = rowCursorStamp(rec, rec.key === baseKey);
        if (v !== null && (t === null || v > t)) t = v;
      }
      return t;
    };
    const markApplied = (rows: CloudRow[], baseKey: string): void => {
      const t = groupStamp(rows, baseKey);
      if (t !== null) appliedStamps.push(t);
    };
    // Ревью 0.10.7: порог — самая ранняя строка группы, а не самая поздняя:
    // фильтр забора построчный (`stamped_at > cursor`), и курсор между строками
    // группы отрезал бы её начало — она снова пришла бы неполной. Отказ навсегда
    // (слишком большая, битая, чужая контрольная сумма) курсор не держит: повтор
    // ничего не изменит, а каждый проход заново качал бы всё, что новее неё.
    const markRefused = (rows: CloudRow[], baseKey: string, permanent = false): void => {
      if (permanent) return;
      for (const rec of rows) {
        const t = rowCursorStamp(rec, rec.key === baseKey);
        if (t !== null && (refusedMin === null || t < refusedMin)) refusedMin = t;
      }
    };

    // Н-2 (дейлик 2026-10-23): отказ, который повтор без писателя не исправит
    // (неполный набор, битый сегмент, строка без текста), держит курсор не дольше
    // INCOMPLETE_HOLD_PASSES проходов — раньше отпуск был только у неполного.
    // true — отпущен: это уже не сбой прохода (R-8).
    const holdRefused = (store: string, rows: CloudRow[], baseKey: string, stamp: number | null | undefined): boolean => {
      const holdKey = `${store}:${baseKey}:${stamp ?? ''}`;
      nextHolds[holdKey] = (prevHolds[holdKey] ?? 0) + 1;
      const released = nextHolds[holdKey] > INCOMPLETE_HOLD_PASSES;
      markRefused(rows, baseKey, released);
      // DY4 П-в: отпущенный — для курсора как применённый, иначе самая свежая
      // строка облака перекачивалась бы каждым проходом бессрочно. Только здесь:
      // у прочих «вечных» отказов (сумма, разбор) курсор за строку не идёт.
      if (released) markApplied(rows, baseKey);
      return released;
    };

    for (const rec of cloudRecords) {
      if (!SUPPORTED_LOCAL_STORES.includes(rec.store as SupportedLocalStoreName)) continue;
      if (!(db.objectStoreNames as unknown as { contains(s: string): boolean }).contains(rec.store)) continue;

      const { baseKey: pageBase } = parseLocalStoreKey(rec.key);
      // M-5: сегмент `key@seg…` принадлежит записи `key`, а не себе и не странице.
      // Для остальных хранилищ @seg — обычная часть ключа.
      const baseKey = rec.store === 'aiDialogues' ? headKeyOfRow(pageBase) : pageBase;
      const groupKey = `${rec.store}:${baseKey}`;
      let grp = grouped.get(groupKey);
      if (!grp) {
        grp = { store: rec.store, baseKey, rows: [] };
        grouped.set(groupKey, grp);
      }
      grp.rows.push({ key: rec.key, payload: rec.payload as Record<string, unknown>, checksum: (rec as { checksum?: string }).checksum, stamped_at: rec.stamped_at });
    }

    // EA-5: запись, облачное удаление которой ещё не дошло, не воскрешаем.
    for (const { store, baseKey, rows } of grouped.values()) {
      if (pendingDeletes.has(`${store}:${baseKey}`)) { markApplied(rows, baseKey); continue; }
      // Спор копий считается отметкой БАЗОВОЙ строки, которую поставил сервер
      // (миграция 0037). Отметку берём не из `rows[0]`, а из строки с ключом
      // `baseKey`: head живёт именно там, и выбор по индексу молча зависел бы от
      // порядка сортировки в провайдере. Курсор забора считается отдельно — W-5.
      const versionRow = rows.find(r => r.key === baseKey);
      const outerTs = typeof versionRow?.payload?.updatedAt === 'number'
        ? (versionRow.payload.updatedAt as number)
        : null;
      try {
        let fullJson: string;
        let cloudTs: number | null = null;

        // M-5: head + сегменты. Head называет окна диалога, и это единственная
        // истина: если какого-то окна нет, копия неполная — отказ, а не
        // укороченный дневник. Сначала добираем недостающие строки точным чтением
        // (инкрементальный забор мог принести свежий head со старыми, уже
        // лежавшими в облаке сегментами), и только потом отказываемся.
        const headRow = store === 'aiDialogues' ? rows.find(r => r.payload.head === true) : undefined;
        if (headRow) {
          let segRows = await decodeSegmentGroup(rows, headRow);
          let version = readSegmentVersion(segRows);
          if (version && version.kind !== 'segments' && version.missing.length > 0) {
            const extra = await fetchMissingSegments(userId, store, version.missing);
            if (extra.length > 0) {
              segRows = [...segRows, ...extra];
              version = readSegmentVersion(segRows);
            }
          }
          // `incomplete` здесь — тоже отказ: забор не имеет права превращать
          // неполный набор в укороченный дневник. Починкой занимается писатель,
          // у которого есть локальный союз.
          if (!version || version.kind !== 'segments') {
            const reason = !version ? 'head-строка не читается как head'
              : version.kind === 'refused' ? version.reason
              : `не хватает ${version.missing.length} сегментов: ${version.missing.join(', ')}`;
            logger.warn('AIRestoreService', `${store}/${baseKey}: ${reason}. Refusing.`);
            if (version?.kind === 'incomplete' && version.missing.length > 0) LocalStoreSyncService.scheduleStoreSync('aiDialogues', baseKey);
            const permanent = holdRefused(store, rows, baseKey, headRow.stamped_at);
            // R-8: отпущенный head — не сбой прохода: иначе `failed > 0` каждые 120 с
            // снимал суточную отметку, и полный restoreAIDataFromCloud шёл заново.
            if (!permanent) result.failed++;
            continue; // Keep local copy intact!
          }
          fullJson = JSON.stringify(version.dialogue);
          cloudTs = version.head.updatedAt;
        } else {
          // S-49: манифест указывает версию точно; без него — самая свежая полная
          // версия по отметке. Страницы разных версий могут лежать рядом: хвост
          // прежней, более длинной версии, проигравшая попытка, выгрузка,
          // оборванная на середине. Склеить половинки двух версий нельзя.
          const version = selectCloudVersion(rows, store === 'aiDialogues');
          if (!version) {
            // Две тихие ветки отказа теперь морозят курсор (D1-5), поэтому молчать
            // они больше не имеют права: без строки в журнале stall необъясним.
            logger.warn('AIRestoreService', `${store}/${baseKey}: no single row and no pages. Refusing.`);
            holdRefused(store, rows, baseKey, groupStamp(rows, baseKey));
            continue;
          }
          if (version.kind === 'refused') {
            logger.warn('AIRestoreService', `${store}/${baseKey}: ${version.reason}. Refusing.`);
            if (!holdRefused(store, rows, baseKey, groupStamp(rows, baseKey))) result.failed++;
            continue; // Keep local copy intact!
          }

          if (version.kind === 'single') {
            const decryptedPayload = await maybeDecrypt(version.row.payload, ['data'], []);
            if (typeof decryptedPayload.data !== 'string') {
              logger.warn('AIRestoreService', `${store}/${baseKey}: single row without text data. Refusing.`);
              holdRefused(store, rows, baseKey, groupStamp(rows, baseKey));
              continue;
            }
            fullJson = decryptedPayload.data;
            cloudTs = typeof decryptedPayload.updatedAt === 'number' ? decryptedPayload.updatedAt : null;
          } else {
            // Decrypt and join chunks
            const decryptedChunks: string[] = [];
            let decryptFailed = false;

            for (const pageItem of version.pages) {
              const dec = await maybeDecrypt(pageItem.payload, [...PAGE_TEXT_FIELDS], []);
              // M-3: страница нового формата несёт текст в `chunk`.
              const chunk = pageTextOf(dec);
              if (chunk === null) {
                decryptFailed = true;
                break;
              }
              decryptedChunks.push(chunk);
            }

            // Страница без текстового поля — форма, не запертый сейф (LOCKED
            // бросает maybeDecrypt, его держит общий catch без отпуска).
            if (decryptFailed) {
              if (!holdRefused(store, rows, baseKey, groupStamp(rows, baseKey))) result.failed++;
              continue;
            }

            fullJson = decryptedChunks.join('');
            cloudTs = version.updatedAt;
          }
        }

        // AG-RESTORE-4: Limit is MAX_RESTORE_RECORD_BYTES (10 MB) — above the upload cap,
        // so records uploaded by older versions still restore. Oversized records are refused and reported separately with size and limit.
        // Malformed records (corrupted JSON or non-object) are reported as malformed.
        const recordBytes = new TextEncoder().encode(fullJson).length;
        if (recordBytes > MAX_RESTORE_RECORD_BYTES) {
          result.oversized++;
          logger.warn(
            'AIRestoreService',
            `Record too large to restore (${recordBytes} bytes, limit ${MAX_RESTORE_RECORD_BYTES} bytes): ${store}/${baseKey}`
          );
          reportError(
            new Error(`restoreAIData: oversized local_store_record (${recordBytes} bytes, limit ${MAX_RESTORE_RECORD_BYTES} bytes)`),
            { store, key: baseKey, bytes: recordBytes, limit: MAX_RESTORE_RECORD_BYTES },
            'warning'
          );
          useActivityLogStore.getState().addActivity(
            'activity_restore_oversized_record',
            { action: 'restoreAIData_oversized', store, key: baseKey, bytes: recordBytes, limit: MAX_RESTORE_RECORD_BYTES, kb: Math.round(recordBytes / 1024) },
            'warning',
            'ai'
          );
          markRefused(rows, baseKey, true);
          continue;
        }

        let parsedData: unknown;
        try {
          parsedData = JSON.parse(fullJson);
        } catch {
          markRefused(rows, baseKey, true);
          result.failed++;
          reportError(new Error('restoreAIData: malformed local_store_record'), { store, key: baseKey });
          continue;
        }

        if (parsedData === null || typeof parsedData !== 'object' || Array.isArray(parsedData)) {
          markRefused(rows, baseKey, true);
          result.failed++;
          reportError(new Error('restoreAIData: malformed local_store_record'), { store, key: baseKey });
          continue;
        }
        // П-3 (D1-7): отметка — базовой строки (одиночная запись) или страницы
        // `#0` (постраничная); `rows[0]` — произвольная строка группы.
        const checksumRow = versionRow ?? rows.find(r => parseLocalStoreKey(r.key).pageIndex === 0);
        const expectedChecksum = checksumRow?.checksum;
        if (expectedChecksum) {
          const computed = await sha256Hex(fullJson);
          if (computed !== expectedChecksum) {
            markRefused(rows, baseKey, true);
            result.failed++;
            reportError(new Error('restoreAIData: checksum mismatch'), { store, key: baseKey });
            continue;
          }
        }
        const dataTs = extractRecordTimestamp(parsedData);
        if (dataTs !== null) {
          cloudTs = dataTs;
        }

        // S-29: диалоги не выбирают победителя по часам — они сливаются.
        // LWW уносил ход того устройства, которое ответило вторым, молча.
        // S-35: чтение, слияние и запись — в одной транзакции и без await на
        // не-IDB работе между ними: ход, записанный между get и put, терялся.
        if (store === 'aiDialogues') {
          // Версией облачной копии считается серверная отметка строки, а не та,
          // что нарисована часами устройства внутри `data`.
          const cloudDialogue: AIDialogue = outerTs === null
            ? (parsedData as AIDialogue)
            : { ...(parsedData as AIDialogue), updatedAt: outerTs };
          const tx = db.transaction('aiDialogues', 'readwrite');
          const current = await tx.store.get(baseKey);
          const merged = current ? mergeDialogues(current, cloudDialogue) : cloudDialogue;
          const changed = !current || dialogueFingerprint(merged) !== dialogueFingerprint(current) || merged.updatedAt !== current.updatedAt;
          if (changed) await tx.store.put(merged);
          await tx.done;
          if (changed) result.localStoreRecords++;
          // Союз надо отправить в облако, иначе второе устройство так и
          // останется со своей половинкой. Совпал с облаком — слать нечего.
          if (current && dialogueFingerprint(merged) !== dialogueFingerprint(cloudDialogue)) {
            LocalStoreSyncService.scheduleStoreSync('aiDialogues', merged.id);
            // V-4.1: облако принёс ЖИВУЮ строку туда, где у нас надгробие, — это
            // старый клиент перезаписал голову удаления. Ждать следующего flush'а
            // нельзя: до него свежее устройство показывает диалог, которого уже нет.
            // (Если выгрузка уже идёт параллельно, flushPending пропустит шаг, а
            // отметка останется в очереди и уйдёт текущей выгрузкой.)
            if (isTombstoned(current) && !isTombstoned(cloudDialogue)) {
              await LocalStoreSyncService.flushPending();
            }
          }
          markApplied(rows, baseKey);
          continue;
        }

        // Get local record if exists
        const localRecord = await (db as unknown as { get(s: string, k: string): Promise<unknown> }).get(store, baseKey);

        const putRecord = (value: unknown = parsedData) => (db as unknown as { put(s: string, v: unknown): Promise<unknown> }).put(store, value);

        // T-8: серверная отметка этой облачной версии (наибольшая по строкам группы —
        // у постраничной записи базовой строки нет, есть страницы `key#N`).
        const stamps = rows.map(r => r.stamped_at).filter((n): n is number => typeof n === 'number');
        const cloudStamp = stamps.length > 0 ? Math.max(...stamps) : undefined;
        // SF2-2: вместе с отметкой ряда запоминается и хэш его содержимого —
        // принятая облачная версия становится базой, от которой следующая правка
        // отличает «там наше же» (слепой upsert, потерянный ответ) от «там чужое».
        const withStamp = (value: unknown): unknown => (cloudStamp !== undefined && value && typeof value === 'object'
          ? {
              ...(value as Record<string, unknown>),
              [CLOUD_STAMP_FIELD]: cloudStamp,
              [CLOUD_BASE_HASH_FIELD]: contentHash(fullJson),
            }
          : value);
        const writeLocal = async (value: unknown) => {
          if (store === 'aiProfileFacets') await writeFacetStore(s => s.put(value as AIProfileFacet));
          else await putRecord(value);
        };

        if (localRecord !== undefined) {
          // T-8: невыгруженная локальная правка спор не проигрывает; `null` — журнал не
          // читается, и тогда облако локальную копию не перезаписывает. Читается здесь,
          // а не до сетевого запроса: правка, вставшая в очередь, пока забор ждал
          // сеть, иначе считалась бы «нет правки» (ревью приёмки 0.10.0).
          const pendingUpserts = getPendingUpsertKeySet(userId);
          const decision = decideScalarCopy({
            pending: pendingUpserts === null ? null : pendingUpserts.has(`${store}:${baseKey}`),
            base: (localRecord as Record<string, unknown>)[CLOUD_STAMP_FIELD] as number | undefined,
            cloudStamp,
            // DY10-8: сравниваем облачный вид — локальный вектор-кэш в облако не едет.
            sameContent: JSON.stringify(cloudFormOf(store, localRecord)) === fullJson,
            localTs: extractRecordTimestamp(localRecord),
            cloudTs,
          });
          if (decision === 'cloud') {
            await writeLocal(withStamp(keepLocalVector(store, parsedData, localRecord)));
            result.localStoreRecords++;
          } else if (decision === 'adopt') {
            await writeLocal(withStamp(localRecord));
          }
        } else {
          // No local record -> put cloud record
          await writeLocal(withStamp(parsedData));
          result.localStoreRecords++;
        }
        markApplied(rows, baseKey);
        // DY10-8: облачная копия ещё с вектором (до DY10-8) — отправить облегчённую.
        // Выгрузка условная (база — принятая облачная версия), чужую правку не затрёт.
        if (carriesSyncedVector(store, parsedData)) LocalStoreSyncService.scheduleStoreSync(store as SupportedLocalStoreName, baseKey);
      } catch (err) {
        markRefused(rows, baseKey);
        result.failed++;
        reportError(err, { action: 'restoreAIData_local_store_record', store, key: baseKey });
      }
    }

    // C7: отпущенный head помним и тогда, когда этот проход его не видел (курсор уже
    // за ним). Иначе ключ выпадал, следующий полный проход начинал счёт с нуля и
    // снова давал `failed++` — суточная отметка не ставилась, полный проход шёл
    // каждые 120 с. Неотпущенный и невиденный — выпадает: его починили.
    const released = Object.entries(prevHolds)
      .filter(([k, n]) => !(k in nextHolds) && n > INCOMPLETE_HOLD_PASSES)
      // Порядок prevHolds: сначала виденные прошлым проходом, потом отпущенные раньше —
      // начало списка самое свежее, его и держим.
      .slice(0, RELEASED_HOLDS_CAP);
    for (const [k, n] of released) nextHolds[k] = n;
    try {
      if (Object.keys(nextHolds).length > 0) localStorage.setItem(incompleteHoldsKey(userId), JSON.stringify(nextHolds));
      else localStorage.removeItem(incompleteHoldsKey(userId));
    } catch (e) {
      // Без счётчика — прежнее поведение: осиротевший head держит курсор.
      reportError(e, { action: 'restoreAIData_incompleteHolds', userId }, 'warning');
    }

    // D1-5: за отвергнутую строку курсор не идёт — иначе она не приедет, пока
    // кто-нибудь не перепишет её. Применённое до неё отмечается как обычно.
    if (appliedStamps.length > 0) {
      const floor = refusedMin;
      let safe = -Infinity;
      for (const t of appliedStamps) if ((floor === null || t < floor) && t > safe) safe = t;
      if (Number.isFinite(safe) && safe > result.maxUpdatedAt) result.maxUpdatedAt = safe;
    }
  } catch (e) {
    result.sectionFailed = true;
    reportError(e, { action: 'restoreAIData_local_store_records', userId });
  }

  // Векторы — только при полном восстановлении: инкрементальный проход их не трогает,
  // а продолжение начатой догрузки идёт каждым фоновым проходом (`continueEmbeddingDownload`).
  if (sinceMs === undefined) try {
    // П-6 (замер 08.10.2026): кнопка в диагностике = «форсировать». Без неё
    // догрузка начинается сама, если свежих локальных векторов нет хотя бы для
    // половины заметок, доступных ИИ, автоматический проход ещё не завершён и
    // чат сейчас не отвечает. Раньше без кнопки векторы не приезжали вовсе, и
    // indexPending пересчитывал через ИИ весь архив нового устройства.
    const forced = isEmbeddingRestoreRequested(userId);
    if (forced || await shouldAutoDownloadVectors(userId, db)) {
      markEmbeddingRestoreStarted(userId);
      await runEmbeddingDownload(userId, await embeddingRunContext(userId, db, pendingAnalysisDeletes), result);
    }
  } catch (e) {
    result.sectionFailed = true;
    reportError(e, { action: 'restoreAIData_embeddings', userId });
  }

  if (result.summaries || result.embeddings || result.localStoreRecords || result.failed || result.oversized) {
    logger.info('AIRestoreService', 'Restored AI data from cloud', { ...result });
    const parts = [
      `сводок: ${result.summaries}`,
      `записей ИИ: ${result.localStoreRecords}`,
      `эмбеддингов: ${result.embeddings}`,
    ];
    if (result.oversized) {
      parts.push(`превысили лимит: ${result.oversized}`);
    }
    if (result.failed) {
      parts.push(`ошибок: ${result.failed}`);
    }
    useActivityLogStore.getState().addActivity(
      sinceMs !== undefined
        ? `Получено с других устройств (${parts.join(', ')})`
        : `Анализ восстановлен из облака (${parts.join(', ')})`,
      { action: 'restoreAIDataFromCloud', ...result },
      result.oversized || result.failed ? 'warning' : 'info',
      'ai'
    );
  }
  // Открытые экраны (список диалогов, открытый диалог, разбор в превью заметки)
  // читают базу один раз при открытии — без сигнала пришедшее не видно до перехода.
  if ((result.summaries || result.localStoreRecords) && typeof window !== 'undefined') {
    window.dispatchEvent(new Event('ai-data-pulled'));
    window.dispatchEvent(new Event('dialogue-updated'));
  }
  return result;
}

export interface ReattachResult {
  summaries: number;
  embeddings: number;
}

/**
 * Re-keys restored analysis onto the notes it belongs to.
 *
 * Primary path: match by documentUuid (canonical uuid set at save time).
 * Fallback: match by content hash for records created before uuid existed.
 *
 * Analysis is keyed by the LOCAL document id (`local_<uuid>`), which is minted
 * per device. Downloading a note from the cloud mints a new one, and cloud
 * documents carry no record of the old id, so after a local wipe every restored
 * summary and embedding points at an id that will never exist again — present
 * in storage, attached to nothing.
 */
export async function reattachOrphanedAnalysis(): Promise<ReattachResult> {
  const out: ReattachResult = { summaries: 0, embeddings: 0 };
  const db = await getLocalDb();

  // L-5 (R4-076): привязка сироты к заново скачанной заметке не смотрела ни в
  // журнал удалений разборов, ни в исключение заметки из AI — разбор, который
  // пользователь уже снёс, возвращался. Журнал не читается — проход отменяется
  // (fail-closed), как в restoreAIDataFromCloud.
  const pendingAnalysisDeletes = getPendingAnalysisDeleteKeys(getCurrentUser()?.uid ?? '');
  if (pendingAnalysisDeletes === null) return out;

  const [docs, summaries, embeddings] = await Promise.all([
    db.getAll('documents'),
    db.getAll('aiSummaries'),
    db.getAll('aiEmbeddings'),
  ]);

  const docIds = new Set(docs.map(d => d.id));
  // uuid → document, for primary matching.
  const docsByUuid = new Map<string, { id: string; uuid: string }>();
  for (const d of docs) {
    if (d.uuid) docsByUuid.set(d.uuid, { id: d.id, uuid: d.uuid });
  }

  // Separate orphans into those with uuid and those without.
  const orphanSummariesByUuid = new Map<string, AIDocumentSummary[]>();
  const orphanSummariesByHash = new Map<string, AIDocumentSummary>();
  for (const s of summaries) {
    if (docIds.has(s.documentId)) continue;
    if (s.documentUuid) {
      const list = orphanSummariesByUuid.get(s.documentUuid) ?? [];
      list.push(s);
      orphanSummariesByUuid.set(s.documentUuid, list);
    } else if (s.contentHash) {
      orphanSummariesByHash.set(s.contentHash, s);
    }
  }

  const orphanEmbeddingsByUuid = new Map<string, AIDocumentEmbedding[]>();
  const orphanEmbeddingsByHash = new Map<string, AIDocumentEmbedding>();
  for (const e of embeddings) {
    if (docIds.has(e.documentId)) continue;
    if (e.documentUuid) {
      const list = orphanEmbeddingsByUuid.get(e.documentUuid) ?? [];
      list.push(e);
      orphanEmbeddingsByUuid.set(e.documentUuid, list);
    } else if (e.contentHash) {
      orphanEmbeddingsByHash.set(e.contentHash, e);
    }
  }

  if (
    orphanSummariesByUuid.size === 0 && orphanSummariesByHash.size === 0 &&
    orphanEmbeddingsByUuid.size === 0 && orphanEmbeddingsByHash.size === 0
  ) return out;

  const hasSummary = new Set(summaries.map(s => s.documentId));
  const hasEmbedding = new Set(embeddings.map(e => e.documentId));

  for (const doc of docs) {
    if (!doc.uuid) continue;
    if ((doc.uuid && pendingAnalysisDeletes.has(doc.uuid)) || isExcludedFromAI(doc)) continue;
    const needsSummary = !hasSummary.has(doc.id);
    const needsEmbedding = !hasEmbedding.has(doc.id);
    if (!needsSummary && !needsEmbedding) continue;

    // ── primary: match by documentUuid ────────────────────────────────
    if (needsSummary) {
      const candidates = orphanSummariesByUuid.get(doc.uuid);
      if (candidates?.length) {
        const orphan = candidates.shift()!;
        const adopted: AIDocumentSummary = { ...orphan, documentId: doc.id };
        await db.put('aiSummaries', adopted);
        await db.delete('aiSummaries', orphan.documentId);
        if (candidates.length === 0) orphanSummariesByUuid.delete(doc.uuid);
        await rebuildTimelineEntry(db, doc, adopted);
        out.summaries++;
      }
    }

    if (needsEmbedding) {
      const candidates = orphanEmbeddingsByUuid.get(doc.uuid);
      if (candidates?.length) {
        const orphan = candidates.shift()!;
        await db.put('aiEmbeddings', { ...orphan, documentId: doc.id });
        await db.delete('aiEmbeddings', orphan.documentId);
        invalidateEmbeddingIndexCache();
        if (candidates.length === 0) orphanEmbeddingsByUuid.delete(doc.uuid);
        out.embeddings++;
      }
    }
  }

  // ── fallback: match by content hash for records without documentUuid ─
  // This path is for records created before uuid was available. The risk
  // "two notes with identical text" remains for these legacy records.
  for (const doc of docs) {
    if (orphanSummariesByHash.size === 0 && orphanEmbeddingsByHash.size === 0) break;
    if ((doc.uuid && pendingAnalysisDeletes.has(doc.uuid)) || isExcludedFromAI(doc)) continue;

    const needsSummary = !hasSummary.has(doc.id) && orphanSummariesByHash.size > 0;
    const needsEmbedding = !hasEmbedding.has(doc.id) && orphanEmbeddingsByHash.size > 0;
    if (!needsSummary && !needsEmbedding) continue;

    const content = await LocalVersionService.getLatestContent(doc.id);
    if (!content) continue;
    const hash = await sha256Hex(content);

    if (needsSummary) {
      const orphan = orphanSummariesByHash.get(hash);
      if (orphan) {
        const adopted: AIDocumentSummary = { ...orphan, documentId: doc.id };
        await db.put('aiSummaries', adopted);
        await db.delete('aiSummaries', orphan.documentId);
        orphanSummariesByHash.delete(hash);
        await rebuildTimelineEntry(db, doc, adopted);
        out.summaries++;
      }
    }

    if (needsEmbedding) {
      const orphan = orphanEmbeddingsByHash.get(hash);
      if (orphan) {
        await db.put('aiEmbeddings', { ...orphan, documentId: doc.id });
        await db.delete('aiEmbeddings', orphan.documentId);
        invalidateEmbeddingIndexCache();
        orphanEmbeddingsByHash.delete(hash);
        out.embeddings++;
      }
    }
  }

  if (out.summaries || out.embeddings) {
    logger.info('AIRestoreService', 'Re-attached orphaned analysis', { ...out });
    useActivityLogStore.getState().addActivity(
      'activity_analysis_reattached',
      { action: 'reattachOrphanedAnalysis', ...out },
      'info',
      'ai'
    );
  }
  return out;
}

/**
 * Rebuilds the timeline row that AISummaryService.save() would have written.
 * Deliberately does NOT call save(): that also triggers monthly digest
 * generation, which in a loop over every restored note is a digest storm.
 */
async function rebuildTimelineEntry(
  db: Awaited<ReturnType<typeof getLocalDb>>,
  doc: { id: string; lastSessionAt?: number | undefined },
  summary: AIDocumentSummary,
): Promise<void> {
  if (!doc.lastSessionAt) return;
  const d = new Date(doc.lastSessionAt);
  if (isNaN(d.getTime())) return;
  const dateStr = localDayKey(d);

  const entry: AITimelineEntry = {
    documentId: doc.id,
    date: dateStr,
    month: localMonthKey(d),
    facts: summary.extractedFacts ?? [],
    tone: summary.tone,
    themes: summary.themes ?? [],
    insights: summary.insights ?? [],
    eventDate: summary.eventDate ?? dateStr,
  };
  if (summary.summary !== undefined) entry.summary = summary.summary;
  if (summary.valence !== undefined) entry.valence = summary.valence;
  if (summary.arousal !== undefined) entry.arousal = summary.arousal;
  await db.put('aiTimeline', entry);

  // Очередь тем не наполняем: её разбирал фоновый проход, которого больше
  // нет (см. AISummaryService.save).
}

/**
 * Restores AI data from cloud and immediately re-attaches any analysis
 * to local notes. Used by UI components during cloud restore.
 */
export async function restoreAndReattachAIData(userId: string): Promise<AIRestoreResult> {
  const res = await restoreAIDataFromCloud(userId);
  await reattachOrphanedAnalysis();
  return res;
}

/**
 * T-8 (R7Q-004 = R7F-001): спор копий скалярного ИИ-стора решается СЕРВЕРНОЙ
 * отметкой (`stamped_at`, миграция 0037), а не часами устройства. Локальная копия
 * помнит отметку облачной версии, от которой получена (`_cloudStampedAt`).
 * - невыгруженная правка (или журнал не читается) — локальная копия остаётся:
 *   выгрузка получит более позднюю серверную отметку;
 * - отметка известна — облако побеждает, только если его версия новее;
 * - отметки ещё нет (записи до 0.10.0): одинаковое содержимое — запомнить отметку,
 *   иначе — S0-3 (F-2): облако побеждает и запоминается.
 *
 * S0-3: прежним `legacy` этот случай сравнивал `cloudTs` и `localTs`, а оба числа
 * придумали часы устройств. Запись 0.9.x с устройства, чьи часы спешат, никогда не
 * принимала облачную копию и никогда не получала базу — «одноразовый переход»
 * оказывался вечным заложником. Обоснование нового правила: правку, которую
 * человек не успел выгрузить, видно в очереди (см. выше), значит запись без базы и
 * без очереди — копия прошлой синхронизации, и для неё облако авторитетно.
 * Принятая отметка делает следующий спор серверным, а не часовым.
 */
export function decideScalarCopy(o: {
  pending: boolean | null;
  base: number | undefined;
  cloudStamp: number | undefined;
  sameContent: boolean;
  localTs: number | null;
  cloudTs: number | null;
}): 'cloud' | 'local' | 'adopt' {
  /*gate:clock-rule*/
  // Всё правило выбора копии — под разметкой: и решение по серверной отметке, и
  // переходная ветка по часам (`legacy`). Гейт — src/test/syncRuleGates.s06.test.ts
  // (S0-6, SF-9): раньше метка охватывала только строку `pending`, и `Date.now()`
  // в `legacy` гейту не был виден.
  if (o.pending !== false) return 'local';
  const legacy = o.localTs !== null && o.cloudTs !== null && o.cloudTs > o.localTs ? 'cloud' : 'local';
  if (o.cloudStamp === undefined) return legacy;
  if (typeof o.base === 'number') return o.cloudStamp > o.base ? 'cloud' : 'local';
  if (o.sameContent) return 'adopt';
  return 'cloud';
  /*endgate:clock-rule*/
}
