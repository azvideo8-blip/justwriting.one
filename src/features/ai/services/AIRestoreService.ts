import { getLocalDb } from '../../../core/storage/localDb';
import type { AIDocumentSummary, AIDocumentEmbedding, AITimelineEntry, AIProfileFacet, AIDialogue } from '../../../core/storage/localDb';
import { DataProvider } from '../../../core/data';
import type { LocalStoreRecordRow } from '../../../core/data/types';
import { mergeDialogues, dialogueFingerprint, isTombstoned } from '../../../core/storage/dialogueMerge';
import { pageTextOf, parseLocalStoreKey, selectCloudVersion, PAGE_TEXT_FIELDS, type CloudRow } from '../../../core/services/localStorePages';
import {
  HEAD_TEXT_FIELDS,
  SEGMENT_TEXT_FIELDS,
  headKeyOfRow,
  readSegmentVersion,
} from '../../../core/services/dialogueSegments';
import { LocalVersionService } from '../../../core/services/LocalVersionService';
import { sha256Hex } from '../utils/embeddingIndexer';
import { getSessionKey } from '../../../core/crypto/encrypt';
import { getEncryptionEnabled, maybeDecrypt } from '../../../core/crypto/cryptoHelpers';
import {
  extractRecordTimestamp,
  LocalStoreSyncService,
  SUPPORTED_LOCAL_STORES,
  SupportedLocalStoreName,
  MAX_RESTORE_RECORD_BYTES,
  getPendingStoreDeleteKeys,
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

const EMBED_RESTORE_FLAG_PREFIX = 'ai_embed_restore_requested_';
const EMBED_RESTORE_CURSOR_PREFIX = 'ai_embed_restore_cursor_';
const LEGACY_EMBED_RESTORE_FLAG = 'ai_embed_restore_requested';
const LEGACY_EMBED_RESTORE_CURSOR = 'ai_embed_restore_cursor';

/** Opt in to pulling the semantic index back from the cloud. Deliberately
 *  manual: the collection costs more read units than a whole free day. */
export function requestEmbeddingRestore(userId: string): void {
  if (!userId) return;
  try { localStorage.setItem(`${EMBED_RESTORE_FLAG_PREFIX}${userId}`, '1'); } catch { /* ignore */ }
}

export function isEmbeddingRestoreRequested(userId: string): boolean {
  if (!userId) return false;
  try {
    // Drop unscoped keys on first read rather than migrating them (LS-4 Task 1)
    localStorage.removeItem(LEGACY_EMBED_RESTORE_FLAG);
    return localStorage.getItem(`${EMBED_RESTORE_FLAG_PREFIX}${userId}`) === '1';
  } catch { return false; }
}

function clearEmbeddingRestoreRequest(userId: string): void {
  if (!userId) return;
  try {
    localStorage.removeItem(LEGACY_EMBED_RESTORE_FLAG);
    localStorage.removeItem(LEGACY_EMBED_RESTORE_CURSOR);
    localStorage.removeItem(`${EMBED_RESTORE_FLAG_PREFIX}${userId}`);
    localStorage.removeItem(`${EMBED_RESTORE_CURSOR_PREFIX}${userId}`);
  } catch { /* намеренно: хранилище недоступно — и флага в нём нет */ }
}

/** Where the last run stopped, so a budget-limited restore resumes tomorrow
 *  instead of paying for the same pages again. */
function getEmbeddingRestoreCursor(userId: string): string {
  if (!userId) return '';
  try {
    localStorage.removeItem(LEGACY_EMBED_RESTORE_CURSOR);
    return localStorage.getItem(`${EMBED_RESTORE_CURSOR_PREFIX}${userId}`) ?? '';
  } catch { return ''; }
}

function setEmbeddingRestoreCursor(userId: string, id: string): void {
  if (!userId) return;
  try { localStorage.setItem(`${EMBED_RESTORE_CURSOR_PREFIX}${userId}`, id); } catch { /* ignore */ }
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

  const existingEmbeddings = new Set((await db.getAllKeys('aiEmbeddings')).map(String));

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
    const noteCursor = (rec: LocalStoreRecordRow, isBaseRow: boolean) => {
      const t = typeof rec.stamped_at === 'number'
        ? rec.stamped_at
        : isBaseRow && typeof rec.payload?.updatedAt === 'number' ? rec.payload.updatedAt : null;
      if (t !== null && t > result.maxUpdatedAt) result.maxUpdatedAt = t;
    };

    for (const rec of cloudRecords) {
      if (!SUPPORTED_LOCAL_STORES.includes(rec.store as SupportedLocalStoreName)) continue;
      if (!(db.objectStoreNames as unknown as { contains(s: string): boolean }).contains(rec.store)) continue;

      const { baseKey: pageBase } = parseLocalStoreKey(rec.key);
      // M-5: сегмент `key@seg…` принадлежит записи `key`, а не себе и не странице.
      // Для остальных хранилищ @seg — обычная часть ключа.
      const baseKey = rec.store === 'aiDialogues' ? headKeyOfRow(pageBase) : pageBase;
      noteCursor(rec, rec.key === baseKey);
      const groupKey = `${rec.store}:${baseKey}`;
      let grp = grouped.get(groupKey);
      if (!grp) {
        grp = { store: rec.store, baseKey, rows: [] };
        grouped.set(groupKey, grp);
      }
      grp.rows.push({ key: rec.key, payload: rec.payload as Record<string, unknown>, checksum: (rec as { checksum?: string }).checksum });
    }

    // EA-5: запись, облачное удаление которой ещё не дошло, не воскрешаем.
    for (const { store, baseKey, rows } of grouped.values()) {
      if (pendingDeletes.has(`${store}:${baseKey}`)) continue;
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
            if (version && version.kind === 'incomplete' && version.missing.length > 0) {
              LocalStoreSyncService.scheduleStoreSync('aiDialogues', baseKey);
            }
            result.failed++;
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
          if (!version) continue;
          if (version.kind === 'refused') {
            logger.warn('AIRestoreService', `${store}/${baseKey}: ${version.reason}. Refusing.`);
            result.failed++;
            continue; // Keep local copy intact!
          }

          if (version.kind === 'single') {
            const decryptedPayload = await maybeDecrypt(version.row.payload, ['data'], []);
            if (typeof decryptedPayload.data !== 'string') continue;
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

            if (decryptFailed) {
              result.failed++;
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
          continue;
        }

        let parsedData: unknown;
        try {
          parsedData = JSON.parse(fullJson);
        } catch {
          result.failed++;
          reportError(new Error('restoreAIData: malformed local_store_record'), { store, key: baseKey });
          continue;
        }

        if (parsedData === null || typeof parsedData !== 'object' || Array.isArray(parsedData)) {
          result.failed++;
          reportError(new Error('restoreAIData: malformed local_store_record'), { store, key: baseKey });
          continue;
        }
        const expectedChecksum = rows[0]?.checksum;
        if (expectedChecksum) {
          const computed = await sha256Hex(fullJson);
          if (computed !== expectedChecksum) {
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
          continue;
        }

        // Get local record if exists
        const localRecord = await (db as unknown as { get(s: string, k: string): Promise<unknown> }).get(store, baseKey);

        const putRecord = (value: unknown = parsedData) => (db as unknown as { put(s: string, v: unknown): Promise<unknown> }).put(store, value);

        if (localRecord !== undefined) {
          const localTs = extractRecordTimestamp(localRecord);
          // Conflict rule:
          // If both timestamps exist and cloudTs > localTs: cloud wins.
          // Otherwise: LOCAL WINS, never overwrite!
          if (localTs !== null && cloudTs !== null && cloudTs > localTs) {
            if (store === 'aiProfileFacets') {
              await writeFacetStore(s => s.put(parsedData as AIProfileFacet));
            } else {
              await putRecord();
            }
            result.localStoreRecords++;
          }
        } else {
          // No local record -> put cloud record
          if (store === 'aiProfileFacets') {
            await writeFacetStore(s => s.put(parsedData as AIProfileFacet));
          } else {
            await putRecord();
          }
          result.localStoreRecords++;
        }
      } catch (err) {
        result.failed++;
        reportError(err, { action: 'restoreAIData_local_store_record', store, key: baseKey });
      }
    }
  } catch (e) {
    result.sectionFailed = true;
    reportError(e, { action: 'restoreAIData_local_store_records', userId });
  }

  // Векторы — только при полном восстановлении: инкрементальный проход их не трогает.
  if (sinceMs === undefined) try {
    // Records already in the cloud must not be queued for upload. Anything
    // whose content hash the cloud already holds is present there under SOME
    // key — re-attach re-keys locally and the hash finds it again after a wipe,
    // so uploading it again buys nothing and costs a burst of multi-hundred-KB
    // vector writes. Missing this is how the daily write quota went twice in
    // one day.
    const localEmbeddings = await db.getAll('aiEmbeddings');
    const needsRepair = localEmbeddings.some(
      e => e.cloudSyncedAt === undefined && e.cloudSkipped !== true && Boolean(e.contentHash),
    );
    const cloudHashes = new Set<string>();

    if (isEmbeddingRestoreRequested(userId)) {
      const PAGE = 10;
      const MAX_EMBEDS_PER_RUN = 100;
      const docsPage: Record<string, unknown>[] = [];
      let cursorId: string | undefined = getEmbeddingRestoreCursor(userId) || undefined;
      while (docsPage.length < MAX_EMBEDS_PER_RUN) {
        const res = await DataProvider.getUserEmbeddingsPaginated(userId, PAGE, cursorId);
        // N-39: конец списка решает число строк, которые отдал сервер (readCount),
        // а не число своих после фильтра владельца: одна чужая строка в странице
        // иначе объявляла восстановление законченным и снимала флаг.
        if (res.readCount === 0) { clearEmbeddingRestoreRequest(userId); break; }
        
        docsPage.push(...res.items);
        cursorId = res.nextCursorId;
        if (cursorId) {
          setEmbeddingRestoreCursor(userId, cursorId);
        }
        
        if (res.readCount < PAGE) { clearEmbeddingRestoreRequest(userId); break; }
      }

      for (const d of docsPage) {
        const dId = d.id as string;
        if (pendingAnalysisDeletes.has(dId)) continue;
        const alreadyLocal = existingEmbeddings.has(dId);
        // Decoding an already-local record is pure CPU, no extra quota — worth it
        // only when there is something to repair.
        if (alreadyLocal && !needsRepair) continue;
        try {
          const decoded = await decodeCloudEmbedding(d, dId);
          if (decoded.contentHash) cloudHashes.add(decoded.contentHash);
          if (!alreadyLocal) {
            await db.put('aiEmbeddings', { ...decoded, cloudSyncedAt: Date.now() });
            result.embeddings++;
            // X-5: индекс построен по старому набору — сбрасываем на любой
            // привезённой записи.
            invalidateEmbeddingIndexCache();
          }
        } catch {
          result.failed++;
        }
      }

      if (needsRepair && cloudHashes.size > 0) {
        for (const e of await db.getAll('aiEmbeddings')) {
          if (e.cloudSyncedAt || e.cloudSkipped || !e.contentHash) continue;
          if (!cloudHashes.has(e.contentHash)) continue;
          await db.put('aiEmbeddings', { ...e, cloudSyncedAt: Date.now() });
          result.markedSynced++;
        }
      }
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
 * The theme ledger is re-driven through its normal governed queue instead.
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
