import { getLocalDb } from '../../../core/storage/localDb';
import type { AIDocumentSummary, AIDocumentEmbedding, AITimelineEntry } from '../../../core/storage/localDb';
import { DataProvider } from '../../../core/data';
import { sha256Hex, getLatestContent } from '../utils/embeddingIndexer';
import { getSessionKey } from '../../../core/crypto/encrypt';
import { getEncryptionEnabled, maybeDecrypt } from '../../../core/crypto/cryptoHelpers';
import { extractRecordTimestamp, SUPPORTED_LOCAL_STORES, SupportedLocalStoreName } from '../../../core/services/LocalStoreSyncService';

import { reportError } from '../../../shared/errors/reportError';
import { logger } from '../../../shared/errors/logger';
import { decodeCloudSummary } from './AISummaryService';
import { decodeCloudEmbedding } from './AIEmbeddingService';
import { useActivityLogStore } from '../../../shared/activity/useActivityLogStore';

const EMBED_RESTORE_FLAG = 'ai_embed_restore_requested';
const EMBED_RESTORE_CURSOR = 'ai_embed_restore_cursor';

/** Opt in to pulling the semantic index back from the cloud. Deliberately
 *  manual: the collection costs more read units than a whole free day. */
export function requestEmbeddingRestore(): void {
  try { localStorage.setItem(EMBED_RESTORE_FLAG, '1'); } catch { /* ignore */ }
}

export function isEmbeddingRestoreRequested(): boolean {
  try { return localStorage.getItem(EMBED_RESTORE_FLAG) === '1'; } catch { return false; }
}

function clearEmbeddingRestoreRequest(): void {
  try {
    localStorage.removeItem(EMBED_RESTORE_FLAG);
    localStorage.removeItem(EMBED_RESTORE_CURSOR);
  } catch { /* ignore */ }
}

/** Where the last run stopped, so a budget-limited restore resumes tomorrow
 *  instead of paying for the same pages again. */
function getEmbeddingRestoreCursor(): string {
  try { return localStorage.getItem(EMBED_RESTORE_CURSOR) ?? ''; } catch { return ''; }
}

function setEmbeddingRestoreCursor(id: string): void {
  try { localStorage.setItem(EMBED_RESTORE_CURSOR, id); } catch { /* ignore */ }
}

export interface AIRestoreResult {
  summaries: number;
  embeddings: number;
  localStoreRecords: number;
  /** Local records the cloud already holds, marked so they are not re-uploaded. */
  markedSynced: number;
  failed: number;
  skippedLocked: boolean;
}


/**
 * Pulls AI analysis back from the cloud into local storage.
 *
 * Signing out wipes every local store (SEC-29), which is correct on a shared
 * device but also deletes summaries and embeddings that cost real LLM calls to
 * produce. Both live in Firestore, so they never have to be recomputed — but
 * nothing walked those collections to bring them home, and the embedding
 * indexer deliberately never reads the cloud in its loop, so it would have
 * re-embedded every note from scratch instead.
 *
 * Read-only against the cloud, and it never overwrites a local record that is
 * already there: a restore must not clobber work newer than the cloud copy.
 */
export async function restoreAIDataFromCloud(userId: string): Promise<AIRestoreResult> {
  const result: AIRestoreResult = { summaries: 0, embeddings: 0, localStoreRecords: 0, markedSynced: 0, failed: 0, skippedLocked: false };
  if (!userId) return result;

  // With E2E on but the vault locked, every decrypt throws. Restoring now would
  // just burn reads and log noise; the caller retries after unlock.
  if (getEncryptionEnabled(userId) && !getSessionKey()) {
    result.skippedLocked = true;
    return result;
  }

  const db = await getLocalDb();

  const existingSummaries = new Set((await db.getAllKeys('aiSummaries')).map(String));
  const existingEmbeddings = new Set((await db.getAllKeys('aiEmbeddings')).map(String));

  try {
    const docs = await DataProvider.getUserSummaries(userId);
    for (const d of docs) {
      if (existingSummaries.has(d.id as string)) continue;
      try {
        await db.put('aiSummaries', await decodeCloudSummary(d, d.id as string));
        result.summaries++;
      } catch {
        result.failed++;
      }
    }
  } catch (e) {
    reportError(e, { action: 'restoreAIData_summaries', userId });
  }

  // --- Restore local_store_records (13 AI stores) ---
  try {
    const cloudRecords = await DataProvider.getLocalStoreRecords(userId);

    // Group cloud records by (store, baseKey)
    interface CloudGroupItem {
      fullKey: string;
      pageIndex: number | null; // null if not paged
      payload: Record<string, unknown>;
      checksum?: string | undefined;
    }
    const grouped = new Map<string, { store: string; baseKey: string; items: CloudGroupItem[] }>();

    for (const rec of cloudRecords) {
      if (!SUPPORTED_LOCAL_STORES.includes(rec.store as SupportedLocalStoreName)) continue;
      if (!(db.objectStoreNames as unknown as { contains(s: string): boolean }).contains(rec.store)) continue;

      const hashIdx = rec.key.lastIndexOf('#');
      let baseKey = rec.key;
      let pageIndex: number | null = null;
      if (hashIdx !== -1) {
        const suffix = rec.key.slice(hashIdx + 1);
        if (/^\d+$/.test(suffix)) {
          baseKey = rec.key.slice(0, hashIdx);
          pageIndex = parseInt(suffix, 10);
        }
      }

      const groupKey = `${rec.store}:${baseKey}`;
      let grp = grouped.get(groupKey);
      if (!grp) {
        grp = { store: rec.store, baseKey, items: [] };
        grouped.set(groupKey, grp);
      }
      grp.items.push({
        fullKey: rec.key,
        pageIndex,
        payload: rec.payload as Record<string, unknown>,
        checksum: (rec as { checksum?: string }).checksum,
      });
    }

    for (const { store, baseKey, items } of grouped.values()) {
      try {
        let fullJson: string;
        let cloudTs: number | null = null;

        const isPaged = items.some(it => it.pageIndex !== null);

        if (!isPaged) {
          // Single unpaged record
          const item = items[0];
          if (!item) continue;
          const decryptedPayload = await maybeDecrypt(item.payload, ['data'], []);
          if (typeof decryptedPayload.data !== 'string') continue;
          fullJson = decryptedPayload.data;
          cloudTs = typeof decryptedPayload.updatedAt === 'number' ? decryptedPayload.updatedAt : null;
        } else {
          // SYNC-4: Multi-page reassembly
          // Filter to only paged items
          const pagedItems = items.filter(it => it.pageIndex !== null);
          const firstPayload = pagedItems[0]?.payload;
          if (!firstPayload) continue;
          const expectedTotalPages = typeof firstPayload.totalPages === 'number' ? firstPayload.totalPages : null;
          const expectedUpdatedAt = typeof firstPayload.updatedAt === 'number' ? firstPayload.updatedAt : null;

          if (expectedTotalPages === null || expectedTotalPages <= 0 || pagedItems.length !== expectedTotalPages) {
            logger.warn('AIRestoreService', `Incomplete page count for ${store}/${baseKey}: found ${pagedItems.length}, expected ${expectedTotalPages}. Refusing incomplete set.`);
            result.failed++;
            continue; // Keep local copy intact!
          }

          // Check that all pages 0..totalPages-1 are present with matching updatedAt and totalPages
          const pagesByIndex = new Map<number, CloudGroupItem>();
          let hasIntegrityError = false;

          for (const it of pagedItems) {
            const pIndex = it.pageIndex!;
            const pTotal = it.payload.totalPages;
            const pTs = it.payload.updatedAt;

            if (pTotal !== expectedTotalPages || pTs !== expectedUpdatedAt) {
              logger.warn('AIRestoreService', `Mixed version stamps in pages for ${store}/${baseKey}. Refusing.`);
              hasIntegrityError = true;
              break;
            }
            if (pagesByIndex.has(pIndex)) {
              logger.warn('AIRestoreService', `Duplicate page index ${pIndex} for ${store}/${baseKey}. Refusing.`);
              hasIntegrityError = true;
              break;
            }
            pagesByIndex.set(pIndex, it);
          }

          if (hasIntegrityError) {
            result.failed++;
            continue;
          }

          const sortedPages: CloudGroupItem[] = [];
          for (let i = 0; i < expectedTotalPages; i++) {
            const pageItem = pagesByIndex.get(i);
            if (!pageItem) {
              logger.warn('AIRestoreService', `Missing page ${i} for ${store}/${baseKey}. Refusing.`);
              hasIntegrityError = true;
              break;
            }
            sortedPages.push(pageItem);
          }

          if (hasIntegrityError) {
            result.failed++;
            continue;
          }

          // Decrypt and join chunks
          const decryptedChunks: string[] = [];
          let decryptFailed = false;

          for (const pageItem of sortedPages) {
            const dec = await maybeDecrypt(pageItem.payload, ['data'], []);
            if (typeof dec.data !== 'string') {
              decryptFailed = true;
              break;
            }
            decryptedChunks.push(dec.data);
          }

          if (decryptFailed) {
            result.failed++;
            continue;
          }

          fullJson = decryptedChunks.join('');
          cloudTs = expectedUpdatedAt;
        }

        // Единственный read-путь без структурной валидации. Минимальный
        // гейт: плоский JSON-объект разумного размера. Чексумка, если запись
        // её несёт, обязательна к совпадению.
        const parsedData: unknown = JSON.parse(fullJson);
        if (
          parsedData === null || typeof parsedData !== 'object' || Array.isArray(parsedData)
          || fullJson.length > 512 * 1024
        ) {
          result.failed++;
          reportError(new Error('restoreAIData: malformed local_store_record'), { store, key: baseKey });
          continue;
        }
        const expectedChecksum = items[0]?.checksum;
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

        // Get local record if exists
        const localRecord = await (db as unknown as { get(s: string, k: string): Promise<unknown> }).get(store, baseKey);

        if (localRecord !== undefined) {
          const localTs = extractRecordTimestamp(localRecord);
          // Conflict rule:
          // If both timestamps exist and cloudTs > localTs: cloud wins.
          // Otherwise: LOCAL WINS, never overwrite!
          if (localTs !== null && cloudTs !== null && cloudTs > localTs) {
            await (db as unknown as { put(s: string, v: unknown): Promise<unknown> }).put(store, parsedData);
            result.localStoreRecords++;
          }
        } else {
          // No local record -> put cloud record
          await (db as unknown as { put(s: string, v: unknown): Promise<unknown> }).put(store, parsedData);
          result.localStoreRecords++;
        }
      } catch (err) {
        result.failed++;
        reportError(err, { action: 'restoreAIData_local_store_record', store, key: baseKey });
      }
    }
  } catch (e) {
    reportError(e, { action: 'restoreAIData_local_store_records', userId });
  }

  try {
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

    // NOT part of the automatic pass. An embedding record carries its chunk
    // vectors — hundreds of KB, dozens of read units each — so walking this
    // collection costs more than the entire free daily read quota and locks the
    // user out of their own notes for the rest of the day. Embeddings are a
    // cache of a deterministic computation: the indexer rebuilds a missing one
    // locally, at its own daily pace, for zero Firestore reads. Restoring them
    // is a deliberate, user-initiated action (requestEmbeddingRestore) and
    // resumes across days from a stored cursor.
    if (isEmbeddingRestoreRequested()) {
      const PAGE = 5;
      const docsPage: Record<string, unknown>[] = [];
      let cursorId: string | undefined = getEmbeddingRestoreCursor() || undefined;
      for (;;) {
        const res = await DataProvider.getUserEmbeddingsPaginated(userId, PAGE, cursorId);
        if (res.items.length === 0) { clearEmbeddingRestoreRequest(); break; }
        
        docsPage.push(...res.items);
        cursorId = res.nextCursorId;
        if (cursorId) {
          setEmbeddingRestoreCursor(cursorId);
        }
        
        if (res.items.length < PAGE) { clearEmbeddingRestoreRequest(); break; }
      }
      for (const d of docsPage) {
        const dId = d.id as string;
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
          }
        } catch {
          result.failed++;
        }
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
  } catch (e) {
    reportError(e, { action: 'restoreAIData_embeddings', userId });
  }

  if (result.summaries || result.embeddings || result.localStoreRecords || result.failed) {
    logger.info('AIRestoreService', 'Restored AI data from cloud', { ...result });
    useActivityLogStore.getState().addActivity(
      `Анализ восстановлен из облака (сводок: ${result.summaries}, записей ИИ: ${result.localStoreRecords}, эмбеддингов: ${result.embeddings})`,
      { action: 'restoreAIDataFromCloud', ...result },
      'info',
      'ai'
    );
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

    const needsSummary = !hasSummary.has(doc.id) && orphanSummariesByHash.size > 0;
    const needsEmbedding = !hasEmbedding.has(doc.id) && orphanEmbeddingsByHash.size > 0;
    if (!needsSummary && !needsEmbedding) continue;

    const content = await getLatestContent(doc.id);
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
        orphanEmbeddingsByHash.delete(hash);
        out.embeddings++;
      }
    }
  }

  if (out.summaries || out.embeddings) {
    logger.info('AIRestoreService', 'Re-attached orphaned analysis', { ...out });
    useActivityLogStore.getState().addActivity(
      `Анализ привязан к заметкам (сводок: ${out.summaries}, эмбеддингов: ${out.embeddings})`,
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
  const dateStr = d.toISOString().slice(0, 10);

  const entry: AITimelineEntry = {
    documentId: doc.id,
    date: dateStr,
    month: d.toISOString().slice(0, 7),
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
